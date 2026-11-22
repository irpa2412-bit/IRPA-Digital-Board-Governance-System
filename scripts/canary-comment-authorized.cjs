const fs = require("node:fs");

const OWNER_LOGIN = "irpa2412-bit";
const OWNER_ID = 319164319;
const ISSUE_NUMBER = 876;
const EXACT_BODY = "RUN CANARY";

function isAuthorizedComment(event) {
  return Boolean(event && event.action === "created" &&
    event.issue && event.issue.number === ISSUE_NUMBER && !event.issue.pull_request &&
    event.comment && event.comment.user &&
    event.comment.user.id === OWNER_ID && event.comment.user.login === OWNER_LOGIN &&
    event.comment.body === EXACT_BODY);
}

function isAuthorizedManualInput(input) { return input === EXACT_BODY; }

function main() {
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  let authorized = false;
  if (eventName === "workflow_dispatch") authorized = isAuthorizedManualInput(process.env.CANARY_MANUAL_INPUT || "");
  else if (eventName === "issue_comment") {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    authorized = isAuthorizedComment(event);
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT, "authorized=" + (authorized ? "true" : "false") + "\n");
  console.log("CANARY_REQUEST_AUTHORIZED=" + (authorized ? "true" : "false"));
}

module.exports = { isAuthorizedComment, isAuthorizedManualInput };
if (require.main === module) main();