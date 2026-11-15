/**
 * Bug 650：`nudo test` 遇解析失败 ⇒ **裸 message、无文件名**；`--json` 面
 * stdout **0 字节**（而 `nudo check` 对同一文件有 tsc 风格块 +
 * `pathErrors[{code:"syntax-error"}]` 信封）。
 *
 * 旧行为：Babel 解析异常上浮到顶层 catch ⇒ stderr 只有一行
 * `Unexpected keyword 'return'. (2:2)`（**没有文件名**、没有行:列、没有
 * 源码摘录），`--json` 面的序列化点排在异常之后 ⇒ stdout 一个字节都没有
 * ⇒ 机器面 `JSON.parse(stdout)` 直接炸。
 *
 * 修复：`runTest` 复用 check 面的语法错分支（`check-report.ts` 的
 * `syntaxErrorInfo` / `formatSyntaxErrorBlock`）——人类面给 tsc 风格块
 * （路径 + 行:列 + 摘录 + `^` 指位），`--json` 面并入
 * `pathErrors[{code:"syntax-error"}]`（同一条 CaseJson 失败信封）。
 *
 * ⚠ 错误**文案随夹具变**（Babel 版本 / 夹具不同 ⇒ 措辞不同）⇒ 本钉只钉
 * **形状**（有文件名 / 有 `path:line:col` / `--json` 有 body + 机器码），
 * 不断言文案字面量。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const SYNTAX_ERROR_SRC = `export function broken( {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-650-"));
  const file = join(cwd, "syn.js");
  writeFileSync(file, SYNTAX_ERROR_SRC, "utf-8");
  return { cwd, file };
}

describe("Bug 650 — test 面语法错：人类面 tsc 风格块 + --json 面 pathErrors", () => {
  it("人类面：文件名 + 行:列 + 摘录 + ^ 指位（不再是无路径的裸 message）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(1);
      // 形状：<file>:<line>:<col> — syntax error: <本质信息>
      expect(r.stderr).toMatch(/syn\.js:\d+:\d+ — syntax error: /);
      // 源码摘录 + 指位
      expect(r.stderr).toContain("return 1;");
      expect(r.stderr).toMatch(/\n\s*\^\s*$/m);
      // 旧症状：stderr 只有一个不带文件名的裸 message
      expect(r.stderr).not.toMatch(/^Unexpected .*$/m);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("--json 面：stdout 是 CaseJson 失败信封（pathErrors[{code:\"syntax-error\"}]）+ exit 1", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--json"], { cwd });
      expect(r.status).toBe(1);
      // 旧症状：stdout 0 字节 ⇒ JSON.parse 炸
      expect(r.stdout.trim().length).toBeGreaterThan(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.version).toBe(1);
      expect(Array.isArray(doc.pathErrors)).toBe(true);
      expect(doc.pathErrors.length).toBeGreaterThan(0);
      expect(doc.pathErrors[0].code).toBe("syntax-error");
      expect(doc.pathErrors[0].path).toContain("syn.js");
      // 形状：<line>:<col> — syntax error: <本质信息>
      expect(doc.pathErrors[0].message).toMatch(/^\d+:\d+ — syntax error: /);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("对照面：nudo check 对同一文件给同码 pathErrors（两个 verb 机器面同形）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["check", file, "--json"], { cwd });
      expect(r.status).toBe(1);
      const doc = JSON.parse(r.stdout);
      const codes = (doc.pathErrors ?? []).map((e: { code: string }) => e.code);
      expect(codes).toContain("syntax-error");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});
