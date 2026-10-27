/**
 * BUG-067 —— `nudo check --fix --write` 写的侧车污染同目录**共享同一侧车
 * 路径**的兄弟模块（`foo.js` 与 `foo.mjs` 都映射到 `foo.nudo.js`）：
 * 给未被修复的兄弟**新增** error，且自己的 fix 被静默丢弃。
 *
 * 现在：检测到共享 ⇒ **拒绝落盘**（可见 error + 点名共享者 + 汇总计数），
 * 不再新写入任何共享侧车 ⇒ 兄弟模块的错误数不增加。
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const FOO_JS = `export function a(user) {
  return user.name;
}
`;
const FOO_MJS = `export function b(user) {
  return user.age;
}
`;

/** 人类面 error 计数（`  N error · …`） */
function errorCount(stdout: string): number {
  const m = /^\s*(\d+) error · /m.exec(stdout);
  return m ? Number(m[1]) : Number.NaN;
}

describe("BUG-067 — --fix --write 不写共享侧车路径", () => {
  it("foo.js + foo.mjs 共存 ⇒ 拒绝落盘、兄弟模块错误数不变", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug067-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "b67", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "foo.js"), FOO_JS, "utf-8");
      writeFileSync(join(cwd, "foo.mjs"), FOO_MJS, "utf-8");

      const before = runCliTsx(["check", "foo.mjs"], { cwd });
      expect(errorCount(before.stdout)).toBe(1);

      const fix = runCliTsx(["check", ".", "--fix", "--write"], { cwd });
      // 拒绝落盘必须可见（旧实现只报「1 edit(s) written, 1 applied」）
      expect(fix.stderr).toContain("refuses to write sidecar");
      expect(fix.stderr).toContain("shared with");
      expect(fix.stdout).toContain("sidecar write(s) refused");
      // 共享侧车没有被写出来（写了就会污染兄弟模块）
      expect(existsSync(join(cwd, "foo.nudo.js"))).toBe(false);

      const after = runCliTsx(["check", "foo.mjs"], { cwd });
      expect(errorCount(after.stdout)).toBe(1);
      expect(after.stdout).not.toContain("nudo:interface-load");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
