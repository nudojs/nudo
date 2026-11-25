/**
 * 模块套件：返回位声明注解的发布口径（与 tsc `--declaration` 同口径）。
 *
 * 返回位有声明注解 ⇒ `.d.ts` **发布声明**；观测只用于对账
 * （`nudo:return-annotation-mismatch` 台账，不改发布类型）。唯一例外：注解
 * 引用了产物里不可解析的类型名 ⇒ dropped 台账 + 回落观测（不可解析的名字
 * 落进产物就是消费端 TS2304）。
 *
 * 旧实现在「观测有信息就让位观测」之上叠了一串形状白名单（具名 enum / 泛型
 * 实参 / lib 全局纯类型名 / 内建占位 / `readonly` 前缀 / 函数类型 / 字面量 /
 * `| undefined`），逐类放行声明；白名单之外声明与观测冲突时产物跟观测走。
 * 现在只有一条规则，这些形状都只是它的普通实例——本文件逐类钉住。
 */
import { describe, it, expect } from "vitest";
import { str } from "@nudojs/core";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../dts-generator.ts";
import { analyzeFile } from "../../analyzer.ts";
import type { FunctionAnalysis } from "../../analyzer-types.ts";

/** 模块面 dts（CLI `export --format dts` 的产品面路径：模块面 + 逐函数投影）。 */
function moduleDts(
  source: string,
  /** 逐函数的手写契约面（缺省 = 无契约） */
  contractOf?: (fn: FunctionAnalysis) => Parameters<typeof projectFunctionDts>[1],
  /** 为真时连**无 case** 的函数（`@nudo:skip`）一起投影——它们走 rest-args 声明面 */
  includeNoCase = false,
): string {
  const result = analyzeFile("/test/declared-return.ts", source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions
    .filter((fn) => fn.cases.length > 0 || includeNoCase)
    .map((fn) => ({ fn, projection: projectFunctionDts(fn, contractOf?.(fn), surface) }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

describe("返回位声明注解：有声明 ⇒ 发布声明", () => {
  it("被删白名单的每一类形状都只是这条规则的普通实例：具名 enum；`Box<number>`；`RegExpExecArray`；`Map<string, number>`；`readonly T[]`；函数类型；字面量类型；`| undefined`", () => {
    const dts = moduleDts(
      `export enum Dir { Up, Down }
export function pickDir(): Dir { return Dir.Up; }
pickDir();
export class Box<T> { constructor(v: T) { this.v = v; } }
export function mkBox(): Box<number> { return new Box(1); }
mkBox();
export function execOf(s: string): RegExpExecArray | null { return /a/.exec(s); }
execOf("a");
export function counter(): Map<string, number> { return new Map([["k", 1]]); }
counter();
export function roNames(): readonly string[] { return ["a"]; }
roNames();
export function makeAdder(n: number): (x: number) => number { return (x) => x + n; }
makeAdder(1);
export function label(): "a" | "b" { return "a"; }
label();
export function first(xs: number[]): number { return xs[0]; }
first([1]);
`,
    );
    expect(dts).toContain("export declare function pickDir(): Dir;");
    expect(dts).toContain("export declare function mkBox(): Box<number>;");
    expect(dts).toContain(
      "export declare function execOf(s: string): RegExpExecArray | null;",
    );
    expect(dts).toContain("export declare function counter(): Map<string, number>;");
    expect(dts).toContain("export declare function roNames(): readonly string[];");
    expect(dts).toContain("): (x: number) => number;");
    expect(dts).toContain('export declare function label(): "a" | "b";');
    // BUG-362：抽象下标读的观测带 `| undefined` 臂，声明位必须干净
    expect(dts).toContain("export declare function first(xs: number[]): number;");
    expect(dts).not.toMatch(/export declare function first\([^)]*\): number \| undefined/);
    // 实现都是正确的 ⇒ 一条台账都不该有
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  });

  it("观测是声明域的真子集 ⇒ 发布声明、无台账", () => {
    const dts = moduleDts(
      `export function wide(): number | string { return 1; }
wide();
`,
    );
    expect(dts).toContain("export declare function wide(): number | string;");
    expect(dts).not.toContain("return-annotation-mismatch");
  });

  it("注解引用不可解析的类型名 ⇒ dropped 台账 + 回落观测，且不再对账", () => {
    const dts = moduleDts(
      `export function ghost(): Missing { return 1; }
ghost();
`,
    );
    // 不可解析的名字落进产物就是消费端 TS2304——这是「发布声明」的唯一例外
    expect(dts).not.toContain("ghost(): Missing");
    expect(dts).toContain("export declare function ghost(): number;");
    expect(dts).toContain("nudo:dropped-type-annotation ghost: Missing (return type)");
    expect(dts).not.toContain("nudo:return-annotation-mismatch ghost");
  });

  it("手写契约覆盖返回位 ⇒ 契约优先、无 mismatch 台账（对账只在声明 vs 观测之间做）", () => {
    const dts = moduleDts(
      `export function lied(): number { return "a"; }
lied();
`,
      (fn) => (fn.name === "lied" ? { params: [], return: str() } : undefined),
    );
    expect(dts).toContain("export declare function lied(): string;");
    expect(dts).not.toContain("export declare function lied(): number;");
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  });

  it("声明引用本声明的类型形参 ⇒ 发布声明、不做 Abs 对账", () => {
    const dts = moduleDts(
      `export function head<T>(xs: T[]): T { return xs[0]; }
head([1]);
`,
    );
    expect(dts).toContain("export declare function head<T>(xs: T[]): T;");
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  });

  it("`this` 返回注解照原文发布（链式 API 的子类型保真）", () => {
    const dts = moduleDts(
      `export class Fluent {
  n = 0;
  self(): this { return this; }
}
new Fluent().self();
`,
    );
    expect(dts).toContain("self(): this;");
    expect(dts).not.toContain("self(): Fluent;");
    expect(dts).not.toContain("return-annotation-mismatch");
  });
});

describe("一致性台账只对账基类型域", () => {
  it("声明域是基类型且与观测互不包含 ⇒ 台账照出、声明照发：基类型 vs 基类型", () => {
    const dts = moduleDts(
      `export function lied(): number { return "a"; }
lied();
`,
    );
    expect(dts).toContain("export declare function lied(): number;");
    expect(dts).not.toContain("export declare function lied(): string;");
    expect(dts).toContain("nudo:return-annotation-mismatch lied");
    expect(dts).toContain('declared "number", observed ""a""');
    expect(dts).toContain("published the declared type");
  });

  it("声明域是基类型且与观测互不包含 ⇒ 台账照出、声明照发：`Promise<基类型>` vs `Promise<基类型>`", () => {
    const dts = moduleDts(
      `export async function later(): Promise<number> { return "s"; }
later();
`,
    );
    expect(dts).toContain("later(): Promise<number>;");
    expect(dts).toContain("nudo:return-annotation-mismatch later");
    expect(dts).toContain('declared "Promise<number>", observed "Promise<"s">"');
  });

  it("声明域是基类型且与观测互不包含 ⇒ 台账照出、声明照发：基类型 vs 对象", () => {
    const dts = moduleDts(
      `export function boxed(): number { return { a: 1 }; }
boxed();
`,
    );
    expect(dts).toContain("export declare function boxed(): number;");
    expect(dts).toContain("nudo:return-annotation-mismatch boxed");
    expect(dts).toContain('declared "number", observed "{ a: 1 }"');
  });

  it("声明域落在结构档 ⇒ 不对账（类型文本 → Abs 在这一档有损，宁漏勿错）：内建 brand `Map` / `Set` / `Date` / `RegExp`；嵌在 promise / 字段 / 元组里的 brand；rest 形参函数类型；构造签名；`IterableIterator`；`object` / `{}`", () => {
    const dts = moduleDts(
      `export function counter(): Map<string, number> { return new Map([["k", 1]]); }
counter();
export function tags(): Set<number> { return new Set([1]); }
tags();
export function when(): Date { return new Date(0); }
when();
export function pattern(): RegExp { return /a/g; }
pattern();
export async function asyncMap(): Promise<Map<string, number>> { return new Map([["k", 1]]); }
asyncMap();
export function holder(): { c: Map<string, number> } { return { c: new Map() }; }
holder();
export function pair(): [Map<string, number>, number] { return [new Map(), 1]; }
pair();
export function restFn(): (...xs: number[]) => number { return (...xs) => xs.length; }
restFn();
export function ctor(): new (x: number) => { x: number } { return class { constructor(public x: number) {} }; }
ctor();
export function* iter(): IterableIterator<string> { yield "a"; }
iter().next();
export function asObject(): object { return [1]; }
asObject();
export function emptyT(): {} { return 1; }
emptyT();
`,
    );
    // 声明逐条照发
    expect(dts).toContain("export declare function counter(): Map<string, number>;");
    expect(dts).toContain("export declare function tags(): Set<number>;");
    expect(dts).toContain("export declare function when(): Date;");
    expect(dts).toContain("export declare function pattern(): RegExp;");
    expect(dts).toContain("asyncMap(): Promise<Map<string, number>>;");
    expect(dts).toContain("holder(): { c: Map<string, number> };");
    expect(dts).toContain("pair(): [Map<string, number>, number];");
    expect(dts).toContain("restFn(): (...xs: number[]) => number;");
    expect(dts).toContain("ctor(): new (x: number) => { x: number };");
    expect(dts).toContain("iter(): IterableIterator<string>;");
    expect(dts).toContain("export declare function asObject(): object;");
    expect(dts).toContain("export declare function emptyT(): {};");
    // 实现全部正确 ⇒ 零台账。不加可信域过滤时这些形态全被报成「声明与观测
    // 不一致」（90 个实现正确的夹具里 9 条对账误报，全部是这些形态），甚至出现
    // declared "Date", observed "Date"。
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
  });
});

describe("声明注解在其余发射分支同样优先", () => {
  it("`@nudo:skip` 关掉分析 ⇒ rest-args 声明面的返回位仍从注解签发", () => {
    const dts = moduleDts(
      `/**
 * @nudo:skip
 */
export function skipped(): Map<string, number> { throw new Error("unanalyzed"); }
`,
      undefined,
      true,
    );
    // BUG-079：无调用证据时形参退 rest-args；返回位此前退观测占位
    expect(dts).toContain(
      "export declare function skipped(...args: unknown[]): Map<string, number>;",
    );
    expect(dts).not.toMatch(/Map<unknown, unknown>/);
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  });

  it("HOF 分支的符号返回位让位声明", () => {
    const dts = moduleDts(
      `export function makeGreeter(greeting: string): (name: string) => string {
  return (name) => greeting + ", " + name;
}
makeGreeter("hi")("nudo");
`,
    );
    expect(dts).toContain(
      "export declare function makeGreeter(greeting: string): (name: string) => string;",
    );
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  });
});

describe("类成员的返回注解", () => {
  it("实例方法与独立函数同口径：声明发布、冲突台账落在方法声明之前；`async` / 生成器方法的声明保真", () => {
    const dts = moduleDts(
      `export class C {
  n = 0;
  bad(): number { return "a"; }
  async later(): Promise<number> { return 1; }
  *gen(): Generator<number> { yield "s"; }
  ok(): string { return "s"; }
}
const c = new C();
c.bad();
c.later();
c.gen().next();
c.ok();
`,
    );
    expect(dts).toContain("bad(): number;");
    expect(dts).toContain("nudo:return-annotation-mismatch C.bad");
    expect(dts).toContain("later(): Promise<number>;");
    expect(dts).toContain("gen(): Generator<number>;");
    expect(dts).toContain("nudo:return-annotation-mismatch C.gen");
    expect(dts).toContain('declared element "number", observed "string"');
    expect(dts).toContain("ok(): string;");
    // 台账在方法声明之前：读产物的人先看到「为什么这里与实现不符」
    const badAt = dts.indexOf("nudo:return-annotation-mismatch C.bad");
    expect(badAt).toBeGreaterThan(-1);
    expect(dts.indexOf("bad(): number;")).toBeGreaterThan(badAt);
    expect(dts).not.toContain("nudo:dropped-type-annotation");
  });

  it("方法注解不可解析 ⇒ dropped 台账 + 观测；契约返回位的方法不被声明改写", () => {
    const dts = moduleDts(
      `export class C {
  ghost(): Nope { return 1; }
  contracted(): number { return "a"; }
}
const c = new C();
c.ghost();
c.contracted();
`,
      (fn) => (fn.name === "C.contracted" ? { params: [], return: str() } : undefined),
    );
    expect(dts).not.toContain("ghost(): Nope");
    expect(dts).toContain("ghost(): number;");
    // dropped 台账由成员投影（改名后的 `memberFn`）落 ⇒ 用裸成员名，落在类体内
    expect(dts).toContain("nudo:dropped-type-annotation ghost: Nope (return type)");
    expect(dts).toContain("contracted(): string;");
    expect(dts).not.toContain("contracted(): number");
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
  });
});

describe("注解按原文立不住的另一种：裸泛型引用（TS2314）", () => {
  it("`class Box<T extends string>` 的裸引用 `(): Box`（TS2314）⇒ 不发布原文、回落观测；实参写全的声明照发", () => {
    const dts = moduleDts(
      `export class Box<T extends string> {
  v: T = "x" as T;
}
export function make(): Box {
  return new Box();
}
export function makeStr(): Box<string> {
  return new Box<string>("s");
}
makeStr();
`,
    );
    // 裸 `Box` 落进产物就是 TS2314 ⇒ 注解按原文不可发布。类型名本身可解析 ⇒ 不落台账
    expect(dts).toContain("make(): Box<string>;");
    expect(dts).not.toMatch(/make\(\): Box;/);
    expect(dts).toContain("makeStr(): Box<string>;");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
  });

  it("无约束的 `class Pair<A, B>`：裸引用（含嵌在 `Promise<…>` 里的）回落观测，`Pair<number, string>` 照发", () => {
    const dts = moduleDts(
      `export class Pair<A, B> {
  a: A = null as any;
  b: B = null as any;
  constructor(a: A, b: B) {
    this.a = a;
    this.b = b;
  }
}
export function makePair(): Pair { return new Pair(1, "a"); }
makePair();
export function deferred(): Promise<Pair> { return Promise.resolve(new Pair(1, "a")); }
deferred();
export function makeTyped(): Pair<number, string> { return new Pair(1, "a"); }
makeTyped();
`,
    );
    expect(dts).toContain("makePair(): Pair<unknown, unknown>;");
    expect(dts).toContain("deferred(): Promise<Pair<unknown, unknown>>;");
    expect(dts).toContain("makeTyped(): Pair<number, string>;");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
  });

  it("形参全带默认值（`class D<T = string>`）⇒ 裸名合法，照原文发布；字符串字面量类型 / `typeof Box` 里的同名不算裸引用", () => {
    const dts = moduleDts(
      `export class Box<T extends string> {
  v: T = "x" as T;
}
export class D<T = string> {
  v: T = "x" as T;
}
export function mk(): D { return new D(); }
mk();
export function tag(): "Box" { return "Box"; }
tag();
export function valueOnly(): typeof Box { return Box; }
valueOnly();
`,
    );
    expect(dts).toContain("export declare function mk(): D;");
    expect(dts).toContain('export declare function tag(): "Box";');
    expect(dts).toContain("export declare function valueOnly(): typeof Box;");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
  });

  it("接口 / 类型别名同理：有必填形参的裸引用（`interface G<T>` / `type A<U>`）回落观测，形参全带默认值的裸名照发", () => {
    const dts = moduleDts(
      `interface G<T> { v: T }
type A<U> = { v: U };
interface H<T = string> { v: T }
type P<T extends (x: number) => string> = { v: T };
interface NG { v: number }
export function makeG(): G { return { v: 1 }; }
makeG();
export function makeA(): A { return { v: 2 }; }
makeA();
export function makeH(): H { return { v: "s" }; }
makeH();
// 约束里的箭头（=>）不是默认值 ⇒ P 仍有必填形参
export function makeP(): P { return { v: (x) => String(x) }; }
makeP();
export function makeTyped(): G<number> { return { v: 3 }; }
makeTyped();
export function nonGeneric(): NG { return { v: 5 }; }
nonGeneric();
`,
    );
    expect(dts).toContain("export declare function makeG(): { v: number };");
    expect(dts).not.toContain("makeG(): G;");
    expect(dts).toContain("export declare function makeA(): { v: number };");
    expect(dts).toContain('export declare function makeP(): { v: (x: unknown) => unknown };');
    // 裸名合法（全部形参带默认值 / 非泛型）⇒ 照原文发布
    expect(dts).toContain("export declare function makeH(): H;");
    expect(dts).toContain("export declare function nonGeneric(): NG;");
    expect(dts).toContain("export declare function makeTyped(): G<number>;");
    expect(dts).not.toContain("nudo:dropped-type-annotation");
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
  });
});
