/**
 * VS Code `nudo.*` 设置 → LSP 载荷的纯映射（无 vscode 模块依赖，单测直接跑）。
 *
 * 协议形状与 lsp server 的合并逻辑对齐：
 * - `initializationOptions` = `{ analysis?: { mode } }`（client 启动时）
 * - `workspace/didChangeConfiguration` 的 `settings.nudo` 同形（设置变更时）
 *
 * 优先级（配置项 description 同步写明）：项目 package.json#nudo.analysis.mode
 * 显式值赢；VS Code 设置只在项目未显式设置该键时作为默认值。
 */

export type NudoAnalysisMode = "exports" | "directives" | "all";

/** `workspace.getConfiguration("nudo")` 的最小读取面（WorkspaceConfiguration 结构满足）。 */
export type NudoSettingsLike = {
  get<T = unknown>(section: string): T | undefined;
};

/** analysis.mode 归一化：非法/缺失 → undefined（服务端回落产品默认 exports）。 */
export function parseAnalysisMode(raw: unknown): NudoAnalysisMode | undefined {
  return raw === "exports" || raw === "directives" || raw === "all" ? raw : undefined;
}

/** nudo 段设置 → 服务端可理解的 `{ analysis?: { mode } }`。 */
export function toNudoSettings(
  cfg: NudoSettingsLike,
): { analysis?: { mode: NudoAnalysisMode } } {
  const mode = parseAnalysisMode(cfg.get("analysis.mode"));
  return mode === undefined ? {} : { analysis: { mode } };
}

/** LanguageClient `initializationOptions`（与 `settings.nudo` 同形）。 */
export function toInitializationOptions(cfg: NudoSettingsLike): {
  analysis?: { mode: NudoAnalysisMode };
} {
  return toNudoSettings(cfg);
}

/** `workspace/didChangeConfiguration` 通知载荷（只含 nudo 段，避免噪声）。 */
export function toDidChangeConfigurationParams(cfg: NudoSettingsLike): {
  settings: { nudo: { analysis?: { mode: NudoAnalysisMode } } };
} {
  return { settings: { nudo: toNudoSettings(cfg) } };
}
