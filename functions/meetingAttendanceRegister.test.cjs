"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const state = { collections: new Map(), nextId: 0 };
const rows = name => {
  if (!state.collections.has(name)) state.collections.set(name, new Map());
  return state.collections.get(name);
};
const refFor = (collection, id) => ({
  id,
  collection,
  async get() {
    const value = rows(collection).get(id);
    return { id, exists: value !== undefined, data: () => value && structuredClone(value) };
  },
  async set(value, options = {}) {
    rows(collection).set(id, options.merge ? { ...(rows(collection).get(id) || {}), ...value } : value);
  },
  async update(value) {
    if (!rows(collection).has(id)) throw new Error("missing document");
    rows(collection).set(id, { ...rows(collection).get(id), ...value });
  }
});
const db = {
  collection(name) {
    return {
      doc(id) {
        return refFor(name, id || ("auto-" + (++state.nextId)));
      },
      where(field, operator, value) {
        assert.equal(operator, "==");
        return {
          async get() {
            const docs = [...rows(name)].filter(([, record]) => record[field] === value)
              .map(([id, record]) => ({ id, data: () => structuredClone(record) }));
            return { docs };
          }
        };
      },
      async add(value) {
        const ref = refFor(name, "auto-" + (++state.nextId));
        await ref.set(value);
        return ref;
      }
    };
  },
  async runTransaction(callback) {
    const tx = {
      async get(ref) { return ref.get(); },
      create(ref, value) {
        if (rows(ref.collection).has(ref.id)) throw new Error("already exists");
        rows(ref.collection).set(ref.id, value);
      },
      update(ref, value) {
        if (!rows(ref.collection).has(ref.id)) throw new Error("missing transaction document");
        rows(ref.collection).set(ref.id, { ...rows(ref.collection).get(ref.id), ...value });
      }
    };
    return callback(tx);
  }
};
const firestoreMock = {
  getFirestore: () => db,
  FieldValue: { serverTimestamp: () => new Date("2026-11-23T00:00:00.000Z") }
};
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const httpsMock = { onCall: (_options, handler) => handler, HttpsError };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "firebase-functions/v2/https") return httpsMock;
  if (request === "firebase-admin/firestore") return firestoreMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { signMeetingAttendance, getMeetingAttendanceRegister } = require("./meetingAttendanceRegister.js");
Module._load = originalLoad;

function reset() {
  state.collections.clear();
  state.nextId = 0;
  rows("meetings").set("meeting-1", {
    title: "Board Meeting", meetingReference: "IRPA-MTG-001", date: "2026-11-23",
    status: "Scheduled", chairpersonUid: "chair-1", secretaryUid: "secretary-1"
  });
  rows("participants").set("participant-1", {
    meetingId: "meeting-1", uid: "member-1", name: "Amina Mollel",
    email: "amina@example.test", role: "Board Member", status: "Active"
  });
  rows("participants").set("participant-2", {
    meetingId: "meeting-1", uid: "member-2", name: "Baraka Nair",
    email: "baraka@example.test", role: "Board Member", status: "Active"
  });
}
const request = (uid, email, data = {}) => ({
  auth: uid ? { uid, token: { email } } : null,
  data
});
const invoke = (handler, req) => handler(req);

test.beforeEach(reset);

test("attendance signing requires an authenticated Firebase identity", async () => {
  await assert.rejects(invoke(signMeetingAttendance, request(null, null, {
    meetingId: "meeting-1", participantId: "participant-1", typedName: "Amina Mollel", confirmed: true
  })), error => error.code === "unauthenticated");
});

test("attendance signing requires explicit declaration confirmation", async () => {
  await assert.rejects(invoke(signMeetingAttendance, request("member-1", "amina@example.test", {
    meetingId: "meeting-1", participantId: "participant-1", typedName: "Amina Mollel"
  })), error => error.code === "failed-precondition");
});

test("registered participant can sign with a normalized exact registered name", async () => {
  const result = await invoke(signMeetingAttendance, request("member-1", "amina@example.test", {
    meetingId: "meeting-1", participantId: "participant-1", typedName: "  AMINA   MOLLEL ", confirmed: true
  }));
  assert.equal(result.signed, true);
  assert.equal(result.alreadySigned, false);
  const signature = [...rows("meetingAttendanceSignatures").values()][0];
  assert.equal(signature.signerUid, "member-1");
  assert.equal(signature.typedName, "Amina Mollel");
  assert.equal(signature.signatureMethod, "AUTHENTICATED_TYPED_NAME_ATTESTATION");
  assert.equal(rows("participants").get("participant-1").attendanceStatus, "Present");
  assert.equal([...rows("audit").values()].filter(x => x.action === "MEETING_ATTENDANCE_SIGNED").length, 1);
});

test("a participant cannot sign another person's registration", async () => {
  await assert.rejects(invoke(signMeetingAttendance, request("member-1", "amina@example.test", {
    meetingId: "meeting-1", participantId: "participant-2", typedName: "Baraka Nair", confirmed: true
  })), error => error.code === "permission-denied");
});

test("typed name must match the registered participant name", async () => {
  await assert.rejects(invoke(signMeetingAttendance, request("member-1", "amina@example.test", {
    meetingId: "meeting-1", participantId: "participant-1", typedName: "Amina Molle", confirmed: true
  })), error => error.code === "failed-precondition");
});

test("inactive participant registrations cannot be signed", async () => {
  rows("participants").get("participant-1").status = "Revoked";
  await assert.rejects(invoke(signMeetingAttendance, request("member-1", "amina@example.test", {
    meetingId: "meeting-1", participantId: "participant-1", typedName: "Amina Mollel", confirmed: true
  })), error => error.code === "failed-precondition");
});

test("closed, cancelled, completed and archived meetings reject attendance signatures", async () => {
  for (const status of ["Closed", "Cancelled", "Completed", "Archived"]) {
    reset();
    rows("meetings").get("meeting-1").status = status;
    await assert.rejects(invoke(signMeetingAttendance, request("member-1", "amina@example.test", {
      meetingId: "meeting-1", participantId: "participant-1", typedName: "Amina Mollel", confirmed: true
    })), error => error.code === "failed-precondition", status);
  }
});

test("repeated signing is idempotent and does not create a second audit event", async () => {
  const req = request("member-1", "amina@example.test", {
    meetingId: "meeting-1", participantId: "participant-1", typedName: "Amina Mollel", confirmed: true
  });
  const first = await invoke(signMeetingAttendance, req);
  const second = await invoke(signMeetingAttendance, req);
  assert.equal(first.alreadySigned, false);
  assert.equal(second.alreadySigned, true);
  assert.equal(rows("meetingAttendanceSignatures").size, 1);
  assert.equal(rows("audit").size, 1);
});

test("attendance register managers can read every participant and signature state", async () => {
  const result = await invoke(getMeetingAttendanceRegister, request("chair-1", "chair@example.test", {
    meetingId: "meeting-1"
  }));
  assert.equal(result.canManage, true);
  assert.deepEqual(result.records.map(x => x.participantId).sort(), ["participant-1", "participant-2"]);
});

test("ordinary participants can read only their own attendance record", async () => {
  const result = await invoke(getMeetingAttendanceRegister, request("member-1", "amina@example.test", {
    meetingId: "meeting-1"
  }));
  assert.equal(result.canManage, false);
  assert.deepEqual(result.records.map(x => x.participantId), ["participant-1"]);
});

test("unregistered outsiders cannot read the attendance register", async () => {
  await assert.rejects(invoke(getMeetingAttendanceRegister, request("outsider-1", "outside@example.test", {
    meetingId: "meeting-1"
  })), error => error.code === "permission-denied");
});

test("meeting lookup rejects missing IDs and unknown meetings", async () => {
  await assert.rejects(invoke(getMeetingAttendanceRegister, request("member-1", "amina@example.test", {})),
    error => error.code === "invalid-argument");
  await assert.rejects(invoke(getMeetingAttendanceRegister, request("member-1", "amina@example.test", {
    meetingId: "missing-meeting"
  })), error => error.code === "not-found");
});
