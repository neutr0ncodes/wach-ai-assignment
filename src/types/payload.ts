import { z } from "zod";

const hexString = z.string().regex(/^0x[0-9a-fA-F]+$/);
const caip10 = z.string().regex(/^eip155:\d+:0x[0-9a-fA-F]{40}$/);
const isoDate = z.string().datetime({ offset: true });

const SignatureSchema = z.object({
  alg: z.enum(["eip191", "eip712"]),
  signer: caip10.optional(),
  chainId: z.number().optional(),
  domain: z.record(z.string(), z.unknown()).optional(),
  mandateHash: hexString,
  signature: hexString,
  createdAt: isoDate.optional(),
});

const CoreSchema = z.object({
  kind: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

const MandateSchema = z.object({
  mandateId: z.string().min(1),
  // Mandate document/schema version – mandates-core currently expects 0.1.0
  version: z.literal("0.1.0").default("0.1.0"),
  client: caip10,
  server: caip10,
  createdAt: isoDate,
  deadline: isoDate,
  intent: z.string(),
  core: CoreSchema,
  signatures: z.object({
    clientSig: SignatureSchema,
    serverSig: SignatureSchema,
  }).partial(),
});

const ReceiptSchema = z.object({
  txHash: hexString,
  chainId: z.number().int().positive(),
  executedAt: isoDate,
  // Optional swap@1 decoded fields (populated by router or verifier from on-chain tx)
  tokenIn: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  tokenOut: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  amountIn: z.string().optional(),
  amountOut: z.string().optional(),
  executorAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

export const ValidationRequestPayloadSchema = z.object({
  agentId: z.number().int().nonnegative(),
  mandate: MandateSchema,
  receipt: ReceiptSchema,
});

export type ValidationRequestPayload = z.infer<typeof ValidationRequestPayloadSchema>;
export type MandatePayload = z.infer<typeof MandateSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type Core = z.infer<typeof CoreSchema>;
