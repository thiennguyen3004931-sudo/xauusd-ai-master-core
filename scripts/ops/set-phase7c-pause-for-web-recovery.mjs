import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RECOVERY_APPROVAL = 'USER_APPROVED_SEMI_TO_PAUSE_WEB_RECOVERY_20261105';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');

export async function setApprovedRecoveryPause({
  modeFile, servicePath, expectedServiceBlob, expectedModeDigest, confirmation,
  pauseBarrierTimeoutMs = 5000,
}) {
  if (confirmation !== RECOVERY_APPROVAL) throw new Error('WEB_RECOVERY_APPROVAL_REQUIRED');
  if (!/^[a-f0-9]{40}$/.test(expectedServiceBlob) || !/^[a-f0-9]{64}$/.test(expectedModeDigest)) {
    throw new Error('WEB_RECOVERY_PROVENANCE_INVALID');
  }
  const modeBytes = readFileSync(modeFile);
  if (digest(modeBytes) !== expectedModeDigest) throw new Error('WEB_RECOVERY_MODE_CHANGED');
  const previous = JSON.parse(modeBytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (!['SEMI', 'PAUSE'].includes(previous.mode)) throw new Error('WEB_RECOVERY_MODE_NOT_APPROVED');
  const serviceBytes = readFileSync(servicePath);
  // Git's Windows checkout may expand LF to CRLF. Permit only that exact
  // byte transformation; every other source byte still has to match the
  // pinned Git object. Do not trim, decode/re-encode, or normalize other text.
  const serviceLfBytes = serviceBytes.filter((byte, index) =>
    byte !== 13 || serviceBytes[index + 1] !== 10);
  const serviceSourceMatch = gitBlob(serviceBytes) === expectedServiceBlob ? 'EXACT'
    : serviceLfBytes.length !== serviceBytes.length && gitBlob(serviceLfBytes) === expectedServiceBlob
      ? 'CRLF_CANONICAL' : null;
  if (!serviceSourceMatch) throw new Error('WEB_RECOVERY_SERVICE_SOURCE_MISMATCH');

  const { Phase7CBotModeService } = await import(pathToFileURL(servicePath).href);
  if (digest(readFileSync(servicePath)) !== digest(serviceBytes)) {
    throw new Error('WEB_RECOVERY_SERVICE_SOURCE_CHANGED');
  }
  const service = new Phase7CBotModeService(modeFile);
  if (digest(readFileSync(modeFile)) !== expectedModeDigest || service.get().mode !== previous.mode) {
    throw new Error('WEB_RECOVERY_MODE_CHANGED');
  }
  if (previous.mode === 'SEMI') {
    service.set('PAUSE', 'operator-approved-web-recovery-20261105');
  }
  const barrier = await service.waitForPauseBarrierDrain(pauseBarrierTimeoutMs, 25);
  if (!barrier.drained) throw new Error('WEB_RECOVERY_PAUSE_BARRIER_NOT_DRAINED');
  const persisted = JSON.parse(readFileSync(modeFile, 'utf8').replace(/^\uFEFF/, ''));
  if (persisted.mode !== 'PAUSE') throw new Error('WEB_RECOVERY_PAUSE_NOT_PERSISTED');
  return { fromMode: previous.mode, toMode: 'PAUSE', barrierDrained: true, serviceSourceMatch };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [modeFile, servicePath, expectedServiceBlob, expectedModeDigest, confirmation] = process.argv.slice(2);
  try {
    const result = await setApprovedRecoveryPause({
      modeFile, servicePath, expectedServiceBlob, expectedModeDigest, confirmation,
    });
    console.log('WEB_RECOVERY_SERVICE_SOURCE_MATCH=' + result.serviceSourceMatch);
    console.log('WEB_RECOVERY_MODE_BEFORE=' + result.fromMode);
    console.log('WEB_RECOVERY_MODE_AFTER=' + result.toMode);
    console.log('WEB_RECOVERY_PAUSE_BARRIER_DRAINED=' + result.barrierDrained);
  } catch (error) {
    console.error('WEB_RECOVERY_PAUSE_STATUS=BLOCKED');
    const reason = /^WEB_RECOVERY_[A-Z_]+$/.test(error.message) ? error.message : 'WEB_RECOVERY_PAUSE_IO_ERROR';
    console.error('WEB_RECOVERY_PAUSE_REASON=' + reason);
    process.exitCode = 1;
  }
}
