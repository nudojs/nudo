/**
 * DEC-006 B+C 回归：形参/回调绑 JS undefined + helper 未防 undefined 入参。
 *
 * 聚类 B（绑定层保证 Abs）：
 * - K1b rest 形参包 $arr（arrow/fn expression）
 * - K4 map/filter/forEach 等回调第 3 参 = 源数组
 * - K5 调用点 spread 展开（$elems），形参不再绑 JS undefined
 *
 * 聚类 C（helper fail-closed）：
 * - K1a typeofAbs / $len / $set / $idx / litValue 对 undefined/宿主值不抛宿主 TypeError
 * - globalThis.__x = … 不得重绑 globalThis（宿主状态污染）
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  setEvalFallbackCollector,
  litValue,
  type EvalFallback,
} from "@nudojs/core";
import { formatAbs } from "../format.ts";
import { typeofAbs } from "../surface.ts";
import { $len, $set, $idx } from "../exec/runtime/containers.ts";
import { numLit, strLit, unknown, abs } from "../abs.ts";

function runBody(body: string): { result: string; fallbacks: EvalFallback[] } {
  const fallbacks: EvalFallback[] = [];
  setEvalFallbackCollector((f) => fallbacks.push(f));
  try {
    const exports = runTranspiled(`export function __run() {\n${body}\n}`, {
      mode: "exec",
      maxLoopIters: 2000,
    });
    const r = callTranspiledExportFull(exports, "__run", []);
    return { result: formatAbs(r.result), fallbacks };
  } finally {
    setEvalFallbackCollector(null);
  }
}

describe("B: binding layer produces Abs (no JS undefined leaks)", () => {
  it("K1b rest param in arrow is Abs ($arr wrapped)", () => {
    for (const body of [
      `const f=(...rest)=>rest.length; return f(1,2,3)`,
      `const f=(...rest)=>rest.length; return f()`,
      `const f=(...r)=>r.length; return f(1,2)`,
      `return ((...xs) => xs.length)(1, 2, 3)`,
    ]) {
      const { result, fallbacks } = runBody(body);
      expect(fallbacks.filter((f) => f.reason === "internal"), body).toEqual([]);
      // length 应是具体数字，不是 unknown
      expect(result, body).toMatch(/\d/);
    }
  });

  it("K4 map callback receives source array as 3rd arg", () => {
    const { result, fallbacks } = runBody(
      `return [1,2,3].map((x,i,arr)=>arr.length).join(',')`,
    );
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
    // 不炸即过：回调第 3 参是 Abs（arr.length 不再读 undefined.shape）
    // join 结果可能是 partial string（回调链不折具体值），只要有结果即可
    expect(result).toContain("string");
  });

  it("K5 spread args fill params (no JS undefined operands)", () => {
    const { result, fallbacks } = runBody(
      `function f(a,b,c){return a+','+b+','+c} return f(...[1,2,3])`,
    );
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
    // 1,2,3 全部绑上
    expect(result).toContain("1");
    expect(result).toContain("2");
    expect(result).toContain("3");
  });

  it("spread in method/new calls does not crash", () => {
    for (const body of [
      `return Math.max(...[1,2,3])`,
      `const a=[1,2]; return [...a, 3].length`,
    ]) {
      const { fallbacks } = runBody(body);
      expect(fallbacks.filter((f) => f.reason === "internal"), body).toEqual([]);
    }
  });
});

describe("C: helpers fail-closed on undefined / host values", () => {
  it("K1a typeofAbs on host globals / undefined does not throw", () => {
    for (const body of [
      `return typeof process`,
      `return typeof console`,
      `return typeof setTimeout`,
      `return typeof Promise`,
      `return typeof Map`,
      `return typeof JSON`,
      `return typeof Math`,
      `return typeof Object`,
      `return typeof parseInt`,
    ]) {
      const { result, fallbacks } = runBody(body);
      expect(fallbacks.filter((f) => f.reason === "internal"), body).toEqual([]);
      // typeof 结果永远是 string（具体或 partial）
      expect(result, body).toContain("string");
    }
  });

  it("typeofAbs unit: undefined / host object → partial string", () => {
    // undefined 入参
    const r1 = typeofAbs(undefined as never);
    expect(formatAbs(r1)).toContain("string");
    // 宿主对象（无 shape）
    const r2 = typeofAbs({} as never);
    expect(formatAbs(r2)).toContain("string");
  });

  it("$len / $idx / $set on undefined or host values fail-closed", () => {
    // $len(undefined) → unknown，不抛
    const l = $len(undefined as never);
    expect(l.shape.k).toBe("unknown");
    // $idx(undefined, …) → unknown
    const i = $idx(undefined as never, numLit(0));
    expect(i.shape.k).toBe("unknown");
    // $set(hostObj, …) → 返回原接收者（调用点重绑为 no-op），不抛
    const host = globalThis as never;
    const s = $set(host, "x", numLit(1));
    expect(s).toBe(host);
  });

  it("litValue on undefined returns undefined (no host TypeError)", () => {
    expect(litValue(undefined as never)).toBeUndefined();
    expect(litValue(null as never)).toBeUndefined();
  });

  it("globalThis.__x = … does not corrupt host globalThis", () => {
    const before = globalThis;
    const { fallbacks } = runBody(
      `globalThis.__acc = 1; return globalThis.__acc`,
    );
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
    // globalThis 未被重绑成 Abs
    expect(globalThis).toBe(before);
    // 清理测试副作用
    delete (globalThis as Record<string, unknown>)["__acc"];
    delete (globalThis as Record<string, unknown>)["__f"];
  });

  it("forEach/finally globalThis writes stay internal-free", () => {
    for (const body of [
      `return [1,2,3].forEach((x,i) => { globalThis.__acc = (globalThis.__acc||0) + x + i; })`,
      `function f() { try { return 1; } finally { globalThis.__f = 5; } } f(); return globalThis.__f`,
    ]) {
      const { fallbacks } = runBody(body);
      expect(fallbacks.filter((f) => f.reason === "internal"), body).toEqual([]);
    }
    delete (globalThis as Record<string, unknown>)["__acc"];
    delete (globalThis as Record<string, unknown>)["__f"];
  });
});

describe("zero-internal invariant on DEC-006 B+C corpus shapes", () => {
  it("representative shapes produce zero internal fallbacks", () => {
    const bodies = [
      // K1b
      `const f=(...rest)=>rest.length; return f(1,2,3)`,
      `const f=(...rest)=>rest.length; return f()`,
      // K1a
      `return typeof process`,
      `return typeof Map`,
      `return typeof f; function f(){}`,
      // K4
      `return [1,2,3].map((x,i,arr)=>arr.length).join(',')`,
      // K5
      `function f(a,b,c){return a+','+b+','+c} return f(...[1,2,3])`,
      // $set host
      `return [1,2,3].forEach((x,i) => { globalThis.__acc = (globalThis.__acc||0) + x + i; })`,
    ];
    const all: EvalFallback[] = [];
    for (const body of bodies) {
      const { fallbacks } = runBody(body);
      all.push(...fallbacks.filter((f) => f.reason === "internal"));
    }
    expect(all).toEqual([]);
  });
});
