/**
 * 审计 34 · BUG-008：`.cjs` 单值导出的**模块形态**。
 *
 * 运行期 `require("./real.cjs")` 是那个值本身（函数 / 类），但产物此前一律按
 * ESM 发射（`export declare function real`）⇒ 消费方 `import real from` 报
 * TS2349（没有调用签名）。
 *
 * 钉三件事：
 * - 单值（具名 / 匿名 / 类）⇒ `declare … + export = X`；
 * - 对象字面量导出保持既有 ESM 具名投影（`export =` 与具名导出共存是 TS2309）；
 * - 混用（`module.exports = f` 另有 `exports.x`）不切形态。
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

/** 写一个临时夹具，返回绝对路径 */
function fixture(name: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b008-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, source, "utf-8");
  return file;
}

function dts(file: string): string {
  const r = runCliTsx(["export", "--format", "dts", file]);
  expect(r.status).toBe(0);
  return r.stdout;
}

describe("BUG-008 · CJS 单值导出 = `export =`", () => {
  it("`module.exports = real` ⇒ `declare function` + `export = real`", () => {
    const out = dts(
      fixture("real.cjs", `function real() { return 7; }\nmodule.exports = real;\n`),
    );
    expect(out).toContain("export = real;");
    expect(out).not.toContain("export declare function real");
  }, 60000);

  it("`module.exports = function (a) {}` ⇒ 匿名 single value 也走 `export =`", () => {
    const out = dts(
      fixture("anon.cjs", `module.exports = function (a) { return a; };\n`),
    );
    expect(out).toMatch(/^export = _default;$/m);
    expect(out).not.toContain("export default");
  }, 60000);

  it("`module.exports = C`（类）⇒ `declare class` + `export = C`", () => {
    const out = dts(
      fixture("box.cjs", `class Box { get() { return 1; } }\nmodule.exports = Box;\n`),
    );
    expect(out).toContain("export = Box;");
    expect(out).not.toContain("export declare class Box");
  }, 60000);

  it("对照：`module.exports = { … }` 保持 ESM 具名投影（TS2309 边界）", () => {
    const out = dts(
      fixture("obj.cjs", `module.exports = { a: 1, b: "s" };\n`),
    );
    expect(out).toContain("export declare const a");
    expect(out).not.toContain("export =");
  }, 60000);

  it("对照：单值之外另有具名导出时不切形态（`export =` 不能与其它导出共存）", () => {
    const out = dts(
      fixture(
        "mixed.cjs",
        `function real() { return 7; }\nmodule.exports = real;\nexports.extra = 1;\n`,
      ),
    );
    expect(out).not.toContain("export =");
  }, 60000);

  it("对照：镜像的 `export interface` 同样算「其它导出」⇒ 不切 `export =`", () => {
    // BUG-005 让本地类型原文镜像进产物；`export =` 与 `export interface` 共存
    // 会让产物直接 TS2309（`nudo export` 却 exit 0）⇒ 这类混用保持具名投影
    // （与 TS 自己的 --declaration 同答案）。
    const out = dts(
      fixture(
        "typed.ts",
        `export interface Foo { a: number }
class C { m() { return 1; } }
module.exports = C;
`,
      ),
    );
    expect(out).toContain("export interface Foo");
    expect(out).not.toContain("export =");
    expect(out).toContain("export declare class C");
  }, 60000);
});
