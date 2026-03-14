import "dotenv/config";
import { z } from "zod";
import { ethers } from "ethers";

function emptyStringToUndefined(val: unknown): unknown {
  return typeof val === "string" && val.trim() === "" ? undefined : val;
}

const envSchema = z.object({
  RPC_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  PRIVATE_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  ),
  REGISTRY_ADDRESS: z.preprocess(
    emptyStringToUndefined,
    z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ),
  ROUTER_ADDRESS: z.preprocess(
    emptyStringToUndefined,
    z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ),
  PORT: z.preprocess(
    emptyStringToUndefined,
    z.string().regex(/^\d+$/).optional(),
  ),
});

const parsed = envSchema.parse(process.env);

const defaultRpc = "https://eth.llamarpc.com";
const routerAddress =
  parsed.ROUTER_ADDRESS ??
  (parsed.PRIVATE_KEY
    ? new ethers.Wallet(parsed.PRIVATE_KEY).address
    : undefined);

export const env = {
  RPC_URL: parsed.RPC_URL ?? defaultRpc,
  PRIVATE_KEY: parsed.PRIVATE_KEY,
  REGISTRY_ADDRESS: parsed.REGISTRY_ADDRESS,
  ROUTER_ADDRESS: routerAddress,
  PORT: parseInt(parsed.PORT ?? "3000", 10),
} as const;
