import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Meeting entry request review uses Cloudflare APIs rather than Firebase callables", async () => {
  const [component,api]=await Promise.all([
    readFile(new URL("../src/components/MeetingAccessControl.jsx",import.meta.url),"utf8"),
    readFile(new URL("../src/firebase/meetingGatewayApi.js",import.meta.url),"utf8")
  ]);
  assert.doesNotMatch(component,/httpsCallable|getFunctions/);
  assert.match(component,/listMeetingEntryRequests\(meeting\.id\)/);
  assert.match(component,/resolveMeetingEntryRequest\(\{requestId,decision\}\)/);
  assert.match(api,/\/api\/meeting-entry\/requests\/list/);
  assert.match(api,/\/api\/meeting-entry\/requests\/resolve/);
});

test("Cloudflare entry request review enforces meeting authority, active passes, expiry and atomic audit", async () => {
  const worker=await readFile(new URL("../drive-gateway/src/meetingServices.mjs",import.meta.url),"utf8");
  assert.match(worker,/pathname==="\/api\/meeting-entry\/requests\/list"/);
  assert.match(worker,/pathname==="\/api\/meeting-entry\/requests\/resolve"/);
  assert.match(worker,/Only the meeting initiator, chairperson, secretary or active administrator may resolve entry requests/);
  assert.match(worker,/pass\.status!=="Active"/);
  assert.match(worker,/currentDocument:\{updateTime:row\.updateTime\}/);
  assert.match(worker,/MEETING_ENTRY_ADMITTED/);
  assert.match(worker,/MEETING_ENTRY_DENIED/);
});
