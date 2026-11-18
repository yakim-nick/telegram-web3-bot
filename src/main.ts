#!/usr/bin/env node
import { createBot, COMMANDS } from './bot.js';
import { loadConfig } from './config.js';
import { createPriceClient } from './price.js';
import { RateLimiter } from './ratelimit.js';
import { createRpcClient } from './rpc.js';

function main(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  const bot = createBot(config.BOT_TOKEN, {
    rpc: createRpcClient({ url: config.ETH_RPC_URL, timeoutMs: config.REQUEST_TIMEOUT_MS }),
    price: createPriceClient({
      baseUrl: config.PRICE_API_URL,
      timeoutMs: config.REQUEST_TIMEOUT_MS,
    }),
    limiter: new RateLimiter(config.RATE_LIMIT_PER_MINUTE, config.RATE_LIMIT_PER_MINUTE),
    log: (message) => console.error(`[${new Date().toISOString()}] ${message}`),
  });

  const stop = () => {
    console.error('shutting down');
    void bot.stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  void bot.api.setMyCommands(COMMANDS).catch(() => console.error('could not set the command menu'));
  bot
    .start({
      allowed_updates: ['message'],
      onStart: (info) => console.error(`bot @${info.username} is running (read-only)`),
    })
    .catch((error: unknown) => {
      // Never print the token: grammY errors can contain the request URL.
      console.error(`error: bot stopped: ${error instanceof Error ? error.name : 'unknown'}`);
      process.exit(1);
    });
}

main();
