/**
 * Bug 786（hover 半）—— hover 的签名面**从不传 `inject`**
 * ⇒ IDE 显示 `unknown`（Nudo 词汇里 = 「推断失败」）而 CLI 门禁显示
 * `number`/`string` ⇒ 跨产品面自相矛盾，且违反 lsp.md 明写的
 * “check-identical signature” 承诺。
 *
 * 修法（片 C：`hover.ts` 单一 owner）：`HoverInterfaceOpts` 增 `inject`
 * 字段并透传给 hover.ts 的 **3 处** `generalizeFromAst`（函数名面 /
 * 形参面 / 无 ident 位的重放面）。装配器在片 F 的
 * `agent-tools.ts#buildLspInjection`（与 CLI 的 `buildCheckInjection`
 * 同口径）——**core 零新增导出**。
 *
 * 本钉只覆盖 hover 的事实面（`getHoverAtPosition` 的 opts 通道）；
 * 协议面（`textDocument/hover`）的 inject 装配在 server 侧装配器接线
 * 处（`server-ide.ts`，非本片独占文件）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHoverAtPosition } from "../lsp-surface.ts";
import { buildLspInjection } from "../agent-tools.ts";

/** `@nudo:replace` ⇒ `raw` 是 number ⇒ `raw.toFixed(2)` 返回 string */
const SRC = `function makeRaw() {
  return "abc";
}

// @nudo:replace makeRaw() number()
const raw = makeRaw();

export function usesRaw() {
  return raw.toFixed(2);
}
`;

function fixture(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug786-hover-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug786-hover", private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, "usesraw.js");
  writeFileSync(file, SRC, "utf-8");
  return { dir, file };
}

describe("Bug 786（hover 半）—— hover 的签名面必须接收 inject 通道", () => {
  it("注入生效：hover 签名给出推断类型（改前塌缩成 unknown）", () => {
    const { dir, file } = fixture();
    try {
      const inject = buildLspInjection(file, SRC);
      // `usesRaw` 声明名（第 8 行，列 16）
      const hover = getHoverAtPosition(file, SRC, 8, 16, undefined, { inject });
      const sig = hover?.signature ?? "";
      expect(sig).toContain("string");
      expect(sig).not.toContain("unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未注入（对照）：推导链塌缩成 unknown ⇒ inject 通道确实是分水岭", () => {
    const { dir, file } = fixture();
    try {
      const hover = getHoverAtPosition(file, SRC, 8, 16);
      const sig = hover?.signature ?? "";
      expect(sig).toContain("unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
