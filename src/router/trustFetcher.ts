import { ethers } from "ethers";

import { getRegistryContract } from "../contracts/ValidationRegistry.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export interface TrustScoreEntry {
  score: number;
  timestamp: number;
  requestId: string;
}

export interface TrustData {
  agentId: string;
  validationCount: number;
  averageScore: number;
  latestScore: number;
  latestValidationAt: number;
  scoreHistory: TrustScoreEntry[];
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<
  string,
  { data: TrustData; fetchedAt: number }
>();

function parseAgentId(agentId: string): bigint {
  const trimmed = agentId.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return BigInt(trimmed);
  }
  return BigInt(trimmed);
}

function buildTrustData(agentIdStr: string, scoreHistory: TrustScoreEntry[]): TrustData {
  scoreHistory.sort((a, b) => a.timestamp - b.timestamp);
  const validationCount = scoreHistory.length;
  const averageScore =
    validationCount === 0
      ? 0
      : scoreHistory.reduce((s, e) => s + e.score, 0) / validationCount;
  const latest = scoreHistory[scoreHistory.length - 1];
  const latestScore = latest?.score ?? 0;
  const latestValidationAt = latest?.timestamp ?? 0;
  return {
    agentId: agentIdStr,
    validationCount,
    averageScore: Math.round(averageScore * 10) / 10,
    latestScore,
    latestValidationAt,
    scoreHistory,
  };
}

/**
 * Fetch trust/reputation data for an agent from the ValidationRegistry contract
 * state (getAgentValidations + getValidationStatus). This reads the canonical
 * on-chain data and is not limited by block lookback. Results are cached for
 * CACHE_TTL_MS.
 */
export async function fetchTrustByAgentId(agentIdParam: string): Promise<TrustData | null> {
  const agentIdStr = agentIdParam.trim();
  if (!agentIdStr) return null;

  let agentId: bigint;
  try {
    agentId = parseAgentId(agentIdStr);
  } catch {
    return null;
  }

  const cacheKey = agentId.toString();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  if (!env.RPC_URL || !env.REGISTRY_ADDRESS) {
    logger.warn("Trust fetcher: RPC_URL or REGISTRY_ADDRESS not set");
    return null;
  }

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const registry = getRegistryContract(env.REGISTRY_ADDRESS, provider);

  try {
    const requestHashes = await registry["getAgentValidations"]!(agentId) as string[];
    const scoreHistory: TrustScoreEntry[] = [];

    for (const requestHash of requestHashes) {
      try {
        const status = await registry["getValidationStatus"]!(requestHash);
        const response = Number(status[2]);
        const lastUpdate = status[5] as bigint;
        const timestamp = Number(lastUpdate);
        scoreHistory.push({
          score: response,
          timestamp,
          requestId: requestHash,
        });
      } catch {
        // Skip if getValidationStatus fails (e.g. unknown request)
      }
    }

    const data = buildTrustData(agentIdStr, scoreHistory);
    cache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ agentId: agentIdStr, error: msg }, "Trust fetch failed");
    return null;
  }
}

/**
 * Return a Shields.io-compatible badge color from a score (0–100).
 */
export function badgeColorForScore(score: number): string {
  if (score >= 80) return "green";
  if (score >= 50) return "yellow";
  if (score >= 20) return "orange";
  return "red";
}
