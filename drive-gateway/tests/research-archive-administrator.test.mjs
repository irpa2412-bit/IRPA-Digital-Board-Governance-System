import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { resolveIdentity, canUpload, canRead, buildDocumentRecord } from "../src/documentPolicy.mjs";

test("active Administrator outside Research can upload, retrieve and cannot classify Research Archive as Public",()=>{
  const identity=resolveIdentity({
    uid:"admin-outside-research",
    email:"administrator@irpa.or.tz",
    admin:{active:true},
    employee:{status:"Active",department:"Finance",roles:["Finance Director"]}
  });
  assert.equal(identity.actorType,"ADMINISTRATOR");
  assert.equal(identity.department,"Finance");
  const uploadPolicy=canUpload(identity,{
    documentType:"Research Archive",
    archiveCategory:"Research Documents",
    classification:"Confidential",
    contentType:"application/pdf"
  });
  assert.equal(uploadPolicy.allowed,true);
  const record=buildDocumentRecord(identity,{
    title:"Administrator Research Archive Record",
    documentType:"Research Archive",
    archiveCategory:"Research Documents",
    classification:"Confidential"
  },{
    documentId:"LIFE-admin-research",
    fileId:"drive-admin-research",
    fileName:"research.pdf",
    fileSize:4,
    sha256:"a".repeat(64),
    archivePath:"Research Documents/Confidential"
  });
  assert.equal(record.classification,"Confidential");
  assert.equal(canRead(identity,record).allowed,true);
  const publicPolicy=canUpload(identity,{
    documentType:"Research Archive",
    archiveCategory:"Research Documents",
    classification:"Public",
    contentType:"application/pdf"
  });
  assert.equal(publicPolicy.allowed,false);
  assert.equal(publicPolicy.reason,"Research Archive documents cannot be classified as Public.");
});

test("Gateway Research Archive policy-check, upload, archive-folder and registration paths retain administrator authority checks",async()=>{
  const source=await readFile(new URL("../src/index.js",import.meta.url),"utf8");
  assert.match(source,/function isActiveResearchArchiveAuthority\(memberRecord, employeeRecord, adminRecord\) \{\s*if \(adminRecord\?\.fields\?\.active\?\.booleanValue === true\) return true;/);
  const checks=source.match(/isActiveResearchArchiveAuthority\(memberRecord, ?employeeRecord, ?adminRecord\)/g)||[];
  assert.ok(checks.length>=4,"policy-check, upload, archive-folder and registration paths must all consult the shared authority check");
  assert.match(source,/async function controlledDocumentUploadPolicyCheck\([\s\S]*?isActiveResearchArchiveAuthority\(memberRecord, employeeRecord, adminRecord\)/);
  assert.match(source,/async function uploadControlledDocument\([\s\S]*?isActiveResearchArchiveAuthority\(memberRecord, employeeRecord, adminRecord\)/);
  assert.match(source,/async function ensureDocumentArchiveFolder\([\s\S]*?isActiveResearchArchiveAuthority\(memberRecord,employeeRecord,adminRecord\)/);
  assert.match(source,/async function registerControlledDocumentRecord\([\s\S]*?isActiveResearchArchiveAuthority\(memberRecord,employeeRecord,adminRecord\)/);
});
