/**
 * Bug 82 回归：sloppy 源（`type: commonjs` / `.cjs`）的不可变写入与隐式
 * 全局赋值按 **sloppy** 语义（静默失败 / 建全局），不得按 strict 判确定
 * TypeError / ReferenceError。引擎既已按 sloppy 建模 Annex B 提升，写门
 * 必须同源（run.ts 算出的 sourceStrict 现在进入 Abs 层写门）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

const CJS = [
  `function readonlyWrite() { const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false }); o.x = 2; return o.x; }`,
  `function getterOnlyWrite() { const o = { get x() { return 7; } }; o.x = 9; return o.x; }`,
  `function nonExtensibleNewKey() { const o = Object.preventExtensions({ a: 1 }); o.b = 2; return Object.keys(o).length; }`,
  `function implicitGlobal() { leaked = 1; return 1; }`,
  `module.exports = { readonlyWrite, getterOnlyWrite, nonExtensibleNewKey, implicitGlobal };`,
].join("\n");

describe("Bug 82 — sloppy 源的写入语义", () => {
  for (const [fn, expected] of [
    ["readonlyWrite", 1],
    ["getterOnlyWrite", 7],
    ["nonExtensibleNewKey", 1],
    ["implicitGlobal", 1],
  ] as const) {
    it(`${fn} 恒 total 且值与原生一致（改前 never throws）`, () => {
      const r = call(CJS, fn);
      expect(litValue(r.result), fn).toEqual({ ok: true, value: expected });
      expect(isNever(r.result), fn).toBe(false);
    });
  }

  it("负控制：ESM（strict）下 frozen / readonly 写仍确定抛 TypeError", () => {
    for (const src of [
      `export function f() { const o = Object.freeze({a:1}); o.a = 2; return o.a; }`,
      `export function f() { const o = {}; Object.defineProperty(o,"x",{value:1,writable:false}); o.x=2; return o.x; }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result)).toBe(true);
      expect(throwsError(r.throws, "TypeError")).toBe(true);
    }
  });

  it("负控制：ESM 下隐式全局赋值仍确定抛 ReferenceError", () => {
    const r = call(`export function f() { leaked2 = 1; return 1; }`);
    expect(isNever(r.result)).toBe(true);
  });
});
