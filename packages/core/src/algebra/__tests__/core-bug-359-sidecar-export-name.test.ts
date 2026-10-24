/**
 * Bug 359：侧车形态诊断点名的是**源码本地名**，不是侧车里真实存在的导出名。
 *
 * 形态：别名导出（`export { _c as class }`）与 default 导出
 * （`export { f as default }`）下，侧车身份是**导出名**（class / default），
 * 源码身份是**本地名**（_c / f）。旧诊断点名源码本地名 ⇒ 用户照着去侧车
 * 里找一个根本不存在的导出。
 *
 * 修法：interface.ts 诊断改用绑定键解析出来的**侧车导出名**
 * （bindingLabel），必要时同时给出源码函数名。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache } from "../interface.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 359 侧车形态诊断点名侧车真名", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("别名导出：诊断点名侧车导出名 class（不是源码本地名 _c）", () => {
    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `const _nudo_1 = 42;\nexport { _nudo_1 as class };`,
    });
    const src = `export function _c(o) { return o.a; }\nexport { _c as class };`;
    const r = checkSource("/t/lib.js", src, pTrue, {
      loadModule,
      fromFile: "/t/lib.js",
    });
    const diags = r.issues.filter((i) => i.code === "nudo:interface-load");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("'class'");
    expect(diags[0]!.message).not.toContain("export '_c'");
    // 同时给出源码函数名（用户按本地名也能定位）
    expect(diags[0]!.message).toContain("'_c'");
  });

  it("default 导出：诊断点名侧车导出名 default（不是源码本地名 f）", () => {
    const { loadModule } = makeFiles({
      "/t/def.nudo.js": `export default 42;`,
    });
    const src = `export function f(o) { return o.a; }\nexport { f as default };`;
    const r = checkSource("/t/def.js", src, pTrue, {
      loadModule,
      fromFile: "/t/def.js",
    });
    const diags = r.issues.filter((i) => i.code === "nudo:interface-load");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("'default'");
    expect(diags[0]!.message).not.toContain("export 'f'");
  });
});
