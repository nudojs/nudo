/**
 * Bug 755 —— **报告结论不成立（假阳性）**：反向钉，钉住「当前行为正确」。
 *
 * 报告称 `nudo.whatIf` 注入假设后类型不变（自称「Bindings applied」却类型
 * 没变）。实测（probe-755b / A4 oracle）：`agent-tools.ts` 注入后**分析的
 * 就是注入后的 source**（`injectBindings` → `analyzeFile(注入后的 source)`），
 * 顶层 `const total = 1` + binding `{name:"total",type:"string"}` ⇒ 类型由
 * `1` 变 `string`。
 *
 * 本钉锁住该行为：改前（HEAD）与改后都必须绿。**不改产品代码。**
 */
import { describe, it, expect } from "vitest";
import { whatIf } from "../agent-tools.ts";

describe("Bug 755 反向钉：whatIf 注入假设后类型**确实**改变（报告为假阳性）", () => {
  it("顶层 const 的类型随 binding 改变（注入后的 source 被真正分析）", async () => {
    const src = "const total = 1;\n";
    const deps = { readFile: () => src };
    const base = await whatIf(
      { file: "/t/a4-755.js", bindings: [], target: "total", source: src },
      deps,
    );
    const assumed = await whatIf(
      {
        file: "/t/a4-755.js",
        bindings: [{ name: "total", type: "string" }],
        target: "total",
        source: src,
      },
      deps,
    );
    // 未注入：字面量 1
    expect(base.content[0].text).toContain('Type of "total": 1');
    // 注入 string ⇒ 类型变（报告声称此处「同型」——实测不成立）
    expect(assumed.content[0].text).toContain('Type of "total": string');
    expect(assumed.content[0].text).not.toBe(base.content[0].text);
    // 「Bindings applied」与类型自洽
    expect(assumed.content[0].text).toContain("Bindings applied: total: string");
  });
});
