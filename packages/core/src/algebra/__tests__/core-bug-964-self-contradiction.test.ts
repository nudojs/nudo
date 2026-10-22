/**
 * Bug 964：单份契约**内部**自相矛盾零诊断（静默假绿）。
 *
 * `number().gt(10).lt(5)` 归一化进同一约束节点的多个 pred ⇒ 域为空。
 * 旧实现只在「两份契约合并」时做交叉比对（`crossBoundConflict`）⇒ 单份
 * 矛盾零诊断：签名仍显示 `x: number`、调用点也不报任何东西。
 *
 * 修法：interface.ts 加单节点自检（口径与跨节点一致：把 a、b 取成同一
 * 个节点复用同一段判定规则）⇒ 报 nudo:interface-conflict。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache } from "../interface.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 964 单份契约内部矛盾要报 conflict", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("侧车单份契约 gt(10).lt(5) ⇒ 报 nudo:interface-conflict", () => {
    const { loadModule } = makeFiles({
      "/t/self.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number().gt(10).lt(5) }, number());`,
    });
    const src = `export function f(x) { return x; }`;
    const r = checkSource("/t/self.js", src, pTrue, {
      loadModule,
      fromFile: "/t/self.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:interface-conflict").length).toBeGreaterThan(0);
  });

  it("源码指令单份契约自相矛盾 ⇒ 报 nudo:interface-conflict", () => {
    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const bad = number().gt(10).lt(5);`,
    });
    const src = `/// @nudo:import { bad } from "./std.nudo.js"\n/**\n * @nudo:contract x bad\n */\nexport function f(x) { return x; }`;
    const r = checkSource("/t/src.js", src, pTrue, {
      loadModule,
      fromFile: "/t/src.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:interface-conflict").length).toBeGreaterThan(0);
  });

  it("区间非空的契约不报 conflict（不误报）", () => {
    const { loadModule } = makeFiles({
      "/t/ok.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number().gt(0).lt(10) }, number());`,
    });
    const src = `export function f(x) { return x; }`;
    const r = checkSource("/t/ok.js", src, pTrue, {
      loadModule,
      fromFile: "/t/ok.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:interface-conflict")).toEqual([]);
  });
});
