import type { VerifierResult } from "../verifiers/types.js";

export interface DemoTrustEntry {
  requestHash: string;
  score: number;
  timestamp: number;
  kind: string;
  mandateId: string;
  breakdown: Array<{ name: string; score: number }>;
}

export interface DemoTrustData {
  agentId: string;
  validationCount: number;
  averageScore: number;
  latestScore: number;
  latestValidationAt: number;
  scoreHistory: DemoTrustEntry[];
}

const store = new Map<number, DemoTrustEntry[]>();

export function recordDemoValidation(params: {
  agentId: number;
  requestHash: string;
  score: number;
  kind: string;
  mandateId: string;
  breakdown: VerifierResult[];
}): void {
  const entry: DemoTrustEntry = {
    requestHash: params.requestHash,
    score: params.score,
    timestamp: Date.now(),
    kind: params.kind,
    mandateId: params.mandateId,
    breakdown: params.breakdown.map((b) => ({ name: b.name, score: b.score })),
  };

  const current = store.get(params.agentId) ?? [];
  current.push(entry);
  store.set(params.agentId, current);
}

export function getDemoTrustByAgentId(agentIdParam: string): DemoTrustData | null {
  const parsed = Number.parseInt(agentIdParam.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0) return null;

  const history = [...(store.get(parsed) ?? [])].sort((a, b) => a.timestamp - b.timestamp);
  if (history.length === 0) return null;

  const total = history.reduce((sum, item) => sum + item.score, 0);
  const latest = history[history.length - 1]!;

  return {
    agentId: String(parsed),
    validationCount: history.length,
    averageScore: Math.round((total / history.length) * 10) / 10,
    latestScore: latest.score,
    latestValidationAt: latest.timestamp,
    scoreHistory: history,
  };
}
