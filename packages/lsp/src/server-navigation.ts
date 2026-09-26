/**
 * 文档符号 / 工作区符号 / 跳转 / 引用 / 重命名（自 server.ts 机械拆出；语义未改）。
 */
import { readFileSync } from "node:fs";
import {
  type Connection,
  type DocumentSymbol,
  type SymbolInformation,
  SymbolKind as LspSymbolKind,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "@nudojs/parser";
import { isSidecarPath } from "@nudojs/service";
import {
  documentSymbols,
  findIdentifierAtPosition,
  resolveDefinition,
  resolveDefinitionLocations,
  resolveReferences,
  renameTargetAt,
  collectMethodReferences,
  buildRenameEdits,
  type DocumentSymbolItem,
} from "./symbols.ts";
import { uriToFilePath } from "./validation.ts";

export type NavigationDeps = {
  connection: Connection;
  getDocument: (uri: string) => TextDocument | undefined;
  listDocuments: () => TextDocument[];
  isNudoFile: (uri: string) => boolean;
  knownFiles: Set<string>;
};

export function filePathToUri(filePath: string): string {
  if (filePath.startsWith("file://")) return filePath;
  // Windows 路径保留盘符；POSIX 直接拼
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith("/")
    ? `file://${normalized}`
    : `file:///${normalized}`;
}

/** 打开文档 + 会话 knownFiles，供跨文件 references 扫描 */
export function collectNavigationExtraFiles(currentPath: string, deps: NavigationDeps): string[] {
  const open = deps.listDocuments().map((d) => uriToFilePath(d.uri));
  const all = new Set<string>([...open, ...deps.knownFiles, currentPath]);
  return [...all];
}

export function attachNavigation(deps: NavigationDeps): void {
  const connection = deps.connection;
  const documents = {
    get: deps.getDocument,
    all: deps.listDocuments,
  };
  const isNudoFile = deps.isNudoFile;
  // handler 源文本内直接调用 navigationExtraFiles(filePath)；闭包绑定 deps
  function navigationExtraFiles(currentPath: string): string[] {
    return collectNavigationExtraFiles(currentPath, deps);
  }

connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  try {
    const ast = parse(document.getText());
    const toLsp = (s: DocumentSymbolItem): DocumentSymbol => ({
      name: s.name,
      detail: s.detail,
      kind: s.kind as LspSymbolKind,
      range: s.range,
      selectionRange: s.selectionRange,
      children: s.children?.map(toLsp),
    });
    return documentSymbols(ast).map(toLsp);
  } catch {
    return [];
  }
});

connection.onWorkspaceSymbol((params) => {
  const query = params.query.toLowerCase();
  const out: SymbolInformation[] = [];
  const files = new Set<string>([...deps.knownFiles]);
  for (const d of documents.all()) files.add(uriToFilePath(d.uri));
  for (const filePath of files) {
    const doc = documents.all().find((d) => uriToFilePath(d.uri) === filePath);
    let source: string | undefined;
    if (doc) {
      source = doc.getText();
    } else {
      try {
        source = readFileSync(filePath, "utf-8");
      } catch {
        source = undefined;
      }
    }
    if (source === undefined) continue;
    try {
      const ast = parse(source);
      const uri = doc?.uri ?? filePathToUri(filePath);
      for (const sym of documentSymbols(ast)) {
        if (query && !sym.name.toLowerCase().includes(query)) continue;
        out.push({
          name: sym.name,
          kind: sym.kind as LspSymbolKind,
          location: {
            uri,
            range: {
              start: { line: sym.selectionRange.start.line, character: sym.selectionRange.start.character },
              end: { line: sym.selectionRange.end.line, character: sym.selectionRange.end.character },
            },
          },
        });
      }
    } catch {
      /* skip unparseable */
    }
  }
  return out;
});

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  // A5：侧车契约文件本身也可导航（打开的 *.nudo.js / *.nudo.ts）
  const uriPath = params.textDocument.uri;
  if (!isNudoFile(uriPath) && !isSidecarPath(uriToFilePath(uriPath))) {
    return null;
  }

  const source = document.getText();
  const filePath = uriToFilePath(params.textDocument.uri);
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const ast = parse(source);
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (!identAtPos) return null;

    // A5：本地声明 + 侧车契约一起返回（Peek 可见契约边）
    const defs = resolveDefinitionLocations(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      workspaceFallback: true,
    });
    if (defs.length === 0) return null;
    return defs.map((def) => ({
      uri: filePathToUri(def.filePath),
      range: {
        start: { line: def.loc.start.line - 1, character: def.loc.start.column },
        end: { line: def.loc.end.line - 1, character: def.loc.end.column },
      },
    }));
  } catch {
    return null;
  }
});

connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const source = document.getText();
  const filePath = uriToFilePath(params.textDocument.uri);
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const ast = parse(source);
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (!identAtPos) return [];

    const refs = resolveReferences(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      includeDeclaration: params.context?.includeDeclaration !== false,
      at: { line, column },
    });
    return refs.map((ref) => ({
      uri: ref.uri ? filePathToUri(ref.uri) : params.textDocument.uri,
      range: {
        start: { line: ref.loc.start.line - 1, character: ref.loc.start.column },
        end: { line: ref.loc.end.line - 1, character: ref.loc.end.column },
      },
    }));
  } catch {
    return [];
  }
});

connection.onRenameRequest((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const source = document.getText();
  const filePath = uriToFilePath(params.textDocument.uri);
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const ast = parse(source);
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (!identAtPos) return null;

    const target = renameTargetAt(source, line, column);
    if (target && "error" in target) return null;

    // B1：方法 / getter / setter —— 文件内同名 key + 成员访问
    if (target && "kind" in target && target.kind === "method") {
      const hits = collectMethodReferences(ast, target.name);
      const locations = hits.map((h) => ({
        uri: params.textDocument.uri,
        loc: h.loc,
      }));
      // 跨文件：extraFiles 里同名 method 定义/成员也改（name-based）
      for (const extra of navigationExtraFiles(filePath)) {
        try {
          const extraSrc = readFileSync(extra, "utf-8");
          const extraAst = parse(extraSrc);
          for (const h of collectMethodReferences(extraAst, target.name)) {
            locations.push({ uri: filePathToUri(extra), loc: h.loc });
          }
        } catch {
          /* skip unreadable */
        }
      }
      const changes = buildRenameEdits(params.newName, locations);
      if (Object.keys(changes).length === 0) return null;
      return { changes };
    }

    // 跨文件：definition + references 一起改（同绑定）
    const def = resolveDefinition(filePath, source, identAtPos);
    const refs = resolveReferences(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      at: { line, column },
    });

    const locations: Array<{ uri: string; loc: { start: { line: number; column: number }; end: { line: number; column: number } } }> = [];
    if (def) {
      locations.push({ uri: filePathToUri(def.filePath), loc: def.loc });
    }
    for (const ref of refs) {
      locations.push({
        uri: ref.uri ? filePathToUri(ref.uri) : params.textDocument.uri,
        loc: ref.loc,
      });
    }
    const changes = buildRenameEdits(params.newName, locations);
    if (Object.keys(changes).length === 0) return null;
    return { changes };
  } catch {
    return null;
  }
});

connection.onPrepareRename((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;
  const source = document.getText();
  const line = params.position.line + 1;
  const column = params.position.character;
  const target = renameTargetAt(source, line, column);
  if (!target) return null;
  // 非绑定：返回 null = 不可改名（property key / member prop 等）
  if ("error" in target) return null;
  return {
    range: {
      start: { line: target.loc.start.line - 1, character: target.loc.start.column },
      end: { line: target.loc.end.line - 1, character: target.loc.end.column },
    },
    placeholder: target.name,
  };
});
}
