/**
 * Bug 433：`union(...)` 含 shape / array 成员时**成员结构义务整体丢失**（假绿）。
 *
 * 契约侧（`constraint.ts` 的 `instantiateConstraint`）把 union 成员摊成顶层
 * `or(...)` 谓词，成员的 `fields` / `element` 不会抬到 union 约束上；执法侧
 * 原本也没有 union 成员分支 ⇒ 两侧都缺 ⇒ `fUnioned({ id: "x" })` /
 * `fArrUnion(["x"])` 零诊断。
 *
 * 修法：消费侧（`scan/literal-shapes.ts` 的 `checkShapeReqs`）补 union 成员
 * 分支——与实参形态匹配的成员**全部**不满足才报违例（union 是析取）。
 *
 * 三类形态覆盖（消费侧形态覆盖验证）：
 *   ① 成员是 array  → `union(array(number()), lit(1))`
 *   ② 嵌套 shape    → `union(shape({ a: shape({ b: number() }) }), lit(1))`
 *   ③ 成员带界      → `union(number().gt(0), shape({ a: number() }))`
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const NUDO_SRC = `
import { fn, number, shape, array, union, lit, any } from "@nudojs/core";
const user = shape({ id: number() });
export const fDirect = fn({ o: user }, any());
export const fUnioned = fn({ u: union(user, lit(1)) }, any());
export const fArrUnion = fn({ a: union(array(number()), lit(1)) }, any());
export const fNested = fn({ n: union(shape({ a: shape({ b: number() }) }), lit(1)) }, any());
export const fBounds = fn({ b: union(number().gt(0), shape({ a: number() })) }, any());
`;

const opts = sidecarOpts("core-bug-433.nudo.js", NUDO_SRC, "/t/core-bug-433.js");

function check(src: string) {
  return checkSource("/t/core-bug-433.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }, fn?: string) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (!fn || i.fn === fn),
  );
}

const DECLS = `
export function fDirect(o) { return o; }
export function fUnioned(u) { return u; }
export function fArrUnion(a) { return a; }
export function fNested(n) { return n; }
export function fBounds(b) { return b; }
`;

describe("Bug 433：union 成员的结构义务不再丢失", () => {
  it("shape 成员：union(user, lit(1)) 收到 { id: \"x\" } 报违例", () => {
    const r = check(`${DECLS}\nfUnioned({ id: "x" });\n`);
    const v = violated(r, "fUnioned");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof u.id = "number"');
  });

  it("形态①：array 成员——union(array(number()), lit(1)) 收到 [\"x\"] 报违例", () => {
    const r = check(`${DECLS}\nfArrUnion(["x"]);\n`);
    const v = violated(r, "fArrUnion");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof a[0] = "number"');
  });

  it("形态②：嵌套 shape 成员——收到 { a: { b: \"x\" } } 报违例", () => {
    const r = check(`${DECLS}\nfNested({ a: { b: "x" } });\n`);
    const v = violated(r, "fNested");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof n.a.b = "number"');
  });

  it("形态③：成员带界——union(number().gt(0), shape({a:number()})) 收到 { a: \"x\" } 报违例", () => {
    const r = check(`${DECLS}\nfBounds({ a: "x" });\n`);
    const v = violated(r, "fBounds");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof b.a = "number"');
  });

  it("析取语义：任一成员满足即放行（不误报）", () => {
    const r = check(
      `${DECLS}\nfUnioned({ id: 5 });\nfArrUnion([1, 2]);\nfNested({ a: { b: 1 } });\nfBounds({ a: 1 });\n`,
    );
    expect(violated(r)).toEqual([]);
  });

  it("标量成员侧不被消费侧重复产出诊断（union 标量面归谓词通道）", () => {
    // `1` 满足 lit(1) 成员 ⇒ union 满足 ⇒ 无违例
    const r = check(`${DECLS}\nfUnioned(1);\n`);
    expect(violated(r)).toEqual([]);
  });

  it("基线对照：非 union 的 shape 契约仍然报违例（消费侧没把普通 shape 放跑）", () => {
    const r = check(`${DECLS}\nfDirect({ id: "x" });\n`);
    const v = violated(r, "fDirect");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof o.id = "number"');
  });
});
