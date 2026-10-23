/**
 * 行注释（`//`）文本清洗器 —— **模块私有**（不进任何公开面；`emit/index.ts`
 * 不 re-export 本模块）。
 *
 * core 的 `sanitizeCommentText`（`core/src/algebra/codegen-escape.ts`，经
 * `@nudojs/core/internal` 公开）只有**一种**行为：无条件把块注释闭合序列
 * （星号 + 斜杠）转义成 `*\/` —— 那是**块注释 / JSDoc** 口径（必要：否则
 * 注释体被提前闭合）。
 *
 * 但**行注释**到行尾结束，闭合序列在 `//` 上下文**没有语法含义** ⇒ 转义纯属
 * 污染：`nudo contract --draft` 的契约草案注释被写成 `*\/`，而用户要把这段
 * 文字**原样抄进侧车**（Bug 411）。
 *
 * 本模块的口径（只服务 `//` 上下文）：
 * - 块注释闭合序列：**原样保留**（行注释无闭合语义）
 * - 换行 / U+2028 / U+2029 / 控制字符：**必须中和成空格**（否则 `//` 注释里
 *   的换行会把后续文本注入代码 —— 这是**不能**省的那一半）
 *
 * 块注释侧（JSDoc，`emit/dts-generator.ts`）**保持原样**用 core 的
 * `sanitizeCommentText`（那里闭合序列的转义是必要的）。
 */

/** 行注释体清洗：中和换行 / 控制字符，块注释闭合序列原样保留。 */
export function sanitizeLineCommentText(text: string): string {
  return text.replace(/[\r\n\u2028\u2029\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ");
}
