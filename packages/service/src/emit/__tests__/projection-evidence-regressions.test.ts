/**
 * 投影面证据回归：注解词法判据 / 类型名可解析性 / 默认值证据 / 声明器注解 /
 * namespace 成员推断 / 观测域拓宽。
 *
 * 每条缺陷只保留在 `it` 标题的 provenance（文件名不含缺陷编号）。
 */
import { describe, it, expect } from "vitest";
import {
  abs as makeAbs,
  any,
  constraintToEntryAbs,
  joinAbs,
  litC,
  number,
  obj,
  shape,
  type Abs,
} from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import {
  dtsModuleSurface,
  projectFunctionDts,
  projectModuleDts,
  type DtsContractFace,
  type DtsModuleExtras,
} from "../dts-generator.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import { absToSchemaSource } from "../schema-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

const PATH = "/test/projection-regressions.ts";

/** 分析面 bindings → 模块面值声明证据（与 CLI `export --format dts` 同口径） */
function valuesOf(source: string): DtsModuleExtras {
  const result = analyzeFile(PATH, source);
  const values = new Map<string, Abs>();
  for (const [name, info] of result.bindings) values.set(name, info.abs);
  return { values };
}

/** 整模块 dts 产物（无手写契约） */
function moduleDts(source: string): string {
  const result = analyzeFile(PATH, source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions.map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries, valuesOf(source)).lines.join("\n");
}

/** 单个函数的 dts 投影（契约面显式给出） */
function contractedDts(source: string, fnName: string, contract: DtsContractFace): string {
  const fn = analyzeFile(PATH.replace(/\.ts$/, ".js"), source).functions.find(
    (f) => f.name === fnName,
  );
  if (!fn) throw new Error(`function not found: ${fnName}`);
  const surface = dtsModuleSurface(source);
  const projection = projectFunctionDts(fn, contract, surface);
  return projectModuleDts(surface, [{ fn, projection, contract }], valuesOf(source)).lines.join(
    "\n",
  );
}

/** 观测字面量（调用点实参形态：term=lit，无 pred） */
const observedLit = (value: string | number): Abs =>
  makeAbs(
    { k: "prim", type: typeof value === "number" ? "number" : "string" } as Abs["shape"],
    { op: "lit", value },
    undefined,
    "exact",
  );

describe("注解词法判据（内联对象方法名 / 字符串字面量）", () => {
  it("BUG-176 内联对象类型的方法名是成员键、不是类型引用：`{ m?(): number }` / `{ m(): number }` 注解整条保留；合法调用通过、缺必选方法报 TS2345", () => {
    const dts = moduleDts(`export function hasMethod(o: { m?(): number }): number { return o.m ? o.m() : 0; }
export function needsMethod(o: { m(): number }): number { return o.m(); }
export function dataProp(o: { x: number }): number { return o.x; }
export function callSig(o: { (): number }): number { return o(); }
`);
    expect(dts).toContain("hasMethod(o: { m?(): number })");
    expect(dts).toContain("needsMethod(o: { m(): number })");
    expect(dts).toContain("dataProp(o: { x: number })");
    expect(dts).toContain("callSig(o: { (): number })");
    expect(dts).not.toContain("(o: Record<string, never>)");

    const valid = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts":
        'import { hasMethod, needsMethod } from "./mod.js";\nexport const a = hasMethod({ m: () => 1 });\nexport const b = needsMethod({ m: () => 2 });\n',
    });
    expect(valid.ok, valid.stderr).toBe(true);
    const invalid = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { needsMethod } from "./mod.js";\nneedsMethod({});\n',
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.stderr).toContain("TS2345");
  });

  it("BUG-191 字符串 / 模板字面量类型内部的文本不是类型引用：`\"a\" | \"b\"` / `{ kind: \"ok\" }` / `(\"x\" | \"y\")[]` / `` `pre-${string}` `` 原样保留，错误实参分别报 TS2345 / TS2322", () => {
    const dts = moduleDts(`export function litA(x: "a" | "b"): string { return x; }
export function litObj(p: { kind: "ok"; n: number }): number { return p.n; }
export function litArr(p: ("x" | "y")[]): string { return p[0] ?? ""; }
export function litTag(x: \`pre-\${string}\`): string { return x; }
`);
    expect(dts).toContain('litA(x: "a" | "b")');
    expect(dts).toContain('litObj(p: { kind: "ok"; n: number })');
    expect(dts).toContain('litArr(p: ("x" | "y")[])');
    expect(dts).toContain("litTag(x: `pre-${string}`)");
    expect(dts).not.toContain("dropped-type-annotation");

    const valid = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts":
        'import { litA, litObj, litArr, litTag } from "./mod.js";\nexport const a = litA("a");\nexport const b = litObj({ kind: "ok", n: 1 });\nexport const c = litArr(["x"]);\nexport const d = litTag("pre-x");\n',
    });
    expect(valid.ok, valid.stderr).toBe(true);
    const invalid = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts":
        'import { litA, litObj, litArr } from "./mod.js";\nlitA("z");\nlitObj({ kind: "bad", n: 1 });\nlitArr(["z"]);\n',
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.stderr).toContain("TS2345");
    expect(invalid.stderr).toContain("TS2322");
  });
});

describe("类型名可解析性（同模块 enum）", () => {
  it("BUG-190 导出 enum 的类型名可解析：形参 / 返回位 / 类字段注解保留 `Color`；消费方正确赋值通过、错值报 TS2345", () => {
    const dts = moduleDts(`export enum Color { Red = "red", Green = "green" }
export function paint(c: Color): string { return "painted"; }
export class Box { c: Color = Color.Red; }
export function pick(c: Color): Color { return c; }
`);
    expect(dts).toContain("paint(c: Color): string");
    expect(dts).toContain("pick(c: Color): Color");
    expect(dts).toContain("class Box {\n  c: Color;\n}");
    expect(dts).toContain("export declare enum Color");
    expect(dts).not.toContain("dropped-type-annotation");

    const checked = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts":
        'import { paint, pick, Box, Color } from "./mod.js";\nexport const a: string = paint(Color.Red);\nexport const b: Color = pick(Color.Red);\nexport const c: Color = new Box().c;\npaint("not-a-color");\n',
    });
    expect(checked.ok).toBe(false);
    expect(checked.stderr).toContain("TS2345");
    // 正确赋值不得再是 TS2322（旧实现的「unknown 返回 / 字段」假红）
    expect(checked.stderr).not.toContain("TS2322");
  });
});

describe("契约泛型不得从槽名发明", () => {
  it("BUG-180 `fn({ v: any() }, any())` 不发明 `<v, return2>`，any 槽投影成 `any`；槽名与返回属性键同名也不长出 `<id extends number>`", () => {
    const anyEntry = (name: string): Abs => constraintToEntryAbs(any(), name);
    const identAny = contractedDts(
      "export function identAny(v) { return v; }",
      "identAny",
      { params: [{ name: "v", abs: anyEntry("v") }], return: anyEntry("return") },
    );
    expect(identAny).toContain("declare function identAny(v: any): any;");
    expect(identAny).not.toContain("<");
    expect(identAny).not.toContain("return2");

    const collide = contractedDts(
      "export function collide(id) { return { id: id }; }",
      "collide",
      {
        params: [{ name: "id", abs: constraintToEntryAbs(number(), "id") }],
        return: constraintToEntryAbs(shape({ id: number() }), "return"),
      },
    );
    expect(collide).toContain("declare function collide(id: number): { id: number };");
    expect(collide).not.toContain("<id");

    const checked = tscNoEmit({
      "ident.d.ts": identAny,
      "use.ts":
        'import { identAny } from "./ident.js";\nexport const a = identAny(5);\nexport const n: number = a.toFixed();\n',
    });
    expect(checked.ok, checked.stderr).toBe(true);
  });
});

describe("形参默认值是类型证据", () => {
  it("BUG-193 `f(x = 1)` ⇒ `x?: number`（字符串 / 布尔 / null / 数组 / 对象同口径），错误实参报 TS2345", () => {
    const dts = moduleDts(`export function f1(x = 1) { return x; }
export function f2(x = "s") { return x; }
export function f3(x = true) { return x; }
export function f4(x = null) { return x; }
export function f5(x = [1, 2]) { return x.length; }
export function f6(x = { a: 1 }) { return x.a; }
export function g1(x: number = 1) { return x; }
`);
    expect(dts).toContain("f1(x?: number)");
    expect(dts).toContain("f2(x?: string)");
    expect(dts).toContain("f3(x?: boolean)");
    expect(dts).toContain("f4(x?: null)");
    expect(dts).toContain("f5(x?: number[])");
    expect(dts).toContain("f6(x?: { a: number })");
    expect(dts).toContain("g1(x?: number)");

    const valid = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts":
        'import { f1, f2, f5, f6 } from "./mod.js";\nexport const a = f1(1);\nexport const b = f2("s");\nexport const c = f5([1, 2]);\nexport const d = f6({ a: 1 });\n',
    });
    expect(valid.ok, valid.stderr).toBe(true);
    const invalid = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { f1, f2 } from "./mod.js";\nf1("s");\nf2(1);\n',
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.stderr).toContain("TS2345");
  });
});

describe("静态方法形参注解", () => {
  it("BUG-207 static 方法保留源码形参注解（`static sm(a: number)`），消费方错实参报 TS2345", () => {
    const dts = moduleDts(`export class Cls {
  static sm(a: number): number { return a + 1; }
  static sm2(a: string, b: boolean): string { return a + String(b); }
  im(a: number): number { return a + 1; }
}
`);
    expect(dts).toContain("static sm(a: number): number;");
    expect(dts).toContain("static sm2(a: string, b: boolean): string;");
    expect(dts).toContain("im(a: number): number;");

    const invalid = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { Cls } from "./mod.js";\nexport const n: number = Cls.sm("str");\n',
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.stderr).toContain("TS2345");
  });
});

describe("namespace 成员 / 声明器注解", () => {
  it("BUG-230 namespace 内无注解 const 的初始化器给出推断类型（`N.inferred: number`），消费方 `const n: number = N.inferred` 通过", () => {
    const dts = moduleDts(`export namespace N {
  export const ann: number = 1;
  export const inferred = 1;
}
export const topInferred = 1;
`);
    expect(dts).toContain("export const ann: number;");
    expect(dts).toContain("export const inferred: number;");
    expect(dts).toContain("export declare const topInferred: number;");

    const checked = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts":
        'import { N, topInferred } from "./mod.js";\nexport const n: number = N.inferred;\nexport const m: number = topInferred;\n',
    });
    expect(checked.ok, checked.stderr).toBe(true);
  });

  it("BUG-231 `export const cb: Fn = <箭头>` 保留 const 形态与声明器注解（`declare const cb: Fn`），别名可选形参不被吞、形参不退化 unknown", () => {
    const dts = moduleDts(`export type Fn = (a: number, b?: string) => void;
export const cb: Fn = (a: number) => {};
`);
    expect(dts).toContain("export declare const cb: Fn;");
    expect(dts).not.toContain("declare function cb");

    const optional = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { cb } from "./mod.js";\ncb(1, "x");\n',
    });
    expect(optional.ok, optional.stderr).toBe(true);

    // 假绿方向：注解里的必选形参不得退化成 unknown
    const dts2 = moduleDts(`export type Fn2 = (a: number, b: string) => void;
export const cb2: Fn2 = (a, b) => {};
`);
    expect(dts2).toContain("export declare const cb2: Fn2;");
    const wrong = tscNoEmit({
      "mod.d.ts": dts2,
      "use.ts": 'import { cb2 } from "./mod.js";\ncb2("wrong", 123);\n',
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.stderr).toContain("TS2345");
  });
});

describe("观测域拓宽（guard / zod）", () => {
  it("BUG-213 调用点字面量联合必须拓宽成声明域：`fInput` 是 `z.string()`、`fOutput` 是 number 域、守卫是 `typeof number`；契约字面量不受影响", () => {
    const inputUnion = joinAbs(observedLit("a"), observedLit("bb"));
    const input = obj({ s: { value: inputUnion } });
    expect(absToSchemaSource(input)).toBe("z.object({ s: z.string() })");

    const outputUnion = joinAbs(observedLit(1), observedLit(2));
    const outputSource = absToSchemaSource(outputUnion);
    expect(outputSource).not.toContain("z.literal(1)");
    expect(outputSource).not.toContain("z.literal(2)");
    expect(outputSource).toContain("z.number()");
    const guard = generateGuardFunctionFromAbs("isfOutput", outputUnion);
    expect(guard).toContain('typeof data === "number"');
    expect(guard).not.toContain("data === 1");

    // 负控制：契约申报的字面量域（term=var + pred=eq）必须保留精度
    const contractLiteral = constraintToEntryAbs(litC("a"), "x");
    expect(absToSchemaSource(contractLiteral)).toContain('z.literal("a")');
  });
});
