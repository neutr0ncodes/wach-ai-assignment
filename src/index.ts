import { Mandate as CoreMandate, caip10 } from "@quillai-network/mandates-core";
import { Wallet } from "ethers";

import { mandateIntegrityVerifier } from "./verifiers/mandateIntegrity.js";
import { getSwapReceiptVerifier } from "./verifiers/swapReceiptVerifier.js";
import type { MandatePayload, Receipt } from "./types/payload.js";

async function main() {
  const now = new Date();
  const deadline = new Date(now.getTime() + 60 * 60 * 1000); // +1 hour

  // Create real client/server wallets with ethers.
  const clientWallet = Wallet.createRandom();
  const serverWallet = Wallet.createRandom();

  // Build a Mandate using the official SDK so that signatures are canonical.
  const coreMandate = new CoreMandate({
    mandateId: "test-mandate-1",
    version: "0.1.0",
    client: caip10(1, clientWallet.address),
    server: caip10(1, serverWallet.address),
    createdAt: now.toISOString(),
    deadline: deadline.toISOString(),
    intent: "Test mandate integrity verifier with real signatures",
    core: {
      kind: "swap@1",
      payload: {
        // Minimal payload for this test; router/other verifiers will care about structure.
      },
    },
    signatures: {},
  });

  // Sign as server (offer) and then as client (accept) using EIP-191.
  await coreMandate.signAsServer(serverWallet, "eip191");
  await coreMandate.signAsClient(clientWallet, "eip191");

  // Convert to plain JSON that matches our MandatePayload shape.
  const mandate = coreMandate.toJSON() as MandatePayload;

  const receipt: Receipt = {
    txHash: "0x" + "0".repeat(64),
    chainId: 1,
    executedAt: now.toISOString(),
  };

  const goodResult = await mandateIntegrityVerifier.verify(mandate, receipt);

  // eslint-disable-next-line no-console
  console.log("Client address:", clientWallet.address);
  // eslint-disable-next-line no-console
  console.log("Server address:", serverWallet.address);
  // eslint-disable-next-line no-console
  console.log(
    "Mandate Integrity Verifier Result (good mandate):",
    JSON.stringify(goodResult, null, 2),
  );

  // --- Second test: clearly invalid / expired mandate should have a low score (< 30) ---
  const pastDeadline = new Date(now.getTime() - 60 * 60 * 1000); // 1h in the past

  const badMandate: MandatePayload = {
    mandateId: "test-mandate-bad-1",
    // version is fixed to 0.1.0 by schema, but we include it explicitly for clarity.
    version: "0.1.0",
    client: caip10(1, clientWallet.address),
    server: caip10(1, serverWallet.address),
    createdAt: now.toISOString(),
    deadline: pastDeadline.toISOString(),
    intent: "This mandate should be scored very low (expired + no signatures).",
    core: {
      kind: "swap@1",
      payload: {},
    },
    signatures: {},
  };

  const badResult = await mandateIntegrityVerifier.verify(badMandate, {
    ...receipt,
    executedAt: pastDeadline.toISOString(),
  });

  // eslint-disable-next-line no-console
  console.log(
    "Mandate Integrity Verifier Result (bad mandate – expected < 30):",
    JSON.stringify(badResult, null, 2),
  );

  // --- Primitive Receipt Verifier tests ---
  const primitiveReceiptVerifier = getSwapReceiptVerifier();

  // Test 1: Unsupported kind → score 0, note says MVP supports only swap@1
  const transferMandate: MandatePayload = {
    mandateId: "test-mandate-transfer-1",
    version: "0.1.0",
    client: caip10(1, clientWallet.address),
    server: caip10(1, serverWallet.address),
    createdAt: now.toISOString(),
    deadline: deadline.toISOString(),
    intent: "Transfer 100 USDC",
    core: { kind: "transfer@1", payload: { amount: "100", token: "0xabc" } },
    signatures: {},
  };

  const unsupportedResult = await primitiveReceiptVerifier.verify(
    transferMandate,
    receipt,
  );

  // eslint-disable-next-line no-console
  console.log(
    "Primitive Receipt Verifier (unsupported kind transfer@1 – expected score 0):",
    JSON.stringify(unsupportedResult, null, 2),
  );

  // Test 2: swap@1 mandate + receipt with fake txHash → on-chain fetch fails, score 0
  const swapMandate: MandatePayload = {
    mandateId: "test-mandate-swap-1",
    version: "0.1.0",
    client: caip10(1, clientWallet.address),
    server: caip10(1, serverWallet.address),
    createdAt: now.toISOString(),
    deadline: deadline.toISOString(),
    intent: "Swap 100 USDC for WBTC",
    core: {
      kind: "swap@1",
      payload: {
        tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        tokenOut: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        amountIn: "100000000",
        minOut: "165000",
        chainId: 1,
      },
    },
    signatures: {},
  };

  const swapReceipt: Receipt = {
    txHash: "0x" + "dead".padStart(64, "0"),
    chainId: 1,
    executedAt: now.toISOString(),
    tokenIn: swapMandate.core!.payload.tokenIn as string,
    tokenOut: swapMandate.core!.payload.tokenOut as string,
    amountIn: "100000000",
    amountOut: "165000",
    executorAddress: serverWallet.address,
  };

  const swapResult = await primitiveReceiptVerifier.verify(
    swapMandate,
    swapReceipt,
  );

  // eslint-disable-next-line no-console
  console.log(
    "Primitive Receipt Verifier (swap@1 with fake txHash – expected score 0, notes about tx not found):",
    JSON.stringify(swapResult, null, 2),
  );
}

void main();

