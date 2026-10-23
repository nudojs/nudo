/**
 * L2 门禁配置的**配置面解析**（`package.json#nudo.check`）。
 *
 * ⚠ **为什么本包自己解析 `ignoreThrows`**：service 的 `checkConfig` 只认**严格
 * `string[]`**（`Array.isArray` + 逐项 `typeof === "string"`）⇒ 配置写成
 * `"TypeError"`（裸字符串）或 `["TypeError,RangeError"]`（数组元素内含逗号）时
 * 被**静默丢成空表** ⇒ IDE 仍报 `nudo:entry-may-throw`（假红），而 CLI
 * （`packages/nudojs/src/check-gate-config.ts` 的 `parseIgnoreThrows`）**认**这两种
 * 写法 ⇒ **同一份 package.json，CLI 绿 / IDE 红**（两面口径分裂）。
 *
 * CLI 的解析器在 `nudojs` 包内（`nudojs` **不依赖** `@nudojs/lsp`，反向依赖会
 * 打破包依赖图）⇒ 本包按**同一语义**实现一份（裸字符串 / 字符串数组都接受；
 * 数组元素内部**也**按逗号切分；trim 后丢空；非字符串元素忽略；全空 ⇒ 空表）。
 *
 * 语义对齐的单一真源仍是 CLI 侧的 `parseIgnoreThrows`——本函数是它的**同语义
 * 镜像**，改动时两侧必须同步（否则两面又分裂）。
 */

/**
 * `ignoreThrows` 的**原始值** → 归一后的错误名列表。
 *
 * - 裸字符串 / 字符串数组都接受；
 * - 数组元素内部也按逗号切分（`["TypeError,RangeError"]` ⇒ 两项）；
 * - trim 后丢空串；非字符串元素忽略；
 * - 全空 ⇒ `undefined`（=「没设」⇒ 回落默认）。
 */
export function parseIgnoreThrows(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parts = Array.isArray(raw) ? raw : [raw];
  const out = parts
    .flatMap((s) => (typeof s === "string" ? s.split(",") : []))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * `package.json#nudo.check.ignoreThrows` → 与 CLI 同口径的错误名列表。
 *
 * 用法：LSP 执法面（诊断 / agent `check` 工具）把本结果传给
 * `checkSource(..., { ignoreThrows })` ⇒ 与 CLI `nudo check` 同口径。
 */
export function configIgnoreThrows(
  config: { check?: unknown } | null | undefined,
): string[] {
  const raw = config?.check as { ignoreThrows?: unknown } | undefined;
  return parseIgnoreThrows(raw?.ignoreThrows) ?? [];
}
