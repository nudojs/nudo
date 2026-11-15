/**
 * Bug 781 —— pull 诊断面**没有** env 通道。
 *
 * 症状：`@nudo:env` 指向的 path env 加载失败时，**push** 面（validateText）
 * 会发 `nudo:env-unresolved` 告警，**pull** 面（`textDocument/diagnostic`）
 * 一条都没有 ⇒ 同一个文件两个诊断面互相打脸（IDE 与 CI 结论不一致）。
 *
 * 根因（片 D · `server.ts`）：pull 通道只接了 check 通道 + evaluator 通道，
 * **没有**接 env 通道（`envUnresolvedDiags`，由片 E 从 `validation.ts` 导出）。
 *
 * 修法：pull 通道补上 env 通道——与 push **同源同档**
 * （`envUnresolvedDiags` + `filterCheckLspByLevel` + 同一 level）。
 *
 * 钉：pull 诊断里出现 `nudo:env-unresolved`。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SRC = '/// @nudo:env "./nope.mjs"\nexport function g2() {\n  return 1;\n}\n';

describe("Bug 781 — pull 诊断必须含 env 通道", () => {
  it("@nudo:env 指向缺失文件 ⇒ pull 里有 nudo:env-unresolved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug781-"));
    try {
      const file = join(dir, "d_env.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.requests.get("initialize")!({
        processId: null,
        rootUri: `file://${dir}`,
        workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
        capabilities: {},
      });
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await sleep(800);
      const res = (await mock.requests.get("textDocument/diagnostic")!({
        textDocument: { uri },
      })) as { kind?: string; items?: { code?: string; message?: string }[] };
      const codes = (res.items ?? []).map((d) => d.code);
      expect(codes).toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
