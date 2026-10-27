/**
 * Bug 088 —— `.optional()` 的「可缺省 / 可为 undefined」语义在**契约 → 入口
 * Abs 投影**里**整体丢失** ⇒ 调用点与返回位双双**假红**，且 check 签名面与
 * `.d.ts` 对同一形参给出**相反**的可选性。
 *
 * 根因：`constraintOnTermAbs` 的标量分支**从不消费 `c.isOptional`** ⇒ 产出的
 * Abs 是 `prim number + pred(typeof x = "number")`，**没有 undefined 臂** ⇒
 * 下游全部按「该位必填且非 undefined」执法：
 *   - L1 调用点前置条件 ⇒ 契约**明确允许**的 `undefined` 实参被判违约（假红）；
 *   - L1 返回后置条件 ⇒ 同款假红（修复建议还把用户引向 `nullable(…)` 绕过）；
 *   - check 签名面渲染 `f(x: number)` ⇒ 与 .d.ts 的 `f(x?: number)` 矛盾。
 *
 * 修法：`.optional()` 顶层位在**三条通道**上同口径保真
 * - `constraintToEntryAbs`：入口 Abs 带 undefined 臂（与
 *   `union(lit(undefined), <base>)` 这条等价写法**同构**）；
 * - `instantiateConstraint`：调用点谓词 = `or(<base>, eq(x, undefined))`；
 * - `constraintAdmitsNullish`：返回位的 nullish 臂放行。
 *
 * 对照组钉住「只作用于顶层位」：对象**字段位**的 `.optional()` 语义是
 * 「键可缺席」（槽位 `optional` 标记），槽值**不得**变成 `number | undefined`。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  constraintAdmitsNullish,
  constraintToEntryAbs,
  formatShape,
  instantiateConstraint,
  litC,
  number,
  pTrue,
  shape,
  union,
} from "../index.ts";
import { predToString } from "../pred.ts";
import { sigOf, sidecarOpts } from "./nudo-constraints.ts";

const LIB = `
export const optNum = number().optional();
export const reqNum = number();
export const optShape = shape({ a: number().optional() });
`;
const opts = (fromFile: string) => sidecarOpts("o.nudo", LIB, fromFile);

const withImport = (body: string, names: string): string =>
  `/// @nudo:import { ${names} } from "./o.nudo.js"\n${body}`;

describe("Bug 088 · .optional() 的「可为 undefined」语义必须投影到入口 Abs", () => {
  it("入口 Abs 带 undefined 臂（与 union(lit(undefined), number()) 同构）", () => {
    const opt = constraintToEntryAbs(number().optional(), "x");
    const viaUnion = constraintToEntryAbs(union(litC(undefined), number()), "x");
    const optText = formatShape(opt);
    const unionText = formatShape(viaUnion);
    // 改前：`number`（undefined 臂整条丢失）
    expect(optText).toContain("undefined");
    expect(optText).toContain("number");
    // 与 `union(lit(undefined), number())` 这条等价写法**同构**（臂集合一致；
    // 臂顺序由 join 决定，不作断言）
    expect(opt.shape.k).toBe(viaUnion.shape.k);
    expect(optText.split(" | ").sort()).toEqual(unionText.split(" | ").sort());
  });

  it("调用点谓词允许 undefined（`or(<base>, eq(x, undefined))`）", () => {
    const p = instantiateConstraint(number().optional(), "x");
    expect(p.op).toBe("or");
    const text = predToString(p);
    expect(text).toContain('typeof x = "number"');
    expect(text).toContain("x = undefined");
    // 负控制：非可选位仍是单条 typeof（不得被误加 undefined 支）
    expect(instantiateConstraint(number(), "x").op).toBe("typeof");
  });

  it("返回位：契约承认 nullish（`return undefined` 不再假红）", () => {
    expect(constraintAdmitsNullish(number().optional())).toBe(true);
    // 负控制：非可选位仍不承认 nullish
    expect(constraintAdmitsNullish(number())).toBe(false);
    // 字段位不改变**外层对象**的 nullish 判定
    expect(constraintAdmitsNullish(shape({ a: number().optional() }))).toBe(false);
  });

  it("端到端：调用点传 undefined ⇒ 零 error（改前 nudo:constraint-violated）", () => {
    const src = withImport(
      `
/**
 * @nudo:contract x optNum
 */
function f(x) {
  return x === undefined ? 0 : x;
}
f(undefined);
`,
      "optNum",
    );
    const r = checkSource("/t/bug088/o.js", src, pTrue, opts("/t/bug088/o.js"));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("端到端：返回 undefined 的实现对 `number().optional()` 返回契约 ⇒ 零 error", () => {
    const src = withImport(
      `
/**
 * @nudo:contract return optNum
 */
function g() {
  return undefined;
}
`,
      "optNum",
    );
    const r = checkSource("/t/bug088/r.js", src, pTrue, opts("/t/bug088/r.js"));
    const ret = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(ret).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("负控制：非可选位传 undefined 仍是 error（不得被整体放宽）", () => {
    const src = withImport(
      `
/**
 * @nudo:contract x reqNum
 */
function f(x) {
  return x === undefined ? 0 : x;
}
f(undefined);
`,
      "reqNum",
    );
    const r = checkSource("/t/bug088/req.js", src, pTrue, opts("/t/bug088/req.js"));
    expect(r.issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("check 签名面与 .d.ts 对同一形参的可选性一致（签名面含 undefined）", () => {
    const src = withImport(
      `
/**
 * @nudo:contract x optNum
 */
function f(x) {
  return x === undefined ? 0 : x;
}
`,
      "optNum",
    );
    const r = checkSource("/t/bug088/sig.js", src, pTrue, opts("/t/bug088/sig.js"));
    // 改前：形参面是 `number`（必填 number）——与 .d.ts 的 `x?: number` 矛盾
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes.join(", ")).toContain("undefined");
  });

  it("对照组：对象字段位的 .optional() 仍是「键可缺席」，槽值不带 undefined", () => {
    const a = constraintToEntryAbs(shape({ a: number().optional() }), "o");
    if (a.shape.k !== "obj") throw new Error("expected obj");
    const slot = a.shape.slots.a!;
    expect(slot.optional).toBe(true);
    // 槽值**不得**变成 sum（否则字段面从 `a?: number` 退化成 `a?: number | undefined`）
    expect(slot.value.shape.k).toBe("prim");
    expect(formatShape(a)).toBe("{ a?: number }");
  });
});
