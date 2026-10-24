/**
 * Bug 648 —— `nudo check --fix` 打印的 unified diff **非法且不可 apply**。
 *
 * 旧实现（check.ts 的 diff 打印段）：
 * - 自印一份 `--- <file>` / `+++ <file>  ([fix] …)` **又**追加自带头的
 *   `unifiedDiff(...)` ⇒ **双份头**；
 * - `+++` 行的**路径字段被说明文字污染**（`+++ <path>  ([fix] …)`）⇒
 *   解析出的文件名不是合法路径；
 * - 传给 `unifiedDiff` 的是**绝对路径** ⇒ 头拼成 `a//abs` 的**双斜杠**
 *   ⇒ `git apply -p1` 剥掉 `a/` 后仍是绝对路径 ⇒ git 拒绝（exit 1）。
 *
 * 修复：diff 头**只**由 `unifiedDiff` 产出；说明文字移到 diff **之外**的一行；
 * 路径取**相对 cwd**（与兄弟命令 `test --freeze --dry-run` 同口径）。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const SRC = "export function getName(user) {\n  return user.name;\n}\n";

/** 头行：unified diff 的 `---` / `+++` 各恰好一份，且路径字段干净 */
function diffHeaderLines(stdout: string): { minus: string[]; plus: string[] } {
  const lines = stdout.split("\n");
  return {
    minus: lines.filter((l) => l.startsWith("--- ")),
    plus: lines.filter((l) => l.startsWith("+++ ")),
  };
}

describe("bug 648: check --fix 的 diff 单份头 + 干净路径字段", () => {
  it("单份 ---/+++ 头 + 路径字段无说明文字 + 相对路径（无 a// 双斜杠）", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug648-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "bug648", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "lib.js"), SRC, "utf-8");
      const r = runCliTsx(["check", "--fix", "lib.js"], { cwd });
      const { minus, plus } = diffHeaderLines(r.stdout);
      // 旧实现：--- 两份（自印 + unifiedDiff 自带）、+++ 两份
      expect(minus, "unified diff 只允许一对 ---/+++ 头").toHaveLength(1);
      expect(plus, "unified diff 只允许一对 ---/+++ 头").toHaveLength(1);
      // 头路径字段干净（无 `([fix] …)` 说明文字污染）
      expect(plus[0]).toMatch(/^\+\+\+ b\/\S+$/);
      expect(minus[0]).toMatch(/^--- a\/\S+$/);
      // 相对路径（不是绝对路径拼出的 a// 双斜杠）
      expect(plus[0]).not.toContain("a//");
      expect(plus[0]).not.toContain("b//");
      expect(plus[0].replace(/^\+\+\+ b\//, "")).not.toMatch(/^\//);
      // 新建文件的 hunk 头是标准形态 @@ -0,0 +1,N @@
      expect(r.stdout).toMatch(/^@@ -0,0 \+1,\d+ @@$/m);
      // 说明文字在 diff 之外（仍可见，但不污染路径字段）
      expect(r.stdout).toContain("[fix]");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("diff 可被 `git apply --check -p1` 消费（相对路径 ⇒ 剥掉 a/ 后是仓库内相对路径）", () => {
    // 夹具放在**仓库外**的临时目录、且以该目录为 cwd ⇒ diff 里的路径是
    // 「相对 cwd」的（`a/lib.nudo.js`）⇒ `git apply -p1` 在该目录下按相对
    // 路径解析（不依赖「补丁基准目录 == git 仓库根」这一偶然前提）。
    // 旧实现传的是**绝对路径** ⇒ 头是 `a//<绝对路径>` ⇒ -p1 后仍是绝对路径
    // ⇒ git 拒绝（invalid path ⇒ 非零 exit）。
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug648-apply-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "bug648", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "lib.js"), SRC, "utf-8");
      const r = runCliTsx(["check", "--fix", "lib.js"], { cwd });
      expect(r.stdout).toContain("--- a/lib.nudo.js");
      const g = spawnSync("git", ["apply", "--check", "-p1"], {
        cwd,
        input: r.stdout,
        encoding: "utf8",
      });
      expect(
        g.status,
        `git apply --check -p1 应成功（stderr: ${g.stderr}）`,
      ).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
