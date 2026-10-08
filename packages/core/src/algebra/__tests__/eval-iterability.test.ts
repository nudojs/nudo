/**
 * 迭代族 throws/值域回归（wave 2 — Bugs 6/7/13/68）：
 * - Bug 6：$elems 可迭代性守卫（for-of / call·new spread 实参）
 * - Bug 7：数组解构（ArrayPattern）接收者的 GetIterator 校验
 * - Bug 13：for await 的 await 标志（异步可迭代性 + 仅异步可迭代接收者不折同步投影）
 * - Bug 68：for-in 抽象接收者的键域（unknown ≠ 空键集，体至少跑一次）
 *
 * 原生 ground truth：node v26（TypeError 与迭代次数均以原生为准）。
 * 断言三面：value（值域）/ throws（NudoThrow 边界收成面）/ effects（recordMayThrow 软效果）。
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

/** 源级求值：返回 { value, throws, effects } 三面（conf 标注剥离） */
function evalSrc(
  src: string,
  fnName = "f",
  args: unknown[] = [anyAbs],
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

// --- Bug 6：$elems 可迭代性守卫（for-of / spread 实参） ---------------------

describe("Bug 6: $elems iterability guard (for-of / spread args)", () => {
  it("for-of over prim-literal receivers → definite TypeError (native: TypeError)", () => {
    for (const recv of ["1", "null", "true", "undefined"]) {
      const r = evalSrc(
        `export function f() { for (const v of ${recv}) {} return 1; }`,
        "f",
        [],
      );
      expect(r.throws, `for (const v of ${recv})`).toContain("TypeError");
    }
  });

  it("Math.max(...null) → definite TypeError", () => {
    const r = evalSrc(`export function f() { return Math.max(...null); }`, "f", []);
    expect(r.throws).toContain("TypeError");
  });

  it("for-of / new-spread over any receiver → may TypeError（值域不变）", () => {
    const rf = evalSrc(`export function f(x) { for (const v of x) {} return 1; }`);
    expect(rf.effects).toContain("TypeError");
    const rg = evalSrc(`export function g(x) { return new Array(...x); }`, "g");
    expect(rg.effects).toContain("TypeError");
  });

  it("controls: strings / arrays / Sets / Maps / generators stay total", () => {
    expect(evalSrc(`export function a() { let s = 0; for (const c of "ab") { s += 1; } return s; }`, "a", []).value).toBe("2");
    expect(evalSrc(`export function b() { let s = 0; for (const v of [1, 2]) { s += v; } return s; }`, "b", []).value).toBe("3");
    expect(evalSrc(`export function c() { const st = new Set([1, 2]); let s = 0; for (const v of st) { s += v; } return s; }`, "c", []).value).toBe("3");
    expect(evalSrc(`export function d() { const m = new Map([["a", 1], ["b", 2]]); let s = 0; for (const e of m) { s += e[1]; } return s; }`, "d", []).value).toBe("3");
    expect(evalSrc(`export function e() { function* G() { yield 1; yield 2; } let s = 0; for (const v of G()) { s += v; } return s; }`, "e", []).value).toBe("3");
  });
});

// --- Bug 7：数组解构 GetIterator 校验 ---------------------------------------

describe("Bug 7: array destructuring GetIterator validation", () => {
  it("const [x] = 1 / null / {} 与 const [...r] = null → definite TypeError", () => {
    for (const init of ["1", "null", "{}"]) {
      const r = evalSrc(`export function f() { const [x] = ${init}; return x; }`, "f", []);
      expect(r.throws, `const [x] = ${init}`).toContain("TypeError");
    }
    const rr = evalSrc(`export function f() { const [...r] = null; return r; }`, "f", []);
    expect(rr.throws).toContain("TypeError");
  });

  it("const [y] = x（any）→ may TypeError，值域保持 any 面", () => {
    const r = evalSrc(`export function f(x) { const [y] = x; return y; }`);
    expect(r.effects).toContain("TypeError");
    expect(r.value).toContain("any");
  });

  it("参数解构（g([a])）收到非可迭代实参 → TypeError", () => {
    const run = runTranspiled(`export function g([a]) { return a; }`, { mode: "analyze" });
    const r = callTranspiledExportFull(run, "g", [$lit(1)]);
    expect(formatAbs(r.throws as never)).toContain("TypeError");
  });

  it("controls: const [x] = 'ab' → 'a' 全量；嵌套模式不回归", () => {
    expect(evalSrc(`export function f() { const [x] = "ab"; return x; }`, "f", []).value).toBe('"a"');
    expect(evalSrc(`export function g() { const [a, b] = [1, 2]; return a + b; }`, "g", []).value).toBe("3");
    expect(evalSrc(`export function h() { const [[a], b] = [[1], 2]; return a + b; }`, "h", []).value).toBe("3");
  });
});

// --- Bug 13：for await 的 await 标志 ----------------------------------------

describe("Bug 13: for await honors the await flag", () => {
  it("for await (const v of 1) → definite TypeError（native: 1 is not async iterable）", () => {
    const r = evalSrc(
      `export async function f() { for await (const v of 1) {} return 1; }`,
      "f",
      [],
    );
    expect(r.throws).toContain("TypeError");
  });

  it("for await (const v of x)（any）→ may TypeError，promise 值域保留", () => {
    const r = evalSrc(
      `export async function f(x) { for await (const v of x) {} return 1; }`,
    );
    expect(r.effects).toContain("TypeError");
    expect(r.value).toContain("promise");
  });

  it("仅异步可迭代接收者（只有 @@asyncIterator 槽）全量；体由抽象元素驱动", () => {
    const r = evalSrc(
      `export async function f() {
         const ai = {};
         ai[Symbol.asyncIterator] = function () {};
         let s = 0;
         for await (const v of ai) { s += v; }
         return s;
       }`,
      "f",
      [],
    );
    expect(r.throws).toBe("never");
    expect(r.value).toContain("promise");
    // 值域：迭代产出是抽象元素，不是接收者槽位（不折 @@asyncIterator 函数面）
    expect(r.value).not.toContain("fn");
  });

  it("control: for await over array 全量且精确（同步迭代器回退）", () => {
    const r = evalSrc(
      `export async function f() { let s = 0; for await (const v of [1, 2]) { s += v; } return s; }`,
      "f",
      [],
    );
    expect(r.throws).toBe("never");
    expect(r.value).toContain("promise<3>");
  });

  it("同步 for-of over 仅异步可迭代接收者仍抛（async ≠ sync iterable）", () => {
    const r = evalSrc(
      `export function f() {
         const ai = {};
         ai[Symbol.asyncIterator] = function () {};
         for (const v of ai) {}
         return 1;
       }`,
      "f",
      [],
    );
    expect(r.throws).toContain("TypeError");
  });
});

// --- Bug 68：for-in 抽象接收者键域 ------------------------------------------

describe("Bug 68: for-in abstract receiver key domain", () => {
  it("for-in over any：体至少跑一次，计数器无上界域（不再假精确 0）", () => {
    const r = evalSrc(
      `export function f(x) { let s = 0; for (const k in x) { s += 1; } return s; }`,
    );
    // Bug 47 宽化：抽象键序列单代表迭代 + 增长计数器 → 无上界 number
    //（native x 可有任意多键；体不跑则折精确 0——not "0" 仍守住该回归面）
    expect(r.value).toContain("number");
    expect(r.value).not.toBe("0");
  });

  it("体内 throw 经循环记录（may throw Error）", () => {
    const r = evalSrc(
      `export function f(x) { for (const k in x) { throw new Error(k); } return 1; }`,
    );
    expect(r.throws).toContain("Error");
  });

  it("抽象臂的键是字符串域", () => {
    const r = evalSrc(
      `export function f(x) { let t = "none"; for (const k in x) { t = typeof k; } return t; }`,
    );
    // Bug 47 宽化：t 从 "none" 增长到 "string" 后宽化到无上界 string 域
    //（仍证明键是 string——不是 number/unknown）
    expect(r.value.startsWith("string")).toBe(true);
  });

  it("nullish / number 字面量接收者：零迭代，精确 0（for-in 头部全量）", () => {
    expect(evalSrc(`export function p() { let s = 0; for (const k in null) { s += 1; } return s; }`, "p", []).value).toBe("0");
    expect(evalSrc(`export function q() { let s = 0; for (const k in 5) { s += 1; } return s; }`, "q", []).value).toBe("0");
  });

  it("controls: 具体对象 / 字符串接收者保持精确", () => {
    expect(evalSrc(`export function w() { let s = 0; for (const k in { a: 1, b: 2 }) { s += 1; } return s; }`, "w", []).value).toBe("2");
    expect(evalSrc(`export function st() { let s = 0; for (const k in "abc") { s += 1; } return s; }`, "st", []).value).toBe("3");
  });
});
