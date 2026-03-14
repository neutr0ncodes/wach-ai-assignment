/**
 * Primitive Receipt Verifier (MVP: swap@1)
 *
 * Part of the end-to-end flow:
 *   Mandate + receipt → Router routes by core.kind → Verifiers run (integrity + this) → Aggregated score → Validation Registry
 *
 * This verifier validates that the **action receipt** (on-chain tx + decoded data) matches
 * mandate.core.payload for the mandate's primitive. It is the single "primitive receipt verifier"
 * for the MVP; it supports all mandate kinds in the flow (supportedKinds: ["*"]) but only
 * implements full receipt-vs-payload validation for swap@1. Other kinds get a clear note and 0
 * so the router can still aggregate (e.g. integrity score + 0 for receipt).
 *
 * Refs: @quillai-network/mandates-core (core: { kind, payload }), ERC-8004.
 */
import { ethers } from "ethers";
import type { Provider } from "ethers";

import { env } from "../config/env.js";
import type { MandatePayload, Receipt } from "../types/payload.js";
import type { Verifier, VerifierResult } from "./types.js";

/** Shape of mandate.core.payload for swap@1 (per QuillAI / mandate-specs) */
type SwapPayload = {
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  minAmountOut?: string;
  minOut?: string;
  maxSlippageBps?: number | string;
  chainId?: number;
  [k: string]: unknown;
};

const SWAP_KIND = "swap@1";
const FIELD_SCORE = 20;
const AMOUNT_SCORE = 30;
const CHAIN_SCORE = 20;
const EXECUTOR_SCORE = 20;

function getPayload(mandate: MandatePayload): SwapPayload {
  return (mandate.core?.payload ?? {}) as SwapPayload;
}

function getServerAddress(mandate: MandatePayload): string | null {
  const parts = mandate.server.split(":");
  const addr = parts[2] ?? "";
  try {
    return ethers.getAddress(addr);
  } catch {
    return null;
  }
}

/**
 * 3.2 On-chain transaction fetch: verify receipt exists, chainId matches, tx was mined (not reverted).
 * Returns mined receipt and executor (tx.from), or notes errors and returns null.
 */
async function fetchAndVerifyTransaction(
  provider: Provider,
  receipt: Receipt,
  notes: string[],
): Promise<{ receipt: ethers.TransactionReceipt; executor: string } | null> {
  let txReceipt: ethers.TransactionReceipt | null = null;
  try {
    txReceipt = await provider.getTransactionReceipt(receipt.txHash);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notes.push(`Failed to fetch transaction receipt: ${msg}`);
    return null;
  }

  if (!txReceipt) {
    notes.push("Transaction receipt not found (tx may be pending or not mined).");
    return null;
  }

  if (txReceipt.status !== 1) {
    notes.push("Transaction was reverted or failed (status !== 1).");
    return null;
  }

  const txReceiptChainId = (txReceipt as any).chainId ?? receipt.chainId;
  if (Number(txReceiptChainId) !== Number(receipt.chainId)) {
    notes.push(
      `Receipt chainId (${txReceiptChainId}) does not match expected chainId (${receipt.chainId}).`,
    );
    return null;
  }

  let executor: string;
  try {
    const tx = await provider.getTransaction(receipt.txHash);
    if (!tx?.from) {
      notes.push("Could not determine transaction sender (executor).");
      return null;
    }
    executor = ethers.getAddress(tx.from);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notes.push(`Failed to fetch transaction for executor: ${msg}`);
    return null;
  }

  return { receipt: txReceipt, executor };
}

/** 3.3 Token address match: 0–20 pts */
function evaluateTokenMatch(
  receipt: Receipt,
  payload: SwapPayload,
  notes: string[],
): number {
  const tokenInR = receipt.tokenIn;
  const tokenOutR = receipt.tokenOut;
  const tokenInP = payload.tokenIn;
  const tokenOutP = payload.tokenOut;

  if (!tokenInP || !tokenOutP) {
    notes.push("Mandate payload missing tokenIn or tokenOut for swap@1.");
    return 0;
  }

  if (!tokenInR || !tokenOutR) {
    notes.push(
      "Receipt missing tokenIn or tokenOut (decode swap tx and attach to receipt).",
    );
    return 0;
  }

  let score = FIELD_SCORE;
  try {
    const inMatch =
      ethers.getAddress(tokenInR) === ethers.getAddress(tokenInP);
    const outMatch =
      ethers.getAddress(tokenOutR) === ethers.getAddress(tokenOutP);
    if (!inMatch) {
      notes.push(`receipt.tokenIn (${tokenInR}) !== mandate.core.payload.tokenIn (${tokenInP}).`);
      score -= 10;
    }
    if (!outMatch) {
      notes.push(`receipt.tokenOut (${tokenOutR}) !== mandate.core.payload.tokenOut (${tokenOutP}).`);
      score -= 10;
    }
  } catch (e) {
    notes.push("Invalid token address format in receipt or payload.");
    return 0;
  }

  return Math.max(0, score);
}

/** 3.4 Amount constraints: 0–30 pts */
function evaluateAmountConstraints(
  receipt: Receipt,
  payload: SwapPayload,
  notes: string[],
): number {
  const amountInR = receipt.amountIn;
  const amountOutR = receipt.amountOut;
  const amountInP = payload.amountIn;
  const minOutP = payload.minAmountOut ?? payload.minOut;
  const maxSlippageBpsP = payload.maxSlippageBps;

  if (!amountInP) {
    notes.push("Mandate payload missing amountIn for swap@1.");
    return 0;
  }

  if (!amountInR || amountInR === "") {
    notes.push("Receipt missing amountIn (decode swap tx and attach to receipt).");
    return 0;
  }
  if (!amountOutR || amountOutR === "") {
    notes.push("Receipt missing amountOut (decode swap tx and attach to receipt).");
    return 0;
  }

  let score = AMOUNT_SCORE;
  try {
    const inR = BigInt(amountInR);
    const inP = BigInt(amountInP);
    if (inR > inP) {
      notes.push(
        `receipt.amountIn (${amountInR}) > mandate.core.payload.amountIn (${amountInP}); overspend.`,
      );
      score -= 15;
    }

    if (minOutP !== undefined && minOutP !== null && minOutP !== "") {
      const outR = BigInt(amountOutR);
      const minP = BigInt(String(minOutP));
      if (outR < minP) {
        notes.push(
          `receipt.amountOut (${amountOutR}) < mandate.core.payload.minAmountOut (${minOutP}); minimum output not met.`,
        );
        score -= 15;
      }
    }

    if (
      maxSlippageBpsP !== undefined &&
      maxSlippageBpsP !== null &&
      minOutP !== undefined &&
      minOutP !== null &&
      String(minOutP) !== ""
    ) {
      const expectedOut = BigInt(String(minOutP));
      const actualOut = BigInt(amountOutR);
      if (expectedOut > 0n) {
        const slippageBps =
          Number((expectedOut - actualOut) * 10000n / expectedOut);
        const maxBps = Number(maxSlippageBpsP);
        if (slippageBps > maxBps) {
          notes.push(
            `Slippage ${slippageBps} bps exceeds mandate maxSlippageBps ${maxBps}.`,
          );
          score -= 10;
        }
      }
    }
  } catch (e) {
    notes.push("Invalid amount format in receipt or payload (expected numeric strings).");
    return 0;
  }

  return Math.max(0, score);
}

/** 3.5 Chain match: 0–20 pts */
function evaluateChainMatch(
  receipt: Receipt,
  payload: SwapPayload,
  notes: string[],
): number {
  const chainIdP = payload.chainId;
  if (chainIdP === undefined || chainIdP === null) {
    notes.push("Mandate payload missing chainId for swap@1.");
    return 0;
  }

  if (Number(receipt.chainId) !== Number(chainIdP)) {
    notes.push(
      `receipt.chainId (${receipt.chainId}) !== mandate.core.payload.chainId (${chainIdP}).`,
    );
    return 0;
  }

  return CHAIN_SCORE;
}

/** 3.6 Executor address check: 0–20 pts */
function evaluateExecutorMatch(
  executorAddress: string,
  mandate: MandatePayload,
  notes: string[],
): number {
  const serverAddr = getServerAddress(mandate);
  if (!serverAddr) {
    notes.push("Invalid mandate.server (CAIP-10) for executor comparison.");
    return 0;
  }

  try {
    if (ethers.getAddress(executorAddress) !== serverAddr) {
      notes.push(
        `receipt.executorAddress (${executorAddress}) does not match mandate.server (${serverAddr}).`,
      );
      return 0;
    }
  } catch {
    notes.push("Invalid executor address format.");
    return 0;
  }

  return EXECUTOR_SCORE;
}

const VERIFIER_NAME = "Primitive Receipt";

export function createSwapReceiptVerifier(provider: Provider): Verifier {
  return {
    id: "primitive-receipt/v1",
    supportedKinds: ["*"],

    async verify(
      mandate: MandatePayload,
      receipt: Receipt,
    ): Promise<VerifierResult> {
      const notes: string[] = [];
      const kind = mandate.core?.kind ?? "unknown";

      if (kind !== SWAP_KIND) {
        notes.push(
          `Primitive receipt verification not implemented for kind "${kind}"; MVP supports ${SWAP_KIND}.`,
        );
        return {
          name: VERIFIER_NAME,
          score: 0,
          notes,
        };
      }

      const payload = getPayload(mandate);

      // 3.2 On-chain fetch and basic validity
      const onChain = await fetchAndVerifyTransaction(provider, receipt, notes);
      if (!onChain) {
        return {
          name: VERIFIER_NAME,
          score: 0,
          notes,
        };
      }

      const { executor } = onChain;
      const receiptWithExecutor: Receipt = {
        ...receipt,
        executorAddress: receipt.executorAddress ?? executor,
      };

      const tokenScore = evaluateTokenMatch(receiptWithExecutor, payload, notes);
      const amountScore = evaluateAmountConstraints(
        receiptWithExecutor,
        payload,
        notes,
      );
      const chainScore = evaluateChainMatch(receiptWithExecutor, payload, notes);
      const executorScore = evaluateExecutorMatch(
        receiptWithExecutor.executorAddress ?? executor,
        mandate,
        notes,
      );

      const score = Math.round(
        Math.max(
          0,
          Math.min(100, tokenScore + amountScore + chainScore + executorScore),
        ),
      );

      if (score === 100) {
        notes.push(`${SWAP_KIND} receipt verified successfully (100/100).`);
      }

      return {
        name: VERIFIER_NAME,
        score,
        notes,
      };
    },
  };
}

/** Default verifier using RPC from env (requires RPC_URL). Pass a provider to avoid loading env. */
let defaultVerifier: Verifier | null = null;

export function getSwapReceiptVerifier(provider?: Provider): Verifier {
  if (provider) {
    return createSwapReceiptVerifier(provider);
  }
  if (defaultVerifier) {
    return defaultVerifier;
  }
  try {
    const p = new ethers.JsonRpcProvider(env.RPC_URL);
    defaultVerifier = createSwapReceiptVerifier(p);
    return defaultVerifier;
  } catch {
    defaultVerifier = createSwapReceiptVerifier(
      new ethers.JsonRpcProvider("https://eth.llamarpc.com"),
    );
    return defaultVerifier;
  }
}

export default getSwapReceiptVerifier;
