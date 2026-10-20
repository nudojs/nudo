/**
 * 任意模块导出名 import 回归（报告 Bug 177）。
 *
 * ES2022 允许 `import { "a-b" as x } from "./dep.js"`（任意模块导出名）。
 * 转译器把导出名渲染成 `[object Object]`（`String(node)` 走
 * Object.prototype.toString）⇒ 生成的 import 语句**语法非法** ⇒ 整模块求值
 * 失败 ⇒ 被导入的值静默变 unknown ⇒ `nudo check` 只报一条 WARNING ⇒
 * **0 error 假绿**。
 *
 * 修法：import 侧与 export 侧同口径保引号渲染（`"a-b"`），绑定时再去引号
 * 得到真正的导出名。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { evalAbsModuleGraph } from "@nudojs/service";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { transpileSource } from "@nudojs/core/exec";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

const DEP = `const v = 7;\nexport { v as "a-b" };\n`;
const MAIN = `import { "a-b" as x } from "./dep.js";\nexport function f() { return x; }\n`;

describe("任意模块导出名 import（import { \"a-b\" as x }）", () => {
  it("渲染保引号：转译产物不得出现 [object Object]", () => {
    const out = transpileSource(MAIN, {});
    expect(out).not.toContain("[object Object]");
    expect(out).toContain('"a-b"');
  });

  it("模块图求值：f() → 7（修前静默 unknown + 假绿）", () => {
    const dir = makeTmpProject("nudo-nsname-", { "dep.js": DEP, "main.js": MAIN });
    const { modules } = evalAbsModuleGraph(MAIN, join(dir, "main.js"));
    const run = runTranspiled(MAIN, { mode: "analyze", modules: modules as never });
    const rec = callTranspiledExportFull(run, "f", []);
    expect(litValue(rec.result)).toEqual({ ok: true, value: 7 });
  });
});
