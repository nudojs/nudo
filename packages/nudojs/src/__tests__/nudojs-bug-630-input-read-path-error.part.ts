/**
 * Bug 630 —— `check --json` 遇**输入读取失败**（EACCES）⇒ stdout 0 字节 + 裸 errno。
 *
 * 旧实现：`runCheck` 的 `readFileSync` 无 try/catch ⇒ 异常逃逸出命令层 ⇒
 * 顶层兜底只打一行裸 errno ⇒ `--json` 面 **stdout 0 字节** + exit 1
 * （违反 cli-semantics「--json 下 stdout 永不为空 / 绝不出现空 stdout + 非零
 * exit」）。同族的其它路径错误（不存在 / 空目录 / 非目标）都走 `pathErrors[]`
 * 信封，唯独「读输入」这条路漏了。
 *
 * 修复：读输入包 try/catch ⇒ 归一到 `PathError{code:"nudo:path-io"}`：
 * - `--json` 面 ⇒ 信封 `ok:false` + `pathErrors[{code:"nudo:path-io"}]`，stdout 非空；
 * - 人类面 ⇒ 一行 message + `fix:` 提示（同一 face）。
 *
 * 注：以 root 运行时 chmod 000 拦不住读取 ⇒ 该用例跳过（root 环境下无法
 * 构造 EACCES；非 root 环境正常跑）。
 */
import { describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const SRC = "export function f(x){ return x; }\n";

/** 造一个「存在但不可读」的文件；返回 undefined 表示本机拦不住（root） */
function makeUnreadable(dir: string): string | undefined {
  const file = join(dir, "u.js");
  writeFileSync(file, SRC, "utf-8");
  chmodSync(file, 0o000);
  try {
    readFileSync(file, "utf-8");
    return undefined; // 仍可读 ⇒ root / 特殊挂载
  } catch {
    return file;
  }
}

describe("bug 630: check 输入读取失败 ⇒ 显式 pathError（nudo:path-io）", () => {
  it("--json 面：stdout 非空 + 信封 ok:false + pathErrors[nudo:path-io] + exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug630-"));
    try {
      const file = makeUnreadable(dir);
      if (file === undefined) return; // root：无法构造 EACCES
      const r = runCliTsx(["check", file, "--json"]);
      expect(r.stdout.length, "stdout 不得为空（--json 面永不为空）").toBeGreaterThan(0);
      const env = JSON.parse(r.stdout) as {
        ok: boolean;
        reports: unknown[];
        pathErrors?: Array<{ code: string; path: string; message: string }>;
      };
      expect(env.ok).toBe(false);
      expect(env.reports).toEqual([]);
      expect(env.pathErrors).toHaveLength(1);
      expect(env.pathErrors?.[0]?.code).toBe("nudo:path-io");
      expect(env.pathErrors?.[0]?.path).toContain("u.js");
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("人类面：message + fix: 提示（不是裸 errno）+ exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug630-"));
    try {
      const file = makeUnreadable(dir);
      if (file === undefined) return; // root
      const r = runCliTsx(["check", file]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("fix:");
      expect(r.stderr).toMatch(/Cannot read .*u\.js/);
      // 旧实现：stderr 只有一行裸 errno（「EACCES: permission denied, open …」）
      expect(r.stderr.trim().split("\n")).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("对照：缺文件走既有 nudo:path-not-found 信封（不被本次改动影响）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug630-"));
    try {
      const r = runCliTsx(["check", join(dir, "nope.js"), "--json"]);
      const env = JSON.parse(r.stdout) as {
        ok: boolean;
        pathErrors?: Array<{ code: string }>;
      };
      expect(env.ok).toBe(false);
      expect(env.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
