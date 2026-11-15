/**
 * BUG-018 回归钉：跨槽 `ref()` 的 binder 表必须进 generalize 的形参投影。
 *
 * 修前：`constraintToEntryAbs(c, param)` 未传 `eff.binders` ⇒ `ref("a")` 在
 * 别的槽位的树里 ⇒ `resolveRef` 抛错 ⇒ 被 generalize 的裸 `catch {}` 吞掉
 * ⇒ 该位静默退回 `any()` ⇒ `y(x)` 被判「调用任意值」⇒ 合法代码假红，且契约
 * 义务在 check 面静默失效。
 *
 * 钉两面：① 诊断面无 error；② 签名面 y 位拿到 `number`（不是 any）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SIDECAR = `import { fn, any, number, bind, ref } from "@nudojs/core";
export const t = fn({ x: bind("a", number()), y: fn({ z: ref("a") }, any()) }, any());`;
const CONTROL = `import { fn, any, number, bind } from "@nudojs/core";
export const t = fn({ x: bind("a", number()), y: fn({ z: any() }, any()) }, any());`;

const SOURCE = `export function t(x, y) { return y(x); }`;

function run(sidecar: string) {
  const { loadModule } = makeFiles({ "/t/b018.nudo.js": sidecar });
  return checkSource("/t/b018.js", SOURCE, pTrue, {
    loadModule,
    fromFile: "/t/b018.js",
    entryThrows: "off",
  });
}

describe("BUG-018 跨槽 ref 的 binder 传递", () => {
  it("ref(\"a\") 解析到另一槽位的 bind ⇒ 无 error，y 位是 number", () => {
    const r = run(SIDECAR);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    const sig = r.signatures.find((s) => s.name === "t");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[1]).toContain("number");
    expect(sig!.paramTypes?.[1]).not.toBe("any");
  });

  it("对照：y 位写 any() 时逐字不变（无回归）", () => {
    const r = run(CONTROL);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    const sig = r.signatures.find((s) => s.name === "t");
    expect(sig!.paramTypes?.[1]).toBe("(any) => any");
  });
});
