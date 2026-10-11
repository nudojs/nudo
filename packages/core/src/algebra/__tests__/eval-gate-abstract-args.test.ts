/**
 * Gate 假阴回归（Bug 4 / 6 / 7 / 11）——同形四案：运行时（定抛 / 折值）对，
 * 抽象实参臂漏记 recordMayThrow → L2 `nudo:entry-may-throw` 静默。
 * 三面口径：抽象实参（any 入口参）→ gate 记 TypeError（+ 运行时 effects 含
 * TypeError）；字面量 / 具体接收者控制组 → gate 静默（原生 total）或定抛
 * 对齐原生（NudoThrow → throws 面）。node v26 实测为 ground truth（各
 * describe 注释）。
 */
import { describe, it, expect } from "vitest";
import { checkSource } from "../check.ts";
import { anyAbs, litValue } from "../abs.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { formatAbs } from "../format.ts";
import { $lit } from "../exec/runtime/state.ts";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../may-throw.ts";

function check(src: string) {
  return checkSource("/t/gate-abstract-args.js", src);
}

/** L2 entry-may-throw 的 issue 数（按函数名过滤可选） */
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

// --- Bug 4：Object.hasOwn / getPrototypeOf 抽象接收者 ------------------------
// node 实测：Object.getPrototypeOf(null) / Object.hasOwn(null, "a") 抛
// TypeError（ToObject / RequireObjectCoercible）；对象接收者全定。

describe("Bug 4: Object.hasOwn/getPrototypeOf any 接收者 gate 记 may TypeError", () => {
  it("any 接收者：L2 记 + 运行时 effects 含 TypeError", () => {
    const r = check(`
      export function gp(x) { return Object.getPrototypeOf(x); }
      export function ho(x) { return Object.hasOwn(x, "a"); }
    `);
    expect(l2Count(r, "gp")).toBeGreaterThan(0);
    expect(l2Count(r, "ho")).toBeGreaterThan(0);
    expect(evalSrc(`export function f(x) { return Object.getPrototypeOf(x); }`, "f", [anyAbs]).effects).toContain("TypeError");
    expect(evalSrc(`export function f(x) { return Object.hasOwn(x, "a"); }`, "f", [anyAbs]).effects).toContain("TypeError");
  });

  it("同扫控制组：keys/values/entries 抽象接收者仍报（口径一致）", () => {
    const r = check(`
      export function k(x) { return Object.keys(x); }
      export function v(x) { return Object.values(x); }
      export function e(x) { return Object.entries(x); }
    `);
    expect(l2Count(r, "k")).toBeGreaterThan(0);
    expect(l2Count(r, "v")).toBeGreaterThan(0);
    expect(l2Count(r, "e")).toBeGreaterThan(0);
  });

  it("具体对象接收者：gate 静默、运行时全定", () => {
    const r = check(`
      export function gpOk() { return Object.getPrototypeOf({ a: 1 }); }
      export function hoOk() { return Object.hasOwn({ a: 1 }, "a"); }
    `);
    expect(l2Count(r)).toBe(0);
    const ho = evalSrc(`export function f() { return Object.hasOwn({ a: 1 }, "a"); }`);
    expect(ho.throws).toBe("never");
    const run = runTranspiled(`export function f() { return Object.hasOwn({ a: 1 }, "a"); }`, { mode: "analyze" });
    expect(litValue((callTranspiledExportFull(run, "f", []) as { result: unknown }).result as never)).toEqual({ ok: true, value: true });
    const gp = evalSrc(`export function f() { return Object.getPrototypeOf({ a: 1 }); }`);
    expect(gp.throws).toBe("never");
  });

  it("字面量 nullish 接收者定抛对齐原生（node: TypeError）", () => {
    expect(evalSrc(`export function f() { return Object.getPrototypeOf(null); }`).throws).toBe("TypeError");
    expect(evalSrc(`export function f() { return Object.getPrototypeOf(undefined); }`).throws).toBe("TypeError");
    expect(evalSrc(`export function f() { return Object.hasOwn(null, "a"); }`).throws).toBe("TypeError");
  });
});

// --- Bug 6：`k in o` 抽象键 --------------------------------------------------
// node 实测：非对象右操作数一律抛 TypeError（o = null/undefined/1/"s"）；
// 对象接收者（含抽象键）永不抛；此前抽象键在 $in 早退，漏记 any 接收者臂。

describe("Bug 6: `k in o` 抽象键 + any 接收者 gate 记 may TypeError", () => {
  it("抽象键 + any 接收者：L2 记 + 运行时 effects 含 TypeError", () => {
    const r = check(`export function f(k, o) { return k in o; }`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
    expect(evalSrc(`export function f(k, o) { return k in o; }`, "f", [anyAbs, anyAbs]).effects).toContain("TypeError");
  });

  it("控制组：字面量键 any 接收者仍报；对象接收者（抽象键）静默", () => {
    const r = check(`
      export function litKey(o) { return "a" in o; }
      export function objRecv(k) { return k in { a: 1 }; }
    `);
    expect(l2Count(r, "litKey")).toBeGreaterThan(0);
    expect(l2Count(r, "objRecv")).toBe(0);
    const rr = evalSrc(`export function f(k) { return k in { a: 1 }; }`, "f", [anyAbs]);
    expect(rr.throws).toBe("never");
    expect(rr.effects).toEqual([]);
  });

  it("字面量非对象接收者定抛对齐原生（node: 'a' in 5 / in null → TypeError）", () => {
    expect(evalSrc(`export function f() { return "a" in 5; }`).throws).toBe("TypeError");
    expect(evalSrc(`export function f() { return "a" in null; }`).throws).toBe("TypeError");
  });
});

// --- Bug 7：Symbol(x) 抽象描述符 ---------------------------------------------
// node 实测：Symbol(Symbol()) 抛 TypeError（ToString(Symbol)）；string/
// number/bigint/缺省描述符全定（Bug 23 臂）。

describe("Bug 7: Symbol(x) any 描述符 gate 记 may TypeError", () => {
  it("any 描述符：L2 记 + 运行时 effects 含 TypeError", () => {
    const r = check(`export function f(x) { return Symbol(x); }`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
    expect(evalSrc(`export function f(x) { return Symbol(x); }`, "f", [anyAbs]).effects).toContain("TypeError");
  });

  it("同扫控制组：parseInt/Number 抽象实参仍报（口径一致）", () => {
    const r = check(`
      export function pi(x) { return parseInt(x); }
      export function nu(x) { return Number(x); }
    `);
    expect(l2Count(r, "pi")).toBeGreaterThan(0);
    expect(l2Count(r, "nu")).toBeGreaterThan(0);
  });

  it("字面量 / 缺省描述符：gate 静默、运行时全定（Bug 23 控制组不受影响）", () => {
    const r = check(`
      export function s1() { return Symbol("a"); }
      export function s2() { return Symbol(); }
      export function s3() { return Symbol(1); }
    `);
    expect(l2Count(r)).toBe(0);
    for (const src of [
      `export function f() { return Symbol("a"); }`,
      `export function f() { return Symbol(); }`,
      `export function f() { return Symbol(1); }`,
    ]) {
      const rr = evalSrc(src);
      expect(rr.throws, src).toBe("never");
      expect(rr.effects, src).toEqual([]);
      expect(rr.value, src).toBe("symbol");
    }
  });

  it("prim symbol 描述符定抛对齐原生（node: TypeError）", () => {
    expect(evalSrc(`export function f() { return Symbol(Symbol()); }`).throws).toBe("TypeError");
  });
});

// --- Bug 11：String.fromCharCode(x) 抽象实参 ---------------------------------
// node 实测：String.fromCharCode(Symbol()) / (1n) 抛 TypeError（ToNumber）；
// 数值域全定（ToUint16），无 RangeError 臂——仅记 TypeError。

describe("Bug 11: String.fromCharCode(x) any 实参 gate 记 may TypeError", () => {
  it("any 实参：L2 记 + 运行时 effects 含 TypeError", () => {
    const r = check(`export function f(x) { return String.fromCharCode(x); }`);
    expect(l2Count(r, "f")).toBeGreaterThan(0);
    expect(evalSrc(`export function f(x) { return String.fromCharCode(x); }`, "f", [anyAbs]).effects).toContain("TypeError");
  });

  it("同扫控制组：fromCodePoint 抽象实参仍报（口径一致）", () => {
    const r = check(`export function g(x) { return String.fromCodePoint(x); }`);
    expect(l2Count(r, "g")).toBeGreaterThan(0);
  });

  it("字面量码点：gate 静默、折值不变", () => {
    const r = check(`export function lit() { return String.fromCharCode(65, 66); }`);
    expect(l2Count(r)).toBe(0);
    const run = runTranspiled(`export function f() { return String.fromCharCode(65, 66); }`, { mode: "analyze" });
    expect(litValue((callTranspiledExportFull(run, "f", []) as { result: unknown }).result as never)).toEqual({ ok: true, value: "AB" });
  });

  it("symbol / bigint 字面量实参定抛对齐原生（node: TypeError）", () => {
    expect(evalSrc(`export function f() { return String.fromCharCode(Symbol()); }`).throws).toBe("TypeError");
    expect(evalSrc(`export function f() { return String.fromCharCode(1n); }`).throws).toBe("TypeError");
  });
});
