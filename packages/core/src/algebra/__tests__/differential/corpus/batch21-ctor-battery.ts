/**
 * 构造器 × 非法实参差分电池（batch21）：对引擎已建模的构造器做系统化
 * 实参矩阵（无参 / null / undefined / 0 / -1 / "x" / "bad-$$" / {} / []
 * / [["a"]] / Symbol() …），行体统一「try 构造 + e.constructor.name」或
 * 返回值序列化（.size / .byteLength / .message / typeof …），对账
 * native 抛错域与值域。
 *
 * 探针后不入库的 MISMATCH 形态（= 剩余缺口面台账，编号见 bug-report）：
 * - new Map([null]) / new WeakMap([{}])：元素级 entry/key 校验漏 null
 *   键与 open-obj 键（Bug 8 集合构造器实参校验残余，值级漏抛）；
 * - new Map([["a"]]).size：一元 pair 折 size 0（native 1）——未编号新面；
 * - new URLSearchParams([{}])：非可迭代 pair 漏检（Bug 45 修复残余）；
 * - new DataView(buf, 4, 8) / new DataView(buf, 9)：越界 ctor 缺 RangeError
 *   （Bug 35 ctor bounds 未修面）；
 * - new Number().valueOf() / new String().valueOf()：缺省实参分别折
 *   NaN / undefined（native +0 / ""）——未编号新面（wrapper 缺省 ≠ undefined）；
 * - BigInt([1, 2])：数组 ToString 折叠漏 SyntaxError——未编号新面。
 * Intl.NumberFormat/DateTimeFormat 未建模（Bug 44 修复中）整族不入库。
 */
export const mapCtor = [
  `try { new Map(0); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Map(-1); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Map("x"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Map("bad-$$"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Map({}); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Map([1]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Map(["x"]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Map([0]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Map([Symbol()]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new Map().size; } catch (e) { return e.constructor.name; }`,
  `try { return new Map(null).size; } catch (e) { return e.constructor.name; }`,
  `try { return new Map(undefined).size; } catch (e) { return e.constructor.name; }`,
  `try { return new Map([]).size; } catch (e) { return e.constructor.name; }`,
  `try { return new Map([[null, 1]]).size; } catch (e) { return e.constructor.name; }`,
  // 合法 skip（钉在 skip-baseline.json）：value 缺省的 entry 折不出具体值
  //（get 返回非具体 Abs，concrete() 盲区）——不与 native 对账。
  `try { return new Map([["a"]]).get("a"); } catch (e) { return e.constructor.name; }`,
  `try { return new Map([["a", 1]]).get("a"); } catch (e) { return e.constructor.name; }`,
  `try { new Map(0); return "no-throw"; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; }`,
];

export const setCtor = [
  `try { new Set(0); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Set(-1); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Set({}); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new Set(null).size; } catch (e) { return e.constructor.name; }`,
  `try { return new Set(undefined).size; } catch (e) { return e.constructor.name; }`,
  `try { return new Set("x").size; } catch (e) { return e.constructor.name; }`,
  `try { return new Set("bad-$$").size; } catch (e) { return e.constructor.name; }`,
  `try { return new Set([["a"]]).size; } catch (e) { return e.constructor.name; }`,
  `try { return new Set([{}, {}]).size; } catch (e) { return e.constructor.name; }`,
];

export const weakCtor = [
  `try { new WeakMap(null); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakMap(undefined); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakMap(0); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakMap(-1); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakMap("x"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakMap({}); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakMap([]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakMap([[0, "v"]]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakMap([["k", "v"]]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakMap([[{}, "v"]]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakSet(null); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakSet(undefined); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakSet(0); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakSet("x"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakSet({}); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakSet([0]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakSet(["k"]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new WeakSet([{}]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
];

export const urlCtor = [
  `try { new URL("x"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URL("bad-$$"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URL(); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URL(0); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URL(null); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URL(undefined); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URL("{}"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URL("http://a/", "bad"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new URL("http://a/").href; } catch (e) { return e.constructor.name; }`,
  `try { return new URL("x", "http://b/").href; } catch (e) { return e.constructor.name; }`,
];

export const uspCtor = [
  `try { new URLSearchParams(); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URLSearchParams(null); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URLSearchParams(undefined); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URLSearchParams("x"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URLSearchParams("bad-$$"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URLSearchParams(0); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URLSearchParams([["a"]]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URLSearchParams([["a", "b", "c"]]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new URLSearchParams([0]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
];

export const tdCtor = [
  `try { new TextDecoder(); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new TextDecoder("utf-8"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new TextDecoder(undefined); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new TextDecoder("bad-$$"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new TextDecoder(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new TextDecoder().encoding; } catch (e) { return e.constructor.name; }`,
  `try { return new TextDecoder("utf-8").encoding; } catch (e) { return e.constructor.name; }`,
  `try { return new TextDecoder("ascii").encoding; } catch (e) { return e.constructor.name; }`,
];

export const bufferCtor = [
  `try { new ArrayBuffer(-1); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new ArrayBuffer(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new ArrayBuffer(0).byteLength; } catch (e) { return e.constructor.name; }`,
  `try { return new ArrayBuffer(8).byteLength; } catch (e) { return e.constructor.name; }`,
  `try { return new ArrayBuffer(1.5).byteLength; } catch (e) { return e.constructor.name; }`,
  `try { return new ArrayBuffer("x").byteLength; } catch (e) { return e.constructor.name; }`,
  `try { return new ArrayBuffer("bad-$$").byteLength; } catch (e) { return e.constructor.name; }`,
  `try { return new ArrayBuffer(null).byteLength; } catch (e) { return e.constructor.name; }`,
  // 合法 skip（钉在 skip-baseline.json）：open obj 实参 ToNumber({}) 折 NaN→0，
  // 引擎侧 byteLength 非具体（concrete() 盲区）。
  `try { return new ArrayBuffer({}).byteLength; } catch (e) { return e.constructor.name; }`,
  `try { new SharedArrayBuffer(-1); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new SharedArrayBuffer(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new SharedArrayBuffer(0).byteLength; } catch (e) { return e.constructor.name; }`,
  `try { return new SharedArrayBuffer(8).byteLength; } catch (e) { return e.constructor.name; }`,
  `try { return new SharedArrayBuffer("x").byteLength; } catch (e) { return e.constructor.name; }`,
  `try { new DataView(null); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new DataView({}); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new DataView([]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new DataView(0); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new DataView("x"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new DataView(new ArrayBuffer(8)).byteLength; } catch (e) { return e.constructor.name; }`,
  `try { return new DataView(new ArrayBuffer(8), 4).byteLength; } catch (e) { return e.constructor.name; }`,
  `try { new DataView(new ArrayBuffer(8), -1); return "no-throw"; } catch (e) { return e.constructor.name; }`,
];

export const wrapCtor = [
  `try { return new Number(0).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Number(-1).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Number("x").valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Number("bad-$$").valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Number(null).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Number(undefined).valueOf(); } catch (e) { return e.constructor.name; }`,
  // 合法 skip（钉在 skip-baseline.json）：open obj ToPrimitive 折不出具体数
  `try { return new Number({}).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { new Number(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new Boolean().valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Boolean(0).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Boolean(-1).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Boolean("x").valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Boolean(null).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new Boolean(undefined).valueOf(); } catch (e) { return e.constructor.name; }`,
  // 合法 skip（钉在 skip-baseline.json）：Symbol 实参的 Boolean 包装
  // valueOf 折叠顺序敏感（前置 section 求值后才折 true，独立运行非具体）
  `try { return new Boolean(Symbol()).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new String(0).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new String(-1).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new String(null).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { return new String(undefined).valueOf(); } catch (e) { return e.constructor.name; }`,
  // 合法 skip（钉在 skip-baseline.json）：open obj ToString 折不出 "[object Object]"
  `try { return new String({}).valueOf(); } catch (e) { return e.constructor.name; }`,
  `try { new String(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
];

export const symbolBigIntCall = [
  `try { return typeof Symbol(); } catch (e) { return e.constructor.name; }`,
  `try { return typeof Symbol("x"); } catch (e) { return e.constructor.name; }`,
  `try { return typeof Symbol(0); } catch (e) { return e.constructor.name; }`,
  `try { return typeof Symbol(null); } catch (e) { return e.constructor.name; }`,
  `try { return typeof Symbol({}); } catch (e) { return e.constructor.name; }`,
  `try { Symbol(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Symbol(); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Symbol("x"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return BigInt(0); } catch (e) { return e.constructor.name; }`,
  `try { return BigInt(-1); } catch (e) { return e.constructor.name; }`,
  `try { return BigInt("0x10"); } catch (e) { return e.constructor.name; }`,
  `try { BigInt("x"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { BigInt("bad-$$"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { BigInt(null); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { BigInt(undefined); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { BigInt({}); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  // 合法 skip ×2（钉在 skip-baseline.json）：数组 ToPrimitive→字符串→bigint 折
  // 不出具体值（引擎对数组实参保守返回，concrete() 盲区）
  `try { return BigInt([]); } catch (e) { return e.constructor.name; }`,
  `try { return BigInt([1]); } catch (e) { return e.constructor.name; }`,
  `try { BigInt(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new BigInt(); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new BigInt(0); return "no-throw"; } catch (e) { return e.constructor.name; }`,
];

export const dateCtor = [
  // 合法 skip ×7（钉在 skip-baseline.json）：Date brand 的 getTime() 值折不
  // 出具体数（含 Invalid Date 的 NaN 面，与 batch14a.dateEdge 同一盲区）；
  // 抛错行（Symbol 实参）照常对账。
  `try { return new Date("x").getTime(); } catch (e) { return e.constructor.name; }`,
  `try { return new Date("bad-$$").getTime(); } catch (e) { return e.constructor.name; }`,
  `try { return new Date(null).getTime(); } catch (e) { return e.constructor.name; }`,
  `try { return new Date(0).getTime(); } catch (e) { return e.constructor.name; }`,
  `try { return new Date(-1).getTime(); } catch (e) { return e.constructor.name; }`,
  `try { return new Date({}).getTime(); } catch (e) { return e.constructor.name; }`,
  `try { return new Date([]).getTime(); } catch (e) { return e.constructor.name; }`,
  `try { new Date(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
];

export const regexpCtor = [
  `try { new RegExp("["); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new RegExp("x", "gg"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new RegExp("x", "bad-$$"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new RegExp(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new RegExp(null).source; } catch (e) { return e.constructor.name; }`,
  `try { return new RegExp(0).source; } catch (e) { return e.constructor.name; }`,
  `try { return new RegExp().source; } catch (e) { return e.constructor.name; }`,
  `try { return new RegExp("bad-$$").source; } catch (e) { return e.constructor.name; }`,
  `try { return new RegExp("x", "gi").flags; } catch (e) { return e.constructor.name; }`,
];

export const errorCtor = [
  `try { return new Error().message; } catch (e) { return e.constructor.name; }`,
  `try { return new Error(null).message; } catch (e) { return e.constructor.name; }`,
  `try { return new Error(undefined).message; } catch (e) { return e.constructor.name; }`,
  `try { return new Error(0).message; } catch (e) { return e.constructor.name; }`,
  `try { return new Error("x").message; } catch (e) { return e.constructor.name; }`,
  `try { return new Error("bad-$$").message; } catch (e) { return e.constructor.name; }`,
  // 合法 skip（钉在 skip-baseline.json）：open obj ToString 折不出具体 message
  `try { return new Error({}).message; } catch (e) { return e.constructor.name; }`,
  `try { new Error(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new TypeError("x").message; } catch (e) { return e.constructor.name; }`,
  `try { return new TypeError(null).message; } catch (e) { return e.constructor.name; }`,
  `try { new TypeError(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new RangeError(0).message; } catch (e) { return e.constructor.name; }`,
  `try { new RangeError(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
];

export const promiseCtor = [
  `try { new Promise(); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Promise(null); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Promise(undefined); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Promise(0); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Promise(-1); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Promise("x"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Promise("bad-$$"); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Promise({}); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Promise([]); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Promise(Symbol()); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return typeof new Promise(() => {}); } catch (e) { return e.constructor.name; }`,
];

export const objectArrayCtor = [
  `try { return typeof new Object(); } catch (e) { return e.constructor.name; }`,
  `try { return typeof new Object(null); } catch (e) { return e.constructor.name; }`,
  `try { return typeof new Object(undefined); } catch (e) { return e.constructor.name; }`,
  `try { return typeof new Object(0); } catch (e) { return e.constructor.name; }`,
  `try { return typeof new Object(-1); } catch (e) { return e.constructor.name; }`,
  `try { return typeof new Object("x"); } catch (e) { return e.constructor.name; }`,
  `try { return typeof new Object(Symbol()); } catch (e) { return e.constructor.name; }`,
  // 合法 skip ×2（钉在 skip-baseline.json）：open obj 元素 / 包装对象同一性
  // 比较折不出具体值（concrete() 盲区）
  `try { const o = {}; return new Object(o) === o; } catch (e) { return e.constructor.name; }`,
  `try { return new Array().length; } catch (e) { return e.constructor.name; }`,
  `try { return new Array(null).length; } catch (e) { return e.constructor.name; }`,
  `try { return new Array(0).length; } catch (e) { return e.constructor.name; }`,
  `try { return new Array(3).length; } catch (e) { return e.constructor.name; }`,
  `try { new Array(-1); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { new Array(1.5); return "no-throw"; } catch (e) { return e.constructor.name; }`,
  `try { return new Array("x").length; } catch (e) { return e.constructor.name; }`,
  `try { return new Array("bad-$$").length; } catch (e) { return e.constructor.name; }`,
  // 合法 skip（钉在 skip-baseline.json）：open obj 单元素数组的 length 非具体
  `try { return new Array({}).length; } catch (e) { return e.constructor.name; }`,
];
