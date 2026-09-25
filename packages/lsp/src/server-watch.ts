/**
 * watched-files 事件核心 + 监听器注册（自 server.ts 机械拆出；语义未改）。
 */
import {
  FileChangeType,
  type FileEvent,
} from "vscode-languageserver/node";
import { isWatchRelevantPath } from "@nudojs/service";
import {
  forgetValidatedFile,
  handleNudoDepFileChanged,
  uriToFilePath,
  type ValidateTextDeps,
} from "./validation.ts";

export type WatchDeps = {
  sendDiagnostics: (params: { uri: string; diagnostics: [] }) => void;
  isDocumentOpen: (uri: string) => boolean;
  activeCases: Map<string, Map<string, number>>;
  nudoFileCache: Map<string, boolean>;
  validationDeps: () => ValidateTextDeps;
  refreshPullDiagnostics: () => void;
  onDidChangeWatchedFiles: (
    handler: (event: { changes: readonly FileEvent[] }) => void,
  ) => void;
};

/**
 * watched-files 删除事件监听器：接收「被删除且不在打开集」的 uri 列表。
 * 缓存逐出等后续逻辑通过 registerWatchedFilesListener 挂到这里。
 */
export const watchedFilesListeners: Array<(uris: string[]) => void> = [];

/** 注册 watched-files 监听器，返回注销函数。 */
export function registerWatchedFilesListener(listener: (uris: string[]) => void): () => void {
  watchedFilesListeners.push(listener);
  return () => {
    const idx = watchedFilesListeners.indexOf(listener);
    if (idx >= 0) watchedFilesListeners.splice(idx, 1);
  };
}

/**
 * watched-files 事件核心：对 Deleted 且不在打开集的文件清理会话登记项
 * （knownFiles/analysisCache 走 forgetValidatedFile，activeCases/nudoFileCache 按 uri），
 * 清空其已发布诊断，并把被清理的 uri 列表广播给监听器。
 * 打开中的文件跳过——其内容由编辑流负责，外部删除会被编辑器以 didOpen/didChange 覆盖。
 */
export function isNudoDepPath(filePath: string): boolean {
  // 与 CLI watch 同口径：侧车 + 项目配置 + env 模板 + 分析目标
  // （外部改 import 依赖也必须让打开中的 parent 失效）
  return isWatchRelevantPath(filePath);
}

export function handleWatchedFilesChanges(
  changes: readonly FileEvent[],
  isOpen: (uri: string) => boolean,
  deps: WatchDeps,
): string[] {
  const gone: string[] = [];
  const nudoTouched: string[] = [];
  for (const change of changes) {
    const filePath = uriToFilePath(change.uri);
    if (change.type === FileChangeType.Deleted) {
      if (isOpen(change.uri)) continue;
      gone.push(change.uri);
      forgetValidatedFile(filePath);
      deps.activeCases.delete(change.uri);
      deps.nudoFileCache.delete(change.uri);
      deps.sendDiagnostics({ uri: change.uri, diagnostics: [] });
      if (isNudoDepPath(filePath)) nudoTouched.push(filePath);
      continue;
    }
    // Create/Change：契约模板变更 → 定向逐出 L0 + 重检打开中的父文件
    if (isNudoDepPath(filePath)) {
      nudoTouched.push(filePath);
    }
  }
  if (gone.length > 0) {
    // 拷贝后再遍历：监听器内注销自身不应影响本轮广播
    for (const listener of [...watchedFilesListeners]) {
      try {
        listener(gone);
      } catch {
        // 单个监听器异常不阻断其余监听器的缓存逐出
      }
    }
  }
  if (nudoTouched.length > 0) {
    const dep = deps.validationDeps();
    for (const p of nudoTouched) {
      void handleNudoDepFileChanged(p, dep)
        .then(() => deps.refreshPullDiagnostics())
        .catch(() => {});
    }
  }
  return gone;
}

/** 挂接 connection.onDidChangeWatchedFiles。 */
export function attachWatchedFiles(deps: WatchDeps): void {
  deps.onDidChangeWatchedFiles((event) => {
    void handleWatchedFilesChanges(
      event.changes,
      (uri) => deps.isDocumentOpen(uri),
      deps,
    );
  });
}
