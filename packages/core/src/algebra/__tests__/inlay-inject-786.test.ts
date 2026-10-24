/**
 * Bug 786（inlay 半）—— `collectAbsInlays` **从不传 `inject`**
 * ⇒ LSP 的 inlayHint 面（`textDocument/inlayHint`）把「行内指令缺席」显示成
 * `unknown`（Nudo 词汇里 = 「推断失败」）而 CLI 门禁显示真实类型。
 *
 * 根因：`@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局走 core 的
 * **`inject` 通道**（`RunTranspiledOptions`）；`CollectAbsInlaysOpts` 此前
 * **连 `inject` 字段都没有** ⇒ `generalizeFromAst` 拿不到覆盖表 ⇒ 推导链
 * 塌缩 unknown。
 *
 * 修法（片 F）：`CollectAbsInlaysOpts` 加 `inject` 字段（既有导出类型加
 * 字段 ⇒ 零新增 core 导出 ⇒ 不破 core 冻结面），并透传给
 * `generalizeFromAst`（只改内部函数体）。
 *
 * 钉：注入生效 ⇒ inlay label 是 `: 42`（env 全局注入）；不注入 ⇒ `: unknown`。
 */
import { describe, it, expect } from "vitest";
import { collectAbsInlays } from "../inlay.ts";
import { num } from "../abs.ts";

/** `MAGIC` 是自由标识符：缺 env 注入时未绑定 ⇒ 求值被拦 ⇒ unknown */
const SRC = `export function useGlobal() {
  return MAGIC;
}
`;

describe("Bug 786（inlay 半）— collectAbsInlays 必须透传 inject", () => {
  it("不传 inject ⇒ 自由标识符未绑定 ⇒ inlay 是 never（改前形态）", () => {
    const inlays = collectAbsInlays(SRC, { fromFile: "/tmp/x/lib.js" });
    const labels = inlays.map((i) => i.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((l) => l.includes(": never")), JSON.stringify(labels)).toBe(true);
    expect(labels.some((l) => l.includes(": number")), JSON.stringify(labels)).toBe(false);
  });

  it("传 inject ⇒ inlay 显示注入后的真实类型（: number）", () => {
    const inlays = collectAbsInlays(SRC, {
      fromFile: "/tmp/x/lib.js",
      inject: { envGlobals: { MAGIC: num() } },
    });
    const labels = inlays.map((i) => i.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(
      labels.some((l) => l.includes(": number")),
      `inlay 仍未应用注入：${JSON.stringify(labels)}`,
    ).toBe(true);
    expect(
      labels.some((l) => l.includes(": never")),
      `inlay 仍塌缩成 never：${JSON.stringify(labels)}`,
    ).toBe(false);
  });
});
