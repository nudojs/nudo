/**
 * 测试语义审计门禁：每个在册套件的每个 it 恰好一行审计记录。
 * 文档格式：docs/reports/test-audit/<suite>.md 内含 ```audit 代码块，
 * 每行 6 列 TSV：title / rootCause / gap / action / status / evidence。
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import ts from "typescript";

const root = new URL("..", import.meta.url).pathname;
const index = JSON.parse(readFileSync(join(root, "docs/reports/test-audit/index.json"), "utf8"));
const GAPS = new Set(["没测该层", "夹具漏形态", "旧断言钉错", "门禁未跑"]);
const ACTIONS = new Set(["keep", "optimize", "add", "delete"]);
const errors = [];
const allowPending = process.argv.includes("--allow-pending");

function titlesOf(file) {
  const src = readFileSync(join(root, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const isIt = ts.isIdentifier(callee) && (callee.text === "it" || callee.text === "test");
      const isEach = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
        (callee.expression.text === "it" || callee.expression.text === "test") &&
        (callee.name.text === "each" || callee.name.text === "skip" || callee.name.text === "only");
      const isEachFactory = ts.isCallExpression(callee) && ts.isPropertyAccessExpression(callee.expression) &&
        ts.isIdentifier(callee.expression.expression) &&
        (callee.expression.expression.text === "it" || callee.expression.expression.text === "test") &&
        callee.expression.name.text === "each";
      if ((isIt || isEach || isEachFactory) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        out.push(n.arguments[0].text.replace(/\s+/g, " ").trim());
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

for (const suite of index.suites) {
  const docRel = `docs/reports/test-audit/${suite.replace(/\.test\.ts$/, ".md")}`;
  if (!existsSync(join(root, docRel))) { errors.push(`missing doc: ${docRel}`); continue; }
  const doc = readFileSync(join(root, docRel), "utf8");
  const block = /```audit\n([\s\S]*?)```/.exec(doc);
  if (!block) { errors.push(`missing audit block: ${docRel}`); continue; }
  const lines = block[1].split("\n").filter((l) => l.trim().length > 0);
  if (lines[0]?.trim() !== "title\trootCause\tgap\taction\tstatus\tevidence") {
    errors.push(`bad header: ${docRel}`); continue;
  }
  const rows = lines.slice(1).map((l) => l.split("\t"));
  for (const [i, r] of rows.entries()) {
    if (r.length !== 6) { errors.push(`${docRel}:${i + 2} expected 6 columns, got ${r.length}`); continue; }
    const parse = (v) => (v.startsWith('"') ? JSON.parse(v) : v);
    const [title, rootCause, gap, action, status, evidence] = [parse(r[0]), parse(r[1]), r[2], r[3], r[4], r[5]];
    if (!title.trim()) errors.push(`${docRel}:${i + 2} empty title`);
    if (!rootCause.trim() || rootCause.trim().length < 6) errors.push(`${docRel}:${i + 2} weak rootCause`);
    if (!GAPS.has(gap)) errors.push(`${docRel}:${i + 2} bad gap: ${gap}`);
    if (!ACTIONS.has(action)) errors.push(`${docRel}:${i + 2} bad action: ${action}`);
    if (action === "keep" && status !== "keep") errors.push(`${docRel}:${i + 2} keep row must have status=keep`);
    if (action !== "keep") {
      if (status !== "done") errors.push(`${docRel}:${i + 2} action ${action} not done`);
      const commitOk = /commit:[0-9a-f]{7,}/.test(evidence) || (allowPending && /commit:PENDING/.test(evidence));
      if (!commitOk) errors.push(`${docRel}:${i + 2} missing commit evidence`);
      if (action === "delete" && !/^(dup|incorrect):/.test(evidence)) errors.push(`${docRel}:${i + 2} delete needs dup:/incorrect: evidence`);
    }
  }
  const want = new Map();
  for (const t of titlesOf(suite)) want.set(t, (want.get(t) ?? 0) + 1);
  const got = new Map();
  for (const r of rows) {
    const t = (r[0].startsWith('"') ? JSON.parse(r[0]) : r[0]).replace(/\s+/g, " ").trim();
    got.set(t, (got.get(t) ?? 0) + 1);
  }
  for (const [t, n] of want) {
    const m = got.get(t) ?? 0;
    if (m === 0) errors.push(`${docRel}: missing title: ${t}`);
    else if (m !== n) errors.push(`${docRel}: title count ${m} != ${n}: ${t}`);
  }
  for (const t of got.keys()) if (!want.has(t)) errors.push(`${docRel}: stale title: ${t}`);
  const del = /```audit-deleted\n([\s\S]*?)```/.exec(doc);
  if (del) {
    const dl = del[1].split("\n").filter((l) => l.trim());
    if (dl[0]?.trim() !== "title\treason\tevidence") errors.push(`bad deleted header: ${docRel}`);
    for (const [i, l] of dl.slice(1).entries()) {
      const r = l.split("\t");
      if (r.length !== 3) { errors.push(`${docRel}:deleted:${i + 2} expected 3 columns`); continue; }
      if (!/^(dup|incorrect):/.test(r[1])) errors.push(`${docRel}:deleted:${i + 2} reason needs dup:/incorrect:`);
      if (!/commit:[0-9a-f]{7,}/.test(r[2]) && !(allowPending && /commit:PENDING/.test(r[2]))) errors.push(`${docRel}:deleted:${i + 2} missing commit evidence`);
    }
  }
}

if (errors.length) {
  console.error(`test-audit: ${errors.length} violation(s)`);
  for (const e of errors.slice(0, 80)) console.error("  " + e);
  process.exit(1);
}
console.log(`test-audit: OK (${index.suites.length} suites)`);
