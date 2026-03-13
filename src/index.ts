// import { Mandate as CoreMandate, caip10 } from "@quillai-network/mandates-core";
// import { Wallet } from "ethers";

// import { mandateIntegrityVerifier } from "./verifiers/mandateIntegrity.js";
// import type { MandatePayload, Receipt } from "./types/payload.js";

// async function main() {
//   const now = new Date();
//   const deadline = new Date(now.getTime() + 60 * 60 * 1000); // +1 hour

//   // Create real client/server wallets with ethers.
//   const clientWallet = Wallet.createRandom();
//   const serverWallet = Wallet.createRandom();

//   // Build a Mandate using the official SDK so that signatures are canonical.
//   const coreMandate = new CoreMandate({
//     mandateId: "test-mandate-1",
//     version: "0.1.0",
//     client: caip10(1, clientWallet.address),
//     server: caip10(1, serverWallet.address),
//     createdAt: now.toISOString(),
//     deadline: deadline.toISOString(),
//     intent: "Test mandate integrity verifier with real signatures",
//     core: {
//       kind: "swap@1",
//       payload: {
//         // Minimal payload for this test; router/other verifiers will care about structure.
//       },
//     },
//     signatures: {},
//   });

//   // Sign as server (offer) and then as client (accept) using EIP-191.
//   await coreMandate.signAsServer(serverWallet, "eip191");
//   await coreMandate.signAsClient(clientWallet, "eip191");

//   // Convert to plain JSON that matches our MandatePayload shape.
//   const mandate = coreMandate.toJSON() as MandatePayload;

//   const receipt: Receipt = {
//     txHash: "0x" + "0".repeat(64),
//     chainId: 1,
//   };

//   const goodResult = await mandateIntegrityVerifier.verify(mandate, receipt);

//   // eslint-disable-next-line no-console
//   console.log("Client address:", clientWallet.address);
//   // eslint-disable-next-line no-console
//   console.log("Server address:", serverWallet.address);
//   // eslint-disable-next-line no-console
//   console.log(
//     "Mandate Integrity Verifier Result (good mandate):",
//     JSON.stringify(goodResult, null, 2),
//   );

//   // --- Second test: clearly invalid / expired mandate should have a low score (< 30) ---
//   const pastDeadline = new Date(now.getTime() - 60 * 60 * 1000); // 1h in the past

//   const badMandate: MandatePayload = {
//     mandateId: "test-mandate-bad-1",
//     // version is fixed to 0.1.0 by schema, but we include it explicitly for clarity.
//     version: "0.1.0",
//     client: caip10(1, clientWallet.address),
//     server: caip10(1, serverWallet.address),
//     createdAt: now.toISOString(),
//     deadline: pastDeadline.toISOString(),
//     intent: "This mandate should be scored very low (expired + no signatures).",
//     core: {
//       kind: "swap@1",
//       payload: {},
//     },
//     signatures: {},
//   };

//   const badResult = await mandateIntegrityVerifier.verify(badMandate, receipt);

//   // eslint-disable-next-line no-console
//   console.log(
//     "Mandate Integrity Verifier Result (bad mandate – expected < 30):",
//     JSON.stringify(badResult, null, 2),
//   );
// }

// void main();

