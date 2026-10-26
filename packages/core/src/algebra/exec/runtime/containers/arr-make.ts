/**
 * 元组/数组构造与宽化。
 *
 * Invariants:
 * - 容器策略单点：≤cap → tuple（逐元素精确）；>cap → arr（元素 join）。
 *   cap 只约束字面量/拼接的类型面；生成器 drain 的 exact 权威序列越过
 *   cap 仍出 exact 元组（drainTupleOrWiden，TUPLE_MATERIALIZE_CAP 上界）。
 * - arr.element 只描述**真实元素值域**——OOB undefined 是读位事实
 *   （$idx 抽象下标自行 join oobUndef marker），任何构造/宽化路径都
 *   不得把 OOB undefined 烘焙进元素域（issue #156：烘焙会让「循环+push」
 *   对任何元素契约不可证）。
 * - 空 tuple 宽化只在零观测元素（interrupted 等整值宽化）时取 unknown
 *   元素顶；正常增长路径元素域 = 全部观测元素域 join（joinAbs(unknown,E)
 *   会吸收污染，空成员贡献空不贡献 unknown 顶）。
 */
import type { Abs } from "../../../abs.ts";
import { abs, unknown, type Confidence } from "../../../abs.ts";
import { pTrue } from "../../../pred.ts";
import {
  joinAbs,
} from "../../../objects.ts";
import { shouldWidenArrayLiteral, widenedArrayConf, TUPLE_MATERIALIZE_CAP } from "../../../containers.ts";
import { markFreshInstance } from "../../../instance-id.ts";
import {
  undef,
  asAbsVal,
} from "../state.ts";
import "../members.ts";

/** 容器策略单点（containers.ts）：≤cap → tuple；>cap → arr（元素 join，path） */
export function tupleOrWiden(els: Abs[], conf: Confidence): Abs {
  if (shouldWidenArrayLiteral(els.length)) {
    return abs(
      { k: "arr", element: els.reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      widenedArrayConf(),
    );
  }
  return abs({ k: "tuple", elements: els }, undefined, undefined, conf);
}

/**
 * R1b：生成器 drain 列表重组数组——exact 视图（makeGenObject 注册的线性
 * 收集序列）时元素序列是权威数据（Bug 53 ys.els），越过 TUPLE_LITERAL_CAP
 * 出 exact 元组（cap 只约束字面量/拼接的类型面）；仅超大列表
 * （> TUPLE_MATERIALIZE_CAP）退 arr join（sound 上界）。非 exact（路径
 * 敏感拼接序列）→ tupleOrWiden 原口径（widened arr）。
 */
export function drainTupleOrWiden(els: Abs[], conf: Confidence, exact: boolean): Abs {
  if (exact && els.length <= TUPLE_MATERIALIZE_CAP) {
    return abs({ k: "tuple", elements: els }, undefined, undefined, conf);
  }
  return tupleOrWiden(els, conf);
}

/** 数组字面量 → ≤cap tuple（逐元素精确）/ >cap arr；策略与 containers.ts 同源 */
export function $arr(items: Abs[]): Abs {
  // R2b：每次字面量求值产出新数组对象——打新鲜实例标（=== 折 false）
  return markFreshInstance(tupleOrWiden(items.map(asAbsVal), "exact"));
}

/**
 * `arguments` 对象 → 类数组 **brand "Arguments"** 包 tuple 内层（Bug 56：
 * 不是数组 exotic——`Array.isArray(arguments)` 原生 false；$idx/$len/$in/
 * spread/Array.from 经委托/剥层保持下标/长度/迭代精确）。
 * strict/ESM 与形参**独立映射**：写 `arguments[i]` 不改形参，写形参不改 `arguments`。
 * （sloppy 非严格是 mapped arguments object，二者互相写回——Nudo 分析按 ESM/strict。）
 * 与 rest 绑定解耦：rest 仍从真实 `arguments`/rest 形参收集，本对象只服务用户写的 `arguments`。
 */
export function $arguments(items: ArrayLike<unknown>): Abs {
  const n = typeof items?.length === "number" && items.length > 0 ? items.length : 0;
  const els: Abs[] = new Array(n);
  for (let i = 0; i < n; i++) els[i] = asAbsVal((items as ArrayLike<unknown>)[i]);
  const tuple = abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
  return abs({ k: "brand", name: "Arguments", shape: tuple }, undefined, undefined, "exact");
}

/**
 * 带空洞的数组字面量（[1,,3]）：hole 槽位置为 undefined 值但 `in` 判定 false。
 * 超 cap 退化 arr 时丢弃 hole 精度（元素 join，长度语义已由 arr 承接）。
 */
export function $arrWithHoles(items: Abs[], holes: number[]): Abs {
  const base = $arr(items);
  if (holes.length === 0 || base.shape.k !== "tuple") return base;
  return abs({ k: "tuple", elements: base.shape.elements, holes }, undefined, undefined, base.conf);
}

/**
 * Bug 44：签名符号执行的 rest 形参注入哨兵。generalize 的零实参符号调用
 * 对每个形参恰好注入 1 个合成实参——rest 形参会塌缩成固定 1 元组（假
 * 具体值：`sigLen(...r) => 1`）。签名面注入开放数组 Abs（arr(any)、
 * 长度无上界），rest 绑定（$restBind）识别哨兵直通；真实调用永不携带
 * （保留字 var term id——用户面/α 空间（"A1" 标签系）不可构造，且经
 * $copy 快照存活——Symbol 键标记会被 callTranspiledExportFull 的 D1
 * 副本剥掉）。
 */
const SYMBOLIC_REST_VAR = "Ωnudo-symbolic-restΩ";

export function makeSymbolicRestAbs(): Abs {
  return abs(
    { k: "arr", element: abs({ k: "any" }, undefined, undefined, "path") },
    { op: "var", id: SYMBOLIC_REST_VAR },
    pTrue,
    "partial",
  );
}

export function isSymbolicRestAbs(a: unknown): boolean {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return false;
  const t = (a as Abs).term;
  return (
    (a as Abs).shape.k === "arr" &&
    t !== undefined &&
    t.op === "var" &&
    t.id === SYMBOLIC_REST_VAR
  );
}

/**
 * rest 形参绑定（Bug 44）：收集 namedCount 之后的实参包 $arr（长度保持
 * 原生——真调用面）；唯一元素是符号注入哨兵时直通开放数组（签名面）。
 */
export function $restBind(list: ArrayLike<unknown>, namedCount: number): Abs {
  const rest = Array.prototype.slice.call(list, namedCount) as unknown[];
  if (rest.length === 1 && isSymbolicRestAbs(rest[0])) return rest[0] as Abs;
  return $arr(rest as Abs[]);
}

/** 巨下标/巨 length 写入：不物化稀疏段（原生稀疏数组），就地降 arr 形状。
 *  元素域 = 已知元素 ∪ undefined（hole/延长槽读 undefined）∪ 写入值。 */
export function widenTupleToArr(
  els: Abs[],
  holes: number[] | undefined,
  value: Abs | undefined,
): { k: "arr"; element: Abs } {
  let joined: Abs = els.length > 0 ? els.reduce((x, y) => joinAbs(x, y)) : unknown;
  if (holes && holes.length > 0) joined = joinAbs(joined, undef());
  if (value !== undefined) joined = joinAbs(joined, value);
  return { k: "arr", element: joined };
}
