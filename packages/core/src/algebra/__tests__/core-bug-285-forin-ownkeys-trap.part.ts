/**
 * Bug 285：Proxy 的 `for…in` **完全无视 `ownKeys` 陷阱** ⇒ 枚举出**靶对象**的
 * 自有可枚举键（精确错值：原生 "" 而引擎 "ac"）。
 *
 * 修复（packages/core/src/algebra/exec/runtime/containers/iterate.ts）：
 * `$forInKeys` 加 Proxy 臂 → `proxyForInKeys`：
 * 1. [[OwnPropertyKeys]] → ownKeys 陷阱（proxyOwnKeysTrapKeys：单一实现，含
 *    规范不变量校验——重复名 / 非字符串键 / 漏靶的不可配置自有键 ⇒ TypeError）；
 * 2. 每个键按 [[GetOwnProperty]] 判**可枚举性**（gOPD 陷阱优先，否则靶的自有
 *    描述符）——不可枚举 / 靶上不存在 ⇒ 不进结果；
 * 3. 键序 = 陷阱结果的顺序（原生 for-in 不重排整数键）。
 *
 * 已知保守偏差（**不钉**，待 descriptor.ts 的 gOPD 派发面区分「陷阱返回
 * undefined」与「形态不可判」后再收口）：gOPD 陷阱返回 undefined ⇒ 原生
 * 「该属性不存在」⇒ for…in 精确空；引擎侧 proxyGetOwnPropDescTrap 把
 * undefined 与 opaque 合并 ⇒ 键面降级为抽象字符串键（0..N 次，保守方向）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 285: for…in 走 Proxy 的 ownKeys 陷阱", () => {
  it("陷阱返回不在靶上的键 → 0 次（此前枚举靶的 2 个键）", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["b"]; } });
        let n = 0; for (const k in p) n = n + 1;
        return String(n);
      }`),
    ).toEqual({ ok: true, value: "0" });
  });

  it("陷阱返回不在靶上的键 → 键序列为空（此前 \"ac\"）", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["b"]; } });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("陷阱部分命中 → 只枚举可枚举的命中键", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["a", "z"]; } });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "a" });
  });

  it("陷阱全命中 → 键序按陷阱结果（原生不重排整数键）", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["c", "a"]; } });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "ca" });
  });

  it("无 ownKeys 陷阱 → 落靶语义（控制组）", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, {});
        let n = 0; for (const k in p) n = n + 1;
        return String(n);
      }`),
    ).toEqual({ ok: true, value: "2" });
  });

  it("陷阱返回重复键 → 原生抛 TypeError（规范不变量）", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["b", "b"]; } });
        let n = 0; try { for (const k in p) n = n + 1; return "n=" + n; }
        catch (e) { return "threw:" + e.name + "|" + n; }
      }`),
    ).toEqual({ ok: true, value: "threw:TypeError|0" });
  });

  it("陷阱漏掉靶的不可配置自有键 → 原生抛 TypeError（规范不变量）", () => {
    expect(
      v(`export function f() {
        const t = {};
        Object.defineProperty(t, "a", { value: 1, enumerable: true, configurable: false, writable: true });
        const p = new Proxy(t, { ownKeys() { return []; } });
        let n = 0; try { for (const k in p) n = n + 1; return "n=" + n; }
        catch (e) { return "threw:" + e.name + "|" + n; }
      }`),
    ).toEqual({ ok: true, value: "threw:TypeError|0" });
  });

  it("陷阱副作用保留（此前陷阱从未被调用）", () => {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { log.push("ok"); return ["b"]; } });
        let n = 0; for (const k in p) n = n + 1;
        return log.join(",") + "|n=" + n;
      }`),
    ).toEqual({ ok: true, value: "ok|n=0" });
  });

  it("控制组：普通对象的 for…in 不受影响", () => {
    expect(
      v(`export function f() {
        const o = { a: 1, c: 3 };
        let s = ""; for (const k in o) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "ac" });
  });

  it("gOPD 陷阱把键报成不可枚举 → 不进 for…in", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, {
          ownKeys() { return ["a", "c"]; },
          getOwnPropertyDescriptor(t, k) { return { value: 1, enumerable: false, configurable: true }; },
        });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("gOPD 陷阱把靶上没有的键报成可枚举 → 进 for…in", () => {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, {
          ownKeys() { return ["a", "b"]; },
          getOwnPropertyDescriptor(t, k) { return { value: 1, enumerable: true, configurable: true }; },
        });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("陷阱返回重复键 → throws 面是 TypeError（此前静默枚举靶的键）", () => {
    const r = call(
      `export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["b", "b"]; } });
        let n = 0; for (const k in p) n = n + 1;
        return n;
      }`,
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});
