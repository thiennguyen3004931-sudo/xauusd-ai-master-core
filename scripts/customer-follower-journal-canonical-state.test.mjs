import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOWER_JOURNAL_SNAPSHOT_DOMAIN,
  createFollowerCanonicalJournalSnapshot as snapshot,
} from './customer-follower-journal-canonical-state.mjs';

const binding = Object.freeze({
  licenseId: 'synthetic-license', installationId: 'synthetic-installation',
  mt5Login: 770001, brokerServer: 'Synthetic-Demo',
  allowedSymbols: ['XAUUSD'],
});
const rows = Object.freeze([
  { commandId: 'synthetic-open-1', sequence: 1, state: 'DISPATCHED' },
  { commandId: 'synthetic-close-2', sequence: 2, state: 'RESERVED' },
]);
const make = (records = rows, b = binding) => snapshot({ binding: b, records });
const rejects = (fn, code) => assert.throws(fn, new RegExp(code));

test('deterministic domain-separated full-journal digest ignores input row order', () => {
  const a = make();
  const reversed = make([...rows].reverse());
  assert.deepEqual(a, reversed);
  assert.match(a.journalDigestSha256, /^[0-9a-f]{64}$/);
  assert.equal(a.maxSequence, 2);
  assert.equal(a.pendingReservedCount, 1);
  assert.equal(a.binding.mt5Login, binding.mt5Login);
  assert.equal(FOLLOWER_JOURNAL_SNAPSHOT_DOMAIN, 'XAUUSD-FOLLOWER-JOURNAL-SNAPSHOT-V1\n');
});

test('empty journal has a pinned shape with maxSequence=0 and no reservations', () => {
  const empty = make([]);
  assert.equal(empty.maxSequence, 0);
  assert.equal(empty.pendingReservedCount, 0);
  assert.match(empty.journalDigestSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(empty.journalDigestSha256, make().journalDigestSha256);
});

test('same-sequence command forks and state transitions change complete journal digest', () => {
  const canonical = make();
  assert.notEqual(canonical.journalDigestSha256, make([
    rows[0], { ...rows[1], commandId: 'synthetic-forged-id' },
  ]).journalDigestSha256);
  assert.notEqual(canonical.journalDigestSha256, make([
    rows[0], { ...rows[1], state: 'DISPATCHED' },
  ]).journalDigestSha256);
  assert.notEqual(canonical.journalDigestSha256, make([rows[1]]).journalDigestSha256);
  assert.notEqual(canonical.journalDigestSha256, make([
    rows[0], rows[1], { commandId: 'synthetic-third', sequence: 3, state: 'DISPATCHED' },
  ]).journalDigestSha256);
});

test('identity binding and allowed-symbol scope are included in full-state digest', () => {
  const baseline = make();
  for (const changed of [
    { ...binding, licenseId: 'other-license' },
    { ...binding, installationId: 'other-installation' },
    { ...binding, mt5Login: 770002 },
    { ...binding, brokerServer: 'Other-Demo' },
    { ...binding, allowedSymbols: ['XAUUSD', 'XAGUSD'].sort() },
  ]) {
    assert.notEqual(make(rows, changed).journalDigestSha256, baseline.journalDigestSha256);
  }
});

test('duplicate ID or sequence, malformed row or arbitrary fields fail closed', () => {
  rejects(() => make([rows[0], { ...rows[0], sequence: 3 }]),
    'FOLLOWER_SNAPSHOT_DUPLICATE_COMMAND_OR_SEQUENCE');
  rejects(() => make([rows[0], { ...rows[1], sequence: 1 }]),
    'FOLLOWER_SNAPSHOT_DUPLICATE_COMMAND_OR_SEQUENCE');
  rejects(() => make([rows[0], { ...rows[1], state: 'EXECUTED' }]),
    'FOLLOWER_SNAPSHOT_ROW_INVALID');
  rejects(() => make([rows[0], { ...rows[1], commandId: ' bad-id ' }]),
    'FOLLOWER_SNAPSHOT_ROW_INVALID');
  rejects(() => make([rows[0], { ...rows[1], sequence: 1.5 }]),
    'FOLLOWER_SNAPSHOT_ROW_INVALID');
  rejects(() => make([rows[0], { ...rows[1], unexpected: true }]),
    'FOLLOWER_SNAPSHOT_ROW_INVALID');
  rejects(() => make([{ ...rows[0], sequence: Number.MAX_SAFE_INTEGER + 1 }]),
    'FOLLOWER_SNAPSHOT_ROW_INVALID');
});

test('invalid binding or untrusted caller-supplied digest and count rejected', () => {
  rejects(() => make(rows, { ...binding, allowedSymbols: ['XAUUSD', 'XAUUSD'] }),
    'FOLLOWER_SNAPSHOT_SYMBOLS_NOT_CANONICAL');
  rejects(() => make(rows, { ...binding, allowedSymbols: ['XAUUSD', 'XAGUSD'] }),
    'FOLLOWER_SNAPSHOT_SYMBOLS_NOT_CANONICAL');
  rejects(() => make(rows, { ...binding, licenseId: '  ' }),
    'FOLLOWER_SNAPSHOT_BINDING_INVALID');
  rejects(() => make(rows, { ...binding, mt5Login: -1 }),
    'FOLLOWER_SNAPSHOT_BINDING_INVALID');
  rejects(() => snapshot({ binding, records: rows, journalDigestSha256: '0'.repeat(64) }),
    'FOLLOWER_SNAPSHOT_INPUT_INVALID');
  rejects(() => snapshot({ binding, records: rows, maxSequence: 99 }),
    'FOLLOWER_SNAPSHOT_INPUT_INVALID');
  rejects(() => snapshot({ binding, records: 'not-array' }),
    'FOLLOWER_SNAPSHOT_INPUT_INVALID');
});

test('synthetic snapshot cannot be mistaken for independent checkpoint authorization', () => {
  const original = make();
  const rolledBack = make([rows[0]]);
  assert.notEqual(original.journalDigestSha256, rolledBack.journalDigestSha256);
  assert.equal(rolledBack.maxSequence, 1);
  assert.equal(rolledBack.pendingReservedCount, 0);
  // A local rollback produces a different but internally valid digest.
  // There is no external authority in this pure module to prove which is latest.
  assert.equal(Object.hasOwn(rolledBack, 'brokerExecutionAllowed'), false);
  assert.equal(Object.hasOwn(rolledBack, 'independentAuthorityVerified'), false);
});
