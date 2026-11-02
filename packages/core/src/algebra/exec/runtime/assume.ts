/**
 * `@nudo:assume` 引理锚定：$assumeAnchor + pred α-改名（rewritePred）。
 * 从 ops.ts 拆出（ops 回归纯算术薄委托；本文件经 ops.ts 原名再导出，
 * runtime.ts facade 与 exec/index.ts 公开面不变）。
 */
import type { Abs } from "../../abs.ts";
import { termEquals, type Term } from "../../term.ts";
import type { Pred } from "../../pred.ts";
import { currentAssumePremises } from "./state.ts";

/**
 * issue #165：局部量引理锚定。`@nudo:assume <name> <= <name>` 从仅形参扩展到
 * 形参 ∪ 函数体顶层 const/let/var 局部绑定，SSA 语义：引理作用于绑定值，
 * 从定义点到作用域尾。transpile 在局部量 init 处包裹
 * `$assumeAnchor(init, name)`——把 init 结果的 term α-改名为 var(name)，
 * 使后续读点与 assume 前提里的 var(name) 同项，arithmetic 的同名相关性
 * 折叠（le 折除法界等）才能命中。shape/conf 不动，嵌套 shape 内 term
 * 不改（保守：根 term 已建立项身份，深改无消费方）。
 *
 * 为何需要当前帧前提护栏：assume 前提不随调用链继承——callee 帧一律见空
 * （callAtFunctionBoundary 以 withAssumePremises(pTrue, …) 包裹 callee 体）。
 * 锚定落在错帧（前提 pTrue，或 and 原子中没有任何 le 原子在 a/b 侧以
 * var(name) 出现——本帧没有这条引理）时，改名只会凭空捏造约束身份 →
 * 原样 no-op。这也封死 #123 式同名 term 碰撞：callee 恰有同名局部时，
 * caller 帧前提已被清空，caller 引理不会错投到 callee 的同名绑定上。
 */
export function $assumeAnchor(v: unknown, name: string): unknown {
  const prem = currentAssumePremises();
  if (prem.op === "true") return v;
  // 前提提及检查：and 树拆原子；仅 le 原子在 a/b 任一侧以 var(name) 出现才算提及
  let mentions = false;
  const walk = (p: Pred): void => {
    if (mentions || p.op === "true") return;
    if (p.op === "and") {
      p.args.forEach(walk);
      return;
    }
    if (
      p.op === "le" &&
      ((p.a.op === "var" && p.a.id === name) || (p.b.op === "var" && p.b.id === name))
    ) {
      mentions = true;
    }
  };
  walk(prem);
  if (!mentions) return v;
  // 仅锚定带非 lit term 的 Abs：lit 自足身份；已是 var(name) 的无需改
  const a = v as Abs | undefined;
  if (
    typeof a !== "object" || a === null || a.term === undefined ||
    a.term.op === "lit" || (a.term.op === "var" && a.term.id === name)
  ) {
    // issue #170：fork 合并产物（sum）无根 term，但**成员**各自有项——
    // 局部量 d = callee() 的 callee 体含条件分支时，d 是 sum(0, Math.max(…))
    // 一类形态，引理 le(d,max) 因项不匹配永远不折。改名下钻成员：每个
    // 成员在该臂上就是 d 的值（前提对 d 的全部取值成立 ⇒ 按成员应用
    // sound）；成员 pred 关于自身 term 的事实随改名同锚（该臂上成员值
    // 即 d，事实等价迁移）。lit 成员自足身份不动；无 term 成员无从改。
    if (a && typeof a === "object" && a.shape?.k === "sum") {
      const members = (a.shape as { k: "sum"; members: Abs[] }).members.map((m) => {
        if (
          m.term === undefined || m.term.op === "lit" ||
          (m.term.op === "var" && m.term.id === name)
        ) {
          return m;
        }
        const nt: Term = { op: "var", id: name };
        return { ...m, term: nt, pred: rewritePred(m.pred, m.term, nt) };
      });
      return { ...a, shape: { ...(a.shape as object), members } } as Abs;
    }
    return v;
  }
  const nt: Term = { op: "var", id: name };
  return { ...a, term: nt, pred: rewritePred(a.pred, a.term, nt) };
}

/**
 * α-改名：pred 中 termEquals 精确匹配旧 term 的节点替换为新 term。
 * eq/ne/lt/le/gt/ge 替换 a/b 两侧；typeof/assumeFinite 替换 t；
 * and/or/not 递归；true/false 原样。undefined 保持 undefined。
 */
function rewritePred(p: Pred | undefined, oldT: Term, nt: Term): Pred | undefined {
  if (p === undefined) return undefined;
  const rt = (t: Term): Term => (termEquals(t, oldT) ? nt : t);
  const rw = (q: Pred): Pred => {
    switch (q.op) {
      case "eq":
      case "ne":
      case "lt":
      case "le":
      case "gt":
      case "ge":
        return { ...q, a: rt(q.a), b: rt(q.b) };
      case "typeof":
      case "assumeFinite":
        return { ...q, t: rt(q.t) };
      case "and":
      case "or":
        return { ...q, args: q.args.map(rw) };
      case "not":
        return { ...q, arg: rw(q.arg) };
      default:
        return q;
    }
  };
  return rw(p);
}
