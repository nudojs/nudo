/**
 * IDE 特性面：hover / completion / codeLens / inlayHint / signatureHelp / semanticTokens。
 * 自 server.ts 机械拆出；语义未改。
 */
import { dirname } from "node:path";
import {
  MarkupKind,
  CompletionItemKind,
  type Connection,
  type CodeLens,
  type InlayHint,
  InlayHintKind,
  type CompletionItem as LspCompletionItem,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  getTypeAtPosition,
  getHoverAtPosition,
  getCompletionsAtPosition,
} from "./lsp-surface.ts";
import { buildSemanticTokens } from "./semantic-tokens.ts";
import {
  isNudoTargetPath,
  shouldAnalyzeFile,
  findProjectConfig,
  interfaceConfig,
} from "@nudojs/service";
import type { LoadModule } from "@nudojs/service";
import { formatInterfaceTierLine } from "@nudojs/core";
import { collectAbsInlays } from "@nudojs/core/internal";
import { parse } from "@nudojs/parser";
import traverse from "@babel/traverse";
import type { CallExpression, Node } from "@babel/types";
import { buildSignatureHelp } from "./signature-help.ts";
import {
  getCachedOrAnalyze,
  cachedAstFor,
  evalAnalysisModules,
  uriToFilePath,
  type ValidateTextDeps,
} from "./validation.ts";
import {
  computeInterfaceLenses,
  computeObservationLenses,
  type AgentToolDeps,
} from "./agent-tools.ts";


export type IdeDeps = {
  connection: Connection;
  getDocument: (uri: string) => TextDocument | undefined;
  listDocuments: () => TextDocument[];
  isNudoFile: (uri: string) => boolean;
  getActiveCases: (uri: string) => Map<string, number>;
  activeLoadModule: LoadModule;
  agentToolDeps: AgentToolDeps;
};

export function attachHover(deps: IdeDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const isNudoFile = deps.isNudoFile;
  const getActiveCasesForUri = deps.getActiveCases;
  const activeLoadModule = deps.activeLoadModule;

  connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    if (!isNudoFile(params.textDocument.uri)) return null;

    const filePath = uriToFilePath(params.textDocument.uri);
    const source = document.getText();
    const line = params.position.line + 1;
    const column = params.position.character;
    const cases = getActiveCasesForUri(params.textDocument.uri);
    const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;

    try {
      // P-IDE1：先过 getCachedOrAnalyze——同一未变文件的连续 hover 只跑一次
      // 全量分析；lsp-surface 直接复用 result.bindings + 条目 AST，
      // 不再每次 transpile + new Function 整文件求值。
      const result = getCachedOrAnalyze(
        filePath,
        source,
        document.version,
        cases,
        activeLoadModule,
      );
      const ast = cachedAstFor(filePath, source);
      // intension generalize 需要模块图：缺图 → 跨模块调用 unknown
      const analysisModules = evalAnalysisModules(filePath, source);
      // A7：interface 档与 CodeLens 同源——default 走 symbolic + entryReqs；
      // 选 case 时 body 仍走 activeCases 重放，interface 标注不变
      const hover = getHoverAtPosition(filePath, source, line, column, cases, {
        loadModule: activeLoadModule,
        ...(autoBind === false ? { autoBind: false } : {}),
      }, {
        ...(ast !== undefined ? { ast } : {}),
        result,
        ...(analysisModules ? { modules: analysisModules } : {}),
      });
      if (!hover) return null;

      const lines: string[] = [];
      // 与 CodeLens `● interface / <source>` 同源首行（A7 验收）
      if (hover.interfaceSource) {
        lines.push(formatInterfaceTierLine(hover.interfaceSource));
        if (hover.interfaceDisplay && hover.interfaceSource !== "implicit") {
          lines.push("```nudo", hover.interfaceDisplay, "```");
        }
      }
      // 无损 Abs 优先（类型即计算本体）
      if (hover.absMultiline) {
        lines.push("```nudo", hover.absMultiline, "```");
      } else if (hover.abs) {
        lines.push("```nudo", hover.abs, "```");
      }
      if (hover.intension && hover.intension !== hover.abs) {
        lines.push("```nudo", hover.intension, "```");
      }
      // 外延 TypeValue 仅作对照，且与内涵不同时才显示
      if (hover.typeText && hover.typeText !== hover.intension && hover.typeText !== hover.abs) {
        lines.push("```nudo", `ext: ${hover.typeText}`, "```");
      }
      if (lines.length === 0) {
        lines.push("```nudo", hover.typeText, "```");
      }
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: lines.join("\n"),
        },
      };
    } catch (err) {
      connection.console.error(
        `nudo hover failed for ${params.textDocument.uri}: ${(err as Error).message}`,
      );
      return null;
    }
  });
}

export function attachCompletion(deps: IdeDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const isNudoFile = deps.isNudoFile;
  const activeLoadModule = deps.activeLoadModule;

  const NUDO_DIRECTIVE_COMPLETIONS: Array<{ label: string; detail: string; insert?: string }> = [
    { label: "@nudo:contract", detail: "L1 contract — param / return obligation", insert: "@nudo:contract " },
    { label: "@nudo:case", detail: "Debug witness (nudo test / LSP only)", insert: '@nudo:case "' },
    { label: "@nudo:as", detail: "Override next statement type", insert: "@nudo:as " },
    { label: "@nudo:replace", detail: "Replace sub-expression type", insert: "@nudo:replace " },
    { label: "@nudo:mock", detail: "Mock dependency implementation", insert: "@nudo:mock " },
    { label: "@nudo:mock-module", detail: "Replace imported module with mocks", insert: "@nudo:mock-module " },
    { label: "@nudo:pure", detail: "Memoize pure function evaluation", insert: "@nudo:pure" },
    { label: "@nudo:skip", detail: "Skip inference; use declared type", insert: "@nudo:skip " },
    { label: "@nudo:sample", detail: "Control loop iteration sampling", insert: "@nudo:sample " },
    { label: "@nudo:import", detail: "Import constraint templates from *.nudo.js", insert: "@nudo:import " },
    { label: "@nudo:env", detail: "Declare runtime env (es / web / node)", insert: "@nudo:env " },
  ];

  connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    if (!isNudoFile(params.textDocument.uri)) return [];

    const filePath = uriToFilePath(params.textDocument.uri);
    const source = document.getText();
    const line = params.position.line + 1;
    const column = params.position.character;

    // 指令面优先：光标在注释 / `@nudo` 前缀内
    const curLine = source.split("\n")[params.position.line] ?? "";
    const before = curLine.slice(0, params.position.character);
    if (/(\/\/|\/\*|\*|\/\*\*)\s*@?n?u?d?o?:?$/.test(before) || /@nudo:?[\w-]*$/.test(before)) {
      const prefix = /@nudo:?[\w-]*$/.exec(before)?.[0] ?? "";
      return NUDO_DIRECTIVE_COMPLETIONS.filter(
        (d) => !prefix || d.label.startsWith(prefix) || d.label.includes(prefix),
      ).map((d): LspCompletionItem => ({
        label: d.label,
        kind: CompletionItemKind.Keyword,
        detail: d.detail,
        insertText: d.insert ?? d.label,
      }));
    }

    try {
      // P-IDE1：completion 走同源 analysisCache——接收者/变量绑定直接读
      // result.bindings，不再每次整文件求值
      const result = getCachedOrAnalyze(
        filePath,
        source,
        document.version,
        undefined,
        activeLoadModule,
      );
      const items = getCompletionsAtPosition(filePath, source, line, column, { result });
      return items.map((item): LspCompletionItem => ({
        label: item.label,
        kind: item.kind === "method"
          ? CompletionItemKind.Method
          : item.kind === "property"
            ? CompletionItemKind.Property
            : CompletionItemKind.Variable,
        detail: item.detail,
      }));
    } catch (err) {
      connection.console.error(
        `nudo completion failed for ${params.textDocument.uri}: ${(err as Error).message}`,
      );
      return [];
    }
  });
}

export function attachCodeLens(deps: IdeDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const getActiveCasesForUri = deps.getActiveCases;
  const activeLoadModule = deps.activeLoadModule;
  const agentToolDeps = deps.agentToolDeps;

  connection.onCodeLens((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    // interface 档的目标场景就是零注解文件（侧车同名绑定，§2.1 主路径），
    // 因此这里放宽为 isNudoTargetPath 而非 isNudoFile——case 副层只依赖
    // 指令，注解文件行为不变；hover/inlayHint/semanticTokens 仍走 isNudoFile。
    if (!isNudoTargetPath(uriToFilePath(params.textDocument.uri))) return [];

    const filePath = uriToFilePath(params.textDocument.uri);
    const source = document.getText();
    const cases = getActiveCasesForUri(params.textDocument.uri);

    try {
      // interface 档在前（契约选项 + 固化动作），case 选项跟随其后
      // （design-refine-derivation §8）。观察选择器互斥：`●/○ contract / …` 与
      // `●/○ case "…"` 恰好一项激活——点击契约选项（nudo.selectContract）取消
      // 激活 case，点击 case（nudo.selectCase）则契约转 ○。
      const lenses: CodeLens[] = [];
      const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;
      for (const lens of computeInterfaceLenses(source, filePath, {
        loadModule: activeLoadModule,
        activeCases: cases,
        ...(autoBind === false ? { autoBind: false } : {}),
      })) {
        const range = {
          start: { line: lens.line - 1, character: 0 },
          end: { line: lens.line - 1, character: 0 },
        };
        if (lens.kind === "interface") {
          lenses.push({
            range,
            // 契约选项：点击切换回契约观察（取消激活 case；无激活时为幂等默认态）
            command: {
              title: formatInterfaceTierLine(lens.source, lens.active),
              command: "nudo.selectContract",
              arguments: [params.textDocument.uri, lens.fn],
            },
          });
        } else if (lens.kind === "emit") {
          lenses.push({
            range,
            command: {
              title: lens.mode === "add" ? "⚡ persist interface" : "↻ update interface",
              command: "nudo.contract.emit",
              arguments: [params.textDocument.uri, lens.fn, lens.mode],
            },
          });
        } else if (lens.kind === "draft") {
          lenses.push({
            range,
            command: {
              title: "⚡ draft interface",
              command: "nudo.contract.draft",
              arguments: [params.textDocument.uri, lens.fn],
            },
          });
        } else if (lens.kind === "case") {
          lenses.push({
            range,
            command: {
              title: lens.active ? `● case "${lens.caseName}"` : `○ case "${lens.caseName}"`,
              command: "nudo.selectCase",
              arguments: [params.textDocument.uri, lens.fn, lens.caseIndex, lens.caseName],
            },
          });
        } else if (lens.kind === "callsite" || lens.kind === "entry") {
          lenses.push({
            range,
            command: {
              title: lens.title,
              command: "nudo.trace",
              arguments: [params.textDocument.uri, lens.fn],
            },
          });
        }
      }

      // 合成 call@ / entry@ 观察层（CLI `nudo test` 的源码内投影）
      for (const lens of computeObservationLenses(source, filePath)) {
        lenses.push({
          range: {
            start: { line: lens.line - 1, character: 0 },
            end: { line: lens.line - 1, character: 0 },
          },
          command: {
            title: lens.title,
            command: "nudo.trace",
            arguments: [params.textDocument.uri, lens.fn],
          },
        });
      }

      return lenses;
    } catch (err) {
      connection.console.error(
        `nudo codeLens failed for ${params.textDocument.uri}: ${(err as Error).message}`,
      );
      return [];
    }
  });
}

export function attachInlayHint(deps: IdeDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const isNudoFile = deps.isNudoFile;
  const getActiveCasesForUri = deps.getActiveCases;
  const activeLoadModule = deps.activeLoadModule;

  connection.languages.inlayHint.on((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    if (!isNudoFile(params.textDocument.uri)) return [];

    const filePath = uriToFilePath(params.textDocument.uri);
    const source = document.getText();
    const cases = getActiveCasesForUri(params.textDocument.uri);
    const lines = source.split("\n");
    const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;

    try {
      const result = getCachedOrAnalyze(
        filePath,
        source,
        document.version,
        cases,
        activeLoadModule,
      );
      const hints: InlayHint[] = [];

      for (const hint of result.caseHints) {
        const lineIdx = hint.line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) continue;
        const lineLen = lines[lineIdx].length;

        hints.push({
          position: { line: lineIdx, character: lineLen },
          label: `  ${hint.label}`,
          kind: InlayHintKind.Type,
          paddingLeft: true,
        });
      }

      // Abs inlay：参数约束 + 返回 term/pred（类型即计算，无损）
      // A7：default 走 symbolic + entryReqs；与 CodeLens interface 档同源
      // modules：缺图时 generalize 看不到跨模块 import → 调用塌缩 unknown
      const analysisModules = evalAnalysisModules(filePath, source);
      try {
        for (const abs of collectAbsInlays(source, {
          loadModule: activeLoadModule,
          fromFile: filePath,
          ...(autoBind === false ? { autoBind: false } : {}),
          ...(analysisModules ? { modules: analysisModules } : {}),
        })) {
          const lineIdx = abs.line - 1;
          if (lineIdx < 0 || lineIdx >= lines.length) continue;
          hints.push({
            position: { line: lineIdx, character: abs.character },
            label: abs.label,
            kind:
              abs.kind === "parameter"
                ? InlayHintKind.Parameter
                : InlayHintKind.Type,
            paddingLeft: true,
          });
        }
      } catch (err) {
        // Abs inlay 失败不影响 caseHints（但必须可观测，不静默吞）
        connection.console.error(
          `nudo abs inlay failed for ${document.uri}: ${(err as Error).message}`,
        );
      }

      // LSP-G2：CodeLens 不可见的客户端（Helix 等）用 inlay 投影同源 interface 档
      // （`●/○ contract / hw|gen|imp`，与 CodeLens 同 computeInterfaceLenses）
      try {
        for (const lens of computeInterfaceLenses(source, filePath, {
          loadModule: activeLoadModule,
          activeCases: cases,
          ...(autoBind === false ? { autoBind: false } : {}),
        })) {
          if (lens.kind !== "interface") continue;
          const lineIdx = lens.line - 1;
          if (lineIdx < 0 || lineIdx >= lines.length) continue;
          const lineLen = (lines[lineIdx] ?? "").length;
          hints.push({
            position: { line: lineIdx, character: lineLen },
            label: `  ${formatInterfaceTierLine(lens.source, lens.active)}`,
            kind: InlayHintKind.Type,
            paddingLeft: true,
          });
        }
      } catch (err) {
        // interface inlay 失败不影响 case/Abs inlay（但必须可观测，不静默吞）
        connection.console.error(
          `nudo interface inlay failed for ${document.uri}: ${(err as Error).message}`,
        );
      }

      return hints;
    } catch (err) {
      connection.console.error(
        `nudo inlayHint failed for ${params.textDocument.uri}: ${(err as Error).message}`,
      );
      return [];
    }
  });
}

export function attachSignatureHelp(deps: IdeDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const isNudoFile = deps.isNudoFile;
  const getActiveCasesForUri = deps.getActiveCases;
  const activeLoadModule = deps.activeLoadModule;

  connection.onSignatureHelp((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    if (!isNudoFile(params.textDocument.uri)) return null;

    const filePath = uriToFilePath(params.textDocument.uri);
    const source = document.getText();
    const line = params.position.line + 1;
    const column = params.position.character;
    const cases = getActiveCasesForUri(params.textDocument.uri);

    try {
      // P-IDE1：callee 类型查询走同源 analysisCache（result.bindings + 条目 AST）
      const result = getCachedOrAnalyze(
        filePath,
        source,
        document.version,
        cases,
        activeLoadModule,
      );
      const ast = cachedAstFor(filePath, source) ?? parse(source);
      const callInfo = findEnclosingCall(ast, line, column);
      if (!callInfo) return null;

      const fnAbs = getTypeAtPosition(
        filePath,
        source,
        callInfo.calleeLine,
        callInfo.calleeCol,
        cases,
        { result, ast },
      );
      return fnAbs ? buildSignatureHelp(fnAbs, callInfo.currentParamIndex) : null;
    } catch (err) {
      connection.console.error(
        `nudo signatureHelp failed for ${params.textDocument.uri}: ${(err as Error).message}`,
      );
      return null;
    }
  });
}

/**
 * 光标所在的（最外层）调用表达式 + 当前参数下标。
 * Babel traverse 实现（P-IDE7）：区间判定含列（旧手写 visitor 只比行号），
 * 参数下标看完整区间（cursor 落在参数 i 内 → i；在其结尾/逗号后 → i+1），
 * 跨行参数不再被「start 在前 → +1」误判。
 * 导出供测试（monorepo 内部面，非 npm 公共契约）。
 */
export function findEnclosingCall(
  ast: Node,
  line: number,
  column: number,
): { calleeLine: number; calleeCol: number; currentParamIndex: number } | null {
  const raw = (
    typeof traverse === "function" ? traverse : (traverse as unknown as { default?: typeof traverse }).default
  );
  if (typeof raw !== "function") return null;
  const traverseFn = raw;
  let result: { calleeLine: number; calleeCol: number; currentParamIndex: number } | null = null;
  try {
    traverseFn(ast, {
      CallExpression(path) {
        if (result) return;
        const node = path.node;
        const loc = node.loc;
        const calleeLoc = node.callee?.loc;
        if (!loc || !calleeLoc) return;
        // 完整区间包含（行列）；旧实现只比行号，同行调用尾/换行处会误命中
        const contains =
          (loc.start.line < line || (loc.start.line === line && loc.start.column <= column)) &&
          (loc.end.line > line || (loc.end.line === line && loc.end.column >= column));
        if (!contains) return;
        result = {
          calleeLine: calleeLoc.start.line,
          calleeCol: calleeLoc.start.column,
          currentParamIndex: currentParamIndexOf(node, line, column),
        };
        // 命中后不下降（与旧手写 visitor 的首个命中即停同语义：外层调用优先）
        path.skip();
      },
    });
  } catch {
    return null;
  }
  return result;
}

/** 参数下标：cursor 在参数 i 区间内 → i；在第 i 个参数结尾（含其后逗号）→ i+1 */
function currentParamIndexOf(node: CallExpression, line: number, column: number): number {
  let idx = 0;
  for (let i = 0; i < node.arguments.length; i++) {
    const argLoc = node.arguments[i]!.loc;
    if (!argLoc) continue;
    const beforeStart =
      line < argLoc.start.line ||
      (line === argLoc.start.line && column < argLoc.start.column);
    const atOrAfterEnd =
      line > argLoc.end.line ||
      (line === argLoc.end.line && column >= argLoc.end.column);
    if (!beforeStart && !atOrAfterEnd) return i;
    if (atOrAfterEnd) idx = i + 1;
  }
  return Math.min(idx, node.arguments.length);
}

export function attachSemanticTokens(deps: IdeDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const isNudoFile = deps.isNudoFile;
  const activeLoadModule = deps.activeLoadModule;

  connection.languages.semanticTokens.on((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return { data: [] };
    if (!isNudoFile(params.textDocument.uri)) return { data: [] };

    try {
      const filePath = uriToFilePath(document.uri);
      const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;
      // A7：export 函数绑定带 contract/generated/derived modifier，与 CodeLens 同源
      return {
        data: buildSemanticTokens(filePath, document.getText(), {
          loadModule: activeLoadModule,
          ...(autoBind === false ? { autoBind: false } : {}),
        }),
      };
    } catch (err) {
      connection.console.error(
        `nudo semanticTokens failed for ${document.uri}: ${(err as Error).message}`,
      );
      return { data: [] };
    }
  });
}

