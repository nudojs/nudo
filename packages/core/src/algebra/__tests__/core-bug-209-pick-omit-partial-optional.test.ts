/**
 * Bug 209 —— `pick()` / `omit()` / `partial()` 三个**纯结构变换**静默丢掉约束的
 * `optional` 标志 ⇒ 契约被**收紧** ⇒ 合法调用被判违约（假红）+ 签名 / dts
 * 少一个 `?`。
 *
 * 根因：三个变换重建 builder 时只搬 `prim` / `preds` / `fields`，**不搬
 * `isOptional`**（`makeBuilder(d.prim, d.preds, { fields })`）⇒ flag 在 builder
 * 层就没了。消费端恰是从 `field.constraint.isOptional` 读可选性
 * （`constraintToEntryAbs` / `instantiateConstraint` 的字段分支）⇒ 下游永远读到
 * 「必填」。对照组：直接写（不套变换）时 `shape()` 会把 flag 抬到字段上 ⇒ 可选。
 *
 * 修法：三处 `makeBuilder(...)` 补回 `d.isOptional`（**被包进去的那个 shape
 * 自身**的可选性必须保留；`partial` 内部字段的可选性由 `partial` 自己处理）。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  constraintToEntryAbs,
  formatShape,
  instantiateConstraint,
  number,
  omit,
  partial,
  pTrue,
  pick,
  shape,
} from "../index.ts";
import { predToString } from "../pred.ts";
import { sigOf, sidecarOpts } from "./nudo-constraints.ts";

const LIB = `
export const cA = shape({ s: shape({ a: number() }).optional() });
export const cB = shape({ s: pick(shape({ a: number() }).optional(), ["a"]) });
export const cC = shape({ s: omit(shape({ a: number() }).optional(), ["a"]) });
export const cD = shape({ s: partial(shape({ a: number() }).optional()) });
`;

/** 四个函数各自被 `f({})` 调用一次（与复现夹具同形） */
const SRC = `/// @nudo:import { cA, cB, cC, cD } from "./lib.nudo.js"

/**
 * @nudo:contract x cA
 */
function fA(x) { return x; }

/**
 * @nudo:contract x cB
 */
function fB(x) { return x; }

/**
 * @nudo:contract x cC
 */
function fC(x) { return x; }

/**
 * @nudo:contract x cD
 */
function fD(x) { return x; }

fA({});
fB({});
fC({});
fD({});
`;

describe("Bug 209 · pick/omit/partial 必须保留约束的 optional 标志", () => {
  it("builder 层：三个变换都保留 isOptional（改前全部丢失）", () => {
    const base = shape({ a: number() }).optional();
    expect(base.isOptional).toBe(true);
    expect(pick(base, ["a"]).isOptional).toBe(true);
    expect(omit(base, ["a"]).isOptional).toBe(true);
    expect(partial(base).isOptional).toBe(true);
  });

  it("入口 Abs 层：字段槽仍是 optional（渲染带 `s?`）", () => {
    for (const c of [
      shape({ s: pick(shape({ a: number() }).optional(), ["a"]) }),
      shape({ s: omit(shape({ a: number() }).optional(), ["a"]) }),
      shape({ s: partial(shape({ a: number() }).optional()) }),
    ]) {
      const a = constraintToEntryAbs(c, "x");
      if (a.shape.k !== "obj") throw new Error("expected obj");
      expect(a.shape.slots.s!.optional).toBe(true);
      expect(formatShape(a)).toContain("s?:");
    }
  });

  it("前置条件层：字段谓词不再要求必填（可选字段不进硬 pred）", () => {
    const p = predToString(
      instantiateConstraint(
        shape({ s: pick(shape({ a: number() }).optional(), ["a"]) }),
        "x",
      ),
    );
    // 改前：`x.s.a` 出现在硬 pred 里（= 必填字段）
    expect(p).not.toContain("x.s");
  });

  it("端到端：合法调用 f({}) 零 error、签名面保留 `s?`（改前 3 条假红）", () => {
    const r = checkSource("/t/bug209/lib.js", SRC, pTrue, sidecarOpts("lib.nudo", LIB, "/t/bug209/lib.js"));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(sigOf(r, "fA")).toContain("s?:");
    for (const fn of ["fB", "fC", "fD"]) {
      const sig = r.signatures.find((s) => s.name === fn);
      expect(sig, fn).toBeDefined();
      expect(sig!.paramTypes?.join(", ") ?? "", fn).toContain("s?:");
    }
  });

  it("负控制：不套变换时行为不变（直接把 optional 抬到字段上）", () => {
    const a = constraintToEntryAbs(shape({ s: shape({ a: number() }).optional() }), "x");
    if (a.shape.k !== "obj") throw new Error("expected obj");
    expect(a.shape.slots.s!.optional).toBe(true);
  });

  it("负控制：非可选 shape 经变换后仍必填（不得被顺手放宽）", () => {
    const a = constraintToEntryAbs(shape({ s: pick(shape({ a: number() }), ["a"]) }), "x");
    if (a.shape.k !== "obj") throw new Error("expected obj");
    expect(a.shape.slots.s!.optional).toBeUndefined();
    expect(checkSource(
      "/t/bug209/req.js",
      `/// @nudo:import { cE } from "./lib2.nudo.js"

/**
 * @nudo:contract x cE
 */
function fE(x) { return x; }
fE({});
`,
      pTrue,
      sidecarOpts("lib2.nudo", `export const cE = shape({ s: pick(shape({ a: number() }), ["a"]) });`, "/t/bug209/req.js"),
    ).issues.filter((i) => i.severity === "error").length).toBeGreaterThan(0);
  });
});
