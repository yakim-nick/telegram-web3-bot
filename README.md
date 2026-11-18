# telegram-web3-bot

[![CI](https://github.com/yakim-nick/telegram-web3-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/yakim-nick/telegram-web3-bot/actions/workflows/ci.yml)

A **read-only Telegram bot for public Ethereum data**, written in TypeScript with
[grammY](https://grammy.dev). Ask it for a balance, a transaction, the gas price, the latest block
or the ETH price. It holds **no private keys**, cannot sign or send anything, and can not move
funds. It is a learning project and a template for small, safe chat bots.

| Command              | What it shows                                                          |
| -------------------- | ---------------------------------------------------------------------- |
| `/balance <address>` | ETH balance, plus an approximate USD value when the price source is up |
| `/tx <hash>`         | success / failed / pending, sender, receiver, value, block and fee     |
| `/gas`               | current gas price in gwei                                              |
| `/block`             | latest block number and age                                            |
| `/price`             | ETH price in USD and the 24h change                                    |
| `/help`              | the list above and a reminder never to share keys                      |

## Run it

Needs Node 22.12+. Get a bot token from [@BotFather](https://t.me/BotFather) in Telegram.

```bash
git clone https://github.com/yakim-nick/telegram-web3-bot && cd telegram-web3-bot
npm install && npm run build
cp .env.example .env            # put your BOT_TOKEN in .env
node --env-file=.env dist/main.js
```

Configuration (environment variables, validated at startup; a bad value exits with code 2 and a
message that never echoes the token): `BOT_TOKEN` (required), `ETH_RPC_URL`, `PRICE_API_URL`,
`RATE_LIMIT_PER_MINUTE` (default 20), `REQUEST_TIMEOUT_MS` (default 8000). The bot uses long
polling, so it needs no public URL.

## Security model

- **Read-only by construction.** The only RPC methods used are `eth_getBalance`, `eth_gasPrice`,
  `eth_getBlockByNumber`, `eth_getTransactionByHash` and `eth_getTransactionReceipt`. There is no
  signing code and no key handling anywhere.
- **Pasted secrets are refused.** A message that looks like a private key (64 hex characters) or a
  seed phrase (12/15/18/21/24 lowercase words) is not processed, not logged and not stored; the
  bot tells the user to treat it as compromised. `/tx` is exempt because a transaction hash has the
  same shape as a key. The check is a heuristic: it can miss formats and can flag odd text.
- **Input validation.** Addresses are checked against the EIP-55 checksum (a mixed-case address with
  a typo is rejected), hashes against their exact format.
- **External data is untrusted.** Every RPC and price response is parsed with Zod; hex quantities
  must be well formed; responses are capped at 1 MB; each request has a timeout. Money amounts use
  `bigint`, never floating point.
- **Failures do not leak.** A broken upstream gives users a generic message. Internal errors log
  only the error name, never message text, and the RPC URL and token are never shown.
- **Rate limiting.** A token bucket per Telegram user (default 20 per minute).
- **Output safety.** Replies use Telegram's HTML mode with escaping, and link previews are off.

Privacy note: the node you configure sees every address and hash users look up. The default is a
free public node; use your own for anything beyond experiments.

## Layout

```
src/bot.ts        commands and middleware (rate limit -> secret guard -> commands -> error boundary)
src/rpc.ts        minimal JSON-RPC client with Zod-validated responses
src/price.ts      CoinGecko price client with a short cache
src/http.ts       timeout, size cap and JSON handling for outbound calls
src/address.ts    EIP-55 checksum validation
src/format.ts     bigint-safe formatting
src/safety.ts     private key / seed phrase guard
src/ratelimit.ts  per-user token bucket
src/config.ts     environment validation
scripts/live-check.ts   manual smoke test against the real public services
```

## What is verified, and what is not

**Verified (49 tests, 99.6% statement coverage, Node 22):**

- EIP-55 checksums against the specification's official test vectors, and bigint formatting at the
  edges.
- The RPC and price clients against a real local HTTP server: success, JSON-RPC errors, HTTP errors,
  non-JSON, wrong shapes, leading-zero hex, null results, timeouts, oversized bodies, unreachable
  hosts, and price caching.
- The bot through real grammY update handling with every outgoing API call captured: each command,
  bad input, upstream failures, the error boundary, the secret guard (and that it never logs the
  text), and rate limiting per user.
- **Against the real services, by hand** (`npx tsx scripts/live-check.ts`): gas price, latest block,
  a balance, an unknown transaction and the ETH price from the public node and CoinGecko, plus six
  real recent transactions and receipts parsed by the schemas.
- Startup: missing and malformed tokens exit with code 2; a well-formed but fake token is rejected
  by Telegram, the bot exits with code 1 and the token is not printed.

**Not verified:** **the bot has never run against a real Telegram bot token**: no token was
available where it was built, so the message round trip through Telegram itself is untested (the
handlers are tested through grammY). Group chats, Windows and long-running stability are untested.

## Known limitations

- Ethereum mainnet only; no ENS names, tokens (ERC-20) or NFTs.
- A transaction that was just mined can briefly read "not found" on a public node, because
  load-balanced nodes are not always in sync. I saw this on 2 of 6 fresh transactions.
- The price comes from a free public API (rate limited, cached for 60 s) and is informational, not
  financial advice.
- The rate limiter is in memory: it resets on restart and is not shared between instances.
- The bot checks that the RPC answers, not that it is mainnet; pointing it at another chain gives
  that chain's data under mainnet links.

## Roadmap

- ERC-20 balances and ENS resolution (read-only).
- A configurable allow-list of chats, webhook mode, and structured logs.
- A live Telegram end-to-end test with a throwaway bot.

## License

MIT
