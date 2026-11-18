import { describe, expect, it } from 'vitest';
import { checkAddress, isTxHash, toChecksumAddress } from '../src/address.js';
import { loadConfig } from '../src/config.js';
import {
  escapeHtml,
  formatAge,
  formatEth,
  formatGwei,
  formatUnits,
  formatUsd,
  shortHex,
} from '../src/format.js';
import { RateLimiter } from '../src/ratelimit.js';
import { SECRET_WARNING, looksLikeSecret } from '../src/safety.js';

// Test vectors from the EIP-55 specification.
const CHECKSUMMED = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
];
const ALL_CAPS = [
  '0x52908400098527886E0F7030069857D2E4169EE7',
  '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
];
const ALL_LOWER = [
  '0xde709f2102306220921060314715629080e2fb77',
  '0x27b1fdb04752bbc536007a920d24acb045561c26',
];

describe('EIP-55 addresses', () => {
  it('computes the official checksums', () => {
    for (const address of [...CHECKSUMMED, ...ALL_CAPS, ...ALL_LOWER]) {
      expect(toChecksumAddress(address.toLowerCase())).toBe(address);
    }
  });

  it('accepts checksummed, all-lowercase and all-uppercase addresses and returns the checksummed form', () => {
    for (const address of CHECKSUMMED) expect(checkAddress(address)).toEqual({ ok: true, address });
    expect(checkAddress(CHECKSUMMED[0]!.toLowerCase())).toEqual({
      ok: true,
      address: CHECKSUMMED[0],
    });
    expect(checkAddress(`0x${CHECKSUMMED[0]!.slice(2).toUpperCase()}`)).toEqual({
      ok: true,
      address: CHECKSUMMED[0],
    });
    expect(checkAddress(`  ${CHECKSUMMED[1]}  `)).toEqual({ ok: true, address: CHECKSUMMED[1] });
  });

  it('rejects a mixed-case address with one wrong letter-case (bad checksum)', () => {
    const bad = '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'; // first letter flipped
    const result = checkAddress(bad);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('checksum');
  });

  it('rejects things that are not addresses', () => {
    for (const bad of [
      '',
      'vitalik.eth',
      '0x123',
      `0x${'g'.repeat(40)}`,
      `0x${'a'.repeat(41)}`,
      `5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`,
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed; DROP',
    ]) {
      expect(checkAddress(bad).ok, bad).toBe(false);
    }
  });

  it('recognises transaction hashes', () => {
    expect(isTxHash(`0x${'ab'.repeat(32)}`)).toBe(true);
    expect(isTxHash(`0x${'ab'.repeat(31)}`)).toBe(false);
    expect(isTxHash('hello')).toBe(false);
  });
});

describe('formatting (bigint math, no float errors)', () => {
  it('formats wei as ETH, truncating instead of rounding', () => {
    expect(formatEth(0n)).toBe('0');
    expect(formatEth(1_500_000_000_000_000_000n)).toBe('1.5');
    expect(formatEth(1_234_567_891_234_567_891n)).toBe('1.234567');
    expect(formatEth(123_456_789_000_000_000_000_000n)).toBe('123456.789');
    expect(formatEth(1n)).toBe('< 0.000001');
    expect(formatEth(1_000_000_000_000n)).toBe('0.000001');
  });

  it('handles values float math would get wrong', () => {
    expect(formatUnits(9_007_199_254_740_993n, 0, 0)).toBe('9007199254740993'); // > 2^53
    expect(formatUnits(-1_500_000n, 6, 6)).toBe('-1.5');
  });

  it('formats gwei, USD, ages, hex and HTML', () => {
    expect(formatGwei(25_340_000_000n)).toBe('25.34');
    expect(formatGwei(1n)).toBe('< 0.01');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect([
      formatAge(5),
      formatAge(120),
      formatAge(7200),
      formatAge(200_000),
      formatAge(-3),
    ]).toEqual(['5s ago', '2 min ago', '2 h ago', '2 d ago', 'just now']);
    expect(shortHex(`0x${'a'.repeat(64)}`)).toBe('0xaaaaaa…aaaaaa');
    expect(shortHex('0x12')).toBe('0x12');
    expect(escapeHtml('<b>&"x"</b>')).toBe('&lt;b&gt;&amp;"x"&lt;/b&gt;');
  });
});

describe('private key and seed phrase guard', () => {
  it('flags raw private keys (with and without 0x)', () => {
    expect(looksLikeSecret(`0x${'1a'.repeat(32)}`)).toBe(true);
    expect(looksLikeSecret('1a'.repeat(32))).toBe(true);
    expect(looksLikeSecret(`my key is ${'ab'.repeat(32)} please check`)).toBe(true);
  });

  it('flags seed phrases of valid lengths', () => {
    const twelve =
      'abandon ability able about above absent absorb abstract absurd abuse access accident';
    expect(looksLikeSecret(twelve)).toBe(true);
    expect(
      looksLikeSecret(
        `${twelve} abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`,
      ),
    ).toBe(true); // 24 words
  });

  it('does not flag normal messages, addresses, or 11 words', () => {
    for (const fine of [
      'hello there',
      '/balance 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      'what is the gas price today',
      'abandon ability able about above absent absorb abstract absurd abuse access',
      `0x${'a'.repeat(40)}`,
    ]) {
      expect(looksLikeSecret(fine), fine).toBe(false);
    }
  });

  it('the warning tells the user what to do', () => {
    expect(SECRET_WARNING).toContain('compromised');
    expect(SECRET_WARNING).toContain('/tx');
  });
});

describe('RateLimiter', () => {
  it('allows a burst up to capacity, then refuses with a retry time, then refills', () => {
    let time = 0;
    const limiter = new RateLimiter(3, 60, () => time); // 3 burst, 1 per second
    expect([1, 2, 3].map(() => limiter.take(1).allowed)).toEqual([true, true, true]);
    expect(limiter.take(1)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    time = 1000;
    expect(limiter.take(1).allowed).toBe(true);
    expect(limiter.take(1).allowed).toBe(false);
  });

  it('keeps users independent and never refills beyond capacity', () => {
    let time = 0;
    const limiter = new RateLimiter(2, 60, () => time);
    limiter.take(1);
    limiter.take(1);
    expect(limiter.take(1).allowed).toBe(false);
    expect(limiter.take(2).allowed).toBe(true);
    time = 1_000_000;
    expect([1, 2, 3].map(() => limiter.take(1).allowed)).toEqual([true, true, false]);
  });

  it('bounds memory by dropping fully refilled buckets', () => {
    let time = 0;
    const limiter = new RateLimiter(5, 60, () => time, 3);
    for (const user of [1, 2, 3]) limiter.take(user);
    time = 1_000_000; // everyone has fully refilled
    limiter.take(4); // size now exceeds the cap, so idle buckets are evicted
    expect(
      (limiter as unknown as { buckets: Map<number, unknown> }).buckets.size,
    ).toBeLessThanOrEqual(2);
  });
});

describe('loadConfig', () => {
  const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

  it('applies defaults and coerces numbers', () => {
    const config = loadConfig({ BOT_TOKEN: token, RATE_LIMIT_PER_MINUTE: '5' });
    expect(config).toMatchObject({
      BOT_TOKEN: token,
      RATE_LIMIT_PER_MINUTE: 5,
      REQUEST_TIMEOUT_MS: 8000,
    });
    expect(config.ETH_RPC_URL).toMatch(/^https:\/\//);
  });

  it('lists every problem and never echoes the bad token value', () => {
    expect(() => loadConfig({})).toThrow('BOT_TOKEN is required');
    try {
      loadConfig({ BOT_TOKEN: 'not-a-token', ETH_RPC_URL: 'ftp://x', RATE_LIMIT_PER_MINUTE: '0' });
      expect.unreachable();
    } catch (error) {
      const message = String(error);
      expect(message).toContain('BOT_TOKEN');
      expect(message).toContain('ETH_RPC_URL');
      expect(message).toContain('RATE_LIMIT_PER_MINUTE');
      expect(message).not.toContain('not-a-token');
    }
  });
});
