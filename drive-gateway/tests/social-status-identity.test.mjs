import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../src/socialPublishing.mjs",import.meta.url),"utf8");
test("social status accepts the Worker verifier's user_id claim as the authenticated UID",()=>{
 assert.match(source,/identity\?\.uid \|\| identity\?\.user_id \|\| identity\?\.sub/);
 assert.match(source,/identity = \{ \.\.\.identity, uid \}/);
});
test("social status still rejects requests without any authenticated UID",()=>{
 assert.match(source,/if \(!uid\) throw new Error\("Authenticated identity required\."\)/);
});
