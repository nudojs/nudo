/**
 * 求值引擎侧 re-export 面：定义在内核叶子 algebra/nudo-throw.ts。
 * （内核 arithmetic/surface/methods、builtins/* 消费 NudoThrow，而内核不得
 * import exec/——exec 是引擎消费者。）保留本文件：runtime/state.ts 等
 * 引擎模块与既有 import 路径继续经此可达。
 */
export { NudoThrow, isNudoThrow } from "../nudo-throw.ts";
