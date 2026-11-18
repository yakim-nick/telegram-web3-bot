/** Configuration from environment variables, validated once at startup. */
import { z } from 'zod';

const url = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), 'must be an http(s) URL');

const schema = z.object({
  BOT_TOKEN: z
    .string({ error: 'BOT_TOKEN is required (create a bot with @BotFather)' })
    .regex(/^\d+:[\w-]{20,}$/, 'BOT_TOKEN does not look like a Telegram bot token'),
  ETH_RPC_URL: url.default('https://ethereum-rpc.publicnode.com'),
  PRICE_API_URL: url.default('https://api.coingecko.com/api/v3'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(20),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8000),
});

export type Config = z.infer<typeof schema>;

/** Parse the environment. Throws an Error whose message lists every problem. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`invalid configuration:\n  ${problems.join('\n  ')}`);
}
