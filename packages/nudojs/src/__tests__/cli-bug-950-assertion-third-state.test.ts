/**
 * Bug 950：`nudo test` 的断言判定**没有「推导失败」第三态**。
 *
 * 根因（`packages/nudojs/src/run-test.ts` 的报告面）：断言判定是**二值**的
 * ——实测侧 `unknown`（**引擎没推出来**）被压成「断言不符」（假红），
 * 而 `any()` 期望又借 core `leqAbs` 的「目标放宽 ⇒ 通过」捷径**空洞通过**
 * （假绿）⇒ **同一事实两种期望都不可用**；且与 check 面把同一状态判成
 * INFO（`nudo:opaque-result`、exit 0）**严重度相反**。
 *
 * 修法：报告面引入**第三态**——实测侧是 `unknown` / `conf === "opaque"`
 * （推导失败）⇒ 记 **unchecked（无法判定）**：不是失败、不置红（exit 0）、
 * 也不是空洞通过；诊断文本区分「实测与期望不符」（真失败）与
 * 「引擎未能推断实测值」（工具的局限，指向 `nudo:opaque-result` 的补证据路径）。
 *
 * 钉（CLI 报告面）：
 * - 推导失败 + 期望 `number()` ⇒ **unchecked**（不是 FAIL）+ exit 0；
 * - 推导失败 + 期望 `any()` ⇒ 同样 **unchecked**（不是空洞 ok）+ exit 0；
 * - 诊断文本区分：含「无法判定」口径 + 指向 `nudo:opaque-result`；
 * - `--json` 面：assertions = {passed: 0, failed: 0, unchecked: 1}；
 * - 负控制：推导成功 + 期望不符 ⇒ 仍是 **FAIL / exit 1**（既有行为不变）。
 *
 * ⚠ 本钉只钉**报告面**（两个报告面的第三态是同一条口径，见 service 面的
 * 平行钉 `packages/service/src/__tests__/service-bug-950-test-report-third-state.test.ts`）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/**
 * 引擎**推不出来**的函数体（`(x.get)().a ||= 2` 不被求值器支持
 * ⇒ 实测落到 `unknown`）——与 check 面的 `nudo:opaque-result` 同一事实。
 */
const OPAQUE_BODY = `export function f(o) {
  const x = { a: 1 };
  (x.get)().a ||= 2;
  return x.a;
}
`;

/** 推导成功（负控制）：实测是 `2`，期望 `string()` ⇒ 真失败。 */
const INFERRED_BODY = `export function g(x) { return x + 1; }
`;

type Fixture = { cwd: string; file: string };

/** 写一个临时项目（ESM）+ 一个带声明期望的 case 文件。 */
function makeProject(expectation: string, body: string): Fixture {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-950-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b950", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  const file = join(cwd, "t.js");
  writeFileSync(
    file,
    `/**
 * @nudo:case "w" (1) => ${expectation}
 */
${body}`,
    "utf-8",
  );
  return { cwd, file };
}

describe("Bug 950 — 断言判定的第三态：推导失败 ⇒ unchecked（不是失败、不是空洞通过）", () => {
  it("推导失败 + 期望 number() ⇒ unchecked + exit 0（改前：FAIL + exit 1）", () => {
    const { cwd, file } = makeProject("number()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("0 passed · 0 failed · 1 unchecked");
      expect(r.stdout).not.toContain("[FAIL]");
      expect(r.stdout).toContain("[unchecked]");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("推导失败 + 期望 any() ⇒ 同样 unchecked（改前：空洞 ok「1 passed」）", () => {
    const { cwd, file } = makeProject("any()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("0 passed · 0 failed · 1 unchecked");
      expect(r.stdout).not.toContain("[ok]");
      expect(r.stdout).not.toContain("1 passed");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("诊断文本区分「无法判定」与「类型不匹配」，并指向 nudo:opaque-result 的补证据路径", () => {
    const { cwd, file } = makeProject("number()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      // 报告面：说「引擎没推出来」，不是「类型不匹配」
      expect(r.stdout).toContain("cannot judge");
      expect(r.stdout).toContain("the engine could not infer the actual value");
      expect(r.stdout).toContain("not a type mismatch");
      // 补证据路径 = check 面同事实的 INFO（nudo:opaque-result）
      expect(r.stdout).toContain("nudo:opaque-result");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("--json 面：assertions = {passed: 0, failed: 0, unchecked: 1}", () => {
    const { cwd, file } = makeProject("number()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file, "--json"], { cwd });
      expect(r.status).toBe(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.assertions).toEqual({ passed: 0, failed: 0, unchecked: 1 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("负控制：推导成功 + 期望不符 ⇒ 仍是 FAIL / exit 1（既有行为不变）", () => {
    const { cwd, file } = makeProject("string()", INFERRED_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("1 failed");
      expect(r.stdout).toContain("0 unchecked");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);
});
