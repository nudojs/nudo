/**
 * Branch hygiene report — PRINT ONLY, never deletes.
 *
 * Usage:
 *   node scripts/branch-hygiene.mjs        # human-readable report
 *   node scripts/branch-hygiene.mjs --json # machine-readable JSON
 *
 * Exit: 0 always (1 only if git itself fails).
 */
import { execFileSync } from "node:child_process";

const jsonMode = process.argv.includes("--json");

function git(args) {
  return execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitLines(args) {
  const out = git(args);
  return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

/** @type {string[]} */
const errors = [];

let currentBranch = "";
try {
  currentBranch = git(["branch", "--show-current"]);
} catch (e) {
  errors.push(`git branch --show-current failed: ${e.message}`);
}

/** Local branches. */
let branches = [];
try {
  branches = gitLines(["branch", "--format=%(refname:short)"]);
} catch (e) {
  errors.push(`git branch failed: ${e.message}`);
}

/** Branches fully merged into each integration base. */
function mergedInto(base) {
  try {
    return new Set(gitLines(["branch", "--merged", base, "--format=%(refname:short)"]));
  } catch {
    return new Set();
  }
}

const bases = ["dev", "main"].filter((b) => {
  try {
    git(["rev-parse", "--verify", b]);
    return true;
  } catch {
    return false;
  }
});

const mergedByBase = Object.fromEntries(bases.map((b) => [b, mergedInto(b)]));

/** Upstream + last-commit age per branch. */
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 60 * DAY_MS;
const now = Date.now();

const branchRows = branches.map((name) => {
  let upstream = "";
  try {
    upstream = git(["rev-parse", "--abbrev-ref", `${name}@{upstream}`]);
    if (upstream === "HEAD") upstream = "";
  } catch {
    upstream = "";
  }

  let lastCommitMs = 0;
  let lastCommitIso = "";
  try {
    lastCommitIso = git(["log", "-1", "--format=%cI", name]);
    lastCommitMs = Date.parse(lastCommitIso) || 0;
  } catch {
    /* keep zeros */
  }

  const mergedIntoBases = bases.filter((b) => mergedByBase[b].has(name));
  const ageDays = lastCommitMs ? Math.floor((now - lastCommitMs) / DAY_MS) : null;
  const noUpstreamStale = !upstream && lastCommitMs > 0 && now - lastCommitMs > STALE_MS;

  return {
    name,
    current: name === currentBranch,
    upstream: upstream || null,
    lastCommitIso: lastCommitIso || null,
    ageDays,
    mergedInto: mergedIntoBases,
    noUpstreamStale,
  };
});

/** Worktrees. */
let worktrees = [];
try {
  const lines = gitLines(["worktree", "list", "--porcelain"]);
  let cur = { path: "", head: "", branch: null, detached: false };
  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      if (cur.path) worktrees.push(cur);
      cur = { path: line.slice("worktree ".length), head: "", branch: null, detached: false };
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      cur.detached = true;
    }
  }
  if (cur.path) worktrees.push(cur);
} catch (e) {
  errors.push(`git worktree list failed: ${e.message}`);
}

/** Suggested commands — never executed. Never suggest deleting integration bases. */
const PROTECTED = new Set(["dev", "main", "master"]);
const suggestions = [];
for (const row of branchRows) {
  if (row.current || PROTECTED.has(row.name)) continue;
  if (row.mergedInto.length > 0) {
    suggestions.push({
      kind: "branch-delete",
      reason: `fully merged into ${row.mergedInto.join(", ")}`,
      command: `git branch -d ${row.name}`,
    });
  } else if (row.noUpstreamStale) {
    suggestions.push({
      kind: "branch-delete",
      reason: `no upstream, last commit ${row.ageDays}d ago (stale >60d)`,
      command: `git branch -d ${row.name}`,
    });
  }
}
for (const wt of worktrees) {
  if (wt.detached) {
    suggestions.push({
      kind: "worktree-remove",
      reason: "detached HEAD",
      command: `git worktree remove ${JSON.stringify(wt.path)}`,
    });
  }
}

const report = {
  currentBranch: currentBranch || null,
  bases,
  branches: branchRows,
  worktrees,
  suggestions,
  errors,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Branch hygiene report (read-only; nothing will be deleted)");
  console.log(`Current branch: ${currentBranch || "(detached or unknown)"}`);
  console.log(`Merged bases checked: ${bases.join(", ") || "(none)"}`);
  console.log("");

  console.log("Local branches:");
  for (const row of branchRows) {
    const flags = [];
    if (row.current) flags.push("current");
    if (row.mergedInto.length) flags.push(`merged→${row.mergedInto.join("+")}`);
    if (row.noUpstreamStale) flags.push(`stale ${row.ageDays}d no-upstream`);
    if (!row.upstream && !row.noUpstreamStale) flags.push("no-upstream");
    const flagStr = flags.length ? `  [${flags.join(", ")}]` : "";
    const ageStr = row.ageDays != null ? `  last=${row.lastCommitIso ?? "?"} (${row.ageDays}d)` : "";
    console.log(`  ${row.name}${flagStr}${ageStr}`);
  }
  console.log("");

  console.log("Worktrees:");
  for (const wt of worktrees) {
    const state = wt.detached ? ` (detached HEAD @ ${wt.head.slice(0, 8)})` : wt.branch ? ` [${wt.branch}]` : "";
    console.log(`  ${wt.path}${state}`);
  }
  console.log("");

  if (suggestions.length === 0) {
    console.log("Suggested cleanup commands: (none)");
  } else {
    console.log("Suggested cleanup commands (NOT executed — copy/paste if desired):");
    for (const s of suggestions) {
      console.log(`  # ${s.reason}`);
      console.log(`  ${s.command}`);
    }
  }

  if (errors.length) {
    console.log("");
    console.log("Git errors:");
    for (const e of errors) console.log(`  ${e}`);
  }
}

process.exit(errors.length > 0 ? 1 : 0);
