import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signEd25519 } from 'node:crypto';
import {
  compareFollowerJournalWithWitness as compare,
  FOLLOWER_WITNESS_DOMAIN,
} from './customer-follower-journal-witness-compare.mjs';

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
