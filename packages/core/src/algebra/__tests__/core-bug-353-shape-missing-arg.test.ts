/**
 * Bug 353 — `shape()` **少传实参**：宿主原生 TypeError 原文
 * 「Cannot convert undefined or null to object」直接进产品诊断 ⇒
 * 误导诊断（用户看不出是哪个构造器缺参）+ 整份契约当场丢失。
 *
 * 修法：实参守卫（切片① 的共用校验 `requireFieldsObject`）——
 * 缺参 ⇒ 点名构造器 + 说明缺参的 Nudo 原生诊断，宿主异常不冒泡。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { shape, checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 353 · shape 缺参诊断（宿主原文不得冒泡）", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeInterfaceDiags();
  });

  it("shape() 抛 Nudo 原生诊断，点名构造器并说明缺参", () => {
    // 少传实参：零参调用与 `shape(undefined)` 同口径（守卫判的是实参值，
    // 不是实参个数）⇒ 用显式 undefined 表达「缺参」。
    expect(() => shape(undefined as never)).toThrow(/nudo shape\(\)/);
    expect(() => shape(undefined as never)).toThrow(/fields object is required/);
  });

  it("诊断不含宿主 TypeError 原文", () => {
    let msg = "";
    try {
      shape(undefined as never);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toContain("Cannot convert undefined or null to object");
    expect(msg).not.toContain("TypeError");
  });

  it("shape(undefined) 与 shape() 同口径", () => {
    expect(() => shape(undefined as never)).toThrow(/fields object is required/);
  });

  it("产品面：侧车诊断是 Nudo 原生文案，不是宿主原文", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, shape, any } from "@nudojs/core";
export const f = fn({ o: shape() }, any());`,
    });
    const src = `
export function f(o) {
  return o;
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:interface-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("nudo shape()");
    expect(load!.message).not.toContain("Cannot convert undefined or null to object");
  });
});
