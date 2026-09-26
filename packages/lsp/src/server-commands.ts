/**
 * `nudo.*` 命令处理器（selectCase / getActiveCases / contract.emit）。
 * 自 server.ts 机械拆出；语义未改。dispatchNudoCommand 留在 server.ts
 * （public-api-surface 测试要求 case 标签出现在 server.ts 源文本中）。
 */
import { readFileSync } from "node:fs";
import {
  CodeLensRefreshRequest,
  type Connection,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { sidecarPathOf } from "@nudojs/core";
import {
  contractEmitTool,
  normalizeFilePath,
  type AgentToolDeps,
  type AgentToolResult,
} from "./agent-tools.ts";
import {
  analysisCache,
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
  const filePath = normalizeFilePath(params.file ?? "");
  const doc = deps.listDocuments().find((d) => uriToFilePath(d.uri) === filePath);
  return doc ? doc.uri : `file://${filePath}`;
}

export function makeHandleSelectCase(deps: CommandDeps) {
  return async function handleSelectCase(params: {
    uri?: string;
    file?: string;
    functionName: string;
    caseIndex: number;
  }) {
    const uri = uriForFileOrUri(params, deps);
    const cases = deps.getActiveCases(uri);
    cases.set(params.functionName, params.caseIndex);

    const document = deps.getDocument(uri);
    if (document) {
      await deps.validateDocument(document);
    }

    deps.connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});

    return { success: true };
  };
}

export function makeHandleGetActiveCases(deps: CommandDeps) {
  return function handleGetActiveCases(params: { uri?: string; file?: string }) {
    const cases = deps.getActiveCases(uriForFileOrUri(params, deps));
    const result: Record<string, number> = {};
    for (const [fn, idx] of cases) {
      result[fn] = idx;
    }
    return result;
  };
}

/**
 * `nudo.contract.emit`：与 CLI `nudo contract --emit` 同一写盘器固化单个
 * 导出（design-refine-derivation §7.5）。`dryRun: true` 时只预览（与 CLI
 * `--dry-run` 同源），不写盘、不跑写盘后的失效链。
 * 真实写盘后：
 * 1. 重登记隐式侧车边（新建侧车在上次验证时不存在，边未登记）并定向
 *    逐出依赖 memo、重检打开中的父文件（handleNudoDepFileChanged）；
 * 2. 该文件若打开则重验证（validateDocument，侧车新内容进诊断/缓存）；
 * 3. 广播 CodeLensRefresh（固化后 persist → update 档切换）。
 */
export function makeHandleContractEmit(deps: CommandDeps) {
  return async function handleContractEmit(params: {
    uri?: string;
    file?: string;
    functionName: string;
    mode: "add" | "update";
    dryRun?: boolean;
  }): Promise<AgentToolResult> {
    const filePath = params.uri
      ? uriToFilePath(params.uri)
      : normalizeFilePath(params.file ?? "");
    const dryRun = params.dryRun === true;
    // 必须传 agentToolDeps：workspaceRoots 来自 onInitialize 注入，emit 写盘
    // 边界（assertEmitTargetAllowed）依赖它。漏传会让边界静默失效。
    const toolResult = await contractEmitTool(
      {
        file: filePath,
        functionName: params.functionName,
        mode: params.mode,
        ...(dryRun ? { dryRun: true } : {}),
      },
      deps.agentToolDeps,
    );

    // emit 失败（入参校验 / 写盘异常）：不进入失效链路——侧车并未写入，
    // 「sidecar written but cache invalidation failed」会撒谎并叠加二次异常
    const emitText = toolResult.content[0]?.text ?? "";
    if (emitText.startsWith("Error:")) {
      deps.connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});
      return toolResult;
    }

    // dry-run：侧车未写盘 → 跳过失效/重验证；结果文本已是 [dry-run] 预览
    if (dryRun) {
      return toolResult;
    }

    // 侧车写盘/新建后的缓存失效与重验证（agent 面按路径调用时文件可能未打开）
    let invalidateError: string | undefined;
    try {
      const openDoc = deps.listDocuments().find((d) => uriToFilePath(d.uri) === filePath);
      registerNudoImportDeps(
        filePath,
        openDoc ? openDoc.getText() : readFileSync(filePath, "utf-8"),
      );
      await handleNudoDepFileChanged(sidecarPathOf(filePath), deps.validationDeps());
      deps.refreshPullDiagnostics();
      if (openDoc) {
        analysisCache.delete(filePath); // version 键未变，逐出防 getCachedOrAnalyze 命中陈旧结果
        await deps.validateDocument(openDoc);
      }
    } catch (e) {
      // 写盘已成功；失效/重验证失败须可见——否则用户看到 written 但诊断/lens 仍是旧契约
      invalidateError = e instanceof Error ? e.message : String(e);
      deps.connection.console.error(
        `nudo.contract.emit: sidecar written but cache invalidation failed: ${invalidateError}`,
      );
    }

    deps.connection.sendRequest(CodeLensRefreshRequest.type).catch(() => {});
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
  };
}
