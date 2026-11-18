/**
 * People sometimes paste a private key or a seed phrase into a bot by mistake (or because a scam
 * told them to). This bot never needs either, so it refuses to process such a message and tells the
 * user to treat the secret as compromised. The message text is never logged or stored.
 */

const PRIVATE_KEY = /(?<![0-9a-fA-F])(0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/;
const SEED_LENGTHS = new Set([12, 15, 18, 21, 24]);

export function looksLikeSecret(text: string): boolean {
  if (PRIVATE_KEY.test(text)) return true;
  const words = text.trim().split(/\s+/);
  return SEED_LENGTHS.has(words.length) && words.every((word) => /^[a-z]{3,8}$/.test(word));
}

export const SECRET_WARNING =
  '⚠️ That message looks like a private key or a seed phrase. I never need either, and I did not process or store it. ' +
  'Delete the message, and if it was a real key or phrase, treat it as compromised and move your funds to a new wallet. ' +
  'If you meant to look up a transaction, use /tx 0x…';
