/**
 * Bug 914：字段位 / 数组元素位的 `null` / `undefined` 实参**完全不被执法**
 * （假绿）——顶层标量位与返回值面判违例，字段 / 元素位静默放行 ⇒ 引擎内
 * 3 套「nullish 是否满足契约」口径。
 *
 * 修法：消费侧（`scan/literal-shapes.ts` 的 `checkFieldConstraint`）
 *   ① prim 门：nullish 实参（有 term 的 unknown）**不满足**裸 prim 契约；
 *   ② 数值界门：nullish / boolean 实参不满足数值界（与顶层标量面同口径）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const NUDO_SRC = `
import { fn, number, shape, array, any } from "@nudojs/core";
export const top = fn({ x: number() }, any());
export const fld = fn({ o: shape({ v: number() }) }, any());
export const arr = fn({ a: array(number()) }, any());
export const fldBounded = fn({ o: shape({ v: number().gt(0) }) }, any());
`;

const opts = sidecarOpts("core-bug-914.nudo.js", NUDO_SRC, "/t/core-bug-914.js");

function check(src: string) {
  return checkSource("/t/core-bug-914.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }, fn?: string) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (!fn || i.fn === fn),
  );
}

const DECLS = `
export function top(x) { return x; }
export function fld(o) { return o; }
export function arr(a) { return a; }
export function fldBounded(o) { return o; }
`;

describe("Bug 914：字段 / 元素位的 nullish 实参不再零诊断", () => {
  it("顶层标量位：null 报违例（基线口径不变）", () => {
    const r = check(`${DECLS}\ntop(null);\n`);
    const v = violated(r, "top");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof x = "number"');
  });

  it("字段位：{ v: null } 报违例", () => {
    const r = check(`${DECLS}\nfld({ v: null });\n`);
    const v = violated(r, "fld");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof o.v = "number"');
  });

  it("数组元素位：[null] 报违例", () => {
    const r = check(`${DECLS}\narr([null]);\n`);
    const v = violated(r, "arr");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof a[0] = "number"');
  });

  it("字段位 undefined 同样报违例", () => {
    const r = check(`${DECLS}\nfld({ v: undefined });\n`);
    const v = violated(r, "fld");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof o.v = "number"');
  });

  it("带界的字段位：null 不满足数值界", () => {
    const r = check(`${DECLS}\nfldBounded({ v: null });\n`);
    const v = violated(r, "fldBounded");
    expect(v).toHaveLength(1);
    expect(v[0]!.severity).toBe("error");
  });

  it("合规实参零诊断（nullish 执法没有误伤合法调用）", () => {
    const r = check(`${DECLS}\ntop(1);\nfld({ v: 1 });\narr([1, 2]);\nfldBounded({ v: 5 });\n`);
    expect(violated(r)).toEqual([]);
  });
});
