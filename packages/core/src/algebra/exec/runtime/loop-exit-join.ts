/**
 * 循环出口 join 的统一收口（Bug 215 不变式实施 + Bug 47/48 出口宽化 +
 * joinAbs 快照合并）。
 *
 * `$whileSeq`（while / do-while，control.ts）、`$forOf`（for-of，
 * containers/iterate.ts）与 `$for`（control.ts）的出口 join 闭包共享实现：
 * - `$whileSeq` 仅预算耗尽出口（exhausted=true）宽化（定假出口 /
 *   definite break 忠实语义不宽化）；
 * - `$forOf` 出口恒宽化（exhausted 恒 true，与旧
 *   `widen ? widenFinal(joined) : joined` 等价）；
 * - `$for` 额外经 joinWiden 注入容器宽化（widenLoopJoin：不同长度
 *   tuple 的 sum → arr，#156/#98）+ #176 预强化——剩余分歧（与另两处
 *   调用方）有二，均已收敛为参数/文档化：
 *   ① 容器宽化只属 $for（另两形态的快照 join 无长度增长表示），经
 *     joinWiden 表达；
 *   ② 不变式实施时机：$for 在 widenFinal **之前**预强化（强化后的域喂
 *     下一轮迭代体读点与出口读点，见 control.ts widenLoopJoin 注释），
 *     预强化内接在 joinWiden 里；本函数出口的统一实施（Bug 215）在其后
 *     再跑一次——applyInvariantsToPack 对已强化包幂等（strengthenLeaf
 *     复用已 mint 的 term、pred 并集经 and() 去重），不新增 mint，产物
 *     逐字节不变（探针钉住）。
 *
 * 纯函数模块：无模块体加载期注册 / 回调 setter（vite SSR 循环图对加载期
 * 副作用敏感，见 containers/member.ts 的直连绑定教训）。
 */
import type { Abs } from "../../abs.ts";
import { joinAbs } from "../../objects.ts";
import type { LoopCarriedWidener } from "./loop-widen.ts";
import { applyExitJoinInvariants, hasInvariantSpecs } from "./invariant-apply.ts";

export interface LoopExitJoinOpts {
  /** 把当前绑定收成 Abs 状态（transpile 注入；pack/unpack 缺一即无操作） */
  pack?: (() => Abs) | undefined;
  /** 把 join 后的状态写回绑定 */
  unpack?: ((s: Abs) => void) | undefined;
  /** 出口 join 快照（无快照 = 具体出口路径，走 Bug 215 不变式直施分支） */
  exitJoin: Abs | undefined;
  /** 循环携带绑定宽化器（Bug 47/48） */
  widen?: LoopCarriedWidener | undefined;
  /** 仅预算耗尽出口宽化（$whileSeq 定假出口 / definite break 传 false） */
  exhausted: boolean;
  /** join 产物的容器宽化（$for 专属：widenLoopJoin，含 #176 预强化）；
   *  在 widenFinal 之前应用。缺省恒等（$whileSeq / $forOf）。 */
  joinWiden?: ((joined: Abs) => Abs) | undefined;
}

export function applyLoopExitJoin(opts: LoopExitJoinOpts): void {
  const { pack, unpack, exitJoin, widen, exhausted, joinWiden } = opts;
  if (!pack || !unpack) return;
  // Bug 215：具体出口（无快照 join）也须实施 @nudo:invariant——否则
  // while / do-while / for-of 的公理被静默丢弃（$for 走 applyExtJoin 有
  // 实施）。无公理时不取绑定包（零行为变化：取包会暴露转译侧 pack 闭包
  // 的既有缺陷）。
  if (!exitJoin) {
    if (!hasInvariantSpecs()) return;
    const cur = pack();
    const strengthened = applyExitJoinInvariants(cur);
    if (strengthened !== cur) unpack(strengthened);
    return;
  }
  const joined = joinAbs(exitJoin, pack());
  const prepared = joinWiden ? joinWiden(joined) : joined;
  unpack(
    applyExitJoinInvariants(exhausted && widen ? widen.widenFinal(prepared) : prepared),
  );
}
