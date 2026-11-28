import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync("src/pages/PortalsControlUnit.jsx","utf8");

test("PCU organisation-node assignees are selected by label, not manually entered IDs",()=>{
  assert.match(source,/assigneeType==="ORG_NODE"\?<label>Organisation node <select/);
  assert.match(source,/org\.nodes\.map\(n=><option key=\{n\.id\} value=\{n\.id\}>\{n\.name\}/);
  assert.doesNotMatch(source,/Assignee UID or node ID <input/);
});

test("PCU named assignees are limited to active records with a linked UID",()=>{
  assert.match(source,/typeof x\.uid==="string"&&x\.uid\.trim\(\)/);
  assert.match(source,/isActiveIdentity\(x\)/);
  assert.match(source,/x\.firebaseAuthDisabled!==true/);
  assert.match(source,/staff\.map\(person=><option key=\{person\.uid\} value=\{person\.uid\}>/);
  assert.match(source,/Only active records with a verified linked Firebase UID are available/);
});

test("PCU assignment validates the selected node or identity against loaded records",()=>{
  assert.match(source,/!org\.nodes\.some\(x=>x\.id===assigneeId\)/);
  assert.match(source,/!staff\.some\(x=>x\.uid===assigneeId\)/);
  assert.match(source,/permissionsActivated:false/);
});
