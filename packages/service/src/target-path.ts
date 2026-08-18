/**
 * nudo 推断目标文件判定（纯扩展名规则，路径无需存在）。
 *
 * 规则：.js / .mjs / .ts 可作为推断目标；其余扩展（.cjs/.tsx/.jsx/.mts/.d.ts…）
 * 一律 false。两类显式排除：
 *  - .d.ts —— 类型声明文件（harvester 的输入），不是可求值的实现源码；
 *  - .tsx / .jsx —— JSX 构造的求值超出 nudo 推断器范围。
 *
 * 消费方：CLI 的 collectNudoFiles/watch 过滤/doctor 目录展开（.ts 放开后统一
 * 走本函数，避免各处手写 endsWith 漂移），以及 LSP 的 isNudoFile（接线由
 * LSP 侧负责）。
 */
export function isNudoTargetPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".d.ts")) return false; // 类型声明，非推断目标
  return lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".ts");
}
