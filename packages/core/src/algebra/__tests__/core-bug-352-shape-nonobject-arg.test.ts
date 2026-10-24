/**
 * Bug 352 — `shape(42)` 这类**非对象实参**：`Object.entries(42)` ⇒ `[]` ⇒
 * 整条参数契约退化成「空 shape」⇒ 域放宽到「任意对象」⇒ 门禁**假绿**
 * （合法实参与违约实参同样放行），且全程零诊断。
 *
 * 修法：`shape` 实参守卫（切片① 的共用校验 `requireFieldsObject`）——
 * 非对象 ⇒ 点名构造器 + 实际类型的 Nudo 原生诊断。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { shape, number, checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 352 · shape 非对象实参守卫", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeInterfaceDiags();
  });

  it("shape(42) 抛 Nudo 原生诊断（点名构造器 + 实际类型）", () => {
    expect(() => shape(42 as never)).toThrow(/nudo shape\(\)/);
    expect(() => shape(42 as never)).toThrow(/got number/);
  });

  it("shape(null) / shape([]) / shape(\"x\") 同样被拒", () => {
    expect(() => shape(null as never)).toThrow(/nudo shape\(\)/);
    expect(() => shape([] as never)).toThrow(/nudo shape\(\)/);
    expect(() => shape("x" as never)).toThrow(/nudo shape\(\)/);
  });

  it("正常实参不受影响", () => {
    const s = shape({ a: number() });
    expect(Object.keys(s.fields ?? {})).toEqual(["a"]);
  });

  it("产品面：shape(42) 的侧车契约不再静默退化成空 shape", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, shape, any } from "@nudojs/core";
export const f = fn({ o: shape(42) }, any());`,
    });
    const src = `
export function f(o) {
  return o;
}
export function g() {
  return f({ a: 1 });
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:interface-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("nudo shape()");
    // 改前：契约退化成空 shape ⇒ 门禁 0 error（假绿）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  });
});
