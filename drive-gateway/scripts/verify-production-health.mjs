import { pathToFileURL } from "node:url";

export async function verifyHealth({
  fetchImpl = fetch,
  expectedCommit = process.env.EXPECTED_WORKER_COMMIT,
  timeoutMs = 180_000,
  intervalMs = 5_000,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  onAttempt = (attempt, detail) => console.log(`Health attempt ${attempt}: ${detail}`),
} = {}) {
  if (!expectedCommit) throw new Error("EXPECTED_WORKER_COMMIT is required.");
  const url = "https://irpa-google-drive-gateway.irpa-governance.workers.dev/health";
  const deadline = now() + timeoutMs;
  let attempt = 0;
  let lastError = "No health response received.";

  while (true) {
    attempt += 1;
    try {
      const response = await fetchImpl(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = await response.json();
      if (health?.ok !== true) throw new Error("Health response did not report ok:true.");
      if (health?.storageProvider !== "Google Drive") throw new Error("Health response storage provider mismatch.");
      if (health?.commit !== expectedCommit) {
        throw new Error(`Commit mismatch: expected ${expectedCommit}; received ${String(health?.commit)}.`);
      }
      onAttempt(attempt, `verified commit ${health.commit}`);
      return { attempts: attempt, commit: health.commit };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      onAttempt(attempt, lastError);
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(`Production Worker health verification failed after ${attempt} attempts over ${timeoutMs}ms: ${lastError}`);
    }
    await sleepImpl(Math.min(intervalMs, remaining));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyHealth().then(({ attempts, commit }) => {
    console.log(`Production Worker health verified after ${attempts} attempt(s): ${commit}`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
