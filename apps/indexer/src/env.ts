import { z } from "zod";

/**
 * Indexer configuration.
 *
 * Validated at startup so a misconfiguration fails immediately and loudly, rather than
 * silently indexing the wrong chain or writing to the wrong database.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  SEPOLIA_RPC_URL: z.string().url().default("https://ethereum-sepolia-rpc.publicnode.com"),

  /** Contract to index. Falls back to the generated deployment record. */
  SABLE_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),

  /** Block to start from. Defaults to the deployment block. */
  START_BLOCK: z.coerce.number().int().nonnegative().optional(),

  /** Blocks per `getLogs` request. Public endpoints commonly cap this around 10k. */
  BLOCK_RANGE: z.coerce.number().int().positive().default(5_000),

  /** Seconds between polls. */
  POLL_INTERVAL: z.coerce.number().int().positive().default(15),

  PORT: z.coerce.number().int().positive().default(4000),

  /** Confirmations to wait before treating a block as final. */
  CONFIRMATIONS: z.coerce.number().int().nonnegative().default(2),
});

export type IndexerEnv = z.infer<typeof schema>;

export function loadEnv(): IndexerEnv {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid indexer configuration:\n${issues}`);
  }

  return parsed.data;
}
