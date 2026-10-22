/**
 * Bug 334：同一个物理侧车环被两条通道各报一次 ⇒ 一个环 = 两条同码 error。
 *
 * 两条通道：
 * - ambient 侧车加载通道（interface.ts `loadSidecarBinding` 的 exec catch）
 * - `@nudo:import` 通道（refine.ts `collectConstraints` → exec 抛
 *   `NudoSidecarError(nudo:interface-cycle)`）
 *
 * 两条通道命中的是**同一个物理环**（环链文本相同），但 message 差一个
 * "sidecar '…' failed to load: " 前缀 ⇒ check 层的 code+message 去重抓不住
 * ⇒ 门禁摘要虚增一倍。
 *
 * 修法：interface.ts 按**环链文本**去重（同一物理环 ⇒ 一条诊断）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache } from "../interface.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 334 侧车环只报一条 nudo:interface-cycle", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("ambient 通道 + @nudo:import 通道命中同一物理环 ⇒ 只报 1 条", () => {
    const { loadModule } = makeFiles({
      // 环：cyc.nudo.js → other.nudo.js → cyc.nudo.js
      "/t/cyc.nudo.js": `import { positive } from "./other.nudo.js";\nexport { positive };`,
      "/t/other.nudo.js": `import { positive } from "./cyc.nudo.js";\nexport const positive = positive;`,
    });
    // 两条通道都 exec 这个侧车：
    // - ambient 通道：源码有导出 ⇒ 侧车被 exec ⇒ 撞环；
    // - @nudo:import 通道：@nudo:contract 引用了导入名 ⇒ 导入侧车被求值 ⇒ 撞环。
    const src = `/// @nudo:import { positive } from "./cyc.nudo.js"
/**
 * @nudo:contract x positive
 */
export function area(x) { return x; }`;
    const r = checkSource("/t/cyc.js", src, pTrue, {
      loadModule,
      fromFile: "/t/cyc.js",
    });
    const cycles = r.issues.filter((i) => i.code === "nudo:interface-cycle");
    expect(cycles).toHaveLength(1);
  });

  it("环诊断文本仍点名环链（去重不丢信息）", () => {
    const { loadModule } = makeFiles({
      "/t/cyc2.nudo.js": `import { positive } from "./other2.nudo.js";\nexport { positive };`,
      "/t/other2.nudo.js": `import { positive } from "./cyc2.nudo.js";\nexport const positive = positive;`,
    });
    const src = `/// @nudo:import { positive } from "./cyc2.nudo.js"
/**
 * @nudo:contract x positive
 */
export function area(x) { return x; }`;
    const r = checkSource("/t/cyc2.js", src, pTrue, {
      loadModule,
      fromFile: "/t/cyc2.js",
    });
    const cycles = r.issues.filter((i) => i.code === "nudo:interface-cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.message).toContain("sidecar import cycle:");
    expect(cycles[0]!.message).toContain("cyc2.nudo.js");
  });
});
