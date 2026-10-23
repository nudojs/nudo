/**
 * Bug 380（单元层）：转译器拒绝构造 ⇒ 求值结局必须是「不可判定」。
 *
 * `evalThrowsOf` 把「转译失败」与「无桥接」都折成 undefined ⇒ L2 证据面
 * 分不出「没分析出 may-throw」与「分析出没有 may-throw」。新增的
 * `evalThrowsOutcome` 把三种结局分开：**unanalyzable**（转译失败）/ analyzed
 * （已求值）/ absent（无桥接）。
 */
import { describe, it, expect } from "vitest";
import { pTrue } from "../index.ts";
import { evalThrowsOutcome } from "../check-may-throw.ts";

const updSrc = `export function f(g) { return g().x++; }`;

describe("Bug 380：转译失败的求值结局（单元层）", () => {
  it("转译器拒绝 ⇒ 结局是 unanalyzable（不是 analyzed / absent）", () => {
    const out = evalThrowsOutcome(updSrc, "f", []);
    expect(out.kind).toBe("unanalyzable");
    if (out.kind !== "unanalyzable") return;
    expect(out.reason).toContain("unsupported:");
  });

  it("可分析的入口 ⇒ 结局仍是 analyzed（fail-closed 不得误伤正常路径）", () => {
    const src = `export function f(g) { return g().x; }`;
    const out = evalThrowsOutcome(src, "f", []);
    expect(out.kind).toBe("analyzed");
  });
});
