import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("signature workflow has no reachable direct Firestore write SDK calls",()=>{
  const result=spawnSync(process.execPath,["scripts/check-signature-no-firestore-writes.mjs"],{encoding:"utf8"});
  assert.equal(result.status,0,result.stdout+"\n"+result.stderr);
  assert.match(result.stdout,/PASS: no direct Firestore write SDK call is reachable/);
});
