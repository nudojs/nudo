/**
 * 族 59 · core 类与转译面（W9）——四条精度债的钉。
 *
 * 覆盖：
 * 1. **Bug 205**（台账族 43 遗留 5）：`const F = function(){}; F.prototype = {}`
 *    ——转译侧此前走**根绑定重绑**（引擎未建模 const 不可重绑）⇒ 写污染了根
 *    绑定。原生：**不报错**（成员写是对函数对象的 [[Set]]，不动绑定），
 *    `F.prototype` 被替换 ⇒ 引擎不得重绑 const 根。
 * 2. **族 45 遗留 3**：`exec/body-fn.ts` 的 body 编译路径**不传 source** ⇒
 *    转译侧内部临时名的避让集恒空 ⇒ 用户标识符与引擎临时名相撞 ⇒ 产物非法
 *    JS（重复词法声明）⇒ 整模块 fail-closed。
 * 3. **Bug 194 遗留**：`super.m()` 在父类方法被 `delete` 后折 unknown——原生
 *    `super.m is not a function` ⇒ **TypeError**（可被用户 try/catch 吸收）。
 * 4. **Bug 194 / 208**（含内建父的类链）：`class MyMap extends Map {}` 的实例
 *    读不回内建父的条目面（`.get` / `.size` / `.has` 折 unknown = 假阴性）。
 *
 * 追加（主 agent 交办 · 族 57 第 8 条 · 归属 W9）：复合赋值到「根不可重绑」
 * 成员（`mk().x += 2`）此前**丢 compoundFn** ⇒ 只发右值（折 2，原生 3）。
 * 
 * 期望值均以 **node v26.10.0 原生实测**为锚（对拍见每组注释）。
 * 负控：非相关路径**逐字不变**（转译产物 / 求值结果）。
 */
import { describe, it, expect } from "vitest";
import { call, val, throwsError, isNever, tupleEls } from "./eval-helpers.ts";
import { $call } from "../exec/call.ts";
import { absFunction } from "../abs-fn.ts";
import { numLit, litValue } from "../abs.ts";
import { parseSource } from "../parse-source.ts";
import { transpileSource } from "../exec/transpile.ts";
import { bodyIdentNames } from "../exec/body-fn.ts";

/** 把 `function f(x) { … }` 的函数体编译成引擎 fn（body-fn 路径） */
function bodyFn(body: string, params: string[] = ["x"]): ReturnType<typeof absFunction> {
  const file = parseSource(`function f(${params.join(", ")}) { ${body} }`);
  const decl = (
    file.program.body as Array<{ type: string; body: never }>
  ).find((s) => s.type === "FunctionDeclaration") as { body: never };
  return absFunction(params, { body: decl.body });
}

describe("族 59 · 第 1 条 · const 绑定的函数上的成员写（Bug 205 / 族 43 遗留 5）", () => {
  it("原生不报错：新 prototype 读得出（node v26.10.0：typeof F.prototype.x === 'number'）", () => {
    const src = `export function f() {
      const F = function(){};
      F.prototype = { x: 1 };
      return typeof F.prototype.x;
    }`;
    const rec = call(src);
    expect(val(src)).toEqual({ ok: true, value: "number" });
    // throws 面 = never（无抛）——原生不报错
    expect(isNever(rec.throws)).toBe(true);
  });

  it("转译侧不得重绑 const 根（原生：成员写不动绑定）", () => {
    const src = `const F = function(){}; F.prototype = { x: 1 };`;
    const out = transpileSource(src, { source: src });
    // 写照旧发出（$set 落 fn Abs 的槽面——就地写）
    expect(out).toContain('$set(__nudoMpRoot, "prototype", __nudoMpVal)');
    // 但**不得**重绑根绑定
    expect(out).not.toContain("F = $set(");
  });

  it("负控：let 绑定维持既有根重绑通道（逐字不变）", () => {
    const src = `let F = function(){}; F.prototype = { x: 1 };`;
    const out = transpileSource(src, { source: src });
    expect(out).toContain('F = $set(__nudoMpRoot, "prototype", __nudoMpVal)');
  });

  it("负控：非函数表达式的 const 绑定维持既有根重绑通道（收窄口径）", () => {
    const src = `const o = {}; o.x = 1;`;
    const out = transpileSource(src, { source: src });
    expect(out).toContain('o = $set(__nudoMpRoot, "x", __nudoMpVal)');
  });

  it("负控：函数声明（宿主函数）维持既有根重绑通道", () => {
    const src = `function F(){} F.prototype = { x: 1 };`;
    const out = transpileSource(src, { source: src });
    expect(out).toContain('F = $set(__nudoMpRoot, "prototype", __nudoMpVal)');
  });
});

describe("族 59 · 第 2 条 · body-fn 无 source 路径的临时名避让（族 45 遗留 3）", () => {
  it("用户标识符撞引擎临时名：求值不得 fail-closed（node：12）", () => {
    // `__nudoTm_0` 是引擎的 try 临时名——用户同名 ⇒ 此前产物重复词法声明
    // （SyntaxError）⇒ body 编译失败 ⇒ 回落 unknown / 抛错。
    const fn = bodyFn(
      `const __nudoTm_0 = 7; try { return __nudoTm_0 + x; } catch (e) { return 0; }`,
    );
    const r = $call(fn, [numLit(5)]);
    expect(litValue(r)).toEqual({ ok: true, value: 12 });
  });

  it("catch 临时名撞名同样不丢（node：12）", () => {
    const fn = bodyFn(
      `const __nudoE_0 = 7; try { throw new Error("x"); } catch (e) { return __nudoE_0 + x; }`,
    );
    const r = $call(fn, [numLit(5)]);
    expect(litValue(r)).toEqual({ ok: true, value: 12 });
  });

  it("负控：不撞名的 body 求值逐字不变（node：12）", () => {
    const fn = bodyFn(
      `const __nudoTm_0x = 7; try { return __nudoTm_0x + x; } catch (e) { return 0; }`,
    );
    const r = $call(fn, [numLit(5)]);
    expect(litValue(r)).toEqual({ ok: true, value: 12 });
  });

  it("避让集来自 AST 词形（body 内 Identifier + 形参）", () => {
    const file = parseSource(`function f(x) { const __nudoTm_0 = 1; return x; }`);
    const decl = (
      file.program.body as Array<{ type: string; body: never }>
    ).find((s) => s.type === "FunctionDeclaration") as { body: never };
    const names = bodyIdentNames(decl.body, ["x"]);
    expect(names.has("__nudoTm_0")).toBe(true);
    expect(names.has("x")).toBe(true);
  });
});

describe("族 59 · 第 3 条 · super.m() 在删方法后（Bug 194 遗留）", () => {
  it("删方法后 super 调用定抛 TypeError（原生：TypeError）", () => {
    const src = `export function f() {
      class A { m(){ return 1; } }
      class B extends A { m(){ return super.m(); } }
      delete A.prototype.m;
      return new B().m();
    }`;
    const rec = call(src);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("用户的 try/catch 吸收该 TypeError（原生：'TypeError'）", () => {
    const src = `export function f() {
      class A { m(){ return 1; } }
      class B extends A { n(){ return super.m(); } }
      delete A.prototype.m;
      try { return new B().n(); } catch (e) { return e.constructor.name; }
    }`;
    expect(val(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("负控：方法未删时 super 调用照常（原生：1）", () => {
    const src = `export function f() {
      class A { m(){ return 1; } }
      class B extends A { m(){ return super.m(); } }
      return new B().m();
    }`;
    expect(val(src)).toEqual({ ok: true, value: 1 });
  });

  it("负控：Object.prototype 成员不判缺席（super.toString 原生存在）", () => {
    const src = `export function f() {
      class A {}
      class B extends A { n(){ return super.toString(); } }
      return new B().n();
    }`;
    const rec = call(src);
    // 引擎不建 Object.prototype 方法的调用面 ⇒ 折 unknown（**不假抛**）
    expect(isNever(rec.throws)).toBe(true);
    expect(val(src).ok).toBe(false);
  });

  it("负控：动态原型写（注册表外）不判缺席（原生有该方法 ⇒ 不抛）", () => {
    const src = `export function f() {
      class A {}
      A.prototype.m = function(){ return 5; };
      class B extends A { n(){ return super.m(); } }
      return new B().n();
    }`;
    const rec = call(src);
    // 原生该方法存在（动态写）⇒ 不该抛；引擎保守折 unknown（不假抛）
    expect(isNever(rec.throws)).toBe(true);
  });
});

describe("族 57 · 第 8 条（追加 · W9 承接）· 复合赋值到「根不可重绑」成员", () => {
  it("mk().x += 2 折 3（原生 3）", () => {
    const src = `export function f() {
      function mk(){ return { x: 1 }; }
      return mk().x += 2;
    }`;
    expect(val(src)).toEqual({ ok: true, value: 3 });
  });

  it("计算键同款：mk()[k] += 2 折 3（原生 3）", () => {
    const src = `export function f() {
      function mk(){ return { x: 1 }; }
      const k = "x";
      return mk()[k] += 2;
    }`;
    expect(val(src)).toEqual({ ok: true, value: 3 });
  });

  it("负控：可重绑根的复合赋值逐字不变（原生 3）", () => {
    const src = `export function f() {
      const o = { x: 1 };
      o.x += 2;
      return o.x;
    }`;
    expect(val(src)).toEqual({ ok: true, value: 3 });
  });

  it("负控：接收者只求值一次（原生 [3, 1]）", () => {
    const src = `export function f() {
      let n = 0;
      function mk(){ n++; return { x: 1 }; }
      const r = mk().x += 2;
      return [r, n];
    }`;
    expect(tupleEls(call(src).result)).toEqual([3, 1]);
  });
});

describe("族 59 · 第 4 条 · 含内建父的类链（Bug 194 / 208）", () => {
  it("派生 Map 实例读得回条目（原生：1 / true / 1）", () => {
    const get = `export function f() {
      class MyMap extends Map {}
      const m = new MyMap([["a", 1]]);
      return m.get("a");
    }`;
    expect(val(get)).toEqual({ ok: true, value: 1 });

    const has = `export function f() {
      class MyMap extends Map {}
      const m = new MyMap([["a", 1]]);
      return m.has("a");
    }`;
    expect(val(has)).toEqual({ ok: true, value: true });

    const size = `export function f() {
      class MyMap extends Map {}
      const m = new MyMap([["a", 1]]);
      return m.size;
    }`;
    expect(val(size)).toEqual({ ok: true, value: 1 });
  });

  it("派生 Set 实例读得回元素面（原生：2 / true）", () => {
    const size = `export function f() {
      class MySet extends Set {}
      const s = new MySet([1, 2]);
      return s.size;
    }`;
    expect(val(size)).toEqual({ ok: true, value: 2 });

    const has = `export function f() {
      class MySet extends Set {}
      const s = new MySet([1, 2]);
      return s.has(1);
    }`;
    expect(val(has)).toEqual({ ok: true, value: true });
  });

  it("负控：缺席键仍折 undefined（原生：undefined）", () => {
    const src = `export function f() {
      class MyMap extends Map {}
      const m = new MyMap([["a", 1]]);
      return m.get("b");
    }`;
    expect(val(src)).toEqual({ ok: true, value: undefined });
  });

  it("负控：用户同名方法优先（原生：'own'）", () => {
    const src = `export function f() {
      class MyMap extends Map { get(k){ return "own"; } }
      const m = new MyMap([["a", 1]]);
      return m.get("a");
    }`;
    expect(val(src)).toEqual({ ok: true, value: "own" });
  });

  it("负控：普通 Map 逐字不变（原生：1）", () => {
    const src = `export function f() {
      const m = new Map([["a", 1]]);
      return m.get("a");
    }`;
    expect(val(src)).toEqual({ ok: true, value: 1 });
  });
});
