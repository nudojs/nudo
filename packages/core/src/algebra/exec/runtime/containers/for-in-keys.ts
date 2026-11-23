/**
 * for..in 键序列：自有可枚举字符串键（含 brand 原型链 / proxy / typed array）。
 *
 * 从 iterate.ts 抽出；for-of 的 live 键检查仍留在 iterate。
 */
import type { Abs } from "../../../abs.ts";
import { abs, litValue, str, unknown } from "../../../abs.ts";
import {
  getInstanceProto,
  getProtoAbs,
  getSlot,
  isNullProtoObj,
  joinAbs,
} from "../../../objects.ts";
import { enumOwnStringKeys, getPropFlags, protoBrandAbs } from "../../../builtins.ts";
import {
  proxyGetOwnPropDescTrap,
  proxyOwnKeysTrapKeys,
  proxyTargetEnumerableStringKeys,
} from "../../../builtins/object/descriptor.ts";
import {
  classSpecOfAbs,
  fnProtoOf,
  getEvalClass,
  lookupClassValue,
  type EvalClassSpec,
} from "../../class-registry.ts";
import {
  classChainHasHole,
  classChainLinks,
  evalClassChain,
} from "../../runtime/members.ts";
import { protoBrandForSpec } from "../../../builtins/ctor.ts";
import { typedArrayEnumKeyView } from "../../../builtins/object/enum-entries.ts";
import { $arr } from "./arr-make.ts";
import { $lit } from "../state.ts";

const isArrayIndexKey = (k: string): boolean => {
  const n = Number(k);
  return (
    k !== "" &&
    String(n) === k &&
    Number.isInteger(n) &&
    n >= 0 &&
    n < 4294967295
  );
};

/**
 * Bug 285：Proxy 的 for…in 键序列（ES2024 13.7.5.9 + 10.5.5）——
 * 1. [[OwnPropertyKeys]] → ownKeys 陷阱（proxyOwnKeysTrapKeys：**单一实现**，
 *    含规范不变量校验——重复名 / 非字符串键 / 漏靶的不可配置自有键 ⇒ TypeError）；
 * 2. 每个键按 [[GetOwnProperty]] 判**可枚举性**（代理的 getOwnPropertyDescriptor
 *    陷阱优先；无该陷阱 ⇒ 靶的自有描述符）——不可枚举 / 靶上不存在 ⇒ 不进结果；
 * 3. 键序 = **陷阱结果的顺序**（原生 for-in 不重排整数键——与普通对象路径的
 *    「整数键升序在前」不同）。
 *
 * 返回 undefined = **无 ownKeys 陷阱** ⇒ 调用方落**靶**语义（原生规范 step 6）。
 */
function proxyForInKeys(o: Abs): Abs | undefined {
  const outcome = proxyOwnKeysTrapKeys(o);
  if (outcome.k === "absent") return undefined;
  if (outcome.k === "opaque") {
    // 键面不可判 ⇒ 抽象字符串键（体 0..N 次——不得折空）
    return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
  }
  const targetEnum = proxyTargetEnumerableStringKeys(outcome.target);
  const names: string[] = [];
  for (const k of outcome.keys) {
    const kv = litValue(k);
    // 抽象键 / 非字符串键：规范不变量已由 proxyOwnKeysTrapKeys 校验（不可判面
    // 不抛）——此处跳过（键面不可判 ⇒ 整段降级为抽象字符串键）
    if (!kv.ok || typeof kv.value !== "string") {
      return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
    }
    const name = kv.value;
    const desc = proxyGetOwnPropDescTrap(o, $lit(name));
    if (desc.k === "opaque") {
      return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
    }
    if (desc.k === "desc") {
      const slots =
        desc.desc.shape.k === "obj"
          ? (desc.desc.shape as { slots: Record<string, { value: Abs }> }).slots
          : undefined;
      const en = slots ? getSlot(slots, "enumerable")?.value : undefined;
      const elv = en ? litValue(en) : undefined;
      if (!elv || !elv.ok) {
        return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
      }
      if (Boolean(elv.value)) names.push(name);
      continue;
    }
    // 无 getOwnPropertyDescriptor 陷阱 ⇒ 靶的 [[GetOwnProperty]]：靶上不存在 /
    // 不可枚举 ⇒ 不进结果
    if (targetEnum === undefined) {
      return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
    }
    if (targetEnum.includes(name)) names.push(name);
  }
  return $arr(names.map((k) => $lit(k)));
}

export function $forInKeys(o: Abs): Abs {
  const shape = o.shape;
  if (shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const members = shape.members.map((m) => $forInKeys(m));
    return members.length ? members.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
  // Bug 285：Proxy 的 for…in 必须走 [[OwnPropertyKeys]]（ownKeys 陷阱）——
  // 此前**无 Proxy 分支**（直接枚举**靶**的自有可枚举键）⇒ 枚举出精确错值
  // （原生：ownKeys 陷阱结果 ∩ 可枚举性）。无陷阱 ⇒ 落靶语义（规范 step 6）。
  if (shape.k === "brand" && (shape as { name?: string }).name === "Proxy") {
    const pk = proxyForInKeys(o);
    if (pk !== undefined) return pk;
  }
  if (shape.k === "obj") {
    // Bug 18：open obj（Object.create(proto) / setPrototypeOf / spread 开面
    // 产物）原型链未跟踪（Object.create 不记 protoTable）——可携带任意
    // 可枚举继承键，不得断言精确（可能为空的）自有键序列（for-in over
    // Object.create({x:1}) 原生跑 1 次）。诚实降级为抽象字符串键数组
    // （体 0..N 次，与 any 接收者臂同口径）；null-proto 标记链终止于
    // null，闭 obj（原型恰为无可枚举自有的 Object.prototype）仍精确。
    if (shape.open && !isNullProtoObj(o)) {
      return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
    }
    // 仅自有可枚举键——与 Object.keys 的 enumKeys 同口径
    // （getPropFlags().enumerable === false 的 defineProperty 键剔除）
    // Bug 295：for-in 只枚举**字符串**键（symbol 键不进 for-in）⇒ 用
    // enumOwnStringKeys（CopyDataProperties 视图 enumOwnKeys 含 symbol 键，
    // 那是 spread / assign / 对象 rest 的口径）。
    const keys = enumOwnStringKeys(o, shape.slots);
    const intKeys = keys.filter(isArrayIndexKey).sort((a, b) => Number(a) - Number(b));
    const strKeys = keys.filter((k) => !isArrayIndexKey(k));
    return $arr([...intKeys, ...strKeys].map((k) => $lit(k)));
  }
  if (shape.k === "tuple") {
    const idxs: number[] = [];
    for (let i = 0; i < shape.elements.length; i++) {
      if (shape.holes?.includes(i)) continue;
      idxs.push(i);
    }
    return $arr(idxs.map((i) => $lit(String(i))));
  }
  if (shape.k === "arr") {
    // 抽象数组：索引域未知，单代表元素迭代（与 $forOf 抽象近似同口径）
    return abs({ k: "arr", element: $lit("0") }, undefined, undefined, "partial");
  }
  const svR = litValue(o);
  const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
  if (typeof sv === "string") {
    return $arr(Array.from({ length: sv.length }, (_, i) => $lit(String(i))));
  }
  // 键域未知 ≠ 键域为空（Bug 68）：any/unknown 接收者可能携带任意可枚举键，
  // 体必须至少跑一次（抽象字符串键），否则体内的 may-throw 丢失、计数器
  // 折成假精确 0。抽象 string prim 同理（索引键 0..len-1 域未知）。
  // 例外：nullish lit 的形状就是 unknown（无独立 nullish shape），原生
  // ToObject 后零可枚举键——先看 term 排除，键域确定为空。
  const isNullishLit =
    o.term?.op === "lit" &&
    ((o.term as { value: unknown }).value === null ||
      (o.term as { value: unknown }).value === undefined);
  if (
    !isNullishLit &&
    (shape.k === "any" ||
      shape.k === "unknown" ||
      (shape.k === "prim" && shape.type === "string"))
  ) {
    return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
  }
  // brand：内层 obj 槽的可枚举键（类实例字段等）；内建（Date/Map/Promise）
  // 零自有可枚举键 → 空键序列。
  if (shape.k === "brand") {
    // Bug 125：TypedArray——整数索引异质属性是自有可枚举键 "0".."n-1"，
    // 与 Object.keys 同口径（typedArrayEnumKeyView 读内层 length 槽）；
    // 长度可知 → 精确键序列；长度开放 → 抽象字符串键（体 0..N 次——
    // 空 TA 0 次、非空 n 次，不得折空）。此前整族折 []（wrong-exact）。
    const taView = typedArrayEnumKeyView(o);
    if (taView) {
      return taView.k === "exact"
        ? $arr(Array.from({ length: taView.count }, (_, i) => $lit(String(i))))
        : abs({ k: "arr", element: str() }, undefined, undefined, "partial");
    }
    const inner = shape.shape;
    if (inner.shape.k === "obj") {
      // boxed String brand（Bug 57 附带，T2 移交）：length 不可枚举——原生
      // for (k in new String("ab")) 只枚举 ["0","1"]（内部槽已标 enumerable:false）
      // flags 查 **brand 自身**（原型对象的 `constructor` 不可枚举标记挂在
      // brand 上——ctor.ts 的 protoBrandAbs / objectProtoBrand）——并由
      // isNonEnumerable 兜查内层（boxed / error 等把标记挂内层的形态）。
      const own = enumOwnStringKeys(o, inner.shape.slots).filter(
        (k) => !(shape.name === "String" && k === "length"),
      );
      // Bug 200：原型链上的可枚举键（原生 for-in **沿原型链**枚举）——此前
      // 只枚举自有槽，原型上的可枚举属性被整体丢弃（`class A{};
      // A.prototype.b = 2; for (k in new A())` 原生 "ab"，引擎 "a"）。
      const protoKeys = brandProtoEnumerableKeys(shape.name, o);
      if (protoKeys === undefined) {
        // 链不可判定（动态父 / 链洞 / 显式改过原型）⇒ 不得断言精确键序列
        // （可能漏键）——按 Bug 18 口径降级为抽象字符串键数组。
        return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
      }
      const seen = new Set<string>();
      const all: string[] = [];
      for (const k of [...own, ...protoKeys]) {
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(k);
      }
      return $arr(all.map((k) => $lit(k)));
    }
    return $arr([]);
  }
  // 其余（num/bool/bigint/symbol/null/undefined prim 字面量或抽象、fn、eff）：
  // 原生 ToObject 后零可枚举键 → 键域确定为空，体 0 次。
  return $arr([]);
}

/**
 * Bug 200：brand 实例的**原型链可枚举键**（原生 for-in 沿原型链枚举）。
 *
 * 引擎模型下原型可枚举属性的落点：
 * - 注册类（`class A{}`）：`protoBrandAbs(name)` 的内层 obj——`A.prototype.b = 2`
 *   落此槽（`$set` 对 brand "A.prototype" 的内层 obj 写槽）。
 * - 函数声明（伪父 `function F(){}`）：`fnProtoOf(classValue)` 的 obj——
 *   `F.prototype.b = 2` 落此槽。
 * 两者都带 "constructor" 槽——原生 `A.prototype.constructor` **非枚举** ⇒ 剔除。
 *
 * 返回 undefined = **链不可判定**（extends 动态表达式 / 链洞 / 显式
 * setPrototypeOf 改过原型）⇒ 调用方不得断言精确键序列（可能漏键），
 * 按 Bug 18 口径降级为抽象字符串键数组。
 */
function brandProtoEnumerableKeys(brandName: string, recv: Abs): string[] | undefined {
  // 实例原型被显式改过 → 链不再是类注册表那条 ⇒ 不可判定
  if (getProtoAbs(recv) !== undefined) return undefined;
  // 链洞（未注册父名）⇒ 可能漏掉中间层的可枚举键
  if (classChainHasHole(brandName)) return undefined;
  // BUG-188：实例的绑定身份（规格 + 构造期记录的原型）优先——同名但
  // 不同绑定的类各枚举自己的原型可枚举键（`A.prototype.b = 2` 不跨类）。
  const startSpec = classSpecOfAbs(recv);
  const startProto = getInstanceProto(recv);
  const canonical = startSpec ? protoBrandForSpec(startSpec) : undefined;
  if (startProto !== undefined && canonical !== undefined && startProto !== canonical) {
    return undefined; // 类原型被替换过：链不再是注册表那条
  }
  const links =
    startSpec !== undefined && startSpec.name === brandName
      ? classChainLinks(brandName, startSpec)
      : evalClassChain(brandName).map((n) => ({ name: n, spec: getEvalClass(n) }));
  const out: string[] = [];
  for (let i = 0; i < links.length; i++) {
    const { name: n, spec } = links[i]!;
    const inner = protoInnerOf(n, spec, i === 0 ? startProto : undefined);
    if (!inner || inner.shape.k !== "obj") continue;
    // 原型对象自身被显式改过原型 → 其上的可枚举键不可判定
    if (getProtoAbs(inner) !== undefined) return undefined;
    // 类方法 / 实例访问器在原生是**非枚举**属性（`class A{ m(){} }` 的
    // `A.prototype.m` 不可枚举——for-in 看不到）——原型 obj 里带着这些槽，
    // 必须剔除（`A.prototype.m = 5` 也不改可枚举性：原属性非枚举）。
    const levelSpec = spec ?? getEvalClass(n);
    const nonEnumerable = new Set<string>([
      ...Object.keys(levelSpec?.methods ?? {}),
      ...Object.keys(levelSpec?.accessors ?? {}),
    ]);
    const keys = enumOwnStringKeys(inner, inner.shape.slots).filter(
      (k) => k !== "constructor" && !nonEnumerable.has(k),
    );
    // 原生每层的键序：整数键升序 → 其余键按插入序
    const intKeys = keys.filter(isArrayIndexKey).sort((a, b) => Number(a) - Number(b));
    const strKeys = keys.filter((k) => !isArrayIndexKey(k));
    out.push(...intKeys, ...strKeys);
  }
  return out;
}

/** 类名 → 其原型对象的内层 obj（注册类走规格身份；函数声明走伪父）。 */
function protoInnerOf(
  name: string,
  spec: EvalClassSpec | undefined,
  startProto?: Abs,
): Abs | undefined {
  if (startProto !== undefined) {
    const sp = startProto.shape;
    return sp.k === "brand" ? sp.shape : sp.k === "obj" ? startProto : undefined;
  }
  const cv = lookupClassValue(name);
  if (cv && cv.shape.k === "fn") return fnProtoOf(cv);
  if (spec) {
    const pbs = protoBrandForSpec(spec).shape;
    return pbs.k === "brand" ? pbs.shape : undefined;
  }
  if (getEvalClass(name)) {
    const pbs = protoBrandAbs(name).shape;
    return pbs.k === "brand" ? pbs.shape : undefined;
  }
  return undefined;
}

/** 侧表迭代物（生成器对象 / 模板标签 / matchAll 迭代器，Bug 22）的精确
 *  长度——matchIterElements 命中即长度已知（for-of 精确展开用）。
 *  Bug 141：async generator **没有 @@iterator 槽**（原生只有 @@asyncIterator）
 *  ⇒ matchIterElements 不命中；改读生成器消费视图的剩余条目数（与同步
 *  generator 同口径：剩余 = 未消费条目）。 */
