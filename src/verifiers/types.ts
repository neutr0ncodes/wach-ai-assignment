import type { MandatePayload, Receipt } from "../types/payload.js";

export interface VerifierResult {
  name: string;
  score: number;
  notes: string[];
}

export interface Verifier {
  /**
   * Stable identifier for this verifier implementation.
   * Example: "mandate-integrity/v1"
   */
  id: string;

  /**
   * List of mandate core kinds this verifier supports.
   * Use ["*"] to indicate support for all kinds.
   */
  supportedKinds: string[];

  /**
   * Run verification logic against a mandate + receipt pair.
   */
  verify(mandate: MandatePayload, receipt: Receipt): Promise<VerifierResult>;
}
