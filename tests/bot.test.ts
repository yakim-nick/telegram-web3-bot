/**
 * The bot end to end, without Telegram: real grammY update handling, with every outgoing API call
 * captured by a transformer. No token is used and no network is touched.
 */
import type { UserFromGetMe } from 'grammy/types';
import { describe, expect, it, vi } from 'vitest';
import { createBot } from '../src/bot.js';
import { UpstreamError } from '../src/http.js';
import type { PriceClient } from '../src/price.js';
import { RateLimiter } from '../src/ratelimit.js';
import type { RpcClient } from '../src/rpc.js';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const TX = `0x${'ab'.repeat(32)}`;
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: 'Test',
  username: 'test_bot',
} as unknown as UserFromGetMe;

function setup(
  overrides: { rpc?: Partial<RpcClient>; price?: Partial<PriceClient>; limiter?: RateLimiter } = {},
) {
  const rpc: RpcClient = {
    getBalance: vi.fn().mockResolvedValue(1_500_000_000_000_000_000n),
    gasPrice: vi.fn().mockResolvedValue(25_340_000_000n),
    latestBlock: vi.fn().mockResolvedValue({ number: 19_531_250n, timestamp: 1_699_999_940n }),
    getTransaction: vi.fn().mockResolvedValue({
      hash: TX,
      from: ADDRESS,
      to: '0xde709f2102306220921060314715629080e2fb77',
      value: 2_000_000_000_000_000_000n,
      blockNumber: 16n,
    }),
    getReceipt: vi.fn().mockResolvedValue({
      status: 1n,
      blockNumber: 16n,
      gasUsed: 21_000n,
      effectiveGasPrice: 30_000_000_000n,
    }),
    ...overrides.rpc,
  };
  const price: PriceClient = {
    ethUsd: vi.fn().mockResolvedValue({ usd: 2000, change24hPercent: 1.5 }),
    ...overrides.price,
  };
  const logs: string[] = [];
  const sent: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const bot = createBot(
    TOKEN,
    {
      rpc,
      price,
      limiter: overrides.limiter ?? new RateLimiter(100, 100),
      now: () => 1_700_000_000_000,
      log: (m) => logs.push(m),
    },
    { botInfo: BOT_INFO },
  );
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    return {
      ok: true,
      result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } },
    } as never;
  });

  let updateId = 0;
  const say = async (text: string, userId = 42) => {
    const command = text.startsWith('/')
      ? [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0]!.length }]
      : undefined;
    // handleUpdates is what bot.start() uses (typed private in grammY): it routes middleware
    // errors to bot.catch, which plain handleUpdate does not.
    await (bot as unknown as { handleUpdates(updates: unknown[]): Promise<void> }).handleUpdates([
      {
        update_id: ++updateId,
        message: {
          message_id: updateId,
          date: 0,
          chat: { id: userId, type: 'private', first_name: 'A' },
          from: { id: userId, is_bot: false, first_name: 'A' },
          text,
          ...(command ? { entities: command } : {}),
        },
      } as never,
    ]);
    return sent.filter((c) => c.method === 'sendMessage').map((c) => String(c.payload['text']));
  };
  return { bot, rpc, price, say, sent, logs };
}

const lastReply = (replies: string[]) => replies[replies.length - 1] ?? '';

describe('commands', () => {
  it('/start and /help explain the bot and warn about keys', async () => {
    const { say } = setup();
    const text = lastReply(await say('/start'));
    expect(text).toContain('/balance');
    expect(text).toContain('never need a private key');
    expect(lastReply(await say('/help'))).toBe(text);
  });

  it('/balance shows ETH and an approximate USD value, using the checksummed address', async () => {
    const { say, rpc } = setup();
    const text = lastReply(await say(`/balance ${ADDRESS.toLowerCase()}`));
    expect(rpc.getBalance).toHaveBeenCalledWith(ADDRESS);
    expect(text).toContain(`<code>${ADDRESS}</code>`);
    expect(text).toContain('<b>1.5 ETH</b>');
    expect(text).toContain('≈ $3,000.00');
  });

  it('/balance still works when the price source is down', async () => {
    const { say } = setup({
      price: { ethUsd: vi.fn().mockRejectedValue(new UpstreamError('price: HTTP 429')) },
    });
    const text = lastReply(await say(`/balance ${ADDRESS}`));
    expect(text).toContain('1.5 ETH');
    expect(text).not.toContain('≈');
  });

  it('/balance rejects bad input without calling the node', async () => {
    const { say, rpc } = setup();
    expect(lastReply(await say('/balance'))).toContain('Usage: /balance');
    expect(lastReply(await say('/balance vitalik.eth'))).toContain('not an Ethereum address');
    expect(lastReply(await say('/balance 0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'))).toContain(
      'wrong checksum',
    );
    expect(rpc.getBalance).not.toHaveBeenCalled();
  });

  it('/gas, /block and /price', async () => {
    const { say } = setup();
    expect(lastReply(await say('/gas'))).toContain('<b>25.34 gwei</b>');
    expect(lastReply(await say('/block'))).toContain('<b>#19531250</b> (1 min ago)');
    const price = lastReply(await say('/price'));
    expect(price).toContain('$2,000.00');
    expect(price).toContain('24h: +1.50%');
  });

  it('/tx shows a successful transaction with its fee and an explorer link', async () => {
    const { say } = setup();
    const text = lastReply(await say(`/tx ${TX}`));
    expect(text).toContain('✅ Success');
    expect(text).toContain('Value: <b>2 ETH</b>');
    expect(text).toContain('Fee: 0.00063 ETH'); // 21000 * 30 gwei
    expect(text).toContain(`https://etherscan.io/tx/${TX}`);
  });

  it('/tx covers failed, pending, contract creation and not found', async () => {
    const failed = setup({
      rpc: { getReceipt: vi.fn().mockResolvedValue({ status: 0n, blockNumber: 1n, gasUsed: 1n }) },
    });
    expect(lastReply(await failed.say(`/tx ${TX}`))).toContain('❌ Failed');

    const pending = setup({ rpc: { getReceipt: vi.fn().mockResolvedValue(null) } });
    expect(lastReply(await pending.say(`/tx ${TX}`))).toContain('⏳ Pending');

    const creation = setup({
      rpc: {
        getTransaction: vi
          .fn()
          .mockResolvedValue({ hash: TX, from: ADDRESS, to: null, value: 0n, blockNumber: 1n }),
      },
    });
    expect(lastReply(await creation.say(`/tx ${TX}`))).toContain('contract creation');

    const missing = setup({
      rpc: {
        getTransaction: vi.fn().mockResolvedValue(null),
        getReceipt: vi.fn().mockResolvedValue(null),
      },
    });
    expect(lastReply(await missing.say(`/tx ${TX}`))).toContain('not found');
  });

  it('/tx rejects a malformed hash', async () => {
    const { say, rpc } = setup();
    expect(lastReply(await say('/tx 0x123'))).toContain('not a transaction hash');
    expect(rpc.getTransaction).not.toHaveBeenCalled();
  });

  it('unknown commands get a hint, ordinary chat is ignored', async () => {
    const { say, sent } = setup();
    expect(lastReply(await say('/frobnicate'))).toContain('Unknown command');
    const before = sent.length;
    await say('just chatting');
    expect(sent.length).toBe(before);
  });

  it('replies with HTML and no link previews', async () => {
    const { say, sent } = setup();
    await say('/gas');
    expect(sent[0]!.payload).toMatchObject({
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });
});

describe('failure handling', () => {
  it('upstream failures give a friendly message that leaks nothing', async () => {
    const { say, logs } = setup({
      rpc: {
        gasPrice: vi
          .fn()
          .mockRejectedValue(
            new UpstreamError('rpc eth_gasPrice: HTTP 500 from https://secret-node.example/key123'),
          ),
      },
    });
    const text = lastReply(await say('/gas'));
    expect(text).toContain('Could not reach the data source');
    expect(text).not.toContain('secret-node');
    expect(logs.some((l) => l.includes('upstream failure'))).toBe(true);
  });

  it('an unexpected bug is caught by the error boundary: generic reply, only the error name is logged', async () => {
    const { say, logs } = setup({
      rpc: { gasPrice: vi.fn().mockRejectedValue(new TypeError('boom with password hunter2')) },
    });
    expect(lastReply(await say('/gas'))).toContain('Something went wrong');
    expect(logs).toEqual(['unhandled error: TypeError']);
  });
});

describe('private key guard', () => {
  it('refuses a pasted private key without processing or logging it', async () => {
    const { say, rpc, logs } = setup();
    const key = `0x${'1a'.repeat(32)}`;
    const text = lastReply(await say(key));
    expect(text).toContain('private key or a seed phrase');
    expect(rpc.getBalance).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain('1a1a');
  });

  it('also guards commands whose arguments are a key, and seed phrases', async () => {
    const { say, rpc } = setup();
    expect(lastReply(await say(`/balance ${'ab'.repeat(32)}`))).toContain(
      'private key or a seed phrase',
    );
    const seed =
      'abandon ability able about above absent absorb abstract absurd abuse access accident';
    expect(lastReply(await say(seed))).toContain('private key or a seed phrase');
    expect(rpc.getBalance).not.toHaveBeenCalled();
  });

  it('lets /tx through, because a transaction hash looks like a key', async () => {
    const { say, rpc } = setup();
    expect(lastReply(await say(`/tx ${TX}`))).toContain('Success');
    expect(rpc.getTransaction).toHaveBeenCalled();
  });
});

describe('rate limiting', () => {
  it('stops a user who floods the bot, per user', async () => {
    const { say, rpc } = setup({ limiter: new RateLimiter(2, 2) });
    await say('/gas');
    await say('/gas');
    expect(lastReply(await say('/gas'))).toContain('Slow down');
    expect(rpc.gasPrice).toHaveBeenCalledTimes(2);
    expect(lastReply(await say('/gas', 7))).toContain('gwei'); // another user is unaffected
  });

  it('ignores updates that have no user', async () => {
    const { bot, sent } = setup();
    await bot.handleUpdate({
      update_id: 99,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 1, type: 'channel', title: 'c' },
        text: '/gas',
      },
    } as never);
    expect(sent).toHaveLength(0);
  });
});
