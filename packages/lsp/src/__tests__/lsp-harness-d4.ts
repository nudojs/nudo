/**
 * D4（LSP 补全 + 语义 token 面）回归测试共享 harness。
 *
 * 与 `helpers.ts`（仓内通用 mock Connection）配套：这里只放 D4 这一族
 * 需要的「真 server 驱动」小工具——起 server、didOpen、发请求、解码
 * semantic token 相对五元组。
 *
 * 口径说明：
 * - `isNudoFile` 走 analysis.mode=exports（默认）⇒ 夹具必须带 `export`
 *   或 `@nudo:` 指令，否则 completion 直接返回 []（不是被测缺陷）。
 * - semantic token 的 line/char/length 均为 **UTF-16 code unit**。
 */
import { createNudoServer } from "../server.ts";
import { createMockConnection, type MockConnection } from "./helpers.ts";

export type DecodedToken = {
  line: number;
  char: number;
  length: number;
  typeIndex: number;
  modifiers: number;
};

export type LspCompletionItem = {
  label: string;
  kind: number;
  detail?: string;
  insertText?: string;
};

/** 解码 LSP 相对五元组（deltaLine/deltaStartChar/length/tokenType/tokenModifiers）。 */
export function decodeSemanticTokens(data: number[]): DecodedToken[] {
  const out: DecodedToken[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i]!;
    const deltaChar = data[i + 1]!;
    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;
    out.push({
      line,
      char,
      length: data[i + 2]!,
      typeIndex: data[i + 3]!,
      modifiers: data[i + 4]!,
    });
  }
  return out;
}

/** 起一个真 LSP server（mock transport）+ 打开一个文档。 */
export async function openLspDocument(
  text: string,
  uri: string,
): Promise<{ mock: MockConnection; uri: string }> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  // didOpen 走异步校验（分析 + 诊断），让出事件循环等它落定
  await new Promise((r) => setTimeout(r, 250));
  return { mock, uri };
}

/** 发 textDocument/completion。 */
export function requestCompletion(
  mock: MockConnection,
  uri: string,
  line: number,
  character: number,
): LspCompletionItem[] {
  const handler = mock.requests.get("textDocument/completion")!;
  return handler({ textDocument: { uri }, position: { line, character } }) as LspCompletionItem[];
}

/** 发 textDocument/semanticTokens/full。 */
export function requestSemanticTokens(
  mock: MockConnection,
  uri: string,
): DecodedToken[] {
  const handler = mock.requests.get("textDocument/semanticTokens/full")!;
  const res = handler({ textDocument: { uri } }) as { data: number[] };
  return decodeSemanticTokens(res.data);
}
