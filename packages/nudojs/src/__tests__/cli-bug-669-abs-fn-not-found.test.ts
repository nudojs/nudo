/**
 * Bug 669：`nudo check --abs --fn <不存在的名字>` 被当成「引擎推导失败」
 * （unknown / conf: partial）而不是**用法错误**。
 *
 * 旧行为：`--fn nosuch` ⇒ stdout 打印 `nosuch() / unknown / conf: partial`，
 * 门禁 exit 0（文件本身没函数时反而是 `Function not found` + exit 1 ⇒
 * 同一类错误两个口径）。真名错拼被静默吞掉。
 *
 * 修复：`--fn` 必须是文件里真实存在的顶层函数，否则与「文件没有函数」
 * 同款报错（stderr + fix: 提示）+ 非零 exit。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";

const ONE = `export function one(){ return 1; }\n`;
const NOFN = `const x = 1;\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-669-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 669: check --abs --fn <不存在的名字> ⇒ 用法错误 + 非零 exit", () => {
  it("拼错的函数名 → Function not found + exit 1（不再是 unknown/partial）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { fn: "nosuch" });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Function not found");
      expect(r.stderr).toContain("nosuch");
      expect(r.stderr).toContain("fix:");
      // 旧行为：把拼错的名字当「引擎推导失败」打印出来
      expect(r.stdout).not.toContain("nosuch(");
      expect(r.stdout).not.toContain("conf: partial");
    });
  });

  it("真实函数名 → 正常观察面（不误伤）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { fn: "one" });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("one()");
      expect(r.stderr).not.toContain("Function not found");
    });
  });

  it("文件本身没有函数 → 既有口径不变（Function not found + exit 1）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "nofn.js");
      writeFileSync(file, NOFN, "utf-8");
      const r = await runAbsViewCaptured(file, { fn: "nosuch" });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Function not found");
      expect(r.stderr).not.toContain("nosuch()");
    });
  });

  it("CLI 级：拼错的函数名 → 进程 exit 1（check 报告段不把 exitCode 复位）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = runCli(["check", file, "--abs", "--fn", "nosuch"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Function not found");
      expect(r.stdout).not.toContain("nosuch(");
    });
  }, 30000);
});
