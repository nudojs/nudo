/**
 * Bug 439：`lazy(() => shape(...))` / `lazy(() => array(...))` 的**结构义务
 * 整体丢失**（假绿）——`lazy` 包装自身 `fields` / `element` / `prim` 全空，
 * 执法侧的闸门只看约束自身 ⇒ 整条结构义务被 `continue` 掉。
 *
 * 修法：消费侧（`scan/literal-shapes.ts`）在判闸门前**先 deref** lazy 包装
 * （`derefDeep`：按 `LAZY_TEMPLATE_DEPTH` 预算递归解包，`derefConstraint`
 * 只解一层）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const NUDO_SRC = `
import { fn, number, shape, array, lazy, any } from "@nudojs/core";
export const takeShape = fn({ x: lazy(() => shape({ a: number() })) }, any());
export const takeArr = fn({ x: lazy(() => array(number())) }, any());
export const takeNested = fn({ x: lazy(() => lazy(() => shape({ a: number() }))) }, any());
`;

const opts = sidecarOpts("core-bug-439.nudo.js", NUDO_SRC, "/t/core-bug-439.js");

function check(src: string) {
  return checkSource("/t/core-bug-439.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }, fn?: string) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (!fn || i.fn === fn),
  );
}

const DECLS = `
export function takeShape(x) { return x; }
export function takeArr(x) { return x; }
export function takeNested(x) { return x; }
`;

describe("Bug 439：lazy 包装的结构义务不再丢失", () => {
  it("lazy(() => shape(...))：非对象实参报违例", () => {
    const r = check(`${DECLS}\ntakeShape(1);\n`);
    const v = violated(r, "takeShape");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("object shape at x");
  });

  it("lazy(() => array(...))：元素类型不符报违例", () => {
    const r = check(`${DECLS}\ntakeArr(["x"]);\n`);
    const v = violated(r, "takeArr");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof x[0] = "number"');
  });

  it("嵌套 lazy 包装（两层）也能解包", () => {
    const r = check(`${DECLS}\ntakeNested(1);\n`);
    const v = violated(r, "takeNested");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("object shape at x");
  });

  it("合规实参零诊断（deref 没有把合法调用打成红）", () => {
    const r = check(`${DECLS}\ntakeShape({ a: 1 });\ntakeArr([1, 2]);\ntakeNested({ a: 1 });\n`);
    expect(violated(r)).toEqual([]);
  });
});
