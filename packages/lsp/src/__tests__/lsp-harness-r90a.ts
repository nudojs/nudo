/**
 * 族 23 片 A（lsp-refactor：730 / 731 / 735 / 737 / 743）共享 harness：
 * 挂 `attachCodeActions`（内存 mock connection），拿 `textDocument/codeAction`
 * 的**动作面**（action 列表 + 逐条 edit 的 range/newText）。
 *
 * 只服务本片的 `lsp-bug-730|731|735|737|743-*.test.ts`；不改动共享的
 * `helpers.ts`（族 24 片 C 的地盘）——只复用它的 `createMockConnection`
 * 与 `withTempDir`。
 */
import { attachCodeActions } from "../server-code-actions.ts";
import { createMockConnection } from "./helpers.ts";

export type CodeActionPosition = { line: number; character: number };

export type CodeActionEdit = {
  range: { start: CodeActionPosition; end: CodeActionPosition };
  newText: string;
};

export type CodeActionEntry = {
  title: string;
  kind?: string;
  command?: { title?: string; command: string; arguments?: unknown[] };
  edit?: { changes: Record<string, CodeActionEdit[]> };
};

export type MountOpts = {
  /**
   * `agentToolDeps` 形态：
   * - `"none"`（缺省）= `undefined` —— **真 server 的挂载后状态**
   *   （server.ts 先建 ref 后回填 ⇒ 挂载期读到的就是 undefined，见 Bug 735）；
   * - `"buffer"` = 能读「编辑器打开缓冲」的形态（getOpenText 命中 openSidecar）。
   */
  agentToolDeps?: "none" | "buffer";
  /** 打开缓冲里的文本（按**文件路径**索引） */
  openSidecar?: Record<string, string>;
};

export type CodeActionHandler = (params: unknown) => CodeActionEntry[];

/** 挂上 codeAction 面，返回可直接调用的 handler */
export function mountCodeActions(
  uri: string,
  text: string,
  opts: MountOpts = {},
): CodeActionHandler {
  const mock = createMockConnection();
  const agentToolDeps =
    opts.agentToolDeps === "buffer"
      ? {
          getOpenText: (p: string) => {
            const buf = opts.openSidecar?.[p];
            return buf === undefined ? undefined : { text: buf };
          },
        }
      : undefined;
  attachCodeActions({
    connection: mock as unknown as never,
    getDocument: (u: string) =>
      u === uri ? ({ uri, getText: () => text } as never) : undefined,
    isNudoFile: () => true,
    agentToolDeps,
  } as never);
  const handler = mock.requests.get("textDocument/codeAction");
  if (!handler) throw new Error("codeAction handler not registered");
  return (params: unknown) => handler(params) as CodeActionEntry[];
}

/** 造一条 `nudo:constraint-violated`（missing field）诊断 */
export function missingFieldDiag(
  line: number,
  data: {
    expected?: string;
    actual?: string;
    fn?: string;
    suggestions?: string[];
  } = {},
): unknown {
  return {
    code: "nudo:constraint-violated",
    range: {
      start: { line, character: 0 },
      end: { line, character: 1 },
    },
    data: {
      expected: data.expected ?? "missing field u.name",
      actual: data.actual ?? "{ id: 2 }  #exact",
      fn: data.fn ?? "greet",
      suggestions: data.suggestions ?? ["add the missing field u.name"],
    },
  };
}

/** 造一条 `nudo:entry-may-throw` 诊断 */
export function entryMayThrowDiag(
  line: number,
  character: number,
  data: { fn?: string; actual?: string; expected?: string } = {},
): unknown {
  return {
    code: "nudo:entry-may-throw",
    range: {
      start: { line, character },
      end: { line, character: character + 1 },
    },
    data: {
      fn: data.fn ?? "alpha",
      actual: data.actual ?? "alpha(x: any) => any    throws TypeError",
      expected: data.expected ?? "entry total, or @nudo:throws / try-catch",
    },
  };
}

/** codeAction 请求参数 */
export function codeActionParams(
  uri: string,
  line: number,
  diagnostics: unknown[],
): unknown {
  return {
    textDocument: { uri },
    range: {
      start: { line, character: 0 },
      end: { line, character: 0 },
    },
    context: { diagnostics },
  };
}

/** 文档自身的 edit（URI === 文档 URI） */
export function docEdits(
  actions: CodeActionEntry[],
  docUri: string,
): CodeActionEdit[] {
  const out: CodeActionEdit[] = [];
  for (const a of actions) {
    for (const e of a.edit?.changes?.[docUri] ?? []) out.push(e);
  }
  return out;
}

/** 侧车的 edit（URI ≠ 文档 URI 的那一份） */
export function sidecarEdits(
  actions: CodeActionEntry[],
  docUri: string,
): CodeActionEdit[] {
  const out: CodeActionEdit[] = [];
  for (const a of actions) {
    for (const [u, edits] of Object.entries(a.edit?.changes ?? {})) {
      if (u === docUri) continue;
      out.push(...edits);
    }
  }
  return out;
}

/** 把 TextEdit 落到源码上（支持跨行 range；按起点倒序应用） */
export function applyEdits(src: string, edits: CodeActionEdit[]): string {
  const lines = src.split("\n");
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });
  for (const e of sorted) {
    const sl = e.range.start.line;
    const el = e.range.end.line;
    const head = (lines[sl] ?? "").slice(0, e.range.start.character);
    const tail = (lines[el] ?? "").slice(e.range.end.character);
    const parts = e.newText.split("\n");
    const merged = [head + (parts[0] ?? ""), ...parts.slice(1)];
    if (merged.length > 1) merged[merged.length - 1] = (merged[merged.length - 1] ?? "") + tail;
    else merged[0] = (merged[0] ?? "") + tail;
    lines.splice(sl, el - sl + 1, ...merged);
  }
  return lines.join("\n");
}
