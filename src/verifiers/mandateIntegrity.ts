import { Mandate as CoreMandate } from "@quillai-network/mandates-core";
import { ethers } from "ethers";

import type { MandatePayload, Receipt } from "../types/payload.js";
import type { Verifier, VerifierResult } from "./types.js";

function evaluateRequiredFields(
  mandate: MandatePayload,
  notes: string[],
): number {
  let score = 20;

  const missing: string[] = [];
  if (!mandate.mandateId) missing.push("mandateId");
  if (!mandate.intent) missing.push("intent");
  if (!mandate.client) missing.push("client");
  if (!mandate.server) missing.push("server");
  if (!mandate.createdAt) missing.push("createdAt");
  if (!mandate.deadline) missing.push("deadline");
  if (!mandate.core) missing.push("core");
  if (!mandate.core?.kind) missing.push("core.kind");

  if (missing.length > 0) {
    notes.push(`Missing required mandate fields: ${missing.join(", ")}.`);
    score -= Math.min(20, missing.length * 3);
  }

  const kind = mandate.core?.kind ?? "";
  const kindPattern = /^[a-z0-9_-]+@\d+$/i;
  if (!kindPattern.test(kind)) {
    notes.push(
      `core.kind "${kind}" does not match expected <primitive>@<version> format (e.g., swap@1).`,
    );
    score -= 5;
  }

  const invalidAddresses: string[] = [];
  try {
    const clientParts = mandate.client.split(":");
    const clientAddr = clientParts[2] ?? "";
    ethers.getAddress(clientAddr);
  } catch {
    invalidAddresses.push("clientAddress");
  }

  try {
    const serverParts = mandate.server.split(":");
    const serverAddr = serverParts[2] ?? "";
    ethers.getAddress(serverAddr);
  } catch {
    invalidAddresses.push("serverAddress");
  }

  if (invalidAddresses.length > 0) {
    notes.push(
      `Invalid Ethereum ${invalidAddresses.join(
        " & ",
      )} extracted from CAIP-10 client/server identifiers.`,
    );
    score -= 5;
  }

  return Math.max(0, Math.min(20, score));
}

function verifyRoleWithSdk(
  mandate: MandatePayload,
  role: "client" | "server",
  notes: string[],
): { ok: boolean; reason?: string } {
  if (!mandate.signatures?.clientSig && !mandate.signatures?.serverSig) {
    notes.push("Missing both client and server signatures.");
    return { ok: false, reason: "missing_signatures" };
  }

  let mandateInstance: CoreMandate;
  try {
    mandateInstance = new CoreMandate(mandate as unknown as ConstructorParameters<
      typeof CoreMandate
    >[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notes.push(`Failed to construct Mandate via mandates-core SDK: ${msg}`);
    return { ok: false, reason: msg };
  }

  const res = (mandateInstance as any).verifyRole?.(role) ?? {};
  if (typeof res === "boolean") {
    return { ok: res };
  }

  return { ok: !!res.ok, reason: res.reason ?? res.error };
}

function evaluateTypedSignature(
  sig: any,
  expectedAddress: string,
  roleLabel: "client" | "server",
  notes: string[],
): { ok: boolean } {
  if (!sig) {
    notes.push(`Missing ${roleLabel} signature.`);
    return { ok: false };
  }

  if (sig.alg !== "eip712") {
    // Not EIP-712 – let the SDK handle it as a fallback elsewhere.
    return { ok: false };
  }

  const wrapper = sig.domain as any;
  const domain = wrapper?.domain;
  const types = wrapper?.types;
  const value = wrapper?.value;

  if (!domain || !types || !value) {
    notes.push(
      `${roleLabel} signature is marked as eip712 but is missing domain/types/value for typed-data verification.`,
    );
    return { ok: false };
  }

  try {
    const recovered = ethers.verifyTypedData(domain, types, value, sig.signature);
    if (ethers.getAddress(recovered) !== ethers.getAddress(expectedAddress)) {
      notes.push(
        `${roleLabel} EIP-712 signature recovered address ${recovered} does not match expected ${expectedAddress}.`,
      );
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notes.push(`${roleLabel} EIP-712 signature verification failed: ${msg}`);
    return { ok: false };
  }
}

function evaluateClientSignature(mandate: MandatePayload, notes: string[]): number {
  let score = 30;

  const sig = mandate.signatures?.clientSig as any;
  const clientParts = mandate.client.split(":");
  const expected = clientParts[2] ?? "";

  const typedRes = evaluateTypedSignature(sig, expected, "client", notes);
  if (typedRes.ok) {
    return score;
  }

  // Fallback to SDK-based verification (EIP-191 or any other scheme).
  const sdkRes = verifyRoleWithSdk(mandate, "client", notes);
  if (!sdkRes.ok) {
    score = 0;
    if (sdkRes.reason) {
      notes.push(`Client signature failed via mandates-core: ${sdkRes.reason}`);
    }
  }

  return Math.max(0, Math.min(30, score));
}

function evaluateServerSignature(mandate: MandatePayload, notes: string[]): number {
  let score = 30;

  const sig = mandate.signatures?.serverSig as any;
  const serverParts = mandate.server.split(":");
  const expected = serverParts[2] ?? "";

  const typedRes = evaluateTypedSignature(sig, expected, "server", notes);
  if (typedRes.ok) {
    return score;
  }

  const sdkRes = verifyRoleWithSdk(mandate, "server", notes);
  if (!sdkRes.ok) {
    score = 0;
    if (sdkRes.reason) {
      notes.push(`Server signature failed via mandates-core: ${sdkRes.reason}`);
    }
  }

  return Math.max(0, Math.min(30, score));
}

function evaluateDeadline(
  mandate: MandatePayload,
  receipt: Receipt,
  notes: string[],
): number {
  let score = 20;

  const createdAt = new Date(mandate.createdAt);
  const deadline = new Date(mandate.deadline);
  const executedAt = new Date(receipt.executedAt);

  if (
    Number.isNaN(createdAt.getTime()) ||
    Number.isNaN(deadline.getTime()) ||
    Number.isNaN(executedAt.getTime())
  ) {
    notes.push("createdAt, deadline, or receipt.executedAt is not a valid ISO timestamp.");
    return 0;
  }

  if (deadline <= createdAt) {
    notes.push("deadline is not after createdAt.");
    score -= 10;
  }

  // Receipt must be submitted/executed before mandate expiry.
  if (executedAt > deadline) {
    notes.push("Receipt was executed after the mandate deadline (expired mandate).");
    score -= 10;
  }

  // Penalize executions that happen very close to the deadline.
  const NEAR_DEADLINE_MS = 5 * 60 * 1000; // 5 minutes
  const timeToDeadline = deadline.getTime() - executedAt.getTime();
  if (timeToDeadline >= 0 && timeToDeadline <= NEAR_DEADLINE_MS) {
    notes.push(
      "Execution happened very close to the mandate deadline (within 5 minutes threshold).",
    );
    score -= 5;
  }

  // Soft check: mandates created far in the future relative to execution are suspicious.
  if (createdAt.getTime() - executedAt.getTime() > 60 * 60 * 1000) {
    notes.push("createdAt is more than 1 hour after receipt.executedAt.");
    score -= 5;
  }

  return Math.max(0, Math.min(20, score));
}

export const mandateIntegrityVerifier: Verifier = {
  id: "mandate-integrity/v1",
  supportedKinds: ["*"],

  async verify(mandate: MandatePayload, receipt: Receipt): Promise<VerifierResult> {
    const notes: string[] = [];

    // Spec: finalScore = fieldScore + deadlineScore + clientSigScore + serverSigScore (20/20/30/30)
    const fieldScore = evaluateRequiredFields(mandate, notes); // 0–20
    const deadlineScore = evaluateDeadline(mandate, receipt, notes); // 0–20
    const clientSigScore = evaluateClientSignature(mandate, notes); // 0–30
    const serverSigScore = evaluateServerSignature(mandate, notes); // 0–30

    const score = Math.round(
      Math.max(
        0,
        Math.min(100, fieldScore + deadlineScore + clientSigScore + serverSigScore),
     ),
    );

    if (score > 80) {
      notes.push(`Mandate integrity verified successfully with a perfect score (${score}/100).`);
    }

    return {
      name: "Mandate Integrity",
      score,
      notes,
    };
  },
};

export default mandateIntegrityVerifier;

