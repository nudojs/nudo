/**
 * `nudo.*` 命令处理器（selectCase / getActiveCases / contract.emit）。
 * 自 server.ts 机械拆出；语义未改。dispatchNudoCommand 留在 server.ts
 * （public-api-surface 测试要求 case 标签出现在 server.ts 源文本中）。
 */
import { readFileSync } from "node:fs";
import {
  CodeLensRefreshRequest,
  InlayHintRefreshRequest,
  type Connection,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { localNamedExports, sidecarPathOf } from "@nudojs/core";
import {
  contractEmitTool,
  normalizeFilePath,
  toolError,
  type AgentToolDeps,
  type AgentToolResult,
} from "./agent-tools.ts";
import { getCasesForFile } from "./lsp-surface.ts";
import { sanitizeErrorMessage } from "./sanitize.ts";
import {
  analysisCache,
  cacheKey,
  handleNudoDepFileChanged,
  registerNudoImportDeps,
  uriToFilePath,
  type ValidateTextDeps,
} from "./validation.ts";

export type CommandDeps = {
  connection: Connection;
  /** 与原 `documents.get(uri)` 同键查找 */
  getDocument: (uri: string) => TextDocument | undefined;
  /** 与原 `documents.all()` 同序枚举（uriForFileOrUri 反查） */
  listDocuments: () => TextDocument[];
  getActiveCases: (uri: string) => Map<string, number>;
  validateDocument: (document: TextDocument) => Promise<void>;
  validationDeps: () => ValidateTextDeps;
  refreshPullDiagnostics: () => void;
  agentToolDeps: AgentToolDeps;
};

/** Resolve a `uri`- or `file`-identified target to the uri key used by activeCases/documents. */
export function uriForFileOrUri(
  params: { uri?: string; file?: string },
  deps: CommandDeps,
): string {
  if (params.uri) return params.uri;
  const raw = params.file ?? "";
  // 比较走 cacheKey（自身统一 uri/盘符形态）且不经 normalizeFilePath：resolve 是
  // 平台相关的，POSIX 会把 c:\ 当相对路径打散（FIX-J1）。fallback 才需要真实路径。
  const doc = deps.listDocuments().find((d) => cacheKey(d.uri) === cacheKey(raw));
  return doc ? doc.uri : `file://${normalizeFilePath(raw)}`;
}

/**
 * 命令级失败回执：`success:false` + 语义化 error + agent API 的 `isError`
 * 标记（agent.md「Tool errors carry isError: true」）。成功回执保持既有形态
 * （selectCase/selectContract → `{ success: true }`）。
 */
export type CommandError = { success: false; error: string; isError: true };

function commandError(error: string): CommandError {
  return { success: false, error, isError: true };
}

/** `file` 入参的形态错误文案（agent.md：file 是 file:// URI 或裸路径） */
const FILE_REQUIRED =
  "Error: file is required and must be a non-empty string (file:// URI or path)";

/**
 * 目标 uri 解析（955）：`uri` / `file` 必须是**非空字符串**，否则直接报形态
 * 错误——不再让非法值走到 `file.startsWith` 崩成裸 TypeError，也不再在两者
 * 都缺时回落服务器 cwd（那会在 cwd 上建幽灵条目）。
 */
function resolveTargetUri(
  params: { uri?: unknown; file?: unknown },
  deps: CommandDeps,
): { uri: string } | { error: string } {
  const rawUri = params.uri;
  if (rawUri !== undefined && rawUri !== null) {
    if (typeof rawUri !== "string" || rawUri.length === 0) {
      return { error: "Error: uri is required and must be a non-empty string" };
    }
    return { uri: rawUri };
  }
  const rawFile = params.file;
  if (typeof rawFile !== "string" || rawFile.length === 0) {
    return { error: FILE_REQUIRED };
  }
  try {
    return { uri: uriForFileOrUri({ file: rawFile }, deps) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      error: `Error: invalid file parameter (${sanitizeErrorMessage(msg, deps.agentToolDeps.workspaceRoots)})`,
    };
  }
}

/**
 * 目标源码：打开的 buffer 优先（与 CodeLens/hover 同源），其次磁盘。
 * 读不到 ⇒ 形态化错误（不再把 ENOENT 原文当工具错误）。
 */
function readTargetSource(
  uri: string,
  deps: CommandDeps,
): { filePath: string; source: string } | { error: string } {
  const filePath = uriToFilePath(uri);
  const doc = deps.getDocument(uri);
  if (doc) return { filePath, source: doc.getText() };
  const open = deps.agentToolDeps.getOpenText?.(filePath);
  if (open) return { filePath, source: open.text };
  try {
    return { filePath, source: readFileSync(filePath, "utf-8") };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      error: `Error: cannot read target file (${sanitizeErrorMessage(msg, deps.agentToolDeps.workspaceRoots)})`,
    };
  }
}

/** 该文件的指令 case 目标（函数名 → case 列表）——与 CodeLens case 副层同源 */
function caseTargets(
  filePath: string,
  source: string,
): Map<string, { name: string; index: number }[]> {
  const out = new Map<string, { name: string; index: number }[]>();
  for (const fn of getCasesForFile(filePath, source)) {
    out.set(fn.functionName, fn.cases);
  }
  return out;
}

/**
 * 该文件已知的函数名：带指令的函数 ∪ 本地命名导出（契约选项只对导出函数
 * 存在）。用于 selectContract 的目标校验——「文件里根本没有这个名字」时
 * 不得回 success。
 */
function knownFunctionNames(
  source: string,
  targets: Map<string, { name: string; index: number }[]>,
): Set<string> {
  const names = new Set(targets.keys());
  for (const n of localNamedExports(source)) names.add(n);
  return names;
}

/**
 * 选择器/契约变更后的透镜刷新：CodeLens **与** inlayHint 成对发。
 * inlay 是「无 CodeLens UI 的客户端」唯一的选择器状态镜像（lsp.md §inlay），
 * 只发 codeLens 会让两个镜像互相矛盾（757）。
 */
function refreshLenses(deps: CommandDeps): void {
  deps.connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});
  deps.connection.sendRequest(InlayHintRefreshRequest.type).catch(() => {});
}

export function makeHandleSelectCase(deps: CommandDeps) {
  return async function handleSelectCase(params: {
    uri?: string;
    file?: string;
    functionName: string;
    caseIndex: number;
  }) {
    // 764：函数名零校验 ⇒ 任意名字（空串 / 不存在的函数）都被当成真写进
    // 活动档表（幽灵条目，getActiveCases 如实上报）。先校验形态。
    const functionName = params.functionName;
    if (typeof functionName !== "string" || functionName.length === 0) {
      return commandError(
        "Error: functionName is required and must be a non-empty string",
      );
    }
    // 756：caseIndex 零校验 ⇒ -1 让分析崩溃（argsAbs 越界）、99 静默改掉
    // 观察档。先校验形态（整数），再校验范围（落在该函数的 case 列表内）。
    const caseIndex = params.caseIndex;
    if (!Number.isInteger(caseIndex)) {
      return commandError("Error: caseIndex is required and must be an integer");
    }
    // 955：uri/file 形态校验（非法 file 不再崩成裸 TypeError，也不再回落 cwd）。
    const target = resolveTargetUri(params, deps);
    if ("error" in target) return commandError(target.error);

    const read = readTargetSource(target.uri, deps);
    if ("error" in read) return commandError(read.error);

    let targets: Map<string, { name: string; index: number }[]>;
    try {
      targets = caseTargets(read.filePath, read.source);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return commandError(
        `Error: cannot parse target file (${sanitizeErrorMessage(msg, deps.agentToolDeps.workspaceRoots)})`,
      );
    }
    if (!knownFunctionNames(read.source, targets).has(functionName)) {
      return commandError(`Error: unknown function '${functionName}' in target file`);
    }
    const cases = targets.get(functionName) ?? [];
    if (cases.length === 0) {
      return commandError(
        `Error: function '${functionName}' has no @nudo:case to select`,
      );
    }
    if (caseIndex < 0 || caseIndex >= cases.length) {
      return commandError(
        `Error: caseIndex ${caseIndex} is out of range for function '${functionName}' (valid: 0..${cases.length - 1})`,
      );
    }

    const casesTable = deps.getActiveCases(target.uri);
    casesTable.set(functionName, caseIndex);

    const document = deps.getDocument(target.uri);
    if (document) {
      await deps.validateDocument(document);
    }

    // 758：选择器改了分析输入 ⇒ pull 诊断面也要重取（只发 codeLens 时
    // pull 诊断客户端永远看不到切换后的新诊断）。
    deps.refreshPullDiagnostics();
    refreshLenses(deps);

    return { success: true };
  };
}

export function makeHandleSelectContract(deps: CommandDeps) {
  return async function handleSelectContract(params: {
    uri?: string;
    file?: string;
    functionName: string;
  }) {
    // 763：目标函数不存在、参数全缺时也回 success:true（假成功）。先校验形态。
    const functionName = params.functionName;
    if (typeof functionName !== "string" || functionName.length === 0) {
      return commandError(
        "Error: functionName is required and must be a non-empty string",
      );
    }
    // 955：uri/file 形态校验（两者都缺时不再回落服务器 cwd）。
    const target = resolveTargetUri(params, deps);
    if ("error" in target) return commandError(target.error);

    const read = readTargetSource(target.uri, deps);
    if ("error" in read) return commandError(read.error);

    let targets: Map<string, { name: string; index: number }[]>;
    try {
      targets = caseTargets(read.filePath, read.source);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return commandError(
        `Error: cannot parse target file (${sanitizeErrorMessage(msg, deps.agentToolDeps.workspaceRoots)})`,
      );
    }
    if (!knownFunctionNames(read.source, targets).has(functionName)) {
      return commandError(`Error: unknown function '${functionName}' in target file`);
    }

    // 契约是观察选择器的一个选项（与各 case 互斥）：选中 = 取消该函数的激活
    // case（无条目即默认契约观察态，幂等），重检 + 刷新透镜。
    const cases = deps.getActiveCases(target.uri);
    cases.delete(functionName);

    const document = deps.getDocument(target.uri);
    if (document) {
      await deps.validateDocument(document);
    }

    // 758：pull 诊断面同 757 的 inlay 镜像一起刷新。
    deps.refreshPullDiagnostics();
    refreshLenses(deps);

    return { success: true };
  };
}

export function makeHandleGetActiveCases(deps: CommandDeps) {
  return function handleGetActiveCases(params: { uri?: string; file?: string }) {
    // 955：uri/file 形态校验——非法 file 不再以裸 TypeError 逃出工具
    // （逃逸 ⇒ 客户端拿到 JSON-RPC 协议错误而非 isError 工具错误）。
    const target = resolveTargetUri(params, deps);
    if ("error" in target) return commandError(target.error);
    const cases = deps.getActiveCases(target.uri);
    const result: Record<string, number> = {};
    for (const [fn, idx] of cases) {
      result[fn] = idx;
    }
    return result;
  };
}

/**
 * emit 目标路径：uri 或 file 必须是非空字符串（955）——否则直接给形态化
 * 工具错误，不再让非法值走到 `file.startsWith` 崩成裸 TypeError。
 */
function resolveEmitFilePath(
  params: { uri?: unknown; file?: unknown },
  deps: CommandDeps,
): { filePath: string } | { error: string } {
  const rawUri = params.uri;
  if (rawUri !== undefined && rawUri !== null) {
    if (typeof rawUri !== "string" || rawUri.length === 0) {
      return { error: "Error: uri is required and must be a non-empty string" };
    }
    return { filePath: uriToFilePath(rawUri) };
  }
  const rawFile = params.file;
  if (typeof rawFile !== "string" || rawFile.length === 0) {
    return { error: FILE_REQUIRED };
  }
  try {
    return { filePath: normalizeFilePath(rawFile) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      error: `Error: invalid file parameter (${sanitizeErrorMessage(msg, deps.agentToolDeps.workspaceRoots)})`,
    };
  }
}

/**
 * `nudo.contract.emit`：与 CLI `nudo contract --emit` 同一写盘器固化单个
 * 导出（design-refine-derivation §7.5）。`dryRun: true` 时只预览（与 CLI
 * `--dry-run` 同源），不写盘、不跑写盘后的失效链。
 * 真实写盘后：
 * 1. 重登记隐式侧车边（新建侧车在上次验证时不存在，边未登记）并定向
 *    逐出依赖 memo、重检打开中的父文件（handleNudoDepFileChanged）；
 * 2. 该文件若打开则重验证（validateDocument，侧车新内容进诊断/缓存）；
 * 3. 广播 CodeLensRefresh + inlayHintRefresh（固化后 persist → update 档切换）。
 */
export function makeHandleContractEmit(deps: CommandDeps) {
  return async function handleContractEmit(params: {
    uri?: string;
    file?: string;
    functionName: string;
    mode: "add" | "update";
    dryRun?: boolean;
    /** 使用点记录入口（Bug 994）：与 CLI `nudo contract --from` 等价。 */
    from?: string[];
  }): Promise<AgentToolResult> {
    try {
      // 955：入参形态校验 + 异常兜底——异常不得逃出工具（逃逸 ⇒ 客户端拿到
      // JSON-RPC 协议错误而非 isError 工具错误）。
      const target = resolveEmitFilePath(params, deps);
      if ("error" in target) return toolError(target.error);
      const filePath = target.filePath;
      const dryRun = params.dryRun === true;
      // 必须传 agentToolDeps：workspaceRoots 来自 onInitialize 注入，emit 写盘
      // 边界（assertEmitTargetAllowed）依赖它。漏传会让边界静默失效。
      const toolResult = await contractEmitTool(
        {
          file: filePath,
          functionName: params.functionName,
          mode: params.mode,
          ...(dryRun ? { dryRun: true } : {}),
          // 994：`from` 必须过协议入口转发 —— 否则 `nudo/contract.emit` 收不到
          // 使用点记录（工具面已支持，但这里是唯一入口 ⇒ 不转发就等于没有）。
          ...(params.from ? { from: params.from } : {}),
        },
        deps.agentToolDeps,
      );

      // emit 失败（入参校验 / 写盘异常）：不进入失效链路——侧车并未写入，
      // 「sidecar written but cache invalidation failed」会撒谎并叠加二次异常
      const emitText = toolResult.content[0]?.text ?? "";
      if (emitText.startsWith("Error:")) {
        refreshLenses(deps);
        return toolResult;
      }

      // dry-run：侧车未写盘 → 跳过失效/重验证；结果文本已是 [dry-run] 预览
      if (dryRun) {
        return toolResult;
      }

      // 侧车写盘/新建后的缓存失效与重验证（agent 面按路径调用时文件可能未打开）
      let invalidateError: string | undefined;
      try {
        const openDoc = deps.listDocuments().find((d) => cacheKey(d.uri) === cacheKey(filePath));
        registerNudoImportDeps(
          filePath,
          openDoc ? openDoc.getText() : readFileSync(filePath, "utf-8"),
        );
        await handleNudoDepFileChanged(sidecarPathOf(filePath), deps.validationDeps());
        deps.refreshPullDiagnostics();
        if (openDoc) {
          analysisCache.delete(cacheKey(filePath)); // version 键未变，逐出防 getCachedOrAnalyze 命中陈旧结果
          await deps.validateDocument(openDoc);
        }
      } catch (e) {
        // 写盘已成功；失效/重验证失败须可见——否则用户看到 written 但诊断/lens 仍是旧契约
        invalidateError = e instanceof Error ? e.message : String(e);
        deps.connection.console.error(
          `nudo.contract.emit: sidecar written but cache invalidation failed: ${invalidateError}`,
        );
      }

      refreshLenses(deps);
      if (invalidateError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `${emitText}\n\n[warning] sidecar written but cache invalidation failed (diagnostics/lenses may be stale): ${invalidateError}`,
            },
          ],
        };
      }
      return toolResult;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return toolError(
        `Error: ${sanitizeErrorMessage(msg, deps.agentToolDeps.workspaceRoots)}`,
      );
    }
  };
}
