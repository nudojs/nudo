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
import { and, ge, gt, le, lt } from "../../pred.ts";
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
