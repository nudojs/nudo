/**
 * Bug 777 —— `workspace/didChangeConfiguration` 的部分载荷把宿主的
 * `nudo.analysis.mode` 默认值**抹成 undefined**。
 *
 * 症状：初始化时 `analysis.mode = "all"`（宿主设置），一次**部分**或**无关**
 * 的设置变更后，分析范围收缩回产品默认（exports）⇒ 原本能分析的文件
 * 不再被分析 ⇒ hover 从有值变 null。
 *
 * 根因（片 D · `server.ts`）：server 把 `params.settings.nudo.*` 当**整棵
 * 子树**读——载荷没提到的键直接读成 `undefined` ⇒ 覆盖掉旧值。扁平键
 * （`"nudo.analysis.mode"`）也完全不被识别。
 *
 * 修法：宿主设置改为**累积合并树**——
 * - 新载荷出现的键覆盖旧值；**未出现的键保留旧值**；`null` = 显式重置；
 * - 扁平键按点号展开成嵌套路径（与嵌套形态等价）；
 * - 读取一律走合并树（`readSettingsPath`）。
 *
 * 钉：① 部分载荷（只带 inlayHints）后 hover 仍在；② 无关载荷（editor.*）
 * 后 hover 仍在；③ 扁平键 `"nudo.analysis.mode": "exports"` **必须被采纳**
 * （hover 变 null）；④ 整棵载荷 `"all"` 后 hover 回来。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 无 export 的文件：只有 mode=all 才会被分析 ⇒ hover 是「分析范围」的探针。 */
const SRC = "function boom(x) {\n  return x + 1;\n}\nboom;\n";

function hoverText(mock: ReturnType<typeof createMockConnection>, uri: string): string | null {
  const hover = mock.requests.get("textDocument/hover")!;
  const res = hover({
    textDocument: { uri },
    position: { line: 0, character: 10 },
  }) as { contents?: { value?: string } } | null;
  return res?.contents?.value ?? null;
}

describe("Bug 777 — 配置变更不得抹掉未提及的宿主设置", () => {
  it("部分载荷 / 无关载荷 / 扁平键：analysis.mode 不被抹掉", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug777-"));
    try {
      const file = join(dir, "a.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.requests.get("initialize")!({
        processId: null,
        rootUri: `file://${dir}`,
        workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
        capabilities: {},
        initializationOptions: { analysis: { mode: "all" } },
      });
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await sleep(500);
      expect(hoverText(mock, uri)).toContain("boom");

      const change = mock.notifications.get("workspace/didChangeConfiguration")!;

      // ① 部分载荷：只带 inlayHints ⇒ analysis.mode 保留
      change({ settings: { nudo: { inlayHints: { parameters: true } } } });
      await sleep(400);
      expect(hoverText(mock, uri)).toContain("boom");

      // ② 无关载荷：整棵 editor.* ⇒ analysis.mode 保留
      change({ settings: { editor: { fontSize: 12 } } });
      await sleep(400);
      expect(hoverText(mock, uri)).toContain("boom");

      // ③ 扁平键必须被**采纳**（等价于嵌套 nudo.analysis.mode）
      change({ settings: { "nudo.analysis.mode": "exports" } });
      await sleep(400);
      expect(hoverText(mock, uri)).toBeNull();

      // ④ 整棵载荷：显式回到 all ⇒ hover 回来
      change({ settings: { nudo: { analysis: { mode: "all" } } } });
      await sleep(400);
      expect(hoverText(mock, uri)).toContain("boom");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("显式 null = 重置（回落产品默认 exports）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug777-"));
    try {
      const file = join(dir, "a.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.requests.get("initialize")!({
        processId: null,
        rootUri: `file://${dir}`,
        workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
        capabilities: {},
        initializationOptions: { analysis: { mode: "all" } },
      });
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await sleep(500);
      expect(hoverText(mock, uri)).toContain("boom");
      mock.notifications.get("workspace/didChangeConfiguration")!({
        settings: { nudo: { analysis: { mode: null } } },
      });
      await sleep(400);
      expect(hoverText(mock, uri)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
