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
  buildSemanticTokens,
  isNudoTargetPath,
  shouldAnalyzeFile,
  findProjectConfig,
  interfaceConfig,
} from "@nudojs/service";
import type { LoadModule } from "@nudojs/service";
import { collectAbsInlays } from "@nudojs/core/internal";
import { parse } from "@nudojs/parser";
import { buildSignatureHelp } from "./signature-help.ts";
import {
  getCachedOrAnalyze,
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
      // A7：interface 档与 CodeLens 同源——default 走 symbolic + entryReqs；
      // 选 case 时 body 仍走 activeCases 重放，interface 标注不变
      const hover = getHoverAtPosition(filePath, source, line, column, cases, {
        loadModule: activeLoadModule,
        ...(autoBind === false ? { autoBind: false } : {}),
      });
      if (!hover) return null;

      const lines: string[] = [];
      // 与 CodeLens `● interface / <source>` 同源首行（A7 验收）
      if (hover.interfaceSource) {
        lines.push(`● interface / ${hover.interfaceSource}`);
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
    } catch {
      return null;
    }
  });
}

export function attachCompletion(deps: IdeDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const isNudoFile = deps.isNudoFile;

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
      const items = getCompletionsAtPosition(filePath, source, line, column);
      return items.map((item): LspCompletionItem => ({
        label: item.label,
        kind: item.kind === "method"
          ? CompletionItemKind.Method
          : item.kind === "property"
            ? CompletionItemKind.Property
            : CompletionItemKind.Variable,
        detail: item.detail,
      }));
    } catch {
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
      // interface 档在前（默认层 + 固化动作），case 降为 debug 副层跟随其后
      // （design-refine-derivation §8）；标题与命令与既有 case lens 零改动。
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
            // 只读打印当前 contract（点击即 `nudo.contract`，无写盘）
            command: {
              title: `● interface / ${lens.source}`,
              command: "nudo.contract",
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
    } catch {
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
      try {
        for (const abs of collectAbsInlays(source, {
          loadModule: activeLoadModule,
          fromFile: filePath,
          ...(autoBind === false ? { autoBind: false } : {}),
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
      } catch {
        // Abs inlay 失败不影响 caseHints
      }

      // LSP-G2：CodeLens 不可见的客户端（Helix 等）用 inlay 投影同源 interface 档
      // （`● interface / handwritten|generated|implicit`，与 CodeLens 同 computeInterfaceLenses）
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
            label: `  ● interface / ${lens.source}`,
            kind: InlayHintKind.Type,
            paddingLeft: true,
          });
        }
      } catch {
        // interface inlay 失败不影响 case/Abs inlay
      }

      return hints;
    } catch {
      return [];
    }
  });
}

export function attachSignatureHelp(deps: IdeDeps): void {
  const connection = deps.connection;
  const documents = { get: deps.getDocument };
  const isNudoFile = deps.isNudoFile;
  const getActiveCasesForUri = deps.getActiveCases;

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
      const ast = parse(source);
      const callInfo = findEnclosingCall(ast, line, column);
      if (!callInfo) return null;

      const fnAbs = getTypeAtPosition(filePath, source, callInfo.calleeLine, callInfo.calleeCol, cases);
      return fnAbs ? buildSignatureHelp(fnAbs, callInfo.currentParamIndex) : null;
    } catch {
      return null;
    }
  });

  function findEnclosingCall(ast: any, line: number, column: number): { calleeLine: number; calleeCol: number; currentParamIndex: number } | null {
    let result: any = null;

    function visit(node: any): void {
      if (!node || result) return;

      if (node.type === "CallExpression") {
        const loc = node.loc;
        if (loc && loc.start.line <= line && loc.end.line >= line) {
          const calleeLoc = node.callee.loc;
          if (calleeLoc) {
            let paramIndex = 0;
            for (let i = 0; i < node.arguments.length; i++) {
              const argLoc = node.arguments[i].loc;
              if (argLoc) {
                if (argLoc.start.line < line || (argLoc.start.line === line && argLoc.start.column <= column)) {
                  paramIndex = i + 1;
                }
              }
            }
            result = {
              calleeLine: calleeLoc.start.line,
              calleeCol: calleeLoc.start.column,
              currentParamIndex: Math.min(paramIndex, node.arguments.length),
            };
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (key === "type" || key === "loc" || key === "start" || key === "end") continue;
        const child = node[key];
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object" && item.type) visit(item);
          }
        } else if (child && typeof child === "object" && child.type) {
          visit(child);
        }
      }
    }

    visit(ast);
    return result;
  }
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
    } catch {
      return { data: [] };
    }
  });
}

