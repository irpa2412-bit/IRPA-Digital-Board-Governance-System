import { buildEmergencyRetrieval } from "../../src/signatureRecovery.mjs";

export default {
  async fetch(request) {
    const payload = await request.json();
    const source = Uint8Array.from(atob(payload.sourceBase64), value => value.charCodeAt(0));
    const records = {
      "envelopes": { [payload.envelope.id]: payload.envelope },
      "documents": { [payload.document.id]: payload.document }
    };
    const ctx = {
      env: { IRPA_ENVIRONMENT: "production" },
      meta: {
        async get(collection, id) { return structuredClone(records[collection]?.[id] || null); },
        async update() { throw new Error("READ_ONLY_TEST: meta update forbidden"); },
        async create() { throw new Error("READ_ONLY_TEST: meta create forbidden"); }
      },
      storage: {
        async get(id) { if (id !== payload.document.primaryStorageId) return null; return new Uint8Array(source); },
        async put() { throw new Error("READ_ONLY_TEST: storage put forbidden"); },
        async delete() { throw new Error("READ_ONLY_TEST: storage delete forbidden"); }
      },
      now: () => new Date("2026-11-23T10:00:00.000Z")
    };
    const result = await buildEmergencyRetrieval(ctx, { uid: payload.ownerUid }, payload.envelope.id);
    let outputBase64 = "";
    if (result.bytes) {
      let binary = "";
      for (const byte of result.bytes) binary += String.fromCharCode(byte);
      outputBase64 = btoa(binary);
    }
    return Response.json({
      ok: result.ok,
      code: result.code || null,
      step: result.step || null,
      errorClass: result.errorClass || null,
      stages: result.stages || [],
      outputHash: result.outputHash || null,
      outputBase64,
      label: result.label || null,
      certificateWarning: result.certificateWarning || null,
      checks: result.checks || null
    });
  }
};
