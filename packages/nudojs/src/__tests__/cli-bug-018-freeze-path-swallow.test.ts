/**
 * BUG-018：`nudo test --freeze <path>`（旗标在前、路径在后——CLI 的惯用形式）
 * 把路径吞成 `--freeze` 的**取值** ⇒ 必然报「needs at least one path」⇒ 该功能
 * 在文档/惯例给出的调用形式下**不可达**。
 *
 * 根因：`commands/test.ts` 的 `.option("--freeze [mode]")` 是 commander 的
 * **可选取值**形式（全 CLI 唯一一处）⇒ 紧跟其后的非选项参数被当成取值。
 *
 * 修复：取值加**白名单**（`update` / `add`，与 `--help` 承诺一致）——白名单外
 * 的字符串**不是模式**，它是**路径** ⇒ 还原成路径 + 省略取值（默认 add）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;

describe("BUG-018: `nudo test --freeze <path>` 不得把路径吞成取值", () => {
  it("旗标在前 + 路径在后 ⇒ 正常固化见证（旧行为：Usage error / exit 1 / 零写盘）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-018-"));
    const file = join(dir, "lib.js");
    try {
      writeFileSync(file, SRC, "utf-8");
      const r = runCliTsx(["test", "--freeze", file], { cwd: dir });
      expect(r.stderr, `stderr=${r.stderr}`).not.toContain("needs at least one path");
      expect(r.status, `stderr=${r.stderr}`).toBe(0);
      // 见证真的写回了源码（不是「静默什么都不做」）
      expect(readFileSync(file, "utf-8")).toContain('@nudo:case "call@L4"');
      expect(r.stdout).toContain("freeze →");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("白名单取值仍是模式：`--freeze update`（缺路径）仍是用法错误", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-018b-"));
    try {
      const r = runCliTsx(["test", "--freeze", "update"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("needs at least one path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
