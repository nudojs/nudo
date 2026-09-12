#!/usr/bin/env tsx
/**
 * 真实 npm 包 nudo check 扫描报告。
 * 用法：npx tsx scripts/scan-real-packages.ts [pkg...]
 * 默认：commander（monorepo devDep，自包含 CJS）。
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { checkSource, formatCheckReport } from "../packages/core/src/index.ts";

const root = resolve(".");
const pkgs = process.argv.slice(2).length ? process.argv.slice(2) : ["commander"];

type FileReport = {
  file: string;
  ok: boolean;
  errors: number;
  warnings: number;
  infos: number;
  fns: number;
  issues: Array<{ severity: string; code: string; line?: number; message: string; actual?: string; expected?: string }>;
};

function collectJs(dir: string, max = 40): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (out.length >= max) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= max) return;
      if (name === "node_modules" || name === "test" || name === "tests") continue;
      const p = join(d, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".js") && !name.endsWith(".min.js")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function scanPkg(pkg: string): FileReport[] {
  const candidates = [
    join(root, "node_modules", pkg),
    join(root, "node_modules", "@types", pkg),
  ];
  const dir = candidates.find((c) => existsSync(c));
  if (!dir) {
    console.error(`skip ${pkg}: not in node_modules`);
    return [];
  }
  const files = collectJs(dir);
  const reports: FileReport[] = [];
  for (const f of files) {
    let source: string;
    try {
      source = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    // 跳过过大的单文件（求值成本）
    if (source.length > 400_000) continue;
    try {
      const r = checkSource(f, source);
      reports.push({
        file: relative(root, f),
        ok: r.ok,
        errors: r.summary.errors,
        warnings: r.summary.warnings,
        infos: r.summary.infos,
        fns: r.summary.functions,
        issues: r.issues
          .filter((i) => i.severity === "error" || i.severity === "warning")
          .map((i) => ({
            severity: i.severity,
            code: i.code,
            line: i.line,
            message: i.message,
            actual: i.actual,
            expected: i.expected,
          })),
      });
    } catch (e) {
      reports.push({
        file: relative(root, f),
        ok: false,
        errors: 1,
        warnings: 0,
        infos: 0,
        fns: 0,
        issues: [{ severity: "error", code: "nudo:scan-crash", message: String(e) }],
      });
    }
  }
  return reports;
}

const all: Array<{ pkg: string; reports: FileReport[] }> = [];
for (const pkg of pkgs) {
  const reports = scanPkg(pkg);
  all.push({ pkg, reports });
}

const lines: string[] = [];
lines.push("# nudo check 真实包扫描报告");
lines.push("");
lines.push(`生成：${new Date().toISOString().slice(0, 10)}`);
lines.push("");

let totalFiles = 0;
let totalErr = 0;
let totalWarn = 0;
let totalFns = 0;

for (const { pkg, reports } of all) {
  lines.push(`## ${pkg}`);
  lines.push("");
  if (reports.length === 0) {
    lines.push("（无 JS 文件）");
    lines.push("");
    continue;
  }
  const errFiles = reports.filter((r) => r.errors > 0);
  totalFiles += reports.length;
  totalErr += reports.reduce((s, r) => s + r.errors, 0);
  totalWarn += reports.reduce((s, r) => s + r.warnings, 0);
  totalFns += reports.reduce((s, r) => s + r.fns, 0);

  lines.push(`| 文件 | fn | error | warn | ok |`);
  lines.push(`|---|---:|---:|---:|:---:|`);
  for (const r of reports) {
    lines.push(
      `| \`${r.file}\` | ${r.fns} | ${r.errors} | ${r.warnings} | ${r.ok ? "✓" : "✗"} |`,
    );
  }
  lines.push("");
  if (errFiles.length === 0) {
    lines.push("**零 error**（在已扫描文件上）");
  } else {
    lines.push("**违例明细**");
    lines.push("");
    for (const r of errFiles) {
      lines.push(`### \`${r.file}\``);
      for (const i of r.issues) {
        const loc = i.line != null ? ` L${i.line}` : "";
        lines.push(`- [${i.severity}]${loc} \`${i.code}\` ${i.message}`);
        if (i.actual) lines.push(`  - actual: ${i.actual}`);
        if (i.expected) lines.push(`  - expected: ${i.expected}`);
      }
      lines.push("");
    }
  }
}

lines.push("---");
lines.push("");
lines.push(
  `**合计**：${totalFiles} 文件 · ${totalFns} 函数 · ${totalErr} error · ${totalWarn} warning`,
);
lines.push("");
lines.push(
  "说明：只扫 `*.js`（非 min）；import/require 依赖文件仍会分析（Abs 路径对 host 回落）。金标 recall 见 `check-recall-gold.test.ts`。",
);

const outPath = join(root, "docs", "check-real-packages.md");
const { writeFileSync } = await import("node:fs");
writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
console.log(lines.join("\n"));
console.log(`\n→ wrote ${relative(root, outPath)}`);
