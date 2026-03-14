import { ethers } from "ethers";

import {
  ValidationRequestPayloadSchema,
  type ValidationRequestPayload,
} from "../types/payload.js";
import { logger } from "./logger.js";

const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

function resolveUri(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    return IPFS_GATEWAY + uri.slice("ipfs://".length);
  }
  return uri;
}

export async function fetchPayload(
  uri: string,
  expectedHash: string,
): Promise<ValidationRequestPayload> {
  const url = resolveUri(uri);
  logger.info({ url, expectedHash }, "Fetching validation request payload");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch payload from ${url}: ${res.status} ${res.statusText}`);
  }

  const bodyBytes = new Uint8Array(await res.arrayBuffer());
  const computedHash = ethers.sha256(bodyBytes);

  if (computedHash !== expectedHash) {
    throw new Error(
      `Hash mismatch: expected ${expectedHash}, got ${computedHash}`,
    );
  }

  const json: unknown = JSON.parse(new TextDecoder().decode(bodyBytes));
  return ValidationRequestPayloadSchema.parse(json);
}
