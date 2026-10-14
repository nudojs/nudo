// 用户引理 @nudo:assume：跨变量前提（编辑距离 ≤ 较长串长一类的算法事实）
// 引理参与除法关系折叠（d <= max ∧ max > 0 ⇒ d/max ≤ 1），返回契约 1 - d/max ∈ [0,1] 可证
// 运行：pnpm run check docs/examples/constraints/similarity.js
//
// check 输出（OK；证明依赖引理 → info 审计标注）：
//   sim(d: number, max: number) => number
//   [INFO sim] sim: return contract proved via @nudo:assume d <= max  (nudo:assume-relied)
// 去掉 @nudo:assume 行，同文件 + 侧车诚实保留 warning nudo:unproven-return（证不出）。

/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
