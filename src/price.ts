/** ETH price in USD from CoinGecko's public "simple price" endpoint, cached briefly. */
import { z } from 'zod';
import { UpstreamError, fetchJson, type FetchLike } from './http.js';

const responseSchema = z.object({
  ethereum: z.object({
    usd: z.number().positive().finite(),
    usd_24h_change: z.number().finite().nullable().optional(),
  }),
});

export interface EthPrice {
  usd: number;
  change24hPercent: number | undefined;
}

export interface PriceClient {
  ethUsd(): Promise<EthPrice>;
}

export interface PriceOptions {
  baseUrl: string;
  timeoutMs: number;
  /** How long a fetched price is reused (protects the public API's rate limit). */
  ttlMs?: number;
  fetch?: FetchLike;
  now?: () => number;
}

export function createPriceClient(options: PriceOptions): PriceClient {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 60_000;
  let cached: { price: EthPrice; at: number } | undefined;

  return {
    async ethUsd() {
      if (cached && now() - cached.at < ttlMs) return cached.price;
      const url = `${options.baseUrl.replace(/\/$/, '')}/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true`;
      const json = await fetchJson(
        fetchImpl,
        url,
        { headers: { accept: 'application/json' } },
        options.timeoutMs,
        'price',
      );
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) throw new UpstreamError('price: unexpected response shape');
      const price: EthPrice = {
        usd: parsed.data.ethereum.usd,
        change24hPercent: parsed.data.ethereum.usd_24h_change ?? undefined,
      };
      cached = { price, at: now() };
      return price;
    },
  };
}
