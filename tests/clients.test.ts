/** The RPC and price clients against a real local HTTP server (real fetch, real timeouts). */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { UpstreamError } from '../src/http.js';
import { createPriceClient } from '../src/price.js';
import { createRpcClient } from '../src/rpc.js';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let server: Server | undefined;
afterEach(
  () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

async function serve(handler: Handler): Promise<string> {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const json = (res: ServerResponse, value: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};
const rpcOk = (result: unknown) => ({ jsonrpc: '2.0', id: 1, result });

describe('rpc client', () => {
  it('sends well-formed JSON-RPC and parses hex quantities to bigint', async () => {
    const seen: Array<{ method: string; params: unknown[] }> = [];
    const url = await serve((_req, body, res) => {
      const call = JSON.parse(body) as { method: string; params: unknown[] };
      seen.push(call);
      const results: Record<string, unknown> = {
        eth_getBalance: '0x1bc16d674ec80000', // 2 ETH
        eth_gasPrice: '0x5e661b700', // 25.34 gwei
        eth_getBlockByNumber: { number: '0x12a05f2', timestamp: '0x6553f100', extra: 'ignored' },
      };
      json(res, rpcOk(results[call.method]));
    });
    const rpc = createRpcClient({ url, timeoutMs: 2000 });
    expect(await rpc.getBalance('0xabc')).toBe(2_000_000_000_000_000_000n);
    expect(await rpc.gasPrice()).toBe(25_340_000_000n);
    expect(await rpc.latestBlock()).toEqual({ number: 19_531_250n, timestamp: 1_700_000_000n });
    expect(seen[0]).toEqual({
      jsonrpc: '2.0',
      id: expect.any(Number),
      method: 'eth_getBalance',
      params: ['0xabc', 'latest'],
    });
    expect(seen[2]!.params).toEqual(['latest', false]);
  });

  it('returns null for an unknown transaction and parses a receipt', async () => {
    const url = await serve((_req, body, res) => {
      const { method } = JSON.parse(body) as { method: string };
      json(
        res,
        rpcOk(
          method === 'eth_getTransactionByHash'
            ? null
            : {
                status: '0x1',
                blockNumber: '0x10',
                gasUsed: '0x5208',
                effectiveGasPrice: '0x3b9aca00',
              },
        ),
      );
    });
    const rpc = createRpcClient({ url, timeoutMs: 2000 });
    expect(await rpc.getTransaction('0x' + '1'.repeat(64))).toBeNull();
    expect(await rpc.getReceipt('0x' + '1'.repeat(64))).toEqual({
      status: 1n,
      blockNumber: 16n,
      gasUsed: 21_000n,
      effectiveGasPrice: 1_000_000_000n,
    });
  });

  it.each([
    [
      'a JSON-RPC error object',
      (res: ServerResponse) =>
        json(res, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'rate limited' } }),
      'rate limited',
    ],
    ['an HTTP 500', (res: ServerResponse) => json(res, {}, 500), 'HTTP 500'],
    ['a non-JSON body', (res: ServerResponse) => res.end('<html>oops</html>'), 'not JSON'],
    [
      'a wrong envelope',
      (res: ServerResponse) => json(res, { hello: 'world' }),
      'malformed JSON-RPC',
    ],
    [
      'a result of the wrong shape',
      (res: ServerResponse) => json(res, rpcOk('not-hex')),
      'unexpected result shape',
    ],
    [
      'a quantity with leading zeros',
      (res: ServerResponse) => json(res, rpcOk('0x0001')),
      'unexpected result shape',
    ],
    [
      'a null result where one is required',
      (res: ServerResponse) => json(res, rpcOk(null)),
      'unexpected result shape',
    ],
  ])('throws UpstreamError for %s', async (_name, respond, message) => {
    const url = await serve((_req, _body, res) => respond(res));
    const rpc = createRpcClient({ url, timeoutMs: 2000 });
    const failure = await rpc.gasPrice().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).message).toContain(message);
  });

  it('times out on a server that never answers', async () => {
    const url = await serve(() => {
      /* never respond */
    });
    const failure = await createRpcClient({ url, timeoutMs: 500 })
      .gasPrice()
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).message).toContain('timed out');
  });

  it('refuses an oversized response', async () => {
    const url = await serve((_req, _body, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(rpcOk('0x' + 'f'.repeat(1_100_000))));
    });
    const failure = await createRpcClient({ url, timeoutMs: 5000 })
      .gasPrice()
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect((failure as UpstreamError).message).toContain('too large');
  });

  it('reports an unreachable server as a network error', async () => {
    const failure = await createRpcClient({ url: 'http://127.0.0.1:1', timeoutMs: 1000 })
      .gasPrice()
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(UpstreamError);
    expect((failure as UpstreamError).message).toContain('network error');
  });
});

describe('price client', () => {
  const body = { ethereum: { usd: 2345.67, usd_24h_change: -1.234 } };

  it('parses the response and caches it for the TTL', async () => {
    let requests = 0;
    let lastUrl = '';
    const base = await serve((req, _body, res) => {
      requests += 1;
      lastUrl = req.url ?? '';
      json(res, body);
    });
    let time = 0;
    const price = createPriceClient({
      baseUrl: base,
      timeoutMs: 2000,
      ttlMs: 1000,
      now: () => time,
    });
    expect(await price.ethUsd()).toEqual({ usd: 2345.67, change24hPercent: -1.234 });
    expect(lastUrl).toContain('ids=ethereum');
    await price.ethUsd();
    expect(requests).toBe(1); // served from cache
    time = 1500;
    await price.ethUsd();
    expect(requests).toBe(2); // cache expired
  });

  it('accepts a missing 24h change, and rejects zero, negative or non-numeric prices', async () => {
    let response: unknown = { ethereum: { usd: 100 } };
    const base = await serve((_req, _body, res) => json(res, response));
    const client = () => createPriceClient({ baseUrl: base, timeoutMs: 2000, ttlMs: 0 });
    expect(await client().ethUsd()).toEqual({ usd: 100, change24hPercent: undefined });
    for (response of [
      { ethereum: { usd: 0 } },
      { ethereum: { usd: -5 } },
      { ethereum: { usd: '100' } },
      { bitcoin: { usd: 1 } },
      null,
    ]) {
      await expect(client().ethUsd()).rejects.toBeInstanceOf(UpstreamError);
    }
  });

  it('does not cache failures', async () => {
    let ok = false;
    const base = await serve((_req, _body, res) => (ok ? json(res, body) : json(res, {}, 429)));
    const price = createPriceClient({ baseUrl: base, timeoutMs: 2000 });
    await expect(price.ethUsd()).rejects.toThrow('HTTP 429');
    ok = true;
    expect((await price.ethUsd()).usd).toBe(2345.67);
  });
});
