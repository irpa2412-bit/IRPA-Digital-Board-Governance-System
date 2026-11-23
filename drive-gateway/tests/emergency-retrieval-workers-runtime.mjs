import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

test("emergency retrieval reaches CERT_PAGE_VERIFY inside a local Workers runtime", async () => {
  const port = 8791;
  const child = spawn(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js", "dev", "--local",
    "--config", "wrangler.emergency-retrieval.test.toml", "--port", String(port), "--ip", "127.0.0.1"
  ], { cwd: process.cwd(), env: { ...process.env, NO_UPDATE_NOTIFIER: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", chunk => { logs += chunk.toString(); });
  child.stderr.on("data", chunk => { logs += chunk.toString(); });
  const base = "http://127.0.0.1:" + port;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error("Wrangler exited before readiness: " + logs);
      try {
        const health = await fetch(base + "/");
        if (health.status < 500) { ready = true; break; }
      } catch {}
      await delay(500);
    }
    assert.equal(ready, true, "Wrangler did not become ready: " + logs);
    const response = await fetch(base + "/api/recovery/envelopes/ENV-WORKER-TEST/emergency-retrieval", { method: "POST" });
    const detail = response.status === 200 ? "" : await response.clone().text();
    assert.equal(response.status, 200, detail + "\n" + logs);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    const stages = JSON.parse(response.headers.get("x-irpa-stage-log"));
    assert.ok(stages.some(stage => stage.stageCode === "CERT_PAGE_VERIFY" && stage.status === "pass"), JSON.stringify(stages));
    assert.ok(stages.some(stage => stage.stageCode === "STAMP_EVIDENCE" && stage.status === "pass"), JSON.stringify(stages));
    assert.ok(stages.some(stage => stage.stageCode === "DETACHED_EVIDENCE" && stage.status === "not-checked" && stage.error === "NOT EXPORTED: no existing contract"), JSON.stringify(stages));
    assert.match(response.headers.get("x-irpa-output-sha256"), /^[a-f0-9]{64}$/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.ok(bytes.length > 1000);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(3000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
