/**
 * Benchmark gate 共享的机器因子（uniform shift）探测 —— 纯函数，无 IO。
 * 被 benchmark/src/gate.js 与 benchmark/oss/gate.mjs 两处消费。
 *
 * 背景（本机实测，2026-10）：本机相对 trusted 快机采的基线，OSS bench 假红
 * 形态是全部计时指标（totals + 各包 cold/check/hub）同向 +10~13% 窄带漂移；
 * 真实引擎回退几乎总是打中个别指标。据此用「同向 + 聚集 + 足够幅度」把
 * 环境漂移与定向回归区分开：
 *   - 指标数 ≥ 3（MIN_METRICS）：1–2 个计时点无法区分机器因子与定向回退，
 *     单指标幅度再大也不构成「均匀」证据（src gate 今日只有 avgMs 一项，
 *     探测因此恒不命中——其 3.0x 阈值本身也远大于机器因子量级）；
 *   - 全部 ratio 同向（全 >1 或全 <1）：机器因子不挑指标；
 *   - 每个 ratio 与中位数 ratio 偏差 ≤ 2 个百分点（MAX_SPREAD）：实测假红
 *     带宽约 ±1.5pp；定向回退会撕裂窄带；
 *   - |中位数 ratio − 1| ≥ 5%（MIN_MAGNITUDE）：更小幅度视作运行抖动，
 *     即便均匀也不值得提示（gate 时间阈值对抖动本有余量）。
 */

export const UNIFORM_SHIFT_MIN_METRICS = 3;
export const UNIFORM_SHIFT_MAX_SPREAD = 0.02;
export const UNIFORM_SHIFT_MIN_MAGNITUDE = 0.05;

function median(sorted) {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {Array<{name: string, baseline: number, current: number}>} metrics
 *   baseline ≤ 0 / 非有限（含 null/undefined，即「未设阈值」）的条目被忽略。
 * @returns {{uniform: true, medianRatio: number} | {uniform: false}}
 */
export function detectUniformShift(metrics) {
  const usable = (metrics ?? []).filter(
    (m) =>
      Number.isFinite(m?.baseline) &&
      m.baseline > 0 &&
      Number.isFinite(m?.current) &&
      m.current >= 0,
  );
  if (usable.length < UNIFORM_SHIFT_MIN_METRICS) return { uniform: false };
  const ratios = usable.map((m) => m.current / m.baseline).sort((a, b) => a - b);
  const medianRatio = median(ratios);
  const allUp = ratios.every((r) => r > 1);
  const allDown = ratios.every((r) => r < 1);
  if (!allUp && !allDown) return { uniform: false };
  if (!ratios.every((r) => Math.abs(r - medianRatio) <= UNIFORM_SHIFT_MAX_SPREAD)) {
    return { uniform: false };
  }
  if (Math.abs(medianRatio - 1) < UNIFORM_SHIFT_MIN_MAGNITUDE) return { uniform: false };
  return { uniform: true, medianRatio };
}

/** 命中 uniform 时两个 gate 共用的醒目提示（stderr）。 */
export function formatUniformShiftHint(medianRatio) {
  const pct = (medianRatio - 1) * 100;
  return (
    `疑似机器/环境因子（全指标均匀漂移 ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%）` +
    `——建议同机 A/B 或基线机复跑；确认环境因素可用 --allow-uniform-shift 放行`
  );
}
