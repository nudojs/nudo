/**
 * 混合 import 形态（默认 + 命名空间）回归（报告 Bug 153）。
 *
 * `import d, * as ns from "./dep.mjs"` 被摊平成
 * `import { default as d, * as ns } from "./dep.mjs"`：既不是合法 ESM，
 * 运行时改写也匹配不到命名空间分支（`*` 要求紧跟 `{`）⇒ 具名分支把 `*`
 * 当成一个被导入的名字 ⇒ `__nudoBindImport(spec, "*")` ⇒ 命名空间绑定折
 * **unknown**（`import * as ns` 单独用却正确）。
 *
 * 修法：混合形态改发**标准 ESM 形态** `import d, * as ns from "…"`，运行
 * 时改写新增对应分支（默认走具名绑定，命名空间走 __nudoBindNamespace）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { evalAbsModuleGraph } from "@nudojs/service";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

const DEP = `export default 1;\nexport const a = 8;\nexport function f(x) { return x * 2; }\n`;
const MAIN = `import d, * as ns from "./dep.mjs";
export function g() { return ns.f(3); }
export function h() { return d; }
export function k() { return ns.a; }
`;

describe("混合 import 形态（default + namespace）", () => {
  it("命名空间成员可调用：ns.f(3) → 6（修前 unknown）", () => {
    const dir = makeTmpProject("nudo-defns-", { "dep.mjs": DEP, "main.js": MAIN });
    const { modules } = evalAbsModuleGraph(MAIN, join(dir, "main.js"));
    const run = runTranspiled(MAIN, { mode: "analyze", modules: modules as never });
    const rec = callTranspiledExportFull(run, "g", []);
    expect(litValue(rec.result)).toEqual({ ok: true, value: 6 });
  });

  it("默认导出仍绑定：d → 1", () => {
    const dir = makeTmpProject("nudo-defns-", { "dep.mjs": DEP, "main.js": MAIN });
    const { modules } = evalAbsModuleGraph(MAIN, join(dir, "main.js"));
    const run = runTranspiled(MAIN, { mode: "analyze", modules: modules as never });
    const rec = callTranspiledExportFull(run, "h", []);
    expect(litValue(rec.result)).toEqual({ ok: true, value: 1 });
  });

  it("命名空间具名成员可读：ns.a → 8", () => {
    const dir = makeTmpProject("nudo-defns-", { "dep.mjs": DEP, "main.js": MAIN });
    const { modules } = evalAbsModuleGraph(MAIN, join(dir, "main.js"));
    const run = runTranspiled(MAIN, { mode: "analyze", modules: modules as never });
    const rec = callTranspiledExportFull(run, "k", []);
    expect(litValue(rec.result)).toEqual({ ok: true, value: 8 });
  });
});
