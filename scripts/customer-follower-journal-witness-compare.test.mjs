import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signEd25519 } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  compareFollowerJournalWithWitness as compare,
  FOLLOWER_WITNESS_DOMAIN,
} from './customer-follower-journal-witness-compare.mjs';
import { createFollowerCanonicalJournalSnapshot } from './customer-follower-journal-canonical-state.mjs';

const NOW = 1_800_000_000_000;
const NONCE = 'synthetic-follower-restore-nonce-2026';
const pair = generateKeyPairSync('ed25519');
const publicKeyPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const keyDigest = createHash('sha256')
  .update(pair.publicKey.export({ format: 'der', type: 'spki' })).digest('hex');
const binding = Object.freeze({
  licenseId: 'synthetic-license', installationId: 'synthetic-installation',
  mt5Login: 770001, brokerServer: 'Synthetic-Demo', allowedSymbols: ['XAUUSD'],
});
const digest = c => createHash('sha256').update(c).digest('hex');
const localJournal = Object.freeze({
  binding, maxSequence: 8, journalDigestSha256: digest('synthetic-journal-head-8'),
  pendingReservedCount: 0,
});
const root = Object.freeze({ keyId: 'independent-witness-1', keyEpoch: 7,
  publicKeyPem, publicKeySha256: keyDigest });
const trustedCheckpoint = Object.freeze({ ...localJournal, keyEpoch: 7 });
function proof(snapshot=localJournal, opts={}) {
  const s = {
    schemaVersion: 1, authorityKeyId: root.keyId, keyEpoch: 7,
    requestNonce: NONCE, issuedAt: NOW, expiresAt: NOW + 10_000,
    ...snapshot, ...opts,
  };
  const fields = [s.schemaVersion, s.authorityKeyId, s.keyEpoch, s.requestNonce,
    s.issuedAt, s.expiresAt, s.binding.licenseId, s.binding.installationId,
    s.binding.mt5Login, s.binding.brokerServer, s.binding.allowedSymbols,
    s.maxSequence, s.journalDigestSha256, s.pendingReservedCount];
  const signatureBase64 = signEd25519(null,
    Buffer.from(FOLLOWER_WITNESS_DOMAIN + JSON.stringify(fields)), pair.privateKey).toString('base64');
  return { statement: s, signatureBase64 };
}
const evaluate=(options={})=>compare({ localJournal, witnessProof:proof(),
  trustedWitnessRoot: root, trustedCheckpoint, expectedNonce: NONCE, nowMs:NOW+1_000,
  ...options });
const denied=(result,reason)=>assert.deepEqual(result,{evidenceMatched:false,brokerExecutionAllowed:false,reasonCode:reason});

test('matching synthetic independent checkpoint evidence is NOT trading permission',()=>{
  assert.deepEqual(evaluate(),{
    evidenceMatched:true,brokerExecutionAllowed:false,
    reasonCode:'SYNTHETIC_FOLLOWER_WITNESS_MATCH_ONLY',
  });
});
test('missing independent witness/key/floor fails closed',()=>{
  denied(evaluate({witnessProof:undefined}),'WITNESS_PROOF_REQUIRED');
  denied(evaluate({trustedWitnessRoot:undefined}),'PINNED_WITNESS_ROOT_REQUIRED');
  denied(evaluate({trustedCheckpoint:undefined}),'INDEPENDENT_CHECKPOINT_REQUIRED');
});
test('older local journal rejected by independently signed latest head',()=>{
  denied(evaluate({localJournal:{...localJournal,maxSequence:7,journalDigestSha256:digest('old-7')}}),'LOCAL_JOURNAL_ROLLBACK');
});
test('same sequence but different journal content rejected (fork)',()=>{
  denied(evaluate({localJournal:{...localJournal,journalDigestSha256:digest('fork-8')}}),'LOCAL_JOURNAL_FORK');
});
test('witness signed for old sequence cannot override independently held high water',()=>{
  denied(evaluate({witnessProof:proof({...localJournal,maxSequence:7,journalDigestSha256:digest('old-7')})}),
    'WITNESS_HIGH_WATER_ROLLBACK');
});
test('independent checkpoint must be synchronized, not stale or divergent',()=>{
  denied(evaluate({trustedCheckpoint:{...trustedCheckpoint,maxSequence:7}}),'CHECKPOINT_BEHIND_WITNESS');
  denied(evaluate({trustedCheckpoint:{...trustedCheckpoint,journalDigestSha256:digest('different-8')}}),
    'WITNESS_CHECKPOINT_FORK');
});
test('uncertain reserved commands never produce a passing witness result',()=>{
  const pending={...localJournal,pendingReservedCount:1};
  denied(evaluate({localJournal:pending,witnessProof:proof(pending),
    trustedCheckpoint:{...pending,keyEpoch:7}}),'UNRESOLVED_RESERVATIONS');
});
test('wrong customer/account/broker binding cannot reuse signed head',()=>{
  denied(evaluate({localJournal:{...localJournal,binding:{...binding,mt5Login:770002}}}),
    'FOLLOWER_BINDING_MISMATCH');
});
test('tampered signature, wrong key pin and cross-purpose signature are rejected',()=>{
  const valid=proof();
  const bad={...valid,signatureBase64:valid.signatureBase64.slice(0,-2)+'AA'};
  denied(evaluate({witnessProof:bad}),'WITNESS_SIGNATURE_INVALID');
  denied(evaluate({trustedWitnessRoot:{...root,publicKeySha256:digest('wrong-key')}}),
    'WITNESS_KEY_PIN_MISMATCH');
  const arr=[valid.statement.schemaVersion,valid.statement.authorityKeyId,valid.statement.keyEpoch,
    valid.statement.requestNonce,valid.statement.issuedAt,valid.statement.expiresAt,
    binding.licenseId,binding.installationId,binding.mt5Login,binding.brokerServer,binding.allowedSymbols,
    valid.statement.maxSequence,valid.statement.journalDigestSha256,valid.statement.pendingReservedCount];
  const unrelated=signEd25519(null,
    Buffer.from('XAUUSD-CUSTOMER-RESTORE-AUTHORITY-V1\n'+JSON.stringify(arr)),pair.privateKey)
    .toString('base64');
  denied(evaluate({witnessProof:{...valid,signatureBase64:unrelated}}),'WITNESS_SIGNATURE_INVALID');
});
test('nonce/freshness/epoch and unexpected schema fail closed',()=>{
  denied(evaluate({expectedNonce:'other-nonce-1234567890'}),'WITNESS_NONCE_MISMATCH');
  denied(evaluate({nowMs:NOW+10_000}),'WITNESS_EXPIRED_OR_INVALID');
  denied(evaluate({trustedCheckpoint:{...trustedCheckpoint,keyEpoch:8}}),'WITNESS_ROOT_OR_EPOCH_MISMATCH');
  denied(evaluate({witnessProof:proof(localJournal,{extra:true})}),'WITNESS_PROOF_REQUIRED');
});
test('local journal ahead of witness also blocks pending reconciliation',()=>{
  denied(evaluate({localJournal:{...localJournal,maxSequence:9,journalDigestSha256:digest('ahead-9')}}),
    'LOCAL_JOURNAL_AHEAD_OF_WITNESS');
});
test('known gap: if BOTH checkpoint and proof roll back, pure comparison cannot detect it',()=>{
  const old={...localJournal,maxSequence:7,journalDigestSha256:digest('old-journal-head-7')};
  const result=evaluate({localJournal:old,witnessProof:proof(old),trustedCheckpoint:{...old,keyEpoch:7}});
  assert.equal(result.evidenceMatched,true);
  assert.equal(result.brokerExecutionAllowed,false);
  // This demonstrates the need for a genuine independent anti-rollback root, not a feature PASS.
});

test('known gap: forged witness root and rolled-back checkpoint can agree but never enable broker',()=>{
  // The pure comparator CANNOT authenticate the provenance of its caller-supplied
  // "trusted" root/checkpoint. Only an external, non-rollbackable authority can.
  const attackerPair=generateKeyPairSync('ed25519');
  const attackerPublicKeyPem=attackerPair.publicKey.export({format:'pem',type:'spki'}).toString();
  const attackerPublicKeySha256=createHash('sha256')
    .update(attackerPair.publicKey.export({format:'der',type:'spki'})).digest('hex');
  const swappedRoot={...root,keyId:'synthetic-swapped-witness-key',
    publicKeyPem:attackerPublicKeyPem,publicKeySha256:attackerPublicKeySha256};
  const older={...localJournal,maxSequence:2,
    journalDigestSha256:digest('synthetic-older-command-journal')};
  const statement={
    schemaVersion:1,authorityKeyId:swappedRoot.keyId,keyEpoch:swappedRoot.keyEpoch,
    requestNonce:NONCE,issuedAt:NOW,expiresAt:NOW+10_000,...older,
  };
  const fields=[
    statement.schemaVersion,statement.authorityKeyId,statement.keyEpoch,
    statement.requestNonce,statement.issuedAt,statement.expiresAt,
    statement.binding.licenseId,statement.binding.installationId,
    statement.binding.mt5Login,statement.binding.brokerServer,
    statement.binding.allowedSymbols,statement.maxSequence,
    statement.journalDigestSha256,statement.pendingReservedCount,
  ];
  const forgedProof={
    statement,
    signatureBase64:signEd25519(
      null,Buffer.from(FOLLOWER_WITNESS_DOMAIN+JSON.stringify(fields)),
      attackerPair.privateKey,
    ).toString('base64'),
  };
  const injected={
    localJournal:older,witnessProof:forgedProof,
    trustedCheckpoint:{...older,keyEpoch:swappedRoot.keyEpoch},
    trustedWitnessRoot:swappedRoot,
  };
  assert.deepEqual(evaluate(injected),{
    evidenceMatched:true,brokerExecutionAllowed:false,
    reasonCode:'SYNTHETIC_FOLLOWER_WITNESS_MATCH_ONLY',
  });
  // Holding the genuine independently pinned root defeats key substitution.
  denied(evaluate({...injected,trustedWitnessRoot:root}),
    'WITNESS_ROOT_OR_EPOCH_MISMATCH');
});


test('synthetic witness and journal-snapshot helpers must not be imported by operational executors',()=>{
  // Defense in depth only: source boundary guard, NOT evidence of
  // independent root custody, durable checkpoint, or safe broker execution.
  const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const required=['packages/customer-agent/src','packages/copy-protocol/src'];
  const optional=[
    'packages/customer-follower-state/src',
    'packages/customer-runtime-session/src',
    'apps/api/src',
    'scripts/customer-follower-demo',
  ];
  const unsafeImport=/\b(?:compareFollowerJournalWithWitness|createFollowerCanonicalJournalSnapshot)\b|customer-follower-journal-(?:witness-compare|canonical-state)\.mjs/;
  const activeSource=/\.(?:[cm]?js|tsx?)$/;
  const ignoreTest=/(?:^|[.\/\\])(?:__tests__|__fixtures__|tests?|fixtures?)(?:[\/\\]|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;
  const offenders=[];
  let checked=0;
  const walk=(directory)=>{
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      const absolute=join(directory,entry.name);
      const relative=absolute.slice(repoRoot.length+1).replaceAll('\\','/');
      if(ignoreTest.test(relative))continue;
      if(entry.isDirectory()){walk(absolute);continue;}
      if(!entry.isFile()||!activeSource.test(entry.name))continue;
      checked++;
      if(unsafeImport.test(readFileSync(absolute,'utf8')))offenders.push(relative);
    }
  };
  for(const path of required){
    const root=resolve(repoRoot,path);
    assert.ok(existsSync(root),'Required runtime source directory missing: '+path);
    walk(root);
  }
  for(const path of optional){
    const root=resolve(repoRoot,path);
    if(existsSync(root))walk(root);
  }
  assert.ok(checked>0,'No runtime sources were scanned');
  assert.deepEqual(offenders,[],'Synthetic witness or canonical journal snapshot helper leaked into operational runtime source');
});


test('real canonical rowset fork rejected by synthetic trusted checkpoint',()=>{
  // Both local snapshots recompute SHA-256 from the entire synthetic rowset,
  // rather than accepting a caller-provided digest string.
  const original=createFollowerCanonicalJournalSnapshot({
    binding,
    records:[{commandId:'synthetic-journal-command-a',sequence:8,state:'DISPATCHED'}],
  });
  const fork=createFollowerCanonicalJournalSnapshot({
    binding,
    records:[{commandId:'synthetic-journal-command-b',sequence:8,state:'DISPATCHED'}],
  });
  assert.notEqual(original.journalDigestSha256,fork.journalDigestSha256);
  assert.equal(original.maxSequence,fork.maxSequence);
  assert.deepEqual(evaluate({
    localJournal:original,witnessProof:proof(original),
    trustedCheckpoint:{...original,keyEpoch:root.keyEpoch},
  }),{
    evidenceMatched:true,brokerExecutionAllowed:false,
    reasonCode:'SYNTHETIC_FOLLOWER_WITNESS_MATCH_ONLY',
  });
  denied(evaluate({
    localJournal:fork,witnessProof:proof(original),
    trustedCheckpoint:{...original,keyEpoch:root.keyEpoch},
  }),'LOCAL_JOURNAL_FORK');
});

function createSqliteJournalFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'xauusd-follower-witness-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'journal.sqlite');
  const writer = new DatabaseSync(path);
  // Match the draft journal tables in PR #163. This fixture has no path input
  // from the environment and never opens an operator or customer database.
  writer.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE follower_binding (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL);
    CREATE TABLE follower_command_journal (
      command_id TEXT PRIMARY KEY,
      sequence INTEGER UNIQUE NOT NULL CHECK(sequence > 0),
      state TEXT NOT NULL CHECK(state IN ('RESERVED', 'DISPATCHED'))
    );
  `);
  writer.prepare('INSERT INTO follower_binding(id, payload) VALUES (1, ?)').run(JSON.stringify(binding));
  writer.exec("INSERT INTO follower_command_journal VALUES ('synthetic-sqlite-command', 1, 'RESERVED')");
  return { path, writer, backupPath: join(directory, 'backup.sqlite') };
}

function readSqliteBinding(db) {
  return JSON.parse(db.prepare('SELECT payload FROM follower_binding WHERE id = 1').get().payload);
}

function readSqliteSnapshot(db, journalBinding = readSqliteBinding(db)) {
  const records = db.prepare('SELECT command_id AS commandId, sequence, state FROM follower_command_journal').all();
  return createFollowerCanonicalJournalSnapshot({ binding: journalBinding, records });
}

test('one SQLite read transaction retains a consistent WAL snapshot across a concurrent commit', t => {
  const { path, writer } = createSqliteJournalFixture(t);
  try {
    assert.equal(writer.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    const before = readSqliteSnapshot(writer);
    const reader = new DatabaseSync(path, { readOnly: true });
    try {
      reader.exec('BEGIN');
      const pinnedBinding = readSqliteBinding(reader);
      writer.exec(`
        BEGIN IMMEDIATE;
        UPDATE follower_command_journal SET state = 'DISPATCHED' WHERE sequence = 1;
        INSERT INTO follower_command_journal VALUES ('synthetic-sqlite-next', 2, 'RESERVED');
        COMMIT;
      `);
      assert.deepEqual(readSqliteSnapshot(reader, pinnedBinding), before);
      reader.exec('COMMIT');

      const latest = readSqliteSnapshot(reader);
      assert.equal(latest.maxSequence, 2);
      assert.equal(latest.pendingReservedCount, 1);
      assert.notEqual(latest.journalDigestSha256, before.journalDigestSha256);
      const trusted = { witnessProof: proof(latest), trustedCheckpoint: { ...latest, keyEpoch: root.keyEpoch } };
      denied(evaluate({ ...trusted, localJournal: before }), 'LOCAL_JOURNAL_ROLLBACK');
      denied(evaluate({ ...trusted, localJournal: latest }), 'UNRESOLVED_RESERVATIONS');
    } finally {
      reader.close();
    }
  } finally {
    writer.close();
  }
});

test('a physical SQLite backup at the same sequence cannot match the newer synthetic checkpoint', async t => {
  const { writer, backupPath } = createSqliteJournalFixture(t);
  try {
    // SQLite's online backup captures a consistent copy, including committed WAL data.
    await backup(writer, backupPath);
    writer.exec("UPDATE follower_command_journal SET state = 'DISPATCHED' WHERE sequence = 1");
    const latest = readSqliteSnapshot(writer);
    const restored = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const previous = readSqliteSnapshot(restored);
      assert.equal(previous.maxSequence, latest.maxSequence);
      assert.equal(previous.pendingReservedCount, 1);
      assert.equal(latest.pendingReservedCount, 0);
      assert.notEqual(previous.journalDigestSha256, latest.journalDigestSha256);
      const trustedCheckpoint = { ...latest, keyEpoch: root.keyEpoch };
      denied(evaluate({ localJournal: previous, witnessProof: proof(latest), trustedCheckpoint }),
        'LOCAL_JOURNAL_FORK');
      denied(evaluate({ localJournal: previous, witnessProof: proof(previous), trustedCheckpoint }),
        'WITNESS_CHECKPOINT_FORK');
      assert.deepEqual(evaluate({ localJournal: latest, witnessProof: proof(latest), trustedCheckpoint }), {
        evidenceMatched: true, brokerExecutionAllowed: false, reasonCode: 'SYNTHETIC_FOLLOWER_WITNESS_MATCH_ONLY',
      });
    } finally {
      restored.close();
    }
  } finally {
    writer.close();
  }
});
