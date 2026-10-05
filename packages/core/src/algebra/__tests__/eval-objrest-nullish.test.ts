/**
 * Bug 32：对象 rest-only 解构（`const {...r} = X`）的接收者校验。
 *
 * 原生对象解构 = ToObject(receiver) + CopyDataProperties：null/undefined
 * 接收者在任何键读之前抛 TypeError；any 接收者 may；非 nullish prim
 * 接收者装箱后全量（node v26 实测：`const {...r} = 0` → {}，
 * `= "ab"` → {"0":"a","1":"b"}）。此前 rest-only 模式只发 $objRest 不发
 * $get，接收者从不校验 → nullish 折 unknown（+假 unknown-inference）、
 * any 折 open obj，全 throws=never。
 *
 * wave 2 残留：$concat 的迭代守卫从 lit-only 对齐共享分类器
 * （iterabilityKind/guardIterable）——`[...x]`（x:any）与 `Math.max(...x)`
 * 同记 may；闭 obj（无 @@iterator）definite；字符串/数组/元组全量不变。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  anyAbs,
  formatAbs,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";

/** 源级求值：返回 { value, throws, effects } 三面 */
function evalSrc(
  src: string,
  fnName = "f",
  args: unknown[] = [],
): { value: string; throws: string; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result ?? $lit(undefined)),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

describe("Bug 32: object-rest receiver validation", () => {
  it("nullish 字面量接收者 → definite TypeError（native: TypeError）", () => {
    expect(evalSrc(`export function f() { const {...r} = null; return r; }`).throws).toContain("TypeError");
    expect(evalSrc(`export function g() { const {...r} = undefined; return r; }`, "g").throws).toContain("TypeError");
  });

  it("any 接收者 → may TypeError，值域保持 open obj", () => {
    const r = evalSrc(`export function h(x) { const {...r} = x; return r; }`, "h", [anyAbs]);
    expect(r.effects).toContain("TypeError");
    expect(r.throws).not.toContain("TypeError");
    expect(r.value).toBe("{  }");
  });

  it("sum 含 nullish 臂 → may TypeError（守卫分支只读非空侧）", () => {
    const r = evalSrc(
      `export function s(c) { const v = c ? null : { a: 1 }; const {...r} = v; return r; }`,
      "s",
      [anyAbs],
    );
    expect(r.effects).toContain("TypeError");
  });

  it("控制：非 nullish prim 接收者原生全量（ToObject 装箱）", () => {
    for (const recv of ["0", "1", "false", '""']) {
      const r = evalSrc(`export function f() { const {...r} = ${recv}; return 1; }`);
      expect(r.throws, `const {...r} = ${recv}`).not.toContain("TypeError");
      expect(r.effects, `const {...r} = ${recv}`).not.toContain("TypeError");
    }
  });

  it("控制：对象接收者的 rest 投影不变", () => {
    expect(evalSrc(`export function f() { const {...r} = {}; return r; }`).value).toBe("{  }");
    expect(evalSrc(`export function f() { const {...r} = { a: 1, b: 2 }; return r; }`).value).toBe("{ a: 1, b: 2 }");
  });

  it("控制：键模式（$get 路径）与混合模式的既有行为不变", () => {
    expect(evalSrc(`export function f() { const {a} = null; return a; }`).throws).toContain("TypeError");
    expect(evalSrc(`export function f() { const {a, ...r} = null; return r; }`).throws).toContain("TypeError");
    expect(evalSrc(`export function f() { const {a, ...r} = { a: 1, b: 2 }; return r; }`).value).toBe("{ b: 2 }");
  });

  it("函数形参对象 rest 解构同样校验（`function f({...r})` 调用 null）", () => {
    const r = evalSrc(`export function f({...r}) { return r; }`, "f", [$lit(null)]);
    expect(r.throws).toContain("TypeError");
  });
});

describe("wave 2 residual: $concat spread guard aligns with shared classifier", () => {
  it("[...x]（x:any）→ may TypeError（与 Math.max(...x) 同口径）", () => {
    const r = evalSrc(`export function f(x) { return [...x]; }`, "f", [anyAbs]);
    expect(r.effects).toContain("TypeError");
  });

  it("[...obj-literal]（闭 obj 无 @@iterator）→ definite TypeError（native: TypeError）", () => {
    const r = evalSrc(`export function f() { return [...{ a: 1 }]; }`);
    expect(r.throws).toContain("TypeError");
  });

  it("控制：字面量行为不变（[...5] / [...null] 仍 definite）", () => {
    expect(evalSrc(`export function f() { return [...5]; }`).throws).toContain("TypeError");
    expect(evalSrc(`export function f() { return [...null]; }`).throws).toContain("TypeError");
    expect(evalSrc(`export function f() { return [...true]; }`).throws).toContain("TypeError");
  });

  it("控制：字符串 / 元组 / Set / 混合元素全量不变", () => {
    expect(evalSrc(`export function f() { return [..."ab"]; }`).value).toBe('["a", "b"]');
    expect(evalSrc(`export function f() { return [...[1, 2], 3]; }`).value).toBe("[1, 2, 3]");
    expect(evalSrc(`export function f() { const s = new Set([1, 2]); return [...s]; }`).value).toBe("[1, 2]");
    const r = evalSrc(`export function f() { return [...[1], ..."a"]; }`);
    expect(r.throws).not.toContain("TypeError");
    expect(r.value).toBe('[1, "a"]');
  });
});
