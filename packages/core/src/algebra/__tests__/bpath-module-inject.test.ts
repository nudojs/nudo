/**
 * 模块注入管线（core 侧）：generalize/checkSource 的 B run 线程宿主已求值的
 * 依赖导出表（specifier → AbsModuleExports，与 runTranspiled.modules 同形）。
 * 拆 import/require 门：body 引用的导入名可解析 → B；不可解析 → 解释路径
 * （缺绑定名在 B 内是 crash-and-swallow，解释路径更干净）。
 */
import { describe, it, expect } from "vitest";
import { generalizeFromAst, absFunction, formatAbs } from "@nudojs/core";

// 依赖导出 fixture：identity relation（α 实参 → 结果引用 α；具体实参 → 原值）
const dep = {
  named: {
    double: absFunction(["x"], { apply: (args) => args[0]! }) as never,
  },
};

describe("generalize module injection", () => {
  it("body-referenced import resolves through injected modules (B route)", () => {
    const src = `import { double } from "./dep.js";
export function f(x) { return double(x); }`;
    const g = generalizeFromAst("f", src, { modules: { "./dep.js": dep } });
    expect(g).toBeDefined();
    // 符号：x 经 double 应用 → 数值域（无模块时 double 未绑定 → unknown）
    expect(formatAbs(g!.symbolic)).not.toContain("unknown");
  });

  it("unresolvable import falls back to interpreter (no crash, conservative)", () => {
    const src = `import { missing } from "./dep.js";
export function f(x) { return missing(x); }`;
    const g = generalizeFromAst("f", src, { modules: {} });
    expect(g).toBeDefined();
    expect(formatAbs(g!.symbolic)).toContain("unknown");
  });

  it("require resolves through injected modules (gate dropped)", () => {
    const src = `const { double } = require("./dep.js");
export function f(x) { return double(x); }`;
    const g = generalizeFromAst("f", src, { modules: { "./dep.js": dep } });
    expect(g).toBeDefined();
    expect(formatAbs(g!.symbolic)).not.toContain("unknown");
  });

  it("missing require is conservative (no crash, no false throw)", () => {
    const src = `const { double } = require("./nope.js");
export function f(x) { return double(x); }`;
    const g = generalizeFromAst("f", src, { modules: {} });
    expect(g).toBeDefined();
    expect(formatAbs(g!.symbolic)).toContain("unknown");
  });

  it("imports used only by the body of another fn do not block B", () => {
    // import 被 g 用、f 不用 → f 无模块依赖也可走 B（可解析与否都行）
    const src = `import { double } from "./dep.js";
export function f(x) { return x + 1; }
function g(y) { return double(y); }`;
    const g = generalizeFromAst("f", src, { modules: {} });
    expect(formatAbs(g!.symbolic)).toContain("1");
  });
});
