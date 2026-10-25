/**
 * RegExp 构造 / brand / 实例方法
 *
 * Invariants:
 * - RegExpExecArray 原生是**数组 exotic**（IsArray = true，继承
 *   Array.prototype）⇒ 匹配结果既有**数组方法面**（join / slice / map…，
 *   经 markMatchArrayView 侧表 + 数组方法派发），也有**可迭代面**
 *   （spread / for-of / 数组解构）。后者经「@@iterator 槽（非枚举）+
 *   元素侧表」给出（Bug 290）——形状仍是 obj（容器 arr/tuple 无侧槽，
 *   #136 的槽读面依赖它）。
 */
import type { Abs, Shape } from "../abs.ts";
import { abs, litValue, numLit, strLit, boolLit, unknown } from "../abs.ts";
import { objOf, setSlot } from "../objects.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { pTrue } from "../pred.ts";
import { boolPrim, str, mayCoerceThrowOperand, noBody } from "./shared.ts";
import { setPropFlags } from "./invariants.ts";
import { isSymbolAbs } from "../symbol-id.ts";
import { absFunction } from "../abs-fn.ts";
import { registerTplElements } from "../exec/match-iter.ts";

export function evalRegExpCtor(args: Abs[]): Abs {
  // 字面量实参真构造验证（非法 pattern/flags 硬抛）；抽象/RegExp 实例保守
  // Bug 58：抽象 pattern 也带全槽（source/flags/lastIndex + 7 标志 getter），
  // 字面量 flags 实参（已由 tryMakeRegexAbs 校验）保留精确折叠
  return tryMakeRegexAbs(args) ?? pathRegExpBrand(literalFlagsOf(args[1]));
}

/** 字面量 flags 实参的规范形式（合法性已由 tryMakeRegexAbs 先行校验/抛出；
 *  抽象/缺省 → undefined）。宿主构造一次取规范序（"ig" → "gi"）。 */
function literalFlagsOf(fAbs: Abs | undefined): string | undefined {
  if (!fAbs || fAbs.term?.op !== "lit") return undefined;
  const vR = litValue(fAbs);
  const v = vR.ok ? vR.value : undefined;
  const s = v === undefined ? "" : String(v);
  try {
    return new RegExp("", s).flags;
  } catch {
    return s;
  }
}

/** 7 个标志 getter 槽（Bug 28）：由 flags 字符串折 boolean（原生 getter 同款） */
const REGEX_FLAG_SLOTS: ReadonlyArray<readonly [string, string]> = [
  ["global", "g"],
  ["ignoreCase", "i"],
  ["multiline", "m"],
  ["unicode", "u"],
  ["dotAll", "s"],
  ["sticky", "y"],
  ["hasIndices", "d"],
];

/**
 * RegExp brand 单一声明式槽构造（Bug 58 根治：字面量/抽象两路径共用）。
 * source：字面量 pattern → strLit；抽象 pattern → string 域（ToString 文本
 * 恒为字符串）。flags：字面量 flags → strLit（规范序）；抽象 → string 域。
 * lastIndex 恒 0（构造时）。7 标志 getter（Bug 28）：字面量 flags → 精确
 * boolean；抽象 → boolean 域。
 */
function regexpBrandSlots(source: Abs, litFlags: string | undefined): Record<string, { value: Abs }> {
  const slots: Record<string, { value: Abs }> = {
    source: { value: source },
    flags: { value: litFlags !== undefined ? strLit(litFlags) : str() },
    lastIndex: { value: numLit(0) },
  };
  for (const [name, ch] of REGEX_FLAG_SLOTS) {
    slots[name] = { value: litFlags !== undefined ? boolLit(litFlags.includes(ch)) : boolPrim() };
  }
  return slots;
}

function pathRegExpBrand(litFlags?: string): Abs {
  return abs(
    { k: "brand", name: "RegExp", shape: objOf(regexpBrandSlots(str(), litFlags)) },
    undefined,
    undefined,
    "path",
  );
}

/** RegExp brand：source/flags/lastIndex + 7 标志 getter 进 slots
 *  （evaluator evalRegExpCtor / $regex 共用；槽构造收敛于 regexpBrandSlots） */
export function regexBrandAbsFrom(pattern: string, flags: string): Abs {
  return abs(
    {
      k: "brand",
      name: "RegExp",
      shape: objOf(regexpBrandSlots(strLit(pattern), flags)),
    },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * new RegExp(pattern, flags) 字面量真构造验证（$new 与 evalRegExpCtor 共用）：
 * - 无参 → /(?:)/（原生 source 归一）
 * - symbol pattern/flags → 确定 TypeError（ToString 抛；shape 判定——Symbol()
 *   无 lit 项，原先的 lit 分支内检查是死代码，Bug 29/52）
 * - 非法 pattern / 非法 flags（含 number/null/boolean flags 的 ToString）
 *   → SyntaxError；合法 → 精确 brand（source/flags 取真构造结果）
 * - 抽象 pattern/flags → undefined（调用方保守）+ 档位打点（见各分支）：
 *   obj/fn/brand/sum/any → may TypeError（自定义 coercer 可能产 Symbol）；
 *   抽象 prim string pattern → ToString total（非法 pattern 的 SyntaxError
 *   面不计）；抽象 prim string flags → may SyntaxError；抽象 prim
 *   number/bool/bigint flags → ToString 恒非法 flags → 确定 SyntaxError
 *   （node 实测 new RegExp('a', 1n) → SyntaxError）
 */
export function tryMakeRegexAbs(args: Abs[]): Abs | undefined {
  const a0 = args[0];
  if (!a0) return regexBrandAbsFrom("(?:)", "");
  // Bug 29：pattern symbol → 确定 TypeError（原生先 ToString pattern）
  if (isSymbolAbs(a0)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const fAbs = args[1];
  // Bug 52：flags symbol → 确定 TypeError
  if (fAbs && isSymbolAbs(fAbs)) throw new NudoThrow(errorTypeAbs("TypeError"));
  // 字面量 flags 先真构造校验（非法 flags 与 pattern 无关恒抛——抽象 pattern
  // 也不得吞掉：new RegExp(x, "x") 原生确定 SyntaxError）
  let litFlags: string | undefined;
  let flagsAbstract = false;
  if (fAbs) {
    if (fAbs.term?.op !== "lit") {
      flagsAbstract = true;
    } else {
      const fvR = litValue(fAbs);
      const fv = fvR?.ok ? fvR.value : undefined;
      litFlags = fv === undefined ? "" : String(fv);
      try {
        new RegExp("", litFlags);
      } catch {
        throw new NudoThrow(errorTypeAbs("SyntaxError"));
      }
    }
  }
  if (a0.term?.op !== "lit") {
    // 抽象 pattern：RegExp brand 豁免（原生 species 构造不走 ToString）；
    // obj/fn/brand/sum/any → may TypeError；抽象 prim ToString total
    if (!isRegExpBrandAbs(a0)) {
      if (mayCoerceThrowOperand(a0) || a0.shape.k === "tuple" || a0.shape.k === "arr") {
        recordMayThrow({ kind: "TypeError", cause: "RegExp pattern ToString may throw (Symbol)" });
      }
    }
    if (flagsAbstract) noteAbstractFlags(fAbs);
    return undefined;
  }
  if (flagsAbstract) {
    noteAbstractFlags(fAbs);
    return undefined;
  }
  const pv = a0.term.value;
  try {
    // Bug 95：pattern 为 undefined（lit(undefined)）视作缺省模式（RegExpInitialize：
    // If pattern is undefined, let P be ""）——不得 String 化成 "undefined"；
    // null 保持 ToString → "null"（control）。flags 侧同口径（上方 litFlags）。
    const r = new RegExp(pv === undefined ? "" : String(pv), litFlags ?? "");
    return regexBrandAbsFrom(r.source, r.flags);
  } catch (e) {
    if (e instanceof SyntaxError) throw new NudoThrow(errorTypeAbs("SyntaxError"));
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

/** RegExp brand 判定（species 构造路径不走 ToString）。
 *  Bug 179：实参可能是自由标识符（宿主全局值）而非 Abs——读 .shape 前必须
 *  守门；methods.ts（IsRegExp 守卫 / replace pattern 合法臂）共用本实现。 */
export function isRegExpBrandAbs(
  x: Abs | undefined,
): x is Abs & { shape: Extract<Shape, { k: "brand" }> } {
  if (!x || typeof x !== "object" || !("shape" in (x as object))) return false;
  return x.shape.k === "brand" && (x.shape as { name?: string }).name === "RegExp";
}

/** 抽象 flags 档位打点（Bug 52） */
function noteAbstractFlags(fAbs: Abs | undefined): void {
  if (!fAbs) return;
  const k = fAbs.shape as { k?: string; type?: string };
  if (k.k === "prim") {
    if (k.type === "string") {
      recordMayThrow({ kind: "SyntaxError", cause: "RegExp flags may be invalid" });
    } else {
      // 抽象 number/bool/bigint：ToString 恒非法 flags → 确定 SyntaxError
      throw new NudoThrow(errorTypeAbs("SyntaxError"));
    }
    return;
  }
  if (mayCoerceThrowOperand(fAbs) || k.k === "tuple" || k.k === "arr") {
    recordMayThrow({ kind: "TypeError", cause: "RegExp flags ToString may throw (Symbol)" });
  }
}

/**
 * Bug 57：test/exec 的 subject ToString 校验（evalRegExpMethod 与 evaluator
 * execRegexBrand/$reStateCall 三面共用）：
 * - symbol-prim（无 lit 项）→ 确定 TypeError（node 实测 /a/.test(Symbol()) 抛）
 * - 字面量 / 抽象 prim（string/number/bool/bigint——1n ToString 合法）→ total
 * - obj/fn/brand/sum/any/unknown/tuple/arr（term 非 lit）→ may：自定义 coercer
 *   可能产 Symbol；数组 join 元素可能为 symbol（node 实测 /a/.test([Symbol()]) 抛）
 */
export function validateRegexSubjectArg(subject: Abs | undefined): void {
  if (!subject) return;
  if (isSymbolAbs(subject)) throw new NudoThrow(errorTypeAbs("TypeError"));
  if (subject.term?.op === "lit") return;
  if (subject.shape.k === "prim") return;
  recordMayThrow({ kind: "TypeError", cause: "RegExp test/exec subject ToString may throw (Symbol)" });
}

/**
 * Bug「match/exec 结果 JSON 视图」：RegExpExecArray 原生是 Array（IsArray
 * = true）——JSON.stringify 走 SerializeJSONArray：只见下标元素 0..n-1
 * （"abc".match(/b/) → ["b"]），index/input/groups 虽可枚举但非数组下标、
 * length 是数组 exotic 非枚举自有属性，均不进 JSON 面。
 * 容器侧 arr（{k:"arr", element}）无长度/侧槽、tuple 无命名侧槽（非下标
 * 键读折 undefined），形状维持 obj（m[0]/m.length/m.index/m.input/m.groups.x
 * 的槽读面 #136 依赖）；数组性经本 WeakSet 侧表标注，json.ts 序列化面
 * 消费（按下标槽 0..n-1 走数组序列化）。length 槽单挂 enumerable:false
 * （原生数组 length 是唯一非枚举自有属性——Object.keys/展开/assign 面）；
 * index/input/groups 保持可枚举（spec CreateDataProperty），且 groups 槽的
 * undefined 值维持差分 harness concrete() 整值盲区（skip 基线不动）。
 */
const matchArrayViews = new WeakSet<object>();

/** match 结果 Abs 标注数组视图（json.ts 按下标槽序列化为数组；具体/
 *  抽象两路径与 matchAll 迭代元素共用） */
export function markMatchArrayView(a: Abs): void {
  matchArrayViews.add(a);
}

/** match 结果 Abs 判定（json.ts 的 stringify 三消费点共用） */
export function isMatchArrayView(a: Abs): boolean {
  return matchArrayViews.has(a);
}

/**
 * Bug 290：匹配结果的**可迭代面**（原生 RegExpExecArray 是数组 exotic ⇒
 * 继承 Array.prototype[Symbol.iterator] ⇒ spread / for-of / 数组解构可
 * 展开下标序列）。
 *
 * 修前：结果只是「带下标槽的 obj」——迭代面按 obj 臂判 **definite 不可
 * 迭代** ⇒ `[...m]` / `for (const x of m)` / `const [a,b] = m` **定抛
 * TypeError**（原生全部正常返回 ⇒ 假抛 + L1/L2 假红）。
 *
 * 修法（同 Bug 195 的模板对象口径）：obj 形状 + **@@iterator 槽**（非枚举
 * ——原生该方法在原型上，自有槽只是引擎的投影面）+ **元素侧表**（下标
 * 序列）⇒ iterabilityKind 判 total、elemsOf 取到精确元素。
 */
function markArrayIterable(a: Abs, els: Abs[]): void {
  const slots = (a.shape as { slots: Record<string, { value: Abs }> }).slots;
  // 协议槽口径同生成器对象（exec/runtime/async.ts）：internal + symbolKey
  // ——枚举面 / gOPN / JSON 面不可见（原生该方法在 **原型**上，自有槽只是
  // 引擎的投影面）
  setSlot(slots, "@@iterator", {
    value: absFunction([], { body: noBody }, { ctor: false }),
    internal: true,
    symbolKey: true,
  } as { value: Abs; internal?: boolean; symbolKey?: boolean });
  // 非枚举：Object.keys / 展开 / assign 面不得见（原生数组的 length 与
  // Symbol.iterator 均非枚举自有属性）
  setPropFlags(a, "@@iterator", { enumerable: false });
  registerTplElements(a, els);
}

/** d 旗标（ES2022 hasIndices）捕获组区间 [start, end] → 精确二元元组 */
function indexPairAbs(pair: readonly [number, number]): Abs {
  return abs({ k: "tuple", elements: [numLit(pair[0]), numLit(pair[1])] }, undefined, undefined, "exact");
}

/** RegExpExecArray → Abs（Bug 11）：capture 下标槽（"0"/"1"…）+
 *  length/index/input/groups 附加属性，合并为带附加属性的对象 Abs。
 *  `m[0]`/`m[1]` 经 $idx 字面量下标读槽、`m.index`/`m.input`/`m.groups.g`
 *  经 $get 字符串键读槽；具名组 → groups 对象、无具名组 → undefined。
 *  d 旗标（Bug：indices 未建模 → m.indices 读折 never 假不可达）：宿主真实
 *  exec 结果带 indices（无 d 旗标时宿主不设该属性）→ 镜像为同构槽 obj：
 *  下标槽 = [start,end] 精确元组（未参与捕获组 undefined）、length、groups
 *  子对象（具名组 → 元组、未参与具名组 undefined、无具名组 → undefined）。
 *  仅真实 exec 结果到达本函数；抽象 regex / 抽象 subject 的 match 面不经
 *  此处——不为其发明 indices。 */
export function matchResultAbs(m: RegExpExecArray): Abs {
  const slots: Record<string, { value: Abs }> = {
    length: { value: numLit(m.length) },
    index: { value: numLit(m.index) },
    input: { value: strLit(m.input) },
  };
  // Bug 290：下标序列（迭代面元素侧表用——原生数组 exotic 的展开序）
  const els: Abs[] = [];
  for (let i = 0; i < m.length; i++) {
    const g = m[i];
    const v = g === undefined ? undefAbs() : strLit(g);
    slots[String(i)] = { value: v };
    els.push(v);
  }
  const named = m.groups;
  slots["groups"] = {
    value: named
      ? objOf(
          Object.fromEntries(
            Object.entries(named).map(([k, v]) => [
              k,
              { value: v === undefined ? undefAbs() : strLit(v) },
            ]),
          ),
        )
      : undefAbs(),
  };
  const indices = m.indices;
  // Bug 290：indices 镜像 obj 原生同为数组 exotic ⇒ 同样可迭代（下标元素侧表）
  const iels: Abs[] = [];
  if (indices) {
    const islots: Record<string, { value: Abs }> = {
      length: { value: numLit(indices.length) },
    };
    for (let i = 0; i < indices.length; i++) {
      const pair = indices[i];
      // lib 类型 [number, number]，但宿主对未参与捕获组实为 undefined
      const p = pair as readonly [number, number] | undefined;
      islots[String(i)] = { value: p ? indexPairAbs(p) : undefAbs() };
      iels.push(p ? indexPairAbs(p) : undefAbs());
    }
    const igroups = indices.groups as Record<string, readonly [number, number] | undefined> | undefined;
    islots["groups"] = {
      value: igroups
        ? objOf(
            Object.fromEntries(
              Object.entries(igroups).map(([k, v]) => [
                k,
                { value: v ? indexPairAbs(v) : undefAbs() },
              ]),
            ),
          )
        : undefAbs(),
    };
    slots["indices"] = { value: abs({ k: "obj", slots: islots }, undefined, undefined, "exact") };
  }
  const result = abs({ k: "obj", slots }, undefined, undefined, "exact");
  // Bug「match/exec 结果 JSON 视图」：原生 Array——JSON.stringify 按下标槽
  // 走数组序列化（["b"]）；length 是唯一非枚举自有属性（index/input/groups
  // 原生可枚举、但非数组下标不进 JSON 面）。indices 镜像 obj 原生同为
  // Array，一并标注
  setPropFlags(result, "length", { enumerable: false });
  markMatchArrayView(result);
  // Bug 290：可迭代面（原生数组 exotic）——@@iterator 槽 + 下标元素侧表
  markArrayIterable(result, els);
  const indicesAbs = slots["indices"]?.value;
  if (indicesAbs) {
    setPropFlags(indicesAbs, "length", { enumerable: false });
    markMatchArrayView(indicesAbs);
    // indices 镜像 obj 原生同为数组 exotic ⇒ 同样可迭代
    markArrayIterable(indicesAbs, iels);
  }
  return result;
}

export function evalRegExpMethod(name: string, recv: Abs, args: Abs[]): Abs | undefined {
  if (name === "test" || name === "exec") {
    // Bug 57：subject ToString 校验（shape 先于 litValue 提取）
    validateRegexSubjectArg(args[0]);
    // 字面量 brand（source/flags 槽）+ 字面量 subject → 真执行（与 evaluator 同轨）
    const inner =
      recv.shape.k === "brand" && recv.shape.name === "RegExp"
        ? recv.shape.shape
        : undefined;
    const slots = inner && inner.shape.k === "obj" ? inner.shape.slots : undefined;
    const patR = slots ? litValue(slots["source"]?.value) : undefined;
    const pat = patR?.ok ? patR.value : undefined;
    const flagsVR = slots ? litValue(slots["flags"]?.value) : undefined;
    const flagsV = flagsVR?.ok ? flagsVR.value : undefined;
    const subjectR = args[0] ? litValue(args[0]) : undefined;
    const subject = subjectR?.ok ? subjectR.value : undefined;
    if (typeof pat === "string" && typeof subject === "string") {
      try {
        const re = new RegExp(pat, typeof flagsV === "string" ? flagsV : "");
        if (name === "test") return boolLit(re.test(subject));
        const m = re.exec(subject);
        if (!m) return abs({ k: "unknown" }, { op: "lit", value: null }, pTrue, "exact");
        return matchResultAbs(m);
      } catch {
        return undefined;
      }
    }
    return name === "test" ? boolPrim() : unknown;
  }
  return undefined;
}
