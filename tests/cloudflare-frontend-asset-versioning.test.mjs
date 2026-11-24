import test from "node:test";
import assert from "node:assert/strict";
import { loadConfigFromFile } from "vite";

test("frontend emitted asset URLs are unique to the deployment commit", async () => {
  const previous = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = "0123456789abcdef0123456789abcdef01234567";
  try {
    const loaded = await loadConfigFromFile(
      { command: "build", mode: "production" },
      "vite.config.js"
    );
    const output = loaded?.config?.build?.rollupOptions?.output;
    assert.ok(output, "Vite Rollup output configuration must be present");
    assert.equal(output.entryFileNames, "assets/[name]-0123456789-[hash].js");
    assert.equal(output.chunkFileNames, "assets/[name]-0123456789-[hash].js");
    assert.equal(output.assetFileNames, "assets/[name]-0123456789-[hash][extname]");
  } finally {
    if (previous === undefined) delete process.env.GITHUB_SHA;
    else process.env.GITHUB_SHA = previous;
  }
});
