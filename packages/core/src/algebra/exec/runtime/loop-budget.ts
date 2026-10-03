/**
 * 循环展开上限（leaf）—— 从 control.ts 拆出，打断 control ↔ containers 环。
 */
export const DEFAULT_MAX_LOOP_ITERS = 8;

/**
 * 具体循环硬上限：maxIters 预算耗尽但循环条件仍 definitely-true（迭代空间
 * 具体可判定）时，继续展开到该上限——截断在具体循环上会产出**错误的
 * #exact**（`for (i=0;i<glob.length;i++)` 对 12 字符串只跑 8 轮，拼出
 * `^lib\/debu$` 还声明 exact）。到达硬上限仍未终止 → noteAbsTruncation
 * 上报 + conf 降级（有界、可观测，与 fork/call 预算同 posture）。
 * 抽象条件循环语义不变（仍以 maxIters 为预算）。
 */
export const MAX_CONCRETE_LOOP_ITERS = 1024;

/** 具体循环硬上限截断的观测 label（→ truncatedFns / budget 面） */
export const LOOP_TRUNCATION_LABEL = "#loop-iterations";
