/**
 * Bug 317：AggregateError(errors) 的 errors 槽与入参**共享同一 Abs**
 * （无 IterableToList 拷贝）。
 *
 * 原生 AggregateError 构造器走 `errors = IterableToList(errors)`——产出
 * **新列表**（元素同、列表不同）：
 *   const a=[1,2]; const e=new AggregateError(a,"msg"); String(e.errors === a) → "false"
 *   const a=[1,2]; const e=new AggregateError(a,"msg"); a.push(3); e.errors.length → 2
 *
 * node v26.10.0 原生实测（oracle）：
 *   e.errors === a                     → false
 *   a.push(3) 后 e.errors.length       → 2（a.length → 3）
 *   new AggregateError([1,2],"m").errors.length → 2
 *   new AggregateError([1,2],"m").errors[0]    → 1
 *   new AggregateError([1,2],"m").errors.join("-") → "1-2"
 *   Array.isArray(new AggregateError([1,2],"m").errors) → true
 *   e.errors === e.errors               → true（同一列表）
 *   e1.errors === e2.errors             → false（两次构造两个列表）
 *   gOPD(errors) → {value:[1], writable:true, enumerable:false, configurable:true}
 *
 * 修前：slots["errors"] 直接存**同一个**入参 Abs（别名）⇒ `e.errors === a`
 * 折 true、`a.push(3)` 就地改写 e.errors.length。
 * 修复：error-family.ts 的 iterableListCopy —— tuple/arr 入参造**新 Abs**
 * （元素同、身份异；elements 数组另拷贝；打新鲜实例标使 === 折 exact false）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

/** 调用 f() 的字面量结果（非字面量 → undefined） */
function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : undefined;
}

describe("Bug 317: AggregateError errors is an IterableToList copy", () => {
  it("e.errors !== 入参（原生 false；修前折 true）", () => {
    expect(
      v(`export function f() { const a=[1,2]; const e=new AggregateError(a,"msg"); return String(e.errors === a); }`),
    ).toBe("false");
  });

  it("入参后续变更不改写 e.errors（原生 length 不变）", () => {
    expect(
      v(`export function f() { const a=[1,2]; const e=new AggregateError(a,"msg"); a.push(3); return e.errors.length; }`),
    ).toBe(2);
    // 对照：入参自身确实被改写了（长度 3）
    expect(
      v(`export function f() { const a=[1,2]; const e=new AggregateError(a,"msg"); a.push(3); return a.length; }`),
    ).toBe(3);
  });

  it("拷贝内容与入参一致（长度 / 下标 / join / isArray）", () => {
    expect(v(`export function f() { return new AggregateError([1,2],"msg").errors.length; }`)).toBe(2);
    expect(v(`export function f() { return new AggregateError([1,2],"msg").errors[0]; }`)).toBe(1);
    expect(v(`export function f() { return new AggregateError([1,2],"msg").errors.join("-"); }`)).toBe("1-2");
    expect(v(`export function f() { return Array.isArray(new AggregateError([1,2],"msg").errors); }`)).toBe(true);
    expect(v(`export function f() { return new AggregateError([],"msg").errors.length; }`)).toBe(0);
    expect(v(`export function f() { return new AggregateError(["x"],"msg").errors[0]; }`)).toBe("x");
  });

  it("同一实例的 errors 恒等；两次构造互不等（两个独立列表）", () => {
    expect(
      v(`export function f() { const e=new AggregateError([1],"msg"); return String(e.errors === e.errors); }`),
    ).toBe("true");
    expect(
      v(`export function f() { const e1=new AggregateError([1],"msg"); const e2=new AggregateError([1],"msg"); return String(e1.errors === e2.errors); }`),
    ).toBe("false");
  });

  it("errors 槽仍是自有不可枚举数据属性（gOPD 描述符不变）", () => {
    expect(
      v(`export function f() { const d = Object.getOwnPropertyDescriptor(new AggregateError([1], "m"), "errors"); return [d.value.length, d.writable, d.enumerable, d.configurable].join(","); }`),
    ).toBe("1,true,false,true");
    expect(
      v(`export function f() { return new AggregateError([1], "m").hasOwnProperty("errors"); }`),
    ).toBe(true);
    expect(
      v(`export function f() { return new AggregateError([1], "m").propertyIsEnumerable("errors"); }`),
    ).toBe(false);
  });
});
