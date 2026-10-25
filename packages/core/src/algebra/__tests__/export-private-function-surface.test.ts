/**
 * 私有顶层函数不是模块导出 —— 导出面（Object.keys）与分析面（按名调用）
 * 必须分开。
 *
 * 修前：transpile 的顶层 FunctionDeclaration 一律发射 `export ` 前缀
 * （`const exportKw = depth === 0 ? "export " : ""`）⇒ run.ts 的文本回收把
 * **未导出**的顶层函数也当导出：
 * 1. `function foo(){} export * from "./x.js"` —— 本地私有 foo 压过 star，
 *    依赖模块的 foo 被遮蔽（原生：star 值胜出）；
 * 2. `import { helper } from "./m.js"`（helper 私有）被静默接受（漏
 *    nudo:missing-export；service 侧回归见
 *    service/__tests__/export-private-function-missing.test.ts）；
 * 3. transpileSource 产物作为真实 ESM 时多出 `export function helper`。
 *
 * 修法：transpileFile 从源 AST 收真实静态导出名（TranspileOptions.
 * exportedDeclNames），只有命中者带 export 前缀；run.ts 用源 AST 的顶层
 * 函数名建**非枚举**分析槽（Object.hasOwn / callTranspiledExportFull 可用，
 * Object.keys 不可见），真实导出槽随后按 dyn → cjs → 静态名的旧顺序覆盖。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { transpileSource, transpileFile } from "../exec/transpile.ts";
import { parseSource } from "../parse-source.ts";
import { abs, litValue } from "../abs.ts";
import { pTrue } from "../pred.ts";
import type { AbsModuleExports } from "../abs-modules.ts";

const num = (value: number) =>
  abs({ k: "prim", type: "number" }, { op: "lit", value }, pTrue, "exact");

describe("私有顶层函数：不在导出面，但可按名分析", () => {
  it("Object.keys(run) 不含私有函数；直接访问与 callTranspiledExportFull 可用", () => {
    const run = runTranspiled(
      `function helper(n) { return n + 1; }
export function entry(n) { return helper(n); }
`,
      { mode: "analyze" },
    );
    expect(Object.keys(run)).toEqual(["entry"]);
    expect(Object.hasOwn(run, "helper")).toBe(true);
    expect(typeof run.helper).toBe("function");
    const full = callTranspiledExportFull(run, "helper", [num(41)]);
    expect(litValue(full.result)).toEqual({ ok: true, value: 42 });
  });

  it("私有函数与真实导出共存：导出面只列真实导出（多声明符仍全收）", () => {
    const run = runTranspiled(
      `function helper() { return 0; }
export function f() { return helper(); }
export const a = 1, b = 2;
`,
      { mode: "exec" },
    );
    expect(Object.keys(run).sort()).toEqual(["a", "b", "f"]);
    expect(Object.hasOwn(run, "helper")).toBe(true);
  });
});

describe("export * 不被本地私有同名函数遮蔽", () => {
  it("star 的导出值胜出（原生：star 值 wins），本地私有函数仍可内部调用", () => {
    const dep = num(7);
    const mod: AbsModuleExports = { named: { foo: dep } };
    const run = runTranspiled(
      `function foo() { return 2; }
export function localFoo() { return foo(); }
export * from "./x.js";
`,
      { mode: "exec", modules: { "./x.js": mod } },
    );
    expect(Object.keys(run).sort()).toEqual(["foo", "localFoo"]);
    expect(run.foo).toBe(dep);
    expect(litValue(callTranspiledExportFull(run, "localFoo", []).result)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("真实显式导出仍压过 star（既有语义不变）", () => {
    const dep = num(7);
    const mod: AbsModuleExports = { named: { foo: dep } };
    const run = runTranspiled(
      `function priv() { return 2; }
export const foo = 42;
export * from "./x.js";
`,
      { mode: "exec", modules: { "./x.js": mod } },
    );
    expect(run.foo).not.toBe(dep);
    expect(litValue(run.foo as never)).toEqual({ ok: true, value: 42 });
  });
});

describe("transpile 发射：只有真实导出带 export 前缀", () => {
  it("私有 function 不带 export；export const 保留导出面", () => {
    const js = transpileSource(`function helper() { return 1; }
export const x = 1;
`);
    expect(js).toContain("function helper(");
    expect(js).not.toContain("export function helper");
    expect(js).toMatch(/^export let x = /m);
  });

  it("export function / export class 仍带 export 前缀", () => {
    const js = transpileSource(`export function yes() { return 1; }
export class K {}
`);
    expect(js).toContain("export function yes(");
    expect(js).toContain("export let K = $class(");
  });

  it("未传 exportedDeclNames 的低层文件入口（parseSource 直调）不发 export", () => {
    const js = transpileFile(parseSource(`function helper() { return 1; }`));
    expect(js).toContain("function helper(");
    expect(js).not.toContain("export function helper");
  });
});

describe("既有导出面语义保持", () => {
  it("export { hidden as pub }：specifier 导出可枚举、可按名调用", () => {
    const run = runTranspiled(
      `function hidden() { return 5; }
export { hidden as pub };
`,
      { mode: "exec" },
    );
    expect(Object.keys(run)).toEqual(["pub"]);
    expect(Object.hasOwn(run, "hidden")).toBe(true);
    expect(litValue(callTranspiledExportFull(run, "pub", []).result)).toEqual({
      ok: true,
      value: 5,
    });
  });

  it("export default 仍是导出槽（具名默认函数名退居私有）", () => {
    const run = runTranspiled(
      `export default function main() { return 9; }
function pom() { return 1; }
`,
      { mode: "exec" },
    );
    expect(Object.keys(run)).toEqual(["default"]);
    expect(litValue(callTranspiledExportFull(run, "default", []).result)).toEqual({
      ok: true,
      value: 9,
    });
    expect(Object.hasOwn(run, "main")).toBe(true);
    expect(Object.hasOwn(run, "pom")).toBe(true);
  });

  it("export let 的 live binding：导出函数变异后读取方拿当前值", () => {
    const run = runTranspiled(
      `export let n = 1;
export function bump() { n = 2; }
`,
      { mode: "exec" },
    );
    expect(litValue(run.n as never)).toEqual({ ok: true, value: 1 });
    callTranspiledExportFull(run, "bump", []);
    expect(litValue(run.n as never)).toEqual({ ok: true, value: 2 });
    expect(Object.keys(run).sort()).toEqual(["bump", "n"]);
  });

  it("CJS 合并名覆盖同名私有函数槽时仍可枚举（hidden setter 路径）", () => {
    const run = runTranspiled(
      `function helper() { return 1; }
exports.helper = function () { return 2; };
`,
      { mode: "exec" },
    );
    expect(Object.keys(run)).toContain("helper");
    expect(Object.getOwnPropertyDescriptor(run, "helper")?.enumerable).toBe(true);
    // 导出面 = CJS 值（Abs fn 对象，不是本地 JS 函数）
    expect(typeof run.helper).toBe("object");
    expect((run.helper as { shape?: { k?: string } }).shape?.k).toBe("fn");
    // 默认（导出语义，导出桥用）= CJS export 调用
    const asExport = callTranspiledExportFull(run, "helper", []);
    expect(litValue(asExport.result)).toEqual({ ok: true, value: 2 });
    // 分析语义（preferLocal）= 同名本地私有函数
    const local = callTranspiledExportFull(run, "helper", [], { preferLocal: true });
    expect(litValue(local.result)).toEqual({ ok: true, value: 1 });
  });
});

describe("同名 re-export 覆盖私有本地函数名：导出面与分析面分离", () => {
  it("run.g 是 re-export 值；按名分析 g 仍读本地私有函数（分析面表）", () => {
    const dep = num(7);
    const mod: AbsModuleExports = { named: { g: dep } };
    const run = runTranspiled(
      `function g(x) { return x * 2; }
export { g } from "./dd.js";
`,
      { mode: "exec", modules: { "./dd.js": mod } },
    );
    // 导出面 = re-export 值；本地私有 g 不在 Object.keys / 直接访问面
    expect(Object.keys(run)).toEqual(["g"]);
    expect(run.g).toBe(dep);
    expect(typeof run.g).not.toBe("function");
    // 分析面表：Symbol 键 + 非枚举
    const analysisSym = Object.getOwnPropertySymbols(run).find(
      (s) => s === Symbol.for("nudo.analysis"),
    );
    expect(analysisSym).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(run, analysisSym!)?.enumerable).toBe(false);
    // 默认（导出语义，导出桥用）：同名槽是 re-export 值
    const asExport = callTranspiledExportFull(run, "g", [num(3)]);
    expect(asExport.result).toBe(dep);
    // 分析语义（preferLocal）：读源码本地绑定
    const local = callTranspiledExportFull(run, "g", [num(3)], { preferLocal: true });
    expect(litValue(local.result)).toEqual({ ok: true, value: 6 });
  });
});
