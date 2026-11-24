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
  path = "/test/declared-return.ts",
): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions
    .filter((fn) => fn.cases.length > 0)
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
    // 这些形状的声明域都覆盖观测域 ⇒ 一条台账都不该有
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

  it("声明与观测互不包含 ⇒ 发布声明 + mismatch 台账（实现是事实，声明是断言）", () => {
    const dts = moduleDts(
      `export function lied(): number { return "a"; }
lied();
`,
    );
    expect(dts).toContain("export declare function lied(): number;");
    expect(dts).not.toContain("export declare function lied(): string;");
    expect(dts).toContain("nudo:return-annotation-mismatch lied");
    expect(dts).toContain('declared "number", observed "string"');
    expect(dts).toContain("published the declared type");
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

describe("声明注解在其余发射分支同样优先", () => {
  it("`@nudo:skip` 关掉分析 ⇒ 仍从注解签发；HOF 分支的符号返回位让位声明", () => {
    const dts = moduleDts(
      `/**
 * @nudo:skip
 */
export function skipped(): Map<string, number> { throw new Error("unanalyzed"); }
export function makeGreeter(greeting: string): (name: string) => string {
  return (name) => greeting + ", " + name;
}
makeGreeter("hi")("nudo");
`,
    );
    // BUG-079：无调用证据时形参退 rest-args；返回位此前退 `Map<unknown, unknown>` 之类的观测占位
    expect(dts).toContain("): Map<string, number>;");
    expect(dts).not.toMatch(/Map<unknown, unknown>/);
    expect(dts).toContain("): (name: string) => string;");
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
    expect(dts).toContain("nudo:dropped-type-annotation C.ghost: Nope (return type)");
    expect(dts).toContain("contracted(): string;");
    expect(dts).not.toContain("contracted(): number");
    expect(dts).not.toContain("nudo:return-annotation-mismatch");
  });
});
