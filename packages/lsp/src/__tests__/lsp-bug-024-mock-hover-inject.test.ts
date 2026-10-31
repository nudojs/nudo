/**
 * Bug 024 —— LSP **协议面** hover 从不传 `inject` ⇒ `@nudo:mock` 覆盖表缺席
 * ⇒ 推导链塌缩成 `unknown`（Nudo 词汇里 = 「推断失败」），而 `nudo check`
 * 对同一函数给出精确类型。
 *
 * 已有回归 `lsp-bug-786-inject-handoff.test.ts` 只钉了 **agent 工具面**
 * （`buildLspInjection` 产物 + agent hover 载荷）⇒ 协议装配器漏传也没人发现。
 *
 * 修复：`server-ide.ts` 的协议 hover / inlayHint 用
 * `buildLspInjection(filePath, source, …)` 与 agent 面同源装配注入包。
 * 本钉打的是**真实 server 协议面**：hover 签名行必须是
 * `getUser() => { id: 1, name: "ada" }`，不得是 `unknown`。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLspInjection } from "../agent-tools.ts";
import { getHoverAtPosition } from "../lsp-surface/hover.ts";
import { withLspServer } from "./helpers.ts";

/** 与 `tmp/repro/bug-024/mockfx.js` 逐字同文（hover 坐标依赖固定行号） */
const SRC = [
  "/**",
  ' * @nudo:mock dep = (x) => ({ id: 1, name: "ada" })',
  " */",
  "export function getUser() {",
  '  return dep("u");',
  "}",
  "",
].join("\n");

/** `nudo check` 签名行（= 注入包在场时的精确类型） */
const PRECISE_SIG = 'getUser() => { id: 1, name: "ada" }';

type Hover = { contents: { value: string } } | null;

/** hover 的 ```nudo 代码块第一行（签名行） */
function nudoSigLine(contents: string): string {
  const lines = contents.split("\n");
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("Bug 024 — 协议面 hover 必须带注入包（@nudo:mock 覆盖表）", () => {
  it("真实 server 的 hover 签名行 = check 精确类型（不是 unknown）", async () => {
    await withLspServer({ "mockfx.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/hover")({
        textDocument: { uri: uri("mockfx.js") },
        position: { line: 3, character: 16 }, // `export function getUser` 的 getUser
      }) as Hover;
      const sig = nudoSigLine(res?.contents.value ?? "");
      expect(sig).toBe(PRECISE_SIG);
      expect(sig).not.toContain("unknown");
    });
  });

  it("纯装配面：注入包是精确类型的唯一来源（缺省 ⇒ unknown，传入 ⇒ 精确）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug024-"));
    try {
      const file = join(dir, "mockfx.js");
      writeFileSync(file, SRC, "utf-8");
      // `getHoverAtPosition` 的 line 参数是 **1-based**（= LSP position.line + 1）
      const withoutInject = getHoverAtPosition(file, SRC, 4, 16)?.signature;
      // 缺省 inject = 行内指令全部缺席 ⇒ 被 mock 的 dep 成未绑定名 ⇒ 推断失败
      expect(withoutInject).toBe("getUser() => unknown  throws ReferenceError");

      const withInject = getHoverAtPosition(file, SRC, 4, 16, undefined, {
        inject: buildLspInjection(file, SRC, {}),
      })?.signature;
      expect(withInject).toBe(PRECISE_SIG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
