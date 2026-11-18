/** Manual smoke test against the real public services (read-only, no keys). Run: npx tsx scripts/live-check.ts */
import { checkAddress } from '../src/address.js';
import { formatEth, formatGwei } from '../src/format.js';
import { createPriceClient } from '../src/price.js';
import { createRpcClient } from '../src/rpc.js';

const rpc = createRpcClient({
  url: process.env['ETH_RPC_URL'] ?? 'https://ethereum-rpc.publicnode.com',
  timeoutMs: 10_000,
});
const price = createPriceClient({
  baseUrl: process.env['PRICE_API_URL'] ?? 'https://api.coingecko.com/api/v3',
  timeoutMs: 10_000,
});
const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // a well-known public address

async function step(name: string, work: () => Promise<string>): Promise<void> {
  try {
    console.log(`ok    ${name}: ${await work()}`);
  } catch (error) {
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log('address check:', JSON.stringify(checkAddress(VITALIK)));
await step('eth_gasPrice', async () => `${formatGwei(await rpc.gasPrice())} gwei`);
await step('latest block', async () => {
  const block = await rpc.latestBlock();
  return `#${block.number}, ${Math.floor(Date.now() / 1000) - Number(block.timestamp)}s old`;
});
await step('eth_getBalance', async () => `${formatEth(await rpc.getBalance(VITALIK))} ETH`);
await step('unknown tx -> null', async () =>
  String(await rpc.getTransaction(`0x${'00'.repeat(32)}`)),
);
await step('ETH price', async () => JSON.stringify(await price.ethUsd()));
