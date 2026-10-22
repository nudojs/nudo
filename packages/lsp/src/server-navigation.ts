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
  isLocalAliasSymbol,
  isMemberAccessAt,
  resolveDefinition,
  resolveDefinitionLocations,
  resolveReferences,
  renameTargetAt,
  collectMethodReferences,
  hasAmbiguousMethodReceiver,
  buildRenameEdits,
  type DocumentSymbolItem,
  type SourceProvider,
} from "./symbols.ts";
import { cacheKey, uriToFilePath } from "./validation.ts";

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
  // 三源统一 cacheKey 形态去重：open doc 是 uri 形态、knownFiles 是 cacheKey、
  // currentPath 是裸路径——混形态会把同一文件扫两遍（FIX-J1）
  const open = deps.listDocuments().map((d) => cacheKey(d.uri));
  const all = new Set<string>([...open, ...[...deps.knownFiles].map(cacheKey), cacheKey(currentPath)]);
  return [...all];
}

/**
 * 跨文件解析的**文本覆盖层**：打开文档的 buffer 优先，磁盘只作 fallback。
 *
 * LSP 的位置语义绑定在编辑器 buffer 上（客户端把 WorkspaceEdit 应用到 buffer），
 * 磁盘 ≠ buffer 是常态（用户未保存的改动在磁盘上不存在）⇒ 跨文件 definition /
 * references / rename 读磁盘就会跳错行、改名改坏未保存的代码。
 */
export function navigationSourceProvider(deps: NavigationDeps): SourceProvider {
  const open = new Map<string, string>();
  for (const d of deps.listDocuments()) {
    open.set(cacheKey(d.uri), d.getText());
  }
  return (filePath: string): string | undefined => open.get(cacheKey(filePath));
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
  // 打开文档的 buffer 覆盖层（跨文件解析必须用 buffer，不是磁盘）
  function navigationSources(): SourceProvider {
    return navigationSourceProvider(deps);
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
  // 统一 cacheKey 形态：knownFiles 是 cacheKey 键，open doc 是 uri 形态——混形态会
  // 漏掉打开中的 buffer，或同一文件被扫两遍（FIX-J1）
  const files = new Set<string>([...deps.knownFiles].map(cacheKey));
  for (const d of documents.all()) files.add(cacheKey(d.uri));
  for (const filePath of files) {
    const doc = documents.all().find((d) => cacheKey(d.uri) === cacheKey(filePath));
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

    // 类 / 对象方法：方法键不是绑定（绑定表不收它）⇒ 定义位走**方法面**
    const methodTarget = renameTargetAt(source, line, column);
    if (methodTarget && "kind" in methodTarget && methodTarget.kind === "method") {
      const hits = collectMethodReferences(ast, methodTarget.name, {
        owner: methodTarget.owner,
      });
      const methodDefs = hits.filter((h) => h.kind === "key");
      if (methodDefs.length > 0) {
        return methodDefs.map((h) => ({
          uri: params.textDocument.uri,
          range: {
            start: { line: h.loc.start.line - 1, character: h.loc.start.column },
            end: { line: h.loc.end.line - 1, character: h.loc.end.column },
          },
        }));
      }
    }

    // A5：本地声明 + 侧车契约一起返回（Peek 可见契约边）
    const defs = resolveDefinitionLocations(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      workspaceFallback: true,
      sourceProvider: navigationSources(),
      at: { line, column },
      // 成员属性（obj.x）没有来源：不得触发工作区同名导出兜底
      isMemberAccess: isMemberAccessAt(ast, line, column),
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

    // 类 / 对象方法：方法键不是绑定 ⇒ 引用面走**方法面**（定义位 + 同源成员访问）
    const methodTarget = renameTargetAt(source, line, column);
    if (methodTarget && "kind" in methodTarget && methodTarget.kind === "method") {
      const hits = collectMethodReferences(ast, methodTarget.name, {
        owner: methodTarget.owner,
      });
      const includeDecl = params.context?.includeDeclaration !== false;
      return hits
        .filter((h) => includeDecl || h.kind !== "key")
        .map((h) => ({
          uri: params.textDocument.uri,
          range: {
            start: { line: h.loc.start.line - 1, character: h.loc.start.column },
            end: { line: h.loc.end.line - 1, character: h.loc.end.column },
          },
        }));
    }

    const refs = resolveReferences(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      includeDeclaration: params.context?.includeDeclaration !== false,
      at: { line, column },
      sourceProvider: navigationSources(),
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
    // **以归属为界**：同名但不同类 / 不同对象的方法不合并（Bug 712）
    if (target && "kind" in target && target.kind === "method") {
      // **归属歧义 ⇒ 拒绝改名**（Bug 712 的自洽性护栏）：
      // 「接收者归属解析不出来」的成员访问（形参 / 外部对象）**可能**指目标方法、
      // 也可能指文件内另一个同名归属。改的话只有两种自洽结果：全改（可能改到
      // 无关对象 ⇒ 运行时 undefined）或全不改（**定义改了、调用点没改** ⇒ 同样
      // 改出坏代码）——两者都坏 ⇒ 只能拒绝，不产出任何编辑。
      if (hasAmbiguousMethodReceiver(ast, target.name, { owner: target.owner })) return null;
      const hits = collectMethodReferences(ast, target.name, { owner: target.owner });
      const locations = hits.map((h) => ({
        uri: params.textDocument.uri,
        loc: h.loc,
      }));
      // 跨文件：extraFiles 里同名 method 定义/成员也改（name-based）
      // 文本取**打开文档的 buffer**（磁盘 ≠ buffer ⇒ 坐标错位、改坏未保存代码）；
      // 当前文件已在上面的文件内扫描里覆盖 ⇒ 这里必须跳过，否则同一文件出两套坐标。
      const sourceProvider = navigationSources();
      const currentKey = cacheKey(filePath);
      for (const extra of navigationExtraFiles(filePath)) {
        if (cacheKey(extra) === currentKey) continue;
        try {
          const extraSrc = sourceProvider(extra) ?? readFileSync(extra, "utf-8");
          const extraAst = parse(extraSrc);
          // 跨文件同样不许有歧义（有 ⇒ 整个改名拒绝）
          if (hasAmbiguousMethodReceiver(extraAst, target.name, { owner: target.owner })) {
            return null;
          }
          for (const h of collectMethodReferences(extraAst, target.name, {
            owner: target.owner,
          })) {
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
    const sourceProvider = navigationSources();
    const def = resolveDefinition(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      sourceProvider,
      at: { line, column },
    });
    const refs = resolveReferences(filePath, source, identAtPos, {
      extraFiles: navigationExtraFiles(filePath),
      at: { line, column },
      sourceProvider,
    });

    const locations: Array<{ uri: string; loc: { start: { line: number; column: number }; end: { line: number; column: number } } }> = [];
    // 本地别名（`import { a as b }` 的 b）是**另一个绑定** ⇒ 改名不得连坐目标模块
    const localAlias = isLocalAliasSymbol(ast, identAtPos);
    if (def && !(localAlias && def.filePath !== filePath)) {
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
  // 归属歧义的方法改名会被 rename 通道拒绝 ⇒ prepareRename 必须同口径，
  // 否则 IDE 先让用户改、真正改的时候又拒绝（体验自相矛盾）。
  if (target.kind === "method" && hasAmbiguousMethodReceiver(parse(source), target.name, { owner: target.owner })) {
    return null;
  }
  return {
    range: {
      start: { line: target.loc.start.line - 1, character: target.loc.start.column },
      end: { line: target.loc.end.line - 1, character: target.loc.end.column },
    },
    placeholder: target.name,
  };
});
}
