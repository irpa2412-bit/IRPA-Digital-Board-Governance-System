import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("invitation workflow reuses its static Firestore and config imports", async () => {
  const source = await readFile(new URL("../src/firebase/invitationWorkflow.js", import.meta.url), "utf8");
  assert.match(source, /import \{ auth, db \} from "\.\/config";/);
  assert.match(source, /import \{ doc, getDocs, query, collection, serverTimestamp, setDoc, where \} from "firebase\/firestore";/);
  assert.doesNotMatch(source, /await import\(["']firebase\/firestore["']\)/);
  assert.doesNotMatch(source, /await import\(["']\.\/config["']\)/);
  const authSource = await readFile(new URL("../src/firebase/auth.js", import.meta.url), "utf8");
  assert.match(authSource, /import \{ provisionCurrentMemberFromInvitationV2 \} from "\.\/invitationWorkflow";/);
  assert.doesNotMatch(authSource, /await import\(["']\.\/invitationWorkflow["']\)/);
});
