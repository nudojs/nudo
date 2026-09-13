import { parseSource } from "@nudojs/core";
import type { File } from "@babel/types";

/**
 * 与 core `parseSource` 同一实现与 AST LRU：
 * 决策：parse() 统一做 TS 剥除（不按 .ts 路径开关）。理由：parse() 的产物被
 * CLI/service/LSP/evaluator 全链消费，按调用方 opt-in 会漏掉无法感知文件扩展名
 * 的消费方（analyzer 的模块解析、LSP 等）；对纯 JS 源码剥除是结构性 no-op，
 * 默认行为不变，因此无条件执行可让 .ts 输入在所有入口零接线生效。
 *
 * errorRecovery 走 core 的非缓存路径，避免污染会话 AST。
 */
export function parse(source: string, opts?: { errorRecovery?: boolean }): File {
  return parseSource(source, opts);
}
