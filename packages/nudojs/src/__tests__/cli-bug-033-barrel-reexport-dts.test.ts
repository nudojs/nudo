/**
 * BUG-033 —— 纯 re-export 模块（barrel）`export --format dts` 不产出任何产物。
 *
 * 症状：`export { helper } from "./cjs.js";` 单独成文件时，`functions.length`
 * 为 0 ⇒ 早退发生在**模块面组装之前** ⇒ 再导出被整个丢掉，只打印
 * "No analyzed functions found."；同一个 re-export 放在有本地函数的文件里却
 * 正常产出。
 *
 * 修法：空产物判据改为「**既无本地函数，也无模块面再导出**」，模块面在早退
 * 之前组装。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b033-"));
  dirs.push(dir);
  writeFileSync(join(dir, "cjs.js"), "export function helper(x) {\n  return x;\n}\n", "utf-8");
  writeFileSync(join(dir, "reexp.js"), 'export { helper } from "./cjs.js";\n', "utf-8");
  writeFileSync(
    join(dir, "mix.js"),
    'export { helper } from "./cjs.js";\nexport function own() { return 2; }\n',
    "utf-8",
  );
  return dir;
}

describe("BUG-033 — 纯 barrel 也出模块面产物", () => {
  it("只有再导出的模块：dts 产出再导出声明（不是「无函数」早退）", () => {
    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "reexp.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('export { helper } from "./cjs.js";');
    expect(r.stdout).not.toContain("No analyzed functions found");
  }, 60000);

  it("负控制：本地函数 + 再导出的模块两条面都在", () => {
    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "mix.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function own(): number;");
    expect(r.stdout).toContain('export { helper } from "./cjs.js";');
  }, 60000);

  it("负控制：真的没有导出面的模块仍如实说明（不静默零产物）", () => {
    const dir = fixture();
    writeFileSync(join(dir, "empty.js"), "const x = 1;\nexport { };\n", "utf-8");
    const r = runCliTsx(["export", join(dir, "empty.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("No ");
  }, 60000);
});
