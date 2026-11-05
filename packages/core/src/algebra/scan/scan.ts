/**
 * 源码级调用图侦察：从 check 门禁拆出的 AST 扫描层（编排面）。
 *
 * 职责：不做代数求值结论，只回答「谁在调用谁、实参长什么样」——实现已
 * 按缝拆成同层文件，此处 re-export 保持 scan.ts 对外形状不变：
 * - listTopFunctions：顶层函数清单（scan-top-functions.ts）
 * - collectCallResolvers / resolveCalleeFn / collectForwarders：调用图
 *   resolve（scan-call-graph.ts：别名 / 对象属性 / require / 动态 import /
 *   无条件转发）
 * - scanLiteralCalls / absUnknown：字面量调用点违例扫描 + 静态实参求值
 *   辅助（scan-literal-calls.ts）
 * - checkInjectedDomainEvidence：跨文件注入域证据（T10b，
 *   scan-injected-domain.ts）
 */

// ---------------------------------------------------------------------------
// 顶层函数清单 → scan-top-functions.ts（对外形状经 re-export 保持不变）
// ---------------------------------------------------------------------------

export { listTopFunctions } from "./scan-top-functions.ts";

// ---------------------------------------------------------------------------
// 字面量调用点违例扫描 → scan-literal-calls.ts（scanLiteralCalls 与静态实参
// 求值辅助 absUnknown；对外形状经 re-export 保持不变）
// ---------------------------------------------------------------------------

export { absUnknown, scanLiteralCalls } from "./scan-literal-calls.ts";

// ---------------------------------------------------------------------------
// T10b：跨文件注入调用点域证据 ⊄ 手写契约（nudo:interface-domain-exceeds）
// 实现见 scan-injected-domain.ts；此处 re-export 保持 scan.ts 对外形状不变。
// ---------------------------------------------------------------------------

export {
  checkInjectedDomainEvidence,
  type InjectedDomainRecord,
  type InjectedDomainEvidenceOpts,
} from "./scan-injected-domain.ts";
