/**
 * 内建 brand 静态表群（原型方法 / 访问器名录、%TypedArray%.prototype 方法
 * 面、可迭代 brand、原型 brand 自有键清单）——自 members.ts 拆出的纯数据
 * 表 + 纯函数叶子：
 * - 本文件不得反向 import members.ts（表间相互引用一并收在本文件）；
 * - members.ts re-export 全部被外部消费的符号，既有 import 面
 *   （containers/member.ts、class/invoke.ts、builtins/object-proto.ts、
 *   builtins/object/methods.ts、builtins/object/enum-entries.ts、
 *   containers/arr-index.ts）零改动。
 *
 * 加载期初始化：BUILTIN_BRAND_METHODS 的 TA 家族注入循环与 Uint8Array
 * base64/hex 扩面在本模块求值期完成；members.ts 头部 import 本文件 ⇒
 * 任何运行期消费（值读 / $in / 链查找）都在两模块求值之后，序不变。
 */
import type { Abs, AbsFacets } from "../../abs.ts";
import { getSlot, type ObjShape } from "../../objects.ts";
import { getEvalClass } from "../class-registry.ts";
import { TYPED_ARRAY_ELEMENT } from "../../builtins/shared.ts";

/** Function.prototype / 函数自有面常见名 */
export const FUNCTION_PROTO_NAMES = new Set(["call", "apply", "bind", "length", "name", "prototype"]);
export const PROMISE_PROTO_NAMES = new Set(["then", "catch", "finally"]);

/** 内建 brand 原型方法名（值读 protoMethodValueAbs / $in 精确判定共用；
 *  Bug 40：按宿主原型面补齐——缺席名经闭 obj 槽 miss 折精确 undefined/
 *  false（wrong-exact），表内名折 "function"/true。名录与宿主
 *  Object.getOwnPropertyNames(X.prototype) 对齐（Node 26 实测）。 */
export const BUILTIN_BRAND_METHODS: Record<string, ReadonlySet<string>> = {
  Date: new Set([
    "toString", "toDateString", "toTimeString", "toISOString", "toUTCString", "toGMTString",
    "getDate", "setDate", "getDay", "getFullYear", "setFullYear", "getHours", "setHours",
    "getMilliseconds", "setMilliseconds", "getMinutes", "setMinutes", "getMonth", "setMonth",
    "getSeconds", "setSeconds", "getTime", "setTime", "getTimezoneOffset",
    "getUTCDate", "setUTCDate", "getUTCDay", "getUTCFullYear", "setUTCFullYear",
    "getUTCHours", "setUTCHours", "getUTCMilliseconds", "setUTCMilliseconds",
    "getUTCMinutes", "setUTCMinutes", "getUTCMonth", "setUTCMonth",
    "getUTCSeconds", "setUTCSeconds", "valueOf", "getYear", "setYear",
    "toJSON", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "toTemporalInstant",
  ]),
  RegExp: new Set(["test", "exec", "toString", "compile"]),
  Map: new Set(["get", "set", "has", "delete", "clear", "forEach", "keys", "values", "entries", "getOrInsert", "getOrInsertComputed"]),
  Set: new Set([
    "has", "add", "delete", "clear", "forEach", "keys", "values", "entries",
    "union", "intersection", "difference", "symmetricDifference",
    "isSubsetOf", "isSupersetOf", "isDisjointFrom",
  ]),
  // Bug 56：X.prototype.<method> 值读通道的表源（WeakMap/WeakSet 补齐）
  WeakMap: new Set(["get", "has", "set", "delete", "getOrInsert", "getOrInsertComputed"]),
  WeakSet: new Set(["add", "has", "delete"]),
  Error: new Set(["toString"]),
  // Bug 68：Error 家族七子类原型面与 Error 同款（toString = `${name}: ${message}`；
  // X.prototype.toString 值读/借用调用按接收者 brand 名派发到家族实现）
  TypeError: new Set(["toString"]),
  RangeError: new Set(["toString"]),
  ReferenceError: new Set(["toString"]),
  SyntaxError: new Set(["toString"]),
  URIError: new Set(["toString"]),
  EvalError: new Set(["toString"]),
  AggregateError: new Set(["toString"]),
  Promise: new Set(["then", "catch", "finally"]),
  // Bug 40：二进制缓冲 / 视图 / 弱引用家族原型面（此前全缺 → typeof/in
  // wrong-exact；调用面经 protoMethodValueAbs → $invoke 落既有派发，未建模
  // 方法调用仍诚实 unknown）
  ArrayBuffer: new Set(["slice", "resize", "transfer", "transferToFixedLength"]),
  SharedArrayBuffer: new Set(["slice", "grow"]),
  DataView: new Set([
    "getInt8", "setInt8", "getUint8", "setUint8",
    "getInt16", "setInt16", "getUint16", "setUint16",
    "getInt32", "setInt32", "getUint32", "setUint32",
    "getFloat16", "setFloat16", "getFloat32", "setFloat32",
    "getFloat64", "setFloat64", "getBigInt64", "setBigInt64", "getBigUint64", "setBigUint64",
  ]),
  WeakRef: new Set(["deref"]),
  FinalizationRegistry: new Set(["register", "unregister"]),
  // Bug 40 同口径补齐：新建品牌原型面（此前空 brand 闭 obj
  // 槽 miss → 值读折精确 undefined wrong-exact，`if (usp.get)`
  // / `if (td.decode)` 证伪死分支；调用面仍经既有派发，
  // 未建模方法调用诚实 unknown）
  URLSearchParams: new Set([
    "append", "delete", "entries", "forEach", "get", "getAll",
    "has", "keys", "set", "sort", "toString", "values",
  ]),
  // Bug 163（toJSON 半）：`URL.prototype` 的自有方法面——node v26.10.0
  // 实测 `Object.getOwnPropertyNames(URL.prototype)` 的方法位 =
  // ["toString", "toJSON"]（其余是组件访问器）。此前表内无 URL 键 ⇒
  // `u.toJSON` 落闭 obj 槽 miss 折 exact undefined（wrong-exact：
  // `u.toJSON === undefined` 判 true、`"toJSON" in u` 折 exact false）。
  // 组件槽（href/host/…）由 urlBrandAbs 的 componentKeys 承载，访问器名
  // 另在 BUILTIN_BRAND_ACCESSORS 登记（$in 面）。
  URL: new Set(["toString", "toJSON"]),
  TextDecoder: new Set(["decode"]),
  "Intl.NumberFormat": new Set([
    "format", "formatRange", "formatRangeToParts", "formatToParts", "resolvedOptions",
  ]),
  "Intl.DateTimeFormat": new Set([
    "format", "formatRange", "formatRangeToParts", "formatToParts", "resolvedOptions",
  ]),
  // 族 62 · 第 1 条：Intl.Collator 实例面（此前缺席 → `typeof
  // new Intl.Collator().compare` 折精确 "undefined"（wrong-exact：原生是
  // "function"））。原生面 = %Intl.Collator.prototype% 的 compare /
  // resolvedOptions（node v26.10.0 实测
  // Object.getOwnPropertyNames(Intl.Collator.prototype) =
  // ["constructor","resolvedOptions","compare"]；constructor 不入实例面）。
  "Intl.Collator": new Set(["compare", "resolvedOptions"]),
};

/** Bug 36：%TypedArray%.prototype 回调族（HOF + find 系 + reduce 系；
 *  flatMap 原生不在 TA 原型上，不得混入）。$invokeInner 回调派发专用
 *  （exec/class.ts 按 TYPED_ARRAY_ELEMENT 家族路由 invokeArrMethod）；
 *  家族键 = builtins/shared.ts 的 TYPED_ARRAY_ELEMENT 单一事实源（12 家族）。 */
export const TYPED_ARRAY_CALLBACK_METHODS: ReadonlySet<string> = new Set([
  "forEach", "map", "filter", "reduce", "reduceRight",
  "every", "some", "find", "findIndex", "findLast", "findLastIndex",
]);

/** Bug 40：%TypedArray%.prototype 全量字符串键方法面（值读/$in 用）——
 *  回调族之外还有 set/subarray/at/join/sort 等非回调方法，此前缺席令
 *  `typeof ta.set` 折精确 "undefined"（wrong-exact）。回调调用派发仍只认
 *  TYPED_ARRAY_CALLBACK_METHODS（exec/class.ts），两表分工不同不得合并。 */
export const TYPED_ARRAY_PROTO_METHOD_NAMES: ReadonlySet<string> = new Set([
  "entries", "keys", "values", "at", "copyWithin", "every", "fill", "filter",
  "find", "findIndex", "findLast", "findLastIndex", "forEach", "includes",
  "indexOf", "join", "lastIndexOf", "map", "reverse", "reduce", "reduceRight",
  "set", "slice", "some", "sort", "subarray", "toReversed", "toSorted", "with",
  "toLocaleString", "toString",
]);
for (const fam of Object.keys(TYPED_ARRAY_ELEMENT)) {
  BUILTIN_BRAND_METHODS[fam] = TYPED_ARRAY_PROTO_METHOD_NAMES;
}
// base64/hex 提案面仅 Uint8Array 原生自有（Float64Array 等无——混入共享表
// 会反向 wrong-exact）
BUILTIN_BRAND_METHODS.Uint8Array = new Set([
  ...TYPED_ARRAY_PROTO_METHOD_NAMES,
  "toBase64", "setFromBase64", "toHex", "setFromHex",
]);

/** @@iterator 值读（typeof x[Symbol.iterator]）只对原生可迭代 brand 折
 *  "function"（Map/Set/TA 家族）；Date/RegExp/Error/WeakMap/AB/DV 等非可
 *  迭代 brand 原生 undefined——Bug 40 前臂上 `key === "@@iterator"` 对
 *  任意有表 brand 折函数（wrong-exact）。迭代协议派发不走该值读臂。 */
export const ITERABLE_BRANDS: ReadonlySet<string> = new Set([
  "Map", "Set",
  // URLSearchParams 原生可迭代（@@iterator === entries）
  "URLSearchParams",
  ...Object.keys(TYPED_ARRAY_ELEMENT),
]);

/**
 * Bug 192：`X.prototype` 品牌上的**自有**成员判定（`X.prototype
 * .hasOwnProperty("m")` 原生 true——m 是 owner 类的实例方法，就挂在
 * owner.prototype 上）。
 *
 * 供 builtins/object-proto.ts 的 hasOwnDecision 接线（该文件不在本分片的
 * 可改面——见报告的越界诉求；一行调用即可）。
 * 只认 owner 类的**自有**方法 / 访问器（祖先类的方法在原型链上，原生
 * hasOwnProperty 折 false）；数据槽（`A.prototype.x = 1`）由
 * hasOwnDecision 的内层槽读覆盖。
 */
export function protoBrandOwnMember(brandName: string, key: string): boolean {
  if (!brandName.endsWith(".prototype")) return false;
  const owner = brandName.slice(0, -".prototype".length);
  const spec = getEvalClass(owner);
  if (!spec) return false;
  if (spec.methods?.[key] !== undefined) return true;
  if (spec.accessors?.[key] !== undefined) return true;
  return false;
}

/**
 * 族 58 · Bug 321/3：原型 brand（`X.prototype`）的**自有键**精确清单
 * （gOPN 语义：「全部自有键」，含不可枚举）。
 *
 * 覆盖范围（**只**覆盖引擎已建模成员的原型；其余原型保持既有保守域
 * `string[]`——**不扩 Abs 形状**，避免把本项升级成 A 类架构债）：
 * - Error 家族原型：自有数据属性 name/message（引擎已建模）+ 自有方法
 *   toString（**仅** Error.prototype 自有；子类的 toString 是继承的——
 *   node v26.10.0 实测 `Object.getOwnPropertyNames(TypeError.prototype)`
 *   = ["constructor","name","message"]，toString 在原型链上）。
 * - 用户类原型：constructor + owner 类的**自有**实例方法/访问器（祖先类
 *   成员在原型链上，原生 gOPN 不列）。
 *
 * 顺序：原生 gOPN 按**定义序**（constructor 在先）。引擎的类注册表把方法与
 * 访问器分两张表（spec.methods / spec.accessors），跨表的交错相对次序**在
 * 转译期就丢了**——A10 残余批次已由 `EvalClassSpec.protoMemberOrder`
 * （`transpile/class-emit.ts` 按类体源码序登记）补回，本函数优先读它。
 * 手写 spec / mock 桥没有该字段 ⇒ 仍走下方旧的两表拼接 + 交错保守域
 * （返回 undefined），零回归。
 */
const PROTO_BRAND_OWN_KEYS: Record<string, readonly string[]> = {
  "Error.prototype": ["constructor", "name", "message", "toString"],
  "TypeError.prototype": ["constructor", "name", "message"],
  "RangeError.prototype": ["constructor", "name", "message"],
  "ReferenceError.prototype": ["constructor", "name", "message"],
  "SyntaxError.prototype": ["constructor", "name", "message"],
  "URIError.prototype": ["constructor", "name", "message"],
  "EvalError.prototype": ["constructor", "name", "message"],
  "AggregateError.prototype": ["constructor", "name", "message"],
};

/**
 * 族 58 · Bug 321/3：原型 brand 的自有键集（精确清单或 undefined=开放）。
 * 单一事实源——消费方：builtins/object/enum-entries.ts 的
 * builtinBrandOwnKeyNames（gOPN 面）与 builtins/object/methods.ts 的
 * Object.hasOwn 面（该文件不在本分片的可改面——见报告的越界诉求；
 * 一行调用即可）。
 */
export function protoBrandOwnStringKeys(brandName: string): string[] | undefined {
  // 生成器原型 brand（`${fn名}.generatorProto`）：原生 `g.prototype` 的自有键集
  // **恒空**（next/return/throw 在 %GeneratorPrototype% 上——原型链，非自有键；
  // node 实测 `Object.getOwnPropertyNames(g.prototype)` === []）⇒ 空元组。
  if (brandName.endsWith(".generatorProto")) return [];
  if (!brandName.endsWith(".prototype")) return undefined;
  const fixed = PROTO_BRAND_OWN_KEYS[brandName];
  if (fixed) return [...fixed];
  const owner = brandName.slice(0, -".prototype".length);
  const spec = getEvalClass(owner);
  if (!spec) return undefined;
  // A10 残余：转译期记录的**源码定义序**（含方法与访问器交错）。
  // `protoMemberOrder` 不含 constructor，由本函数补在首位（原生 gOPN 同）。
  if (spec.protoMemberOrder) return ["constructor", ...spec.protoMemberOrder];
  // 手写 spec / mock 桥 / 旧产物：仍按旧两表拼接；交错序依旧不可复原 ⇒
  // 保守域（返回 undefined），保证零回归。
  const methods = Object.keys(spec.methods ?? {});
  const accessors = Object.keys(spec.accessors ?? {});
  if (methods.length > 0 && accessors.length > 0) return undefined;
  const keys = ["constructor"];
  for (const k of [...methods, ...accessors]) {
    if (k === "constructor" || keys.includes(k)) continue;
    keys.push(k);
  }
  return keys;
}

/**
 * A10 · 槽位启用的**单一事实源**：原型对象自有键集随 Abs 值携带。
 *
 * - 优先读 `a0.facets.protoOwnKeys`（生产点 / 显式装配 / subst / snapshot
 *   搬运后的值都走这条）；键集由**值**决定，不再只能按 brand 名查固定表。
 * - 缺省（未挂槽位）⇒ 逐字回落 `protoBrandOwnStringKeys` 的按名表判定，
 *   既有保守域 `string[]` / `boolean` 不受影响（空槽位零回归）。
 * - `symbols` 只有显式提供时才有值；按名表不建模原型自有 symbol 键。
 */
export function protoOwnKeysOf(
  a0: Abs | undefined,
): NonNullable<AbsFacets["protoOwnKeys"]> | undefined {
  if (!a0) return undefined;
  const carried = a0.facets?.protoOwnKeys;
  if (carried) return carried;
  if (a0.shape.k !== "brand") return undefined;
  const name = (a0.shape as { name?: string }).name ?? "";
  const strings = protoBrandOwnStringKeys(name);
  return strings === undefined ? undefined : { strings };
}

/**
 * 族 58 · Bug 5：任意 brand 的 **"length" 槽**（成员读语义）——env 声明面
 * 建模的槽（如 Buffer 实例的 `length`）此前不可读：core 的 `$len` 只认
 * 少数品牌（String / TypedArray 家族 / Arguments / Proxy），其余 brand 一律
 * 折 unknown ⇒ `buf.length` 拿不到。
 *
 * 口径：**只**认内层 obj 的**非可选** "length" 槽（无槽的 brand 沿既有
 * unknown 口径；可选槽的 length 读出 `T | undefined`——本 helper 只回
 * 确定的非可选槽，可选槽仍沿调用方的 unknown 口径）。
 */
export function brandLengthSlotValue(a: Abs): Abs | undefined {
  if (!a || a.shape.k !== "brand") return undefined;
  const inner = (a.shape as { shape?: Abs }).shape;
  if (!inner || inner.shape.k !== "obj") return undefined;
  const slot = getSlot((inner.shape as ObjShape).slots, "length");
  if (!slot || slot.optional) return undefined;
  return slot.value;
}

/**
 * Bug 217：开放对象**声明的索引值域**（`shape.index.value`）——成员读优先用
 * 它（`process.env.HOME` → `string | undefined`；`process.versions.node` →
 * `string`），无索引声明才退 unknown（那才是真正的「推断失败」）。
 *
 * 供 member.ts 的开放对象读臂接线（该文件不在本分片的可改面——见报告的
 * 越界诉求；一行调用即可）：
 * `if ((o.shape as ObjShape).open) return openIndexValueOf(o) ?? unknown;`
 *
 * 符号键例外：原生 `process.env[Symbol.iterator]` → undefined（env 无符号
 * 键）——调用方按符号键跳过本 helper（isSymbolKey 参数）。
 */
export function openIndexValueOf(o: Abs, isSymbolKey = false): Abs | undefined {
  if (isSymbolKey) return undefined;
  const s = o.shape;
  if (s.k === "obj") {
    const idx = (s as ObjShape).index;
    return idx ? idx.value : undefined;
  }
  if (s.k === "brand") {
    const inner = (s as { shape?: Abs }).shape;
    if (inner && inner.shape.k === "obj") {
      const idx = (inner.shape as ObjShape).index;
      return idx ? idx.value : undefined;
    }
  }
  return undefined;
}

/** 内建 brand 原型访问器（非方法成员；$in 精确判定用——值读不走方法表：
 *  Map/Set 的 size 在 $get 单独委托 mapSizeAbs/setSizeAbs，混入
 *  BUILTIN_BRAND_METHODS 会把 m.size 折成函数形状）。Bug 15。
 *  Bug 40 补：二进制/TA/RegExp 访问器名（byteLength 等值读多由构造器
 *  槽面建模，此处补 $in presence——`"buffer" in dv` / `"length" in ta`
 *  此前折精确 false）。 */
export const BUILTIN_BRAND_ACCESSORS: Record<string, ReadonlySet<string>> = {
  Map: new Set(["size"]),
  Set: new Set(["size"]),
  ArrayBuffer: new Set(["byteLength", "maxByteLength", "resizable", "detached"]),
  SharedArrayBuffer: new Set(["byteLength", "maxByteLength", "growable"]),
  DataView: new Set(["buffer", "byteLength", "byteOffset"]),
  RegExp: new Set([
    "source", "flags", "global", "ignoreCase", "multiline",
    "dotAll", "sticky", "unicode", "unicodeSets", "hasIndices",
  ]),
  URLSearchParams: new Set(["size"]),
  // Bug 163（toJSON 半）：`URL.prototype` 的自有组件访问器（node v26.10.0
  // `Object.getOwnPropertyNames(URL.prototype)`）——值读多由 urlBrandAbs 的
  // componentKeys 精确槽承载，本表补 `$in` presence 与「槽未建模时诚实
  // unknown」的访问器面（`"href" in u` / `"searchParams" in u` 此前对
  // 未入 componentKeys 的名字折 exact false）。
  URL: new Set([
    "href", "origin", "protocol", "username", "password", "host",
    "hostname", "port", "pathname", "search", "searchParams", "hash",
  ]),
  TextDecoder: new Set(["encoding", "fatal", "ignoreBOM"]),
  // Bug 214 / 238：内建**原型对象**上的 brand check 访问器（`"size" in
  // Map.prototype` 原生 true；值读定抛 TypeError——见
  // BUILTIN_PROTO_BRAND_GUARDS）。此前原型名缺席 → in 折 exact false。
  "Map.prototype": new Set(["size"]),
  "Set.prototype": new Set(["size"]),
  "Symbol.prototype": new Set(["description"]),
  ...Object.fromEntries(
    Object.keys(TYPED_ARRAY_ELEMENT).map((fam) => [
      fam,
      new Set(["buffer", "byteLength", "byteOffset", "length", "BYTES_PER_ELEMENT"]),
    ]),
  ),
  // Bug 329：symbol **包装对象**（Object(Symbol("x"))）的 description
  // 访问器挂在 Symbol.prototype 上 ⇒ 包装对象也继承到（原生
  // `"description" in Object(Symbol("x"))` → true；此前折 exact false）。
  // 值读由 global.ts 的装箱槽给出 exact 描述串（非本表职责）。
  Symbol: new Set(["description"]),
};
