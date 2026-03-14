import { ethers } from "ethers";

import type { VerifierResult } from "../verifiers/types.js";

export interface ValidationResponse {
  finalScore: number;
  breakdown: VerifierResult[];
  mandateId: string;
  agentId: number;
  timestamp: string;
}

export function buildResponse(
  finalScore: number,
  breakdown: VerifierResult[],
  mandateId: string,
  agentId: number,
): ValidationResponse {
  return {
    finalScore,
    breakdown,
    mandateId,
    agentId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Serializes the response and returns { uri, hash }.
 * MVP: returns a data URI containing the JSON. Replace with IPFS upload in production.
 */
export function buildResponseUri(response: ValidationResponse): {
  uri: string;
  hash: string;
} {
  const json = JSON.stringify(response);
  const bytes = new TextEncoder().encode(json);
  const hash = ethers.sha256(bytes);
  const uri = `data:application/json;base64,${Buffer.from(bytes).toString("base64")}`;
  return { uri, hash };
}
