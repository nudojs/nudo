/**
 * Bug 276 — 类实例上 `Object.defineProperty(inst, "x", { enumerable: false })`
 * 的**自有属性**在枚举视图（`Object.keys` / `values` / `entries` /
 * `JSON.stringify` / `Object.assign` / spread）面上**整体不可见**（引擎把它
 * 当可枚举键发布），而同一引擎的 `for-in` 面与描述符面（gOPD）说它**不可
 * 枚举** ⇒ **同一引擎两面互斥** + 产物面发布自信的错值。
 *
 * 根因：flags 表有**两套载体**（brand 自身 / brand 的内层 obj）。类实例的
 * `defineProperty` 只把 flags 记在 **brand** 上，而枚举视图的 `enumKeys` 只
 * 查**内层 obj** 那一套 ⇒ 漏判。
 *
 * 修法：① `applyPropertyDescriptor` 的 brand 臂把 flags **并落内层 obj**（与
 * 原型 brand 路径同口径），并迁移旧 brand 的不变性侧表；② 枚举视图的
 * `enumKeys` / `assignSourceSlots` 走 `isEnumerableView` / brand 载体，
 * **并查两套载体**。
 *
 * 严格单变量对照：唯一变量 = 接收者的 kind（类实例 vs 普通对象），
 * `defineProperty` 写法逐字相同。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue, type Abs } from "../abs.ts";

const PRELUDE = `
class C { constructor() { this.x = 1; this.y = 2; } }
function mk() {
  const inst = new C();
  Object.defineProperty(inst, "x", { enumerable: false });
  return inst;
}
function mkPlain() {
  const plain = { x: 1, y: 2 };
  Object.defineProperty(plain, "x", { enumerable: false });
  return plain;
}
`;

/** 求值 f() 的结果 Abs */
function absOf(body: string): Abs {
  return call(`${PRELUDE}\nexport function f() { ${body} }`, "f").result;
}

/** tuple 的逐元素字面量（任一元素无 lit 项 ⇒ undefined） */
function tupleLits(a: Abs): unknown[] | undefined {
  if (a.shape.k !== "tuple") return undefined;
  const out = a.shape.elements.map((e) => {
    const v = litValue(e);
    return v.ok ? v.value : undefined;
  });
  return out.some((v) => v === undefined) ? undefined : out;
}

describe("Bug 276 · 类实例的 enumerable:false 自有键必须对所有枚举面生效", () => {
  it("Object.keys 剔除不可枚举自有键（宿主同键集）", () => {
    expect(tupleLits(absOf("return Object.keys(mk());"))).toEqual(["y"]);
  });

  it("Object.values 同键集", () => {
    expect(tupleLits(absOf("return Object.values(mk());"))).toEqual([2]);
  });

  it("Object.entries 同键集（键值对不重复发布不可枚举键）", () => {
    const a = absOf("return Object.entries(mk());");
    expect(a.shape.k).toBe("tuple");
    const els = (a.shape as { elements: Abs[] }).elements;
    expect(els.length).toBe(1);
    expect(tupleLits(els[0]!)).toEqual(["y", 2]);
  });

  it("JSON.stringify 只序列化可枚举自有键", () => {
    const a = absOf("return JSON.stringify(mk());");
    expect(litValue(a)).toEqual({ ok: true, value: '{"y":2}' });
  });

  it("Object.assign 只拷可枚举自有键", () => {
    expect(tupleLits(absOf("return Object.keys(Object.assign({}, mk()));"))).toEqual(["y"]);
  });

  it("spread 只拷可枚举自有键", () => {
    expect(tupleLits(absOf("return Object.keys({ ...mk() });"))).toEqual(["y"]);
  });

  it("五个枚举面 + for-in + gOPN 同结论（引擎内部不再互斥）", () => {
    expect(tupleLits(absOf("const s = []; for (const k in mk()) s.push(k); return s;"))).toEqual([
      "y",
    ]);
    // gOPN 是「**全部**自有键」语义 ⇒ 不可枚举的 x 照列
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(mk());"))).toEqual(["x", "y"]);
  });

  it("描述符面：gOPD 说 x 是「自有 + 不可枚举」的数据属性", () => {
    expect(
      tupleLits(
        absOf(`
  const inst = mk();
  const d = Object.getOwnPropertyDescriptor(inst, "x");
  return [d.value, d.writable, d.enumerable, d.configurable, Object.hasOwn(inst, "x")];
`),
      ),
    ).toEqual([1, true, false, true, true]);
  });

  it("单变量对照：普通对象（同一 defineProperty）结论一致", () => {
    expect(tupleLits(absOf("return Object.keys(mkPlain());"))).toEqual(["y"]);
    expect(litValue(absOf("return JSON.stringify(mkPlain());"))).toEqual({
      ok: true,
      value: '{"y":2}',
    });
  });

  it("重定义为可枚举后重新进入枚举视图（标志不是一次性丢弃）", () => {
    expect(
      tupleLits(
        absOf(`
  const inst = mk();
  Object.defineProperty(inst, "x", { enumerable: true });
  return Object.keys(inst);
`),
      ),
    ).toEqual(["x", "y"]);
  });

  it("连续两次 defineProperty 收紧不同键：两套 flags 都保留", () => {
    expect(
      tupleLits(
        absOf(`
  const inst = mk();
  Object.defineProperty(inst, "y", { enumerable: false });
  return Object.keys(inst);
`),
      ),
    ).toEqual([]);
  });
});
