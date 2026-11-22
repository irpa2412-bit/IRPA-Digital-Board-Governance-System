import test from "node:test";
import assert from "node:assert/strict";
import {
  checkMeetingAuthority, loadMeetingAuthorityRegisters, resolveMeetingAuthority,
  MEETING_AUTHORITY_COLLECTIONS
} from "../src/firebase/meetingAuthority.js";
import { resolveMeetingAuthority as workerResolver } from "../drive-gateway/src/meetingAuthority.mjs";

const actor = { uid: "client-uid", email: "ed@irpa.or.tz" };
const registers = {
  members: [],
  employees: [{ uid: "client-uid", email: "ed@irpa.or.tz", role: "Executive Director", status: "Active" }],
  departments: [],
  departmentHeads: [],
  accessRecords: []
};

test("direct mode reads current registers and uses the shared Worker policy", async () => {
  let reads = 0;
  const result = await checkMeetingAuthority({
    gatewayEnabled: false,
    actor,
    duty: "manage meeting agenda",
    loadRegisters: async () => { reads++; return registers; }
  });
  assert.equal(reads, 1);
  assert.equal(result.allowed, true);
  assert.equal(result.authorities[0].role, "Executive Director");
});

test("gateway mode delegates to Worker and does not fall back to browser register reads", async () => {
  let workerCalls = 0, registerCalls = 0;
  const result = await checkMeetingAuthority({
    gatewayEnabled: true,
    actor,
    meeting: { id: "meeting-1" },
    duty: "manage proceedings",
    getRecords: async () => { registerCalls++; return []; },
    callWorker: async payload => {
      workerCalls++;
      assert.deepEqual(payload, { meetingId: "meeting-1", duty: "manage proceedings" });
      return { allowed: true, authorities: [{ role: "Executive Director", sourceCollection: "employees" }], reason: "Worker verified active authority." };
    }
  });
  assert.equal(workerCalls, 1);
  assert.equal(registerCalls, 0);
  assert.equal(result.allowed, true);
});

test("direct lookup failure denies access with a specific reason", async () => {
  const result = await checkMeetingAuthority({ gatewayEnabled: false, actor, duty: "open meeting room", loadRegisters: async () => { throw new Error("unavailable"); } });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Direct Member, Employee and Department\/HOD register lookup failed/);
  assert.match(result.reason, /open meeting room/);
});

test("Worker lookup failure and malformed Worker responses fail closed", async () => {
  const failed = await checkMeetingAuthority({ gatewayEnabled: true, duty: "read minutes", callWorker: async () => { throw new Error("offline"); } });
  const malformed = await checkMeetingAuthority({ gatewayEnabled: true, duty: "read minutes", callWorker: async () => ({ ok: true }) });
  assert.equal(failed.allowed, false);
  assert.equal(malformed.allowed, false);
  assert.match(failed.reason, /Worker lookup failed/);
  assert.match(malformed.reason, /invalid response/);
});

test("register loader reads Members, Employees, departments, HOD and access records directly", async () => {
  const calls = [];
  const data = await loadMeetingAuthorityRegisters(async name => {
    calls.push(name);
    return name === "employees" ? [{ uid: "client-uid" }] : [];
  });
  assert.deepEqual(calls.sort(), Object.values(MEETING_AUTHORITY_COLLECTIONS).sort());
  assert.equal(data.employees.length, 1);
  assert.deepEqual(data.members, []);
  assert.deepEqual(data.departmentHeads, []);
});

test("client and Worker resolver exports are the same policy implementation", () => {
  assert.equal(resolveMeetingAuthority, workerResolver);
  const decision = resolveMeetingAuthority({ actor, ...registers, duty: "manage meeting" });
  assert.equal(decision.allowed, true);
});
