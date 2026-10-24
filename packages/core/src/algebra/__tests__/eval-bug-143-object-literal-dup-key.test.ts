/**
 * Bug 143 回归：对象字面量**重复键**——后写的定义覆盖先写的定义。
 *
 * ES 语义（OrdinaryOwnPropertyKeys / DefinePropertyOrThrow）：同一键在字面量
 * 里出现多次时，**最后一次**定义生效，且定义形态（数据属性 / 访问器）也随
 * 之一并替换：
 * - `{ get x(){}, x: 2 }` → x 是**数据属性** 2（getter 被丢弃，o.x = 9 是
 *   普通写，不抛）；
 * - `{ x: 2, get x(){} }` → x 是**访问器**（读走 getter，写抛 TypeError——
 *   getter-only，与原生同）。
 *
 * 修复前：静态键访问器在字面量**末尾**统一 `$objAccessor` 注册（无条件），
 * 于是「访问器在前、数据属性在后」时数据属性被访问器吞掉（读折 getter 值、
 * 写语义塌成定抛 TypeError）；「数据在前、访问器在后、又是数据」时中间那次
 * 访问器仍留在侧表。
 *
 * 不变量（负控制钉住）：单访问器、访问器对（get/set 合并）、数据-数据、
 * 访问器在前但最终是访问器、其它键不受牵连。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

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

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 143 — 重复键：后写的数据属性覆盖先写的访问器", () => {
  it("{ get x(){}, x: 2 } → 读得数据属性 2", () => {
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2 }; return o.x;`))).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("{ get x(){}, x: 2 } 后的写不再定抛（数据属性写语义）", () => {
    const src = wrap(`const o = { get x(){ return 1; }, x: 2 }; o.x = 9; return o.x;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 9 });
  });

  it("{ get x(){}, x: 2 } 的自有描述符是数据属性（value = 2）", () => {
    expect(
      v(wrap(`const o = { get x(){ return 1; }, x: 2 }; return Object.getOwnPropertyDescriptor(o, "x").value;`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it("{ x: 1, get x(){}, x: 3 } → 最后一个定义（数据属性 3）胜出", () => {
    expect(v(wrap(`const o = { x: 1, get x(){ return 2; }, x: 3 }; return o.x;`))).toEqual({
      ok: true,
      value: 3,
    });
  });

  it("{ get x(){}, x: 2 } 展开后仍是数据属性 2", () => {
    expect(v(wrap(`const o = { ...{ get x(){ return 1; }, x: 2 } }; return o.x;`))).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("{ get x(){}, x: 2 } 经 Object.assign 拷贝后仍是数据属性 2", () => {
    expect(
      v(wrap(`const o = Object.assign({}, { get x(){ return 1; }, x: 2 }); return o.x;`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it("被覆盖的 getter 不再被调用（副作用归零）", () => {
    expect(
      v(wrap(`let n = 0; const o = { get x(){ n++; return 1; }, x: 2 }; return o.x + "/" + n;`)),
    ).toEqual({ ok: true, value: "2/0" });
  });

  it("重复键的数据属性仍可枚举（键存在性不丢）", () => {
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2 }; return Object.keys(o).join(",");`))).toEqual({
      ok: true,
      value: "x",
    });
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2 }; return "x" in o;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("方法简写是数据属性：{ get x(){}, x(){} } → 方法胜出", () => {
    expect(v(wrap(`const o = { get x(){}, x(){} }; return typeof o.x;`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("symbol 键同键仲裁：{ get [Symbol.iterator](), [Symbol.iterator]: 2 } → 数据属性胜出", () => {
    expect(
      v(
        wrap(
          `const o = { get [Symbol.iterator](){ return 1; }, [Symbol.iterator]: 2 }; return o[Symbol.iterator];`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("动态计算键同键仲裁：{ get [k](), [k]: 2 } → 数据属性胜出（定义语义）", () => {
    expect(
      v(wrap(`const k = "x"; const o = { get [k](){ return 1; }, [k]: 2 }; return o.x;`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it("动态计算键同键仲裁后写语义不塌成定抛（数据属性写）", () => {
    const src = wrap(`const k = "x"; const o = { get [k](){ return 1; }, [k]: 2 }; o.x = 9; return o.x;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 9 });
  });

  it("动态计算键：键表达式仍只求值一次", () => {
    expect(
      v(wrap(`let n = 0; const k = (n++, "x"); const o = { get [k](){ return 1; }, [k]: 2 }; return n;`)),
    ).toEqual({ ok: true, value: 1 });
  });
});

describe("Bug 143 — 负控制：单访问器 / 访问器对 / 数据-数据 等既有语义不回归", () => {
  it("单访问器：{ get x(){ return 7 } } → 7", () => {
    expect(v(wrap(`const o = { get x(){ return 7; } }; return o.x;`))).toEqual({ ok: true, value: 7 });
  });

  it("数据在前、访问器在后 → 访问器胜出（读走 getter）", () => {
    expect(v(wrap(`const o = { x: 2, get x(){ return 1; } }; return o.x;`))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("数据在前、访问器在后 → 写仍是 getter-only 的 TypeError", () => {
    expect(throwName(wrap(`const o = { x: 2, get x(){ return 1; } }; o.x = 9; return o.x;`))).toBe(
      "TypeError",
    );
  });

  it("访问器对：{ get x(){}, set x(v){} } → 读得 getter 值 1", () => {
    expect(v(wrap(`const o = { get x(){ return 1; }, set x(v){} }; return o.x;`))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("setter 仍被调用（写回 receiver 字段）", () => {
    const src = wrap(`const o = { set x(v){ this._v = v; } }; o.x = 5; return o._v;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 5 });
  });

  it("访问器-访问器：{ get x(){1}, get x(){2} } → 后者 2", () => {
    expect(v(wrap(`const o = { get x(){ return 1; }, get x(){ return 2; } }; return o.x;`))).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("数据-数据：{ x: 1, x: 2 } → 2", () => {
    expect(v(wrap(`const o = { x: 1, x: 2 }; return o.x;`))).toEqual({ ok: true, value: 2 });
  });

  it("访问器-数据-访问器：最终是访问器 → 读最后一个 getter", () => {
    expect(
      v(wrap(`const o = { get x(){ return 1; }, x: 2, get x(){ return 3; } }; return o.x;`)),
    ).toEqual({ ok: true, value: 3 });
  });

  it("symbol 键：{ [Symbol.iterator]: 2, get [Symbol.iterator](){} } → 访问器胜出", () => {
    expect(
      v(
        wrap(
          `const o = { [Symbol.iterator]: 2, get [Symbol.iterator](){ return 1; } }; return o[Symbol.iterator];`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("动态计算键：{ [k]: 2, get [k](){} } → 访问器胜出（后写）", () => {
    expect(
      v(wrap(`const k = "x"; const o = { [k]: 2, get [k](){ return 1; } }; return o.x;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("动态计算键：不同键互不牵连（getter 键 + 数据键）", () => {
    expect(
      v(wrap(`const k = "x", j = "y"; const o = { get [k](){ return 1; }, [j]: 2 }; return o.x + "/" + o.y;`)),
    ).toEqual({ ok: true, value: "1/2" });
  });

  it("方法简写在后：{ x(){}, get x(){} } → 访问器胜出（读 undefined）", () => {
    expect(v(wrap(`const o = { x(){}, get x(){} }; return typeof o.x;`))).toEqual({
      ok: true,
      value: "undefined",
    });
  });

  it("其它键不受重复键仲裁牵连", () => {
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2, y: 3 }; return o.y;`))).toEqual({
      ok: true,
      value: 3,
    });
  });

  it("无重复键的字面量不受影响（普通数据属性）", () => {
    expect(v(wrap(`const o = { a: 1, b: 2 }; return o.a + o.b;`))).toEqual({ ok: true, value: 3 });
  });
});
