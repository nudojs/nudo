/**
 * BUG-258 回归：**数组视图**从 WeakSet 身份侧表 → **Shape facet**
 * （`{ k: "obj", view: "array" }`）。
 *
 * RegExpExecArray / String.match 结果 / 标签模板对象原生都是**数组 exotic**
 * （IsArray = true），引擎按 obj 形状建模（自有下标槽 "0".."n-1" + length
 * 槽，#136 的槽读面依赖它）。缺陷类：数组性只活在一张身份侧表里 ⇒
 * 形状拷贝（`{ ...abs }`）丢标记，类型面 / emit 产物也看不见该标注
 * （guard / zod schema / dts 三产物全部拒绝真实值）。
 *
 * 修法：facet 进形状 ⇒ 拷贝天然携带，消费方（Array.isArray / JSON 序列化
 * 视图 / 数组方法派发）只读形状 facet，侧表不存在。
 *
 * 锚定值均为 node 原生实测。
 */
import { describe, it, expect } from "vitest";
import { litValue, markArrayView, isArrayView, numLit, strLit, obj, type Abs } from "../abs.ts";
import { isMatchArrayView } from "../builtins/regexp.ts";
import { denoteGuard } from "../denote.ts";
import { joinObjects } from "../objects.ts";
import { call, tupleEls } from "./eval-helpers.ts";

describe("BUG-258: 数组视图 = Shape facet（形状单一事实源）", () => {
  it('Array.isArray(/a(b)c/.exec("abc")) 折 true（值面）', () => {
    const r = call(`export function f1() { return Array.isArray(/a(b)c/.exec("abc")); }`, "f1");
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
  });

  it('JSON.stringify("abc".match(/b/)) → \'["b"]\'（JSON 视图）', () => {
    const r = call(`export function f2() { return JSON.stringify("abc".match(/b/)); }`, "f2");
    expect(litValue(r.result)).toEqual({ ok: true, value: '["b"]' });
  });

  it("形状级：match 结果 Abs 带 view: \"array\"，浅拷贝携带（身份侧表会丢）", () => {
    const r = call(`export function f3() { return /a(b)c/.exec("abc"); }`, "f3");
    const a = r.result;
    // 形状仍是 obj（不转 tuple/arr：#136 的槽读面依赖它）
    expect(a.shape.k).toBe("obj");
    expect(a.shape.k === "obj" ? a.shape.view : undefined).toBe("array");
    expect(isArrayView(a)).toBe(true);
    expect(isMatchArrayView(a)).toBe(true);
    // 缺陷类断言：Abs 浅拷贝必须仍报数组视图（旧 WeakSet 侧表在此丢标记）
    const copy: Abs = { ...a };
    expect(copy).not.toBe(a);
    expect(isArrayView(copy)).toBe(true);
    expect(isMatchArrayView(copy)).toBe(true);
    // 形状拷贝同样携带
    const shapeCopy: Abs = { ...a, shape: { ...a.shape } };
    expect(isArrayView(shapeCopy)).toBe(true);
    // 普通 obj 形状不是数组视图
    expect(isArrayView(obj({ a: numLit(1) }))).toBe(false);
    expect(isMatchArrayView(obj({ a: numLit(1) }))).toBe(false);
  });

  it("形状级：markArrayView 不可变替换 shape（原形状不被就地改写）", () => {
    const plain = obj({ 0: strLit("x"), length: numLit(1) });
    const before = plain.shape;
    expect(isArrayView(plain)).toBe(false);
    markArrayView(plain);
    expect(plain.shape).not.toBe(before);
    expect(isArrayView(plain)).toBe(true);
    // 旧形状对象未被就地打标（共享形状的其它 Abs 不受污染）
    expect(isArrayView({ shape: before, conf: plain.conf })).toBe(false);
    // 非 obj 形状不标注
    const prim = numLit(1);
    markArrayView(prim);
    expect(isArrayView(prim)).toBe(false);
  });

  it("数组方法派发仍工作：/a(b)c/.exec(\"abc\").map((x) => x) → [\"abc\",\"b\"]", () => {
    const r = call(`export function f5() { return /a(b)c/.exec("abc").map((x) => x); }`, "f5");
    expect(tupleEls(r.result)).toEqual(["abc", "b"]);
    // 端到端值面同样逐字一致（原生：["abc","b"]）
    const j = call(
      `export function f6() { return JSON.stringify(/a(b)c/.exec("abc").map((x) => x)); }`,
      "f6",
    );
    expect(litValue(j.result)).toEqual({ ok: true, value: '["abc","b"]' });
  });

  it("join：两侧都带数组视图 ⇒ facet 传递；一侧是普通对象 ⇒ facet 丢弃", () => {
    const slots = {
      0: { value: strLit("abc") },
      length: { value: numLit(1) },
    };
    const viewA = obj(slots);
    const viewB = obj(slots);
    markArrayView(viewA);
    markArrayView(viewB);
    const plain = obj(slots);
    expect(isArrayView(viewA)).toBe(true);
    expect(isArrayView(viewB)).toBe(true);
    // 两侧都是数组视图 ⇒ join 结果仍是数组视图（重建 shape 时必须传递 facet）
    expect(isArrayView(joinObjects(viewA, viewB))).toBe(true);
    // 一侧是普通对象 ⇒ join 结果不是数组视图（保守丢弃 ⇒ 不让四面按数组判据
    // 校验一个可能是普通对象的值）
    expect(isArrayView(joinObjects(viewA, plain))).toBe(false);
    expect(isArrayView(joinObjects(plain, viewA))).toBe(false);
  });

  it("guard 面读 facet：数组视图要求 Array.isArray（修前 !Array.isArray ⇒ 真值被判假）", () => {
    const r = call(`export function f7() { return /a(b)c/.exec("abc"); }`, "f7");
    const expr = denoteGuard(r.result, "value");
    expect(expr).toContain("Array.isArray(value)");
    expect(expr).not.toContain("!Array.isArray(value)");
    const guard = new Function("value", `return (${expr});`) as (v: unknown) => boolean;
    // 原生真值（槽全为自有属性）
    expect(guard(/a(b)c/.exec("abc"))).toBe(true);
    // 槽面逐字同形但**不是数组** ⇒ 拒绝（facet 是唯一判据）
    expect(guard({ 0: "abc", 1: "b", length: 2, index: 0, input: "abc", groups: undefined })).toBe(
      false,
    );
    // 普通 obj 形状仍是原判据（排除数组）
    const plain = call(`export function f8() { return { a: 1 }; }`, "f8");
    expect(denoteGuard(plain.result, "value")).toContain("!Array.isArray(value)");
  });
});
