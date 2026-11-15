/**
 * Bug 992 —— push 与 pull 两个诊断面**不一致**（env 通道缺失）。
 *
 * 症状：同一个文件，push 面（`publishDiagnostics`）有 `nudo:env-unresolved`
 * 告警，pull 面（`textDocument/diagnostic`）没有 ⇒ IDE 里看到的诊断集合
 * 取决于客户端用哪个面拉取 ⇒ 结论不可复现。
 *
 * 根因（片 D · `server.ts`）：pull 通道只接了 check 通道 + evaluator 通道，
 * **没有**接 env 通道（`envUnresolvedDiags`，片 E 从 `validation.ts` 导出）。
 *
 * 修法：pull 通道补上 env 通道——与 push **同源同档**（同一 level、同一
 * `filterCheckLspByLevel`、同一去重键空间）。
 *
 * 钉：push 与 pull 的诊断 code 集合**完全一致**（不是「pull ⊇ push」这种
 * 弱断言——两个面必须同形）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SRC = '/// @nudo:env "./nope.mjs"\nexport function g2() {\n  return 1;\n}\n';

describe("Bug 992 — push 与 pull 诊断面同形（env 通道 parity）", () => {
  it("push 与 pull 的诊断 code 集合一致", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug992-"));
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

      const pushed = mock.sentDiagnostics
        .filter((d) => d.uri === uri)
        .flatMap((d) => d.diagnostics as { code?: string }[]);
      const pushCodes = [...new Set(pushed.map((d) => d.code))].sort();

      const pulled = (await mock.requests.get("textDocument/diagnostic")!({
        textDocument: { uri },
      })) as { items?: { code?: string }[] };
      const pullCodes = [...new Set((pulled.items ?? []).map((d) => d.code))].sort();

      expect(pushCodes.length).toBeGreaterThan(0);
      expect(pullCodes).toEqual(pushCodes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
