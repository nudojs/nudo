/**
 * LSP 表面门面（hover / 补全 / 用例枚举）——域实现拆分至 ./lsp-surface/：
 * - position.ts：光标定位 + position↔offset 映射（叶子模块）；
 * - replay.ts：Abs 重放缓存 + 执行记录投影 + 位置 Abs 查询；
 * - facts.ts：流窄化事实（守卫走查）；
 * - narrowing.ts：判别窄化（union 臂过滤）；
 * - resolve.ts：类型值定义解析 / 变量链接 / 参数投影 / 用例枚举；
 * - hover.ts：hover 渲染（getHoverAtPosition）；
 * - completions.ts：补全（getCompletionsAtPosition）。
 *
 * 本文件只做显式具名 re-export（消费方 import 路径与名字零改动）；
 * 模块级可变状态（replayCache / fnLocalsCache）留在 replay.ts，不经
 * 门面转发（SSR 不变量）。分析编排仍在 analyzer.ts（@nudojs/service）。
 */
export {
  getAbsAtPosition,
  getAbsAtPositionAsync,
  getTypeAtPosition,
  getTypeAtPositionAsync,
  type SurfaceReuse,
} from "./lsp-surface/replay.ts";
export { getHoverAtPosition, type HoverInfo, type HoverInterfaceOpts } from "./lsp-surface/hover.ts";
export { getCompletionsAtPosition } from "./lsp-surface/completions.ts";
export { getCasesForFile, type CaseInfo } from "./lsp-surface/resolve.ts";
