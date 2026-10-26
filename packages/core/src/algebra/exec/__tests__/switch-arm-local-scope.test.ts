/**
 * switch 级 pack/join 绑定集**不得收录臂内局部绑定**（Gap B 不变量）。
 *
 * 背景：`emitSwitchStatement`（stmt/statement.ts）在**外层作用域**发射
 * switch 的 pack/join 协议——每个名字一行 `let __sw0_<name> = $copy(…)`、
 * 每个臂入口一行 `<name> = $copy(__sw0_<name>, …)`、臂结束写回臂槽、switch
 * 结束后 `join` 回绑。若集合里出现的是「臂内声明的同名绑定」（与外层同名
 * 但**不同绑定**），这套协议就会 $copy 并重绑**外层**绑定 ⇒ 外层别名身份
 * 断开 ⇒ 自信错值（`const a = {}; const b = a; switch (p) { case 1: { let a = … } }`
 * 之后写 `a` 不再经 `b` 可见）。
 *
 * 当前实现口径（本文件钉住）：集合按**逐臂**调用
 * `collectForkBindingNames(...arm.stmts)` 再并集；每臂自己的 batch 里
 * `collectFreeAssignedNames` 用 `collectListStatementDeclNames` 建
 * `batchDecl`（**只收本语句表层**的 let/const/class/function）并在 walk 里
 * `pushShadow`。实测覆盖（→ 剔除，不进集合）：
 * - 直接位于 case 子句的 `let` / `const` / `function` / `class`（带不带
 *   花括号都一样）；
 * - 嵌套块（任意深度）内的 `let` / `const` / `function` / `class`
 *   （walk 的 `BlockStatement` 分支按块作用域 pushShadow）；
 * - `for` / `for-of` / `for-in` 头部的 `let` / `const` 绑定；
 * - `catch` 形参（含解构形态）、嵌套函数形参、嵌套函数体内 `let` / `const`
 *   与**提升的 `var` / 函数声明**（walk 的 `CatchClause` /
 *   `FUNCTION_SCOPE_TYPES` / `BlockStatement` 遮蔽）。
 *
 * 不剔除（语义正确，不是缺陷）：`var`——它是**函数**作用域绑定，不是臂
 * 作用域绑定；与外层同一函数作用域的 `var` 同名时本就是同一绑定
 * （`case 1: var a = …` 确实写外层 `a`，必须留在协议里）。
 *
 * 相邻不变量（**不在本文件钉住**，由 `free-assigned-scope.test.ts` 负责）：
 * 嵌套函数体内提升的 `var` / 函数声明名必须遮蔽该函数体内的写（否则会
 * 对外层并不存在的名字发射 `$copy(<name>)` ⇒ 假 ReferenceError）；同时
 * 嵌套块里的 `let` 只遮蔽**该块**，不得把同一语句表内块外的合法外层写
 * 一并滤掉（`batchDecl` 按语句表层收集，不做递归并集）。
 *
 * 断言两条独立证据：
 * 1. 发射文本里**没有**该名字的 switch 槽位/快照行（`__sw\d+_a` /
 *    `$copy(a,`）——集合里没有 ⇒ 快照行不会发射；
 * 2. 引擎值与原生一致（原生锚定 5）。
 * 负控制：臂**真的**写外层 `a` 时快照行必须存在（防止未来把过滤做过头，
 * 把真正需要 fork 协议的写一起丢掉）。
 */
import { describe, it, expect } from "vitest";
import { transpileSource } from "../transpile.ts";
import { callLit } from "../../__tests__/eval-helpers.ts";
import { litValue } from "../../abs.ts";

/** 转译源并取发射文本。 */
function emit(src: string): string {
  return transpileSource(src, { source: src });
}

/** 引擎求值（`f(arg)` 的字面量值；非字面量即红）。 */
function engine(src: string, arg: unknown): unknown {
  const r = callLit(src, "f", arg);
  const v = litValue(r.result);
  if (!v.ok) throw new Error(`expect literal result, got non-literal (conf=${r.result.conf})`);
  return v.value;
}

/** 原生 oracle（去 `export` 后以 CommonJS 方式调用同一函数）。 */
function native(src: string, arg: unknown): unknown {
  const fn = new Function(`${src.replace(/^export /gm, "")}\nreturn f;`)();
  return fn(arg);
}

/** 该名字是否进了 switch 级集合（快照/槽位行 ⇒ 进了）。 */
function inSwitchSet(code: string, name: string): boolean {
  return new RegExp(`__sw\\d+(?:set)?_${name}\\b`).test(code) ||
    new RegExp(`\\$copy\\(\\s*${name}\\s*,`).test(code);
}

/**
 * 臂形状表：每条都是「外层 `const a` 有别名 `b` + 臂内声明同名局部 `a`
 * 并只写该局部」。原生结果恒为 5（switch 后 `a.v = 5` 写外层 `a`，
 * `b` 与 `a` 同对象 ⇒ `b.v === 5`）。
 */
const ARM_LOCAL_SHAPES: Array<{ name: string; arm: string }> = [
  { name: "直接 let", arm: `case 1: let a = { v: 99 }; a.v = 3; break;` },
  { name: "直接 const", arm: `case 1: const a = { v: 99 }; a.v = 3; break;` },
  { name: "直接 function 声明", arm: `case 1: function a() {} a.v = 3; break;` },
  { name: "直接 class 声明", arm: `case 1: class a {} a.v = 3; break;` },
  { name: "嵌套块 let", arm: `case 1: { let a = { v: 99 }; a.v = 3; } break;` },
  { name: "两层嵌套块 let", arm: `case 1: { { let a = { v: 99 }; a.v = 3; } } break;` },
  { name: "for-of 头 const", arm: `case 1: for (const a of [{ v: 9 }]) { a.v = 3; } break;` },
  { name: "for-of 头 let", arm: `case 1: for (let a of [{ v: 9 }]) { a.v = 3; } break;` },
  { name: "for 头 let", arm: `case 1: for (let a = 0; a < 1; a++) { a; } break;` },
  { name: "catch 形参", arm: `case 1: try { throw 1; } catch (a) { a = 3; } break;` },
  { name: "catch 解构形参", arm: `case 1: try { throw { a: 1 }; } catch ({ a }) { a = 3; } break;` },
  { name: "箭头函数形参", arm: `case 1: { const g = (a) => { a = 3; }; g(1); } break;` },
  { name: "嵌套函数形参", arm: `case 1: { function g(a) { a = 3; } g(1); } break;` },
  { name: "解构 const", arm: `case 1: { const { a } = { a: { v: 99 } }; a.v = 3; } break;` },
  { name: "嵌套函数体内 let", arm: `case 1: { function g() { let a = { v: 99 }; a.v = 3; } g(); } break;` },
];

/** Gap B 原文程序（有花括号 / 无花括号两种 case 形态，原生恒为 5）。 */
const GAP_B_PROGRAMS: Array<{ name: string; src: string }> = [
  {
    name: "Gap B（case 块内 let）",
    src: `export function f(p) {
  const a = { v: 1 };
  const b = a;
  switch (p) {
    case 1: { let a = { v: 99 }; a.v = 3; break; }
  }
  a.v = 5;
  return b.v;
}`,
  },
  {
    name: "Gap B（case 直挂 let，无花括号）",
    src: `export function f(p) {
  const a = { v: 1 };
  const b = a;
  switch (p) {
    case 1: let a = { v: 99 }; a.v = 3; break;
  }
  a.v = 5;
  return b.v;
}`,
  },
];

describe("switch 级 pack/join 集：臂内局部绑定不得进入", () => {
  for (const { name, arm } of ARM_LOCAL_SHAPES) {
    it(`${name}：臂内局部 a 不进集合，且与原生一致（5）`, () => {
      const src = `export function f(p) {
  const a = { v: 1 };
  const b = a;
  switch (p) {
    ${arm}
  }
  a.v = 5;
  return b.v;
}`;
      // 前提守卫：该形状确实只写臂内局部 ⇒ 原生仍是 5。
      expect(native(src, 1)).toBe(5);
      expect(engine(src, 1)).toBe(5);
      // 不变量：外层 a 不在 switch 级集合里（没有快照/槽位行）。
      expect(inSwitchSet(emit(src), "a")).toBe(false);
    });
  }

  for (const { name, src } of GAP_B_PROGRAMS) {
    it(`${name}：原生 5 = 引擎 5，且无 a 的快照行`, () => {
      expect(native(src, 1)).toBe(5);
      expect(engine(src, 1)).toBe(5);
      expect(inSwitchSet(emit(src), "a")).toBe(false);
    });
  }
});

describe("负控制：真的写外层绑定时协议必须保留（过滤不得做过头）", () => {
  it("臂内直接写外层 a ⇒ 有 a 的快照行，且别名身份保持（5）", () => {
    const src = `export function f(p) {
  const a = { v: 1 };
  const b = a;
  switch (p) {
    case 1: a.v = 3; break;
  }
  a.v = 5;
  return b.v;
}`;
    expect(native(src, 1)).toBe(5);
    expect(engine(src, 1)).toBe(5);
    expect(inSwitchSet(emit(src), "a")).toBe(true);
  });

  it("臂内「另一个局部 + 外层 a 写」⇒ a 仍进集合（5）", () => {
    const src = `export function f(p) {
  const a = { v: 1 };
  const b = a;
  switch (p) {
    case 1: { let z = { v: 9 }; z.v = 3; } a.v = 4; break;
  }
  a.v = 5;
  return b.v;
}`;
    expect(native(src, 1)).toBe(5);
    expect(engine(src, 1)).toBe(5);
    expect(inSwitchSet(emit(src), "a")).toBe(true);
    // 臂内局部 z 不能进集合（$copy(z) 会因臂外无 z 而 ReferenceError）。
    expect(inSwitchSet(emit(src), "z")).toBe(false);
  });

  it("两个臂：臂 1 局部 a、臂 2 写外层 a ⇒ a 进集合（外层写需 fork 协议，5）", () => {
    const src = `export function f(p) {
  const a = { v: 1 };
  const b = a;
  switch (p) {
    case 1: { let a = { v: 99 }; a.v = 3; break; }
    case 2: a.v = 7; break;
  }
  a.v = 5;
  return b.v;
}`;
    expect(native(src, 1)).toBe(5);
    expect(native(src, 2)).toBe(5);
    expect(engine(src, 1)).toBe(5);
    expect(engine(src, 2)).toBe(5);
    expect(inSwitchSet(emit(src), "a")).toBe(true);
  });
});
