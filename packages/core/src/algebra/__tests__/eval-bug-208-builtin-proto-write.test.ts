/**
 * Bug 208 回归：内建**原型对象**上的写被**内建方法表遮蔽**——读面 / 调用面
 * 都不认用户的改写（改成非函数也不抛 TypeError）。
 *
 * 修复前：`Array.prototype.push = function(){ return 99; }; [1].push(2)` → 2
 * （内建方法表直接命中，用户的写被完全遮蔽）；原生 → 99。改成非函数时
 * `[1].push(2)` 也不抛（原生定抛 TypeError：`Array.prototype.push is not a
 * function`）。
 *
 * 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用面按原生属性
 * 查找序（own → prototype）——接收者自身没有同名自有槽时，内建原型链上的
 * **自有写**优先于内建方法实现；改写为非函数则定抛 TypeError。
 * 读面（packages/core/src/algebra/exec/runtime/containers/member.ts 的
 * `.prototype` 臂）：同样按 own → prototype——原型对象上的**自有槽**优先于
 * 内建方法表（否则读回内建实现，借用面也拿内建版）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

// 内建原型对象是**进程级单例**——本文件对它们的改写会漏进后续用例
// （原生里原型对象也是全局单例，但每个用例是独立进程/独立 realm）。
// 用例后把改写删掉，保持用例间隔离。
afterEach(() => {
  call(
    wrap(
      `delete Array.prototype.push; delete Array.prototype.join; delete Map.prototype.get;` +
        ` delete String.prototype.toUpperCase; delete Number.prototype.toFixed;` +
        ` delete Object.prototype.toString; return 1;`,
    ),
    "f",
  );
});

describe("Bug 208 — 内建原型对象上的自有写优先于内建方法表（调用面）", () => {
  it("Array.prototype.push 改写后 → 数组实例调用走用户写的实现", () => {
    expect(
      v(wrap(`Array.prototype.push = function(){ return 99; }; const a = [1]; return a.push(2);`)),
    ).toEqual({ ok: true, value: 99 });
  });

  it("Array.prototype.join 改写后 → 数组实例调用走用户写的实现", () => {
    expect(
      v(wrap(`Array.prototype.join = function(){ return "P"; }; return [1,2].join(",");`)),
    ).toEqual({ ok: true, value: "P" });
  });

  it("Map.prototype.get 改写后 → 实例调用走用户写的实现", () => {
    expect(
      v(wrap(`Map.prototype.get = function(){ return "P"; }; const m = new Map([["a",1]]); return m.get("a");`)),
    ).toEqual({ ok: true, value: "P" });
  });

  it("String.prototype.toUpperCase 改写后 → 字符串实例调用走用户写的实现", () => {
    expect(
      v(wrap(`String.prototype.toUpperCase = function(){ return "P"; }; return "a".toUpperCase();`)),
    ).toEqual({ ok: true, value: "P" });
  });

  it("Number.prototype.toFixed 改写后 → 数字实例调用走用户写的实现", () => {
    expect(
      v(wrap(`Number.prototype.toFixed = function(){ return "P"; }; return (1).toFixed(2);`)),
    ).toEqual({ ok: true, value: "P" });
  });

  it("Object.prototype.toString 改写后 → 闭对象调用走用户写的实现", () => {
    expect(
      v(wrap(`Object.prototype.toString = function(){ return "patched"; }; return ({}).toString();`)),
    ).toEqual({ ok: true, value: "patched" });
  });

  it("改写为非函数 → 调用定抛 TypeError（原生 is not a function）", () => {
    expect(
      v(wrap(`Array.prototype.push = 5; const a=[1]; try { a.push(2); } catch(e) { return e.constructor.name; }`)),
    ).toEqual({ ok: true, value: "TypeError" });
    expect(
      throwName(wrap(`Array.prototype.push = 5; const a=[1]; return a.push(2);`)),
    ).toBe("TypeError");
  });

  it("负控制：未改写时内建实现照旧（不误伤）", () => {
    expect(v(wrap(`return [1,2].join(",");`))).toEqual({ ok: true, value: "1,2" });
    expect(v(wrap(`return "a".toUpperCase();`))).toEqual({ ok: true, value: "A" });
    expect(v(wrap(`const m = new Map([["a",1]]); return m.get("a");`))).toEqual({ ok: true, value: 1 });
  });

  it("负控制：原型对象上的普通数据槽（expand）照旧可读", () => {
    expect(
      v(wrap(`Array.prototype.myExpando = 5; return typeof Array.prototype.myExpando;`)),
    ).toEqual({ ok: true, value: "number" });
  });

  it("读面：Array.prototype.push 改写后 typeof → number（原生读回用户写的值）", () => {
    expect(
      v(wrap(`Array.prototype.push = 5; return typeof Array.prototype.push;`)),
    ).toEqual({ ok: true, value: "number" });
  });

  it("借用面：Array.prototype.join.call([1,2]) → 用户写的实现", () => {
    expect(
      v(
        wrap(
          `Array.prototype.join = function(){ return "P"; }; return String(Array.prototype.join.call([1,2]));`,
        ),
      ),
    ).toEqual({ ok: true, value: "P" });
  });
});
