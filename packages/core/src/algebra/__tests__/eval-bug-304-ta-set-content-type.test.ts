/**
 * Bug 304 回归：%TypedArray%.prototype.set 缺「源/目标**内容类型**（number vs
 * bigint）一致」校验。
 *
 * 原生（node v26 实测）：
 *   new Uint8Array(2).set(new BigInt64Array(1))     → TypeError
 *     （Cannot mix BigInt and other types, use explicit conversions）
 *   new BigInt64Array(2).set(new Uint8Array(1))     → TypeError
 * 规范约束的是**内容类型**（[[ContentType]] number/bigint）而**不是家族名**：
 *   new Uint8Array(2).set(new Int8Array(1))         → 合法（不抛）
 *   new BigInt64Array(2).set(new BigUint64Array(1)) → 合法（不抛）
 * 引擎此前从不比较源与目标的 brand ⇒ 跨内容类型 set 一律 no-throw（假 no-throw），
 * 门禁恒绿、L2 may-throw 记账缺失。
 *
 * 修法：dispatch.ts set 分支在源带 [[TypedArrayName]] 槽时比对 [[ContentType]]
 * （taContentTypeOf），不一致即定抛 TypeError（原生报错序：越界 RangeError
 * 先于内容类型 TypeError——越界不可判时只记 may）。
 */
import { describe, it, expect } from "vitest";
import { call, val, effects } from "./eval-helpers.ts";
import { l2Count } from "./nudo-constraints.ts";
import { checkSource } from "../check.ts";

/** 原生：定抛（try/catch 吸收后返回 "caught"） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛：无 try/catch 时 throws 面是相应 Error brand */
function expectThrows(src: string, name: string) {
  const r = call(src);
  const got = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(got, `throws ${name} for: ${src}`).toBe(name);
}

function check(src: string) {
  return checkSource("/t/eval-bug-304.js", src);
}

// ---------------------------------------------------------------------------
// 改前会失败的形态：跨内容类型 set → definite TypeError
// ---------------------------------------------------------------------------

describe("Bug 304：TA set 跨内容类型 → definite TypeError", () => {
  it.each([
    ["number 目标 ← bigint 源", `const ta = new Uint8Array(2); ta.set(new BigInt64Array(1)); return "no-throw";`],
    ["bigint 目标 ← number 源", `const ta = new BigInt64Array(2); ta.set(new Uint8Array(1)); return "no-throw";`],
    ["number 目标 ← BigUint64 源", `const ta = new Int32Array(2); ta.set(new BigUint64Array(1)); return "no-throw";`],
    ["bigint 目标 ← Float64 源", `const ta = new BigUint64Array(2); ta.set(new Float64Array(1)); return "no-throw";`],
    ["number 目标 ← bigint 源（带 offset）", `const ta = new Uint8Array(4); ta.set(new BigInt64Array(1), 1); return "no-throw";`],
  ])("%s → TypeError", (_name, body) => {
    expectThrows(`export function f() { ${body} }`, "TypeError");
    expectCaught(`export function f() { try { ${body}; return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("跨内容类型 set 进 throws 域（此前 throws=never 假 total）", () => {
    const r = call(`export function f() { const ta = new Uint8Array(2); ta.set(new BigInt64Array(1)); return "no-throw"; }`);
    expect(r.result.shape.k).toBe("never");
  });
});

// ---------------------------------------------------------------------------
// 负控制：同内容类型跨家族合法（规范约束内容类型而非家族名）
// ---------------------------------------------------------------------------

describe("Bug 304 负控制：同内容类型跨家族 set 合法", () => {
  it.each([
    ["Uint8 ← Int8", `const ta = new Uint8Array(2); ta.set(new Int8Array(1)); return "no-throw";`],
    ["Uint8 ← Int16", `const ta = new Uint8Array(2); ta.set(new Int16Array(1)); return "no-throw";`],
    ["Uint8 ← Float64", `const ta = new Uint8Array(2); ta.set(new Float64Array(1)); return "no-throw";`],
    ["BigInt64 ← BigUint64", `const ta = new BigInt64Array(2); ta.set(new BigUint64Array(1)); return "no-throw";`],
    ["BigUint64 ← BigInt64", `const ta = new BigUint64Array(2); ta.set(new BigInt64Array(1)); return "no-throw";`],
  ])("%s → no-throw", (_name, body) => {
    expect(val(`export function f() { ${body} }`)).toEqual({ ok: true, value: "no-throw" });
  });

  it("非 TA 源（数组/字符串）不受内容类型校验影响", () => {
    expect(val(`export function f() { const ta = new Uint8Array(2); ta.set([1]); return "no-throw"; }`))
      .toEqual({ ok: true, value: "no-throw" });
    expect(val(`export function f() { const ta = new BigInt64Array(2); ta.set([1n]); return "no-throw"; }`))
      .toEqual({ ok: true, value: "no-throw" });
  });

  it("越界档优先于内容类型档（原生报错序：u8.set(bi64(1), 2) → RangeError）", () => {
    expectThrows(
      `export function f() { const ta = new Uint8Array(2); ta.set(new BigInt64Array(1), 2); return "no-throw"; }`,
      "RangeError",
    );
  });
});

// ---------------------------------------------------------------------------
// 门禁面
// ---------------------------------------------------------------------------

describe("Bug 304 gate 面", () => {
  it("跨内容类型 set 进 L2（entry-may-throw 记账）", () => {
    const src = `export function f() { const ta = new Uint8Array(2); ta.set(new BigInt64Array(1)); return "no-throw"; }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
  });

  it("抽象源（any）→ may TypeError（不误报定抛）", () => {
    const src = `export function f(x) { const ta = new Uint8Array(2); ta.set(x); return "no-throw"; }`;
    expect(effects(src)).toContain("TypeError");
  });
});
