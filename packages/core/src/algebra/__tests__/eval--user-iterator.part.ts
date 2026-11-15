/**
 * Bug 202 回归**钉**（不宣称新修）：用户自定义 `@@iterator` 必须被驱动。
 *
 * ── 归属说明 ─────────────────────────────────────────────────────────────
 * 本条的**根因已由族 01 的 Bug 140 顺带关闭**：`exec/runtime/containers/iterate.ts`
 * 在 `elemsOf` / `$iterCheck` 里实现了用户迭代器协议（`collectUserIterElems`：
 * GetIterator + IteratorNext，元素按**迭代序**取），并把迭代器对象登记到侧表
 * 供 IteratorClose 使用（见 Bug 199 的回归）。
 *
 * 当前 HEAD（族 01 提交 `7fea13a1` 后）**已不复现**本条症状 ⇒ 本文件只作
 * **回归钉**（防止该协议被后续改动回退），**不宣称本分片新修了 Bug 202**。
 *
 * ── 已知残留（不在 S4 可改文件内）────────────────────────────────────────
 * `Array.from(userIterable)` 仍**不驱动**用户迭代器（`builtins/array.ts` 的
 * `evalArrayFrom` 只认内建可迭代面）——需 array.ts 另修。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ES 语义：对象自带 `@@iterator` 方法 ⇒ `for-of` / spread / rest 参数 /
 * 解构都必须调用它（GetIterator + IteratorNext），元素按**迭代序**取。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

/** 用户 iterable：@@iterator 记一次调用，next 记每次调用（产 0、1） */
const USER_ITER = `let n = 0;
  const o = {
    [Symbol.iterator]() {
      n++;
      let i = 0;
      return { next() { n++; return { value: i, done: i++ >= 2 }; } };
    },
  };`;

describe("Bug 202：用户自定义 @@iterator 被驱动（回归钉，根因由族 01 Bug 140 关闭）", () => {
  it("for-of 调用 @@iterator 与 next（原生 1 + 3 = 4 次）", () => {
    expect(val(`export function f() { ${USER_ITER} for (const v of o) {} return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  });

  it("spread 调用 @@iterator 与 next", () => {
    expect(val(`export function f() { ${USER_ITER} const a = [...o]; return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  });

  it("rest 参数展开调用 @@iterator 与 next", () => {
    expect(val(`export function f() { ${USER_ITER} function g(...a) {} g(...o); return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  });

  it("混合 spread（数组 + 用户 iterable）调用 @@iterator 与 next", () => {
    expect(val(`export function f() { ${USER_ITER} const a = [0, ...o]; return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  });

  it("解构只取第 1 个元素 ⇒ 只驱动到第 1 次 next", () => {
    expect(val(`export function f() { ${USER_ITER} const [x] = o; return n; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("for-of 取到的是迭代序的值（不是索引序）", () => {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return ["x", "y"][Symbol.iterator](); } };
        const out = [];
        for (const v of o) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "x,y" });
  });

  it("负控制：内建可迭代体的 next 计数不变", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a[Symbol.iterator]();
        let n = 0;
        while (!it.next().done) n++;
        return n;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });
});

/**
 * `Array.from(userIterable)` **必须驱动用户迭代器**（GetIterator +
 * IteratorNext）——与 for-of / spread / rest / 解构同款协议。
 *
 * 修复前：`evalArrayFrom` 的 obj 臂只判「可迭代」却**不实际调**
 * `@@iterator` / `next()` ⇒ 迭代器体内的副作用（计数 / 写状态）整体丢失，
 * 元素域折 unknown（wrong-exact 的 0 / undefined）。
 */
describe("Bug 202：Array.from 驱动用户 @@iterator", () => {
  it("Array.from(o) 调用 @@iterator 与 next（原生 1 + 3 = 4 次）", () => {
    expect(val(`export function f() { ${USER_ITER} const a = Array.from(o); return n; }`)).toEqual({
      ok: true,
      value: 4,
    });
  });

  it("Array.from(o) 取到的是迭代序的元素", () => {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return ["x", "y"][Symbol.iterator](); } };
        return Array.from(o).join(",");
      }`),
    ).toEqual({ ok: true, value: "x,y" });
  });

  it("Array.from(o, mapFn) 逐位应用 mapper（下标自 0 起）", () => {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return [7, 8][Symbol.iterator](); } };
        return Array.from(o, (v, i) => v + i).join(",");
      }`),
    ).toEqual({ ok: true, value: "7,9" });
  });

  it("Array.from(o).length = 迭代出的元素数", () => {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return [7, 8][Symbol.iterator](); } };
        return Array.from(o).length;
      }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：array-like 接收者（无 @@iterator）仍走索引读路径", () => {
    expect(
      val(`export function f() { return Array.from({length: 2, 0: "a", 1: "b"}).join(","); }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("负控制：内建可迭代体不受影响（Array / Set / 字符串路径不驱动用户迭代器）", () => {
    expect(
      val(`export function f() { ${USER_ITER} Array.from([1,2]); Array.from("ab"); Array.from(new Set([1,2])); return n; }`),
    ).toEqual({ ok: true, value: 0 });
    expect(val(`export function f() { return Array.isArray(Array.from([1,2])); }`)).toEqual({
      ok: true,
      value: true,
    });
  });
});
