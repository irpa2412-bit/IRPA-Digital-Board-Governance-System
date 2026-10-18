/**
 * Durable Object-backed record adapter for the Firebase-free governance migration.
 *
 * This adapter deliberately does not silently fall back to Firestore or mock
 * storage. Callers must supply the existing ESIGN_DO binding; missing storage
 * fails closed so production records cannot be written to an ephemeral store.
 */
function requireBinding(env) {
  if (!env?.ESIGN_DO || typeof env.ESIGN_DO.get !== "function" ||
      typeof env.ESIGN_DO.idFromName !== "function") {
    throw new Error("Cloudflare governance storage is not configured.");
  }
  return env.ESIGN_DO;
}

async function call(env, key, operation, payload = {}) {
  const binding = requireBinding(env);
  const response = await binding.get(binding.idFromName(key)).fetch("https://governance.internal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, op: operation, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "Cloudflare governance storage request failed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

const clean = value => String(value ?? "").trim();
const safeCollection = value => {
  const collection = clean(value);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(collection)) {
    throw new TypeError("A valid governance collection name is required.");
  }
  return collection;
};
const safeId = value => {
  const id = clean(value);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new TypeError("A valid governance record ID is required.");
  }
  return id;
};

export function createCloudflareGovernanceStore(env) {
  // Validate configuration at construction time, not after accepting a write.
  requireBinding(env);
  return {
    async get(collection, id) {
      const c = safeCollection(collection), recordId = safeId(id);
      const result = await call(env, c + "/" + recordId, "get");
      return result.value || null;
    },

    async create(collection, id, value) {
      const c = safeCollection(collection), recordId = safeId(id);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("A governance record object is required.");
      }
      await call(env, c + "/" + recordId, "create", { value });
      await call(env, "__index__", "add", { recordKey: c + "/" + recordId });
      return { id: recordId, ...value, _v: 1 };
    },

    async update(collection, id, patch, options = {}) {
      const c = safeCollection(collection), recordId = safeId(id);
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new TypeError("A governance record patch is required.");
      }
      if (Object.hasOwn(patch, "id") || Object.hasOwn(patch, "_v")) {
        throw new TypeError("Record identity and version are managed by the storage layer.");
      }
      const payload = { patch };
      if (options.ifVersion !== undefined) {
        if (!Number.isSafeInteger(options.ifVersion) || options.ifVersion < 1) {
          throw new TypeError("The expected record version must be a positive integer.");
        }
        payload.ifVersion = options.ifVersion;
      }
      const result = await call(env, c + "/" + recordId, "update", payload);
      return { ok: true, version: result.version };
    },

    async delete(collection, id) {
      const c = safeCollection(collection), recordId = safeId(id);
      await call(env, c + "/" + recordId, "delete");
      await call(env, "__index__", "remove", { recordKey: c + "/" + recordId });
      return { ok: true };
    },

    async list(collection) {
      const c = safeCollection(collection);
      const index = await call(env, "__index__", "list");
      const keys = Array.isArray(index.keys) ? index.keys : [];
      const records = [];
      for (const key of keys.filter(key => key.startsWith(c + "/")).sort()) {
        const id = key.slice(c.length + 1);
        if (!id || id.includes("/")) continue;
        const result = await call(env, key, "get");
        if (result.value) records.push({ id, ...result.value });
      }
      return records;
    }
  };
}
