import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, numLit, strLit } from "../index.ts";
import type { Abs, AbsModuleExports } from "../index.ts";

/**
 * Bug 10 回归（obj-callee 定抛暴露的 CJS 桥形状失真）：
 * `module.exports = X`（重赋值，cjsMain）的模块经 require 必须拿到 X 本身
 * （常为可调用函数），而不是 namespace obj——否则 `ms(5000)` 撞上
 * $callDispatch 的 obj-callee 定抛（Bug 10），整个入口模块 fail-closed
 * （analyzer-domain-exceeds 真实包零 FP 套件曾因此丢全部调用记录）。
 * 链路三跳：evalExportsToModuleExports 标 cjsMain → graph 占位符回填
 * 保标记 → requireFromModules 返回 default 本身。
 */

const fakeMainFn = runTranspiled(
  `export default function msLike(v) { return typeof v === "number" ? "5s" : 1; }`,
  { mode: "analyze" },
);

function cjsSingleFnModule(): AbsModuleExports {
  const def = fakeMainFn.default as Abs;
  return { named: {}, default: def, evaluated: true, cjsMain: true };
}

describe("CJS require 的 module.exports=X 形态（cjsMain）", () => {
  it("require 返回 default 本身：直接调用不触发 obj-callee 定抛", () => {
    const src = `const ms = require("./fake-ms.js"); export function f(v) { return ms(v); }`;
    const run = runTranspiled(src, {
      mode: "analyze",
      modules: { "./fake-ms.js": cjsSingleFnModule() },
    });
    const r = callTranspiledExportFull(run, "f", [numLit(5000)]);
    expect(litOf(r.result)).toBe("5s");
    const r2 = callTranspiledExportFull(run, "f", [strLit("2 days")]);
    expect(litOf(r2.result)).toBe(1);
  });

  it("调用记录可采集（exec 采集通道不 fail-closed）", () => {
    const src = `const ms = require("./fake-ms.js"); ms(5000); ms("2 days"); export const one = 1;`;
    const run = runTranspiled(src, {
      mode: "exec",
      lenientGlobals: true,
      modules: { "./fake-ms.js": cjsSingleFnModule() },
    });
    expect(run.one).toBeDefined();
  });

  it("缺 cjsMain 标记维持 namespace obj 口径（exports.X 形态）", () => {
    const src = `const m = require("./ns.js"); export const v = typeof m;`;
    const run = runTranspiled(src, {
      mode: "analyze",
      modules: {
        "./ns.js": { named: { a: numLit(1) }, evaluated: true },
      },
    });
    // namespace obj 不可调是正确口径（Bug 10）；这里只钉成员读面
    const r = callTranspiledExportFull(run, "v", []);
    expect(litOf(r.result)).toBe("object");
  });
});

function litOf(a: Abs): unknown {
  const t = a.term;
  return t?.op === "lit" ? t.value : undefined;
}
