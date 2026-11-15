/**
 * Bug 784 —— 畸形 workspace URI 让**整个 initialize 抛出去**。
 *
 * 症状：客户端送来一个百分号转义非法的 URI（如 `file:///tmp/proj%zz`）⇒
 * `uriToFilePath` 里的裸 `decodeURIComponent` 抛 `URIError` ⇒ initialize
 * 整个失败 ⇒ 客户端拿不到 capabilities ⇒ **整个语言服务器会话起不来**
 * （一个坏根目录毁掉全部功能）。
 *
 * 根因（片 D · `server.ts`）：`onInitialize` 对每个 workspace folder 的
 * `uriToFilePath` **没有兜底**。
 *
 * 修法：逐个 folder 兜底——畸形 URI **跳过该 folder** + 记一条可读告警，
 * 其余 folder 与 `rootUri` 照常处理 ⇒ initialize 正常返回 capabilities。
 *
 * 钉：① 畸形 workspaceFolders[0].uri ⇒ initialize 不抛、返回 capabilities；
 * ② 畸形 rootUri ⇒ 同上；③ 正常 URI 不受影响。
 */
import { describe, it, expect } from "vitest";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

function initWith(params: Record<string, unknown>): { capabilities?: Record<string, unknown> } {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const init = mock.requests.get("initialize")!;
  return init({ processId: null, capabilities: {}, ...params }) as {
    capabilities?: Record<string, unknown>;
  };
}

describe("Bug 784 — 畸形 URI 不得让 initialize 整个失败", () => {
  it("畸形 workspaceFolders[0].uri ⇒ 跳过该 folder，initialize 照常返回", () => {
    const res = initWith({
      rootUri: null,
      workspaceFolders: [{ uri: "file:///tmp/proj%zz", name: "x" }],
    });
    expect(res.capabilities).toBeDefined();
    expect(Object.keys(res.capabilities ?? {}).length).toBeGreaterThan(0);
  }, 30_000);

  it("畸形 rootUri ⇒ 跳过该根，initialize 照常返回", () => {
    const res = initWith({ rootUri: "file:///tmp/a%2", workspaceFolders: null });
    expect(res.capabilities).toBeDefined();
    expect(Object.keys(res.capabilities ?? {}).length).toBeGreaterThan(0);
  }, 30_000);

  it("正常 URI 不受影响（仍返回 capabilities）", () => {
    const res = initWith({
      rootUri: "file:///tmp/nudo-784-ok",
      workspaceFolders: [{ uri: "file:///tmp/nudo-784-ok", name: "ok" }],
    });
    expect(res.capabilities).toBeDefined();
  }, 30_000);
});
