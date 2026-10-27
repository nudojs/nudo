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
import {
  cursorLexicalContext,
  sanitizeSourceForParsing,
  completionBranchAt,
  type CompletionContext,
} from "./lsp-surface/completions.ts";
import { lookupScopedBinding, reuseBinding } from "./lsp-surface/replay.ts";
import { buildSemanticTokens } from "./semantic-tokens.ts";
import {
  shouldAnalyzeFile,
  findProjectConfig,
  interfaceConfig,
  analyzeFile,
} from "@nudojs/service";
import type { LoadModule } from "@nudojs/service";
import { formatInterfaceTierLine } from "@nudojs/core";
import { generalizeFromAst, type PolyFn, type Abs } from "@nudojs/core";
import { collectAbsInlays } from "@nudojs/core/internal";
import { parse } from "@nudojs/parser";
import { traverseEsm } from "./traverse-esm.ts";
import type { CallExpression, File, Node } from "@babel/types";
import {
  buildSignatureHelp,
  buildSignatureHelpFromPolyFn,
  buildDegradedSignatureHelp,
  calleeDisplayName,
  calleeMemberPath,
  memberSlotAbs,
} from "./signature-help.ts";
import {
  getCachedOrAnalyze,
  cachedAstFor,
  evalAnalysisModules,
  uriToFilePath,
  type ValidateTextDeps,
} from "./validation.ts";
import {
  buildLspInjection,
  computeInterfaceLenses,
  computeObservationLenses,
  type AgentToolDeps,
} from "./agent-tools.ts";


export type IdeDeps = {
  connection: Connection;
  getDocument: (uri: string) => TextDocument | undefined;
  listDocuments: () => TextDocument[];
  /**
   * 门禁谓词（**真源在 `server.ts` 的 `isNudoFile`**）：本模块的 hover /
   * completion / inlayHint / signatureHelp / semanticTokens 五个门禁点与
   * `server-navigation.ts` 共用**同一个实例** ⇒ 两侧口径必然一致
   * （Bug 751：此前各写各的 ⇒ 同一坐标六种请求三种结论）。
   *
   * ⚠ **不得另写一份谓词**；需要更宽的口径（见 `isNudoTargetPath`）时在
   *   调用点**显式**写明理由。
   */
  isNudoFile: (uri: string) => boolean;
  /**
   * 门禁谓词的**路径层**（`isNudoFile` 的第一层，同一真源）：按**文件路径**
   * 判定「是否 nudo 推断目标」。codeLens（interface 档）用它——interface 档的
   * 主路径正是**零注解**文件（同名侧车绑定），不能用带 analysis.mode 的
   * `isNudoFile`。⚠ 两者都**排除**侧车契约文件（`*.nudo.js` 等）。
   */
  isNudoTargetPath: (filePath: string) => boolean;
  getActiveCases: (uri: string) => Map<string, number>;
  activeLoadModule: LoadModule;
  /** 参数约束 inlay（`where …`）开关：项目配置 > 宿主设置 > false（关） */
  inlayParamsEnabled: (filePath: string) => boolean;
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
      // BUG-024：**协议面**必须与 agent 工具面同源装配注入包
      // （`@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局）——
      // 此前只有 agent 面建了 inject，协议 hover 不传 ⇒ 覆盖表缺席 ⇒
      // 推导链塌缩成 `unknown`（= 推断失败）⇒ IDE 显示 unknown、CLI 精确。
      const inject = buildLspInjection(filePath, source, {
        loadModule: activeLoadModule,
        ...(analysisModules ? { modules: analysisModules } : {}),
      });
      // A7：interface 档与 CodeLens 同源——default 走 symbolic + entryReqs；
      // 选 case 时 body 仍走 activeCases 重放，interface 标注不变
      const hover = getHoverAtPosition(filePath, source, line, column, cases, {
        loadModule: activeLoadModule,
        ...(autoBind === false ? { autoBind: false } : {}),
        ...(Object.keys(inject).length > 0 ? { inject } : {}),
      }, {
        ...(ast !== undefined ? { ast } : {}),
        result,
        ...(analysisModules ? { modules: analysisModules } : {}),
      });
      if (!hover) return null;

      const lines: string[] = [];
      // 与 CodeLens `● interface / <source>` 同源首行（A7 验收）
      if (hover.interfaceSource) {
        // 724：激活态与 CodeLens 同源（选中 case ⇒ 契约档 ○）——不传
        // active 会走默认 true（恒 ●），与同一文件的 CodeLens 打架。
        lines.push(
          formatInterfaceTierLine(hover.interfaceSource, hover.interfaceActive ?? true),
        );
      }
      if (hover.signature) {
        // 函数名 hover：check 同口径签名一行——builder 模板 / symbolic 多行 /
        // display 签名不再重复（nudo.hover payload 保留无损面）
        lines.push("```nudo", hover.signature, "```");
      } else if (!hover.linkedText) {
        if (hover.interfaceDisplay && hover.interfaceSource !== "implicit") {
          lines.push("```nudo", hover.interfaceDisplay, "```");
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
      }
      if (lines.length === 0 && !hover.linkedText) {
        lines.push("```nudo", hover.typeText, "```");
      }
      // 类型值变量链接面：折叠展示中的引用标识符（如
      // `astNode`）包为 markdown 链接（跳定义行）——
      // plain markdown 推送（代码块内链接不渲染）
      if (hover.linkedText) {
        lines.push(hover.linkedText);
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

/**
 * 指令补全的**前缀过滤**（前缀匹配语义）。
 *
 * 语义：**typed 文本必须是 label 的前缀**（`label.startsWith(typed)`）——
 * **不是子串匹配**。子串匹配把「label 内部含有 typed」也算命中
 * （`@nudo:mock` 里含 `c` ⇒ typed `c` 会把 `@nudo:mock` 也带出来）。
 *
 * 例（typed = 用户已输入的 `@nudo[:…]`）：
 * - typed `@nudo:ca` ⇒ 只命中 `@nudo:case`（`@nudo:contract` 的前缀是 `@nudo:co`）；
 * - typed `@nudo:c` ⇒ 命中**所有**以 `@nudo:c` 开头的指令 —— `@nudo:case` 与
 *   `@nudo:contract` **都**命中：两者都真前缀于 `@nudo:c`（前缀语义 ⇒ 不是
 *   「只能命中一个」；子串语义才会多带出 `@nudo:mock` 这类假命中）。
 */
export function matchesDirectivePrefix(label: string, typed: string): boolean {
  if (typed === "") return true;
  return label.startsWith(typed);
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
    {
      label: "@nudo:sample",
      // @nudo:sample 目前**只被解析、不被消费**（reserved / no-op）——
      // 如实说明，别再吹成「Control loop iteration sampling」（Bug 700）。
      detail: "Reserved / no-op (parsed, not consumed)",
      // 带上 count 占位：接受补全后 `@nudo:sample ` 会因缺 count 报诊断，
      // `@nudo:sample 1` 才合法 ⇒ 接受即干净。
      insert: "@nudo:sample 1",
    },
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

    // 词法上下文（code / comment / string）——**单次计算**，指令面与成员 /
    // 变量面共用同一份（Bug 952：光标落在字符串 / 模板字面量**内部**时照样
    // 弹候选，接受任一项即把标识符写进字面量内部 ⇒ 静默改写运行时值）。
    const lexical = cursorLexicalContext(source, params.position.line, params.position.character);
    // 补全面分支（member = 成员面 / variable = 变量面）——与
    // getCompletionsAtPosition 同一份触发点文法（片 A 的 completionBranchAt）：
    // 只有成员面需要作用域感知的接收者绑定（绑定下沉）。
    const branch = completionBranchAt(source, line, column);

    // 指令面优先：**光标确实落在注释里**（词法上下文，见 cursorLexicalContext）
    // 且光标前是 `@nudo[:…]` 前缀。旧口径是「前面出现过 `*` 或 `nudo`」的子串
    // 匹配 ⇒ 乘号之后 / 字符串字面量里也弹指令项（Bug 708）。
    const curLine = source.split("\n")[params.position.line] ?? "";
    const before = curLine.slice(0, params.position.character);
    const inComment = lexical === "comment";
    const directivePrefix = /@nudo:?[\w-]*$/.exec(before)?.[0] ?? "";
    // 注释标记后（`// ` / ` * `）⇒ 给出指令全集；`@nudo[:partial]` ⇒ 前缀过滤
    const atCommentMarker = /(\/\/|\/\*|\*)\s*$/.test(before);
    if (inComment && (directivePrefix !== "" || atCommentMarker)) {
      // textEdit 区间 = [前缀起点, 光标]：客户端默认只替换「当前单词」，而
      // `@nudo:case` 里的 ':' 会把单词切开 ⇒ 不给 textEdit 会插出
      // `@nudo:@nudo:case`（接受即语法错）。区间两端都按请求位置算。
      const startCharacter = Math.max(
        0,
        params.position.character - directivePrefix.length,
      );
      const range = {
        start: { line: params.position.line, character: startCharacter },
        end: { line: params.position.line, character: params.position.character },
      };
      return NUDO_DIRECTIVE_COMPLETIONS.filter((d) =>
        matchesDirectivePrefix(d.label, directivePrefix),
      ).map((d): LspCompletionItem => ({
        label: d.label,
        kind: CompletionItemKind.Keyword,
        detail: d.detail,
        insertText: d.insert ?? d.label,
        textEdit: { range, newText: d.insert ?? d.label },
      }));
    }

    // 词法闸：光标不在代码位（字符串 / 模板字面量内部、注释里）⇒ 成员面与
    // 变量面**都不出候选**——那些位置的候选接受即改写字面量 / 注释内容
    // （Bug 952）。
    if (lexical !== "code") return [];

    try {
      // P-IDE1：completion 走同源 analysisCache——接收者/变量绑定直接读
      // result.bindings，不再每次整文件求值
      //
      // 编辑中间态（用户刚敲下 `.`）buffer 此刻**语法非法** ⇒ 原文分析直接抛
      // ⇒ 补全在最需要的那一刻全灭（Bug 698）。口径：**缓存 key 仍按真实源码
      // 算**——消毒文本只喂给一次性分析，不写回 analysisCache（否则缓存
      // 与真实源码串味）。
      let result;
      try {
        result = getCachedOrAnalyze(
          filePath,
          source,
          document.version,
          undefined,
          activeLoadModule,
        );
      } catch {
        result = analyzeFile(
          filePath,
          sanitizeSourceForParsing(source),
          undefined,
          undefined,
          activeLoadModule,
          "none",
        );
      }
      const context: CompletionContext = { lexical };
      if (branch === "member") {
        // 绑定下沉（Bug 789）：接收者 Abs 先查**光标所在作用域**（函数体内
        // 的局部量 / 形参）⇒ 作用域里查不到才回落模块级绑定面。作用域面用
        // **消毒后**的源码（与引擎重放的插桩记录同坐标系——消毒不改标识符
        // 位置）。
        const parseText = sanitizeSourceForParsing(source);
        const analysisModules = evalAnalysisModules(filePath, source);
        const scopedReuse = {
          result,
          ...(analysisModules ? { modules: analysisModules } : {}),
        };
        const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;
        context.lookupBinding = (name) =>
          lookupScopedBinding(filePath, parseText, line, column, name, scopedReuse, {
            loadModule: activeLoadModule,
            ...(autoBind === false ? { autoBind: false } : {}),
          }) ?? reuseBinding(scopedReuse, name);
      }
      const items = getCompletionsAtPosition(filePath, source, line, column, { result }, context);
      return items.map((item): LspCompletionItem => ({
        label: item.label,
        kind:
          item.kind === "function"
            ? CompletionItemKind.Function
            : item.kind === "method"
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
  const isNudoTargetPath = deps.isNudoTargetPath;

  connection.onCodeLens((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    // interface 档的目标场景就是零注解文件（侧车同名绑定，§2.1 主路径），
    // 因此这里放宽为**路径层**门禁（isNudoTargetPath）而非 isNudoFile——case
    // 副层只依赖指令，注解文件行为不变；hover/inlayHint/semanticTokens 仍走
    // isNudoFile。⚠ 两者都排除侧车契约文件（*.nudo.js 等）⇒ 口径一致。
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
    // 722：CRLF 源文件的行尾 `\r` **不属于该行**（LSP `Position.character`
    // 是行内 UTF-16 偏移，行终止符除外）⇒ 切行必须剥掉 `\r`，否则行宽
    // 比客户端的可见行长多 1，end-of-line hint 越界 1 列。
    const lines = source.split(/\r\n|\r|\n/);
    const autoBind = interfaceConfig(findProjectConfig(dirname(filePath))?.config).autoBind;
    const showParamInlays = deps.inlayParamsEnabled(filePath);

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
      // BUG-024：inlayHint 与 hover 同源装配注入包（缺 inject ⇒ 被 mock /
      // replace 的推导链塌缩 unknown ⇒ IDE 显示 unknown）
      const inject = buildLspInjection(filePath, source, {
        loadModule: activeLoadModule,
        ...(analysisModules ? { modules: analysisModules } : {}),
      });
      try {
        for (const abs of collectAbsInlays(source, {
          loadModule: activeLoadModule,
          fromFile: filePath,
          ...(autoBind === false ? { autoBind: false } : {}),
          ...(analysisModules ? { modules: analysisModules } : {}),
          ...(Object.keys(inject).length > 0 ? { inject } : {}),
        })) {
          // 参数约束 inlay（`where …`）：nudo.inlayHints.parameters
          // 默认关——契约判别联合外延展开可达数万字符；返回 inlay
          // （`: …`，短）不受影响
          if (abs.kind === "parameter" && !showParamInlays) continue;
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
            // 折叠展示（表达式原文）的完整 pred：hover 展开
            ...(abs.tooltip !== undefined ? { tooltip: abs.tooltip } : {}),
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

      // 716：`textDocument/inlayHint` 的 `params.range` 是**必填**且表示
      // 「只请求该区间」⇒ 返回的 hint 必须落在区间内（否则客户端的
      // 局部刷新被无视，无关区段的 hint 反复重绘）。
      // 区间缺省（不合规客户端）⇒ 整文件集（fail-open，不丢内容）。
      const range = params.range;
      if (!range) return hints;
      return hints.filter((h) => inRange(h.position, range.start, range.end));
    } catch (err) {
      connection.console.error(
        `nudo inlayHint failed for ${params.textDocument.uri}: ${(err as Error).message}`,
      );
      return [];
    }
  });
}

/**
 * hint 位置是否落在请求区间内（716）。
 * LSP `Position` 是 (line, character) 0 基；字典序比较。闭区间
 * （start ≤ pos ≤ end）——与客户端 `Range.contains` 同口径。
 */
function inRange(
  pos: { line: number; character: number },
  start: { line: number; character: number },
  end: { line: number; character: number },
): boolean {
  const after =
    pos.line > start.line ||
    (pos.line === start.line && pos.character >= start.character);
  const before =
    pos.line < end.line || (pos.line === end.line && pos.character <= end.character);
  return after && before;
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

      // 被调者解析（4 形态，同一份源码给同一份签名）：
      //  ① 裸标识符 → 同源绑定面（getTypeAtPosition：模块级绑定 / import 本地名）
      //  ② 成员表达式 `obj.method(…)` → 接收者 Abs 沿形状**逐段下钻**（Bug 720）
      //  ③ ①② miss → **AST 定位回落** generalizeFromAst（与 hover 面同源）：
      //     `export default function defFn`（Bug 985）与函数体内的局部 callee
      //     （Bug 986）都不在模块级绑定表里 ⇒ 绑定面必然 miss。
      //  ④ 仍 miss → **可观测降级**（被调者标识符 + 空参数表），不是 null。
      const callee = callInfo.callee ?? null;
      const memberPath = calleeMemberPath(callee);
      if (memberPath) {
        const memberAbs = resolveMemberCalleeAbs(
          filePath,
          source,
          cases,
          { result, ast },
          memberPath,
        );
        if (memberAbs && memberAbs.shape.k === "fn") {
          const help = buildSignatureHelp(memberAbs, callInfo.currentParamIndex);
          if (help) return help;
        }
      } else {
        const fnAbs = getTypeAtPosition(
          filePath,
          source,
          callInfo.calleeLine,
          callInfo.calleeCol,
          cases,
          { result, ast },
        );
        // BUG-104：绑定面里的 fn Abs 常是 `fnOf()` 造的**声明空壳**
        // （`{ k: "fn", params }`，无 `paramTypes` / `returnType`）⇒ 会把它
        // 渲染成「形参一律 any、返回 unknown」的假签名，并**抢占**下方
        // generalize 内涵面（同一时刻 hover 给精确签名 ⇒ 同一 LSP 面自相矛盾）。
        // 与 hover 的 `deferIfArityOnlyFn` 同款闸门：`returnType` 槽空的
        // arity-only fn **不采纳**，回落路径③（`resolveCalleePolyFn`）。
        const arityOnly = fnAbs?.shape.k === "fn" && fnAbs.shape.returnType === undefined;
        if (fnAbs && fnAbs.shape.k === "fn" && !arityOnly) {
          const help = buildSignatureHelp(fnAbs, callInfo.currentParamIndex);
          if (help) return help;
        }
      }

      const poly = resolveCalleePolyFn(filePath, source, callee, ast, activeLoadModule);
      if (poly) return buildSignatureHelpFromPolyFn(poly, callInfo.currentParamIndex);

      const name = calleeDisplayName(callee);
      return name ? buildDegradedSignatureHelp(name) : null;
    } catch (err) {
      connection.console.error(
        `nudo signatureHelp failed for ${params.textDocument.uri}: ${(err as Error).message}`,
      );
      return null;
    }
  });
}

/**
 * 成员被调者的 Abs（`obj.method` / `a.b.c`）：接收者 Abs → 沿形状逐段下钻。
 * 接收者用**同源绑定面**解析（模块级绑定 / import 本地名）⇒ 与成员补全面
 * （completions 的 getCompletionsForAbs）同一条下钻口径。
 */
function resolveMemberCalleeAbs(
  filePath: string,
  source: string,
  cases: Map<string, number> | undefined,
  reuse: { result: ReturnType<typeof getCachedOrAnalyze>; ast: File },
  path: { segments: string[]; receiverLine: number; receiverCol: number },
): Abs | null {
  let cur = getTypeAtPosition(
    filePath,
    source,
    path.receiverLine,
    path.receiverCol,
    cases,
    reuse,
  );
  for (let i = 1; i < path.segments.length; i++) {
    cur = memberSlotAbs(cur, path.segments[i]!) ?? null;
    if (!cur) return null;
  }
  return cur;
}

/**
 * AST 定位回落：`generalizeFromAst`（hover 面同源）——按**声明**找被调者，
 * 与模块级绑定表的键口径无关 ⇒ `export default function defFn` 与函数体内的
 * 局部 callee 都能解析（Bug 985 / 986）。
 */
function resolveCalleePolyFn(
  filePath: string,
  source: string,
  callee: Node | null,
  ast: File,
  loadModule: LoadModule,
): PolyFn | undefined {
  if (!callee || callee.type !== "Identifier") return undefined;
  try {
    return generalizeFromAst(callee.name, source, {
      file: ast,
      refine: {
        fromFile: filePath,
        loadModule,
      },
    });
  } catch {
    // fail-closed：泛化失败 → 无签名面（调用方降级）
    return undefined;
  }
}

/**
 * 光标所在的（**最内层**）调用表达式 + 当前参数下标。
 * Babel traverse 实现（P-IDE7）：区间判定含列（旧手写 visitor 只比行号），
 * 参数下标看完整区间（cursor 落在参数 i 内 → i；在其结尾/逗号后 → i+1），
 * 跨行参数不再被「start 在前 → +1」误判。
 *
 * **最内层**（Bug 711）：命中第一个（外层）`CallExpression` 就停 +
 * `path.skip()` ⇒ 内层调用永不被访问 ⇒ 嵌套调用弹**外层**函数的签名
 * （与 LSP 签名帮助的语义相反：用户正在编辑的是内层实参）。
 * ⇒ 不再 `path.skip()`，改为在多个命中里保留**最内层**者（含光标 ⇒
 * 起点更靠后 / 终点更靠前者更内层）。
 * 导出供测试（monorepo 内部面，非 npm 公共契约）。
 */
export function findEnclosingCall(
  ast: Node,
  line: number,
  column: number,
): {
  calleeLine: number;
  calleeCol: number;
  currentParamIndex: number;
  /** 被调者节点（裸标识符 / 成员表达式）——签名面据此解析被调者 */
  callee?: Node;
} | null {
  const traverseFn = traverseEsm();
  if (typeof traverseFn !== "function") return null;
  let result: {
    calleeLine: number;
    calleeCol: number;
    currentParamIndex: number;
    callee?: Node;
  } | null = null;
  try {
    traverseFn(ast, {
      CallExpression(path) {
        const node = path.node;
        const loc = node.loc;
        const calleeLoc = node.callee?.loc;
        if (!loc || !calleeLoc) return;
        // 完整区间包含（行列）；旧实现只比行号，同行调用尾/换行处会误命中
        const contains =
          (loc.start.line < line || (loc.start.line === line && loc.start.column <= column)) &&
          (loc.end.line > line || (loc.end.line === line && loc.end.column >= column));
        if (!contains) return;
        // 命中后**继续下降**：内层调用也要参与竞争（取最内层）
        if (result && !isInnererCall(node, result.callee)) return;
        result = {
          calleeLine: calleeLoc.start.line,
          calleeCol: calleeLoc.start.column,
          currentParamIndex: currentParamIndexOf(node, line, column),
          callee: node.callee,
        };
      },
    });
  } catch {
    return null;
  }
  return result;
}

/**
 * 候选调用是否比当前保留的调用**更内层**。
 * 两个都含光标 ⇒ 必是祖先/后代关系；后代起点更靠后（同行则列更大），
 * 起点相同时终点更靠前者更内层。
 */
function isInnererCall(cand: Node, kept: Node | undefined): boolean {
  const cLoc = cand.loc;
  const kLoc = kept?.loc;
  if (!cLoc || !kLoc) return true;
  if (cLoc.start.line !== kLoc.start.line) return cLoc.start.line > kLoc.start.line;
  if (cLoc.start.column !== kLoc.start.column) return cLoc.start.column > kLoc.start.column;
  if (cLoc.end.line !== kLoc.end.line) return cLoc.end.line < kLoc.end.line;
  return cLoc.end.column <= kLoc.end.column;
}

/**
 * 参数下标：cursor 在参数 i 区间内 → i；在第 i 个参数结尾（含其后逗号）→ i+1。
 *
 * 返回的是**实参侧**的序号（光标前有几个实参），**不**按实参个数截断——
 * 截断到**形参个数**是签名面的职责（`buildSignatureHelp` 按签名参数表夹住
 * `activeParameter`，协议要求下标落在参数表内）。
 */
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
  return idx;
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

