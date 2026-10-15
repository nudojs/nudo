// 循环不变式 @nudo:invariant：循环携带界的用户声明通道（@nudo:assume 的循环类比物）。
// DP 表的「所有格子 ≥ 0」是算法事实，但循环宽化只保留值域（number），区间证据
// 在 join/宽化中丢失——引擎不自动推断循环不变式（research-grade），由用户声明。
// 指令沿路径下钻（[*] = 元素/逐成员，.ident = 对象槽）强化数值叶子 pred。
// 运行：pnpm run check docs/examples/constraints/levenshtein.js
//
// check 输出（OK；证明依赖不变式 → info 审计标注）：
//   levenshtein(a: string, b: string) => 0 | number
//   [INFO levenshtein] levenshtein: return contract proved via @nudo:invariant dp[*][*] >= 0  (nudo:invariant-relied)
// 去掉 @nudo:invariant 行，同文件 + 侧车诚实保留 warning nudo:unproven-return
//（返回面 number | undefined——抽象下标读 dp[m][n] 合成 OOB undefined 读位事实，
// if-guard 排除后仍缺区间证据，证不出也不误证）。

/**
 * @nudo:invariant dp[*][*] >= 0
 */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  const out = dp[m][n];
  if (out === undefined) return 0;
  return out;
}
