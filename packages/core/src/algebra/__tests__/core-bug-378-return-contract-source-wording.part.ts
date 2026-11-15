/**
 * Bug 378 回归钉 —— 返回契约的诊断文案**硬指 `@nudo:contract return`** ⇒
 * 约束来源是**侧车 `fn()` 返回槽**时也被说成「源码里那条指令」⇒ 源文件里
 * **根本没有**这条指令，而同一条诊断的 `fix:` 提示又说「emit a sidecar
 * draft」⇒ 一条诊断里两处归因互相矛盾。
 *
 * 修法（族 07 片 S4）：文案反映**真实约束来源**——
 * - 源码里有 `@nudo:contract return <name>` ⇒ 仍说 `@nudo:contract return <name>`；
 * - 约束来自侧车 `fn({...}, <ret>)` 的返回槽 ⇒ 说 `sidecar fn() return slot (...)`。
 *
 * 钉：侧车来源 ⇒ 消息**不得**出现 `@nudo:contract return`；源码指令来源 ⇒ 消息
 * **必须**仍是 `@nudo:contract return <name>`（对照组，防过度改写）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

/** 侧车：只有 `fn()` 返回槽有约束，源码里没有 `@nudo:contract` */
const sidecarOnly = `import { fn, number } from "@nudojs/core";
export const bad = fn({}, number().gt(0));
`;

describe("Bug 378 — 返回契约文案反映真实约束来源", () => {
  it("侧车 fn() 返回槽来源 ⇒ 消息说 sidecar，不得说源码指令", () => {
    const r = checkSource(
      "/t/bug378-sidecar.js",
      `export function bad() {
  return -1;
}
`,
      pTrue,
      {
        loadModule: (spec: string): string | undefined =>
          spec.endsWith(".nudo.js") ? sidecarOnly : undefined,
        fromFile: "/t/bug378-sidecar.js",
      },
    );
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.message).toContain("sidecar fn() return slot");
    expect(violated!.message).not.toContain("@nudo:contract return");
  });

  it("源码 @nudo:contract return 来源 ⇒ 消息仍是 @nudo:contract return <name>（对照组）", () => {
    const r = checkSource(
      "/t/bug378-directive.js",
      `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract return positive
 */
export function bad() {
  return -1;
}
`,
      pTrue,
      {
        loadModule: (spec: string): string | undefined =>
          spec.endsWith("std.nudo.js")
            ? `export const positive = number().gt(0);`
            : undefined,
        fromFile: "/t/bug378-directive.js",
      },
    );
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.message).toContain("@nudo:contract return positive");
    expect(violated!.message).not.toContain("sidecar fn() return slot");
  });
});
