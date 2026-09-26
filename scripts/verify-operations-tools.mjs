import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const bin = name => isWindows ? name + ".cmd" : name;

function run(label, command, args, cwd = ".") {
  const r = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (r.error || r.status !== 0) {
    throw new Error(label + " is not operational.");
  }
}

if (Number(process.versions.node.split(".")[0]) < 20) {
  throw new Error("Node.js 20 or newer is required for IRPA-DBGS operations.");
}

if (!existsSync("node_modules") && !existsSync("functions/node_modules")) {
  throw new Error("Dependencies are not installed. Run npm run ops:install first.");
}

run("Firebase CLI", bin("firebase"), ["--version"]);
run("Wrangler CLI", isWindows ? "node_modules\\.bin\\wrangler.cmd" : "./node_modules/.bin/wrangler", ["--version"], "drive-gateway");

console.log("IRPA-DBGS operational software preflight: PASS");
