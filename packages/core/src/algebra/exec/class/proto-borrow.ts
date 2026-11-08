/**
 * 内建原型方法的**借用调用**派发域（自 invoke.ts 拆出）：setProtoMethodDispatch
 * 的注册回调——用户类方法值摘下 / 借用（Bug 193/196）、内建原型自有写
 * （Bug 208）、brand 检查（Bug 108/256/261）、String.prototype 与
 * Error.prototype 的 generic 语义、Array.prototype 的 generic 数组算法
 * （Bug 254/259/262/267/268）。
 *
 * Invariants:
 * - 注册语句在本模块体**加载期**执行且**直接 import hooks 叶子**（不经
 *   member.ts / containers barrel 的再导出行——环参与方在环上尚未执行到
 *   re-export 行时经它拿 undefined：runtime-sentinel-regress 的加载序事故
 *   形态）。invoke.ts 对本文件作 side-effect import 保住既有加载序。
 * - 回调体内消费 invoke.ts 的 $invoke / isCallableValue / builtinProtoOwnSlot /
 *   PRIM_HOME_BRAND（函数声明提升 + invoke.ts 先于本文件求值；本文件顶层
 *   不触碰它们 ⇒ 环加载序安全）。
 * - 数组方法（map/filter/reduce/…）委派 invokeArrMethod（invoke-arr.ts）；
 *   mutator（push/pop/…）自 Bug 49/51 起统一经 $invoke 的 $arrMutContainer
 *   就地变更（transpile 语句/表达式位不再有独立快路径），元素域语义单一
 *   入口（issue #153：SpreadElement 折 $unknown 的教训）。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown, litValue, strLit, isBigPrim } from "../../abs.ts";
import { isSymbolAbs, evalArrayStatic } from "../../builtins.ts";
import { isErrorCtorName } from "../../builtins/error.ts";
import { isNullishLitAbs } from "../../surface.ts";
// 数组 mutator 名——发射面/执行面共享的**唯一事实源**（不得本地重抄）。
import { ARR_MUTATORS } from "../method-names.ts";
import { $get, $lit, NudoThrow } from "../runtime.ts";
import { $call } from "../call.ts";
import { noteEvalCallRecord } from "../calls.ts";
import { errorTypeAbs, throwPayloadOf, recordMayThrow } from "../may-throw.ts";
import { privateNameGuard } from "../runtime/containers.ts";
import { getEvalClass, classSpecOfAbs, classNameOfValue } from "../class-registry.ts";
import { findMethod, findStaticMethod } from "./declare.ts";
import { invokeArrMethod } from "./invoke-arr.ts";
import { $invoke, isCallableValue, builtinProtoOwnSlot, PRIM_HOME_BRAND } from "./invoke.ts";
// 直连 hooks 叶子（不经 member.ts / containers barrel）：本模块体加载期即
// 回调本 setter——环上 member.ts 未执行到其 re-export 行时经它会拿到
// undefined；hooks 零依赖，链接期即已可用。
import { setProtoMethodDispatch, type ClassMethodOrigin } from "../hooks.ts";

// ---------------------------------------------------------------------------
// Bug 49/56「方法值读」通道的调用派发（containers.protoMethodValueAbs 注册）。
// home = 值属主（prim 类型名 / 构造器名）；借用调用（v() / v.call(recv,…) /
// v.apply / v.bind）按接收者走**既有**方法调用机器，不复制派发逻辑：
// - prim / brand home → $invoke（callAbsMethod 的 prim 面 /
//   evalBuiltinInstanceMethod·execRegexBrand 的 brand 面；this 缺省按
//   strict undefined 接收者 → 原生 TypeError 面随 $invoke 记账）；
// - Array home + array-like 接收者（字符串 / 闭 obj）→ Array.from 物化
//   （字符 / 索引槽，Bug 51 面）后走数组派发（slice.call('abc') →
//   ["a","b","c"]）；不可物化形态 → unknown（不折假值）。
// ---------------------------------------------------------------------------
// Bug 108：brand-checking 内建原型表 + 借用调用接收者 brand 判定
//
// Bug 256（ES2023 §22.1.3）：`String.prototype` 上**只有** `toString` /
// `valueOf` 要品牌检查（thisStringValue），其余 30 个方法都是 **generic**
// （RequireObjectCoercible + ToString）⇒ 整条把 "String" 列进本表会让借用
// 调用定抛 TypeError（原生 `String.prototype.toUpperCase.call(1)` → "1"）。
// ⇒ 表分两层：BRAND_CHECK_PROTOS（整个原型都要品牌）+ BRAND_CHECK_METHODS
// （只有列出的方法要品牌；未列方法按 generic 走）。
//
// Bug 261：`Error.prototype.toString` 是**普通方法**（无品牌检查——只读
// this.name / this.message）⇒ Error 家族**不进**品牌检查面。
const BRAND_CHECK_PROTOS = new Set([
  "Number", "Boolean", "Symbol", "BigInt",
  "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet",
]);
/** 方法级品牌检查（proto 名 → 要品牌的方法名集合；未列方法 = generic） */
const BRAND_CHECK_METHODS: Record<string, ReadonlySet<string>> = {
  String: new Set(["toString", "valueOf"]),
};

/**
 * (home, method) 是否走品牌检查；是则返回**期望的接收者 brand 名**。
 *
 * 表驱动（Bug 256 / 261）：原型级表 → 方法级表 → prim home 映射。
 * 表外的 home（Object / Array / Error 家族 / 用户类）一律**不**品牌检查。
 */
function brandCheckBrandOf(home: string, name: string): string | undefined {
  if (BRAND_CHECK_PROTOS.has(home)) return home;
  if (BRAND_CHECK_METHODS[home]?.has(name)) return home;
  const mapped = PRIM_HOME_BRAND[home];
  if (mapped === undefined) return undefined;
  if (BRAND_CHECK_PROTOS.has(mapped)) return mapped;
  if (BRAND_CHECK_METHODS[mapped]?.has(name)) return mapped;
  return undefined;
}

/**
 * Array.prototype 的「就地操作并返回 this」方法（Bug 267）——与「返回新数组」
 * 的方法（slice / map / filter / concat / with / toSorted…）分族。
 *
 * 是共享 `ARR_MUTATORS` 的**真子集**：只有这四个 mutator 返回 this
 * （push/unshift → length、pop/shift → 元素、splice → 被删数组）。按共享表
 * 取交集推导，避免再手抄一份名单（共享表增删自动生效）。
 */
const ARRAY_INPLACE_METHODS = new Set(
  ["sort", "reverse", "fill", "copyWithin"].filter((n) => ARR_MUTATORS.has(n)),
);
/** 接收者 brand；不可判（any/unknown/sum/Proxy 陷阱壳）→ undefined（不抛）。
 *  nullish 字面量 → "nullish"（与一切 brand 不匹配，定抛）。 */
function borrowedRecvBrandOf(recv: Abs): string | undefined {
  if (isNullishLitAbs(recv)) return "nullish";
  const s = recv.shape;
  if (s.k === "prim") return PRIM_HOME_BRAND[s.type];
  if (s.k === "brand") return s.name === "Proxy" ? undefined : s.name;
  if (s.k === "arr" || s.k === "tuple") return "Array";
  if (s.k === "fn") return "Function";
  if (s.k === "obj") return "Object";
  if (s.k === "eff") return s.eff === "promise" ? "Promise" : "Generator";
  return undefined;
}

/**
 * Bug 256：generic String 方法的接收者 **ToString** 投影（ES2023 §22.1.3：
 * RequireObjectCoercible(this) + ToString(this)）。
 *
 * - string prim → 自身；
 * - number / boolean / bigint **字面量** → 精确字符串（`toUpperCase.call(1)`
 *   原生 "1"）；
 * - symbol prim → ToString 恒抛 TypeError（原生同）；
 * - 其它（对象 / 抽象 prim）→ ToPrimitive 结果不可判 ⇒ 抽象 string prim。
 */
function genericStringRecv(recv: Abs): Abs {
  const s = recv.shape;
  if (s.k === "prim") {
    const t = (s as { type?: string }).type;
    if (t === "string") return recv;
    if (t === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    const lv = litValue(recv);
    if (lv.ok && lv.value !== null && lv.value !== undefined) {
      const v = lv.value;
      if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
        return strLit(String(v));
      }
    }
  }
  return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
}

/**
 * Bug 261：`Error.prototype.toString` 的 **generic** 语义（ES2023 §20.5.2.2）——
 * 无品牌检查：只读 this.name / this.message（缺省 "Error" / ""）⇒ 可借用给
 * 任意**对象**接收者（原生 `Error.prototype.toString.call({name:"X",message:"y"})`
 * → "X: y"）。
 *
 * 原始值接收者原生定抛 TypeError（V8 / node：`Error.prototype.toString called on
 * incompatible receiver`——该方法要求 this 是对象）。
 *
 * @param part 单个属性的取值投影：string = 精确值；null = 缺席 / undefined
 *   （走缺省）；undefined = 不可判（抽象值）。
 */
function errorToStringPart(part: Abs | undefined): string | null | undefined {
  if (part === undefined) return null;
  const lv = litValue(part);
  if (!lv.ok) return undefined;
  const v = lv.value;
  if (v === undefined) return null;
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return undefined;
}

/** Bug 261：generic Error.prototype.toString 的实现（只读 name / message 两槽）。 */
function genericErrorToString(recv: Abs): Abs {
  if (recv.shape.k === "prim" || isNullishLitAbs(recv)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const namePart = errorToStringPart($get(recv, "name", { silent: true }));
  const msgPart = errorToStringPart($get(recv, "message", { silent: true }));
  if (namePart === undefined || msgPart === undefined) {
    // 抽象取值 → 不可判 ⇒ 抽象 string（不折假值）
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  const name = namePart === null ? "Error" : namePart;
  const msg = msgPart === null ? "" : msgPart;
  // ES2021+ / V8：名空 → 只回消息；消息空 → 只回名；否则 "name: msg"
  if (name === "") return strLit(msg);
  if (msg === "") return strLit(name);
  return strLit(`${name}: ${msg}`);
}

/** Error 家族实例（brand）——沿既有 brand 面（"Error: m"），不走 generic 路。 */
function isErrorBrandRecv(recv: Abs): boolean {
  return recv.shape.k === "brand" && isErrorCtorName(recv.shape.name);
}

/**
 * 接收者是否**数组 exotic**（IsArray(O) 为真）——Bug 262：`concat` 只在
 * IsArray(O) 为真时才展开 this；`Array.prototype` 本身是数组 exotic
 * （其 length 为 0）⇒ 走数组派发而非「整体作为元素」。
 */
function isArrayExoticRecv(recv: Abs): boolean {
  return recv.shape.k === "brand" && recv.shape.name === "Array.prototype";
}

// ---------------------------------------------------------------------------
// Bug 193/196：用户类方法值的**摘下 / 借用**调用——按「方法体 + this = 接收者」
// ---------------------------------------------------------------------------
/**
 * Bug 193/196：用户类方法体定位——**按方法体**（注册表的实例 / 静态方法记录），
 * **不按接收者的成员表反查被调用者**。
 *
 * 原生：方法值是**函数**，`m()` / `m.call(recv)` 跑的就是那个函数体，
 * `this` = 调用位给的接收者（摘下调用时 `this` 恒 undefined）。此前派发按
 * `$invoke(recv, name, args)`——即**在接收者的成员表里反查同名方法**⇒
 * 接收者不是本类实例时（外来对象 / undefined）一律「取不到方法」⇒ 假抛
 * TypeError（FALSE-THROW）：`const m = new A().m; m()` 原生恒不抛。
 *
 * 静态 / 实例同名并存时按接收者形态定夺（类值 → 静态体；实例 → 实例体）；
 * 两者并存且接收者形态不可判（外来对象 / undefined）⇒ 不可判（返回
 * undefined，交回通用派发面保守处理，不猜）。
 */
function userClassMethodBody(
  home: string,
  name: string,
  recv: Abs,
  origin?: ClassMethodOrigin,
): ((thisVal: Abs, ...args: Abs[]) => Abs) | undefined {
  if (!getEvalClass(home)) return undefined;
  // BUG-172 继承链图化：接收者随身规格作首环身份（名字吻合才用——外来
  // 接收者 / 摘下调用不误绑），其余环沿 superSpec 引用链。
  const rs = classSpecOfAbs(recv);
  const instBody = findMethod(home, name, rs);
  const statBody = findStaticMethod(home, name, rs);
  if (!instBody && !statBody) return undefined;
  if (instBody && statBody) {
    // Bug 1041：同名 static + 实例方法并存时，**方法值的来源侧**是决定
    // 依据（原生：`A.m` 取到的是构造器上的**静态**方法、`a.m` 取到的是
    // 原型上的**实例**方法——两个不同函数对象）。来源侧随方法值传到派发
    // 面（member.ts 的 classMethodValueAbs → protoMethodDispatch 的
    // origin 参数）⇒ 摘下调用（接收者恒 undefined）不再「不可判」
    // ⇒ 此前一律折「取不到方法」⇒ 假抛 TypeError（FALSE-THROW）。
    if (origin === "static") return statBody;
    if (origin === "inst") return instBody;
    const clsName = classNameOfValue(recv as object);
    if (clsName !== undefined) return statBody; // 类值接收者 → 静态体
    if (recv.shape.k === "brand") return instBody; // 实例接收者 → 实例体
    return undefined; // 形态不可判（外来对象 / undefined 接收者）
  }
  return instBody ?? statBody;
}

setProtoMethodDispatch((home, name, thisVal, args, origin) => {
  const recv: Abs = thisVal ?? $lit(undefined);
  // Bug 193/196：用户类方法值（classMethodValueAbs 产物）的摘下 / 借用调用
  // ——按**方法体 + this = 接收者**执行（原生：方法值是函数，调用它就跑那个
  // 函数体；this = 调用位给的接收者，摘下调用时恒 undefined）。此前按接收者
  // 的成员表反查被调用者（$invoke(recv,name,args)）⇒ 非本类实例的接收者
  // 一律「取不到方法」⇒ 假抛 TypeError（FALSE-THROW）。
  {
    const body = userClassMethodBody(home, name, recv, origin);
    if (body) {
      // 私有名（#m）：接收者 brand 校验（原生 PrivateCall——接收者须是
      // 声明类实例）
      privateNameGuard(recv, name);
      let result: Abs = unknown;
      let threw = false;
      try {
        result = body(recv, ...args);
        return result;
      } catch (e) {
        threw = true;
        result = throwPayloadOf(e);
        throw e;
      } finally {
        noteEvalCallRecord({ fnName: `${home}.${name}`, args, result, threw });
      }
    }
  }
  // Bug 208：内建原型对象上的**自有写**优先于内建方法表——`Array.prototype
  // .push = fn` 后 `Array.prototype.push.call(arr, x)` 走用户写的 fn；改成
  // 非函数则定抛 TypeError（原生 `X.prototype.m is not a function`）。
  {
    const own = builtinProtoOwnSlot(home, name);
    if (own !== undefined) {
      if (!isCallableValue(own)) throw new NudoThrow(errorTypeAbs("TypeError"));
      return $call(own, args, recv);
    }
  }
  // Bug 108：brand-checking 内建原型的借用调用——home 与接收者 brand 不匹配
  // 定抛 TypeError（原生 thisNumberValue/thisStringValue/… 前置校验：
  // Number.prototype.valueOf.call("5") 折 "5" 是假精确）。Object.prototype
  // （任意接收者合法）与 Array.prototype（上方物化 array-like）保持泛型。
  // Proxy 接收者（get/apply 陷阱可换壳）与 any/unknown/sum 不可判 → 不抛。
  // Bug 256 / 261：**表驱动**（brandCheckBrandOf）——String.prototype 上只有
  // toString / valueOf 要品牌（其余 30 个是 generic）；Error 家族不进品牌面
  // （Error.prototype.toString 是普通方法）。
  {
    const homeBrand = brandCheckBrandOf(home, name);
    if (homeBrand !== undefined) {
      const recvBrand = borrowedRecvBrandOf(recv);
      const ok = recvBrand === undefined || recvBrand === homeBrand;
      if (!ok) throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  // Bug 256：String.prototype 的 **generic** 方法（ES2023 §22.1.3）——
  // RequireObjectCoercible(this) + ToString(this) ⇒ 可借用给任何非 nullish
  // 接收者（原生 `String.prototype.toUpperCase.call(1)` → "1"；整条品牌检查
  // ⇒ 定抛 TypeError 假红）。品牌方法（toString / valueOf）已在上面定抛。
  if (
    (home === "String" || home === "string") &&
    !BRAND_CHECK_METHODS["String"]!.has(name)
  ) {
    const rs = recv.shape;
    const recvIsStr = rs.k === "prim" && (rs as { type?: string }).type === "string";
    if (!recvIsStr) {
      // nullish → RequireObjectCoercible 定抛（原生 TypeError）
      if (isNullishLitAbs(recv)) throw new NudoThrow(errorTypeAbs("TypeError"));
      // brand 接收者（装箱 String / 用户类实例 / Error 实例…）沿既有 brand 面
      if (rs.k !== "brand") {
        return $invoke(genericStringRecv(recv), name, args);
      }
    }
  }
  // Bug 261：Error.prototype.toString 是 **generic** 方法（无品牌检查）——
  // 只读 this.name / this.message ⇒ 借用给任意对象接收者（原生
  // `Error.prototype.toString.call({name:"X",message:"y"})` → "X: y"；
  // 此前整族进品牌检查面 ⇒ 定抛 TypeError 假红）。Error 实例沿既有 brand 面
  //（"Error: m"）。
  if (isErrorCtorName(home) && name === "toString" && !isErrorBrandRecv(recv)) {
    return genericErrorToString(recv);
  }
  if (home === "Array" && recv.shape.k !== "tuple" && recv.shape.k !== "arr") {
    const recvIsStrPrim =
      recv.shape.k === "prim" && (recv.shape as { type?: string }).type === "string";
    // Bug 259：mutator（push/pop/…）只在**字符串**接收者上原生定抛
    //（ToObject("ab") 的 length 不可写——node 实测
    // Array.prototype.push.call("ab",1) → TypeError: Cannot assign to read
    // only property 'length'）。其它原始值（number / boolean / bigint /
    // symbol）ToObject 后是**普通可扩展对象**（length 0）⇒ mutator 正常
    // 成功（node 实测 push.call(5,1) → 1、pop.call(5) → undefined）——此前
    // 一刀切定抛 ⇒ 假抛（L2 门禁假红）。读方法（slice/join/at/…）保持泛型。
    if (recvIsStrPrim && ARR_MUTATORS.has(name)) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // Bug 254（端到端接线）：mutator（push/pop/shift/…）在**数组样对象**接收者
    // （`{length, 0: …}`）上，原生是**就地改接收者**（写 length 与索引槽），
    // 返回值按数组语义算。此前本臂把接收者**物化成副本**再派发 ⇒ 写落副本 ⇒
    // `push.call({length:0},5)` 之后 `o.length` 仍 0、`o[0]` 仍 undefined。
    // ⇒ mutator 走**原接收者**（invokeArrMethod 的泛型接收者臂 → $arrMutContainer
    // → mutateArrayLike 就地写），其余读方法保持物化通道。
    if (ARR_MUTATORS.has(name) && recv.shape.k === "obj") {
      const direct = invokeArrMethod(recv, name, args);
      if (direct !== undefined) return direct;
    }
    // Bug 267：sort / reverse / fill / copyWithin 是「就地操作并返回 this」
    // ⇒ 非数组接收者上**返回接收者本身**（原生 `Array.prototype.sort.call({a:1})`
    // → {a:1}）；此前走物化通道 ⇒ 折成**空数组**（内容 + 身份全丢）。
    // 原始值接收者：原生返回 ToObject(prim) 包装对象（引擎无该形态）⇒ unknown。
    if (ARRAY_INPLACE_METHODS.has(name)) {
      // Bug 60：RequireObjectCoercible(this) 前置校验——nullish 接收者
      //（shape.k = "unknown"，不是 "prim"）此前绕过 prim 守卫被**原样返回**，
      // 原生定抛 TypeError。与 join 一族同口径（eval-bug-330）。
      if (isNullishLitAbs(recv)) throw new NudoThrow(errorTypeAbs("TypeError"));
      if (recv.shape.k === "prim") return unknown;
      return recv;
    }
    // Bug 262：concat **不是**泛型数组算法——规范只把 this 的元素拷进结果，
    // 且前提是 IsArray(O) 为真；否则 this **整体作为第一个元素**追加
    //（原生 `Array.prototype.concat.call("ab")` → ["ab"]（长度 1）；此前按
    // 数组展开 → 长度 2、首元素 "a" ⇒ 元素数 / 首元素全错）。
    if (name === "concat" && !isArrayExoticRecv(recv)) {
      // Bug 60：同上——nullish 接收者定抛，不得包成 [null] 元组。
      if (isNullishLitAbs(recv)) throw new NudoThrow(errorTypeAbs("TypeError"));
      const seed = abs({ k: "tuple", elements: [recv] }, undefined, undefined, "exact");
      return $invoke(seed, name, args);
    }
    // Bug 268：with 在**原始值**接收者上原生定抛 RangeError（ToObject(prim)
    // 的 length = 0 ⇒ 下标必越界；node 实测 with.call(1,0,2) → RangeError:
    // Invalid index : 0；with.call(1,-1,2) → RangeError: Invalid index : -1
    // ——RelativeIndex 负值钳到 0（max(len+index, 0)）⇒ 任何下标都越界）——
    // 此前落 `return unknown`（不记抛 ⇒ L2 门禁假绿）。
    if (name === "with" && recv.shape.k === "prim" && !recvIsStrPrim) {
      const idx = args[0];
      if (idx !== undefined && (isSymbolAbs(idx) || isBigPrim(idx))) {
        // ToIntegerOrInfinity(symbol / bigint) 原生定抛 TypeError
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      const lv = idx === undefined ? undefined : litValue(idx);
      if (lv === undefined || !lv.ok) {
        recordMayThrow({
          kind: "RangeError",
          cause: "Array.prototype.with index may be out of range on a primitive receiver",
        });
        return unknown;
      }
      throw new NudoThrow(errorTypeAbs("RangeError"));
    }
    // 字面量字符串 → code unit 字符 tuple（Array.prototype 借用算法按
    // length+索引读——code unit，非 code point；slice.call('abc') →
    // ["a","b","c"]）；其余 array-like（闭 obj）→ Array.from 物化
    // （Bug 51 索引槽面）后走数组派发；不可物化形态 → unknown（不折假值）
    const svR = litValue(recv);
    const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
    if (sv !== undefined) {
      const chars = abs(
        { k: "tuple", elements: Array.from({ length: sv.length }, (_, i) => strLit(sv[i]!)) },
        undefined,
        undefined,
        "exact",
      );
      return $invoke(chars, name, args);
    }
    // 其它原始值接收者（number / boolean / bigint / symbol）→ ToObject(prim)：
    // length 0 的**普通可扩展对象**（mutator 正常成功；写落到临时包装对象
    // 后即丢——原生同）。此前落 `return unknown`（连 push.call(5,1) → 1 都
    // 折不出来）。
    if (recv.shape.k === "prim") {
      const boxed = abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
      return $invoke(boxed, name, args);
    }
    const materialized = evalArrayStatic("from", [recv]);
    if (
      materialized !== undefined &&
      (materialized.shape.k === "tuple" || materialized.shape.k === "arr")
    ) {
      return $invoke(materialized, name, args);
    }
    return unknown;
  }
  return $invoke(recv, name, args);
});
