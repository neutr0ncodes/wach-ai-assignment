import { ethers } from "ethers";

import { env } from "../config/env.js";
import { getRegistryContract } from "../contracts/ValidationRegistry.js";
import { logger } from "./logger.js";

let nonce: number | null = null;

async function getNextNonce(wallet: ethers.Wallet): Promise<number> {
  if (nonce === null) {
    nonce = await wallet.getNonce();
  } else {
    nonce += 1;
  }
  return nonce;
}

export async function submitValidationResponse(
  requestHash: string,
  score: number,
  responseURI: string,
  responseHash: string,
  tag: string,
): Promise<string> {
  if (!env.PRIVATE_KEY || !env.REGISTRY_ADDRESS) {
    logger.warn("PRIVATE_KEY or REGISTRY_ADDRESS not set; skipping on-chain submission.");
    return "0x(skipped)";
  }

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
  const registry = getRegistryContract(env.REGISTRY_ADDRESS, wallet);

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  const MAX_RETRIES = 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const txNonce = await getNextNonce(wallet);
      const gasEstimate = await registry.validationResponse!.estimateGas(
        requestHash,
        clampedScore,
        responseURI,
        responseHash,
        tag,
      );

      const tx = await registry.validationResponse!(
        requestHash,
        clampedScore,
        responseURI,
        responseHash,
        tag,
        { nonce: txNonce, gasLimit: (gasEstimate * 120n) / 100n },
      );

      logger.info(
        { txHash: tx.hash, requestHash, score: clampedScore, attempt },
        "validationResponse tx sent",
      );

      const receipt = await tx.wait();
      logger.info(
        { txHash: tx.hash, blockNumber: receipt?.blockNumber },
        "validationResponse tx confirmed",
      );

      return tx.hash as string;
    } catch (err) {
      lastError = err;
      nonce = null;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ attempt, error: msg }, "validationResponse tx failed, retrying");
    }
  }

  throw lastError;
}
