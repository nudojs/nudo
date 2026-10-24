/**
 * D3（族 22 / lsp-signature）共享 harness：起**真 LSP server**（内存 mock
 * connection）+ 打开若干文件 + 发真协议请求。
 *
 * 只服务 D3 自己的测试文件（`lsp-bug-70x|71x|72x-*.test.ts`），
 * 不改动 `helpers.ts`（共享文件，避免与其它分片冲突）。
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

export type LspLocation = {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
};

export type LspEdit = LspLocation & { newText: string };

export type LspHarness = {
  /** 发起协议请求（textDocument/definition / references / rename …） */
  req: (method: string, params: unknown) => any;
  /** 文档 uri */
  uri: (name: string) => string;
  /** 目录（清理前） */
  dir: string;
  /** 模拟一次未保存的编辑（buffer 变、磁盘不变） */
  changeBuffer: (name: string, text: string) => void;
  cleanup: () => void;
};

/** 起真 server、落盘并打开给定文件 */
export async function startLspWithFiles(files: Record<string, string>): Promise<LspHarness> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-d3-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, "utf-8");
  }
  const mock = createMockConnection();
  createNudoServer(mock as never);
  for (const [name, text] of Object.entries(files)) {
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: {
        uri: `file://${join(dir, name)}`,
        languageId: "javascript",
        version: 1,
        text,
      },
    });
  }
  await new Promise((r) => setTimeout(r, 300));
  return {
    req: (method, params) => mock.requests.get(method)!(params),
    uri: (name) => `file://${join(dir, name)}`,
    dir,
    changeBuffer: (name, text) => {
      mock.notifications.get("textDocument/didChange")!({
        textDocument: { uri: `file://${join(dir, name)}`, version: 2 },
        contentChanges: [{ text }],
      });
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** 协议响应（Location[]）⇒ 可断言的位点列表（文件名 + 0 基行列） */
export function locationsOf(result: unknown): LspLocation[] {
  if (!Array.isArray(result)) return [];
  return result.map((loc: any) => ({
    file: String(loc.uri ?? "").split("/").pop() ?? "",
    line: loc.range?.start?.line ?? -1,
    character: loc.range?.start?.character ?? -1,
    endLine: loc.range?.end?.line ?? -1,
    endCharacter: loc.range?.end?.character ?? -1,
  }));
}

/** 协议响应（WorkspaceEdit）⇒ 可断言的编辑列表 */
export function editsOf(result: unknown): LspEdit[] {
  const changes = (result as any)?.changes;
  if (!changes) return [];
  const out: LspEdit[] = [];
  for (const [uri, edits] of Object.entries(changes as Record<string, any[]>)) {
    for (const e of edits) {
      out.push({
        file: String(uri).split("/").pop() ?? "",
        line: e.range.start.line,
        character: e.range.start.character,
        endLine: e.range.end.line,
        endCharacter: e.range.end.character,
        newText: e.newText,
      });
    }
  }
  return out;
}
