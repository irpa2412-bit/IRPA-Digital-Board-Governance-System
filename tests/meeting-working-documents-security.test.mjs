import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const room = readFileSync(new URL("../src/pages/MeetingRoom.jsx", import.meta.url), "utf8");
const backend = readFileSync(new URL("../functions/meetingRecords.js", import.meta.url), "utf8");
const exportsFile = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
const uploader = readFileSync(new URL("../src/components/ControlledDocumentUpload.jsx", import.meta.url), "utf8");

test("working document upload UI is host-controller gated and meeting-scoped", () => {
  assert.match(room, /controller&&<div className="panel"[^]*?Host: Upload Working Document/);
  assert.match(room, /workflowContextOverride=\{\{meetingId:meeting\.id,meetingReference:meeting\.reference\|\|meeting\.title\}\}/);
  assert.match(uploader, /workflowContextOverride = \{\}/);
  assert.match(uploader, /\{\.\.\.\(readWorkflowContext\(\) \|\| \{\}\), \.\.\.\(workflowContextOverride \|\| \{\}\)\}/);
});

test("server validates host authority and meeting/document linkage before registering uploads", () => {
  assert.match(backend, /exports\.registerMeetingWorkingDocument=onCall/);
  assert.match(backend, /if\(!ctx\.canManage\)throw new HttpsError\("permission-denied","Only the meeting host, chairperson or secretary may add working documents\."/);
  assert.match(backend, /text\(d\.meetingId\)!==meetingId/);
  assert.match(backend, /MEETING_WORKING_DOCUMENT_REGISTERED/);
  assert.match(exportsFile, /exports\.registerMeetingWorkingDocument = meetingWorkingDocuments\.registerMeetingWorkingDocument/);
});

test("only authorised meeting participants can submit bounded assessments/comments", () => {
  assert.match(backend, /exports\.submitMeetingDocumentReview=onCall/);
  assert.match(backend, /if\(!ctx\.canRead\|\|!ctx\.participant&&!ctx\.canManage\)/);
  assert.match(backend, /\["ASSESSMENT","COMMENT","SIGNATURE_REQUEST"\]/);
  assert.match(backend, /comment\.length>5000/);
  assert.match(backend, /MEETING_WORKING_DOCUMENT_REVIEW_SUBMITTED/);
  assert.match(backend, /exports\.listMeetingWorkingDocuments=onCall/);
});

test("signature workflow uses existing controlled Signature Platform and signer checks", () => {
  assert.match(room, /"Signature Platform",\{meetingId:meeting\.id,meetingReference:meeting\.reference\|\|meeting\.title,documentId:doc\.documentId/);
  assert.match(room, /Signing does not happen by comment submission/);
});
