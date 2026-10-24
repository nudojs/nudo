/**
 * Bug 136：赋值目标**引用求值顺序**颠倒（RHS 先于对象 / 计算键）+ 计算键 /
 * 自增自减 / delete 的键**重复求值**。
 *
 * 根因（转译层，core/src/algebra/exec/transpile）：
 * - 成员写把 RHS 提成 IIFE **实参**（`((__v) => { …写… })(rhs)`）⇒ 实参先于
 *   体内求值 ⇒ RHS 跑在**引用**（对象 + 计算键）之前（原生顺序是
 *   EvaluatePropertyAccess → GetValue → RHS → PutValue）；
 * - 路径层把**计算键**内联进读/写两处（`$get(o, KEY)` + `$idxSet(o, KEY, …)`）
 *   ⇒ 键跑两次（原生各一次）。
 *
 * 修法：引用（根 + 各层键 + 中间层取值）先求值并落临时量，RHS 落在其后；
 * 计算键绑临时量、读/写共用同一绑定（各求值一次）。
 *
 * 负控制：非计算键 / 单层路径 / delete 的既有口径不受本条影响。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 136: 赋值目标的引用求值顺序 + 计算键只求值一次", () => {
  it("A1 赋值：计算键先于 RHS（原生 k,v）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")] = (log.push("v"),2); return log.join(","); }`,
      ),
    ).toEqual({ ok: true, value: "k,v" });
  });

  it("A2 赋值：对象先于计算键先于 RHS（原生 f,k,v）", () => {
    expect(
      v(
        `export function f() { let log=[]; function g(){return (log.push("f"),{a:1});} g()[(log.push("k"),"a")] = (log.push("v"),2); return log.join(","); }`,
      ),
    ).toEqual({ ok: true, value: "f,k,v" });
  });

  it("A3 下标赋值：a[i++] = i + 10（原生 11,0|1）", () => {
    expect(
      v(`export function f() { let i=0; const a=[0,0]; a[i++] = i + 10; return a.join(",") + "|" + i; }`),
    ).toEqual({ ok: true, value: "11,0|1" });
  });

  it("A4 下标赋值：a[i++] = i（原生 1,0|1）", () => {
    expect(
      v(`export function f() { let i=0; const a=[0,0]; a[i++] = i; return a.join(",") + "|" + i; }`),
    ).toEqual({ ok: true, value: "1,0|1" });
  });

  it("B1 复合赋值：计算键只跑一次且先于 RHS（原生 k,v）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")] += (log.push("v"),2); return log.join(","); }`,
      ),
    ).toEqual({ ok: true, value: "k,v" });
  });

  it("B2 自增：计算键只跑一次（原生 k）", () => {
    expect(
      v(`export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")]++; return log.join(","); }`),
    ).toEqual({ ok: true, value: "k" });
  });

  it("B3 delete：计算键只跑一次（原生 k）", () => {
    expect(
      v(`export function f() { let log=[]; const o={a:1}; delete o[(log.push("k"),"a")]; return log.join(","); }`),
    ).toEqual({ ok: true, value: "k" });
  });

  it("B4 赋值：顺序修正后值仍落位（原生 k,v|2）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")] = (log.push("v"),2); return log.join(",") + "|" + o.a; }`,
      ),
    ).toEqual({ ok: true, value: "k,v|2" });
  });

  it("B5 自增：键一次且新值落位（原生 k|2）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")]++; return log.join(",") + "|" + o.a; }`,
      ),
    ).toEqual({ ok: true, value: "k|2" });
  });

  it("B6 delete：键一次且槽真被删（原生 k|gone）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; delete o[(log.push("k"),"a")]; return log.join(",") + "|" + ("a" in o ? "still" : "gone"); }`,
      ),
    ).toEqual({ ok: true, value: "k|gone" });
  });

  // —— 负控制：非计算键 / 单层路径 / 常规路径不受本条影响 ——
  it("C1 负控制：o.a = 2 → 2", () => {
    expect(v(`export function f() { const o={a:1}; o.a = 2; return o.a; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("C2 负控制：o.a += 2 → 3", () => {
    expect(v(`export function f() { const o={a:1}; o.a += 2; return o.a; }`)).toEqual({
      ok: true,
      value: 3,
    });
  });

  it("C3 负控制：o.a++ → 2", () => {
    expect(v(`export function f() { const o={a:1}; o.a++; return o.a; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("C4 负控制：delete o.a → gone", () => {
    expect(
      v(`export function f() { const o={a:1}; delete o.a; return "a" in o ? "still" : "gone"; }`),
    ).toEqual({ ok: true, value: "gone" });
  });

  it("C5 负控制：a[i++] = 5 → 5,0|1", () => {
    expect(
      v(`export function f() { let i=0; const a=[0,0]; a[i++] = 5; return a.join(",") + "|" + i; }`),
    ).toEqual({ ok: true, value: "5,0|1" });
  });

  it("C6 负控制：嵌套成员写 o.a.b = 2 → 2", () => {
    expect(v(`export function f() { const o={a:{b:1}}; o.a.b = 2; return o.a.b; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("C7 负控制：赋值表达式的值 = 写入的值（原生 5|5）", () => {
    expect(
      v(`export function f() { const o={a:1}; const x = (o.a = 5); return x + "|" + o.a; }`),
    ).toEqual({ ok: true, value: "5|5" });
  });

  it("C8 负控制：delete o.a.b（数据属性链）→ gone", () => {
    expect(
      v(`export function f() { const o={a:{b:1}}; delete o.a.b; return "b" in o.a ? "still" : "gone"; }`),
    ).toEqual({ ok: true, value: "gone" });
  });
});
