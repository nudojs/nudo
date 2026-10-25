/**
 * 返回后置统一证明通道（DEC-001 方案 A）。
 *
 * `assertImplies(ret, constraint)` 与前置共用 Pred 蕴含（`implies` /
 * `numericBoundsImply`）与字面量域隶属（`literalMeetsConstraint`），
 * 禁止字面量特判堆叠。三态结果：
 *
 *   proved     — 返回值域 ⊆ 契约域（放行）
 *   disproved  — 值域已知且 ⊄ 契约域（error：字面量违约 / nullish 未声明 / prim 不匹配 / 界证不出）
 *   unprovable — 值域未知（any / unknown=推断失败 / opaque 截断）——
 *                不得伪装成功，调用侧以 warning 呈现，不得计 error（gold FP 门禁）
 *
 * nullish 显式化：`return null`/`undefined` 只对 `constraintAdmitsNullish`
 * 的契约合法；`nullable(c)` / `union(c, lit(null), lit(undefined))` 显式声明。
 */

import type { Abs } from "./abs.ts";
import { litValue } from "./abs.ts";
import type { Term } from "./term.ts";
import { v as termVar, lit as termLit, app as termApp } from "./term.ts";
import type { Pred, Phi } from "./pred.ts";
import { implies, pTrue, and as pAnd } from "./pred.ts";
import { numericBoundsImply } from "./pred-bounds.ts";
import type { NudoConstraint, NudoField } from "./constraint.ts";
import {
  SELF,
  constraintAdmitsNullish,
  derefConstraint,
  isIntFlag,
  instantiateOnTerm,
} from "./constraint.ts";
import { isNullishLitAbs } from "./surface.ts";
import { isOobUndef } from "./exec/runtime/state.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import { getSlot } from "./objects.ts";
import { accessorReadDomain } from "./accessors.ts";
import { termEquals } from "./term.ts";
import { formatAbs } from "./format.ts";
import { formatConstraint } from "./interface.ts";

export type PostProof =
  | { status: "proved" }
  | { status: "disproved"; reason: string }
  | { status: "unprovable"; reason: string };

/**
 * 证明通道选项：phi = 路径前提（返回点的 Φ）；seen = lazy thunk 环保护
 * （per-path 副本，见 assertImplies 入口）。内部 helper 透传同一对象。
 *
 * Bug 1080：Φ 侧只按**同项**口径计入证据面（见 `isBoundedEvidenceMissing`）——
 * 与被约束项无关的前提事实不得把「证不出」升级成「确定违约」。
 *
 * Bug 1094：Φ 侧计入证据面的条件收紧为「**同项** ∧ **蕴含**该约束的 pred」
 * （见 `phiSuppliesConstraint`）——Φ 只能把「证不出」升级成「已证明」，
 * **绝不**反向制造「确定违约」（error / 假红）。
 */
type AssertOpts = { phi?: Phi; seen?: Set<object> };

function proved(): PostProof {
  return { status: "proved" };
}
function disproved(reason: string): PostProof {
  return { status: "disproved", reason };
}
function unprovable(reason: string): PostProof {
  return { status: "unprovable", reason };
}

/** 合成返回项（无 term 时锚定约束 pred 用；不与真实变量冲突） */
const RET_ANCHOR = "__nudo_return__";

function retAnchorTerm(ret: Abs): Term {
  return ret.term ?? termVar(RET_ANCHOR);
}

/**
 * 值域未知 / 不可判定：不得伪装成功，也不得计 error。
 * - conf widened / mock / opaque：分析显式丢失精度
 * - any：开发者未约束；unknown 无 term：推断失败
 * - 拓宽 sum 成员的 bare prim（无 term/pred）：any+any 派生产物
 * 例外（issue #151，消费方各自判断）：widened 裸 prim 臂对无界裸 prim
 * 契约的域隶属可证（provesBarePrimDomain discharge，与 #115 partial
 * 同口径——宽化丢界/路径证据，不丢 prim 值域）。
 */
function isValueSetUnknown(ret: Abs): boolean {
  if (
    ret.conf === "opaque" ||
    ret.conf === "widened" ||
    ret.conf === "mock"
  ) {
    return true;
  }
  if (ret.shape.k === "unknown" && !ret.term) return true;
  if (ret.shape.k === "any") return true;
  return false;
}

/**
 * 值域**未被跟踪**（派生表达式 / 无 pred 证据）：
 * 后置界义务证不出也反证不了 → unprovable，不得当 disproved。
 * 只有**值域已知**（ret.pred 有事实）却不蕴含时才有「确定不满足」的证据（F3 点 1）。
 *
 * Bug 1116（回退 Bug 370 的语义降级）：判据是「**ret.pred 有事实**」，不是
 * 「**带界**证据」。返回契约是对**所有**输入成立的后置 ⇒ 值域已知
 * （声明域参数 / 字面量 / 带界事实）却不蕴含契约 ⇒ **契约不成立**
 * （存在违约输入）⇒ 判 `disproved`（error）。
 * - 旧口径（Bug 370：只有 gt/ge/lt/le 算证据）把 `typeof` 级证据
 *   （`@nudo:contract x num` 的声明域参数）判成「无证据」⇒ 降级
 *   `unproven-return`（**warning**）⇒ warning 不改 exit code ⇒
 *   `nudo check` 门禁空转（假绿）：`return x`（x: number()）对
 *   `return positive` 是**确定违约**（x=0 即违约）却只报 warning。
 *   docs/design/cli-semantics.md §5.5：warning 只针对 any/unknown
 *   （推断失败）——声明域参数不是 any/unknown ⇒ 不得降级。
 * - `unprovable` 收窄到「**无 pred 证据**」（`return x + 1` /
 *   `return Math.abs(x)`：值域未被跟踪 ⇒ 证不出也反证不了）。
 *
 * Bug 1080：证据面 = **ret.pred（值域事实）∧ Φ 的「同项」界事实（路径事实）**。
 *
 * - Φ 侧只认**约束被约束项本身**的界原子（`termEquals` 同项判定）：路径
 *   前提里的界事实可能约束的是**另一个项**（`if (x > 0) return y` 的
 *   `x > 0` 与 y 无关）⇒ 拿它当 y 的值域证据 ⇒ 「证不出」被误判成
 *   「确定不满足」（error）⇒ **假红**（用无关证据制造确定违约）。
 * - Φ 侧**同项**的界事实才计入（`return y` 且路径前提是 `y > 0` ⇒ 关系
 *   事实确实落在返回项上 ⇒ 计入证据面 ⇒ 可走蕴含判定 ⇒ 义务可证）。
 *
 * Bug 1094：Φ 侧计入证据面的条件再收紧一档——**同项** ∧ **蕴含**该约束的
 * pred（见 `phiSuppliesConstraint`）：
 * - 旧口径（只查「同项」）把「Φ 的界弱于契约」（Φ = `y > 0` vs 契约
 *   `y > 10`）也当成 y 的带界证据 ⇒ 蕴含失败落到 `disproved`（error）——
 *   而真实结论是「证不出」（返回值可能是 20）⇒ **假红**。
 * - 新口径下 Φ 只在**足以推出契约**时才算证据 ⇒ Φ 只能把 `unprovable`
 *   变 `proved`，**永不**产生 `disproved`。
 */
function isBoundedEvidenceMissing(
  ret: Abs,
  constraint: NudoConstraint,
  phi: Phi,
): boolean {
  // 契约无 pred 义务：裸 prim 合格即可
  if (constraint.preds.length === 0 && !constraint.members) return false;
  // 字面量有确定值，可走域隶属 → 不算证据缺失
  if (ret.term?.op === "lit") return false;
  // 值域事实（Bug 1116）：`ret.pred` 有事实 ⇒ 该项的值域**已知**
  // （声明域参数的 typeof 级证据 / 守卫窄化的界事实）⇒ 返回义务**可判定**：
  // 「不蕴含契约」= 「契约不成立」（契约对**所有**输入成立 ⇒ 值域 ⊄ 契约域
  // ⇒ 存在违约输入）⇒ 判 `disproved`（error）。**不得**降级成
  // `unproven-return`（warning）：warning 不改 exit code ⇒ 门禁空转（假绿）。
  //
  // ⚠ 只有**带界**原子（gt/ge/lt/le）才算证据是 Bug 370 的口径，已撤销：
  //   `typeof` 级证据虽不描述值域，但**声明域参数**的值域就是它的声明域
  //   （`number()` ⇒ 任意 number）⇒ 「不蕴含」确实蕴含「契约不成立」。
  if (ret.pred && ret.pred.op !== "true") return false;
  // 路径事实：Φ 里**同项且蕴含该约束**的界事实（Bug 1094）
  if (phiSuppliesConstraint(phi, constraint, ret)) return false;
  // 无 pred 证据（bare prim / 派生表达式）⇒ 值域未被跟踪 ⇒ 不可判定
  return true;
}

/**
 * Φ（路径前提）能否**单独**证明该约束——即 Φ 是否是「返回项的带界证据」。
 *
 * 判据（Bug 1094）：**同项** ∧ **蕴含**：
 * - 同项：Φ 的界原子约束的是返回项本身（`termEquals`；`length(item)` 形态
 *   算该项的界）——与返回项无关的前提事实（`if (x > 0) return y` 的 `x > 0`）
 *   不构成返回值的值域证据。
 * - 蕴含：Φ ⊢ 该契约的 pred（锚定到返回项）——Φ 的界**弱于**契约时
 *   （`y > 0` vs `y > 10`）不算证据 ⇒ 判「证不出」而非「确定违约」。
 *
 * ⚠ `implies` **不可判**：证不出时返回 false ⇒ 此处按「不满足」处理 ⇒
 * Φ 侧证据缺失 ⇒ 走 `unprovable`（warning）——**不得**反向当成「不蕴含」
 * 而制造 `disproved`（error / 假红）。
 *
 * 导出给 check 面做**归因**判定（本次证明是否依赖了路径前提）。
 */
export function phiSuppliesConstraint(
  phi: Phi | undefined,
  constraint: NudoConstraint,
  ret: Abs,
): boolean {
  if (!phi || phi.op === "true") return false;
  const item = retAnchorTerm(ret);
  if (!hasSameItemBoundEvidence(phi, item)) return false;
  return implies(phi, instantiateOnTerm(constraint, item));
}

/**
 * Φ（路径前提）里是否含**同项**界原子——即约束**被约束项本身**的界事实。
 *
 * 同项判定：界原子的左侧与被约束项 `termEquals`；长度界
 * （`length(item)` 形态）视为**该项**的界（同一项的长度事实）。
 * 约束的是**别的项**时不计入（见 `isBoundedEvidenceMissing` 的 Bug 1080 段）。
 */
function hasSameItemBoundEvidence(p: Phi | undefined, item: Term): boolean {
  if (!p) return false;
  switch (p.op) {
    case "gt":
    case "ge":
    case "lt":
    case "le":
      return sameItemTerm(item, p.a);
    case "and":
    case "or":
      return p.args.some((a) => hasSameItemBoundEvidence(a, item));
    case "not":
      // `not(gt(item,0))` ≡ `item <= 0` ⇒ 仍是该项的界
      return hasSameItemBoundEvidence(p.arg, item);
    default:
      return false;
  }
}

/** 界原子的左侧是否**就是**被约束项（`length(item)` 形态算同一项的界） */
function sameItemTerm(item: Term, left: Term): boolean {
  if (termEquals(item, left)) return true;
  if (left.op === "app" && left.fn === "length" && left.args.length === 1) {
    return termEquals(item, left.args[0]!);
  }
  return false;
}

/** 扁平化 sum 臂（嵌套 sum 一并拆开）；非 sum 返回自身 */
function flattenSumArms(ret: Abs): Abs[] {
  if (ret.shape.k !== "sum") return [ret];
  const out: Abs[] = [];
  for (const m of (ret.shape as { members: Abs[] }).members) {
    if (m.shape.k === "sum") out.push(...flattenSumArms(m));
    else out.push(m);
  }
  return out;
}

/**
 * any 参与运算符派生的 sum 臂（`any+any → number|string`）：
 * parent conf=partial 且成员是无 term/pred 的裸 prim。报则假阳性
 * （gold 门禁口径）；proof 侧当 unprovable，不得当 proved/disproved。
 * issue #151：循环携带绑定宽化（loop-widen）注入的 prim 域顶臂同形——
 * arm conf="widened"（parent sum 亦 widened），与 partial 同口径：宽化丢
 * 界/路径证据，不丢 prim 值域，无界裸 prim 契约的域隶属可证。
 */
function isWidenedSumArm(m: Abs, parent: Abs): boolean {
  return (
    (parent.conf === "partial" || m.conf === "widened") &&
    m.shape.k === "prim" &&
    !m.term &&
    (!m.pred || m.pred.op === "true")
  );
}

/** 结构契约与臂形状可对账（array(...)×arr/tuple、shape(...)×obj；
 * union 成员递归穿透 lazy） */
function constraintMatchesStructuralArm(arm: Abs, c: NudoConstraint): boolean {
  if (c.element) return arm.shape.k === "arr" || arm.shape.k === "tuple";
  if (c.fields) return arm.shape.k === "obj";
  if (c.members) {
    return c.members.some((m) => constraintMatchesStructuralArm(arm, derefConstraint(m)));
  }
  return false;
}

/**
 * issue #156：循环变异绑定宽化的结构臂（loop-widen arrify/domainTop 产物：
 * conf="widened" 的 arr / tuple / obj）。宽化丢的是长度 / 键开闭 / 界与
 * 路径证据，**不丢结构域**（arrify 元素域 = 观测元素 join；obj 槽位形状
 * 保留）。结构契约（array(...) / shape(...)，union 成员穿透）存在时放行
 * 进入逐元素/逐字段对账；叶子 widened prim 的带界义务照旧 unprovable
 * （provesBarePrimDomain / assertScalar 兜底）、unknown 元素域同样兜底
 * ——不会伪装成功。
 */
function isWidenedStructuralArm(arm: Abs, constraint: NudoConstraint): boolean {
  return arm.conf === "widened" && constraintMatchesStructuralArm(arm, constraint);
}

/**
 * 无界 prim 契约（裸 `number()` / `string()`：prim + 无显式 pred + 无
 * int 义务 + 无结构面）只问**域隶属**。裸 prim 臂（term-less partial，
 * `Number(x) - Number(y)` 派生 / any 参与的运算臂）的域已知——partial
 * conf 丢的是界/路径证据，不丢 prim 值域 → 域隶属可证（issue #115：
 * `0 | -1 | 1 | number` 对 `number()` 不得降 unproven-return）。
 * union/nullable 契约按 ∃-成员分解：某成员是无界同型裸 prim 即域隶属
 * 可证（issue #102 回归：lev DP 表循环增长宽化（Bug 48）注入的 bare
 * widened number 臂对 `nullable(number())` 不得 unprovable——与
 * assertImpliesSingle 的 union ∃-member 对账同构）。带界义务（gt/le/
 * int…）成员仍不可证；错配 prim 的 disproved FP 保护不动。
 */
function provesBarePrimDomain(arm: Abs, constraint: NudoConstraint): boolean {
  if (constraint.members) {
    return constraint.members.some((m) => provesBarePrimDomain(arm, derefConstraint(m)));
  }
  if (!constraint.prim || constraint.preds.length > 0 || isIntFlag(constraint)) {
    return false;
  }
  if (constraint.fields || constraint.element || constraint.fn) {
    return false;
  }
  return arm.shape.k === "prim" && arm.shape.type === constraint.prim;
}

/**
 * 统一后置证明：返回 Abs 的值域是否蕴含契约。
 * phi：路径前提（可选，与前置同一 Phi 通道）——**返回点的 Φ**（调用方
 * 传入；缺省 = `pTrue`）。Φ 侧只按**同项**口径计入证据面（Bug 1080）：
 * 与被约束项无关的前提事实（`if (x > 0) return y` 的 `x > 0`）不构成
 * 返回值的值域证据 ⇒ 判「证不出」而非「确定违约」。
 *
 * Bug 1094：Φ 侧计入证据面的条件 = **同项** ∧ **蕴含**该约束的 pred
 * （`phiSuppliesConstraint`）⇒ Φ 只能把 `unprovable` 变 `proved`，
 * **绝不能**产生 `disproved`（error / 假红）。
 *
 * DEC-001 + scalar-over-sum：sum 返回按成员分发（shape/array/scalar 同口径），
 * nullish 臂走契约显式化；union/nullable 对「每个臂 ∃ 契约成员」对账。
 */
export function assertImplies(
  ret: Abs,
  constraint: NudoConstraint,
  opts?: AssertOpts,
): PostProof {
  // lazy 包装（issue #120）：每次递归入口先解一层——包装自身无 prim/preds/
  // 结构，不 deref 会被 isAnyConstraint 误判成 any()（假证明）或漏进标量分支。
  // 环保护（thunk 身份 seen-set，per-path 副本）：自引用模板
  // lazy(() => bad) 穿 union/shape 字段循环会无限递归；截断时保守
  // unprovable（checkReturnConstraint 映射 warning，绝不伪证 proved、
  // 绝不误判 disproved）。副本而非共享：sum 多臂 / union 多成员逐臂
  // 递归时 ret 各不相同，约束求值对 (ret, constraint) 确定——兄弟臂
  // 各自首访同一 lazy 成员都应完整展开（共享集合会把「经同一 lazy
  // 成员可证」的兄弟臂降为假 unprovable）；真环仍被截断（祖先 thunk
  // 身份经副本继承）。
  if (constraint.lazy) {
    const seen = opts?.seen;
    if (seen?.has(constraint.lazy)) {
      return unprovable("lazy constraint cycle");
    }
    const next = seen ? new Set(seen) : new Set<object>();
    next.add(constraint.lazy);
    return assertImplies(ret, derefConstraint(constraint), { ...opts, seen: next });
  }
  const phi = opts?.phi ?? pTrue;

  // never（不可达）：后置空洞成立
  if (ret.shape.k === "never") return proved();

  // any() 契约：无义务
  if (isAnyConstraint(constraint)) return proved();

  // --- 值域未知（整段）：any / true unknown / opaque/mock ---
  // issue #151 例外：conf="widened"（loop-widen 循环携带宽化产物）不下沉
  // 到这里的整段 unprovable——与 #115 的 partial 同口径：宽化丢界/路径
  // 证据，不丢 prim 值域。放行进入逐臂分发（assertSumArms /
  // assertImpliesSingle 的 per-arm isValueSetUnknown 门照旧兜底：非裸
  // prim / 带界义务 / 错配 prim 仍 unprovable，不会伪装成功）。
  if (isValueSetUnknown(ret) && ret.conf !== "widened") {
    return unprovable(
      ret.shape.k === "any"
        ? "any does not establish the return contract"
        : "inference failure (unknown/opaque) — cannot prove the return contract",
    );
  }

  const arms = flattenSumArms(ret);

  // 多臂返回：逐成员对账（条件赋值 / 多 return 路径）。
  // scalar 同样分发——`nullable(c)` 与多 return 的 `null | number` 才能被证明。
  if (arms.length > 1) {
    return assertSumArms(arms, ret, constraint, opts, phi);
  }

  return assertImpliesSingle(arms[0]!, constraint, opts, phi);
}

function assertSumArms(
  arms: Abs[],
  parent: Abs,
  constraint: NudoConstraint,
  opts: AssertOpts | undefined,
  phi: Phi,
): PostProof {
  // gold FP 保护：任一 any 派生 / 运算符拓宽臂存在时，不得对兄弟臂报
  // disproved（`0 | number|string` 的 `0` 不得因拓宽污染变成 error）。
  const hasWidenedArm = arms.some(
    (a) => isValueSetUnknown(a) || isWidenedSumArm(a, parent),
  );
  let sawUnprovable = false;
  for (const arm of arms) {
    // OOB marker 臂（抽象下标可能 miss 的合成 undefined，conf=partial）：
    // 引擎精度产物而非用户域 undefined——长度事实已丢失，无法区分「按构造
    // 在界内」（DP 表 d[m][n]，issue #102）与「真实越界」，不得据以
    // disproved。契约显式承认 nullish（nullable / union(..., lit(null))）时
    // marker 的 undefined 可能性已被域覆盖——臂 discharged（与用户 nullish
    // 臂 continue 同形，亦与单臂 assertImpliesSingle 的 proved 口径对称）；
    // 否则降 unprovable（与 isWidenedSumArm 污染臂同口径）。其余真实臂
    // 仍逐臂对账，证据充分时照常 disproved。
    if (isOobUndef(arm)) {
      if (!constraintAdmitsNullish(constraint)) sawUnprovable = true;
      continue;
    }
    // nullish 臂：契约须显式承认 nullish（nullable / union(..., lit(null))）。
    // nullish 逃逸是确定违约，不受拓宽臂降级影响。
    if (isNullishLitAbs(arm)) {
      if (!constraintAdmitsNullish(constraint)) {
        return disproved(
          `nullish return arm ⊭ ${formatConstraint(constraint)} (contract does not admit nullish)`,
        );
      }
      continue;
    }
    if (isValueSetUnknown(arm) || isWidenedSumArm(arm, parent)) {
      // 无界 prim 契约的域隶属可证（issue #115 partial / #151 widened）：
      // 该臂 discharged，不降整体 unprovable。其余（unknown 值域 / 带界
      // 义务 / 错配 prim）保持 unprovable 口径。
      if (
        isWidenedSumArm(arm, parent) &&
        provesBarePrimDomain(arm, constraint)
      ) {
        continue;
      }
      // #156 结构臂：conf=widened 的 arr/tuple/obj 对结构契约放行进入
      // 结构对账；结果非 proved 降 unprovable（本臂自身已计入
      // hasWidenedArm，不得 disproved——与错配 prim 的 FP 保护同口径）。
      if (isWidenedStructuralArm(arm, constraint)) {
        const r = assertImpliesSingle(arm, constraint, opts, phi);
        if (r.status !== "proved") sawUnprovable = true;
        continue;
      }
      sawUnprovable = true;
      continue;
    }
    const r = assertImpliesSingle(arm, constraint, opts, phi);
    if (r.status === "disproved") {
      if (hasWidenedArm) {
        sawUnprovable = true;
        continue;
      }
      return r;
    }
    if (r.status === "unprovable") sawUnprovable = true;
  }
  return sawUnprovable
    ? unprovable("sum: some arms unprovable")
    : proved();
}

function assertImpliesSingle(
  arm: Abs,
  constraint: NudoConstraint,
  opts: AssertOpts | undefined,
  phi: Phi,
): PostProof {
  // --- OOB marker（issue #102）：引擎精度产物——不可证亦不可反证 ---
  if (isOobUndef(arm)) {
    return constraintAdmitsNullish(constraint)
      ? proved()
      : unprovable("out-of-bounds marker arm (abstract index may miss) — length fact lost");
  }

  // --- nullish 显式化 ---
  if (isNullishLitAbs(arm)) {
    return constraintAdmitsNullish(constraint)
      ? proved()
      : disproved(`nullish return ⊭ ${formatConstraint(constraint)}`);
  }

  // --- 值域未知：any / true unknown / opaque ---
  if (isValueSetUnknown(arm) && !isWidenedStructuralArm(arm, constraint)) {
    // issue #151：循环携带绑定宽化到 prim 域顶的裸 prim 臂（loop-widen
    // 产物：conf="widened"、无 term/pred）与 #115 的 partial 臂同口径——
    // 宽化丢的是界/路径证据，不丢 prim 值域。无界裸 prim 契约只问域隶属
    // → proved，不降假 unproven-return；带界/结构义务与错配 prim 保持原
    // unprovable（宽化臂的界义务本就证不出，也不得变 disproved）。
    // issue #156：widened 结构臂（arr/tuple/obj）对结构契约放行到下方
    // 逐元素/逐字段对账（union/fields/element 分支）。
    if (
      arm.conf === "widened" &&
      arm.shape.k === "prim" &&
      !arm.term &&
      (!arm.pred || arm.pred.op === "true") &&
      provesBarePrimDomain(arm, constraint)
    ) {
      return proved();
    }
    return unprovable(
      arm.shape.k === "any"
        ? "any does not establish the return contract"
        : "inference failure (unknown/opaque) — cannot prove the return contract",
    );
  }

  // --- union 契约（含 nullable）：本臂任一成员蕴含即 proved ---
  if (constraint.members && constraint.members.length > 0) {
    let sawUnprovable = false;
    for (const m of constraint.members) {
      const r = assertImplies(arm, m, opts);
      if (r.status === "proved") return proved();
      if (r.status === "unprovable") sawUnprovable = true;
    }
    return sawUnprovable
      ? unprovable("union: no member proved the return contract")
      : disproved(`return ⊭ union(${constraint.members.map((m) => formatConstraint(m)).join(", ")})`);
  }

  // --- shape 契约：结构字段对账 ---
  if (constraint.fields) {
    return assertShapeFields(arm, constraint, opts);
  }

  // --- array 契约 ---
  if (constraint.element) {
    if (arm.shape.k !== "arr" && arm.shape.k !== "tuple") {
      return disproved(`return shape ${arm.shape.k} ⊭ array(...)`);
    }
    // Bug 30：元素级对账（此前只查形状即 proved——元素 pred/类型违约被
    // 伪装成成功）。tuple → 逐元素 assertImplies（精确 disproved 定位下标；
    // unprovable 元素降级整体 unprovable，不伪装成功）；空 tuple 空真保持
    // proved；带 rest 槽（0..n 未知额外元素）→ 保守 unprovable。arr →
    // 抽象元素域对账（prim 错配 disproved，其余降级 unprovable）。
    if (arm.shape.k === "tuple") {
      const ts = arm.shape as { elements: Abs[]; rest?: Abs };
      if (ts.rest) return unprovable("array element: rest tail not enumerable");
      let sawUnprovable = false;
      for (let i = 0; i < ts.elements.length; i++) {
        const r = assertImplies(ts.elements[i]!, constraint.element, opts);
        if (r.status === "disproved") {
          return disproved(
            `array element [${i}] ⊭ ${formatConstraint(constraint.element)} (${r.reason})`,
          );
        }
        if (r.status === "unprovable") sawUnprovable = true;
      }
      return sawUnprovable
        ? unprovable("array element: some elements unprovable")
        : proved();
    }
    const el = (arm.shape as { element: Abs }).element;
    const r = assertImplies(el, constraint.element, opts);
    if (r.status === "disproved") {
      return disproved(
        `array element ⊭ ${formatConstraint(constraint.element)} (${r.reason})`,
      );
    }
    return r.status === "unprovable"
      ? unprovable(`array element: ${r.reason}`)
      : proved();
  }

  // --- fn 契约：Phase 1 只展示不执法 ---
  // Bug 351：旧口径直接 `return proved()` —— fn 形态的返回义务被**整条判为
  // 「已证明」**（零诊断假绿：「无法执法」≠「已证明」）。现在判 unprovable：
  // 无法证明 ≠ 已证明 ⇒ 消费方出 warning（nudo:unproven-return），门禁不假装绿。
  // （正常路径下 fn 形态已在 refine.ts 的 return 段提取里拆成 `fn.returns`
  //   ——与侧车口径一致——这里只是「万一还有 fn 形态漏到证明通道」的兜底。）
  if (constraint.fn) {
    return unprovable(
      "fn-shaped return contract cannot be enforced (declare the returned value as the fn's returns constraint)",
    );
  }

  // --- 标量：prim + Pred 蕴含（统一证明通道）---
  return assertScalar(arm, constraint, phi);
}

/** any()：无 prim / preds / shape / members / fn（lazy 包装不算——先 deref） */
function isAnyConstraint(c: NudoConstraint): boolean {
  return (
    !c.prim &&
    c.preds.length === 0 &&
    !c.fields &&
    !c.element &&
    !c.members &&
    !c.fn &&
    !c.lazy &&
    !isIntFlag(c)
  );
}

function assertShapeFields(
  ret: Abs,
  constraint: NudoConstraint,
  opts?: AssertOpts,
): PostProof {
  type ObjSlots = Record<string, { value: Abs; optional?: boolean }>;
  let slots: ObjSlots | undefined;
  if (ret.shape.k === "obj") {
    slots = (ret.shape as { slots: ObjSlots }).slots;
  } else if (ret.shape.k === "brand") {
    const inner = ret.shape.shape;
    if (inner.shape.k === "obj") slots = (inner.shape as { slots: ObjSlots }).slots;
  }
  if (!slots) {
    return disproved(`return shape ${ret.shape.k} ⊭ object shape`);
  }
  for (const [key, field] of Object.entries(constraint.fields!) as Array<
    [string, NudoField]
  >) {
    const slot = getSlot(slots, key);
    if (!slot) {
      if (!field.optional && !field.constraint.isOptional) {
        return disproved(`missing field ${key}`);
      }
      continue;
    }
    // Bug 191：访问器键的槽是 `$lit(void 0)` 占位（真 getter 住侧表）——
    // 按占位槽证明会把 getter 的返回值判成违约（假红），须取 getter 读域。
    const r = assertImplies(accessorReadDomain(ret, key) ?? slot.value, field.constraint, opts);
    if (r.status === "disproved") {
      return disproved(`field ${key}: ${r.reason}`);
    }
    // unprovable 字段：整体降级为 unprovable（不伪装成功）
    if (r.status === "unprovable") {
      return unprovable(`field ${key}: ${r.reason}`);
    }
  }
  return proved();
}

function assertScalar(
  ret: Abs,
  constraint: NudoConstraint,
  phi: Phi,
): PostProof {
  // prim 门
  if (constraint.prim) {
    const retPrim = primOfAbs(ret);
    if (retPrim && retPrim !== constraint.prim) {
      return disproved(`typeof return = "${retPrim}" ⊭ "${constraint.prim}"`);
    }
    // ret 无 prim 但契约要求 prim：结构性形状（obj/arr/tuple/fn/brand/eff）
    // 与 prim 域不相交 → 直接 disproved（勿落到 empty-preds proved）。
    // sum / unknown+term 保持现行为（sum 是 gold FP 保护；unknown+term 走 pred 通道）。
    if (!retPrim) {
      const k = ret.shape.k;
      if (k === "obj" || k === "arr" || k === "tuple" || k === "fn" || k === "brand" || k === "eff") {
        return disproved(`return shape ${k} ⊭ prim "${constraint.prim}"`);
      }
    }
  }

  // int 位
  if (isIntFlag(constraint) && constraint.prim === "number") {
    const lvR = litValue(ret);
    const lv = lvR.ok ? lvR.value : undefined;
    if (typeof lv === "number" && !Number.isInteger(lv)) {
      return disproved(`return ${lv} ⊭ int`);
    }
  }

  // Pred 蕴含（统一证明通道）：constraint preds 锚定到 ret.term
  const t = retAnchorTerm(ret);
  const constraintPred = instantiateOnTerm(constraint, t);
  const retPred: Phi =
    ret.pred && ret.pred.op !== "true"
      ? phi.op === "true"
        ? ret.pred
        : pAnd(phi, ret.pred)
      : phi;

  // 契约无 pred 义务（裸 prim / any()）：prim 门已过即 proved
  if (constraint.preds.length === 0 && constraintPred.op === "true") {
    return proved();
  }
  // 仅有 auto-typeof（prim + 无显式 pred）：prim 门已核对 → proved
  if (constraint.preds.length === 0 && constraintPred.op === "typeof" && constraint.prim) {
    return proved();
  }

  if (constraintPred.op !== "true") {
    if (implies(retPred, constraintPred)) return proved();
    // Φ 只**加**事实、不减事实 ⇒ ret.pred 单独蕴含时同样成立（合取判定
    // 口径的防御性回退：接上 Φ 不得让原本可证的义务退化成「证不出」）。
    if (
      phi.op !== "true" &&
      ret.pred &&
      ret.pred.op !== "true" &&
      implies(ret.pred, constraintPred)
    ) {
      return proved();
    }
    // numericBoundsImply：src 界更紧可蕴含更宽目标（x>5 ⇒ x>0）
    if (ret.pred && ret.pred.op !== "true" && numericBoundsImply(ret.pred, constraintPred)) {
      return proved();
    }
    // Φ 侧单独蕴含该约束 ⇒ 义务可证（路径前提足以推出返回值的界；Bug 1094）
    // ——Φ 只在这一条上把「证不出」升级成「已证明」；反之（Φ 的界弱于契约）
    // 一律走下面的「证据缺失 ⇒ 证不出」，**不得**落到 disproved（假红）。
    if (phiSuppliesConstraint(phi, constraint, ret)) return proved();
    // 有界义务但无 pred 证据（bare prim / 无界表达式 vs gt(0)）→ 不可判定
    // 只有 ret.pred 存在却不蕴含时才是「确定不满足」（F3 点 1）
    if (isBoundedEvidenceMissing(ret, constraint, phi)) {
      return unprovable(
        `cannot prove return satisfies ${formatConstraint(constraint)} (no bound evidence on the return value)`,
      );
    }
  }

  // 字面量域隶属（与前置 scan.ts 同口径）：eq / length / int / union 字面量集。
  // litValue 哨兵对 lit(undefined) 折成 undefined，须直接看 term。
  if (ret.term?.op === "lit") {
    const lv = ret.term.value;
    if (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean" || lv === null || lv === undefined) {
      if (literalMeetsConstraint(lv, constraint)) {
        return proved();
      }
      // lit(undefined)：契约含 undefined 成员（union 分发后）已在上方 proved；
      // 走到这里说明域隶属判 false → 按字面量违约收口（与其它字面量同口径）
      // 字面量确定不满足 → disproved（界类显示运算符，与旧口径对齐）
      const boundDesc = describeBoundViolation(lv, constraint);
      return disproved(
        boundDesc ?? `return ${JSON.stringify(lv)} ⊭ ${formatConstraint(constraint)}`,
      );
    }
  }

  // 非字面量：pred 蕴含失败但值域已知且有 pred 证据 → 后置证不出 = 违约（fail-closed）
  if (constraintPred.op !== "true" || constraint.preds.length > 0) {
    if (isBoundedEvidenceMissing(ret, constraint, phi)) {
      return unprovable(
        `cannot prove return satisfies ${formatConstraint(constraint)} (no bound evidence on the return value)`,
      );
    }
    return disproved(
      `return (${formatAbs(ret)}) ⊭ ${formatConstraint(constraint)} (postcondition not implied)`,
    );
  }

  // 契约无 pred（裸 prim）：shape 合格即 proved
  return proved();
}

function primOfAbs(
  a: Abs,
): "number" | "string" | "boolean" | "bigint" | "symbol" | undefined {
  if (a.shape.k === "prim") return a.shape.type;
  const lvR = litValue(a);
  const lv = lvR.ok ? lvR.value : undefined;
  if (typeof lv === "number") return "number";
  if (typeof lv === "string") return "string";
  if (typeof lv === "boolean") return "boolean";
  if (typeof lv === "bigint") return "bigint";
  return undefined;
}

/** 字面量界违约的人类可读描述（`return > 0` / `return 0 ⊭ ≥ 1` 等） */
function describeBoundViolation(
  lv: number | string | boolean | null | undefined,
  constraint: NudoConstraint,
): string | undefined {
  const opSym: Record<string, string> = { gt: ">", ge: "≥", lt: "<", le: "≤" };
  for (const p of constraint.preds) {
    for (const atom of p.op === "and" ? p.args : [p]) {
      if (atom.op !== "gt" && atom.op !== "ge" && atom.op !== "lt" && atom.op !== "le") continue;
      if (atom.b.op !== "lit" || typeof atom.b.value !== "number") continue;
      const n = atom.b.value;
      const sym = opSym[atom.op]!;
      // 数值界
      if (typeof lv === "number") {
        let ok = true;
        if (atom.op === "gt") ok = lv > n;
        if (atom.op === "ge") ok = lv >= n;
        if (atom.op === "lt") ok = lv < n;
        if (atom.op === "le") ok = lv <= n;
        if (!ok) return `return ${sym} ${n}`;
      }
      // 长度界
      if (typeof lv === "string" && isLengthSelfTerm(atom.a)) {
        let ok = true;
        if (atom.op === "gt") ok = lv.length > n;
        if (atom.op === "ge") ok = lv.length >= n;
        if (atom.op === "lt") ok = lv.length < n;
        if (atom.op === "le") ok = lv.length <= n;
        if (!ok) return `length(self) ${sym} ${n}`;
      }
    }
  }
  return undefined;
}

function isLengthSelfTerm(t: Term): boolean {
  return (
    t.op === "app" &&
    t.fn === "length" &&
    t.args.length === 1 &&
    t.args[0]!.op === "var" &&
    (t.args[0] as { id: string }).id === SELF
  );
}
