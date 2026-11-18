/**
 * Ethereum address validation with the EIP-55 mixed-case checksum. All-lowercase or all-uppercase
 * addresses carry no checksum and are accepted; a mixed-case address must match its checksum, which
 * catches most typos.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function toChecksumAddress(address: string): string {
  const lower = address.slice(2).toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const char = lower[i] as string;
    out += /[a-f]/.test(char) && parseInt(hash[i] as string, 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

export type AddressCheck = { ok: true; address: string } | { ok: false; reason: string };

export function checkAddress(input: string): AddressCheck {
  const candidate = input.trim();
  if (!ADDRESS.test(candidate)) {
    return {
      ok: false,
      reason: 'That is not an Ethereum address (expected 0x followed by 40 hex characters).',
    };
  }
  const body = candidate.slice(2);
  const mixedCase = body !== body.toLowerCase() && body !== body.toUpperCase();
  const checksummed = toChecksumAddress(candidate);
  if (mixedCase && checksummed !== candidate) {
    return {
      ok: false,
      reason: 'The address has a wrong checksum (a character is probably mistyped).',
    };
  }
  return { ok: true, address: checksummed };
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function isTxHash(input: string): boolean {
  return TX_HASH.test(input.trim());
}
