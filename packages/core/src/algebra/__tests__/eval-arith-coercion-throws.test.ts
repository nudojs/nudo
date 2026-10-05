/**
 * 算术 / 强转 / 关系算子的抽象操作数 may-TypeError 回归
 * （bug-report wave 3：Bug 8 + Bug 31）。
 *
 * 不变量：原生异常不得折成 result=…, throws=never（假「保证不抛」）。
 *   Bug 8：`x + 1` 等（x:any）原生 may TypeError（x=1n 混型 / Symbol 强转；
 *   node 实测），引擎此前全部 throws=never。覆盖 add/sub/mul/div/mod、
 *   pow/位运算（foldNumericBinOp 回退）、一元 + ~ -、模板串（$add 链）。
 *   控制组：`1n + x` / `1n / x`（bigint 面 → foldBigintBinOp 已记）、
 *   `1n + 1`（字面量混型 → 硬抛）行为不变。
 *   反向（不得假报）：refined number/string/bigint prim、unknown 令牌
 *   （引擎 fail-closed，wave 1 口径：may-tier 对 any 记、对 unknown 不记）、
 *   字面量全具体运算——零效果。
 *   Bug 31：`x < 1` 等（x:any）原生 may TypeError（x=Symbol()），
 *   cmp 的 both-terms 臂与抽象回退臂都要记；bigint 关系比较合法
 *   （`1n < 2n` → true）不得报。Symbol 字面量仍硬抛（控制组）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  add,
  sub,
  mul,
  div,
  mod,
  cmp,
  powAbs,
  bitandAbs,
  bitnotAbs,
  toNumberAbs,
  negAbs,
  abs,
  num,
  str,
  numLit,
  strLit,
  bigintLit,
  formatAbs,
  $lit,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");
const unknownAbs = abs({ k: "unknown" }, undefined, undefined, "partial");

function collectEffects(fn: () => unknown): string[] {
  const effects: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      fn();
    } catch {
      /* NudoThrow 由调用边界收成 throws，不进效果列表 */
    }
    setMayThrowCollector(null);
  });
  return [...new Set(effects.map((e) => e.kind))];
}

/** 源级求值：返回 { value, throws, effects } 三面 */
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

// --- Bug 8：二元算术 / 幂 / 位运算 ----------------------------------------

describe("Bug 8: arithmetic over abstract operand records may TypeError", () => {
  it("x + 1 / x - 1 / x * 2 / x / 1 / x % 1 → may TypeError，值域不变", () => {
    const cases: Array<[string, string]> = [
      ["export function f(x) { return x + 1; }", "number | string"],
      ["export function f(x) { return x - 1; }", "number"],
      ["export function f(x) { return x * 2; }", "number"],
      ["export function f(x) { return x / 1; }", "number"],
      ["export function f(x) { return x % 1; }", "number"],
    ];
    for (const [src, value] of cases) {
      const r = evalSrc(src);
      expect(r.effects, src).toContain("TypeError");
      expect(r.value, src).toBe(value);
    }
  });

  it("x ** 2 / x & 1 / x | 1 / x ^ 1 / x << 1 / x >> 1 / x >>> 1 → may TypeError", () => {
    const ops = ["**", "&", "|", "^", "<<", ">>", ">>>"];
    for (const op of ops) {
      const r = evalSrc(`export function f(x) { return x ${op} 1; }`);
      expect(r.effects, op).toContain("TypeError");
    }
  });

  it("+x / ~x / -x → may TypeError，值域不变", () => {
    for (const u of ["+", "~", "-"]) {
      const r = evalSrc(`export function f(x) { return ${u}x; }`);
      expect(r.effects, u).toContain("TypeError");
    }
    expect(evalSrc(`export function f(x) { return +x; }`).value).toBe("unknown");
    expect(evalSrc(`export function f(x) { return ~x; }`).value).toBe("unknown");
    expect(evalSrc(`export function f(x) { return -x; }`).value).toBe("unknown");
  });

  it("模板串 `${x}`（$add 链）与 `\"a\" + x` → may TypeError（Symbol 维度），值域 string", () => {
    const t = evalSrc("export function f(x) { return `${x}`; }");
    expect(t.effects).toContain("TypeError");
    expect(t.value).toBe("string");
    const c = evalSrc(`export function f(x) { return "a" + x; }`);
    expect(c.effects).toContain("TypeError");
    expect(c.value).toBe("string");
  });

  it("控制组：1n + x / 1n / x 仍记（foldBigintBinOp），1n + 1 仍硬抛", () => {
    const c1 = evalSrc("export function f(x) { return 1n + x; }");
    expect(c1.effects).toContain("TypeError");
    expect(c1.value).toBe("bigint | string");
    const c2 = evalSrc("export function f(x) { return 1n / x; }");
    expect(c2.effects).toContain("TypeError");
    // 字面量混型 → 硬抛（throws 面，非效果通道）
    const c3 = evalSrc("export function f() { return 1n + 1; }", "f", []);
    expect(c3.throws).toContain("TypeError");
  });

  it("obj 抽象面（valueOf 可产 bigint/Symbol）→ may TypeError；具体 obj 字面量不报", () => {
    const objAbs = abs({ k: "obj", slots: {} }, undefined, undefined, "path");
    expect(collectEffects(() => add(objAbs, numLit(1)))).toContain("TypeError");
    expect(collectEffects(() => cmp("lt", objAbs, numLit(1)))).toContain("TypeError");
    // 源级：具体对象成员算术折叠，无假报
    const r = evalSrc(`export function f() { const o = { a: 1 }; return o.a + 1; }`, "f", []);
    expect(r.effects).not.toContain("TypeError");
    expect(r.value).toBe("2");
  });
});

// --- Bug 8 反向：不得假报 --------------------------------------------------

describe("Bug 8 precision: total operands record nothing", () => {
  it("prim number/string/bigbit 操作数（refined 参数面）零效果", () => {
    const n = num();
    const s = str();
    const one = numLit(1);
    expect(collectEffects(() => add(n, one))).toEqual([]);
    expect(collectEffects(() => sub(n, one))).toEqual([]);
    expect(collectEffects(() => mul(n, one))).toEqual([]);
    expect(collectEffects(() => div(n, one))).toEqual([]);
    expect(collectEffects(() => mod(n, one))).toEqual([]);
    expect(collectEffects(() => powAbs(n, one))).toEqual([]);
    expect(collectEffects(() => bitandAbs(n, one))).toEqual([]);
    expect(collectEffects(() => toNumberAbs(n))).toEqual([]);
    expect(collectEffects(() => negAbs(n))).toEqual([]);
    expect(collectEffects(() => bitnotAbs(n))).toEqual([]);
    expect(collectEffects(() => add(s, strLit("t")))).toEqual([]);
    expect(collectEffects(() => cmp("lt", n, one))).toEqual([]);
    expect(collectEffects(() => cmp("lt", s, strLit("z")))).toEqual([]);
  });

  it("bigint prim 关系比较合法（1n < 2 → true 面无效果）；bigint 一元 +/- 合法", () => {
    const big = bigintLit(1n);
    expect(collectEffects(() => cmp("lt", big, numLit(2)))).toEqual([]);
    expect(litOf(cmp("lt", bigintLit(1n), bigintLit(2n)))).toBe(true);
    expect(collectEffects(() => negAbs(big))).toEqual([]);
  });

  it("unknown 令牌（引擎 fail-closed）不记——wave 1 口径", () => {
    expect(collectEffects(() => add(unknownAbs, numLit(1)))).toEqual([]);
    expect(collectEffects(() => sub(unknownAbs, numLit(1)))).toEqual([]);
    expect(collectEffects(() => cmp("lt", unknownAbs, numLit(1)))).toEqual([]);
    expect(collectEffects(() => toNumberAbs(unknownAbs))).toEqual([]);
    expect(collectEffects(() => powAbs(unknownAbs, numLit(2)))).toEqual([]);
  });

  it("字面量全具体运算零效果（值域精确）", () => {
    const r = evalSrc(`export function f() { return 1 + 2; }`, "f", []);
    expect(r.effects).toEqual([]);
    expect(r.value).toBe("3");
    const t = evalSrc("export function f() { return `a${1}c`; }", "f", []);
    expect(t.effects).toEqual([]);
    expect(t.value).toBe('"a1c"');
  });
});

// --- Bug 31：关系算子 -------------------------------------------------------

describe("Bug 31: relational over abstract operand records may TypeError", () => {
  it("x < / <= / > / >= 1（两侧任一 any 位）→ may TypeError，值域 boolean", () => {
    const cases = [
      "export function f(x) { return x < 1; }",
      "export function f(x) { return x <= 1; }",
      "export function f(x) { return x > 1; }",
      "export function f(x) { return x >= 1; }",
      `export function f(x) { return x < "s"; }`,
      "export function f(x) { return 1 < x; }",
      "export function f(x) { return x < 1n; }",
      `export function f(x) { return "a" < x; }`,
    ];
    for (const src of cases) {
      const r = evalSrc(src);
      expect(r.effects, src).toContain("TypeError");
      expect(r.value, src).toBe("boolean");
    }
  });

  it("内核层：cmp 四算子 × any 两侧 → TypeError 效果", () => {
    for (const op of ["lt", "le", "gt", "ge"] as const) {
      expect(collectEffects(() => cmp(op, anyAbs, numLit(1))), op).toContain("TypeError");
      expect(collectEffects(() => cmp(op, numLit(1), anyAbs)), op).toContain("TypeError");
    }
  });

  it("控制组：Symbol() < 1 硬抛；1n < 2n → true；1 < 2 → true（零效果）", () => {
    const s = evalSrc("export function f() { return Symbol() < 1; }", "f", []);
    expect(s.throws).toContain("TypeError");
    const g2 = evalSrc("export function f() { return 1n < 2n; }", "f", []);
    expect(g2.effects).toEqual([]);
    expect(g2.value).toBe("true");
    const g3 = evalSrc("export function f() { return 1 < 2; }", "f", []);
    expect(g3.effects).toEqual([]);
    expect(g3.value).toBe("true");
  });

  it("eq/ne 不记（=== 对任何值合法）", () => {
    expect(collectEffects(() => cmp("eq", anyAbs, numLit(1)))).toEqual([]);
    expect(collectEffects(() => cmp("ne", anyAbs, numLit(1)))).toEqual([]);
    const r = evalSrc("export function f(x) { return x === 1; }");
    expect(r.effects).toEqual([]);
  });
});

function litOf(a: unknown): unknown {
  const r = a as { term?: { op: string; value?: unknown } };
  return r?.term?.op === "lit" ? r.term.value : undefined;
}
