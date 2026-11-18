/**
 * The Telegram bot. Handlers only read public data; nothing here signs, sends or stores anything.
 * Order of middleware matters: rate limit first, then the private-key guard, then the commands.
 */
import { Bot, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { checkAddress, isTxHash } from './address.js';
import {
  escapeHtml,
  formatAge,
  formatEth,
  formatGwei,
  formatUnits,
  formatUsd,
  shortHex,
} from './format.js';
import { UpstreamError } from './http.js';
import type { PriceClient } from './price.js';
import type { RateLimiter } from './ratelimit.js';
import type { RpcClient } from './rpc.js';
import { SECRET_WARNING, looksLikeSecret } from './safety.js';

export interface BotDeps {
  rpc: RpcClient;
  price: PriceClient;
  limiter: RateLimiter;
  /** Milliseconds since the epoch; injectable for tests. */
  now?: () => number;
  /** Diagnostics sink. It never receives message text. */
  log?: (message: string) => void;
}

export const COMMANDS = [
  { command: 'balance', description: 'ETH balance of an address' },
  { command: 'tx', description: 'Status of a transaction' },
  { command: 'gas', description: 'Current gas price' },
  { command: 'block', description: 'Latest block' },
  { command: 'price', description: 'ETH price in USD' },
  { command: 'help', description: 'What this bot can do' },
];

const HELP = [
  '<b>Read-only Ethereum bot</b>',
  '',
  '/balance <code>0x…address</code> – ETH balance',
  '/tx <code>0x…hash</code> – transaction status',
  '/gas – current gas price',
  '/block – latest block',
  '/price – ETH price in USD',
  '',
  '🔒 I only read public blockchain data. I never need a private key or seed phrase: never send one to anyone.',
].join('\n');

const UPSTREAM_DOWN = 'Could not reach the data source right now. Please try again in a moment.';

async function html(ctx: Context, text: string): Promise<void> {
  await ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
}

/** Handler wrapper: upstream failures become a friendly message, everything else reaches bot.catch. */
function safe(
  deps: BotDeps,
  handler: (ctx: Context) => Promise<void>,
): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    try {
      await handler(ctx);
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      deps.log?.(`upstream failure: ${error.message}`);
      await html(ctx, UPSTREAM_DOWN);
    }
  };
}

const isTxCommand = (text: string): boolean => /^\/tx(@\w+)?(\s|$)/.test(text);

export function createBot(
  token: string,
  deps: BotDeps,
  options: { botInfo?: UserFromGetMe } = {},
): Bot {
  const bot = new Bot(token, options.botInfo ? { botInfo: options.botInfo } : {});
  const now = deps.now ?? Date.now;

  // 1. Rate limit per user.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return;
    const decision = deps.limiter.take(userId);
    if (!decision.allowed) {
      if (ctx.message)
        await ctx.reply(`⏳ Slow down, please. Try again in ${decision.retryAfterSeconds}s.`);
      return;
    }
    await next();
  });

  // 2. Refuse (and do not process) anything that looks like a private key or seed phrase.
  //    /tx is exempt because a transaction hash has the same shape as a private key.
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    if (text && !isTxCommand(text) && looksLikeSecret(text)) {
      await ctx.reply(SECRET_WARNING);
      return;
    }
    await next();
  });

  bot.command(['start', 'help'], (ctx) => html(ctx, HELP));

  bot.command(
    'balance',
    safe(deps, async (ctx) => {
      const check = checkAddress(String(ctx.match));
      if (!check.ok) {
        await html(ctx, `${escapeHtml(check.reason)}\nUsage: /balance <code>0x…address</code>`);
        return;
      }
      const [balance, price] = await Promise.all([
        deps.rpc.getBalance(check.address),
        deps.price.ethUsd().catch(() => undefined), // the price is a nice extra, not required
      ]);
      const usd = price ? ` (≈ ${formatUsd(Number(formatUnits(balance, 18, 8)) * price.usd)})` : '';
      await html(
        ctx,
        `<b>Balance</b>\n<code>${check.address}</code>\n<b>${formatEth(balance)} ETH</b>${usd}`,
      );
    }),
  );

  bot.command(
    'gas',
    safe(deps, async (ctx) => {
      await html(ctx, `⛽ Gas price: <b>${formatGwei(await deps.rpc.gasPrice())} gwei</b>`);
    }),
  );

  bot.command(
    'block',
    safe(deps, async (ctx) => {
      const block = await deps.rpc.latestBlock();
      const age = Math.floor(now() / 1000) - Number(block.timestamp);
      await html(ctx, `🧱 Latest block: <b>#${block.number}</b> (${formatAge(age)})`);
    }),
  );

  bot.command(
    'price',
    safe(deps, async (ctx) => {
      const price = await deps.price.ethUsd();
      const change = price.change24hPercent;
      const trend =
        change === undefined ? '' : ` (24h: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%)`;
      await html(ctx, `💱 ETH: <b>${formatUsd(price.usd)}</b>${trend}`);
    }),
  );

  bot.command(
    'tx',
    safe(deps, async (ctx) => {
      const hash = String(ctx.match).trim();
      if (!isTxHash(hash)) {
        await html(
          ctx,
          'That is not a transaction hash (0x followed by 64 hex characters).\nUsage: /tx <code>0x…hash</code>',
        );
        return;
      }
      const [tx, receipt] = await Promise.all([
        deps.rpc.getTransaction(hash),
        deps.rpc.getReceipt(hash),
      ]);
      if (!tx) {
        await html(
          ctx,
          'Transaction not found. It may not exist on this network, or it has not propagated yet.',
        );
        return;
      }
      const status = !receipt ? '⏳ Pending' : receipt.status === 0n ? '❌ Failed' : '✅ Success';
      const lines = [
        `<b>${status}</b>`,
        `<a href="https://etherscan.io/tx/${hash}">${escapeHtml(shortHex(hash))}</a>`,
        `From: <code>${escapeHtml(tx.from)}</code>`,
        `To: <code>${escapeHtml(tx.to ?? 'contract creation')}</code>`,
        `Value: <b>${formatEth(tx.value)} ETH</b>`,
      ];
      if (receipt) {
        lines.push(`Block: #${receipt.blockNumber}`);
        if (receipt.effectiveGasPrice !== undefined) {
          lines.push(`Fee: ${formatEth(receipt.gasUsed * receipt.effectiveGasPrice)} ETH`);
        }
      }
      await html(ctx, lines.join('\n'));
    }),
  );

  // Unknown commands get a hint; ordinary chat text is ignored.
  bot.on('message:text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) await html(ctx, 'Unknown command. Try /help');
  });

  bot.catch(async (error) => {
    deps.log?.(`unhandled error: ${error.error instanceof Error ? error.error.name : 'unknown'}`);
    try {
      await error.ctx.reply('Something went wrong on my side. Please try again.');
    } catch {
      // nothing more we can do
    }
  });

  return bot;
}
