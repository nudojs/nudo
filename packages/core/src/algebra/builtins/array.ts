/**
 * Array 构造 / Array.* 静态方法
 *
 * Invariants:
 * - Bug 202：`Array.from(用户 iterable)` **实际驱动**用户迭代器（GetIterator
 *   + IteratorNext，元素按迭代序取）——与 elemsOf / for-of / spread 同款
 *   协议；迭代器报告 done ⇒ 元素数确切 ⇒ exact 元组。
 * - Bug 195：`Array.isArray` 认**数组视图标注**（markMatchArrayView）的对象
 *   ——标签模板对象是冻结的数组 exotic（原生 true）；RegExp exec/match
 *   结果同款（原生亦是真数组）。
 * - Bug 294：array-like 读数（length / 逐索引）**先经访问器侧表**
 *   （accessorReadDomain）——真 getter 住侧表、shape 里只有占位槽；
 *   裸读槽 ⇒ length 被当 undefined（折空数组）+ getter 副作用消失。
 *   每次 Array.from 读一次 length / 每个索引（与原生同款）。
 * - Bug 296：`Array.from(items, mapFn, thisArg)` 的**第三实参**透传给
 *   回调（此前丢弃 ⇒ 回调 this 恒 undefined ⇒ 假抛 / 计数器归零）。
 * - Bug 330：Array.prototype.{toString,toLocaleString,join} 接收者为
 *   **nullish** ⇒ 定抛 TypeError（ToObject）——不记抛 ⇒ L2 门禁假绿。
 */
import type { Abs } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown } from "../abs.ts";
import { joinAbs } from "../objects.ts";
import { markDomainShared } from "../len-sharing.ts";
import { TUPLE_MATERIALIZE_CAP } from "../containers.ts";
import { isMapAbs, isSetAbs, setElementsAbs, mapEntriesAbs } from "../collections.ts";
import { applyCallbackValue, undefAbs, asAbs, validateCallableArg } from "../hof.ts";
import { numericBounds } from "../arithmetic.ts";
import { isNullishLitAbs } from "../surface.ts";
import { markFreshInstance } from "../instance-id.ts";
import { recordMayThrow } from "../may-throw.ts";
import { matchIterElements, replayGenDeferred, drainGenElements, genDrainViewOf, userIterLenOf } from "../exec/match-iter.ts";
import { iterabilityKind, $elems } from "../exec/runtime/containers/iterate.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { and, ge, lt, pTrue, type Pred } from "../pred.ts";
import { accessorKeysOf, accessorReadDomain } from "../accessors.ts";
import { lit, v, type Term } from "../term.ts";
import { defaultLeakBudget } from "../leak.ts";
import { emptyEnv } from "../ast-env.ts";
import { absFunction } from "../abs-fn.ts";
import { boolPrim, peelBrand, noBody, str, mayCoerceThrowOperand } from "./shared.ts";
import { thenableRiskOf } from "./promise.ts";
import { isSymbolAbs } from "./symbol.ts";
// Bug 195：标签模板对象是**数组 exotic**（原生 GetTemplateObject →
// CreateArrayFromList + SetIntegrityLevel(frozen)）⇒ Array.isArray(s) 恒 true。
// 引擎用「数组视图」标注（markMatchArrayView——与 RegExp exec/match 结果
// 同款机制，json.ts 消费）标记这类对象 ⇒ isArray 与该标注同口径。
import { isMatchArrayView } from "./regexp.ts";

export function makeArrayCtorAbs(args: Abs[]): Abs {
  /**
   * 长度实参已证非负（`b.length + 1` 类：$len 带 pred ≥0，add 的 addPred
   * 平移界）→ 负数维度排除。非整数维度（抽象 number 无整数性事实）在此
   * 放行——长度派生算术在真实代码中恒整数，且 1.7.3 前此路径完全不记
   *（issue #98 的 `new Array(b.length + 1)` DP 表误报）。
   */
  const provenNonNegativeLength = (a: Abs): boolean => {
    const b = numericBounds(a);
    return b?.lo !== undefined && b.lo.value >= 0;
  };
  if (args.length === 0) {
    return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
  }
  if (args.length >= 2) {
    return abs(
      { k: "tuple", elements: args.map((a) => asAbs(a) ?? unknown) },
      undefined,
      undefined,
      "exact",
    );
  }
  const a0 = args[0]!;
  if (a0.term?.op !== "lit") {
    // Bug 50：Array(len) 仅 Number 实参走 length 路径（ToArrayLength——
    // 负数/非整数/超界 → RangeError）；symbol/bigint/obj/字符串实参原生是
    // 单元素数组（node 实测 Array(Symbol()) → [Symbol()]，total）。
    // may 打点仅对「可能是 Number」的形态：any/抽象 prim number/含 number 臂 sum。
    const mayBeNumber = (m: Abs): boolean =>
      m.shape.k === "any" ||
      m.shape.k === "unknown" ||
      (m.shape.k === "prim" && (m.shape as { type?: string }).type === "number");
    // Bug 53：number prim（或全 number 臂 sum——lit 或抽象）实参恒走 length
    // 路径 → 稀疏数组，元素全 hole → 读恒 undefined（值域可判定，与字面量
    // 路径的 undefAbs() 同口径）；any/unknown/非 number prim（可能是字符
    // 串 → 单元素数组）保持 unknown
    const numberLike = (m: Abs): boolean =>
      (m.shape.k === "prim" && (m.shape as { type?: string }).type === "number") ||
      (m.shape.k === "sum" &&
        (m.shape as { members: Abs[] }).members.length > 0 &&
        (m.shape as { members: Abs[] }).members.every(numberLike));
    if (
      (mayBeNumber(a0) ||
        (a0.shape.k === "sum" && (a0.shape as { members: Abs[] }).members.some(mayBeNumber))) &&
      !provenNonNegativeLength(a0)
    ) {
      recordMayThrow({
        kind: "RangeError",
        cause: "Array length may be invalid (negative or non-integer)",
      });
    }
    return abs(
      { k: "arr", element: numberLike(a0) ? undefAbs() : unknown },
      undefined,
      undefined,
      "partial",
    );
  }
  const nR = litValue(a0);
  const n = nR.ok ? nR.value : undefined;
  if (typeof n === "number") {
    if (!Number.isInteger(n) || n < 0 || n > 4294967295) {
      throw new NudoThrow(errorTypeAbs("RangeError"));
    }
    if (n > TUPLE_MATERIALIZE_CAP) {
      // 合法但巨大：不物化巨 tuple——元素域仍可判定为 undefined（Bug 53，
      // 与字面量物化路径同口径：hole 读恒 undefined）
      return abs({ k: "arr", element: undefAbs() }, undefined, undefined, "partial");
    }
    const els = Array.from({ length: n }, () => undefAbs());
    const holes = Array.from({ length: n }, (_, i) => i);
    return abs(
      { k: "tuple", elements: els, holes: n > 0 ? holes : undefined },
      undefined,
      undefined,
      "exact",
    );
  }
  return abs({ k: "tuple", elements: [a0] }, undefined, undefined, "exact");
}

/** Array.from mapFn 抽象下标 fresh var 计数器（containers.ts abstractLen 的 len#N 同风格；无需 memo——每次调用的下标是同一值域的一次性 mint） */
let fromIdxSeq = 0;

/**
 * Array.from mapFn 的抽象下标 Abs（#176）：此前是裸 number（无 term 无
 * pred），`(_, i) => …` 里 i 的值域无界——`Array.from({length: n+1},
 * (_, i) => [i])` 的元素域被无界下标污染，连 ge(0) 都证不出。
 * 修复口径（规格事实，非假设）：ArrayFrom 逐位迭代保证 0 ≤ i <
 * ToLength(length)——mapFn 被调用当且仅当长度 ≥ 1。
 * - term = fresh var fromIdx#N；pred 至少挂 ge(t, 0)；
 * - 长度项可得且载体是 prim number 时再挂 lt(t, lengthTerm)：number 原值
 *   raw ≥ 0 时 ToLength 只减不增（trunc → max(·,0) → min(·,2^53-1)），故
 *   L = ToLength(raw) ≤ raw，i < L ≤ raw；raw < 0 或 NaN 时 L = 0、回调
 *   不发生（空真）。非 number 载体（obj/any/string 等 ToNumber 收敛与
 *   原值无保序关系）→ 只挂 ge(0)，保守；
 * - lit 长度走 tuple 物化路径（mapOne 收 numLit(i) 具体下标），不经此处。
 */
export function fromIdxAbs(lenTerm?: Term, lenNumeric = false): Abs {
  const t = v(`fromIdx#${fromIdxSeq++}`);
  const pred: Pred =
    lenNumeric && lenTerm ? and(ge(t, lit(0)), lt(t, lenTerm)) : ge(t, lit(0));
  return abs({ k: "prim", type: "number" }, t, pred, "path");
}

/**
 * Array.from / Array.fromAsync 共用的元素投影（Bug 24 抽出）。
 * Bug 51：array-like（obj）分支重写——
 * - closed obj + 具体 length：逐索引读槽（缺失 = undefined）→ 精确元组；
 * - length 字面量经 ToLength 折叠（"2" → 2、null → 0、NaN/"" → 0）；
 *   bigint 字面量 → ToNumber 定抛 TypeError；
 * - 抽象 length / open obj：长度不可判——元素域 = 数字索引槽值 join
 *   undefined（open obj 另并 unknown：未知键可为任意值）；
 * - 无 length 槽：closed → []；open → 按抽象长度处理。
 */
function evalArrayFrom(args: Abs[]): Abs {
  // Bug 56/57：Arguments / Proxy brand 剥层到内层靶（tuple/arr 元素面；
  // Proxy 迭代经靶 @@iterator 透明转发）。后续 a0 均按靶形态走
  if (
    args[0] &&
    typeof args[0] === "object" &&
    args[0].shape.k === "brand" &&
    (args[0].shape.name === "Arguments" || args[0].shape.name === "Proxy")
  ) {
    args = [args[0].shape.shape as Abs, ...args.slice(1)];
  }
  const a0 = args[0];
  // Array.from(iterable[, mapFn])：取可迭代物的元素，不是把实参整个当元素
  //（那是 Array.of 的语义）。mapFn 逐位应用 (el, i)——副作用必须落地：
  // 数组 hole 位置按迭代器 Get 语义 yield undefined（实槽）、字符串按
  // code point、Set/Map 走条目表、array-like 按 length 槽逐位读索引槽。
  // Bug 49：? GetMethod(mapFn) 前置校验（规范先于迭代——空接收者也要抛）：
  // 缺省/严格 undefined → 无 mapper；null/prim/非可调用 → 确定 TypeError；
  // any/unknown/抽象 → may TypeError
  validateCallableArg(args[1], "Array.from mapper may not be callable", {
    undefinedOk: true,
  });
  // Bug 28：receiver 经 GetMethod(items, @@iterator) → ToObject——nullish
  // 字面量/缺省 → 确定 TypeError；any/unknown/含 nullish 臂 union → may
  if (!a0 || isNullishLitAbs(a0)) throw new NudoThrow(errorTypeAbs("TypeError"));
  {
    const rk = a0.shape.k;
    if (
      rk === "any" ||
      rk === "unknown" ||
      (rk === "sum" && (a0.shape as { members: Abs[] }).members.some((m) => isNullishLitAbs(m)))
    ) {
      recordMayThrow({
        kind: "TypeError",
        cause: "Array.from receiver may not be iterable",
      });
    }
  }
  const mapFn = args[1];
  // 缺省 / 严格 undefined 字面量 ≡ 无 mapper（native Array.from(x, undefined)
  // 不抛——mapper undefined 则 mapping false；null/prim/闭 obj 已在上方
  // validateCallableArg 定抛）。此前对 undefined-lit Abs 误当 mapper 应用于
  // applyCallbackValue → 假抛 TypeError（TypedArray.from Bug 37 同款口径）。
  const hasMapFn = !!mapFn && !(mapFn.term?.op === "lit" && mapFn.term.value === undefined);
  // Bug 296：第三实参 thisArg（原生 Array.from(items, mapFn, thisArg)）——
  // 此前 mapOne 不传 thisVal ⇒ 回调的 this 恒 undefined ⇒ 回调体读
  // `this.k` 假抛 TypeError（"property 'k' on undefined"）、把计数器
  // 永远写成 0。数组 HOF 通道（invoke-arr.ts 的 callFn）同款传 thisVal。
  // 缺省（未给第三实参）⇒ undefined ≡ 旧行为（strict this）。
  const thisArg = args[2];
  const mapOne = (el: Abs, i: Abs): Abs => {
    if (!hasMapFn) return el;
    return applyCallbackValue(
      mapFn,
      [el, i],
      emptyEnv(),
      pTrue,
      defaultLeakBudget,
      thisArg,
    );
  };
  // 无 mapFn 时下标 Abs 被 mapOne 丢弃——不 mint fresh var（零开销占位）
  const idxOrDrop = (lenTerm?: Term, lenNumeric = false): Abs =>
    hasMapFn ? fromIdxAbs(lenTerm, lenNumeric) : unknown;
  if (isSetAbs(a0) || isMapAbs(a0)) {
    const els = isSetAbs(a0) ? setElementsAbs(a0) : mapEntriesAbs(a0);
    if (els.length === 0) {
      return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
    }
    let el = mapOne(els[0]!, numLit(0));
    for (let i = 1; i < els.length; i++) el = joinAbs(el, mapOne(els[i]!, numLit(i)));
    return abs({ k: "arr", element: el }, undefined, undefined, "path");
  }
  {
    // matchAll 迭代器：逐匹配项展开
    // Bug 54：生成器对象是消费——从当前位取剩余（drainGenElements），此后耗尽
    const mi = drainGenElements(a0) ?? matchIterElements(a0);
    if (mi) {
      // Bug 34：生成器对象的体内延迟异常在消费点重放（definite 抛 /
      // soft may-throw 重记）——Array.from 不再静默截断成前缀
      replayGenDeferred(a0);
      if (mi.length === 0) {
        return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
      }
      // R1b：exact 生成器视图（线性收集序列）→ 逐位映射重组 exact 元组
      //（越过 TUPLE_LITERAL_CAP——元素序列是权威数据，cap 只约束类型面；
      // 超大列表退 arr join 保 sound）
      if (genDrainViewOf(a0)?.exact === true && mi.length <= TUPLE_MATERIALIZE_CAP) {
        return abs(
          {
            k: "tuple",
            elements: mi.map((el, i) => mapOne(el, numLit(i))),
          },
          undefined,
          undefined,
          a0.conf,
        );
      }
      let el = mapOne(mi[0]!, numLit(0));
      for (let i = 1; i < mi.length; i++) el = joinAbs(el, mapOne(mi[i]!, numLit(i)));
      return abs({ k: "arr", element: el }, undefined, undefined, "path");
    }
  }
  const k = a0.shape.k;
  if (k === "arr") {
    // 抽象数组：单代表元素（索引未知）。arr shape 不携带长度面（元素域
    // 单代表，无 length 项可挂 lt）→ 下标只挂 ge(0)（迭代序号恒非负）。
    // 元素实参是域分发（跨读不同值）——标记（len-sharing.ts，#175 残留）
    const el = mapOne(markDomainShared(a0.shape.element), idxOrDrop());
    return abs({ k: "arr", element: el }, undefined, undefined, "path");
  }
  if (k === "tuple") {
    const els = a0.shape.elements;
    if (els.length === 0) return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
    let el = mapOne(els[0]!, numLit(0));
    for (let i = 1; i < els.length; i++) el = joinAbs(el, mapOne(els[i]!, numLit(i)));
    return abs({ k: "arr", element: el }, undefined, undefined, "path");
  }
  if (k === "prim" && (a0.shape as { type: string }).type === "string") {
    const svR = litValue(a0);
    const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
    if (sv !== undefined && hasMapFn && sv.length > 0) {
      const cps = [...sv]; // code points（surrogate pair 合并）
      let el = mapOne(strLit(cps[0]!), numLit(0));
      for (let i = 1; i < cps.length; i++) el = joinAbs(el, mapOne(strLit(cps[i]!), numLit(i)));
      return abs({ k: "arr", element: el }, undefined, undefined, "path");
    }
    return abs(
      { k: "arr", element: abs({ k: "prim", type: "string" }, undefined, undefined, "path") },
      undefined,
      undefined,
      "path",
    );
  }
  if (k === "obj") {
    // Bug 110：GetMethod(items, @@iterator) 先行——迭代器路径优先于
    // array-like（iterator beats length：node 实测 {...iterObj, length: 0}
    // 仍走迭代）。判定复用 iterabilityKind（iterate.ts——@@iterator 槽即
    // total，[...o] / for..of 的同款谓词），两个消费者口径一致。此前 obj
    // 臂只实现 array-like 半边：带 @@iterator 的对象被当零长 array-like 折
    // exact 空 tuple（wrong-exact）。非可调用字面量 → 原生 GetMethod
    // definite TypeError；可调用/抽象 → 迭代路径。
    // Bug 202：迭代路径**实际驱动**用户迭代器（此前只判可迭代、不调
    // @@iterator/next ⇒ 副作用整体丢失）；元素域与长度口径见下方分支。
    // optional 槽（可能缺席）按缺席处理——走 array-like 臂，不冒 definite
    // 假抛。生成器/模板标签等侧表迭代物已在上方 mi 臂精确处理，不受影响。
    if (iterabilityKind(a0) === "total") {
      const iterSlot = (a0.shape as unknown as {
        slots: Record<string, { value: Abs; optional?: boolean }>;
      }).slots["@@iterator"];
      const iterVal = iterSlot && !iterSlot.optional ? iterSlot.value : undefined;
      if (
        iterVal !== undefined &&
        !(iterVal.term?.op === "lit" && iterVal.term.value === undefined)
      ) {
        validateCallableArg(iterVal, "Array.from @@iterator may not be callable");
        // Bug 202：**驱动用户迭代器**（GetIterator + IteratorNext）——此前
        // 只判「可迭代」却不实际调 @@iterator/next ⇒ 迭代器体内的副作用
        // （计数 / 写状态）整体丢失，元素域折 unknown（wrong-exact 的 0）。
        // 走 elemsOf 同款协议（$elems：元素按**迭代序**取，步数上界同款）。
        const els = $elems(a0);
        // 迭代器报告 done ⇒ 元素数确切（registerUserIterLen 登记）⇒ exact
        // 元组（原生 Array.from 逐位产出，长度 = 迭代出的元素数）
        const exactLen = userIterLenOf(a0);
        if (exactLen !== undefined && els.length === exactLen) {
          return abs(
            { k: "tuple", elements: els.map((el, i) => mapOne(el, numLit(i))) },
            undefined,
            undefined,
            "exact",
          );
        }
        // 元素数不可知（迭代器未耗尽 / 非用户迭代器——引擎自建迭代器的
        // @@iterator 是空体占位）⇒ 元素域 = 已采集元素 join（未耗尽时 elemsOf
        // 已并入 unknown 兜底——剩余元素个数不可知，sound）
        let el = unknown;
        for (let i = 0; i < els.length; i++) el = joinAbs(el, mapOne(els[i]!, numLit(i)));
        return abs({ k: "arr", element: el }, undefined, undefined, "path");
      }
    }
    // Bug 51：array-like——length 槽决定迭代次数（ToLength 折叠），元素按
    // Get(i) 语义逐索引读槽（缺失 = undefined），不再硬编码 undefAbs()。
    const os = a0.shape as {
      slots?: Record<string, { value: Abs }>;
      open?: boolean;
      index?: unknown;
    };
    const slots = os.slots ?? {};
    const open = !!os.open || !!os.index;
    // Bug 294：array-like 读数**先经访问器侧表**——对象字面量的
    // `get length()` / `get 0()` 在 shape 里只留 `$lit(void 0)` 占位槽
    // （真 getter 住 accessorTable 侧表，见 accessors.ts）；裸读槽会把
    // length 当 undefined（ToLength → 0 ⇒ Array.from 折空数组）、把索引
    // 读成 undefined，且 getter 的副作用（计数 / 写状态）整体消失。
    // 原生 Array.from 每次**恰好**读一次 length 与每个索引 ⇒ 本处按
    // 「读一次」缓存（getter 副作用只发生一次，与原生同款）。
    const accCache = new Map<string, Abs | undefined>();
    const readKey = (key: string): Abs | undefined => {
      if (accCache.has(key)) return accCache.get(key);
      const v = accessorReadDomain(a0, key);
      accCache.set(key, v);
      return v;
    };
    const lenSlot = Object.prototype.hasOwnProperty.call(slots, "length")
      ? slots["length"]!.value
      : undefined;
    const lenAbs = readKey("length") ?? lenSlot;
    // ToLength(literal)：number/string/bool/null/undefined（null→0、
    // undefined→NaN→0）；bigint 字面量 → ToNumber 定抛 TypeError
    let nLit: number | undefined;
    let abstractLen = false;
    if (lenAbs === undefined) {
      if (open) abstractLen = true;
      else nLit = 0; // 无 length 槽：ToLength(undefined) = 0
    } else if (lenAbs.term?.op === "lit") {
      const v = lenAbs.term.value;
      if (typeof v === "bigint") throw new NudoThrow(errorTypeAbs("TypeError"));
      if (v === null) nLit = 0;
      else if (v === undefined) nLit = 0;
      else {
        const num = typeof v === "number" ? v : Number(v); // string/boolean
        if (Number.isNaN(num)) nLit = 0;
        else nLit = Math.min(Math.max(Math.trunc(num), 0), Number.MAX_SAFE_INTEGER);
        // Bug 104：array-like 臂的 ArrayCreate(ToLength(len)) 上限——
        // nLit > 2^32-1 → 定抛 RangeError（与 Array 构造器 4294967295
        // 上限同口径；node 实测 Array.from({length:2**32}) /
        // ({length:Infinity}) / ({length:1e10}) 均 RangeError
        // "Invalid array length"）
        if (nLit > 4294967295) throw new NudoThrow(errorTypeAbs("RangeError"));
      }
    } else if (isSymbolAbs(lenAbs)) {
      throw new NudoThrow(errorTypeAbs("TypeError")); // ToNumber(symbol) 定抛
    } else {
      // 抽象 length（prim number / obj / any…）：迭代次数不可判；obj/any
      // 载体 ToNumber may 抛（Symbol coercer）
      if (lenAbs.shape.k !== "prim" && mayCoerceThrowOperand(lenAbs)) {
        recordMayThrow({
          kind: "TypeError",
          cause: "Array.from array-like length ToNumber may throw (Symbol/BigInt)",
        });
      }
      abstractLen = true;
    }
    // 数字索引槽（obj 字面量数字键转字符串槽同口径）——**访问器优先**
    // （Bug 294）：`get 0()` 这类索引访问器的真值住侧表，槽里只是占位。
    const idxSlotAt = (i: number): Abs | undefined => {
      const key = String(i);
      const acc = readKey(key);
      if (acc !== undefined) return acc;
      return slots[key]?.value;
    };
    const allIdxSlotValues = (): Abs[] => {
      const out: Abs[] = [];
      const seen = new Set<string>();
      for (const kk of Object.keys(slots)) {
        if (!/^(0|[1-9][0-9]*)$/.test(kk)) continue;
        seen.add(kk);
        out.push(readKey(kk) ?? slots[kk]!.value);
      }
      // 有访问器但**无槽**的索引键（defineProperty 装的 getter）——补齐，
      // 否则抽象 length 臂的元素域丢掉这些值。
      for (const kk of accessorKeysOf(a0)) {
        if (seen.has(kk) || !/^(0|[1-9][0-9]*)$/.test(kk)) continue;
        const acc = readKey(kk);
        if (acc !== undefined) out.push(acc);
      }
      return out;
    };
    // Bug 104：抽象 length（open obj 缺槽 / 抽象 prim / obj·any 载体）的
    // ArrayCreate 上限不可判 → may RangeError（值域/迭代投影不变）
    if (abstractLen) {
      recordMayThrow({
        kind: "RangeError",
        cause: "Array.from array-like length may exceed the maximum array length",
      });
    } else {
      if (nLit === 0) return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
      if (!open && nLit! <= TUPLE_MATERIALIZE_CAP) {
        // closed obj：全部自有槽已知 → 逐位精确元组（Get(i)：缺失槽 undefined）
        const els: Abs[] = [];
        for (let i = 0; i < nLit!; i++) {
          els.push(mapOne(idxSlotAt(i) ?? undefAbs(), numLit(i)));
        }
        return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
      }
      // open obj / 超长具体 length：元素域 = 已知索引槽值 join undef
      //（open 的未知键另并 unknown——可为任意值）+ 槽位 < n 的已知槽。
      // 下标域 [0, nLit-1]（nLit 是 ToLength 折叠后的 lit）→ 挂双界；
      // 缺失槽臂的下标同用 iAbs（此前钉死 numLit(0)——`(_, i) => i` 会把
      // 元素域假折成全 0，真实下标可取 [1, nLit) 内任意位，不 sound）
      const iAbs = idxOrDrop(lit(nLit!), true);
      let el = mapOne(undefAbs(), iAbs);
      for (const vv of allIdxSlotValues()) el = joinAbs(el, mapOne(vv, iAbs));
      if (open) el = joinAbs(el, mapOne(unknown, iAbs));
      return abs({ k: "arr", element: el }, undefined, undefined, "path");
    }
    // 抽象 length：迭代次数未知——元素域 = 全部数字索引槽 join undefined
    //（open obj 另并 unknown）；mapFn 按抽象数组口径单代表元素 + 抽象索引。
    // #176：下标携带 0 ≤ i < ToLength(length)——长度槽值带项且载体是
    // prim number 时挂 lt(t, lenTerm)（见 fromIdxAbs 的 soundness 注释），
    // 其余（无项 / obj / any 载体）只挂 ge(0)
    const lenT = lenAbs?.term;
    const lenNum =
      !!lenT &&
      lenAbs!.shape.k === "prim" &&
      (lenAbs!.shape as { type: string }).type === "number";
    const idxValues = allIdxSlotValues();
    let el = idxValues.length > 0 ? idxValues.reduce((x, y) => joinAbs(x, y)) : undefAbs();
    el = joinAbs(el, undefAbs());
    if (open) el = joinAbs(el, unknown);
    // 元素实参是域分发（缺失/未知槽 join 域）——标记（#175 残留）
    el = mapOne(markDomainShared(el), idxOrDrop(lenT, lenNum));
    return abs({ k: "arr", element: el }, undefined, undefined, "path");
  }
  return unknown;
}

/** Array.isArray / Array.from / Array.of */
export function evalArrayStatic(name: string, args: Abs[]): Abs | undefined {
  const a0 = args[0];
  switch (name) {
    case "isArray": {
      if (!a0) return boolLit(false);
      // Array.prototype 本身是数组 exotic（原生 Array.isArray(Array.prototype) === true）
      if (a0.shape.k === "brand" && a0.shape.name === "Array.prototype") return boolLit(true);
      // Bug 56：arguments 对象不是数组 exotic——brand "Arguments" 包 tuple
      // 内层（$arguments），peelBrand 会看到 tuple，须在剥层前判定 false
      if (a0.shape.k === "brand" && a0.shape.name === "Arguments") return boolLit(false);
      // Bug 195：**数组视图标注**的对象是数组 exotic——原生
      // GetTemplateObject = CreateArrayFromList + SetIntegrityLevel(frozen)
      // ⇒ 标签模板对象是**冻结的数组**（`Array.isArray(s)` 恒 true）；RegExp
      // exec/match 结果同款（原生亦是真数组）。标注机制与 json.ts 的数组
      // 序列化面同源（markMatchArrayView）。
      if (isMatchArrayView(a0)) return boolLit(true);
      // Bug 57：Proxy 剥 brand 即靶形态（ArrayCreate 保留靶 IsArray 槽）
      const s = peelBrand(a0.shape);
      if (s.k === "arr" || s.k === "tuple") return boolLit(true);
      // any/unknown/sum 可能是数组（sum 成员可含 arr/tuple）。下 `false` 结论
      // 会让 `if (Array.isArray(x))` 错误剪掉真分支（soundness bug）→ 诚实 unknown。
      if (s.k === "any" || s.k === "unknown" || s.k === "sum") return boolPrim();
      return boolLit(false);
    }
    case "of":
      // Array.of 把全部实参打包成数组元素——不是 Array(n) 的空洞语义：
      // Array.of() → []、Array.of(7) → [7]、Array.of(1,2,3) → [1,2,3]
      return abs(
        { k: "tuple", elements: args.map((a) => asAbs(a) ?? unknown) },
        undefined,
        undefined,
        "exact",
      );
    case "from":
      return evalArrayFrom(args);
    case "fromAsync": {
      // Bug 24：ES2024 Array.fromAsync —— 引擎无微任务求值通道（逐元素
      // await 的 resolve 时刻晚于同步求值），值域取最小可判定面：同步
      // 投影（= from 的元素域）再逐元素解 thenable（fromAsync 与
      // Promise.all 同款 await 语义，from 不解），包 promise 域。
      const sync = evalArrayFrom(args);
      const unwrapEl = (el: Abs): Abs =>
        el.shape.k === "eff" && el.shape.eff === "promise" ? el.shape.inner : el;
      // R3：逐元素 await 的拒绝面（eff 元素 rejected/unsettled 通道在 unwrap
      // 中丢失 / thenable 风险元素）→ 结果 unsettled
      const elRisky = (el: Abs): boolean =>
        (el.shape.k === "eff" &&
          el.shape.eff === "promise" &&
          ((el.shape as { rejected?: Abs }).rejected !== undefined ||
            (el.shape as { unsettled?: boolean }).unsettled === true)) ||
        thenableRiskOf(el);
      let risky = sync.shape.k !== "tuple" && sync.shape.k !== "arr" && thenableRiskOf(sync);
      const noteRisk = (el: Abs): void => {
        if (elRisky(el)) risky = true;
      };
      const mark = (el: Abs): Abs => {
        noteRisk(el);
        return unwrapEl(el);
      };
      const inner =
        sync.shape.k === "tuple"
          ? abs(
              { k: "tuple", elements: sync.shape.elements.map(mark) },
              undefined,
              undefined,
              "path",
            )
          : sync.shape.k === "arr"
            ? (noteRisk(sync.shape.element),
              abs({ k: "arr", element: unwrapEl(sync.shape.element) }, undefined, undefined, "path"))
            : sync;
      // R2b：fromAsync 每次调用产出新 promise 对象——打新鲜实例标
      return markFreshInstance(
        abs(
          { k: "eff", eff: "promise", inner, ...(risky ? { unsettled: true } : {}) },
          undefined,
          undefined,
          "path",
        ),
      );
    }
    default:
      return undefined;
  }
}

/**
 * Bug 36：join/toString 逐元素 ToString 校验（$invoke join 分支与一等 join 共用）：
 * symbol 元素 → 确定 TypeError（hard）；any/真 unknown/含 symbol 臂 union 元素 →
 * may TypeError。hole 位跳过（→ ""，ToString 不触发）。合法路径值域不变。
 */
export function validateJoinElements(recv: Abs): void {
  const s = recv.shape;
  const isTuple = s.k === "tuple";
  const holes = isTuple ? (s as { holes?: number[] }).holes ?? [] : [];
  const els = isTuple
    ? (s as { elements: Abs[] }).elements
    : s.k === "arr"
      ? [s.element]
      : [];
  for (let i = 0; i < els.length; i++) {
    if (holes.includes(i)) continue;
    const el = els[i]!;
    if (isSymbolAbs(el)) throw new NudoThrow(errorTypeAbs("TypeError"));
    const k = el.shape.k;
    if (
      k === "any" ||
      (k === "unknown" && el.term?.op !== "lit") ||
      (k === "sum" && (el.shape as { members: Abs[] }).members.some((m) => isSymbolAbs(m)))
    ) {
      recordMayThrow({
        kind: "TypeError",
        cause: "array join element may be a symbol (ToString throws)",
      });
    }
  }
}

/**
 * Array.prototype.toString = join(",")：全字面量元素折叠；含 symbol 元素 TypeError。
 * 与 exec/class.ts $invoke 的 toString 分支同口径（.call 路径共用）。
 */
export function arrayJoinToString(recv: Abs): Abs {
  const s = recv.shape;
  if (s.k === "tuple") {
    validateJoinElements(recv);
    const holes = s.holes ?? [];
    const parts: string[] = [];
    for (let i = 0; i < s.elements.length; i++) {
      if (holes.includes(i)) {
        parts.push("");
        continue;
      }
      const el = s.elements[i]!;
      if (isSymbolAbs(el)) throw new NudoThrow(errorTypeAbs("TypeError"));
      const t = el.term;
      if (t?.op !== "lit") return str();
      const v = t.value;
      if (v === null || v === undefined) parts.push("");
      else if (typeof v === "object") return str();
      else parts.push(String(v));
    }
    return strLit(parts.join(","));
  }
  return str();
}

/**
 * Array.prototype.join(sep)：字面量分隔符 + 全字面量元组 → 精确折叠。
 * 返回 undefined = 不可折叠（调用方保守 path-string）。分隔符分类按原生
 * ToString：absent/undefined ≡ ","；null → "null"；string/number/boolean/bigint
 * 字面量 → String(v)；symbol prim → 确定 TypeError；any → may TypeError
 * （可能是 Symbol）且不折叠；对象/抽象 → 不折叠。
 * 元素侧与 arrayJoinToString 同口径（hole → ""，nullish → ""，symbol →
 * 确定 TypeError，非 lit → 不折叠）。
 */
export function arrayJoinWithSep(
  recv: Abs,
  sepAbs: Abs | undefined,
): Abs | undefined {
  const s = recv.shape;
  if (s.k !== "tuple") return undefined;
  let sep: string;
  if (sepAbs === undefined) {
    sep = ",";
  } else if (isSymbolAbs(sepAbs)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  } else if (sepAbs.shape.k === "any") {
    recordMayThrow({
      kind: "TypeError",
      cause: "join separator ToString of abstract operand",
    });
    return undefined;
  } else {
    const r = litValue(sepAbs);
    if (!r.ok) return undefined;
    const v = r.value;
    if (v === undefined) sep = ",";
    else if (v === null) sep = "null";
    else if (typeof v === "object") return undefined;
    else sep = String(v);
  }
  validateJoinElements(recv);
  const holes = s.holes ?? [];
  const parts: string[] = [];
  for (let i = 0; i < s.elements.length; i++) {
    if (holes.includes(i)) {
      parts.push("");
      continue;
    }
    const el = s.elements[i]!;
    if (isSymbolAbs(el)) throw new NudoThrow(errorTypeAbs("TypeError"));
    const t = el.term;
    if (t?.op !== "lit") return undefined;
    const v = t.value;
    if (v === null || v === undefined) parts.push("");
    else if (typeof v === "object") return undefined;
    else parts.push(String(v));
  }
  return strLit(parts.join(sep));
}

/** Array.prototype.toString / toLocaleString / join 一等函数（bindThis 注入 receiver） */
export function arrayMethodAbs(name: "toString" | "toLocaleString" | "join"): Abs {
  return absFunction(["thisArg"], {
    body: noBody,
    bindThis: true,
    apply: (a) => {
      // Bug 330：接收者为 **nullish**（null / undefined）⇒ 原生 ToObject
      // 定抛 TypeError（"Cannot convert undefined or null to object"）。
      // 此前 `a[0] ?? undefAbs()` 把 nullish 接收者**静默替换**成
      // undefined 值 ⇒ brand 判定（ToObject）从未发生 ⇒ 引擎全程不记
      // 抛 ⇒ L2 门禁假绿（同一个 Array.prototype 上 slice / indexOf /
      // map 却正确报红——自相矛盾）。
      const recv = a[0];
      if (recv === undefined || isNullishLitAbs(recv)) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      // join 带可选分隔符：字面量分隔符 + 全字面量元组精确折叠，其余
      // 保守 path string（与 $invoke 同口径）。Bug 36：一等 join 路径
      // 同样逐元素校验（symbol 确定 TypeError / 抽象 may）
      if (name === "join") {
        const folded = arrayJoinWithSep(recv, a[1]);
        if (folded !== undefined) return folded;
        validateJoinElements(recv);
        return str();
      }
      return arrayJoinToString(recv);
    },
  }, { ctor: false }); // Bug 9：内建原型方法不可 new
}
