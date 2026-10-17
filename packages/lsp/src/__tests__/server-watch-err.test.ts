import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FileChangeType } from "vscode-languageserver/node";

// handleNudoDepFileChanged 注入失败形态：真实实现难以稳定抛错，
// 部分 mock validation.ts（其余导出原样透传）验证空 catch 已改为可见日志。
vi.mock("../validation.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../validation.ts")>();
  return {
    ...mod,
    handleNudoDepFileChanged: vi
      .fn()
      .mockRejectedValue(new Error("bad sidecar: EACCES")),
  };
});

import { handleWatchedFilesChanges } from "../server-watch.ts";

describe("watched-files 重检失败可见性", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it("dep 文件重检抛错时上屏 [nudo-lsp] 日志而非静默吞掉", async () => {
    const deps = {
      sendDiagnostics: () => {},
      isDocumentOpen: () => false,
      activeCases: new Map(),
      nudoFileCache: new Map(),
      validationDeps: () => ({}) as never,
      refreshPullDiagnostics: () => {},
      onDidChangeWatchedFiles: () => {},
    };
    handleWatchedFilesChanges(
      [{ uri: "file:///proj/shapes.nudo.js", type: FileChangeType.Changed }],
      deps.isDocumentOpen,
      deps,
    );
    // void promise 链在一个微任务后落进 catch
    await new Promise((r) => setTimeout(r, 0));
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [msg, err] = errSpy.mock.calls[0] as unknown as [string, Error];
    expect(msg).toContain("[nudo-lsp] dep file revalidate failed");
    expect(msg).toContain("shapes.nudo.js");
    expect(err.message).toContain("EACCES");
  });
});
