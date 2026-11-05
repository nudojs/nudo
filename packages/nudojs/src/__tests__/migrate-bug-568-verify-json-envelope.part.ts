/**
 * Bug 568 — `migrate verify --json` 把**人工报告混进 stdout**：stdout 不是合法 JSON。
 *
 * 根因：`migrateVerify` 在 per-file 循环里无条件 `console.log(formatCheckReport(report))`
 * （人工面打到 stdout），随后 CLI 再把结果数组 `JSON.stringify` 后打到 stdout ⇒
 * stdout = 「整段人工报告 + JSON 数组」拼接 ⇒ `JSON.parse(stdout)` 抛 SyntaxError。
 * 污染恰好发生在**门禁判红**时（判绿时 stdout 是纯 JSON）⇒ 机器契约在最需要解析
 * 失败详情时崩。
 *
 * 判据：`--json` 时 stdout 必须是**单一 JSON 文档**；人工报告走 stderr。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-568-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** L2 entry may-throw（未约束形参上的属性读）→ 门禁判红 */
const RED = join(dir, "red.js");
writeFileSync(RED, "export function getName(user) {\n  return user.name;\n}\n", "utf-8");
/** 干净文件 → 门禁判绿 */
const GREEN = join(dir, "green.js");
writeFileSync(GREEN, "export function id(x) {\n  return x;\n}\n", "utf-8");

describe("migrate verify --json — stdout 是纯 JSON（Bug 568）", () => {
  it("判红文件：stdout 可 JSON.parse；人工报告在 stderr", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", RED, "--json"]);
    expect(r.status).toBe(1);

    // stdout 必须是单一 JSON 文档（旧行为：人工面在前 ⇒ parse 抛错）
    const parsed = JSON.parse(r.stdout) as Array<{ file: string; nudoOk: boolean }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.file).toContain("red.js");
    expect(parsed[0]!.nudoOk).toBe(false);

    // 人工面走 stderr（stdout 不得混入）
    expect(r.stderr).toContain("FAILED");
    expect(r.stdout).not.toContain("FAILED");
    expect(r.stdout).not.toContain("nudo check");
  });

  it("判绿文件：stdout 仍是纯 JSON（人类面不出现）", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", GREEN, "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ file: string; nudoOk: boolean }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.nudoOk).toBe(true);
  });

  it("无 --json 时人工报告仍在 stdout（人类面不被误伤）", { timeout: 120_000 }, () => {
    const r = runCliTsx(["migrate", "verify", RED]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAILED");
    expect(r.stdout).toContain("FAIL");
  });
});
