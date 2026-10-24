import type { CaseResult } from "../analyzer.ts";

/**
 * 产物面（dts / zod / standard / guard）的**域证据 case**。
 *
 * `@nudo:case` 指令有两个角色：
 * - **声明**（带 `=> expected` 断言）——用户申报了这次调用的返回值 ⇒ 参与
 *   产物面（它是一份声明）。
 * - **见证**（无断言）——"这次调用没抛、返回了这个"的观测记录 ⇒ 只服务
 *   debug / `nudo test` / LSP 面。**不得**参与产物面：否则
 *   `nudo test --freeze` 把外部调用点写回源码后，产物面会塌缩成那个单点
 *   字面量（zod 面 `z.literal(3)` / guard 面 `data === 3`）——守卫只接受
 *   `3`，把合法调用判成非法，且 check 面与 export 面口径漂移（Bug 511）。
 *
 * 合成证据（`call@` / `entry@`，`source !== "directive"`）是**观测到的调用
 * 域**（本文件内的调用点 / 入口求值），参与产物面。
 *
 * 无其它证据时回落全部 case（见证至少是下界证据，保持既有行为）。
 */
export function domainEvidenceCases(cases: readonly CaseResult[]): CaseResult[] {
  const declared = cases.filter((c) => c.source !== "directive" || c.expected !== undefined);
  return declared.length > 0 ? declared : [...cases];
}
