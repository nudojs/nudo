/**
 * Error 家族（isErrorCtorName/errorBrandAbs；构造器名集合在
 * algebra/error-names.ts 叶子）+ 宿主构造器
 * 实参校验谓词（sumHasPrimMember/isNullishLit/enforceCanBeHeldWeakly/
 * isDefinitelyUndefinedArg）+ Proxy 构造（makeProxyAbs）。
 *
 * Invariants:
 * - errorBrandAbs 槽插入序 = 原生 gOPN 观察序（stack→message→cause→
 *   errors）；name 槽打 Slot.inherited（原型链槽：hasOwnProperty/gOPN 自有
 *   面折 false，$set 覆写落地转自有）；家族自有槽全 enumerable:false
 *  （Bug 84 枚举视图剔除，extends Error 内层公有槽展开同口径）。
 * - message 过 ToString：symbol prim 定抛 TypeError、any/含 symbol 臂
 *   union → may（Bug 54）；stack 恒 string 域不可精确折叠（Bug 59）。
 * - 实参校验三档口径（Bug 37/41/53/63/85，两个派发点共用：exec/class $new
 *   宿主分支与 dispatch.ts evalBuiltinNew）：definite 原生 throw（prim 字面
 *   量/缺省）→ NudoThrow；any/unknown/含坏成员 union → recordMayThrow（值
 *   域不变）；obj/fn/brand/tuple/arr 对象形态 → 原生全定。
 * - isNullishLit 与 surface.isNullishLitAbs 同判定但**不引 surface**（避免
 *   builtins↔surface 新环）；弱键分类本体在 collections.ts
 *  （classifyCanBeHeldWeakly，Bug 8 集合条目键单一口径），此处只落校验。
 * - Proxy brand inner = target Abs（无陷阱读写走靶语义、isArray 剥 brand 看
 *   靶形态）；target/handler 引用挂 match-iter 侧表（Bug 57/71 陷阱派发）。
 */

import type { Abs } from "../../abs.ts";
import { abs, strLit, bool, unknown } from "../../abs.ts";
import { objOf, getSlot, invokeToPrimitiveHook, getProtoAbs } from "../../objects.ts";
import { classifyCanBeHeldWeakly } from "../../collections.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { registerProxyParts } from "../../exec/match-iter.ts";
import { markFreshInstance } from "../../instance-id.ts";
import { setPropFlags } from "../invariants.ts";
import { isSymbolAbs } from "../symbol.ts";
import { str } from "../shared.ts";
import { enforceIterableStaticArg } from "../promise.ts";

/** JS Error 家族构造器名集合在 algebra/error-names.ts（无依赖叶子；
 *  exec/class-registry.ts 的 BUILTIN_ERROR_SUPER 键集同源）。 */
export { isErrorCtorName } from "../../error-names.ts";

/** Error 构造器 message 槽：原生恒为字符串（缺省/undefined → ""；非字符串
 *  字面量 → ToString）。非字面量保守（字符串保持、其余 strPrim）。
 *  Bug 54：message 过 ToString——symbol prim（Symbol()/Symbol.for 产物，
 *  无 lit 项——JS 无 symbol 字面量，旧 lit 分支是死代码）定抛 TypeError
 *  （node 实测 new Error(Symbol()) 全家族抛）；any/unknown/含 symbol 臂
 *  union → may；bigint/number/bool/对象 ToString 全定（良性惯例）。 */
function errorMessageSlot(messageArg: Abs | undefined): Abs {
  if (!messageArg) return strLit(""); // new Error() → ""
  // shape-first：先于 lit 分支判 symbol 形态
  if (isSymbolAbs(messageArg)) throw new NudoThrow(errorTypeAbs("TypeError"));
  {
    const k = messageArg.shape.k;
    // nullish 字面量（shape k:"unknown" + lit term）ToString 全定（"null"/""）
    const nullishLit =
      messageArg.term?.op === "lit" &&
      (messageArg.term.value === null || messageArg.term.value === undefined);
    if (
      k === "any" ||
      (k === "unknown" && !nullishLit) ||
      (k === "sum" && messageArg.shape.members.some((m) => isSymbolAbs(m)))
    ) {
      recordMayThrow({ kind: "TypeError", cause: "Error constructor message ToString may throw (Symbol)" });
    }
  }
  if (messageArg.term?.op === "lit") {
    const v = messageArg.term.value;
    if (typeof v === "string") return messageArg;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
      return strLit(String(v));
    }
    if (v === null) return strLit("null");
    if (v === undefined) return strLit(""); // new Error(undefined) → ""
    // symbol 等：原生 ToString 抛 TypeError——保守 unknown，不折精确值
    return str();
  }
  if (messageArg.shape.k === "prim" && messageArg.shape.type === "string") {
    return messageArg;
  }
  // Bug 381（Error 扩围）：对象实参走 ToString(obj) ⇒ 用户的 toString 钩子
  // **真调用**（原生必抛的钩子体 → 原生必抛）。修前此处**连钩子存在性都不
  // 探**，直接落 `str()`（确定的 string 域）⇒ 假绿 + 错值。
  const prim = invokeToPrimitiveHook(messageArg, "string");
  if (prim !== undefined) {
    const pv = prim.term?.op === "lit" ? prim.term.value : undefined;
    if (typeof pv === "string") return strLit(pv);
    if (typeof pv === "number" || typeof pv === "boolean" || typeof pv === "bigint") {
      return strLit(String(pv));
    }
    return str();
  }
  return str();
}

/**
 * Bug 317：AggregateError 的 errors 槽存**拷贝**（原生 IterableToList 产
 * 新列表）。tuple / arr 入参 → 新 Abs（内容同、身份异——引擎的 Abs 相等
 * 判定走对象身份，故 `e.errors === a` 折 false，与原生同）；elements 数组
 * 另拷贝一份（引擎的数组 mutator 就地改 elements 数组——共享同一数组
 * 引用则 push 仍会连带改写副本）。副本打**新鲜实例标**（不同创建事件
 * 引用必不同——strictEqAbs 据此把 `e.errors === a` 折 exact false；
 * 不打标则落 partial boolean）。
 * 抽象/不可判入参（prim / obj / brand / 缺省）→ 保守沿用入参 Abs
 * （不假精确；缺省 ≡ 原生 []，引擎沿用 unknown 口径）。
 */
function iterableListCopy(a: Abs | undefined): Abs {
  if (!a) return unknown;
  const s = a.shape;
  if (s.k === "tuple") {
    return markFreshInstance(
      abs(
        {
          k: "tuple",
          elements: [...s.elements],
          ...(s.rest !== undefined ? { rest: s.rest } : {}),
          ...(s.holes !== undefined ? { holes: [...s.holes] } : {}),
        },
        undefined,
        undefined,
        a.conf,
      ),
    );
  }
  if (s.k === "arr") {
    return markFreshInstance(abs({ k: "arr", element: s.element }, undefined, undefined, a.conf));
  }
  return a;
}

/**
 * 族 62 · 第 3 条：原生 InstallErrorCause 走 HasProperty(options, "cause")
 * ——**含原型链**（`Object.create({cause: 1})` 的自有键集为空但原型链上有
 * cause ⇒ 原生 `new Error("m", o).cause` === 1）。引擎的 obj 槽域只记**自有**
 * 键 ⇒ 原型链上的键不在自有槽域里 ⇒ HasProperty 的判定分三档：
 *
 * - "definite"：options 自有 cause 键（调用方直接取槽值）；
 * - "present"：原型链上**确有** cause 键（链全闭且命中）⇒ 原生**确定**装
 *   cause 槽（自有面 / in 面 / gOPN 面都含 "cause"）⇒ 装**值 unknown** 的
 *   槽（值不经原型链 Get 解析——保守，但不得读出「确定不存在」）；
 * - "absent"：链全闭且无 cause 键 ⇒ 原生确定无 cause 槽 ⇒ 不装槽；
 * - "unknown"：链上任一环**开放**（键集不完备）⇒ 存在性不可判 ⇒ 装
 *   **optional** 的 unknown 值槽（读出 unknown ∪ undefined；in / hasOwn
 *   折 boolean 域而非确定值）。
 */
type CausePresence =
  | { kind: "definite"; value: Abs }
  | { kind: "present" }
  | { kind: "absent" }
  | { kind: "unknown" };

function optionsCausePresence(optionsArg: Abs): CausePresence {
  const s = optionsArg.shape;
  // **确定非对象**的 options（prim / nullish 字面量）——原生
  // InstallErrorCause 首步「options 不是对象 ⇒ 直接返回」⇒ 确定无 cause 槽。
  if (s.k === "prim" || s.k === "never") return { kind: "absent" };
  if (optionsArg.term?.op === "lit" && (optionsArg.term.value === null || optionsArg.term.value === undefined)) {
    return { kind: "absent" };
  }
  // 抽象 options（any / unknown / sum）——键集不可判 ⇒ 存在性不可判。
  if (s.k === "any" || s.k === "unknown" || s.k === "sum" || s.k === "eff") {
    return { kind: "unknown" };
  }
  // 自有 cause 键（自有槽域命中）——值精确。
  if (s.k === "obj") {
    const own = getSlot(s.slots, "cause");
    if (own) return { kind: "definite", value: own.value };
  }
  if (s.k === "fn") {
    const own = s.slots ? getSlot(s.slots, "cause") : undefined;
    if (own) return { kind: "definite", value: own.value };
    return { kind: "absent" };
  }
  if (s.k === "brand") {
    const inner = s.shape;
    if (inner.shape.k === "obj") {
      const own = getSlot(inner.shape.slots, "cause");
      if (own) return { kind: "definite", value: own.value };
    }
    return { kind: "absent" };
  }
  // 原型链（protoTable 记录）：逐环找 cause 键——**命中即存在性确定**
  // （原型链上的键无论是否可枚举皆命中 HasProperty）；任一环开放 ⇒ 链不可判。
  let chainUndecidable = false;
  let cur: Abs | undefined = getProtoAbs(optionsArg);
  while (cur !== undefined) {
    if (cur.shape.k !== "obj") {
      chainUndecidable = true;
      break;
    }
    const cs = cur.shape as unknown as {
      slots: Record<string, { value: Abs }>;
      open?: boolean;
      index?: unknown;
    };
    if (cs.open === true || cs.index !== undefined) {
      chainUndecidable = true;
      break;
    }
    const hit = getSlot(cs.slots, "cause");
    if (hit) return { kind: "present" };
    cur = getProtoAbs(cur);
  }
  // 自有键集不完备（开放 obj）⇒ 存在性不可判（原型链命中已在上返回）。
  if (s.k === "obj") {
    const os = s as unknown as { open?: boolean; index?: unknown };
    if (os.open === true || os.index !== undefined) return { kind: "unknown" };
  }
  if (chainUndecidable) return { kind: "unknown" };
  return { kind: "absent" };
}

/**
 * Error brand：shape 带 name/message（字面量 message 保精确）。
 * AggregateError(errors, message[, options])：message 在第二实参，errors
 * 挂 .errors（原生是实参数组**副本**——见 iterableListCopy）；options.cause
 * 挂 .cause（**仅当 options 真有 cause 键**才装槽——见 Bug 316）。
 * $new 的 new Error 路径共用——catch 形参成员访问可解。
 */
export function errorBrandAbs(name: string, args: Abs[]): Abs {
  const messageArg = name === "AggregateError" ? args[1] : args[0];
  // R4b：槽插入序 = 原生自有属性安装序（gOPN 观察序）——node 实测
  // gOPN(new Error("m")) → ["stack","message"]（V8 先装 stack）；
  // 带 cause → ["stack","message","cause"]；AggregateError →
  // ["stack","message","cause","errors"]（cause 先于 errors）。name 是
  // inherited 原型链槽，不在 gOPN 面，位置不影响观察序。
  const slots: Record<string, { value: Abs; inherited?: boolean; optional?: boolean }> = {
    // Bug 59：stack 恒 string（V8/SpiderMonkey/JSC 堆栈轨迹文本，含调用点
    // 信息不可精确折叠）；用户写 e.stack = v 经既有 $set 槽写通道覆盖
    stack: { value: str("path") },
    // Bug 66：name 原生不是实例自有属性——经原型链从 X.prototype.name 解析
    // （Error.prototype.name = "Error"；TypeError.prototype.name =
    // "TypeError"…）。槽保留（$get 直读折家族名、$in 存在性 true），打
    // Slot.inherited 标记：hasOwnProperty / propertyIsEnumerable /
    // Object.hasOwn / gOPN 的自有面折 false；$set 公有覆写落地转自有
    // （e.name = "X" 原生建自有可枚举属性）。
    name: { value: strLit(name), inherited: true },
    message: { value: errorMessageSlot(messageArg) },
  };
  const optionsArg = name === "AggregateError" ? args[2] : args[1];
  if (optionsArg) {
    // Bug 316：原生 InstallErrorCause（ES2022 10.2.1）——**只有 options
    // 真有 `cause` 键**时才装 cause 槽：options 无 cause 键 ⇒ 错误对象
    // **无**自有 cause 槽（`hasOwnProperty("cause")` / `Object.hasOwn` /
    // `"cause" in e` 恒 false）；cause 键存在但值是 undefined ⇒ 装槽、
    // 值为 undefined。
    // 此前无 cause 键也装一个 undefAbs() 槽 ⇒ 自有面假 true（"cause" in e
    // 也假 true——$in 走槽存在性判定）。
    //
    // 族 62 · 第 3 条（cause 继承槽）：HasProperty(options, "cause") 走
    // **原型链**——`Object.create({cause: 1})` 的自有键集为空但原型链上有
    // cause ⇒ 原生 `new Error("m", o).cause` === 1。此前只按**自有槽**判
    // （闭 obj 且无 cause 槽 ⇒ 不装）⇒ 继承面读出「确定不存在」（精确
    // undefined），与原生相反。
    // 修法：键集**不可判**时（开放 obj / 原型链开放 / 抽象 options）装
    // **值为 unknown 的 cause 槽**：读出「有槽但不知道值」（unknown），
    // 不是「确定没有」（精确 undefined）。原型链上**确有** cause 键时
    // （存在性确定）装同款 unknown 值槽（值不经原型链 Get 解析——保守），
    // in / hasOwn / gOPN 面与原生同（确定含 "cause"）。
    const causePresence = optionsCausePresence(optionsArg);
    if (causePresence.kind === "definite") {
      slots["cause"] = { value: causePresence.value };
    } else if (causePresence.kind === "present") {
      slots["cause"] = { value: unknown };
    } else if (causePresence.kind === "unknown") {
      // optional 槽：$in / hasOwnProperty 折 boolean 域（原生不可判），
      // $get 读出 unknown ∪ undefined（unknown——「有槽但不知道值」）。
      slots["cause"] = { value: unknown, optional: true };
    }
    // "absent"：原生确定无 cause 槽 ⇒ 不装（保持 Bug 316 口径）。
  }
  if (name === "AggregateError") {
    // Bug 54：errors（args[0]）过 IterableToList——非可迭代定抛（node 实测
    // AggregateError(Symbol())/1/()/null 全抛 "… is not iterable"；字符串
    // 可迭代合法："ab" → errors ['a','b']）。与 Promise.all（Bug 47）共用
    // 三档口径：prim 非 string/nullish/缺省 → NudoThrow；any/obj/… → may
    enforceIterableStaticArg(args[0], "AggregateError errors");
    // Bug 317：原生 AggregateError 的 errors 是 **IterableToList 的拷贝**
    // （新列表）：`e.errors !== errorsArg`、入参后续变更不改写 e.errors。
    // 此前直接存**同一个** Abs（别名）⇒ `e.errors === a` 折 true、
    // `a.push(3)` 就地改写 e.errors.length。tuple/arr 入参 → 造**新 Abs**
    // （元素同、身份异；elements 数组另拷贝——否则就地 push 仍会连带
    // 改写副本）；抽象/不可判入参 → 保守沿用入参 Abs（不假精确）。
    slots["errors"] = { value: iterableListCopy(args[0]) };
  }
  // Bug 84：Error 家族自有槽（name/message/stack；AggregateError 的
  // errors/cause）原生全不可枚举——枚举视图（for-in/keys/spread/assign/
  // stringify）与 extends Error 用户类实例的内层公有槽展开据此剔除
  const errInner = objOf(slots);
  for (const k of Object.keys(slots)) {
    setPropFlags(errInner, k, { enumerable: false });
  }
  return abs(
    {
      k: "brand",
      name,
      shape: errInner,
    },
    undefined,
    undefined,
    "path",
  );
}

// --- 宿主构造器实参校验（Bug 37/41/53/63/85）---------------------------
// 两个派发点共用：exec/class.ts $new 宿主函数分支（自由标识符漏入的宿主全局）
// 与本文件 evalBuiltinNew（Abs 面）。三档口径与全仓约定一致：
// - definite 原生 throw（prim 字面量/缺省等静态确定非法）→ NudoThrow
// - any/unknown/含坏成员的 union → recordMayThrow（值域不变）
// - obj/fn/brand/tuple/arr 等对象形态 → 原生全定（total）

/** union 含 prim 成员（非 nullish）→ 该值可能是原始值（原生 may TypeError） */
export function sumHasPrimMember(a: Abs): boolean {
  if (a.shape.k !== "sum") return false;
  return a.shape.members.some(
    (m) =>
      m.shape.k === "prim" &&
      !(m.term?.op === "lit" && (m.term.value === null || m.term.value === undefined)),
  );
}

/**
 * nullish 字面量实参（shape k:"unknown" + lit term——引擎的 null/undefined
 * 字面量表示，见 litAbsFromJs）。与 surface.isNullishLitAbs 同判定，本文件
 * 不引 surface（避免 builtins↔surface 新环）。
 */
export function isNullishLit(a: Abs | undefined): boolean {
  return (
    !!a &&
    a.term?.op === "lit" &&
    (a.term.value === null || a.term.value === undefined)
  );
}

/**
 * Bug 37：new Proxy(target, handler) —— 原生 ProxyCreate 对 target 与
 * handler 各做 IsObject。prim（含 nullish/缺省 ≡ undefined）→ 确定
 * TypeError；any/unknown/含 prim 成员 union → may；obj/fn/brand/tuple/arr
 * 是对象 → 全定，构造 Proxy brand。
 * Bug 57/71：brand inner = target Abs（无陷阱读写走靶语义、isArray 剥
 * brand 看靶形态）；target/handler 引用挂 match-iter 侧表——get/has/set
 * 陷阱派发（$get/$set/$in）与陷阱实参（首参 target）用。
 * Bug 235：**新鲜实例标打在构造点**（原生 new Proxy 每次都是新对象，与靶
 * 必不同引用）——`p === t` / `p1 === p2` 恒 false。读面懒打（首次经
 * Proxy 面读时）只覆盖"读过"的代理；构造点打标覆盖**全部**代理（不经任何
 * Proxy 面读的 `p === t` 也可判）。
 */
export function makeProxyAbs(target: Abs | undefined, handler: Abs | undefined): Abs {
  for (const a of [target, handler]) {
    if (!a || isNullishLit(a) || a.shape.k === "prim") {
      throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省/nullish/prim：非对象
    }
    if (a.shape.k === "any" || a.shape.k === "unknown" || sumHasPrimMember(a)) {
      recordMayThrow({ kind: "TypeError", cause: "new Proxy on non-object target or handler" });
    }
  }
  const t = target as Abs;
  const h = handler as Abs;
  const proxy = abs(
    { k: "brand", name: "Proxy", shape: t },
    undefined,
    undefined,
    "path",
  );
  // Bug 235：构造点打新鲜实例标（Proxy 是独立创建事件——与靶、与其他代理
  // 必不同引用）。读面懒打（member.ts）保留为兜底（$set 后的新 Abs 丢标）。
  markFreshInstance(proxy);
  registerProxyParts(proxy, { target: t, handler: h });
  return proxy;
}

/** Bug 43：CanBeHeldWeakly 校验分类——自本文件移入 collections.ts 内核叶子
 *  （Bug 8：集合构造器条目键复用同口径，避免 collections ↔ builtins 新环）。 */

/** Bug 43：弱键校验落地：def → NudoThrow(TypeError)；may → recordMayThrow(TypeError) */
export function enforceCanBeHeldWeakly(a: Abs | undefined, what: string): void {
  const c = classifyCanBeHeldWeakly(a);
  if (c.k === "def") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (c.k === "may") {
    recordMayThrow({ kind: "TypeError", cause: `${what} may not be an object or symbol (CanBeHeldWeakly)` });
  }
}

/** Bug 43：实参确定为 undefined（缺省 / undefined 字面量）——register 的
 * unregisterToken 仅此形态跳过弱键校验（原生 SameValue(·,undefined) 豁免） */
export function isDefinitelyUndefinedArg(a: Abs | undefined): boolean {
  return !a || (a.term?.op === "lit" && a.term.value === undefined);
}
