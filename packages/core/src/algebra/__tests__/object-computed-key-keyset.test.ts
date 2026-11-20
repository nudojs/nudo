/**
 * 抽象计算键写的**自有键集不完备**面：对象字面量 `{[k]:v}` 的 `$setKey`
 * 通道与 `Object.assign` 的消费端都必须与 `o[k]=v`（`$idxSet`）/ `{...s}`
 * 同口径——键不可判 ⇒ 键家族（Object.keys/values/entries）折 partial，
 * 不得折「只含字面键」的 exact。
 *
 * 判据单一事实源：objects.ts 的 `markKeySetOpenAbs` / `keySetIncompleteAbs`
 * （Abs 级 prop-flags 侧表位）。本文件的断言只看**消费者**的结论
 * （arr(string) + partial），不钉标记位本身。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { str, litValue, type Abs } from "../abs.ts";
import { call, resetEngineCaches } from "./eval-helpers.ts";
import { keySetIncompleteAbs } from "../objects.ts";

/** 结果是否为 `string[]` 的诚实 partial（键集不完备的键家族折叠） */
function isPartialStringArr(a: Abs): boolean {
  return (
    a.shape.k === "arr" &&
    a.shape.element.shape.k === "prim" &&
    a.shape.element.shape.type === "string" &&
    a.conf === "partial"
  );
}

/** tuple 结果的字面量键集（非 tuple / 含非字面量元素 ⇒ undefined） */
function tupleKeys(a: Abs): string[] | undefined {
  if (a.shape.k !== "tuple") return undefined;
  const out: string[] = [];
  for (const el of a.shape.elements) {
    const v = litValue(el);
    if (!v.ok || typeof v.value !== "string") return undefined;
    out.push(v.value);
  }
  return out;
}

beforeEach(() => {
  resetEngineCaches();
});

describe("对象字面量抽象计算键与 Object.assign 的键集不完备面", () => {
  it("BUG-199 对象字面量抽象计算键 `{[k]:1}`：Object.keys 折 string[] partial（改前 == 只含字面键的 exact 元组）；键家族三兄弟同口径；字面量键对照组仍 exact", () => {
    // 缺陷组：抽象键（`k` 是任意字符串 ⇒ ToPropertyKey 结果不可判）
    const keys = call(
      `export function f(k) { return Object.keys({ [k]: 1, z: 2 }); }`,
      "f",
      [str()],
    ).result;
    expect(isPartialStringArr(keys)).toBe(true);

    const values = call(
      `export function f(k) { return Object.values({ [k]: 1, z: 2 }); }`,
      "f",
      [str()],
    ).result;
    expect(values.shape.k).toBe("arr");
    expect(values.conf).toBe("partial");

    const entries = call(
      `export function f(k) { return Object.entries({ [k]: 1, z: 2 }); }`,
      "f",
      [str()],
    ).result;
    expect(entries.shape.k).toBe("arr");
    expect(entries.conf).toBe("partial");

    // 长度 / 下标不得再折成 exact 单值
    const len = call(
      `export function f(k) { return Object.keys({ [k]: 1 }).length; }`,
      "f",
      [str()],
    ).result;
    expect(len.conf).not.toBe("exact");

    // 对照组：字面量键的键集可判 ⇒ 仍是 exact 元组（不得被本条改宽）
    const lit = call(
      `export function f() { return Object.keys({ y: 1, z: 2 }); }`,
      "f",
    ).result;
    expect(tupleKeys(lit)).toEqual(["y", "z"]);
    expect(lit.conf).toBe("exact");
  });

  it("BUG-199 同一抽象键换写入语法（`o[k]=1` 的 $idxSet）结论不变：两条写入通道 parity；标记确实落在返回的 Abs 上", () => {
    const viaSetKey = call(
      `export function f(k) { return { [k]: 1, z: 2 }; }`,
      "f",
      [str()],
    ).result;
    const viaIdxSet = call(
      `export function f(k) { const o = { z: 2 }; o[k] = 1; return o; }`,
      "f",
      [str()],
    ).result;
    expect(keySetIncompleteAbs(viaSetKey)).toBe(true);
    expect(keySetIncompleteAbs(viaIdxSet)).toBe(true);
  });

  it("BUG-201 Object.assign 传播源的键集不完备标记：改前 `Object.assign({z:2},s)` 折 exact [\"z\"]、`Object.assign({},s)` 折 exact []；同一源的 spread 面是同口径对照", () => {
    // 缺陷组：源 `s` 经抽象键写 `s[k]=1` 带标记（$idxSet 一直会打）
    const assignToZ = call(
      `export function f(k) { const s = {}; s[k] = 1; return Object.keys(Object.assign({ z: 2 }, s)); }`,
      "f",
      [str()],
    ).result;
    expect(isPartialStringArr(assignToZ)).toBe(true);

    const assignToEmpty = call(
      `export function f(k) { const s = {}; s[k] = 1; return Object.keys(Object.assign({}, s)); }`,
      "f",
      [str()],
    ).result;
    expect(isPartialStringArr(assignToEmpty)).toBe(true);

    // 对照组：同一源经 spread（既有正确面）⇒ 与 assign 同结论
    const spread = call(
      `export function f(k) { const s = {}; s[k] = 1; return Object.keys({ z: 2, ...s }); }`,
      "f",
      [str()],
    ).result;
    expect(isPartialStringArr(spread)).toBe(true);
  });

  it("BUG-201 键集已知的源不得被误标：`Object.assign({z:2},{a:1})` 仍是 exact 键集；`Object.assign` 的源键集不完备不跨调用泄漏", () => {
    const exact = call(
      `export function f() { return Object.keys(Object.assign({ z: 2 }, { a: 1 })); }`,
      "f",
    ).result;
    expect(tupleKeys(exact)).toEqual(["z", "a"]);
    expect(exact.conf).toBe("exact");

    // 同一进程内先跑带标记的合并，再跑闭对象的合并（侧表按 Abs 身份，不串味）
    call(
      `export function f(k) { const s = {}; s[k] = 1; return Object.keys(Object.assign({}, s)); }`,
      "f",
      [str()],
    );
    const after = call(
      `export function f() { return Object.keys(Object.assign({ z: 2 }, { a: 1 })); }`,
      "f",
    ).result;
    expect(tupleKeys(after)).toEqual(["z", "a"]);
  });
});
