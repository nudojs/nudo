/**
 * Bug 783 —— 工作区文件夹增删不生效（`workspaceRoots` 永久冻结）。
 *
 * 症状：多根工作区里，客户端新增/移除一个工作区文件夹后，server 仍按
 * `initialize` 时的老根集合行事 ⇒ 新加入的目录被写盘边界误拒
 * （"outside allowed roots"），已移出的目录**仍被授权**。
 *
 * 根因（片 D · `server.ts`）：`workspaceRoots` 的三个写入点**全在**
 * `onInitialize` 里 ⇒ 之后永不更新；server 也**从不订阅**
 * `workspace/didChangeWorkspaceFolders`。且 `onInitialize` 的 capabilities
 * 里没有 `workspace.workspaceFolders.changeNotifications` ⇒ 客户端
 * （vscode-languageclient 的 `WorkspaceFoldersFeature`）**根本不会发**这条
 * 通知 ⇒ 光订阅没用。
 *
 * 修法：
 * - capabilities 声明 `workspace.workspaceFolders.changeNotifications`；
 * - 订阅 `connection.workspace.onDidChangeWorkspaceFolders` ⇒ 增删根；
 * - 根集合变了 ⇒ 清 `nudoFileCache` + 重检已打开文档 + 广播
 *   `workspace/diagnostic/refresh`。
 *
 * 钉：① capabilities 声明了 changeNotifications；② 新增根后该目录被放行；
 * ③ 移除根后该目录被拒。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

const SRC = "export function f() {\n  return 1;\n}\n";

describe("Bug 783 — workspace/didChangeWorkspaceFolders 必须更新根集合", () => {
  it("声明 changeNotifications + 增删根即时生效（写盘边界跟着走）", async () => {
    const base = mkdtempSync(join(tmpdir(), "nudo-bug783-"));
    try {
      const a = join(base, "a");
      const b = join(base, "b");
      mkdirSync(a, { recursive: true });
      mkdirSync(b, { recursive: true });
      writeFileSync(join(a, "x.js"), SRC, "utf-8");
      writeFileSync(join(b, "y.js"), SRC, "utf-8");

      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const init = mock.requests.get("initialize")!;
      const res = init({
        processId: null,
        rootUri: `file://${a}`,
        workspaceFolders: [{ uri: `file://${a}`, name: "a" }],
        capabilities: {},
      }) as { capabilities?: { workspace?: unknown } };
      // 客户端只在 server 声明 changeNotifications 时才发该通知
      expect(res.capabilities?.workspace).toMatchObject({
        workspaceFolders: { changeNotifications: true },
      });

      const exec = mock.requests.get("workspace/executeCommand")!;
      const emitText = async (target: string): Promise<string> => {
        const r = (await exec({
          command: "nudo.contract.emit",
          arguments: [{ file: target, functionName: "f", mode: "add" }],
        })) as { content?: { text?: string }[] };
        return r.content?.[0]?.text ?? "";
      };

      // 初始：只有 a 在根集合里 ⇒ b 被拒
      expect(await emitText(join(b, "y.js"))).toContain("outside allowed roots");

      // 客户端新增 b ⇒ 立刻放行
      mock.fireWorkspaceFoldersChanged({ added: [{ uri: `file://${b}`, name: "b" }] });
      expect(await emitText(join(b, "y.js"))).not.toContain("outside allowed roots");

      // 客户端移除 a ⇒ a 立刻被拒（不再保留过期授权）
      mock.fireWorkspaceFoldersChanged({ removed: [{ uri: `file://${a}`, name: "a" }] });
      expect(await emitText(join(a, "x.js"))).toContain("outside allowed roots");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);
});
