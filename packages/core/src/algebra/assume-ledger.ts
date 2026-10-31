/**
 * 用户引理（`@nudo:assume`）**消费记账**（族 07 · Bug 367 最小可观测版）。
 *
 * 审计归因（「返回契约的证明依赖了哪条引理」）需要的是**证明链真正消费过**的
 * 引理，而不是「函数上声明了哪条引理」这个代理量。本模块只做**记账**：
 * - 引理消费点（div / sub 的同名相关性折叠）把命中的前提记进来；
 * - check 面（check.ts）在种子求值前后清账 / 取快照，回传给审计标注。
 *
 * 记账**不参与任何判定**：记与不记都不影响 prove / disprove 的结论
 * （只影响「proved via @nudo:assume X」这条 info 的归因内容）。
 *
 * 内部模块：不进任何 barrel（零新增公共导出）。
 */
import type { Pred } from "./pred.ts";

/** 本轮（动态域内）被消费的用户引理前提（按对象身份去重） */
let consumed: Pred[] = [];

/**
 * 记账：某条用户引理前提**真的产出了界**（消费点调用）。
 *
 * 前提对象身份 = 记账身份：check 面用同一批对象（assumePremisesPhiOf 造的
 * le 原子）做交集判定 ⇒ 只认「这条引理」被消费过，不认「函数上有这条引理」。
 */
export function noteAssumeConsumed(premise: Pred): void {
  if (!consumed.includes(premise)) consumed.push(premise);
}

/** 本轮消费快照（check 面取；对象身份即引理身份） */
export function assumeConsumed(): readonly Pred[] {
  return consumed;
}

/**
 * BUG-084：`@nudo:invariant` 的**实施账本**（与上面的 assume 账本同款口径）。
 *
 * 审计归因（「返回契约的证明依赖了哪条循环不变式」）需要的是**证明链真正
 * 消费过**的不变式，而不是「函数上声明了哪条不变式」。旧口径是后者 ⇒
 * 声明在**没有循环**、对证明**零贡献**的函数上也会无条件报
 * `nudo:invariant-relied`（审计归因说谎，且与 assume 族口径分裂）。
 *
 * 记账点 = `exec/runtime/invariant-apply.ts` 的 `applyInvariantsToPack`：
 * 某条 spec 真的**改写**了循环 join/宽化产物上的叶子时记一次（对象身份 =
 * spec 身份）。记账**不参与任何判定**。
 */
/**
 * 账本键 = spec 的**结构身份**（与 `exec/runtime/invariant-apply.ts` 的
 * `InvariantSpec` 同形）。本模块是「零依赖叶子」（只 import 类型 Pred），
 * 故用结构型而不是从 exec 面反向导入——对象身份仍是去重口径。
 */
export type ConsumedInvariantSpec = {
  name: string;
  path: Array<{ k: "idx" } | { k: "prop"; name: string }>;
  rel: "ge" | "le" | "gt" | "lt";
  value: number;
};

let consumedInvariants: ConsumedInvariantSpec[] = [];

/** 记账：某条 `@nudo:invariant` spec 真的在循环 join/宽化位产出了界 */
export function noteInvariantConsumed(spec: ConsumedInvariantSpec): void {
  if (!consumedInvariants.includes(spec)) consumedInvariants.push(spec);
}

/** 本轮不变式消费快照（check 面取；对象身份即 spec 身份） */
export function invariantConsumed(): readonly ConsumedInvariantSpec[] {
  return consumedInvariants;
}

/** 清账（check 面：每个函数的种子求值前清 ⇒ 上一函数的消费不串台） */
export function resetAssumeConsumed(): void {
  consumed = [];
  consumedInvariants = [];
}
