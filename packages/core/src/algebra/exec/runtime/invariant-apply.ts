/**
 * #176 `@nudo:invariant` 实施模块：循环 join/宽化位按绑定名强化循环携带界。
 *
 * 语义：spec `dp[*][*] >= 0` = 用户公理「dp 的（嵌套）元素域全部 ≥ 0」。
 * 实施点在**宽化产物**上（widenLoopJoin / widenFinal 之后）——宽化到
 * number 顶会丢全部区间知识（循环变量区间宽化丢失是 research-grade，不做
 * 自动推断），用户声明是唯一通道；在 join/宽化产物上后处理使下一轮迭代
 * 体读点与出口读点都看到强化后的域。
 *
 * 下钻口径（#156）：`[*]` = arr.element / tuple 逐元素 / sum 逐数值成员递归
 * （只强化真实元素值域——不引入 unknown 臂、不烘焙 OOB undefined）；
 * `.ident` = obj 槽。叶子 = number prim：有 var/app term 则 pred 并上界
 * （and），无 term 则 mint fresh var（`inv#N`）作 term——pred 相对 term；
 * lit 叶子自带真值不改写（用户公理与具体观测冲突时不得把假 pred 烘进
 * Abs，否则 ex falso 任意可证）。叶子非数值（string/obj…）/ 结构不匹配 →
 * 该 spec 不适用，静默跳过（用户写错方向的约束靠证明失败暴露）。
 *
 * Bug 216（矛盾公理 ⇒ ex falso 假绿）：lit 守卫只挡「值是字面量」的叶子；
 * 带数值 pred 的叶子（侧车参数契约给的 `le(t,-5)`）与公理 `ge(t,0)` 直接
 * AND 会产出**矛盾谓词**——证明器对矛盾 pred 能对任意约束放电 ⇒ 真正的
 * 契约违例被判「已证明」（门禁假绿）。故 AND 之前做**相容性检查**：
 * 叶子既有 pred 与公理界可证矛盾（`pred ⊨ ¬rel` 或 `rel ⊨ ¬pred`）时
 * **不得**烘入公理（保持叶子原 pred，该不变式不参与本次证明）——公理与
 * 观测冲突时引擎站在观测一侧（sound 方向：少证明 ≠ 假证明）。
 *
 * 出口 join 口径（Bug 215）：不变式只在**循环 join/宽化位**实施。`$for`
 * 的 applyExtJoin 已内接（control.ts 的 widenLoopJoin）；`$whileSeq` /
 * `$forOf` 的**具体出口**路径（无快照 join / 无 widenFinal）此前不经任何
 * 实施点 ⇒ 公理被静默丢弃（while / do-while / for-of 三形态假红）。
 * 统一入口 = 本文件的 applyExitJoinInvariants（见其注释）。
 *
 * soundness：与 @nudo:assume 同信任级（用户公理，引擎不验证真实性）；
 * 跨帧不继承（state.ts 的槽在 callAtFunctionBoundary 清空）。强化叶子 conf
 * 取 "path"：pred 是公理提供的路径级证据——保留 "widened" 会被 #151 后置
 * 口径（isValueSetUnknown：宽化=界证据丢失）整段拦成 unprovable，特性失效；
 * "exact" 是更强声称，降级 path 是 sound 方向（域的 over-approximation
 * 声称随 shape 保留，不因 pred 改写）。
 *
 * 叶子模块：只依赖 abs/term/pred/state，无环。
 */
import type { Abs } from "../../abs.ts";
import { abs } from "../../abs.ts";
import { lit, v as termVar } from "../../term.ts";
import type { Pred } from "../../pred.ts";
import { and, ge, gt, implies, le, lt, not } from "../../pred.ts";
import { currentInvariantSpecs } from "./state.ts";

/** `@nudo:invariant <name><path> <rel> <number>` 的解析产物（check.ts 构造） */
export type InvariantSpec = {
  /** 循环携带绑定名（pack 槽键 / 形参 ∪ 函数体顶层局部名） */
  name: string;
  /** 下钻路径：`[*]`（元素域）/ `.ident`（obj 槽）；空 = 标量绑定 */
  path: Array<{ k: "idx" } | { k: "prop"; name: string }>;
  rel: "ge" | "le" | "gt" | "lt";
  value: number;
};

/** mint 序号：模块级（同一进程内 fresh；跨次实施不复用旧 var） */
let mintSeq = 0;

/**
 * Bug 216：叶子既有 pred 与公理界是否**可证矛盾**（`¬(pred ∧ rel)`）。
 *
 * 判据 = 证明器（pred.implies）双向试判：`pred ⊨ ¬rel` 或 `rel ⊨ ¬pred`。
 * 只在**可证矛盾**时判矛盾——证不出即视为相容（不引入新的假红；原行为是
 * 直接 AND）。
 *
 * 矛盾谓词必须被拒：证明器对矛盾 pred 能对任意约束放电（ex falso）⇒ 真正
 * 的契约违例会被判「已证明」（门禁假绿）。拒的方向是 sound 的——少一条
 * 公理证据 ≠ 多一条假证据。
 */
function contradictsRel(pred: Pred | undefined, rel: Pred): boolean {
  if (!pred || pred.op === "true") return false;
  return implies(pred, not(rel)) || implies(rel, not(pred));
}

/** 数值叶子强化：term 有则复用（pred 并集），无则 mint fresh var */
function strengthenLeaf(a: Abs, spec: InvariantSpec): Abs {
  const s = a.shape;
  if (s.k !== "prim" || s.type !== "number") return a;
  // lit 叶子：具体值自带真值（ge(lit(-1), 0) 是假 pred，ex falso 危险）
  if (a.term?.op === "lit") return a;
  const term = a.term ?? termVar(`inv#${mintSeq++}`);
  const bound = lit(spec.value);
  const rel =
    spec.rel === "ge"
      ? ge(term, bound)
      : spec.rel === "le"
        ? le(term, bound)
        : spec.rel === "gt"
          ? gt(term, bound)
          : lt(term, bound);
  // Bug 216：公理与叶子既有 pred 可证矛盾 → 不得烘入（否则矛盾 pred ⇒
  // ex falso ⇒ 真违例被判「已证明」）。保持叶子原 pred：该不变式不参与
  // 本次证明，后续证明通道按原 pred 照常对账（违例仍被报出）。
  if (contradictsRel(a.pred, rel)) return a;
  // conf 取 "path"（任务口径）：pred 是用户公理提供的路径级证据——保持
  // "widened" 会被 #151 后置口径（isValueSetUnknown：宽化丢界证据）整段
  // 拦成 unprovable，特性失效；"exact" 是更强声称，降级到 path 是 sound
  // 方向（mint var 本就非确定值）。域的 over-approximation 声称随 shape
  // 保留，不因 pred 改写。
  return abs(s, term, a.pred ? and(a.pred, rel) : rel, "path");
}

/** 按 path 下钻强化（结构不匹配 → 原样，spec 不适用） */
function drill(v: Abs, path: InvariantSpec["path"], spec: InvariantSpec): Abs {
  if (path.length === 0) return strengthenLeaf(v, spec);
  const [step, ...rest] = path;
  const s = v.shape;
  if (step.k === "idx") {
    if (s.k === "arr") {
      const element = drill(s.element, rest, spec);
      return element === s.element
        ? v
        : abs({ k: "arr", element }, undefined, undefined, v.conf);
    }
    if (s.k === "tuple") {
      let changed = false;
      const elements = s.elements.map((e) => {
        const w = drill(e, rest, spec);
        if (w !== e) changed = true;
        return w;
      });
      return changed ? abs({ ...s, elements }, undefined, undefined, v.conf) : v;
    }
    if (s.k === "sum") {
      let changed = false;
      const members = s.members.map((m) => {
        const w = drill(m, rest, spec);
        if (w !== m) changed = true;
        return w;
      });
      return changed ? abs({ k: "sum", members }, undefined, undefined, v.conf) : v;
    }
    return v;
  }
  if (s.k === "obj") {
    const slot = s.slots[step.name];
    if (!slot) return v;
    const w = drill(slot.value, rest, spec);
    if (w === slot.value) return v;
    return abs(
      { ...s, slots: { ...s.slots, [step.name]: { ...slot, value: w } } },
      undefined,
      undefined,
      v.conf,
    );
  }
  return v;
}

/**
 * 循环 pack（绑定包 obj，槽键 = JS 变量名）上实施当前 invariant specs：
 * 槽名匹配的绑定按 spec.path 下钻强化。非 obj（非打包场景）/ 无 specs /
 * 槽名不匹配 → 原样返回（零行为变化）。多个 spec 同名不同路径按序折叠。
 */
export function applyInvariantsToPack(pack: Abs): Abs {
  const specs = currentInvariantSpecs();
  if (specs.length === 0) return pack;
  const s = pack.shape;
  if (s.k !== "obj") return pack;
  let slots: typeof s.slots | undefined;
  let changed = false;
  for (const spec of specs) {
    const cur = (slots ?? s.slots)[spec.name];
    if (!cur) continue; // 绑定名不在本包（未携带/标量线程）：静默
    const w = drill(cur.value, spec.path, spec);
    if (w === cur.value) continue;
    if (!slots) slots = { ...s.slots };
    slots[spec.name] = { ...cur, value: w };
    changed = true;
  }
  if (!changed) return pack;
  // changed === true ⇒ slots 已拷贝（上文赋值），相关性 TS 无法跟踪，断言之
  return abs({ ...s, slots: slots! }, undefined, undefined, pack.conf);
}

/**
 * 当前是否有 @nudo:invariant 公理（无则出口 join 的不变式后处理是恒等）。
 *
 * 落点侧的用法：具体出口路径此前**从不取绑定包**（无快照 join → 直接 return）。
 * 取包不是零成本——转译侧的 pack 闭包对「循环头解构绑定」引用了体内作用域
 * 的名字（既有缺陷，见 tmp/probe/fix-r22-s10 报告），无公理时取包会把那个
 * 缺陷暴露成 ReferenceError。故落点须先问本函数：**无公理 ⇒ 完全不碰绑定包**
 * （零行为变化）。
 */
export function hasInvariantSpecs(): boolean {
  return currentInvariantSpecs().length > 0;
}

/**
 * Bug 215：循环**出口 join** 的不变式后处理——所有循环形态的统一入口。
 *
 * 不变式只在循环 join/宽化位实施（issue #176 的设计：用户公理是循环携带
 * 界的唯一通道）。实施点历史上只有两处：
 *   - `widenLoopJoin`（control.ts `$for` 的 applyExtJoin / 耗尽出口）
 *   - `widenFinal`（loop-widen.ts，抽象预算耗尽路径）
 * `$whileSeq`（while / do-while）与 `$forOf` 的**具体出口**路径既不调
 * widenLoopJoin 也不调 widenFinal ⇒ 出口 join 上的绑定包从未被强化 ⇒ 公理
 * 无诊断地消失（门禁对用户自己声明过的公理报红——假红）。
 *
 * 本函数 = 出口 join 的统一后处理（与 `$for` 同口径：join 之后施加）。
 * 落点（**跨文件**）：
 *   - control.ts `$whileSeq.applyExitJoin`（while / do-while）
 *   - containers/iterate.ts `$forOf.applyExitJoin`（for-of）
 * 两处都须在 unpack 之前对本函数的结果解包；无快照 join 的具体出口路径
 * 原本**不解包**（值天然正确），须改为「仅当不变式真的改写了绑定包时
 * 才解包」——零行为变化（无公理 / 公理不适用时恒等）。
 *
 * 无 specs / 非 obj 绑定包 → 恒等返回（===）——调用方可直接解包。
 */
export function applyExitJoinInvariants(pack: Abs): Abs {
  return applyInvariantsToPack(pack);
}
