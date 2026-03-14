import type { Verifier, VerifierResult } from "../verifiers/types.js";
import { mandateIntegrityVerifier } from "../verifiers/mandateIntegrity.js";
import { getSwapReceiptVerifier } from "../verifiers/swapReceiptVerifier.js";

const verifierRegistry = new Map<string, Verifier>();

verifierRegistry.set("mandateIntegrity", mandateIntegrityVerifier);
verifierRegistry.set("primitiveReceipt", getSwapReceiptVerifier());

export { verifierRegistry };

export function getVerifiersForKind(kind: string): Verifier[] {
  return [...verifierRegistry.values()].filter(
    (v) => v.supportedKinds.includes("*") || v.supportedKinds.includes(kind),
  );
}

const HARD_FAIL_THRESHOLD = 10;
const HARD_FAIL_CAP = 30;

export function aggregateScores(results: VerifierResult[]): number {
  if (results.length === 0) return 0;

  const hasHardFail = results.some((r) => r.score <= HARD_FAIL_THRESHOLD);
  const avg = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const score = Math.round(avg);

  if (hasHardFail) {
    return Math.min(score, HARD_FAIL_CAP);
  }

  return score;
}
