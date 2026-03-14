import express from "express";
import type { Request, Response } from "express";

import { env } from "../config/env.js";
import type { VerifierResult } from "../verifiers/types.js";
import { fetchPayload } from "./fetchPayload.js";
import { logger } from "./logger.js";
import { buildResponse, buildResponseUri } from "./responseBuilder.js";
import { submitValidationResponse } from "./submitResponse.js";
import { aggregateScores, getVerifiersForKind } from "./verifierRegistry.js";

// 4.9 — Request deduplication
const processedRequests = new Set<string>();

async function handleValidation(
  requestHash: string,
  requestURI: string,
): Promise<void> {
  const log = logger.child({ requestHash });

  try {
    // 4.3 — Fetch and verify payload
    const payload = await fetchPayload(requestURI, requestHash);
    const { agentId, mandate, receipt } = payload;
    const kind = mandate.core?.kind ?? "unknown";

    log.info({ agentId, kind, mandateId: mandate.mandateId }, "Processing validation request");

    // 4.5 — Route to verifiers by kind
    const verifiers = getVerifiersForKind(kind);
    if (verifiers.length === 0) {
      log.warn({ kind }, "No verifiers found for kind");
      return;
    }

    // Run all verifiers concurrently
    const results: VerifierResult[] = await Promise.all(
      verifiers.map((v) =>
        v.verify(mandate, receipt).catch((err): VerifierResult => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ verifier: v.id, error: msg }, "Verifier threw an error");
          return { name: v.id, score: 0, notes: [`Verifier error: ${msg}`] };
        }),
      ),
    );

    // 4.6 — Aggregate
    const finalScore = aggregateScores(results);

    // 4.7 — Build response payload
    const response = buildResponse(finalScore, results, mandate.mandateId, agentId);
    const { uri: responseURI, hash: responseHash } = buildResponseUri(response);

    log.info(
      {
        agentId,
        kind,
        mandateId: mandate.mandateId,
        finalScore,
        breakdown: results.map((r) => ({ name: r.name, score: r.score })),
      },
      "Validation complete",
    );

    // 4.8 — Submit to ERC-8004 Validation Registry
    const txHash = await submitValidationResponse(
      requestHash,
      finalScore,
      responseURI,
      responseHash,
      kind,
    );

    log.info({ txHash, finalScore }, "Response submitted to Validation Registry");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "Validation request processing failed");
  }
}

// 4.1 — Express HTTP service
const app = express();
app.use(express.json());

// 4.2 — POST /validate
app.post("/validate", (req: Request, res: Response) => {
  const { requestHash, requestURI } = req.body as {
    requestHash?: string;
    requestURI?: string;
  };

  if (!requestHash || !requestURI) {
    res.status(400).json({ error: "Missing requestHash or requestURI" });
    return;
  }

  // 4.9 — Deduplication
  if (processedRequests.has(requestHash)) {
    logger.info({ requestHash }, "Duplicate request, skipping");
    res.status(200).json({ status: "already_processed", requestHash });
    return;
  }

  processedRequests.add(requestHash);

  // Return 202 immediately, process asynchronously
  res.status(202).json({ status: "accepted", requestHash });

  void handleValidation(requestHash, requestURI);
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", router: env.ROUTER_ADDRESS ?? "not configured" });
});

app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, router: env.ROUTER_ADDRESS },
    "Router service started",
  );
});

export { app };
