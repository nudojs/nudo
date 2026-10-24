/**
 * Bug 679：`package.json#nudo.check.ignoreThrows` 与 CLI `--ignore-throws`
 * **两套解析器** ⇒ 同一语义键两种写法行为不同。
 *
 * 症状：配置面只认严格 `string[]`（service checkConfig 的 `Array.isArray` 过滤）
 * ⇒ 配置写 `"TypeError"`（裸字符串）或 `["TypeError,RangeError"]`（数组元素内
 * 带逗号）都被静默丢成空表 ⇒ 门禁**假红**（用户以为忽略了 TypeError，实际
 * 没忽略）。修复：配置面复用 CLI 解析器（切逗号 + trim + 接受裸字符串 /
 * 数组两种形态）；形状非法（数字 / 布尔 / 对象）回落默认 + stderr 一行告警。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configIgnoreThrows, parseIgnoreThrows } from "../check-gate-config.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 未约束的 entry ⇒ L2 entry-may-throw TypeError（被忽略则门禁绿） */
const SRC = `export function getName(user) {
  return user.name;
}
`;

function makeProject(ignoreThrowsJson: string): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-679-ignoretthrows-"));
  const file = join(dir, "a.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(
    join(dir, "package.json"),
    `{"name":"ig-proj","version":"0.0.0","nudo":{"check":{"ignoreThrows":${ignoreThrowsJson}}}}\n`,
    "utf-8",
  );
  return { cwd: dir, file };
}

describe("Bug 679 — ignoreThrows 配置面与 CLI 面同口径", () => {
  it("解析器：配置面裸字符串 / 数组元素内逗号都被切开", () => {
    expect(configIgnoreThrows({ check: { ignoreThrows: "TypeError" } })).toEqual([
      "TypeError",
    ]);
    expect(configIgnoreThrows({ check: { ignoreThrows: ["TypeError,RangeError"] } })).toEqual([
      "TypeError",
      "RangeError",
    ]);
    expect(configIgnoreThrows({ check: { ignoreThrows: ["TypeError"] } })).toEqual([
      "TypeError",
    ]);
    // 与 CLI 解析器逐字同结果（配置面不再走 service 的严格 string[] 过滤）
    expect(configIgnoreThrows({ check: { ignoreThrows: "TypeError, RangeError" } })).toEqual(
      parseIgnoreThrows("TypeError, RangeError"),
    );
  });

  it("CLI：配置写裸字符串 \"TypeError\" ⇒ L2 被忽略（门禁绿）", () => {
    const { cwd, file } = makeProject('"TypeError"');
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stdout).not.toContain("nudo:entry-may-throw");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：配置写 [\"TypeError,RangeError\"] ⇒ 数组元素内逗号被切开（门禁绿）", () => {
    const { cwd, file } = makeProject('["TypeError,RangeError"]');
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stdout).not.toContain("nudo:entry-may-throw");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：配置写 [\"TypeError\"]（旧口径，未回归）⇒ 门禁绿", () => {
    const { cwd, file } = makeProject('["TypeError"]');
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stdout).not.toContain("nudo:entry-may-throw");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：形状非法（42）⇒ 回落默认 + stderr 一行告警（不静默假红）", () => {
    const { cwd, file } = makeProject("42");
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).toContain("warning: package.json nudo.check.ignoreThrows");
      expect(r.stderr).toContain("42");
      // 回落默认 = 不忽略任何 throw 类 ⇒ L2 仍红（诚实）
      expect(r.stdout).toContain("nudo:entry-may-throw");
      expect(r.status).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：CLI 旗标形态不变（--ignore-throws TypeError,RangeError 仍绿）", () => {
    const { cwd, file } = makeProject('["EvalError"]');
    try {
      const r = runCliTsx(["check", file, "--ignore-throws", "TypeError,RangeError"], {
        cwd,
      });
      expect(r.stdout).not.toContain("nudo:entry-may-throw");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
