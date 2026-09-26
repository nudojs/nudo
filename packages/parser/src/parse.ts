import { parseSource } from "@nudojs/core";
import type { File } from "@babel/types";

/**
 * 所有权：Babel 解析与 TS 剥除的**实现**在 `@nudojs/core`
 * （`algebra/parse-source.ts` / `strip-types.ts`）—— core 代数层
 * （check/scan/generalize）需要 AST 且不能反向依赖本包。本包职责是
 * `@nudo:` 指令抽取与 AST 卫兵；`parse()` 是宿主入口，委托 core 同一实现与 AST LRU。
 *
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
