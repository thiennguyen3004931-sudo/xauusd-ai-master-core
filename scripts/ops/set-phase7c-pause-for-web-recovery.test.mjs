import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setApprovedRecoveryPause, RECOVERY_APPROVAL } from './set-phase7c-pause-for-web-recovery.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t, mode = 'SEMI') {
  const root = mkdtempSync(join(tmpdir(), 'xauusd-approved-pause-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const modeFile = join(root, '.runtime', 'phase7c-bot-mode.json');
  const servicePath = join(root, 'canonical-mode.service.ts');
  mkdirSync(dirname(modeFile), { recursive: true });
  copyFileSync(new URL('../../apps/api/src/services/phase7c-bot-mode.service.ts', import.meta.url), servicePath);
  writeFileSync(modeFile, JSON.stringify({ mode, updatedAt: 'synthetic-time', updatedBy: 'synthetic-operator' }));
  const source = readFileSync(servicePath);
  const expectedServiceBlob = createHash('sha1').update(Buffer.from('blob ' + source.length + '\0')).update(source).digest('hex');
  return {
    root, modeFile, servicePath, expectedServiceBlob,
    expectedModeDigest: digest(readFileSync(modeFile)), confirmation: RECOVERY_APPROVAL,
  };
}

test('approved pause uses the canonical service and records the SEMI to PAUSE audit', async t => {
  const args = fixture(t);
  assert.deepEqual(await setApprovedRecoveryPause(args), { fromMode: 'SEMI', toMode: 'PAUSE', barrierDrained: true });
  const actual = JSON.parse(readFileSync(args.modeFile, 'utf8'));
  assert.equal(actual.mode, 'PAUSE');
  assert.equal(actual.updatedBy, 'operator-approved-web-recovery-20261105');
  const audit = JSON.parse(readFileSync(join(dirname(args.modeFile), 'phase7c-bot-mode-audit.jsonl'), 'utf8'));
  assert.equal(audit.fromMode, 'SEMI');
  assert.equal(audit.toMode, 'PAUSE');
});

test('missing explicit approval leaves the mode and audit untouched', async t => {
  const args = fixture(t);
  await assert.rejects(setApprovedRecoveryPause({ ...args, confirmation: '' }), /APPROVAL_REQUIRED/);
  assert.equal(digest(readFileSync(args.modeFile)), args.expectedModeDigest);
  assert.equal(existsSync(join(dirname(args.modeFile), 'phase7c-bot-mode-audit.jsonl')), false);
});

test('a changed mode snapshot is rejected before writing', async t => {
  const args = fixture(t);
  writeFileSync(args.modeFile, JSON.stringify({ mode: 'AUTO' }));
  await assert.rejects(setApprovedRecoveryPause(args), /MODE_CHANGED/);
  assert.equal(JSON.parse(readFileSync(args.modeFile, 'utf8')).mode, 'AUTO');
});

test('an unapproved current mode is rejected with a matching snapshot hash', async t => {
  const args = fixture(t, 'AUTO');
  await assert.rejects(setApprovedRecoveryPause(args), /MODE_NOT_APPROVED/);
  assert.equal(digest(readFileSync(args.modeFile)), args.expectedModeDigest);
});

test('a mismatched canonical service source is rejected before writing', async t => {
  const args = fixture(t);
  await assert.rejects(setApprovedRecoveryPause({ ...args, expectedServiceBlob: '0'.repeat(40) }), /SERVICE_SOURCE_MISMATCH/);
  assert.equal(digest(readFileSync(args.modeFile)), args.expectedModeDigest);
});

test('already PAUSE is idempotent and preserves its existing provenance', async t => {
  const args = fixture(t, 'PAUSE');
  assert.deepEqual(await setApprovedRecoveryPause(args), { fromMode: 'PAUSE', toMode: 'PAUSE', barrierDrained: true });
  assert.equal(digest(readFileSync(args.modeFile)), args.expectedModeDigest);
  assert.equal(existsSync(join(dirname(args.modeFile), 'phase7c-bot-mode-audit.jsonl')), false);
});

test('an undrained execution barrier blocks recovery while retaining PAUSE', async t => {
  const args = fixture(t);
  const lock = join(dirname(args.modeFile), 'phase7c-executors', 'phase7c-execution.lock');
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, 'synthetic-lock');
  await assert.rejects(setApprovedRecoveryPause({ ...args, pauseBarrierTimeoutMs: 0 }), /PAUSE_BARRIER_NOT_DRAINED/);
  assert.equal(JSON.parse(readFileSync(args.modeFile, 'utf8')).mode, 'PAUSE');
});
