/**
 * 文档符号 / 工作区符号 / 跳转 / 引用 / 重命名（自 server.ts 机械拆出；语义未改）。
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  type ClientCapabilities,
  type Connection,
  type DocumentSymbol,
  type SymbolInformation,
  SymbolKind as LspSymbolKind,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "@nudojs/parser";
import { isNudoTargetPath } from "@nudojs/service";
import {
  documentSymbols,
  findIdentifierAtPosition,
  findSidecarContractDefinition,
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
  /**
   * **客户端能力**（Bug 749）——返回客户端在 `initialize` 里声明的
   * `params.capabilities` **原对象**（未改写 / 未归一）。
   *
   * · **用途**：`textDocument/documentSymbol` 的返回**形状**
   *   （层级式 `DocumentSymbol[]` vs 扁平 `SymbolInformation[]`）与
   *   **`SymbolKind` 取值**都受客户端能力约束。
   * · **缺省**：`undefined` ⇒ 客户端**没发**该能力段（老客户端可能根本不发）
   *   ⇒ 消费方**必须走默认**：**层级式 + 全量 `SymbolKind`**，
   *   **不得因拿不到能力就退化**。
   * · **真源**：`server.ts` 的 `onInitialize`（片 C 落）——本模块**只消费**，
   *   不自己读 `initialize` 的 params。
   */
  clientCapabilities?: () => ClientCapabilities | undefined;
};

/**
 * 文件路径 → `file:` URI（Bug 748）。
 *
 * ⚠ **必须与 `validation.ts` 的 `uriToFilePath` 互逆**：此前本函数**裸拼**
 *   `file://` + 路径（路径里的 `%` / `#` / `?` / 空格 / 中文**不转义**）⇒
 *   服务端自产的 URI **本身非法**（裸 `%`）⇒ 客户端回传后
 *   `decodeURIComponent` 抛 `URIError` ⇒ 该文档**零诊断**（L2 假绿）。
 * ⇒ 改用 Node 内置 **`pathToFileURL`**：**零新增导出**、跨平台、
 *   天生与 `fileURLToPath` 互逆（保留字符按 RFC 3986 转义）。
 * ⚠ **输出形态变了**（族 23 侧断言须归一）：
 *   `/tmp/a.js` ⇒ `file:///tmp/a.js`（与旧实现同形）；
 *   `/tmp/100%.js` ⇒ `file:///tmp/100%25.js`（旧实现给裸 `%`）。
 */
export function filePathToUri(filePath: string): string {
  if (filePath.startsWith("file://")) return filePath;
  return pathToFileURL(filePath).href;
}

/**
 * `SymbolKind` **夹取**（Bug 749）：客户端在
 * `textDocument.documentSymbol.symbolKind.valueSet` 里声明它**能显示**的 kind
 * ⇒ 服务端回一个**不在集合内**的 kind 是**取值违规**（老客户端可能直接丢弃
 * 或渲染成未知图标）。
 *
 * ⚠ **缺省语义**：客户端**没发**该能力段 ⇒ `valueSet` 为 `undefined`
 *   ⇒ **不夹取**（回全量 kind）。
 * ⚠ 夹取目标**必须在客户端声明的集合内** ⇒ 优先挑语义安全的
 *   `Variable`(13) / `Function`(12) / `Constant`(14)；都不在集合内 ⇒ 退回
 *   集合的第一个（仍是客户端允许的取值）。
 */
function clampSymbolKind(kind: LspSymbolKind, valueSet: readonly number[] | undefined): LspSymbolKind {
  if (!valueSet || valueSet.length === 0) return kind;
  if (valueSet.includes(kind)) return kind;
  for (const safe of [LspSymbolKind.Variable, LspSymbolKind.Function, LspSymbolKind.Constant]) {
    if (valueSet.includes(safe)) return safe;
  }
  return valueSet[0] as LspSymbolKind;
}

/**
 * 夹取后的**降级提示**（Bug 749）：kind 被夹取 ⇒ 在 `detail` 里留痕
 * （客户端只看到夹取后的 kind ⇒ 不留痕就「静默降级」，用户无从判断）。
 * ⚠ 未被夹取 ⇒ `detail` **原样返回**（不污染既有断言）。
 */
function symbolDetail(
  detail: string | undefined,
  clampedKind: LspSymbolKind,
  originalKind: LspSymbolKind,
): string | undefined {
  if (clampedKind === originalKind) return detail;
  const note = `kind clamped to ${clampedKind} (client symbolKind.valueSet)`;
  return detail ? `${detail} — ${note}` : note;
}

/**
 * ECMAScript **保留字**（Bug 750）——不能作为绑定名。
 *
 * · ES 保留字（`class` / `const` / `enum` / `await` …）
 * · **严格模式**未来保留字（`implements` / `interface` / `let` / `package` /
 *   `private` / `protected` / `public` / `static` / `yield`）
 * · 严格模式下**不可**作为绑定名（`arguments` / `eval`）
 *
 * ⚠ 只收**真正非法**的词：TS 的**上下文关键字**（`type` / `namespace` /
 *   `as` / `from` / `get` / `set` / `of` / `out` …）在 JS 里是**合法标识符**
 *   ⇒ 不收（否则把合法改名误拒）。
 */
const RESERVED_WORDS = new Set<string>([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "arguments",
  "eval",
]);

/**
 * 重命名目标名的**语法层**校验（Bug 750）。
 *
 * ① **非空**；② **合法 JS 标识符**
 * （`/^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u`）；
 * ③ **非保留字**。
 *
 * ⚠ **只做语法层**（零跨片）：「与同作用域已有绑定冲突」（重复声明）需要
 *   作用域模型（`buildSymbolTable`）⇒ 本族**不做**，登记为独立后续项。
 */
function isValidRenameName(name: string): boolean {
  if (!name) return false;
  if (!/^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u.test(name)) return false;
  if (RESERVED_WORDS.has(name)) return false;
  return true;
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

  // 客户端能力（Bug 749）：返回的**形状**与 **`SymbolKind` 取值**都受客户端
  // 声明约束（`textDocument.documentSymbol.hierarchicalDocumentSymbolSupport`
  // / `textDocument.documentSymbol.symbolKind.valueSet`）。
  // ⚠ **缺省语义**：客户端**没发**该能力段 ⇒ `undefined` ⇒ 走**默认**
  //   （层级式 + 全量 `SymbolKind`）——**不得因拿不到能力就退化**。
  const caps = deps.clientCapabilities?.();
  const dsCaps = caps?.textDocument?.documentSymbol;
  const hierarchical = dsCaps?.hierarchicalDocumentSymbolSupport !== false;
  const valueSet = dsCaps?.symbolKind?.valueSet;

  try {
    const ast = parse(document.getText());
    if (!hierarchical) {
      // 客户端不支持层级式 ⇒ 回**扁平协议**（`SymbolInformation[]`：
      // `location` 而非 `range` / `selectionRange` / `children`；层级关系用
      // `containerName` 表达）。
      // ⚠ LSP 的 `SymbolInformation` **没有** `detail` 字段（只有
      //   `DocumentSymbol` 有）⇒ 这里把 `detail` 作为**扩展字段**带上
      //   （JSON-RPC 客户端忽略未知字段）—— 否则「kind 被夹取」的降级提示
      //   在扁平协议下**无处可留**。
      const out: Array<SymbolInformation & { detail?: string }> = [];
      const flatten = (items: DocumentSymbolItem[], container: string | undefined): void => {
        for (const s of items) {
          const kind = clampSymbolKind(s.kind as LspSymbolKind, valueSet);
          const entry: SymbolInformation & { detail?: string } = {
            name: s.name,
            kind,
            detail: symbolDetail(s.detail, kind, s.kind as LspSymbolKind),
            location: {
              uri: params.textDocument.uri,
              range: {
                start: { line: s.range.start.line, character: s.range.start.character },
                end: { line: s.range.end.line, character: s.range.end.character },
              },
            },
          };
          if (container) entry.containerName = container;
          out.push(entry);
          if (s.children?.length) flatten(s.children, s.name);
        }
      };
      flatten(documentSymbols(ast), undefined);
      return out;
    }
    const toLsp = (s: DocumentSymbolItem): DocumentSymbol => {
      const kind = clampSymbolKind(s.kind as LspSymbolKind, valueSet);
      return {
        name: s.name,
        detail: symbolDetail(s.detail, kind, s.kind as LspSymbolKind),
        kind,
        range: s.range,
        selectionRange: s.selectionRange,
        children: s.children?.map(toLsp),
      };
    };
    return documentSymbols(ast).map(toLsp);
  } catch {
    return [];
  }
});

connection.onWorkspaceSymbol((params) => {
  const query = params.query.toLowerCase();
  // BUG-188：`workspace/symbol` 的**专属** kind 能力（与 documentSymbol 段
  // 是两个独立键；客户端没发 ⇒ undefined ⇒ 不夹取）
  const wsSymbolValueSet = deps.clientCapabilities?.()?.workspace?.symbol?.symbolKind?.valueSet;
  const out: SymbolInformation[] = [];
  // 统一 cacheKey 形态：knownFiles 是 cacheKey 键，open doc 是 uri 形态——混形态会
  // 漏掉打开中的 buffer，或同一文件被扫两遍（FIX-J1）
  const files = new Set<string>([...deps.knownFiles].map(cacheKey));
  for (const d of documents.all()) files.add(cacheKey(d.uri));
  for (const filePath of files) {
    // 门禁（Bug 751）：与其它导航请求**同一判据**——`isNudoFile` 的**路径层**
    // `isNudoTargetPath`（同样**排除侧车** `*.nudo.js` / `*.nudo.mjs` /
    // `*.nudo.ts` 与 `*.nudo.draft.*`）。
    // ⚠ 本面扫的是**文件路径集合**（`knownFiles` + 已打开文档）⇒ 可能含
    //   **未打开**的文件 ⇒ **不能**用 `isNudoFile`（它要求文档已打开 ⇒ 会把
    //   未打开的文件**整片误杀**）⇒ 只用**路径层**。
    if (!isNudoTargetPath(filePath)) continue;
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
      // **递归下钻** `children` 并**扁平化**（Bug 745）：`documentSymbols` 把
      // 类成员放在 `children` 里 ⇒ 只取顶层 ⇒ 类方法 / 类属性**永远**不进
      // 搜索结果。LSP 的 `workspace/symbol` 是**扁平协议** ⇒ 层级关系用
      // `containerName` 表达。
      const flatten = (items: DocumentSymbolItem[], container: string | undefined): void => {
        for (const sym of items) {
          if (!query || sym.name.toLowerCase().includes(query)) {
            // BUG-188：`workspace/symbol` 有**专属**的 kind 能力段
            // （`workspace.symbol.symbolKind.valueSet`，协议原文：“Specific
            // capabilities for the `SymbolKind` in the `workspace/symbol`
            // request.”）⇒ 必须**单独读它**（documentSymbol 段是另一个键）。
            // 旧实现裸转写 kind ⇒ 回客户端明说显示不了的取值，而同 server 的
            // documentSymbol 已夹取 ⇒ 两个符号面口径相反。
            const kind = clampSymbolKind(sym.kind as LspSymbolKind, wsSymbolValueSet);
            const entry: SymbolInformation & { detail?: string } = {
              name: sym.name,
              kind,
              detail: symbolDetail(sym.detail, kind, sym.kind as LspSymbolKind),
              location: {
                uri,
                range: {
                  start: {
                    line: sym.selectionRange.start.line,
                    character: sym.selectionRange.start.character,
                  },
                  end: {
                    line: sym.selectionRange.end.line,
                    character: sym.selectionRange.end.character,
                  },
                },
              },
            };
            if (container) entry.containerName = container;
            out.push(entry);
          }
          if (sym.children?.length) flatten(sym.children, sym.name);
        }
      };
      flatten(documentSymbols(ast), undefined);
    } catch {
      /* skip unparseable */
    }
  }
  return out;
});

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  // 门禁（Bug 751）：与其它导航请求**同一个谓词**（`isNudoFile` 真源 =
  // `server.ts`）⇒ 侧车契约文件（`*.nudo.js` 等）在本请求上一律为 null。
  // ⚠ 此前本行额外挂了 `|| isSidecarPath(...)` **逃生口** ⇒ 侧车只有
  //   `definition` 放行、其余五个请求挡住 ⇒ **同一坐标六种请求三种结论**
  //   （definition 说「这个符号存在」、documentSymbol 说「这个文件里没有
  //   任何符号」）⇒ LSP 内部自相矛盾。
  // ⚠ **代价（已裁决：接受）**：丢掉「源码 → 侧车」的 definition 可导航能力。
  if (!isNudoFile(params.textDocument.uri)) return null;

  const source = document.getText();
  const filePath = uriToFilePath(params.textDocument.uri);
  const line = params.position.line + 1;
  const column = params.position.character;

  try {
    const ast = parse(source);
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (!identAtPos) return null;

    // A5：本地声明 + 侧车契约一起返回（Peek 可见契约边）
    // ⚠ **类 / 对象方法（方法键不是绑定）由符号层自己判**（`resolveDefinitionLocations`
    //   内的方法面）：协议面与纯函数面**同一口径**（此前协议面内联一份判据、
    //   纯函数面没有 ⇒ 直接调用纯函数时方法认不出来 ⇒ 两面分裂）。
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

    // 类 / 对象方法（方法键不是绑定）由符号层自己判（`resolveReferences` 内的
    // 方法面）：**含跨文件**同源成员访问 ⇒ 与改名面口径一致（此前 references
    // 只扫当前文件、rename 却跨文件 ⇒ 两面分裂）。
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
  // 新名校验（Bug 750）：**语法层** —— 合法 JS 标识符 + 非保留字 + 非空。
  // ⚠ 此前 `params.newName` 被**直接**当替换文本用 ⇒ 一次改名就能把源码改成
  //   **非法 JavaScript**（`node --check` 直接 `SyntaxError`）。
  // ⚠ 「与同作用域已有绑定冲突」（重复声明）需要作用域模型
  //   （`buildSymbolTable`，片 A 的地盘）⇒ **本族不做**（独立后续项）。
  if (!isValidRenameName(params.newName)) return null;

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
    // BUG-105：**侧车契约绑定**（`export const <name> = fn(…)`）是符号的一部分
    // （`definition` 的第三档已经把它报成定义位）⇒ rename 必须把它算进编辑集。
    // 旧实现只取 `resolveDefinition`（**单数** = 第一个定义位 = 本地声明）+ refs
    // ⇒ 侧车契约成孤儿 ⇒ 契约档 `hw`→`imp`，**已报的 L1 `nudo:constraint-violated`
    // 诊断静默消失**（门禁结论被 LSP 自己的编辑改掉）。
    if (!localAlias) {
      const sidecarTargets = new Set<string>([filePath]);
      if (def && def.filePath !== filePath) sidecarTargets.add(def.filePath);
      for (const target of sidecarTargets) {
        try {
          const sc = findSidecarContractDefinition(target, identAtPos, {
            extraFiles: navigationExtraFiles(target),
            sourceProvider,
          });
          if (sc) locations.push({ uri: filePathToUri(sc.filePath), loc: sc.loc });
        } catch {
          /* 侧车探测 best-effort：读不到就不改（不拖垮改名） */
        }
      }
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
