/**
 * `--ignore-throws` / `package.json#nudo.check.ignoreThrows` 解析的
 * **单一实现**（CLI / LSP / vite-plugin 三面共享）。
 *
 * 历史：三份同语义实现各自手抄（nudojs `check-gate-config.ts` 为语义源、
 * lsp `gate-config.ts` 自认镜像、vite-plugin `check-assembly.ts` 自认第三
 * 份），且签名已分叉（全空时 nudojs 版返 `undefined`、vite 版返 `[]`）——
 * 同一份 package.json 三面三口径（BUG-110 历史重演）。
 *
 * 语义：裸字符串 / 字符串数组都接受；数组元素内部**也**按逗号切分；
 * trim 后丢空；非字符串元素忽略；全空 ⇒ `undefined`（=「没设」，回落
 * 默认）。
 */
export function parseIgnoreThrows(raw?: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parts = Array.isArray(raw) ? raw : [raw];
  const out = parts
    .flatMap((s) => (typeof s === "string" ? s.split(",") : []))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * package.json#nudo.check.ignoreThrows 的**原始**值 → 与 CLI 同口径的列表
 * （679：配置面复用本解析器，不再走各面自己的严格 `string[]` 过滤——
 * 裸字符串 `"TypeError"` 曾被静默丢成空表 ⇒ 门禁假红）。
 */
export function configIgnoreThrows(
  config: { check?: unknown } | null | undefined,
): string[] {
  const raw = config?.check as { ignoreThrows?: unknown } | undefined;
  return parseIgnoreThrows(raw?.ignoreThrows) ?? [];
}
