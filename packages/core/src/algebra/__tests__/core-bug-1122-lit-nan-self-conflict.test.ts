/**
 * Bug 1122 —— `lit(NaN)` 契约被判**自相矛盾**（nudo:interface-conflict）⇒
 * 门禁**假红**（对 main 的回归：fix-13 引入单份契约自检后暴露）。
 *
 * 根因（packages/core/src/algebra/interface.ts）：
 *   `selfBoundConflict(c)` → `crossBoundConflict(c, c)` → eq 字面量冲突判定用
 *   `x.value !== y.value` 比较字面量值。`NaN !== NaN` 恒真 ⇒ **同一个**
 *   `lit(NaN)` 约束自比被判成「两个不同字面量」⇒ 单份契约自相矛盾。
 *
 * 口径：字面量同一性用 **SameValue 的 NaN 口径**（`===` + NaN 特例）——
 * 与仓库既有 `termEquals`（term.ts）/ `literalSame`（domain-membership.ts）
 * 同款：NaN 与自身同项，-0 与 0 仍同项（与 `===` 一致）。
 *
 * 本文件钉住：
 * - `lit(NaN)` 参数位 / 返回位 ⇒ **不得**报 nudo:interface-conflict；
 * - 真矛盾（`and(lit(1), lit(2))`）⇒ 仍必须报（不得把闸门修成假绿）。
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

/** ambient 侧车绑定路径：侧车在 /t/<base>.nudo.js，源码在 /t/<base>.js */
function checkWithSidecar(sidecar: string, src: string, base = "nan") {
  const file = `/t/${base}.js`;
  const { loadModule } = makeFiles({ [`/t/${base}.nudo.js`]: sidecar });
  return checkSource(file, src, pTrue, { loadModule, fromFile: file });
}

describe("Bug 1122: lit(NaN) 契约不得判自相矛盾（假红）", () => {
  it("侧车参数位 + 返回位 lit(NaN) ⇒ 不报 nudo:interface-conflict", () => {
    const r = checkWithSidecar(
      `import { fn, lit } from "@nudojs/core";\nexport const f = fn({ x: lit(NaN) }, lit(NaN));`,
      `export function f(x) { return x; }`,
    );
    expect(r.issues.filter((i) => i.code === "nudo:interface-conflict")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("源码指令位 lit(NaN) ⇒ 不报 nudo:interface-conflict", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { lit } from "@nudojs/core";\nexport const nanLit = lit(NaN);`,
    });
    const src = `/// @nudo:import { nanLit } from "./std.nudo.js"
/**
 * @nudo:contract x nanLit
 */
export function f(x) { return x; }`;
    const r = checkSource("/t/src.js", src, pTrue, { loadModule, fromFile: "/t/src.js" });
    expect(r.issues.filter((i) => i.code === "nudo:interface-conflict")).toEqual([]);
  });

  it("真矛盾（and(lit(1), lit(2))）⇒ 仍报 nudo:interface-conflict（闸门不得变假绿）", () => {
    const r = checkWithSidecar(
      `import { fn, lit, and } from "@nudojs/core";\nexport const f = fn({ x: and(lit(1), lit(2)) }, lit(0));`,
      `export function f(x) { return x; }`,
    );
    const conflicts = r.issues.filter((i) => i.code === "nudo:interface-conflict");
    expect(conflicts.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });

  it("不同字面量（lit(1) ∧ lit(2)）跨约束 ⇒ 仍报 conflict（不得放宽真矛盾）", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { lit } from "@nudojs/core";\nexport const one = lit(1);\nexport const two = lit(2);`,
    });
    const src = `/// @nudo:import { one, two } from "./std.nudo.js"
/**
 * @nudo:contract x one
 * @nudo:contract x two
 */
export function f(x) { return x; }`;
    const r = checkSource("/t/src2.js", src, pTrue, { loadModule, fromFile: "/t/src2.js" });
    expect(r.issues.filter((i) => i.code === "nudo:interface-conflict").length).toBeGreaterThan(0);
  });
});
