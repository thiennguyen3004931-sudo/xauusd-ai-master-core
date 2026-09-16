import test from "node:test";
import assert from "node:assert/strict";
import { comparePackageTrees } from "./verify-public-contract-lock.mjs";

test("contract drift fails closed", () => {
  assert.throws(
    () => comparePackageTrees(
      { "packages/copy-protocol": "aaa" },
      { "packages/copy-protocol": "bbb" },
    ),
    /PUBLIC_CONTRACT_DRIFT:packages\/copy-protocol/,
  );
});

test("exact public package trees are accepted", () => {
  const trees = {
    "packages/copy-protocol": "1111111111111111111111111111111111111111",
    "packages/license-service": "2222222222222222222222222222222222222222",
    "packages/installation-proof": "3333333333333333333333333333333333333333",
  };
  assert.doesNotThrow(() => comparePackageTrees(trees, { ...trees }));
});
