import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAuthorityFixture } from "./customer-restore-authority-file-fixture.mjs";
import { commitAuthorityTransition } from "./customer-restore-authority-atomic-cas.mjs";

const initial = { customerId:"c", installationId:"i", licenseId:"l", grantId:"g", bindingEpoch:"e", authorizationState:"ACTIVE", revocationGeneration:1, migrationGeneration:1, challengeConsumptionGeneration:1, auditHighWater:3, tokenGeneration:1 };
const updated = { ...initial, auditHighWater:4, revocationGeneration:2, authorizationState:"REVOKED" };
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "xau-authority-"));
  t.after(() => rm(root, { recursive:true, force:true }));
  const independent = join(root,"operator-authority");
  const customerBackup = join(root,"customer-restorable");
  await mkdir(independent); await mkdir(customerBackup);
  await writeFile(join(independent,"key.json"),JSON.stringify(initial));
  await writeFile(join(customerBackup,"key.json"),JSON.stringify(initial));
  return { independent, customerBackup, adapter:new FileAuthorityFixture(independent) };
}
const commit = (adapter, next=updated, expectedAuditHighWater=3) => commitAuthorityTransition({adapter,bindingKey:"key",next,expectedAuditHighWater});
test("operator authority update survives stale customer backup restore",async t=>{
  const { independent,customerBackup,adapter }=await setup(t);
  assert.equal((await commit(adapter)).ok,true);
  // Simulated customer backup restore does not touch the operator-controlled authority directory.
  await writeFile(join(customerBackup,"key.json"),JSON.stringify(initial));
  assert.equal(JSON.parse(await readFile(join(independent,"key.json"),"utf8")).authorizationState,"REVOKED");
  assert.equal((await commit(adapter,updated)).reasonCode,"AUTHORITY_CAS_CONFLICT");
});
test("missing authority state denies instead of reinitializing",async t=>{
  const {independent,adapter}=await setup(t);
  await rm(join(independent,"key.json"));
  assert.equal((await commit(adapter)).ok,false);
});
test("corrupt authority state denies",async t=>{
  const {independent,adapter}=await setup(t);
  await writeFile(join(independent,"key.json"),"not-json");
  assert.equal((await commit(adapter)).ok,false);
});
test("existing lock denies rather than bypassing",async t=>{
  const {independent,adapter}=await setup(t);
  await mkdir(join(independent,"key.lock"));
  assert.equal((await commit(adapter)).ok,false);
});
test("second stale writer denied after durable fixture update",async t=>{
  const {adapter}=await setup(t);
  assert.equal((await commit(adapter)).ok,true);
  assert.equal((await commit(adapter)).reasonCode,"AUTHORITY_CAS_CONFLICT");
});
test("unsafe binding key denied",async t=>{
  const {adapter}=await setup(t);
  assert.equal((await commitAuthorityTransition({adapter,bindingKey:"../escape",next:updated,expectedAuditHighWater:3})).ok,false);
});
