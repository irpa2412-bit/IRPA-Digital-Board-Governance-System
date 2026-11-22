import test from "node:test";
import assert from "node:assert/strict";
import { buildMultipartBody } from "../src/documentLifecycle.mjs";

test("multipart request uses actual CRLF framing rather than backslash literals",()=>{
  const boundary="irpa-multipart-check";
  const payload=new TextEncoder().encode("payload");
  const {body,contentType}=buildMultipartBody({boundary,folderId:"folder",fileName:"file.pdf",contentType:"application/pdf",bytes:payload,description:{irpaGovernance:true}});
  const text=new TextDecoder().decode(body);
  assert.equal(contentType,"multipart/related; boundary="+boundary);
  assert.ok(text.includes("--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"));
  assert.ok(text.includes("\r\n--"+boundary+"\r\nContent-Type: application/pdf\r\n\r\npayload\r\n--"+boundary+"--"));
  assert.equal(text.includes("\\r\\n"),false);
});
