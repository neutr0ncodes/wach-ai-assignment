import { Mandate as CoreMandate } from "@quillai-network/mandates-core";
import type { MandatePayload, Receipt } from "../types/payload.js";
import type { Verifier, VerifierResult } from "./types.js";

function evaluateSignaturesWithSdk(
  mandate: MandatePayload,
  notes: string[],
): number {
  if (!mandate.signatures?.clientSig && !mandate.signatures?.serverSig) {
    notes.push("Missing both client and server signatures.");
    return 0;
  }

  let mandateInstance: CoreMandate;
  try {
    mandateInstance = new CoreMandate(mandate as unknown as ConstructorParameters<
      typeof CoreMandate
    >[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notes.push(`Failed to construct Mandate via mandates-core SDK: ${msg}`);
    return 0;
  }

  const verification = mandateInstance.verifyAll() as any;

  const clientOk: boolean = !!verification.client?.ok;
  const serverOk: boolean = !!verification.server?.ok;

  if (!clientOk && !serverOk) {
    notes.push("Both client and server signatures failed verification (mandates-core).");

    const clientReason = verification.client?.reason ?? verification.client?.error;
    const serverReason = verification.server?.reason ?? verification.server?.error;
    if (clientReason) {
      notes.push(`Client signature error: ${String(clientReason)}`);
    }
    if (serverReason) {
      notes.push(`Server signature error: ${String(serverReason)}`);
    }

    return 0;
  }

  let score = 100;

  if (!clientOk) {
    score -= 40;
    notes.push("Client signature failed verification (mandates-core).");
    const clientReason = verification.client?.reason ?? verification.client?.error;
    if (clientReason) {
      notes.push(`Client signature error: ${String(clientReason)}`);
    }
  }

  if (!serverOk) {
    score -= 40;
    notes.push("Server signature failed verification (mandates-core).");
    const serverReason = verification.server?.reason ?? verification.server?.error;
    if (serverReason) {
      notes.push(`Server signature error: ${String(serverReason)}`);
    }
  }

  return Math.max(0, Math.min(100, score));
}

function evaluateDeadline(mandate: MandatePayload, notes: string[]): number {
  let score = 100;

  const now = new Date();
  const createdAt = new Date(mandate.createdAt);
  const deadline = new Date(mandate.deadline);

  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(deadline.getTime())) {
    notes.push("createdAt or deadline is not a valid ISO timestamp.");
    return 0;
  }

  if (deadline <= createdAt) {
    notes.push("deadline is not after createdAt.");
    score -= 50;
  }

  if (deadline <= now) {
    notes.push("Mandate has expired (deadline is in the past).");
    score -= 70;
  }

  // Soft check: mandates created far in the future are suspicious.
  if (createdAt.getTime() - now.getTime() > 60 * 60 * 1000) {
    notes.push("createdAt is more than 1 hour in the future.");
    score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

export const mandateIntegrityVerifier: Verifier = {
  id: "mandate-integrity/v1",
  supportedKinds: ["*"],

  async verify(mandate: MandatePayload, _receipt: Receipt): Promise<VerifierResult> {
    const notes: string[] = [];

    if (!mandate.mandateId || !mandate.intent || !mandate.core?.kind) {
      notes.push("Mandate is missing one or more required core attributes.");
    }

    const deadlineScore = evaluateDeadline(mandate, notes);
    const sigScore = evaluateSignaturesWithSdk(mandate, notes);

    // Combine the two dimensions with equal weight.
    const score = Math.round((deadlineScore + sigScore) / 2);

    return {
      name: "Mandate Integrity",
      score,
      notes,
    };
  },
};

export default mandateIntegrityVerifier;

