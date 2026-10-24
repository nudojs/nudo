/**
 * Bug 340：非标量约束的合取被误报成「语义不可满足」。
 *
 * `and()` 的两类 throw 被 `conjoinOrConflict` 一律当成 conflict：
 * - 形态不支持（shape/array/union/fn 合取）——Phase 1 的能力边界，两条
 *   约束可能**逐字相同**（最常见：源码 @nudo:contract 与同名侧车绑定
 *   都写 shape）；
 * - 语义真矛盾（number() ∧ string()）。
 *
 * 误报的后果是双面的：
 * - 门禁假红：一条说「不可满足」的 nudo:interface-conflict（实际只是合不了）；
 * - 门禁假绿：conflict 位让该形参的**义务被整条跳过** ⇒ 调用点不再校验。
 *
 * 修法：只有第二类才标 conflict（interface.ts `conjoinOrConflict`）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache } from "../interface.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SHAPES = `import { shape, number, string } from "@nudojs/core";\nexport const userShape = shape({ id: number(), name: string() });`;
const SIDECAR = `import { fn, shape, number, string } from "@nudojs/core";\nexport const t = fn({ o: shape({ id: number(), name: string() }) }, number());`;

describe("Bug 340 非标量合取不再误报 nudo:interface-conflict", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("shape 约束（源码指令 × 同名侧车）⇒ 无 conflict 假红", () => {
    const { loadModule } = makeFiles({
      "/t/shapes.nudo.js": SHAPES,
      "/t/t.nudo.js": SIDECAR,
    });
    const src = `/// @nudo:import { userShape } from "./shapes.nudo.js"\n/**\n * @nudo:contract o userShape\n */\nexport function t(o) { return o.id; }`;
    const r = checkSource("/t/t.js", src, pTrue, {
      loadModule,
      fromFile: "/t/t.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:interface-conflict")).toEqual([]);
  });

  it("conflict 位不再吃掉该形参的义务 ⇒ 调用点仍报违例（假绿修复）", () => {
    const { loadModule } = makeFiles({
      "/t/shapes2.nudo.js": SHAPES,
      "/t/t2.nudo.js": SIDECAR,
    });
    const src = `/// @nudo:import { userShape } from "./shapes2.nudo.js"\n/**\n * @nudo:contract o userShape\n */\nexport function t(o) { return o.id; }\nexport function caller() { return t({ id: "not-a-number", name: "x" }); }`;
    const r = checkSource("/t/t2.js", src, pTrue, {
      loadModule,
      fromFile: "/t/t2.js",
    });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  });

  it("语义真矛盾（number() ∧ string()）仍然报 conflict", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const num = number();`,
      "/t/prim.nudo.js": `import { fn, string } from "@nudojs/core";\nexport const f = fn({ x: string() }, string());`,
    });
    const src = `/// @nudo:import { num } from "./std.nudo.js"\n/**\n * @nudo:contract x num\n */\nexport function f(x) { return x; }`;
    const r = checkSource("/t/prim.js", src, pTrue, {
      loadModule,
      fromFile: "/t/prim.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:interface-conflict").length).toBeGreaterThan(0);
  });
});
