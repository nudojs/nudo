import type { Abs } from "@nudojs/core";
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

/**
 * case 实参是否**全是字面量** ⇒ 该 case 是**点观测**（返回值也只是那个点，
 * 不是调用域）。
 *
 * 判据与 analyzer 侧同源（`analyzer-orchestrate-uncached.ts` 的
 * `isPointObservationArgs`）：约束构建器实参（`number()` / `shape()` /
 * `union()` …）求值在**域**上 ⇒ 其 Abs 不带 `lit` term；具体字面量实参 ⇒
 * `term.op === "lit"`。
 */
export function isPointObservationArgs(args: readonly Abs[]): boolean {
  return args.length > 0 && args.every((a) => a.term?.op === "lit");
}

/**
 * 指令 case（`@nudo:case`）是**域声明**还是**纯点观测见证**。
 *
 * - **域声明**：实参是**约束构建器**（域形状：求值发生在**域**上，返回值
 *   本身就是域）或带**断言**（`=> expected`：用户申报了这次调用的返回值）
 *   ⇒ 可作域来源（与返回义务来源）。
 * - **纯点观测见证**：实参**全是字面量**且**无断言** ⇒ 只是「这次调用没抛、
 *   返回了这个」的观测记录（debug witness）⇒ **不得**进契约产物。
 *
 * BUG-035：`nudo contract --emit` 曾把纯点观测见证写成契约
 * （`fn({ x: lit(5) }, lit(6))`），与 `nudo check` 的
 * `f(x: any) => number | string` 自相矛盾 ⇒ 用户为调试加一条
 * `@nudo:case` 就把函数**固化**成只接受那个点。与 analyzer 侧
 * 「点观测不得独占返回面」的禁令同口径。
 */
export function isDomainDeclarationCase(c: CaseResult): boolean {
  if (c.expected !== undefined) return true; // 带断言 = 申报（声明）
  return !isPointObservationArgs(c.argAbs); // 约束构建器实参 = 域形状（声明）
}
