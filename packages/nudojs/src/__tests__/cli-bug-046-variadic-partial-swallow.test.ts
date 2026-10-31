/**
 * BUG-046 —— `nudo check --only <codes…>` **部分吞掉**后面的路径 ⇒ 被吞的
 * 文件**从未被检查** ⇒ exit 0 假绿。
 *
 * 旧守卫只在「paths 全被吞空」（`paths.length === 0`）时触发；`paths` 已非空
 * 时，variadic 旗标吞掉的后续路径从 `paths` 里消失且无任何提示。
 * 现在：只要某 variadic 旗标的取值里出现「该旗标不接受 + 磁盘上确实是路径」
 * 的项，就报定向 usage error（exit 1）并提示 `--` 终止符。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const CLEAN = `export function ok() {
  return 1;
}
`;
/** 未约束 entry ⇒ L2 entry-may-throw（门禁红） */
const BROKEN = `export function staticName(node) {
  return node.type;
}
`;

describe("BUG-046 — --only 部分吞掉路径 ⇒ 不得静默丢文件", () => {
  it("`check clean.js --only <code> broken.js` ⇒ 定向 usage error + exit 1", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug046-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "b46", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "clean.js"), CLEAN, "utf-8");
      writeFileSync(join(cwd, "broken.js"), BROKEN, "utf-8");

      // 对照：两个路径都在 ⇒ broken.js 的门禁红（exit 1）
      const both = runCliTsx(["check", "clean.js", "broken.js"], { cwd });
      expect(both.status).toBe(1);

      // 缺陷形态：--only 吞掉 broken.js ⇒ 旧实现 exit 0（文件没被检查）
      const swallow = runCliTsx(
        ["check", "clean.js", "--only", "nudo:entry-may-throw", "broken.js"],
        { cwd },
      );
      expect(swallow.status).toBe(1);
      expect(swallow.stderr).toContain("consumed the following path(s): broken.js");
      expect(swallow.stderr).toContain("--");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("对照：把 variadic 旗标放在 `--` 前、路径放后面 ⇒ 正常检查（不误报）", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug046-ok-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "b46b", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "clean.js"), CLEAN, "utf-8");
      writeFileSync(join(cwd, "broken.js"), BROKEN, "utf-8");
      const r = runCliTsx(
        ["check", "--only", "nudo:entry-may-throw", "--", "clean.js", "broken.js"],
        { cwd },
      );
      // 两个路径都被检查（broken.js 红），且没有 usage error
      expect(r.status).toBe(1);
      expect(r.stderr).not.toContain("consumed the following path(s)");
      expect(r.stdout).toContain("clean.js");
      expect(r.stdout).toContain("broken.js");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
