/**
 * Bug 695：多文件信封的 `summary.errors` 把 `--from` 的**路径错误**也算成
 * 分析 error ⇒ 信封聚合数 ≠ Σ`reports[].summary.errors` ≠ 人类面计数。
 *
 * 口径（core 自己的契约断言）：`summary.errors` = **诊断条数之和** ——
 * core 侧 `serializeCheckJsonMulti` 逐文件求和，core 测试断言
 * `multi.summary.errors === Σ reports[].summary.errors`。路径错误不是分析
 * 诊断（没有对应 report），只落在 `pathErrors[]`（非空 ⇒ ok:false ⇒ exit 1）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachPathErrors } from "../check-json-map.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 三个未约束 entry ⇒ 3 条 L2 entry-may-throw（分析 error） */
const SRC_A = `export function f1(x) {
  return x.toFixed(2);
}
export function f2(x) {
  return x.toFixed(2);
}
export function f3(x) {
  return x.toFixed(2);
}
`;
/** 一个未约束 entry ⇒ 1 条 L2 entry-may-throw */
const SRC_B = `export function g1(x) {
  return x.toFixed(2);
}
`;

function makeProject(): { cwd: string; files: string[]; missing: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-695-envelope-"));
  const a = join(dir, "a.js");
  const b = join(dir, "b.js");
  writeFileSync(a, SRC_A, "utf-8");
  writeFileSync(b, SRC_B, "utf-8");
  return { cwd: dir, files: [a, b], missing: join(dir, "nope.js") };
}

/** 人类面计数：每个文件一段「  N error · M warning · …」，求和 */
function humanErrorCount(stdout: string): number {
  const all = [...stdout.matchAll(/^\s*(\d+) error · /gm)].map((m) => Number(m[1]));
  expect(all.length).toBeGreaterThan(0);
  return all.reduce((a, b) => a + b, 0);
}

describe("Bug 695 — 信封 summary.errors = Σreports[] = 人类面计数", () => {
  it("单元：attachPathErrors 不把路径错误并进 summary.errors（只挂 ok:false + pathErrors）", () => {
    const envelope: {
      ok: boolean;
      summary: { errors: number; warnings: number; infos: number; functions: number; files: number };
      pathErrors?: Array<{ path: string; code: string; message: string }>;
      reports: unknown[];
    } = {
      ok: true,
      summary: { errors: 3, warnings: 0, infos: 3, functions: 3, files: 1 },
      reports: [],
    };
    const out = attachPathErrors(envelope, [
      { path: "/x/nope.js", code: "nudo:path-missing-callsite", message: "missing" },
    ]);
    expect(out.summary.errors).toBe(3);
    expect(out.ok).toBe(false);
    expect(out.pathErrors).toHaveLength(1);
  });

  it("CLI：三处一致（信封 = Σreports[] = 人类面），路径错误仍在 pathErrors[]", () => {
    const { cwd, files, missing } = makeProject();
    try {
      const json = runCliTsx(["check", ...files, "--from", missing, "--json"], { cwd });
      expect(json.status).toBe(1);
      const env = JSON.parse(json.stdout) as {
        ok: boolean;
        summary: { errors: number };
        reports: Array<{ summary: { errors: number } }>;
        pathErrors?: Array<{ code: string }>;
      };
      const sumReports = env.reports.reduce((acc, r) => acc + r.summary.errors, 0);

      const human = runCliTsx(["check", ...files, "--from", missing], { cwd });
      const humanCount = humanErrorCount(human.stdout);

      // 三处一致
      expect(env.summary.errors).toBe(sumReports);
      expect(env.summary.errors).toBe(humanCount);
      expect(sumReports).toBe(4);
      // 路径错误不是分析诊断：单独落在 pathErrors[]，信封 ok:false（⇒ exit 1）
      expect(env.pathErrors).toHaveLength(1);
      expect(env.ok).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：无路径错误时信封计数 = 人类面计数（未回归）", () => {
    const { cwd, files } = makeProject();
    try {
      const json = runCliTsx(["check", ...files, "--json"], { cwd });
      const env = JSON.parse(json.stdout) as {
        summary: { errors: number };
        reports: Array<{ summary: { errors: number } }>;
      };
      const human = runCliTsx(["check", ...files], { cwd });
      expect(env.summary.errors).toBe(
        env.reports.reduce((acc, r) => acc + r.summary.errors, 0),
      );
      expect(env.summary.errors).toBe(humanErrorCount(human.stdout));
      expect(env.summary.errors).toBe(4);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：语法错文件走 pathErrors ⇒ 信封计数仍是**分析诊断数**（= Σreports[] = 人类面）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-695-syntax-"));
    const broken = join(dir, "broken.js");
    const clean = join(dir, "clean.js");
    writeFileSync(broken, "export function broken( {\n", "utf-8");
    writeFileSync(clean, "export function id(x) { return x; }\n", "utf-8");
    try {
      const json = runCliTsx(["check", broken, clean, "--json"], { cwd: dir });
      expect(json.status).toBe(1);
      const env = JSON.parse(json.stdout) as {
        ok: boolean;
        summary: { errors: number };
        reports: Array<{ summary: { errors: number } }>;
        pathErrors: Array<{ code: string }>;
      };
      const sumReports = env.reports.reduce((acc, r) => acc + r.summary.errors, 0);
      // 语法错不是分析诊断（没有对应 report）⇒ 不进 summary.errors
      expect(env.pathErrors).toHaveLength(1);
      expect(env.pathErrors[0].code).toBe("syntax-error");
      expect(env.summary.errors).toBe(sumReports);
      expect(env.summary.errors).toBe(0);
      expect(env.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
