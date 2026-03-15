import express from "express";
import type { Request, Response } from "express";
import { Mandate as CoreMandate, caip10 } from "@quillai-network/mandates-core";
import { ethers, Wallet } from "ethers";

import { env } from "./config/env.js";
import { ValidationPoller } from "./contracts/poller.js";
import type { VerifierResult } from "./verifiers/types.js";
import { fetchPayload } from "./router/fetchPayload.js";
import { logger } from "./router/logger.js";
import { buildResponse, buildResponseUri } from "./router/responseBuilder.js";
import { submitValidationResponse } from "./router/submitResponse.js";
import { aggregateScores, getVerifiersForKind } from "./router/verifierRegistry.js";

const processedRequests = new Set<string>();

async function handleValidation(
  requestHash: string,
  requestURI: string,
): Promise<void> {
  const log = logger.child({ requestHash });

  try {
    const payload = await fetchPayload(requestURI, requestHash);
    const { agentId, mandate, receipt } = payload;
    const kind = mandate.core?.kind ?? "unknown";

    log.info({ agentId, kind, mandateId: mandate.mandateId }, "Processing validation request");

    const verifiers = getVerifiersForKind(kind);
    if (verifiers.length === 0) {
      log.warn({ kind }, "No verifiers found for kind");
      return;
    }

    const results: VerifierResult[] = await Promise.all(
      verifiers.map((v) =>
        v.verify(mandate, receipt).catch((err): VerifierResult => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ verifier: v.id, error: msg }, "Verifier threw an error");
          return { name: v.id, score: 0, notes: [`Verifier error: ${msg}`] };
        }),
      ),
    );

    const finalScore = aggregateScores(results);

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

const app = express();
app.use(express.json());

// POST /validate — accepts validation requests from ERC-8004
app.post("/validate", (req: Request, res: Response) => {
  const { requestHash, requestURI } = req.body as {
    requestHash?: string;
    requestURI?: string;
  };

  if (!requestHash || !requestURI) {
    res.status(400).json({ error: "Missing requestHash or requestURI" });
    return;
  }

  if (processedRequests.has(requestHash)) {
    logger.info({ requestHash }, "Duplicate request, skipping");
    res.status(200).json({ status: "already_processed", requestHash });
    return;
  }

  processedRequests.add(requestHash);

  res.status(202).json({ status: "accepted", requestHash });

  void handleValidation(requestHash, requestURI);
});

// GET /health — liveness check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", router: env.ROUTER_ADDRESS ?? "not configured" });
});

// Cached test payload so the hash stays stable across requests
let cachedTestPayload: { json: string; hash: string } | null = null;

async function getOrBuildTestPayload(): Promise<{ json: string; hash: string }> {
  if (cachedTestPayload) return cachedTestPayload;

  const now = new Date();
  const deadline = new Date(now.getTime() + 60 * 60 * 1000);
  const clientWallet = Wallet.createRandom();
  const serverWallet = Wallet.createRandom();

  const mandate = new CoreMandate({
    mandateId: "postman-test-mandate-1",
    version: "0.1.0",
    client: caip10(1, clientWallet.address),
    server: caip10(1, serverWallet.address),
    createdAt: now.toISOString(),
    deadline: deadline.toISOString(),
    intent: "Swap 100 USDC for WBTC (Postman test)",
    core: {
      kind: "swap@1",
      payload: {
        tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        tokenOut: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        amountIn: "100000000",
        minOut: "165000",
        chainId: 1,
      },
    },
    signatures: {},
  });

  await mandate.signAsServer(serverWallet, "eip191");
  await mandate.signAsClient(clientWallet, "eip191");

  const payload = {
    agentId: 1,
    mandate: mandate.toJSON(),
    receipt: {
      txHash: "0x" + "ab".repeat(32),
      chainId: 1,
      executedAt: now.toISOString(),
    },
  };

  const json = JSON.stringify(payload);
  const hash = ethers.sha256(new TextEncoder().encode(json));
  cachedTestPayload = { json, hash };
  return cachedTestPayload;
}

// GET /test-payload — serves a pre-built signed test payload (for Postman testing)
app.get("/test-payload", async (_req: Request, res: Response) => {
  const { json } = await getOrBuildTestPayload();
  res.set("Content-Type", "application/json");
  res.send(json);
});

// GET /test-hash — returns the requestHash + requestURI ready for POST /validate
app.get("/test-hash", async (_req: Request, res: Response) => {
  const { hash } = await getOrBuildTestPayload();
  res.json({
    requestHash: hash,
    requestURI: `http://localhost:${env.PORT}/test-payload`,
  });
});

app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, router: env.ROUTER_ADDRESS },
    "Router service started",
  );
});

// --- On-chain poller (5.3 / 5.4) ---
if (env.RPC_URL && env.REGISTRY_ADDRESS && env.ROUTER_ADDRESS) {
  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const poller = new ValidationPoller(provider, env.REGISTRY_ADDRESS, env.ROUTER_ADDRESS);

  poller.onRequest((req) => {
    if (processedRequests.has(req.requestHash)) return;
    processedRequests.add(req.requestHash);
    void handleValidation(req.requestHash, req.requestURI);
  });

  poller
    .start(env.POLL_INTERVAL_MS)
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ error: msg }, "Failed to start validation poller");
    });
} else {
  logger.warn(
    "On-chain poller disabled: set RPC_URL, REGISTRY_ADDRESS, and ROUTER_ADDRESS to enable",
  );
}

export { app };
