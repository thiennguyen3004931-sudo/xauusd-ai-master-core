/**
 * Synthetic canonical snapshot format for future COPY_FOLLOWER journal attestation.
 * Pure, deterministic, in-memory only; no SQLite, network, KMS or MT5 access.
 *
 * Never accept these untrusted inputs as proof of an independent checkpoint.
 * A rolled-back SQLite journal is internally consistent: digest matching does
 * NOT authorize an order, customer activation or release.
 */
import { createHash } from 'node:crypto';

export const FOLLOWER_JOURNAL_SNAPSHOT_DOMAIN = 'XAUUSD-FOLLOWER-JOURNAL-SNAPSHOT-V1\n';
const bindingFields = ['licenseId', 'installationId', 'mt5Login', 'brokerServer', 'allowedSymbols'];
const rowFields = ['commandId', 'sequence', 'state'];
const entryFields = ['binding', 'records'];
const isPlainRecord = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exactly = (value, fields) =>
  isPlainRecord(value) &&
  Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
const canonicalText = value =>
  typeof value === 'string' && value.length >= 1 && value.length <= 256 &&
  value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
const positiveSequence = n => Number.isSafeInteger(n) && n > 0;

function normalizeBinding(binding) {
  if (!exactly(binding, bindingFields) ||
      !canonicalText(binding.licenseId) || !canonicalText(binding.installationId) ||
      !canonicalText(binding.brokerServer) ||
      !positiveSequence(binding.mt5Login) ||
      !Array.isArray(binding.allowedSymbols) ||
      binding.allowedSymbols.length < 1 || binding.allowedSymbols.length > 100 ||
      binding.allowedSymbols.some(symbol => !canonicalText(symbol))) {
    throw new TypeError('FOLLOWER_SNAPSHOT_BINDING_INVALID');
  }
  const symbols = [...binding.allowedSymbols];
  if (new Set(symbols).size !== symbols.length ||
      symbols.some((symbol, i) => i > 0 && symbols[i - 1] >= symbol)) {
    throw new TypeError('FOLLOWER_SNAPSHOT_SYMBOLS_NOT_CANONICAL');
  }
  return Object.freeze({
    licenseId: binding.licenseId,
    installationId: binding.installationId,
    mt5Login: binding.mt5Login,
    brokerServer: binding.brokerServer,
    allowedSymbols: Object.freeze(symbols),
  });
}

/**
 * rows may arrive in arbitrary order but cannot be duplicated or malformed.
 * The complete journal rowset (including DISPATCHED and RESERVED) is hashed.
 * No caller-supplied sequence, count or digest fields are trusted.
 */
export function createFollowerCanonicalJournalSnapshot(input) {
  if (!exactly(input, entryFields) ||
      !Array.isArray(input.records) || input.records.length > 10_000) {
    throw new TypeError('FOLLOWER_SNAPSHOT_INPUT_INVALID');
  }
  const binding = normalizeBinding(input.binding);
  const seenIds = new Set();
  const seenSequences = new Set();
  const rows = input.records.map(row => {
    if (!exactly(row, rowFields) ||
        !canonicalText(row.commandId) || !positiveSequence(row.sequence) ||
        !['RESERVED', 'DISPATCHED'].includes(row.state)) {
      throw new TypeError('FOLLOWER_SNAPSHOT_ROW_INVALID');
    }
    if (seenIds.has(row.commandId) || seenSequences.has(row.sequence)) {
      throw new TypeError('FOLLOWER_SNAPSHOT_DUPLICATE_COMMAND_OR_SEQUENCE');
    }
    seenIds.add(row.commandId);
    seenSequences.add(row.sequence);
    return [row.commandId, row.sequence, row.state];
  });
  rows.sort((left, right) => left[1] - right[1]);
  const maxSequence = rows.length ? rows[rows.length - 1][1] : 0;
  const pendingReservedCount = rows.filter(row => row[2] === 'RESERVED').length;
  const canonicalPayload = JSON.stringify([
    1, binding.licenseId, binding.installationId, binding.mt5Login,
    binding.brokerServer, binding.allowedSymbols,
    maxSequence, pendingReservedCount, rows,
  ]);
  const journalDigestSha256 = createHash('sha256')
    .update(FOLLOWER_JOURNAL_SNAPSHOT_DOMAIN, 'utf8')
    .update(canonicalPayload, 'utf8')
    .digest('hex');
  return Object.freeze({ binding, maxSequence, journalDigestSha256, pendingReservedCount });
}
