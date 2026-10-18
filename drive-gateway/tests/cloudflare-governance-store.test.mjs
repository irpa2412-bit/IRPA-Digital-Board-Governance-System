import test from "node:test";
import assert from "node:assert/strict";
import { createCloudflareGovernanceStore } from "../src/cloudflareGovernanceStore.mjs";

function fakeBinding() {
  const records = new Map();
  const index = new Set();
  const namespaces = new Map();
  const binding = {
    idFromName(name) { return name; },
    get(name) {
      if (!namespaces.has(name)) namespaces.set(name, { fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.key === "__index__") {
          if (body.op === "add") index.add(body.recordKey);
          if (body.op === "remove") index.delete(body.recordKey);
          if (body.op === "list") return Response.json({ ok: true, keys: [...index] });
          return Response.json({ ok: true });
        }
        if (body.op === "get") return Response.json({ ok: true, value: records.get(body.key) || null });
        if (body.op === "create") {
          if (records.has(body.key)) return Response.json({ error: "exists" }, { status: 409 });
          records.set(body.key, { ...body.value, _v: 1 });
          return Response.json({ ok: true });
        }
        if (body.op === "update") {
          const current = records.get(body.key);
          if (!current) return Response.json({ error: "not found" }, { status: 404 });
          if (body.ifVersion !== undefined && current._v !== body.ifVersion) {
            return Response.json({ error: "version conflict" }, { status: 409 });
          }
          records.set(body.key, { ...current, ...body.patch, _v: current._v + 1 });
          return Response.json({ ok: true, version: current._v + 1 });
        }
        if (body.op === "delete") { records.delete(body.key); return Response.json({ ok: true }); }
        return Response.json({ error: "Unsupported operation." }, { status: 400 });
      } });
      return namespaces.get(name);
    }
  };
  return binding;
}

test("creates, reads, updates with version guard, lists and deletes records", async () => {
  const store = createCloudflareGovernanceStore({ ESIGN_DO: fakeBinding() });
  await store.create("meetingRecords", "meeting_01", { title: "Board meeting", status: "Draft" });
  assert.equal((await store.get("meetingRecords", "meeting_01")).title, "Board meeting");
  const updated = await store.update("meetingRecords", "meeting_01", { status: "Approved" }, { ifVersion: 1 });
  assert.equal(updated.version, 2);
  assert.equal((await store.get("meetingRecords", "meeting_01")).status, "Approved");
  assert.deepEqual((await store.list("meetingRecords")).map(row => row.id), ["meeting_01"]);
  await assert.rejects(store.update("meetingRecords", "meeting_01", { status: "Rejected" }, { ifVersion: 1 }), /version conflict/i);
  await store.delete("meetingRecords", "meeting_01");
  assert.equal(await store.get("meetingRecords", "meeting_01"), null);
  assert.deepEqual(await store.list("meetingRecords"), []);
});

test("rejects missing storage configuration instead of using ephemeral fallback", () => {
  assert.throws(() => createCloudflareGovernanceStore({}), /storage is not configured/i);
});

test("validates collection names, record IDs and patches", async () => {
  const store = createCloudflareGovernanceStore({ ESIGN_DO: fakeBinding() });
  await assert.rejects(store.get("../meetings", "id"), /collection name/i);
  await assert.rejects(store.get("meetings", "../id"), /record ID/i);
  await assert.rejects(store.update("meetings", "id", { _v: 99 }), /managed by the storage layer/i);
});
