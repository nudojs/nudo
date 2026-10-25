/**
 * run 表导出面 —— 行为级回归（不再锁定 transpile 文本格式）。
 *
 * runTranspiled 现在吃 host target 发射产物 + 同一次 parse 的 TranspileMeta：
 * 导出名 / 顶层函数名 / 顶层声明名 / 顶层 this / ESM 形态都来自源 AST，不再
 * 有 `export` 前缀回收或 import/export 文本改写。本文件从**可观察行为**锁：
 * - 具名 / 默认 / 命名空间 / 再导出 / export * / 字符串导出名；
 * - 私有顶层函数不在导出面但可按名调用（非枚举分析槽）；
 * - 多声明符 / 解构导出的完整名字面；
 * - CJS 合并、live import 变更、mock 遮蔽 import 绑定；
 * - env 注入与模块级同名绑定：模块级绑定胜出；
 * - 导出键插入序 dyn → cjs → 静态名；
 * - host 产物无 import/export 语句，且 meta 名字面与 run 表一致。
 */
import { describe, it, expect } from "vitest";
import { parse as babelParse } from "@babel/parser";

import { runTranspiled, callTranspiledExportFull } from "../run.ts";
import { transpileModule } from "../transpile.ts";
import { abs, litValue, type Abs } from "../../abs.ts";
import { pTrue } from "../../pred.ts";
import type { AbsModuleExports } from "../../abs-modules.ts";

const num = (value: number) =>
  abs({ k: "prim", type: "number" }, { op: "lit", value }, pTrue, "exact");

function callNum(run: Record<string, unknown>, name: string, args: Abs[] = []): unknown {
  const r = callTranspiledExportFull(run, name, args).result;
  return litValue(r as never);
}

describe("导出名面：named / default / namespace / re-export / star / string", () => {
  const deps: Record<string, AbsModuleExports> = {
    "./m.js": { named: { dep: num(3), "a-b": num(4) } },
    "./n.js": { named: { x: num(5) } },
    "./star.js": { named: { local: num(99), remote: num(7) } },
  };

  it("具名 / 默认 / 别名 / 再导出 / 命名空间 / 字符串名 / export *", () => {
    const run = runTranspiled(
      `
import * as nsImport from "./n.js";
export const named = 1;
export default function main() { return 2; }
export function readNs() { return nsImport.x; }
export { named as renamed };
export { dep as re } from "./m.js";
export { "a-b" } from "./m.js";
export * as ns from "./n.js";
export * as "my-ns" from "./n.js";
export * from "./star.js";
`,
      { modules: deps },
    );
    expect(Object.keys(run).sort()).toEqual(
      ["a-b", "default", "local", "my-ns", "named", "ns", "re", "readNs", "remote", "renamed"].sort(),
    );
    // 默认导出是函数槽；具名别名与再导出共享/解析到依赖值
    expect(callNum(run, "default")).toEqual({ ok: true, value: 2 });
    expect(callNum(run, "readNs")).toEqual({ ok: true, value: 5 });
    expect(litValue(run.named as never)).toEqual({ ok: true, value: 1 });
    expect(litValue(run.renamed as never)).toEqual({ ok: true, value: 1 });
    expect(litValue(run.re as never)).toEqual({ ok: true, value: 3 });
    expect(litValue(run["a-b"] as never)).toEqual({ ok: true, value: 4 });
    // 命名空间 re-export：obj Abs，槽读到来源导出
    const ns = run.ns as { shape: { k: string; slots: Record<string, { value: unknown }> } };
    expect(ns.shape.k).toBe("obj");
    expect(litValue(ns.shape.slots.x!.value as never)).toEqual({ ok: true, value: 5 });
    // export *：显式导出压过 star；star 只补未显式导出的名
    expect(litValue(run.remote as never)).toEqual({ ok: true, value: 7 });
    expect(litValue(run.local as never)).toEqual({ ok: true, value: 99 });
  });

  it("export * 不覆盖本地静态导出（显式面优先）", () => {
    const run = runTranspiled(
      `export * from "./star.js";\nexport const local = 1;\n`,
      { modules: deps },
    );
    expect(Object.keys(run).sort()).toEqual(["local", "remote"]);
    expect(litValue(run.local as never)).toEqual({ ok: true, value: 1 });
    expect(litValue(run.remote as never)).toEqual({ ok: true, value: 7 });
  });
});

describe("私有顶层函数：不在导出面，但可按名分析", () => {
  it("Object.keys 不含私有函数；own-property 与 callTranspiledExportFull 可用", () => {
    const run = runTranspiled(
      `function helper(n) { return n + 1; }
export function entry(n) { return helper(n); }
`,
      { mode: "exec" },
    );
    expect(Object.keys(run)).toEqual(["entry"]);
    expect(Object.hasOwn(run, "helper")).toBe(true);
    expect(typeof run.helper).toBe("function");
    expect(callNum(run, "helper", [num(41)])).toEqual({ ok: true, value: 42 });
    expect(callNum(run, "entry", [num(41)])).toEqual({ ok: true, value: 42 });
  });
});

describe("多声明符 / 解构导出", () => {
  it("export const a = 1, b = 2 全收；解构导出用真实绑定名", () => {
    const run = runTranspiled(
      `export const a = 1, b = 2;
export const { p, q: [q1] } = { p: 3, q: [4] };
`,
      { mode: "exec" },
    );
    expect(Object.keys(run).sort()).toEqual(["a", "b", "p", "q1"]);
    for (const [name, value] of [
      ["a", 1],
      ["b", 2],
      ["p", 3],
      ["q1", 4],
    ] as const) {
      expect(litValue(run[name] as never), name).toEqual({ ok: true, value });
    }
  });
});

describe("CJS 合并", () => {
  it("exports.X 可枚举；同名私有函数仍走 preferLocal=analysis", () => {
    const run = runTranspiled(
      `function helper() { return 1; }
exports.helper = function () { return 2; };
exports.legacy = 7;
`,
      { mode: "exec" },
    );
    expect(Object.keys(run).sort()).toEqual(["helper", "legacy"]);
    expect(Object.getOwnPropertyDescriptor(run, "helper")?.enumerable).toBe(true);
    expect(callNum(run, "helper")).toEqual({ ok: true, value: 2 });
    const local = callTranspiledExportFull(run, "helper", [], { preferLocal: true }).result;
    expect(litValue(local as never)).toEqual({ ok: true, value: 1 });
    expect(litValue(run.legacy as never)).toEqual({ ok: true, value: 7 });
  });
});

describe("import 绑定：live 刷新与 mock 遮蔽", () => {
  it("依赖导出变更经调用入口刷新到 import 绑定（live binding）", () => {
    const dep: AbsModuleExports = { named: { value: num(1) } };
    const run = runTranspiled(
      `import { value } from "./dep.js";
export function read() { return value; }
export { value };
`,
      { modules: { "./dep.js": dep } },
    );
    expect(litValue(run.value as never)).toEqual({ ok: true, value: 1 });
    expect(callNum(run, "read")).toEqual({ ok: true, value: 1 });
    dep.named!.value = num(2);
    // 调用入口 refresh 后，函数体读当前导出值
    expect(callNum(run, "read")).toEqual({ ok: true, value: 2 });
    // export { value } 的 lazy 槽读同一模块级绑定（调用后已刷新）
    expect(litValue(run.value as never)).toEqual({ ok: true, value: 2 });
  });

  it("mock 遮蔽 import 绑定：读 mock 值且不被 live refresh 冲掉（Bug 273）", () => {
    const dep: AbsModuleExports = { named: { value: num(1) } };
    const run = runTranspiled(
      `import { value } from "./dep.js";
export function read() { return value; }
`,
      { modules: { "./dep.js": dep }, mocks: { value: num(9) } },
    );
    expect(callNum(run, "read")).toEqual({ ok: true, value: 9 });
    expect(callNum(run, "read")).toEqual({ ok: true, value: 9 });
  });
});

describe("env/mock 注入与模块级绑定撞名：模块级绑定胜出（Bug 273）", () => {
  it("env 同名顶层 const：不注入 env 值，模块绑定保持", () => {
    const run = runTranspiled(
      `const value = 1;
export function read() { return value; }
`,
      { envGlobals: { value: num(9) } },
    );
    expect(Object.keys(run)).toEqual(["read"]);
    expect(callNum(run, "read")).toEqual({ ok: true, value: 1 });
  });

  it("mock 同名顶层 const：模块绑定保持", () => {
    const run = runTranspiled(
      `const value = 1;
export function read() { return value; }
`,
      { mocks: { value: num(9) } },
    );
    expect(callNum(run, "read")).toEqual({ ok: true, value: 1 });
  });

  it("env 与解构临时名同级也不炸（转译避让集覆盖注入名）", () => {
    const run = runTranspiled(
      `export const { a } = { a: 1 };
`,
      { envGlobals: { _d0: num(9) } },
    );
    expect(litValue(run.a as never)).toEqual({ ok: true, value: 1 });
  });

  it("顶层块内 var 提升名与 env/mock 注入撞名：不重复声明", () => {
    for (const opts of [
      { envGlobals: { hoisted: num(9) } },
      { mocks: { hoisted: num(9) } },
    ]) {
      const run = runTranspiled(
        `if (true) { var hoisted = 1; }
export const y = 2;
`,
        opts,
      );
      expect(Object.keys(run)).toEqual(["y"]);
      expect(litValue(run.y as never)).toEqual({ ok: true, value: 2 });
    }
  });
});

describe("导出键插入序：dyn → cjs → 静态名", () => {
  it("specifier 再导出 / CJS 合并 / 静态声明按旧顺序插入", () => {
    const run = runTranspiled(
      `export { dep as dyn } from "./m.js";
export const stat = 3;
exports.cjsKey = 2;
`,
      { modules: { "./m.js": { named: { dep: num(1) } } } },
    );
    expect(Object.keys(run)).toEqual(["dyn", "cjsKey", "stat"]);
    expect(litValue(run.dyn as never)).toEqual({ ok: true, value: 1 });
    expect(litValue(run.stat as never)).toEqual({ ok: true, value: 3 });
  });

  it("静态槽内部：导出函数在前（源序），const/let 在后（旧文本回收口径）", () => {
    const run = runTranspiled(
      `export const c1 = 1;
export function f1() { return 1; }
export const c2 = 2;
export function f2() { return 2; }
`,
    );
    expect(Object.keys(run)).toEqual(["f1", "f2", "c1", "c2"]);
  });
});

describe("TS type-only 模块标记：仍是 ESM（strict / 顶层 this === undefined）", () => {
  it("只有 type import/export 的源：顶层 this 写抛（与旧文本口径一致）", () => {
    // meta.isEsm 基于剥除 TS 后的 AST（type-only 声明已删）⇒ run.ts 用源文本
    // 口径补模块标记：否则 .ts 模块会被当成 sloppy CJS。
    expect(() => runTranspiled(`export type X = number;\nthis.x = 1;`)).toThrow();
    expect(() =>
      runTranspiled(`import type { Y } from "./y.d.ts";\nthis.x = 1;`),
    ).toThrow();
  });
});

describe("host 产物与 meta 一致性", () => {
  it("产物无 import/export 语句；meta 名字面 = run 表枚举面", () => {
    const src = `
import { v as depV } from "./dep.js";
export const a = 1, b = 2;
export function f() { return depV; }
function priv() { return 0; }
export default function main() { return a; }
export { a as alias };
export { "x-y" } from "./dep.js";
`;
    const { code, meta } = transpileModule(src, { target: "host" });
    const ast = babelParse(code, {
      sourceType: "script",
      allowReturnOutsideFunction: false,
    });
    const esmStatements = ast.program.body.filter(
      (n) =>
        n.type === "ImportDeclaration" ||
        n.type === "ExportNamedDeclaration" ||
        n.type === "ExportDefaultDeclaration" ||
        n.type === "ExportAllDeclaration",
    );
    expect(esmStatements).toEqual([]);
    expect(meta.runtimeImportName).toBeNull();

    const run = runTranspiled(src, {
      modules: { "./dep.js": { named: { v: num(3), "x-y": num(4) } } },
    });
    // 硬编码期望（不从 meta 派生——否则断言与实现同源，meta 漂移不可见）。
    const expected = ["a", "alias", "b", "default", "f", "x-y"];
    expect(Object.keys(run).sort()).toEqual(expected);
    // meta 是 run 名字面的来源：它也必须与同一份硬编码期望一致。
    expect(
      [
        ...new Set([
          ...meta.staticExportNames,
          ...meta.explicitExportNames,
          ...(meta.hasDefault ? ["default"] : []),
        ]),
      ].sort(),
    ).toEqual(expected);
    // 私有函数在分析槽里，不在导出面
    expect(Object.keys(run)).not.toContain("priv");
    expect(Object.hasOwn(run, "priv")).toBe(true);
  });
});
