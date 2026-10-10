/**
 * Bug 5 / Bug 26：Object.groupBy / Map.groupBy（ES2024 array-grouping）——
 * 此前两静态均未建模：nullish/非可迭代 items 不抛、非函数回调不抛、结果
 * unknown、L2 entry-may-throw gate 静默。三面口径（node v26.10 实测 ground
 * truth，见各 describe 注释）：
 * - 校验序（V8）：items nullish（RequireObjectCoercible）→ 回调 IsCallable
 *   → items 可迭代性。`groupBy(null, null)` 报 nullish、`groupBy(1, null)`
 *   报 not-a-function。
 * - 非字符串 prim（number/boolean/bigint/symbol）items → TypeError not
 *   iterable；字符串 items 可迭代（按 code point 分组，不抛）。
 * - 字面量数组/字符串 + 可执行字面量回调 → 精确分组折叠：
 *   Object.groupBy → null 原型对象（ToPropertyKey 字符串键）；
 *   Map.groupBy → Map brand（原始键，SameValueZero 合并）。
 * - 抽象 items / 抽象回调 → recordMayThrow(TypeError)（gate 不再静默）+
 *   保守值（Object：开放 null-prototype obj；Map：含 shadow 条目的 Map）。
 */
import { describe, it, expect } from "vitest";
import { checkSource } from "../check.ts";
import { anyAbs, litValue } from "../abs.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { formatAbs } from "../format.ts";
import { $lit } from "../exec/runtime/state.ts";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../may-throw.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function check(src: string) {
  return checkSource("/t/eval-groupby.js", src);
}

function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

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

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

/** 精确 obj 槽视图：键 → 字面量元素组；任一非字面量 → undefined（精度断言） */
function objSlotGroups(r: unknown): Record<string, unknown[]> | undefined {
  const a = r as {
    shape?: { k?: string; slots?: Record<string, { value: { shape?: { elements?: unknown[] } } }> };
  };
  if (!a || typeof a !== "object" || a.shape?.k !== "obj") return undefined;
  const out: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(a.shape.slots!)) {
    const raw = v.value.shape?.elements ?? [];
    const els: unknown[] = [];
    for (const e of raw) {
      const lr = litValue(e as never);
      if (!lr.ok) return undefined; // 任一非字面量 → 精度不足
      els.push(lr.value);
    }
    out[k] = els;
  }
  return out;
}

/** 精确 tuple 字面量视图 */
function tupleLits(r: unknown): unknown[] | undefined {
  const a = r as { shape?: { k?: string; elements?: unknown[] } };
  if (!a || typeof a !== "object" || a.shape?.k !== "tuple") return undefined;
  const els = a.shape.elements!.map((e) => {
    const lr = litValue(e as never);
    return lr.ok ? lr.value : undefined;
  });
  if (els.some((e) => e === undefined)) return undefined;
  return els;
}

// --- Bug 5：Object.groupBy ---------------------------------------------------

describe("Bug 5: Object.groupBy 校验面（node 实测）", () => {
  // node v26.10：Object.groupBy(null/undefined, cb) → TypeError
  // "Object.groupBy called on null or undefined"
  it("nullish items 定抛 TypeError + catch 臂可达", () => {
    for (const src of [
      `export function f() { return Object.groupBy(null, v => v); }`,
      `export function f() { return Object.groupBy(undefined, v => v); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
    expect(
      litValue(call(`export function f() { try { Object.groupBy(null, v => v); } catch(e) { return 'caught'; } return 'missed'; }`).result),
    ).toEqual({ ok: true, value: "caught" });
  });

  // node v26.10：Object.groupBy(1/true/10n/Symbol(), cb) → TypeError not
  // iterable（字符串可迭代，另组）；groupBy([1], 5/null/undefined/{}) →
  // TypeError "… is not a function"（空数组同样先校验回调）
  it("非字符串 prim items 定抛；非可调用回调定抛", () => {
    for (const src of [
      `export function f() { return Object.groupBy(1, v => v); }`,
      `export function f() { return Object.groupBy(true, v => v); }`,
      `export function f() { return Object.groupBy(10n, v => v); }`,
      `export function f() { return Object.groupBy(Symbol(), v => v); }`,
      `export function f() { return Object.groupBy([], 5); }`,
      `export function f() { return Object.groupBy([1], null); }`,
      `export function f() { return Object.groupBy([1], undefined); }`,
      `export function f() { return Object.groupBy([1], {}); }`,
      `export function f() { return Object.groupBy(); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
    // nullish 先于 IsCallable：(null, null) 报 nullish（同为 TypeError brand）
    const both = call(`export function f() { return Object.groupBy(null, null); }`);
    expect(isNever(both.result)).toBe(true);
    expect(throwsError(both.throws, "TypeError")).toBe(true);
  });

  // node v26.10：Object.groupBy([1,2,3,4], v => v > 2 ? "big" : "small")
  // → [Object: null prototype] { small: [1,2], big: [3,4] }
  it("字面量数组 + 字面量回调折出精确分组（null 原型）", () => {
    const r = call(`export function f() { return Object.groupBy([1,2,3,4], v => v > 2 ? "big" : "small"); }`);
    expect(objSlotGroups(r.result)).toEqual({ small: [1, 2], big: [3, 4] });
    // null 原型：getPrototypeOf → null 字面量
    const proto = call(`export function f() { return Object.getPrototypeOf(Object.groupBy([1], v => "k")); }`);
    expect(litValue(proto.result)).toEqual({ ok: true, value: null });
  });

  // node v26.10：Object.groupBy("ab", v => v) → { a: ["a"], b: ["b"] }（字符串
  // 可迭代，按 code point）；Object.groupBy([], cb) → {}
  it("字符串 items 按字符分组；空数组折空对象", () => {
    expect(objSlotGroups(call(`export function f() { return Object.groupBy("ab", v => v); }`).result)).toEqual({
      a: ["a"],
      b: ["b"],
    });
    expect(objSlotGroups(call(`export function f() { return Object.groupBy([], v => v); }`).result)).toEqual({});
  });

  // node v26.10：Object.groupBy([6.1,4.2,6.3], Math.floor)
  // → { '4': [4.2], '6': [6.1,6.3] }（ToPropertyKey：数字键 → 字符串）
  it("ToPropertyKey 折叠：数字键转字符串、undefined 键转 'undefined'", () => {
    expect(
      objSlotGroups(call(`export function f() { return Object.groupBy([6.1,4.2,6.3], Math.floor); }`).result),
    ).toEqual({ "4": [4.2], "6": [6.1, 6.3] });
    expect(
      objSlotGroups(call(`export function f() { return Object.groupBy([1], () => undefined); }`).result),
    ).toEqual({ undefined: [1] });
  });

  // node v26.10：抽象 items（any 入参）→ may TypeError（ToObject + 可迭代性）
  it("抽象 items：gate 记 L2 + 运行时 effects 含 TypeError", () => {
    const r = check(`export function f(x) { return Object.groupBy(x, v => v); }`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
    const ev = evalSrc(`export function f(x) { return Object.groupBy(x, v => v); }`, "f", [anyAbs]);
    expect(ev.effects).toContain("TypeError");
  });

  it("控制组：具体合法入参 gate 静默", () => {
    const r = check(`export function g() { return Object.groupBy([1,2], v => "k"); }`);
    expect(l2Count(r, "g")).toBe(0);
  });
});

// --- Bug 26：Map.groupBy -----------------------------------------------------

describe("Bug 26: Map.groupBy 校验面（node 实测）", () => {
  // node v26.10：Map.groupBy(null/undefined, cb) → TypeError
  // "Map.groupBy called on null or undefined"
  it("nullish items 定抛 TypeError + catch 臂可达", () => {
    for (const src of [
      `export function f() { return Map.groupBy(null, v => v); }`,
      `export function f() { return Map.groupBy(undefined, v => v); }`,
      `export function f() { return Map.groupBy(1, v => v); }`,
      `export function f() { return Map.groupBy(Symbol(), v => v); }`,
      `export function f() { return Map.groupBy([], 5); }`,
      `export function f() { return Map.groupBy([1], null); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
    expect(
      litValue(call(`export function f() { try { Map.groupBy(null, v => v); } catch(e) { return e.constructor.name; } return 'no-throw'; }`).result),
    ).toEqual({ ok: true, value: "TypeError" });
  });

  // node v26.10：Map.groupBy("ab", v => v) → Map { 'a' => ['a'], 'b' => ['b'] }
  //（字符串可迭代）；Map.groupBy([1,2], v => v > 1) → Map { false => [1],
  // true => [2] }（原始键，不 ToPropertyKey）
  it("字符串 items / 字面量回调折出精确分组 Map", () => {
    expect(tupleLits(call(`export function f() { return Map.groupBy("ab", v => v).get("a"); }`).result)).toEqual(["a"]);
    expect(tupleLits(call(`export function f() { return Map.groupBy([1,2], v => v > 1).get(false); }`).result)).toEqual([1]);
    expect(tupleLits(call(`export function f() { return Map.groupBy([1,2], v => v > 1).get(true); }`).result)).toEqual([2]);
  });

  // node v26.10：Map.groupBy([6.1,4.2,6.3], Math.floor) → Map { 4 => [4.2],
  // 6 => [6.1,6.3] }（键保持 number）；size = 2
  it("原始数字键 + size 折叠", () => {
    expect(tupleLits(call(`export function f() { return Map.groupBy([6.1,4.2,6.3], Math.floor).get(6); }`).result)).toEqual([6.1, 6.3]);
    expect(litValue(call(`export function f() { return Map.groupBy([1,2], v => v > 1).size; }`).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return Map.groupBy([], v => v).size; }`).result)).toEqual({ ok: true, value: 0 });
  });

  // node v26.10：抽象 items → may TypeError（ToObject + 可迭代性）
  it("抽象 items：gate 记 L2 + 运行时 effects 含 TypeError", () => {
    const r = check(`export function f(x) { return Map.groupBy(x, v => v); }`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
    const ev = evalSrc(`export function f(x) { return Map.groupBy(x, v => v); }`, "f", [anyAbs]);
    expect(ev.effects).toContain("TypeError");
  });

  it("控制组：具体合法入参 gate 静默", () => {
    const r = check(`export function g() { return Map.groupBy([1,2], v => "k"); }`);
    expect(l2Count(r, "g")).toBe(0);
  });
});
