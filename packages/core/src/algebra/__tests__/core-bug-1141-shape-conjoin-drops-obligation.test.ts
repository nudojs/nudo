/**
 * Bug 1141 —— 契约合取的**结构型义务被静默丢掉** ⇒ 门禁**假绿**。
 *
 * 位置：packages/core/src/algebra/interface.ts 的 `conjoinOrConflict`——任一侧是
 * 结构型就直接 `return prev` ⇒ 另一侧的结构义务**整条蒸发**。
 *
 * 现象：源码契约 `shape({id: number()})` + 侧车契约 `shape({id: number(),
 * name: string()})` ⇒ `name` 义务被丢掉 ⇒ 契约面比声明面**宽松** ⇒ 传
 * `name: 123` 的调用**不被判违约**（违约代码被放过）。
 *
 * 修法：**字段级合并**（两侧都有的字段递归合取；只有一侧有的字段保留）——
 * 两边的义务都在；合不了的形态组合（union / fn …）⇒ 显式报「不可判定」
 * （不得静默宽松）。
 *
 * 本文件钉住：
 * - 侧车的 `name` 义务**不被丢掉**（调用点可见违例）；
 * - 合法合取（两侧同形）⇒ 不得被判成 conflict（零假红，Bug 340 口径）；
 * - 合不了的形态组合 ⇒ 显式诊断（不静默）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  takeRefineDiags();
  takeInterfaceDiags();
});

/** 侧车：同名 fn 约束（p: shape{id,name}）+ 源码指令用的 shape（p: shape{id}） */
const STD = `import { shape, number, string, fn } from "@nudojs/core";
export const srcShape = shape({ id: number() });
export const f = fn({ p: shape({ id: number(), name: string() }) });
`;

function check(src: string, files: Record<string, string> = { "/t/src.nudo.js": STD }) {
  const { loadModule } = makeFiles(files);
  return checkSource("/t/src.js", src, pTrue, { loadModule, fromFile: "/t/src.js" });
}

describe("Bug 1141: 结构型合取不得静默丢掉另一侧的义务", () => {
  it("侧车的 name 义务不被丢掉（调用点可见违例）", () => {
    const r = check(`/// @nudo:import { srcShape } from "./src.nudo.js"
/**
 * @nudo:contract p srcShape
 */
export function f(p) {
  return p;
}
f({ id: 1, name: 123 });
`);
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });

  it("合法合取（两侧同形）⇒ 不得被判 conflict（零假红，Bug 340 口径）", () => {
    const files = {
      "/t/src.nudo.js": `import { shape, number, fn } from "@nudojs/core";
export const srcShape = shape({ id: number() });
export const f = fn({ p: shape({ id: number() }) });
`,
    };
    const r = check(
      `/// @nudo:import { srcShape } from "./src.nudo.js"
/**
 * @nudo:contract p srcShape
 */
export function f(p) {
  return p;
}
`,
      files,
    );
    expect(r.issues.filter((i) => i.code === "nudo:interface-conflict")).toEqual([]);
  });

  it("合法合取（两侧同形）⇒ 义务照常执法（不因合并而失效）", () => {
    const files = {
      "/t/src.nudo.js": `import { shape, number, fn } from "@nudojs/core";
export const srcShape = shape({ id: number() });
export const f = fn({ p: shape({ id: number() }) });
`,
    };
    const r = check(
      `/// @nudo:import { srcShape } from "./src.nudo.js"
/**
 * @nudo:contract p srcShape
 */
export function f(p) {
  return p;
}
f({ id: "not-a-number" });
`,
      files,
    );
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBeGreaterThan(0);
  });

  it("合不了的形态组合 ⇒ 显式诊断（不得静默丢掉那一侧）", () => {
    const files = {
      "/t/src.nudo.js": `import { union, lit, number, fn } from "@nudojs/core";
export const srcUnion = union(lit(0), lit(1));
export const f = fn({ p: number() });
`,
    };
    const r = check(
      `/// @nudo:import { srcUnion } from "./src.nudo.js"
/**
 * @nudo:contract p srcUnion
 */
export function f(p) {
  return p;
}
`,
      files,
    );
    // 结构型组合（union ∧ 标量）合不出来 ⇒ 必须**显式**说出来
    const reported = r.issues.filter((i) => i.code === "nudo:interface-conflict");
    expect(reported.length).toBeGreaterThan(0);
  });
});
