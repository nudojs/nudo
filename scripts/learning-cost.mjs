#!/usr/bin/env node
/**
 * F5 — learning-cost timing script (internal baseline, NOT a CI gate).
 *
 * Times a Day-0 → Day-1 newcomer path against the real CLI:
 *   1. check / test a zero-directive sample
 *   2. write a minimal *.nudo.js sidecar
 *   3. check (violation expected, then fix)
 *   4. check again (clean)
 *   5. contract print
 *
 * Usage:
 *   node scripts/learning-cost.mjs
 *   node scripts/learning-cost.mjs --json
 *
 * Env: uses the repo CLI via tsx (same as package.json scripts).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");

const SAMPLE = `export function double(x) {
  return x * 2;
}

double(21);
`;

const SIDECAR_BAD = `import { fn, number, string } from "@nudojs/core";

export const double = fn({ x: number().gt(0) }, string());
`;

const SIDECAR_OK = `import { fn, number, string } from "@nudojs/core";

export const double = fn({ x: number().gt(0) }, number().gt(40));
`;

function runCli(args, _cwd) {
  // Always run from the monorepo root so pnpm/tsx resolve workspace deps.
  const started = process.hrtime.bigint();
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", join(root, "packages/cli/src/index.ts"), ...args],
    { cwd: root, encoding: "utf-8", env: process.env },
  );
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    ms,
    code: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function step(name, fn) {
  const t0 = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { name, ms, ...result };
}

const dir = mkdtempSync(join(tmpdir(), "nudo-learning-cost-"));
const steps = [];
try {
  const srcPath = join(dir, "utils.js");
  const sidecarPath = join(dir, "utils.nudo.js");
  writeFileSync(srcPath, SAMPLE);

  steps.push(
    step("check (zero directives)", () => {
      const r = runCli(["check", srcPath], dir);
      return {
        cliMs: r.ms,
        exit: r.code,
        ok: r.code === 0 && r.stdout.includes("double"),
        ...(r.code !== 0 ? { note: (r.stderr || r.stdout).slice(0, 160) } : {}),
      };
    }),
  );

  steps.push(
    step("test (zero directives)", () => {
      const r = runCli(["test", srcPath], dir);
      return {
        cliMs: r.ms,
        exit: r.code,
        ok: r.code === 0 && r.stdout.includes("double"),
        ...(r.code !== 0 ? { note: (r.stderr || r.stdout).slice(0, 160) } : {}),
      };
    }),
  );

  writeFileSync(sidecarPath, SIDECAR_BAD);
  steps.push(
    step("check (sidecar expects string return — expect fail)", () => {
      const r = runCli(["check", srcPath], dir);
      const failed = r.code !== 0;
      return { cliMs: r.ms, exit: r.code, ok: failed, note: failed ? "violation reported" : `unexpected pass: ${r.stdout.slice(0, 120)}` };
    }),
  );

  writeFileSync(sidecarPath, SIDECAR_OK);
  steps.push(
    step("check (return number().gt(40) — expect clean)", () => {
      const r = runCli(["check", srcPath], dir);
      return {
        cliMs: r.ms,
        exit: r.code,
        ok: r.code === 0,
        ...(r.code !== 0 ? { note: r.stdout.slice(0, 160) || r.stderr.slice(0, 160) } : {}),
      };
    }),
  );

  steps.push(
    step("contract print", () => {
      const r = runCli(["contract", srcPath], dir);
      return {
        cliMs: r.ms,
        exit: r.code,
        ok: r.code === 0 && r.stdout.includes("double"),
        ...(r.code !== 0 ? { note: r.stderr.slice(0, 160) } : {}),
      };
    }),
  );

  const summary = {
    script: "learning-cost",
    gate: false,
    steps: steps.map((s) => ({
      name: s.name,
      cliMs: Math.round(s.cliMs * 100) / 100,
      ok: s.ok,
      ...(s.note ? { note: s.note } : {}),
    })),
    totalCliMs: Math.round(steps.reduce((a, s) => a + s.cliMs, 0) * 100) / 100,
  };

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("Nudo learning-cost baseline (internal, not a CI gate)");
    console.log(`  workdir: ${dir}`);
    for (const s of summary.steps) {
      const mark = s.ok ? "ok" : "!!";
      console.log(`  [${mark}] ${s.name.padEnd(52)} ${String(s.cliMs).padStart(8)} ms${s.note ? `  — ${s.note}` : ""}`);
    }
    console.log(`  total CLI wall: ${summary.totalCliMs} ms`);
  }
  process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
} finally {
  if (!process.argv.includes("--keep")) {
    rmSync(dir, { recursive: true, force: true });
  } else {
    console.error(`kept: ${dir}`);
  }
}
