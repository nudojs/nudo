/**
 * transpile facet 单遍历（getFnFacets）语义钉死：
 * - this / 形参 this：嵌套真函数停止、箭头下降；
 * - arguments：体 + 形参默认值，箭头下降，嵌套函数/方法停止；
 * - effectFree：赋值/调用/标签模板/delete/非声明 for-in/of 脏；白名单 new 不脏；
 * - closed：自由标识符脏，形参/声明/catch 绑定与全局白名单封闭；
 * - memo：同一函数节点返回同一 facets 对象（wrapper 共享一次遍历）。
 *
 * 这些 facet 直接进 $fnVal opts（this/arguments/effectFree/closed），边界一旦
 * 漂移会改变发射产物——用本文件把每条边界独立钉住。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import type { FunctionDeclaration } from "@babel/types";
import {
  getFnFacets,
  fnBodyHasThis,
  fnBodyHasOwnArguments,
  fnBodyIsEffectFree,
  fnBodyIsClosed,
} from "../exec/transpile/helpers.ts";
import { fnParamsHaveThis } from "../exec/transpile/expr/function.ts";

function decl(src: string): FunctionDeclaration {
  const ast = parse(src, { sourceType: "script" });
  const stmt = ast.program.body[0]!;
  if (stmt.type !== "FunctionDeclaration") throw new Error(`fixture 不是函数声明：${stmt.type}`);
  return stmt;
}

describe("getFnFacets: this / 形参 this 边界", () => {
  it("函数体直接引用 this → hasThis", () => {
    const f = getFnFacets(decl("function f(){ return this.x; }"));
    expect(f.hasThis).toBe(true);
    expect(f.hasParamsThis).toBe(false);
    // closed 面把 this 视为不可封闭
    expect(f.closed).toBe(false);
  });

  it("函数体内的箭头词法继承 this → hasThis", () => {
    expect(getFnFacets(decl("function f(){ return () => this.x; }")).hasThis).toBe(true);
  });

  it("嵌套真函数有自己的 this 边界 → 不下降", () => {
    expect(getFnFacets(decl("function f(){ return function(){ return this.x; }; }")).hasThis).toBe(false);
  });

  it("既有边界保持：对象方法不阻断 this 下降（历史口径，不得漂移）", () => {
    expect(getFnFacets(decl("function f(){ return { m(){ return this.x; } }; }")).hasThis).toBe(true);
  });

  it("形参默认值里的 this → hasParamsThis（不是 hasThis）", () => {
    const f = getFnFacets(decl("function f(a = this.x){}"));
    expect(f.hasThis).toBe(false);
    expect(f.hasParamsThis).toBe(true);
  });

  it("形参默认值里的箭头 this 词法继承 → hasParamsThis", () => {
    expect(getFnFacets(decl("function f(a = (() => this.x)()){}")).hasParamsThis).toBe(true);
  });

  it("形参默认值里的嵌套函数 → 边界停止", () => {
    expect(getFnFacets(decl("function f(a = function(){ return this.x; }){}")).hasParamsThis).toBe(false);
  });

  it("fnParamsHaveThis wrapper 与 hasParamsThis 同源", () => {
    const withThis = decl("function f(a = this.x){}");
    const nested = decl("function f(a = function(){ return this.x; }){}");
    expect(fnParamsHaveThis(withThis.params)).toBe(true);
    expect(fnParamsHaveThis(nested.params)).toBe(false);
    expect(fnParamsHaveThis([])).toBe(false);
    expect(fnParamsHaveThis(undefined)).toBe(false);
  });
});

describe("getFnFacets: arguments 边界", () => {
  it("体直接引用 arguments → hasOwnArguments", () => {
    expect(getFnFacets(decl("function f(){ return arguments.length; }")).hasOwnArguments).toBe(true);
  });

  it("嵌套箭头词法继承 arguments → 下降", () => {
    expect(getFnFacets(decl("function f(){ return () => arguments.length; }")).hasOwnArguments).toBe(true);
  });

  it("嵌套真函数有自己的 arguments 绑定 → 停止", () => {
    expect(getFnFacets(decl("function f(){ return function(){ return arguments.length; }; }")).hasOwnArguments).toBe(false);
  });

  it("嵌套对象方法/类方法有自己的 arguments 绑定 → 停止", () => {
    expect(getFnFacets(decl("function f(){ return { m(){ return arguments[0]; } }; }")).hasOwnArguments).toBe(false);
    expect(getFnFacets(decl("function f(){ return class { m(){ return arguments[0]; } }; }")).hasOwnArguments).toBe(false);
  });

  it("形参默认值一并扫描", () => {
    expect(getFnFacets(decl("function f(a = arguments.length){}")).hasOwnArguments).toBe(true);
  });
});

describe("getFnFacets: effectFree 脏标记", () => {
  it("纯算术 → effectFree", () => {
    expect(getFnFacets(decl("function f(){ return 1 + 2; }")).effectFree).toBe(true);
  });

  it("调用 / 赋值 / 自增 / 标签模板 / delete → 脏", () => {
    expect(getFnFacets(decl("function f(){ return g(); }")).effectFree).toBe(false);
    expect(getFnFacets(decl("function f(){ let x = 1; x = 2; return x; }")).effectFree).toBe(false);
    expect(getFnFacets(decl("function f(){ let x = 1; x++; return x; }")).effectFree).toBe(false);
    expect(getFnFacets(decl("function f(){ return tag`x`; }")).effectFree).toBe(false);
    expect(getFnFacets(decl("function f(){ let o = {}; delete o.x; }")).effectFree).toBe(false);
  });

  it("白名单 ctor 的 new 不脏；用户类 / Promise 脏", () => {
    expect(getFnFacets(decl('function f(){ return new Error("x"); }')).effectFree).toBe(true);
    expect(getFnFacets(decl("function f(){ return new Foo(); }")).effectFree).toBe(false);
    expect(getFnFacets(decl("function f(){ return new Promise(() => {}); }")).effectFree).toBe(false);
  });

  it("白名单 new 的实参仍扫描（含调用 → 脏）", () => {
    expect(getFnFacets(decl("function f(){ return new Error(g()); }")).effectFree).toBe(false);
  });

  it("for-of/in：声明左部不脏，赋值目标左部脏", () => {
    expect(getFnFacets(decl("function f(){ for (const y of []) {} }")).effectFree).toBe(true);
    expect(getFnFacets(decl("function f(){ let x; for (x of []) {} }")).effectFree).toBe(false);
    expect(getFnFacets(decl("function f(){ for (var k in {}) {} }")).effectFree).toBe(true);
    expect(getFnFacets(decl("function f(){ let x; for (x in {}) {} }")).effectFree).toBe(false);
  });

  it("嵌套函数体不执行 → 不因内部调用变脏", () => {
    expect(getFnFacets(decl("function f(){ return function(){ g(); }; }")).effectFree).toBe(true);
    expect(getFnFacets(decl("function f(){ return () => g(); }")).effectFree).toBe(true);
  });

  it("形参默认值里的调用 → 脏", () => {
    expect(getFnFacets(decl("function f(a = g()){}")).effectFree).toBe(false);
  });
});

describe("getFnFacets: closed 绑定/引用面", () => {
  it("自由标识符 → 不封闭；参数/局部声明/catch 形参 → 封闭", () => {
    expect(getFnFacets(decl("function f(){ return x; }")).closed).toBe(false);
    expect(getFnFacets(decl("function f(a){ return a; }")).closed).toBe(true);
    expect(getFnFacets(decl("function f(){ const x = 1; return x; }")).closed).toBe(true);
    expect(getFnFacets(decl("function f(){ try {} catch (e) { return e; } }")).closed).toBe(true);
  });

  it("CLOSED_GLOBAL_NAMES 白名单（含 SAFE_CTOR_NAMES）→ 封闭", () => {
    expect(getFnFacets(decl("function f(){ return undefined + NaN + Infinity; }")).closed).toBe(true);
    expect(getFnFacets(decl("function f(){ return Math.max(1, 2); }")).closed).toBe(true);
    expect(getFnFacets(decl("function f(){ return JSON.stringify(1); }")).closed).toBe(true);
    expect(getFnFacets(decl("function f(){ return Promise.resolve(1); }")).closed).toBe(true);
    expect(getFnFacets(decl('function f(){ return new Error("x"); }')).closed).toBe(true);
  });

  it("this / arguments / new.target 不可封闭", () => {
    expect(getFnFacets(decl("function f(){ return this; }")).closed).toBe(false);
    expect(getFnFacets(decl("function f(){ return arguments[0]; }")).closed).toBe(false);
    expect(getFnFacets(decl("function f(){ return new.target; }")).closed).toBe(false);
  });

  it("非计算成员属性名不是引用；计算键是引用", () => {
    expect(getFnFacets(decl("function f(){ const o = {}; return o.x; }")).closed).toBe(true);
    expect(getFnFacets(decl("function f(){ const o = {}; return o[k]; }")).closed).toBe(false);
  });

  it("对象字面量：非计算键不是引用，shorthand value 是引用", () => {
    expect(getFnFacets(decl("function f(){ return { x: 1 }; }")).closed).toBe(true);
    expect(getFnFacets(decl("function f(){ return { [k]: 1 }; }")).closed).toBe(false);
    // shorthand `{ x }` 的 value 是引用 x
    expect(getFnFacets(decl("function f(){ return { x }; }")).closed).toBe(false);
    expect(getFnFacets(decl("function f(){ const x = 1; return { x }; }")).closed).toBe(true);
  });

  it("形参解构：计算键是引用面，默认值同属函数作用域", () => {
    expect(getFnFacets(decl("function f({ a: v }){ return v; }")).closed).toBe(true);
    expect(getFnFacets(decl("function f({ [k]: v }){ return v; }")).closed).toBe(false);
    expect(getFnFacets(decl("function f(a = b, b = 1){}")).closed).toBe(false);
  });

  it("嵌套箭头/函数体不下降（执行必有 Call，effectFree 已拦截）", () => {
    expect(getFnFacets(decl("function f(){ return () => x; }")).closed).toBe(true);
    expect(getFnFacets(decl("function f(){ return function(){ return x; }; }")).closed).toBe(true);
  });
});

describe("getFnFacets: 无体函数与 memo", () => {
  it("无 body：effectFree/closed 保守 false；形参 this 仍扫描", () => {
    const f = getFnFacets({
      params: decl("function f(a = this.x){}").params,
    });
    expect(f.hasThis).toBe(false);
    expect(f.hasParamsThis).toBe(true);
    expect(f.effectFree).toBe(false);
    expect(f.closed).toBe(false);
  });

  it("同一函数节点返回同一 facets 对象；各 wrapper 共享同一结果", () => {
    const fn = decl("function f(a){ return a + 1; }");
    const first = getFnFacets(fn);
    expect(getFnFacets(fn)).toBe(first);
    expect(fnBodyHasThis(fn)).toBe(first.hasThis);
    expect(fnBodyHasOwnArguments(fn)).toBe(first.hasOwnArguments);
    expect(fnBodyIsEffectFree(fn)).toBe(first.effectFree);
    expect(fnBodyIsClosed(fn)).toBe(first.closed);
    // 同源不同节点 → 不同 cache 条目
    const other = decl("function f(a){ return a + 1; }");
    expect(getFnFacets(other)).not.toBe(first);
    expect(getFnFacets(other)).toEqual(first);
  });
});
