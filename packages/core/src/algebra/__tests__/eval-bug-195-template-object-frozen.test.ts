/**
 * Bug 195 回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。
 *
 * ES 语义（GetTemplateObject）：`CreateArrayFromList(cooked)` + `SetIntegrityLevel(frozen)`
 * ⇒ 模板对象是**真数组**，且
 * - `length` / `raw` / `@@iterator` 是**非枚举**自有属性（原生三者全非枚举；
 *   `Object.keys(s)` 只有下标 "0".."n-1"）；
 * - `Object.isFrozen(s)` / `Object.isFrozen(s.raw)` 均为 true；
 * - `JSON.stringify(s)` 走**数组序列化**（`["a","b"]`）。
 *
 * 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）：
 * - `Object.keys(s)` → `"0,1,length,raw,@@iterator"`（错值）；
 * - `Object.isFrozen(s)` / `Object.isFrozen(s.raw)` → false（错值）；
 * - `JSON.stringify(s)` → `{"0":"a","1":"b","length":2,...}`（错值：走了 obj 面）。
 *
 * 负控制：模板对象的**元素面**（下标读 / length / raw / 展开）不受影响。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

/** 标签函数：把模板对象交给 body 表达式 */
const TPL = (expr: string) =>
  `export function f() { function tag(s) { return ${expr}; } return tag\`a\${1}b\`; }`;

describe("Bug 195：标签模板对象是冻结的数组 exotic", () => {
  it("Object.isFrozen(s) → true（原生冻结）", () => {
    expect(val(TPL("Object.isFrozen(s)"))).toEqual({ ok: true, value: true });
  });

  it("Object.isFrozen(s.raw) → true（raw 数组同样冻结）", () => {
    expect(val(TPL("Object.isFrozen(s.raw)"))).toEqual({ ok: true, value: true });
  });

  it("Object.keys(s) 只有下标（length/raw/@@iterator 非枚举）", () => {
    expect(val(TPL('Object.keys(s).join(",")'))).toEqual({ ok: true, value: "0,1" });
  });

  it("JSON.stringify(s) 走数组序列化面", () => {
    expect(val(TPL("JSON.stringify(s)"))).toEqual({ ok: true, value: '["a","b"]' });
  });

  it("s.propertyIsEnumerable(\"length\") → false", () => {
    expect(val(TPL('s.propertyIsEnumerable("length")'))).toEqual({ ok: true, value: false });
  });

  it("Object.getOwnPropertyDescriptor(s, \"length\").enumerable → false", () => {
    expect(val(TPL('Object.getOwnPropertyDescriptor(s, "length").enumerable'))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("for..in 遍历模板对象只枚举下标", () => {
    expect(val(TPL('(() => { let k = ""; for (const x in s) k += x; return k; })()'))).toEqual({
      ok: true,
      value: "01",
    });
  });

  it("负控制：元素面不变（下标 / length / raw / 展开）", () => {
    expect(val(TPL("s[0]"))).toEqual({ ok: true, value: "a" });
    expect(val(TPL("s.length"))).toEqual({ ok: true, value: 2 });
    expect(val(TPL("s.raw.length"))).toEqual({ ok: true, value: 2 });
    expect(val(TPL("s.raw[1]"))).toEqual({ ok: true, value: "b" });
    expect(val(TPL("[...s].join('|')"))).toEqual({ ok: true, value: "a|b" });
  });

  it("数组原型方法在模板对象上可派发（原生模板对象是数组 exotic）", () => {
    // 原生：标签函数的**第一个实参**是 strings 数组（Array exotic ⇒ 继承
    // Array.prototype）——join / indexOf / concat / map / slice 全部可调。
    // 修复前：引擎的数组方法面只认 tuple/arr 形状 ⇒ 方法读折 exact
    // undefined ⇒ 调用**假抛 TypeError**（原生不抛）。
    expect(val(TPL('s.join(",")'))).toEqual({ ok: true, value: "a,b" });
    expect(val(TPL("String(typeof s.join)"))).toEqual({ ok: true, value: "function" });
    expect(val(TPL('s.indexOf("a")'))).toEqual({ ok: true, value: 0 });
    expect(val(TPL('s.concat(["c"]).join(",")'))).toEqual({ ok: true, value: "a,b,c" });
    expect(val(TPL("s.map((x) => x).join(\",\")"))).toEqual({ ok: true, value: "a,b" });
    expect(val(TPL('s.slice(0, 1).join(",")'))).toEqual({ ok: true, value: "a" });
  });

  it("负控制：普通对象不是数组视图（数组方法面不外溢）", () => {
    expect(val(`export function f() { return String(typeof ({}).join); }`)).toEqual({
      ok: true,
      value: "undefined",
    });
  });

  it("负控制：普通对象仍不是冻结的（extState 标注不外溢）", () => {
    expect(val(`export function f() { return Object.isFrozen({}); }`)).toEqual({
      ok: true,
      value: false,
    });
  });
});

/**
 * `Array.isArray(模板对象)` 必须是 **true**——原生 GetTemplateObject =
 * `CreateArrayFromList(cooked)` + `SetIntegrityLevel(frozen)` ⇒ 标签模板对象
 * 是**数组 exotic**（不是普通对象）。
 *
 * 修复前：引擎 isArray 只认 arr/tuple 形状 ⇒ 模板对象（obj 形状）折
 * **false**（wrong-exact）。
 */
describe("Bug 195：Array.isArray(标签模板对象) → true", () => {
  it("Array.isArray(s) → true（模板对象是数组 exotic）", () => {
    expect(val(TPL("Array.isArray(s)"))).toEqual({ ok: true, value: true });
  });

  it("Array.isArray(s) → true（多段模板同样成立）", () => {
    expect(val(`export function f() { function tag(s) { return Array.isArray(s); } return tag\`a\${1}b\`; }`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：普通对象 / 非数组值 → false", () => {
    expect(val(`export function f() { return Array.isArray({}); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Array.isArray("x"); }`)).toEqual({ ok: true, value: false });
  });

  it("负控制：迭代器对象仍不是数组", () => {
    expect(val(`export function f() { return Array.isArray([1,2].entries()); }`)).toEqual({
      ok: true,
      value: false,
    });
  });
});
