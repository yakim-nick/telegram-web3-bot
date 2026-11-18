/**
 * A minimal Ethereum JSON-RPC client for the few read-only calls this bot needs. It signs nothing
 * and holds no keys. Every response is validated with Zod before it is used.
 */
import { z } from 'zod';
import { UpstreamError, fetchJson, type FetchLike } from './http.js';

/** A JSON-RPC quantity: "0x0", "0x1a"... (no leading zeros), converted to bigint. */
const quantity = z
  .string()
  .regex(/^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/, 'not a hex quantity')
  .transform((hex) => BigInt(hex));

const envelope = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string(), z.null()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

const blockSchema = z.object({ number: quantity, timestamp: quantity });
const transactionSchema = z.object({
  hash: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  value: quantity,
  blockNumber: quantity.nullable(),
});
const receiptSchema = z.object({
  status: quantity.optional(),
  blockNumber: quantity,
  gasUsed: quantity,
  effectiveGasPrice: quantity.optional(),
});

export type Block = z.infer<typeof blockSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Receipt = z.infer<typeof receiptSchema>;

export interface RpcClient {
  getBalance(address: string): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  latestBlock(): Promise<Block>;
  getTransaction(hash: string): Promise<Transaction | null>;
  getReceipt(hash: string): Promise<Receipt | null>;
}

export interface RpcOptions {
  url: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

export function createRpcClient(options: RpcOptions): RpcClient {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  let nextId = 1;

  async function call<T>(
    method: string,
    params: unknown[],
    schema: z.ZodType<T>,
    nullable = false,
  ): Promise<T | null> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params });
    const json = await fetchJson(
      fetchImpl,
      options.url,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body },
      options.timeoutMs,
      `rpc ${method}`,
    );
    const parsed = envelope.safeParse(json);
    if (!parsed.success) throw new UpstreamError(`rpc ${method}: malformed JSON-RPC response`);
    if (parsed.data.error) throw new UpstreamError(`rpc ${method}: ${parsed.data.error.message}`);
    if (parsed.data.result === null && nullable) return null;
    const result = schema.safeParse(parsed.data.result);
    if (!result.success) throw new UpstreamError(`rpc ${method}: unexpected result shape`);
    return result.data;
  }

  const required = async <T>(method: string, params: unknown[], schema: z.ZodType<T>): Promise<T> =>
    (await call(method, params, schema)) as T;

  return {
    getBalance: (address) => required('eth_getBalance', [address, 'latest'], quantity),
    gasPrice: () => required('eth_gasPrice', [], quantity),
    latestBlock: () => required('eth_getBlockByNumber', ['latest', false], blockSchema),
    getTransaction: (hash) => call('eth_getTransactionByHash', [hash], transactionSchema, true),
    getReceipt: (hash) => call('eth_getTransactionReceipt', [hash], receiptSchema, true),
  };
}
