/**
 * Bug 759 —— **上游已修（报告结论不成立）**：反向钉，钉住「当前行为正确」。
 *
 * 报告称 `nudo/suggestCase` 把**合成见证**（`call@` / `entry@`）当成用户
 * 手写的 `@nudo:case`，于是「already has N case(s)」并拒绝再建议。
 * 实测：上游已把「已声明 case（source = "directive"）」与「合成见证
 * （source ≠ "directive"）」**分开计数**——只有合成见证时走「synthesized
 * case(s); suggested directives」并给出可粘贴指令；只有手写指令时才报
 * 「already has N case(s)」。
 *
 * 本钉锁住该行为：改前（HEAD）与改后都必须绿。**不改产品代码。**
 */
import { describe, it, expect } from "vitest";
import { suggestCase } from "../agent-tools.ts";

describe("Bug 759 反向钉：suggestCase 区分「已声明 case」与「合成见证」", () => {
  it("只有合成见证（call@）时给建议，不报 'already has N case(s)'", async () => {
    const src = [
      "export function add(a, b) { return a + b; }",
      "const r = add(1, 2);",
      "",
    ].join("\n");
    const r = await suggestCase(
      { file: "/t/a4-759.js", functionName: "add", source: src },
      { readFile: () => src },
    );
    expect(r.content[0].text).toContain("synthesized case(s)");
    expect(r.content[0].text).toContain("suggested directives:");
    expect(r.content[0].text).not.toContain("already has");
  });

  it("手写 @nudo:case 时报 'already has 1 case(s)'（且不重复建议）", async () => {
    const src = ['// @nudo:case "one" (1)', "function inc(n) { return n + 1; }", ""].join("\n");
    const r = await suggestCase(
      { file: "/t/a4-759b.js", functionName: "inc", source: src },
      { readFile: () => src },
    );
    expect(r.content[0].text).toBe('Function "inc" already has 1 case(s)');
  });
});
