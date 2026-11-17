import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync("src/pages/SignaturePlatform.jsx","utf8");

test("palette field placement assigns new fields to the active signer, including an owner-only workflow",()=>{
  assert.match(source,/const addAt=\(type,x=50,y=20\)=>\{if\(!recipients\.length&&!activeAssigneeUid\)/);
  assert.match(source,/makeField\(type,fields\.length,activeAssigneeUid\|\|"",pageNum\)/);
  assert.ok(source.includes('recipients={workflowRecipients} ownerSigner={ownerSigningEnabled?documentOwner:null}'));
});

test("document owner can be explicitly enabled and assigned signature fields",()=>{
  assert.ok(source.includes('checked={ownerSigningEnabled}'));
  assert.ok(source.includes('data-owner-signature-placement="true"'));
  assert.ok(source.includes('addOwnerSignatureAt'));
  assert.ok(source.includes('if(ownerSigningEnabled&&!fields.some'));
});

test("palette roll-down exposes signer removal while protecting the document owner",()=>{
  assert.ok(source.includes('data-testid="palette-signer-management"'));
  assert.ok(source.includes('data-testid={"palette-remove-signer-"+r.uid}'));
  assert.ok(source.includes('onRemoveSigner={removeSigner}'));
  assert.match(source,/function removeSigner\(uid\)\{if\(!uid\|\|uid===documentOwner\.uid\)return/);
  assert.match(source,/setFields\(prev=>prev\.map\(f=>f\.signerUid===uid\?\{\.\.\.f,signerUid:""\}:f\)\)/);
});

test("removing an assigned signer leaves their fields explicitly unassigned for reassignment",()=>{
  assert.ok(source.includes('Their fields are now unassigned; assign them to another signer or the document owner before creating the envelope.'));
  assert.ok(source.includes('Assign every field to the document owner or an assigned signer before creating the envelope.'));
});
