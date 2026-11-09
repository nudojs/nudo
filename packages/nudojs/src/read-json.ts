/**
 * package.json 等文本配置的统一读取口径：**先剥 UTF-8 BOM 再 JSON.parse**（Bug 15）。
 *
 * BOM（U+FEFF）是合法的 UTF-8 文本前缀（Windows 编辑器默认写入），但
 * `JSON.parse` 不接受前导 U+FEFF ⇒ 直接 parse 会抛
 * `Unexpected token '\uFEFF'…`。仓库对**源文件 / 侧车**早已统一去 BOM
 * （`commands/shared.ts:205`、`commands/health.ts:102`、
 * `commands/contract-emit.ts:261-264` 用
 * `charCodeAt(0) === 0xfeff ? slice(1) : source`）；`package.json` 是同一类
 * 文本配置，读取点必须同口径，否则项目配置静默失效（loader 回落默认 →
 * L2 从 warning 翻 error）、`init` 误判「JSON 非法」、`migrate` 全线阻塞。
 *
 * 服务侧 `packages/service/src/evaluator/config.ts` 属于另一个包，不能反向
 * import 本 helper ⇒ 那里内联同一条 `charCodeAt(0) === 0xfeff` 表达式。
 */

/** 去掉开头的 UTF-8 BOM（U+FEFF）；无 BOM 时原样返回。 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 剥 BOM 后 JSON.parse（返回 unknown，由调用点按既有类型断言收窄）。 */
export function parseJsonText(text: string): unknown {
  return JSON.parse(stripBom(text));
}
