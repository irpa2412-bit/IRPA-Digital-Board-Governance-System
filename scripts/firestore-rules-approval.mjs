import { execFileSync } from "node:child_process";
const API = "https://api.github.com";
const LABEL = "firestore-rules-approved";

function latestByTime(items) {
  return [...items].sort((a, b) => {
    const timeOrder = Date.parse(a.created_at) - Date.parse(b.created_at);
    return timeOrder || Number(a.id || 0) - Number(b.id || 0);
  }).at(-1);
}

export function evaluateApproval({ changedFiles, labels, labelEvents, timeline, rulesCommitIds, allowedActors, apiError }) {
  if (apiError) return { pass: false, reason: `GitHub API verification failed; failing closed: ${apiError}` };
  if (!Array.isArray(changedFiles) || !Array.isArray(labels) || !Array.isArray(labelEvents) ||
      !Array.isArray(timeline) || !Array.isArray(rulesCommitIds) || !Array.isArray(allowedActors)) {
    return { pass: false, reason: "Required approval evidence is incomplete; failing closed." };
  }
  if (!changedFiles.includes("firestore.rules")) return { pass: true, reason: "firestore.rules unchanged." };
  if (!labels.includes(LABEL)) return { pass: false, reason: "firestore.rules changed but the required approval label is absent." };

  const relevant = labelEvents.filter(e => e.label?.name === LABEL && ["labeled", "unlabeled"].includes(e.event));
  const latestLabelEvent = latestByTime(relevant);
  if (!latestLabelEvent || latestLabelEvent.event !== "labeled") {
    return { pass: false, reason: "The approval label is not currently backed by a latest label-applied event." };
  }
  const actor = latestLabelEvent.actor?.login;
  if (!actor || !allowedActors.includes(actor)) {
    return { pass: false, reason: `Approval label was applied by unauthorized actor: ${actor || "unknown"}.` };
  }
  if (!latestLabelEvent.id || rulesCommitIds.length === 0) {
    return { pass: false, reason: "Cannot establish the PR event order for the approval and rules commits; failing closed." };
  }
  const labelIndex = timeline.findIndex(event => event.id === latestLabelEvent.id && event.event === "labeled");
  const rulesCommitIndexes = rulesCommitIds.map(sha => timeline.findIndex(event => event.event === "committed" && event.sha === sha));
  if (labelIndex < 0 || rulesCommitIndexes.some(index => index < 0)) {
    return { pass: false, reason: "GitHub timeline is missing the approval event or a rules-changing commit; failing closed." };
  }
  if (labelIndex <= Math.max(...rulesCommitIndexes)) {
    return { pass: false, reason: "approval is stale; re-apply the label after reviewing the latest diff" };
  }
  return { pass: true, reason: `Valid approval by @${actor} after the latest firestore.rules commit.` };
}

function apiHeaders(token) {
  return { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" };
}



function nextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === "next") return match[1];
  }
  return null;
}

async function apiPages(url, token) {
  const all = [];
  let next = url, pages = 0;
  while (next) {
    if (++pages > 100) throw new Error("GitHub API pagination exceeded 100 pages.");
    const response = await fetch(next, { headers: apiHeaders(token) });
    const raw = await response.text();
    if (!response.ok) throw new Error(`GitHub API GET ${next} returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
    let page;
    try { page = JSON.parse(raw); } catch { throw new Error(`GitHub API returned invalid JSON for ${next}`); }
    if (!Array.isArray(page)) throw new Error(`Expected a paginated array from ${next}`);
    all.push(...page);
    next = nextLink(response.headers.get("link"));
  }
  return all;
}

function loadApprovers(baseSha) {
  const raw = execFileSync("git", ["show", `${baseSha}:.github/firestore-rules-approvers.txt`], { encoding: "utf8" });
  const logins = raw.split(/\r?\n/).map(line => line.replace(/#.*$/, "").trim()).filter(Boolean);
  if (!logins.includes("irpa2412-bit")) throw new Error("Approver allow-list must include repository owner irpa2412-bit.");
  return [...new Set(logins)];
}


async function main() {
  const token = process.env.GH_TOKEN, repo = process.env.REPO, prNumber = process.env.PR_NUMBER;
  const baseSha = process.env.BASE_SHA;
  let labels;
  try { labels = JSON.parse(process.env.PR_LABELS || "[]").map(label => label.name).filter(Boolean); }
  catch { throw new Error("PR_LABELS must be a JSON array supplied by the pull_request event."); }
  if (!token || !repo || !/^\d+$/.test(prNumber || "") || !/^[0-9a-f]{40}$/i.test(baseSha || "")) {
    throw new Error("GH_TOKEN, REPO, numeric PR_NUMBER and exact BASE_SHA are required.");
  }
  const [owner, name] = repo.split("/");
  const base = `${API}/repos/${owner}/${name}`;
  try {
    // Use the checked-out PR history and event payload for local evidence.
    // Only label actor and ordered GitHub timeline events require API access.
    execFileSync("git", ["cat-file", "-e", `${baseSha}^{commit}`], { stdio: "ignore" });
    const changedFiles = execFileSync("git", ["diff", "--name-only", `${baseSha}...HEAD`], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean);
    if (!changedFiles.includes("firestore.rules")) {
      console.log("PASS: firestore.rules unchanged.");
      return;
    }
    const rulesCommitIds = execFileSync("git", ["log", "--format=%H", `${baseSha}..HEAD`, "--", "firestore.rules"], { encoding: "utf8" })
      .trim().split("\\n").filter(Boolean);
    const allowedActors = loadApprovers(baseSha);
    const [events, timeline] = await Promise.all([
      apiPages(`${base}/issues/${prNumber}/events?per_page=100`, token),
      apiPages(`${base}/issues/${prNumber}/timeline?per_page=100`, token)
    ]);
    const result = evaluateApproval({
      changedFiles, labels, labelEvents: events, timeline, rulesCommitIds, allowedActors
    });
    if (result.pass) { console.log(`PASS: ${result.reason}`); return; }
    console.error(`FAIL: ${result.reason}`);
    process.exitCode = 1;
  } catch (error) {
    const reason = `GitHub API/evidence error; fail closed. ${error.message}`;
    console.error(`::error::${reason}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
