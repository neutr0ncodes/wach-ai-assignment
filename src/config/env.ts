import "dotenv/config";
import { z } from "zod";
import { ethers } from "ethers";

const envSchema = z.object({
  RPC_URL: z.string().url(),
  PRIVATE_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ROUTER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  PORT: z.string().regex(/^\d+$/).optional(),
});

const parsed = envSchema.parse(process.env);

const routerAddress =
  parsed.ROUTER_ADDRESS ??
  new ethers.Wallet(parsed.PRIVATE_KEY).address;

export const env = {
  RPC_URL: parsed.RPC_URL,
  PRIVATE_KEY: parsed.PRIVATE_KEY,
  REGISTRY_ADDRESS: parsed.REGISTRY_ADDRESS,
  ROUTER_ADDRESS: routerAddress,
  PORT: parseInt(parsed.PORT ?? "3000", 10),
} as const;
