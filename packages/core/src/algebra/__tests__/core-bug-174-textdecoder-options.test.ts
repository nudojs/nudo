/**
 * BUG-174：`new TextDecoder(label, options?)` 的 **options 位**此前被整段
 * 丢弃（建模函数只收 label）⇒ 宿主必抛的 `TypeError: The "options"
 * argument must be of type object.` 漏判（假绿）。
 *
 * 宿主 node v26.10.0 实测口径（本文件全部钉死）：
 * - `new TextDecoder("utf-8", "extra")` / `(…, 42)` → 确定 TypeError；
 * - `(…, undefined)` / `(…, null)` / `(…, {fatal:true})` / 函数 / 数组 →
 *   合法（null ≡ 空字典）；
 * - label ToString 先于 options 字典转换：
 *   `new TextDecoder(Symbol(), 42)` → Symbol 的 TypeError（不是 options 的）；
 * - 抽象 prim options 恒非对象 → 确定 TypeError；any/含对象臂的 union → may。
 */
import { describe, it, expect } from "vitest";
import { abs } from "../abs.ts";
import { call, isNever, throwsError } from "./eval-helpers.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");
const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "path");
const sumPrim = abs(
  {
    k: "sum",
    members: [
      abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
      abs({ k: "prim", type: "number" }, undefined, undefined, "path"),
    ],
  },
  undefined,
  undefined,
  "path",
);
const sumMixed = abs(
  {
    k: "sum",
    members: [
      abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
      abs({ k: "obj", slots: {} }, undefined, undefined, "path"),
    ],
  },
  undefined,
  undefined,
  "path",
);

/** 带 may-throw 采集的调用（may 效果进 effects；definite 抛进 result/throws） */
function evalWithOptions(optionsAbs: (typeof anyAbs) | undefined): {
  result: unknown;
  throws: unknown;
  effects: string[];
} {
  const effects: MayThrowEffect[] = [];
  let out: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      out = call(
        `export function f(o) { return new TextDecoder("utf-8", o); }`,
        "f",
        optionsAbs ? [optionsAbs] : [],
      ) as never;
    } catch {
      /* 入口整抛：throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    result: out.result,
    throws: out.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

describe("BUG-174：new TextDecoder(label, options) 的 options 位", () => {
  it("非对象字面量 options ⇒ 确定抛 TypeError（此前假绿）", () => {
    for (const src of [
      `export function f() { return new TextDecoder("utf-8", "extra"); }`,
      `export function f() { return new TextDecoder("utf-8", 42); }`,
      `export function f() { return new TextDecoder("utf-8", true); }`,
      `export function f() { return new TextDecoder("utf-8", 1n); }`,
      `export function f() { return new TextDecoder(undefined, 42); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
  });

  it("对象 / null / undefined / 函数 options ⇒ 不抛（构造成功）", () => {
    for (const src of [
      `export function f() { return new TextDecoder("utf-8", { fatal: true }); }`,
      `export function f() { return new TextDecoder("utf-8", {}); }`,
      `export function f() { return new TextDecoder("utf-8", null); }`,
      `export function f() { return new TextDecoder("utf-8", undefined); }`,
      `export function f() { return new TextDecoder("utf-8"); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(false);
      expect((r.result as { shape?: { k?: string; name?: string } }).shape?.name, src).toBe(
        "TextDecoder",
      );
      expect(isNever(r.throws), src).toBe(true);
    }
  });

  it("label ToString 先于 options 字典转换（Symbol label ⇒ Symbol 的 TypeError）", () => {
    const r = call(
      `export function f() { return new TextDecoder(Symbol("s"), 42); }`,
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("抽象 prim / 全 prim union options ⇒ 确定 TypeError", () => {
    for (const a of [numAbs, sumPrim]) {
      const r = evalWithOptions(a);
      expect(isNever(r.result)).toBe(true);
      expect(throwsError(r.throws, "TypeError")).toBe(true);
    }
  });

  it("any / 含对象臂的 union options ⇒ may TypeError（不判确定）", () => {
    for (const a of [anyAbs, sumMixed]) {
      const r = evalWithOptions(a);
      expect(isNever(r.result)).toBe(false);
      expect(r.effects).toContain("TypeError");
    }
  });

  it("对照：label 面不回退（非法字符确定 RangeError / 知名 label 成功）", () => {
    const bad = call(`export function f() { return new TextDecoder("bad-$$"); }`);
    expect(isNever(bad.result)).toBe(true);
    expect(throwsError(bad.throws, "RangeError")).toBe(true);
    const ok = call(`export function f() { return new TextDecoder("utf8"); }`);
    expect(isNever(ok.result)).toBe(false);
    expect(isNever(ok.throws)).toBe(true);
  });
});
