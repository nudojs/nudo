import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import type { Abs } from "@nudojs/core";
import { checkNode, nodeSlotOf } from "./env-bug-1044-1049-helpers.ts";
import { displayOf } from "./env-bug-s1-helpers.ts";

/**
 * 族 15 · BUG-125 — node env 的 `crypto.getRandomValues` 声明成
 * `(unknown[]) => unknown[]`。
 *
 * 宿主真值：**只接受整数型 TypedArray**（数组字面量 ⇒ 定抛
 * `DOMException: The data argument must be an integer-type TypedArray`），
 * 且**原样返回同一个对象**。旧声明两个方向都错：
 * - 形参是 JS Array ⇒ `crypto.getRandomValues([1,2,3])` 判绿（**假绿**）；
 * - 返回声明成「新数组」⇒ 与「同一对象」不符。
 *
 * 反向钉：把 paramTypes / apply 恢复成 `arrOf(unknown)` ⇒ 本文件必挂
 * （数组字面量重新判绿）。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Bug 125 — crypto.getRandomValues takes a TypedArray, returns it", () => {
  it("host oracle: array argument throws, TypedArray is returned by identity", () => {
    const out = host(`
      const a = new Uint8Array(4);
      const r = crypto.getRandomValues(a);
      let threw = null;
      try { crypto.getRandomValues([1, 2, 3]); } catch (e) { threw = e.constructor.name; }
      console.log(JSON.stringify({ same: r === a, threw }));
    `);
    expect(JSON.parse(out)).toEqual({ same: true, threw: "DOMException" });
  });

  it("array literal argument is rejected (was green)", () => {
    const out = checkNode(`export function fill(){ return crypto.getRandomValues([1, 2, 3]); }`);
    // 运行时必抛 ⇒ 引擎也必须判必抛（never + TypeError）
    expect(displayOf(out, "fill")).toContain("never");
    expect(out.throwBrands).toContain("TypeError");
    expect(out.errorCodes).toContain("nudo:entry-may-throw");
  });

  it("legal integer TypedArray is not a throw and keeps its identity", () => {
    const out = checkNode(`export function ok(){ return crypto.getRandomValues(new Uint8Array(16)); }`);
    expect(out.throwBrands).toEqual([]);
    expect(displayOf(out, "ok")).toBe("Uint8Array");
  });

  it("float TypedArray is rejected by the host → rejected by the env", () => {
    const thrown = host(`
      let name = null;
      try { crypto.getRandomValues(new Float32Array(4)); } catch (e) { name = e.constructor.name; }
      console.log(String(name));
    `);
    expect(thrown).toBe("DOMException");
    const out = checkNode(`export function flt(){ return crypto.getRandomValues(new Float32Array(4)); }`);
    expect(displayOf(out, "flt")).toContain("never");
  });

  it("the declared parameter domain is integer TypedArrays, never a JS Array", () => {
    const fn = nodeSlotOf("crypto", "getRandomValues");
    expect(fn?.shape.k).toBe("fn");
    const param = (fn!.shape as { paramTypes?: Abs[] }).paramTypes?.[0];
    expect(param?.shape.k, "param must be a union of TypedArray brands").toBe("sum");
    const names = (param!.shape as { members: Abs[] }).members.map(
      (m) => (m.shape as { name?: string }).name ?? "",
    );
    expect(names).not.toContain("Array");
    expect(names).toContain("Uint8Array");
    expect(names.every((n) => n.endsWith("Array"))).toBe(true);
  });
});
