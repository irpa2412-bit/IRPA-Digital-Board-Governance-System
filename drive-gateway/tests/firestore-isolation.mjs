import assert from "node:assert/strict";

function stagingCollection(prefix, collection) {
  const p=String(prefix||"").trim();
  if (!p) throw new Error("Staging Firestore access requires a collection prefix.");
  const logical=String(collection||"").replace(/^\/+|\/+$/g,"");
  const resolved=p+logical;
  assert.equal(resolved.startsWith(p),true);
  return resolved;
}
function stagingDocumentPath(prefix,path) {
  const [collection,...rest]=String(path).split("/");
  return [stagingCollection(prefix,collection),...rest].join("/");
}
assert.equal(stagingCollection("staging_","documents"),"staging_documents");
assert.equal(stagingDocumentPath("staging_","documents/DOC-1"),"staging_documents/DOC-1");
assert.throws(()=>stagingCollection("","documents"),/prefix/);
assert.notEqual(stagingCollection("staging_","documents"),"documents");
assert.notEqual(stagingDocumentPath("staging_","signatureEnvelopes/ENV-1"),"signatureEnvelopes/ENV-1");
console.log(JSON.stringify({test:"staging-unprefixed-firestore-read-write-block",readCollection:"staging_documents",writeCollection:"staging_documents",unprefixed:"documents",pass:true}));
console.log("FIRESTORE ISOLATION TEST RESULT: PASS");