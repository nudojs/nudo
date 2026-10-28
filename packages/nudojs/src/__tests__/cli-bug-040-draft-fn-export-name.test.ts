/**
 * BUG-040 —— `nudo contract --draft --fn renamed` 静默产出**空草稿**（exit 0）。
 *
 * 契约身份恒为**导出名**（DESIGN-003），但 `--fn` 过滤把用户的导出名直接与
 * `analysis.functions[].name`（**本地名**）比较、且 CLI 的「一个都没命中」
 * 门禁只比 `entry.fn`（本地名）⇒ 别名导出（`export { localFn as renamed }`）
 * 永远匹配不上 ⇒ 草稿里一条 export 都没有。
 *
 * 修法：过滤与门禁都按**导出名**（`draftIdentity` / `entry.identity`）比较。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

const LIB = `function localFn(a) {
  return a + 1;
}
export { localFn as renamed };
export function caller() {
  return localFn(1);
}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-040-"));
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  return dir;
}

describe("BUG-040 —— --draft --fn 按导出名匹配（别名导出）", () => {
  it("--fn renamed ⇒ 草拟出 `export const renamed = fn(`（不再是空草稿）", () => {
    const dir = makeFixture();
    const r = runCli(["contract", "--draft", "--fn", "renamed", "--", "lib.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("matched no export");
    expect(r.stdout).toContain("export const renamed = fn(");
    expect(r.stdout).toContain("(sidecar key: renamed)");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("不回归 BUG-042：名字写错仍是用法错误 + 不落盘", () => {
    const dir = makeFixture();
    const r = runCli(["contract", "--draft", "--write", "--fn", "totallyMissing", "--", "lib.js"], {
      cwd: dir,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("matched no export");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
  }, 60000); // 1 个 CLI 子进程
});
