/**
 * transpileModule / host target 回归。
 *
 * 覆盖：
 * - 默认 esm target 与 transpileSource 逐字节一致（新增结构化 API 不得改发射）；
 * - runtimeImport: null / host target 不发射运行时 import 行；
 * - meta 从源 AST 回收 imports / 静态与显式导出名 / export * / default /
 *   顶层函数名 / 顶层声明名 / 顶层 this / ESM 形态；
 * - host target 直接发射 __nudoBindImport / __nudoBindNamespace /
 *   __nudoExport* ，不残留 import/export 语句（用 @babel/parser 校验）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";

import { transpileModule, transpileSource } from "../transpile.ts";
import type { TranspileOptions } from "../transpile.ts";

/** host 产物不得含任何 ESM import/export 语句（注释不算语句）。 */
function esmStatementCount(code: string): number {
  // script 口径：host 产物必须能在无模块面下解析
  const ast = parse(code, { sourceType: "script", allowReturnOutsideFunction: false });
  return ast.program.body.filter(
    (n) =>
      n.type === "ImportDeclaration" ||
      n.type === "ExportNamedDeclaration" ||
      n.type === "ExportDefaultDeclaration" ||
      n.type === "ExportAllDeclaration",
  ).length;
}

const SRC = [
  `import d, { a as b, "x-y" as xy } from "./m.js";`,
  `import * as ns from "./n.js";`,
  `import "./side.js";`,
  `import { mocked } from "./m2.js";`,
  `export const x = 1, y = 2;`,
  `export function f(v) { return v + b; }`,
  `function privateFn() { return d; }`,
  `export default function main() { return x; }`,
  `export { x as xx, b };`,
  `export { a as "a-b" } from "./m.js";`,
  `export * as all from "./n.js";`,
  `export * from "./star.js";`,
].join("\n");

const HOST: TranspileOptions = {
  target: "host",
  mockNames: new Set(["mocked"]),
};

describe("transpileModule：默认 esm target 逐字节不变", () => {
  it("code 与 transpileSource 相同（默认 / 显式 esm）", () => {
    expect(transpileModule(SRC).code).toBe(transpileSource(SRC));
    expect(transpileModule(SRC, { target: "esm" }).code).toBe(
      transpileSource(SRC, { target: "esm" }),
    );
  });

  it("保留运行时 import 行与标准 import/export 语句", () => {
    const code = transpileModule(SRC).code;
    expect(code).toContain('from "@nudojs/core/exec"');
    expect(code).toContain('import { a as b, "x-y" as xy, default as d } from "./m.js";');
    expect(code).toContain('import { * as ns } from "./n.js";');
    expect(code).toContain("export function f");
    expect(code).toContain('export * from "./star.js";');
  });

  it("runtimeImport: null 只省略运行时 import 行（其余 ESM 面保留）", () => {
    const { code, meta } = transpileModule(SRC, { runtimeImport: null });
    expect(code).not.toContain("@nudojs/core/exec");
    expect(code).not.toContain("import { $absVal");
    expect(code).toContain('from "./m.js"');
    expect(meta.runtimeImportName).toBeNull();
  });

  it("自定义 runtimeImport 进 meta", () => {
    const { code, meta } = transpileModule("const x = 1;", {
      runtimeImport: "./runtime.js",
    });
    expect(code).toContain('from "./runtime.js"');
    expect(meta.runtimeImportName).toBe("./runtime.js");
  });
});

describe("transpileModule：meta 从源 AST 回收", () => {
  const meta = transpileModule(SRC).meta;

  it("imports（named / default / namespace / side，多 specifier 展开）", () => {
    expect(meta.imports).toEqual([
      { spec: "./m.js", kind: "default", local: "d" },
      { spec: "./m.js", kind: "named", imported: "a", local: "b" },
      { spec: "./m.js", kind: "named", imported: "x-y", local: "xy" },
      { spec: "./n.js", kind: "namespace", local: "ns" },
      { spec: "./side.js", kind: "side" },
      { spec: "./m2.js", kind: "named", imported: "mocked", local: "mocked" },
    ]);
  });

  it("静态导出名 / 显式导出名 / export * / default", () => {
    expect(meta.staticExportNames).toEqual(["x", "y", "f"]);
    expect(meta.explicitExportNames).toEqual(["xx", "b", "a-b", "all"]);
    expect(meta.exportStars).toEqual(["./star.js"]);
    expect(meta.hasDefault).toBe(true);
  });

  it("顶层函数名 / 顶层声明名（含 import、CJS 前导名）", () => {
    expect(meta.topLevelFnNames).toEqual(["f", "privateFn", "main"]);
    expect(meta.declaredNames).toEqual(
      expect.arrayContaining([
        "d",
        "b",
        "xy",
        "ns",
        "mocked",
        "x",
        "y",
        "f",
        "privateFn",
        "main",
        "exports",
        "module",
        "__nudoCjsOrig",
        "__nudoCjsThis",
      ]),
    );
    // 私有顶层函数不是静态导出
    expect(meta.staticExportNames).not.toContain("privateFn");
  });

  it("顶层块内 var 提升名进 declaredNames（env/mock 注入撞名不重复声明）", () => {
    const m = transpileModule(
      `if (globalThis.x) { var blk = 1; }\nfor (var i = 0; i < 1; i++) {}\nexport const own = blk;`,
    ).meta;
    expect(m.declaredNames).toEqual(expect.arrayContaining(["blk", "i"]));
  });

  it("isEsm / runtimeImportName", () => {
    expect(meta.isEsm).toBe(true);
    expect(meta.runtimeImportName).toBe("@nudojs/core/exec");
    expect(transpileModule("const x = 1;", { target: "host" }).meta.runtimeImportName).toBeNull();
  });

  it("多声明符与解构导出：内部名不进 static，真实绑定名进 explicit", () => {
    const m = transpileModule(`export const { p, q: [q1] } = obj, z = 1;`).meta;
    expect(m.staticExportNames).toEqual(["z"]);
    expect(m.explicitExportNames).toEqual(["p", "q1"]);
    expect(m.declaredNames).toEqual(
      expect.arrayContaining(["p", "q1", "z"]),
    );
  });

  it("usesTopLevelThis：顶层 this / 顶层箭头捕获为真", () => {
    expect(
      transpileModule(`const f = () => this.x; this.y = 1;`).meta.usesTopLevelThis,
    ).toBe(true);
    expect(
      transpileModule(`const f = () => this.x;`).meta.usesTopLevelThis,
    ).toBe(true);
    // 类计算键在类外作用域求值 ⇒ 顶层 this
    expect(
      transpileModule(`class C { [this.k]() {} }`).meta.usesTopLevelThis,
    ).toBe(true);
  });

  it("usesTopLevelThis：函数 / 方法 / 类字段自己的 this 不算", () => {
    const src = [
      `function g() { return this.y; }`,
      `class C { m() { return this.z; } }`,
      `const h = () => { function inner() { return this.k; } return inner(); };`,
      `class D { field = this.w; static { this.s = 1; } }`,
    ].join("\n");
    expect(transpileModule(src).meta.usesTopLevelThis).toBe(false);
  });

  it("isEsm：动态 import / CJS 为假，import.meta 为真", () => {
    expect(transpileModule(`const m = import("./m.js");`).meta.isEsm).toBe(false);
    expect(transpileModule(`module.exports = { x: 1 };`).meta.isEsm).toBe(false);
    expect(transpileModule(`const u = import.meta.url;`).meta.isEsm).toBe(true);
  });
});

describe("host target：import/export 直接发射", () => {
  const { code, meta } = transpileModule(SRC, HOST);

  it("不残留 import/export 语句，且可作为 script 解析", () => {
    expect(esmStatementCount(code)).toBe(0);
    expect(code).not.toMatch(/^import\b/m);
    expect(code).not.toMatch(/^export\b/m);
    expect(code).not.toContain("@nudojs/core/exec");
  });

  it("import 绑定：default / named / 字符串名 / namespace / 副作用", () => {
    expect(code).toContain(`let d = __nudoBindImport("./m.js", "default");`);
    expect(code).toContain(`let b = __nudoBindImport("./m.js", "a");`);
    expect(code).toContain(`let xy = __nudoBindImport("./m.js", "x-y");`);
    expect(code).toContain(`let ns = __nudoBindNamespace("./n.js");`);
    expect(code).toContain(`void __nudoBindNamespace("./side.js");`);
  });

  it("mock 绑定读 __nudoEnv 且不进 live refresh", () => {
    expect(code).toContain(`let mocked = __nudoEnv["mocked"];`);
    expect(code).not.toContain(`__nudoBindImport("./m2.js", "mocked");`);
    expect(code).toContain("let __nudoRefreshKeep;");
    const register = code.slice(code.indexOf("__nudoRegisterImportRefresh"));
    expect(register).toContain(`d = __nudoBindImport("./m.js", "default");`);
    expect(register).toContain(`b = __nudoBindImport("./m.js", "a");`);
    expect(register).toContain(`xy = __nudoBindImport("./m.js", "x-y");`);
    expect(register).toContain(`ns = __nudoBindNamespace("./n.js");`);
    expect(register.slice(0, register.indexOf(");"))).not.toContain("mocked =");
  });

  it("声明导出：本地声明无 export 前缀 + __nudoExportLazy", () => {
    expect(code).toContain(`__nudoExportLazy("x", () => x);`);
    expect(code).toContain(`__nudoExportLazy("y", () => y);`);
    expect(code).toContain(`__nudoExportLazy("f", () => f);`);
    expect(code).not.toContain(`__nudoExportLazy("privateFn"`);
    expect(code).toContain(`__nudoExport("default", main);`);
  });

  it("specifier / re-export / export * as / export *", () => {
    expect(code).toContain(`__nudoExportLazy("xx", () => x);`);
    expect(code).toContain(`__nudoExportLazy("b", () => b);`);
    expect(code).toContain(
      `__nudoExportLazy("a-b", () => __nudoBindImport("./m.js", "a"));`,
    );
    expect(code).toContain(
      `__nudoExportLazy("all", () => __nudoBindNamespace("./n.js"));`,
    );
    expect(code).toContain(`__nudoExportStar("./star.js");`);
  });

  it("meta 与 esm target 同源（target 只改发射面与运行时 import 面）", () => {
    expect(meta).toEqual({ ...transpileModule(SRC).meta, runtimeImportName: null });
  });
});

describe("host target：边界形态", () => {
  it("全部 import 绑定被 mock ⇒ 不注册 refresh、不声明 __nudoRefreshKeep", () => {
    const code = transpileModule(`import { a } from "./m.js"; import { b } from "./m.js";`, {
      target: "host",
      mockNames: new Set(["a", "b"]),
    }).code;
    expect(code).toContain(`let a = __nudoEnv["a"];`);
    expect(code).toContain(`let b = __nudoEnv["b"];`);
    expect(code).not.toContain("__nudoRegisterImportRefresh");
    expect(code).not.toContain("__nudoRefreshKeep");
  });

  it("默认 + 命名空间混合 import", () => {
    const code = transpileModule(`import d, * as ns from "./m.js"; d; ns;`, {
      target: "host",
    }).code;
    expect(code).toContain(`let d = __nudoBindImport("./m.js", "default");`);
    expect(code).toContain(`let ns = __nudoBindNamespace("./m.js");`);
    expect(esmStatementCount(code)).toBe(0);
  });

  it("匿名 default 函数/类合成名后 __nudoExport", () => {
    const fn = transpileModule(`export default function() { return 1; }`, {
      target: "host",
    }).code;
    expect(fn).toMatch(/function __nudoDefaultFn\b/);
    expect(fn).toContain(`__nudoExport("default", __nudoDefaultFn);`);
    const cls = transpileModule(`export default class { m() { return 1; } }`, {
      target: "host",
    }).code;
    expect(cls).toMatch(/let __nudoDefaultClass = \$class/);
    expect(cls).toContain(`__nudoExport("default", __nudoDefaultClass);`);
    expect(esmStatementCount(cls)).toBe(0);
  });

  it("解构导出：真实绑定名 lazy 导出", () => {
    const code = transpileModule(`export const { p, q: [q1] } = obj;`, {
      target: "host",
    }).code;
    expect(code).toContain(`__nudoExportLazy("p", () => p);`);
    expect(code).toContain(`__nudoExportLazy("q1", () => q1);`);
    expect(code).not.toMatch(/^export\b/m);
    expect(esmStatementCount(code)).toBe(0);
  });

  it("export * as <string> 保留字符串导出名", () => {
    const m = transpileModule(`export * as "a-b" from "./m.js";`, { target: "host" });
    expect(m.meta.explicitExportNames).toEqual(["a-b"]);
    expect(m.code).toContain(
      `__nudoExportLazy("a-b", () => __nudoBindNamespace("./m.js"));`,
    );
    expect(esmStatementCount(m.code)).toBe(0);
  });

  it("host target 即使 runtimeImport 为字符串也不发射运行时 import 行", () => {
    const code = transpileModule(`export const x = 1;`, {
      target: "host",
      runtimeImport: "@nudojs/core/exec",
    }).code;
    expect(code).not.toContain("@nudojs/core/exec");
    expect(esmStatementCount(code)).toBe(0);
  });

  it("transpileSource 也支持 host target（无需 meta）", () => {
    const code = transpileSource(`import { a } from "./m.js"; export const x = a;`, {
      target: "host",
    });
    expect(esmStatementCount(code)).toBe(0);
    expect(code).toContain(`let a = __nudoBindImport("./m.js", "a");`);
    expect(code).toContain(`__nudoExportLazy("x", () => x);`);
  });

  it("多种导出/导入形态的 host 产物均可作为 script 解析", () => {
    const sources = [
      `export var a = 1, b = 2;`,
      `export let [x, y] = arr;`,
      `export class C { m() { return 1; } }`,
      `export default 1 + 2;`,
      `export default (class { m() {} });`,
      `export { default as d } from "./m.js";`,
      `export { "a-b" as c } from "./m.js";`,
      `export * as "ns-x" from "./m.js";`,
      `import {} from "./m.js";`,
      `import d, { a } from "./m.js"; export { d, a };`,
      `export async function af() { return 1; }`,
      `export function* g() { yield 1; }`,
    ];
    for (const src of sources) {
      const code = transpileModule(src, { target: "host" }).code;
      expect(esmStatementCount(code), src).toBe(0);
      // module 口径同样可解析（强于 script）
      expect(() => parse(code, { sourceType: "module" }), src).not.toThrow();
    }
  });
});
