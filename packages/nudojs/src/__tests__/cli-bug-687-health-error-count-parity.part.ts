/**
 * Bug 687：`nudo health` 的**文本面与 --json 面给出两个 error 计数**。
 *
 * 旧实现：JSON 面 `summary.errors = errorCount + fromErrors.length`（把
 * --from 的**路径错误**也算进去），文本面 Summary 只用 `errorCount`
 * ⇒ 同一次运行：文本面「0 error(s)」+ JSON 面「errors: 1」。
 * 文本面末尾还打「Result: FAIL (path errors found)」——同一段输出里
 * 结论行说有路径错误、计数行说 0 个。
 *
 * 钉：同一轮的两个面必须报**同一个**数字，且路径错误必须被计入。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-687-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 687: health 文本面与 --json 面的 error 计数同源", () => {
  it("同一轮：文本面 Summary 的 error 数 == JSON summary.errors（路径错误计入）", { timeout: 30_000 }, () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function libFn(x) {\n  return x + 1;\n}\n");
    const missingFrom = join(dir, "nope.js");

    const text = runCliTsx(["health", file, "--from", missingFrom]);
    const json = runCliTsx(["health", file, "--json", "--from", missingFrom]);

    // --json 面必须是**一份**合法 JSON 文档
    const parsed = JSON.parse(json.stdout) as {
      ok: boolean;
      pathErrors?: unknown[];
      summary: { errors: number };
    };
    const m = /(\d+) error\(s\)/.exec(text.stdout);
    expect(m, `no error count in text face:\n${text.stdout}`).not.toBeNull();
    const textErrors = Number(m![1]);

    // 两个面同一个数字
    expect(textErrors).toBe(parsed.summary.errors);
    // 路径错误必须被计入（不是 0）
    expect(textErrors).toBeGreaterThan(0);
    expect(parsed.pathErrors?.length).toBe(1);
    // 结论同源：两个面都是红
    expect(parsed.ok).toBe(false);
    expect(text.stdout).toContain("Result: FAIL");
    expect(text.status).toBe(1);
    expect(json.status).toBe(1);
  });

  it("无路径错误时两个面同样一致（0 error）", { timeout: 30_000 }, () => {
    const file = join(dir, "clean.js");
    writeFileSync(file, "export function clean(x) {\n  return x;\n}\n");
    const text = runCliTsx(["health", file]);
    const json = runCliTsx(["health", file, "--json"]);
    const parsed = JSON.parse(json.stdout) as { ok: boolean; summary: { errors: number } };
    const m = /(\d+) error\(s\)/.exec(text.stdout);
    expect(m, text.stdout).not.toBeNull();
    expect(Number(m![1])).toBe(parsed.summary.errors);
    expect(parsed.summary.errors).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(text.status).toBe(0);
  });
});
