/**
 * Bug 339：侧车导出名打错 ⇒ 契约被**静默丢弃**。
 *
 * 绑定是「拉取式」的（每个源码函数去问侧车「你叫这个名字吗」），从不枚举
 * 侧车导出 ⇒ 侧车里没人认领的条目在系统里根本不存在：签名退化成 any、
 * dts 类型错、门禁冒一条与真实原因无关的假红（"may throw TypeError"）。
 *
 * 修法：interface.ts 扫侧车孤儿导出——侧车里有、源码里没人认领的 **fn()
 * 契约** ⇒ 报一条点名的诊断（sidecar 导出名 + 源码导出名列表）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache } from "../interface.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 339 侧车孤儿导出诊断", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("侧车导出名与源码函数名不匹配 ⇒ 报孤儿导出（点名侧车导出名）", () => {
    const { loadModule } = makeFiles({
      "/t/typo.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const ff = fn({ x: number() }, number());`,
    });
    const src = `export function f(x) { return x * 2; }`;
    const r = checkSource("/t/typo.js", src, pTrue, {
      loadModule,
      fromFile: "/t/typo.js",
    });
    const orphan = r.issues.filter(
      (i) => i.code === "nudo:interface-load" && i.message.includes("has no matching source function"),
    );
    expect(orphan).toHaveLength(1);
    // 点名侧车里真实存在的导出名（ff）+ 源码导出名（f）
    expect(orphan[0]!.message).toContain("'ff'");
    expect(orphan[0]!.message).toContain("source exports: f");
  });

  it("名字对得上 ⇒ 无孤儿诊断（不误报）", () => {
    const { loadModule } = makeFiles({
      "/t/ok.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number() }, number());`,
    });
    const src = `export function f(x) { return x * 2; }`;
    const r = checkSource("/t/ok.js", src, pTrue, {
      loadModule,
      fromFile: "/t/ok.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:interface-load")).toEqual([]);
  });

  it("非 fn() 形态的孤儿导出（模板）不报（模板是 @nudo:import 的料）", () => {
    const { loadModule } = makeFiles({
      "/t/tpl.nudo.js": `import { shape, number } from "@nudojs/core";\nexport const userShape = shape({ id: number() });`,
    });
    const src = `export function f(x) { return x * 2; }`;
    const r = checkSource("/t/tpl.js", src, pTrue, {
      loadModule,
      fromFile: "/t/tpl.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:interface-load")).toEqual([]);
  });

  it("已被 @nudo:import 认领的名字不算孤儿", () => {
    const { loadModule } = makeFiles({
      "/t/claimed.nudo.js": `import { fn, number } from "@nudojs/core";\nexport const helper = fn({ x: number() }, number());`,
    });
    const src = `/// @nudo:import { helper } from "./claimed.nudo.js"\nexport function f(x) { return x * 2; }`;
    const r = checkSource("/t/claimed.js", src, pTrue, {
      loadModule,
      fromFile: "/t/claimed.js",
    });
    expect(
      r.issues.filter((i) => i.code === "nudo:interface-load" && i.message.includes("has no matching source function")),
    ).toEqual([]);
  });
});
