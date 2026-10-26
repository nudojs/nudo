/**
 * `collectFreeAssignedNames` 的**作用域准确性**回归（fork / switch pack 的
 * 绑定集判定）。
 *
 * 两处缺陷（同一函数，分别属于「遮蔽不足」与「遮蔽过度」）：
 *
 * - **Leak 1（遮蔽不足 ⇒ 假 ReferenceError / 假 never）**：walk 进入嵌套
 *   函数时只 pushShadow「函数名 + 形参」，**没有**把函数体提升出来的**函数级**
 *   绑定（`var` 声明 + 本层函数声明）算进去 ⇒ 体内 `var a = 1; a = 2` 的写被
 *   记成**外层**自由写 ⇒ 发射 `$copy(a)` 而外层根本没有 `a` ⇒ 运行时
 *   ReferenceError ⇒ 引擎折 `never #exact` + `throws ReferenceError #exact`
 *   （原生 `1`、不抛）。if-fork 与 switch pack 共用同一 helper，两条路径同病。
 *
 * - **Leak 2（遮蔽过度 ⇒ 臂不再隔离）**：批内遮蔽名用 `collectLexicalDeclNames`
 *   递归收集后做成**扁平并集**，嵌套块里的 `let a` 因此也遮蔽了**兄弟语句**
 *   里对外层 `a` 的合法写 ⇒ `recvSet` 为空 ⇒ 外层 `a` 没有 switch 级快照 /
 *   join。修法：按**语句表本层**判遮蔽（嵌套块由 walk 自己的 BlockStatement
 *   分支负责）。
 *
 * 断言两层证据：① helper 的返回集；② 发射文本（快照行存在与否）+ 引擎值。
 */
import { describe, it, expect } from "vitest";
import { transpileSource } from "../transpile.ts";
import { collectFreeAssignedNames } from "../transpile/helpers.ts";
import { parseSource } from "../../parse-source.ts";
import { callLit } from "../../__tests__/eval-helpers.ts";
import { litValue } from "../../abs.ts";

/** 转译源并取发射文本。 */
function emit(src: string): string {
  return transpileSource(src, { source: src });
}

/** `f` 函数体语句表（源里第一条声明，容忍 `export` 包装）。 */
function fnBody(src: string): any[] {
  const decl = parseSource(src).program.body[0] as any;
  return ((decl.declaration ?? decl).body as { body: any[] }).body;
}

/** 函数体里第一条指定类型的语句（按类型定位，不依赖下标）。 */
function stmtOfType(src: string, type: string): any {
  const hit = fnBody(src).find((s) => s.type === type);
  if (!hit) throw new Error(`no ${type} statement in function body`);
  return hit;
}

/** 函数体里 switch 语句的第一个臂的语句表。 */
function firstArm(src: string): any[] {
  return stmtOfType(src, "SwitchStatement").cases[0].consequent as any[];
}

/** 该名字是否有 fork / switch 快照行（⇒ 进了绑定集）。 */
function hasSnapshot(code: string, name: string): boolean {
  return (
    new RegExp(`__sw\\d+(?:set)?_${name}\\b`).test(code) ||
    new RegExp(`__fk\\d+_${name}\\b`).test(code) ||
    new RegExp(`\\$copy\\(\\s*${name}\\s*,`).test(code)
  );
}

/** 引擎求值（`f(arg)`）→ { 值, throws kind }。 */
function engine(src: string, arg: unknown): { value: unknown; throws: string | undefined } {
  const r = callLit(src, "f", arg);
  const v = litValue(r.result);
  return {
    value: v.ok ? v.value : `<${r.result.shape.k}>`,
    throws: r.throws ? (r.throws.shape as { name?: string }).name : undefined,
  };
}

describe("Leak 1：嵌套函数体的提升绑定写不得算外层自由写", () => {
  it("if 臂：`function g(){ var a = 1; a = 2 }` ⇒ 集合不含 a，结果 1 且不抛", () => {
    const src = `export function f(p) {
  if (p) { function g() { var a = 1; a = 2; } g(); }
  return 1;
}`;
    expect(collectFreeAssignedNames(stmtOfType(src, "IfStatement"))).toEqual([]);
    expect(hasSnapshot(emit(src), "a")).toBe(false);
    // 修复前：ReferenceError ⇒ never #exact + throws
    expect(engine(src, 1)).toEqual({ value: 1, throws: undefined });
    expect(engine(src, 0)).toEqual({ value: 1, throws: undefined });
  });

  it("switch 臂：同形 ⇒ 集合不含 a，无 switch 快照行，结果 1 且不抛", () => {
    const src = `export function f(p) {
  switch (p) { case 1: function g() { var a = 1; a = 2; } g(); break; }
  return 1;
}`;
    expect(collectFreeAssignedNames(...firstArm(src))).toEqual([]);
    expect(hasSnapshot(emit(src), "a")).toBe(false);
    expect(engine(src, 1)).toEqual({ value: 1, throws: undefined });
  });

  it("嵌套函数体的本层函数声明（提升绑定）写 ⇒ 集合不含该名", () => {
    const src = `export function f(p) {
  if (p) { function g() { h = 1; function h() {} } g(); }
  return 1;
}`;
    expect(collectFreeAssignedNames(stmtOfType(src, "IfStatement"))).toEqual([]);
    expect(engine(src, 1)).toEqual({ value: 1, throws: undefined });
  });

  it("护栏：**臂级** var（外层函数的绑定）仍必须进集合", () => {
    // var 是函数作用域：臂内 `var a = …` 写的是**外层**函数的 a ⇒ 需要
    // fork 协议（快照/join）。L1 的修法不得把它一起吞掉。
    const src = `export function f(p) {
  if (p) { var a = 1; a = 2; }
  return 1;
}`;
    expect(collectFreeAssignedNames(stmtOfType(src, "IfStatement"))).toEqual(["a"]);
    expect(hasSnapshot(emit(src), "a")).toBe(true);
  });
});

describe("Leak 2：遮蔽必须按作用域，而不是整批扁平并集", () => {
  it("嵌套块 let 与**兄弟**外层写共存 ⇒ 外层写仍收集（并有 switch 快照）", () => {
    const src = `export function f(p) {
  const a = { v: 1 };
  const b = a;
  switch (p) { case 1: { let a = { v: 99 }; } a.v = 7; break; }
  return b.v;
}`;
    // 修复前：扁平并集把块内 `let a` 外泄 ⇒ 集合为空（臂不隔离）
    expect(collectFreeAssignedNames(...firstArm(src))).toEqual(["a"]);
    expect(hasSnapshot(emit(src), "a")).toBe(true);
    // 值与原生一致（写的是外层 a ⇒ b.v = 7）
    expect(engine(src, 1).value).toBe(7);
  });

  it("两层嵌套块同形（块套块）⇒ 外层写仍收集", () => {
    const src = `export function f(p) {
  const a = { v: 1 };
  const b = a;
  if (p) { { let a = { v: 99 }; a.v = 1; } a.v = 7; }
  return b.v;
}`;
    expect(collectFreeAssignedNames(stmtOfType(src, "IfStatement"))).toEqual(["a"]);
    expect(engine(src, 1).value).toBe(7);
  });

  it("护栏：写点就在**声明它的块内** ⇒ 仍不收集（同块 let + mutator）", () => {
    const src = `export function f(p) {
  if (p) { let shares = []; shares.push(1); }
  return 1;
}`;
    expect(collectFreeAssignedNames(stmtOfType(src, "IfStatement"))).toEqual([]);
  });

  it("护栏：同一语句表的**兄弟** let 仍遮蔽后续写（const/TDZ 保护）", () => {
    const src = `export function f(p) {
  switch (p) { case 1: let a = 1; a = 2; break; }
  return 1;
}`;
    expect(collectFreeAssignedNames(...firstArm(src))).toEqual([]);
  });

  it("护栏：嵌套块内的局部写仍不收集（写点在块内）", () => {
    const src = `export function f(p) {
  if (p) { { let a = { v: 99 }; a.v = 3; } }
  return 1;
}`;
    expect(collectFreeAssignedNames(stmtOfType(src, "IfStatement"))).toEqual([]);
  });
});
