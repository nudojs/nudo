/**
 * Bug 949 — `nudo health` 的 `uncovered` 指标**在结构上恒为 0**（过滤式恰好
 * 排除了文档定义的「entry fallback」那一类）⇒ 文档承诺的「uncovered ⇒
 * **Reported**, informational only」**永不成立**；机器面读出的 `"uncovered": 0`
 * 恒为假 ⇒ 消费者据此判断「全部函数都有覆盖」。
 *
 * 口径（guides/health.md:22）：uncovered = 「**无调用点证据**（回落 entry@）」的
 * 函数 ⇒ 必须被**报出来**（informational only：不判红，但必须可见）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
const p = (f: string) => join(dir, f);

/** 形态 1：导出函数、无调用点现场 ⇒ entry fallback ⇒ uncovered */
const NO_EVIDENCE = `export function a(x) {
  return x + 1;
}
`;

/** 形态 2：同文件内有调用点现场 ⇒ 该函数**有**调用点证据 ⇒ 不算 uncovered */
const WITH_EVIDENCE = `export function c(x) {
  return x + 1;
}
export function d() {
  return c(1);
}
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-949-"));
  writeFileSync(p("no-evidence.js"), NO_EVIDENCE);
  writeFileSync(p("with-evidence.js"), WITH_EVIDENCE);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 949: uncovered 指标不得恒为 0", () => {
  it("--json 面：无调用点证据的函数进 uncovered + summary.uncovered ≥ 1", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("no-evidence.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ uncovered: string[]; entryOnly: number }>;
      summary: { uncovered: number };
    };
    expect(parsed.files[0].uncovered).toContain("a");
    expect(parsed.summary.uncovered).toBeGreaterThanOrEqual(1);
    // informational only ⇒ 不判红
    expect(parsed.ok).toBe(true);
    expect(r.status).toBe(0);
  });

  it("文本面：uncovered 必须被报出来（informational only）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("no-evidence.js")]);
    // 必须是「逐个函数点名」的 uncovered 行（Summary 里的计数不算——它恒为 0）
    expect(r.stdout).toContain("uncovered (no call-site evidence): a");
    expect(r.stdout).toContain("Result: OK");
  });

  it("有调用点证据的函数不算 uncovered（指标不是恒真）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("with-evidence.js")]);
    const parsed = JSON.parse(r.stdout) as {
      files: Array<{ uncovered: string[] }>;
    };
    expect(parsed.files[0].uncovered).not.toContain("c");
  });
});
