/**
 * 运算符重载面（transpile 目标）：$add/$sub/…、比较/位运算。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, strLit, unknown, type Confidence } from "../../abs.ts";
import { lit, termEquals, type Term } from "../../term.ts";
import type { Phi, Pred } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import { add, sub, mul, div, mod, cmp, falseConstraint } from "../../arithmetic.ts";
import {
  typeofAbs, negAbs, notAbs, strictEqAbs, looseEqAbs, bitandAbs, bitorAbs,
  bitxorAbs, bitnotAbs, shlAbs, shrAbs, ushrAbs, powAbs, toNumberAbs,
  toNumericAbs, updateAddAbs, updateSubAbs,
} from "../../surface.ts";
import { joinAbs } from "../../objects.ts";
import { markFreshInstance } from "../../instance-id.ts";
import { asAbsVal, currentExecPhi, currentAssumePremises, $lit, litTruth, isDefinitelyTrue, isDefinitelyFalse, noBody, undef, throwStrictWrite, NudoThrow } from "./state.ts";


export function $unknown(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "opaque");
}

/** `import.meta` → `{ url: string }`（宿主 URL 非字面量，不假精确） */
export function $importMeta(): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        url: { value: abs({ k: "prim", type: "string" }, undefined, undefined, "path") },
      },
      open: true,
    },
    undefined,
    undefined,
    "path",
  );
}

/** `import(spec)` → Promise&lt;开放模块命名空间&gt;（动态模块图不静态解析） */
export function $dynamicImport(_spec: Abs): Abs {
  const ns = abs(
    { k: "obj", slots: {}, open: true },
    undefined,
    undefined,
    "path",
  );
  // R2b：每次 import() 调用产出新 promise 对象——打新鲜实例标
  // R3：模块加载可能失败（native rejection 面）→ unsettled（catch 臂保持活）
  return markFreshInstance(
    abs({ k: "eff", eff: "promise", inner: ns, unsettled: true }, undefined, undefined, "path"),
  );
}

export function $add(a: Abs, b: Abs): Abs {
  return add(a, b, currentExecPhi());
}
export function $sub(a: Abs, b: Abs): Abs {
  return sub(a, b, currentExecPhi());
}
export function $mul(a: Abs, b: Abs): Abs {
  return mul(a, b, currentExecPhi());
}
export function $div(a: Abs, b: Abs): Abs {
  // issue #152：用户引理前提（@nudo:assume d <= max）参与同名相关性界折叠
  return div(a, b, currentExecPhi(), currentAssumePremises());
}
export function $mod(a: Abs, b: Abs): Abs {
  return mod(a, b, currentExecPhi());
}

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

export function $bitand(a: Abs, b: Abs): Abs {
  return bitandAbs(a, b);
}
export function $bitor(a: Abs, b: Abs): Abs {
  return bitorAbs(a, b);
}
export function $bitxor(a: Abs, b: Abs): Abs {
  return bitxorAbs(a, b);
}
export function $bitnot(a: Abs): Abs {
  return bitnotAbs(a);
}
export function $shl(a: Abs, b: Abs): Abs {
  return shlAbs(a, b);
}
export function $shr(a: Abs, b: Abs): Abs {
  return shrAbs(a, b);
}
export function $ushr(a: Abs, b: Abs): Abs {
  return ushrAbs(a, b);
}
export function $pow(a: Abs, b: Abs): Abs {
  return powAbs(a, b);
}

export function $toNumber(a: Abs): Abs {
  return toNumberAbs(a);
}
/** ToNumeric（UpdateExpression）：number|bigint，bigint 保持 */
export function $toNumeric(a: Abs): Abs {
  return toNumericAbs(a);
}
/** UpdateExpression `old+1`：ToNumeric 后按 numeric type 加 1（无 string concat） */
export function $updateAdd(a: Abs): Abs {
  // 与 $add 同口径：分支 Φ 中的界（if (x>0) 内 x++）参与约束传播
  return updateAddAbs(a, currentExecPhi());
}
/** UpdateExpression `old-1` */
export function $updateSub(a: Abs): Abs {
  return updateSubAbs(a, currentExecPhi());
}

export function $neg(a: Abs): Abs {
  return negAbs(a);
}
export function $typeof(a: Abs): Abs {
  // Bug 44：Intl 命名空间宿主对象（env-skip 后经全局作用域漏入）——typeof
  // 折 exact "object"。仅 Intl（本 bug 范围）；Math/JSON/Reflect 等其余
  // 宿主命名空间的 typeof 维持既有 partial 口径（K1a 钉住），不外溢。
  // 不走 namespaceNameOf（containers → ops 反向 import 成环）
  if (a === (globalThis as { Intl?: unknown }).Intl) return strLit("object");
  return typeofAbs(a);
}
export function $not(a: Abs): Abs {
  return notAbs(a);
}
export function $eq(a: Abs, b: Abs): Abs {
  const r = strictEqAbs(a, b);
  return r === undefined ? bool() : boolLit(r);
}
export function $ne(a: Abs, b: Abs): Abs {
  const r = strictEqAbs(a, b);
  return r === undefined ? bool() : boolLit(!r);
}
/** `==` / `!=`（C2.3）：双字面量 Abstract Equality，否则回落严格判定 */
export function $eqLoose(a: Abs, b: Abs): Abs {
  const r = looseEqAbs(a, b);
  return r === undefined ? bool() : boolLit(r);
}
export function $neLoose(a: Abs, b: Abs): Abs {
  const r = looseEqAbs(a, b);
  return r === undefined ? bool() : boolLit(!r);
}
export function $lt(a: Abs, b: Abs): Abs {
  return cmp("lt", a, b, currentExecPhi());
}
export function $le(a: Abs, b: Abs): Abs {
  return cmp("le", a, b, currentExecPhi());
}
export function $gt(a: Abs, b: Abs): Abs {
  return cmp("gt", a, b, currentExecPhi());
}
export function $ge(a: Abs, b: Abs): Abs {
  return cmp("ge", a, b, currentExecPhi());
}
export function $join(a: Abs, b: Abs): Abs {
  return joinAbs(asAbsVal(a), asAbsVal(b));
}
