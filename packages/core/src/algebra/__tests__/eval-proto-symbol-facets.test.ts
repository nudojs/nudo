/**
 * 成员读/原型面 facets 批（tmp/bug-report.md Bug 92/93/102/103/113/114）：
 *
 * - Bug 92：非构造命名空间（Math/JSON/Reflect/Intl——宿主值 typeof
 *   "object"）原生无 prototype：成员读折 exact undefined（此前凭空捏
 *   protoBrandAbs → typeof "object" wrong-exact、`Math.prototype.x` 假
 *   不抛）；Function.prototype 原生 callable——折 fn 面（typeof
 *   "function"、调用返 undefined、自身 .prototype undefined）。
 * - Bug 93：generator 函数「不可构造但有 prototype」两属性分离：声明
 *   （宿主分支 isHostGeneratorFn 源形判定）与表达式（$fnVal kind 标记）
 *   均折可辨 brand（typeof "object"、`g.prototype.constructor === g`
 *   原生 false——constructor 不回指 g、getPrototypeOf(g.prototype) ≠
 *   Object.prototype）；async/箭头 controls 保持 exact undefined。
 * - Bug 102：TA 字符串形下标 v["1"] ≡ v[1]（canonicalArrayIndex 归一 +
 *   元素域；长度槽字面量时精确：在界元素域 / 越界 undef）——此前闭 obj
 *   槽 miss 折 exact undefined。
 * - Bug 103：内建 brand 的 getter-only 原型访问器（$in presence 表
 *   BUILTIN_BRAND_ACCESSORS）strict 写原生 TypeError——此前落新自有槽
 *   假写成功 + 假读回。
 * - Bug 113：`new <函数声明>()` 实例沿 protoBrandAbs(clsName) 链解析
 *   f.prototype 写落槽（registerEvalClass 链键）；in 判定补原型数据槽
 *   presence（brandHasProtoMember → chainProtoSlotOf，class 实例同修）。
 * - Bug 114：well-known symbol 计算键全表投影（定义侧 keyOf 句法形
 *   `Symbol.X` → "@@X" 静态名 + $class 值面反查表；读侧既有投影）；
 *   内建构造器 @@species 静态读折 fn 面（BUILTIN_SPECIES_CTORS——
 *   Array/Promise/RegExp/Map/Set/AB/SAB 自有 + TA 全家自 %TypedArray%
 *   继承；Date/DataView/Object 原生 undefined）。
 * 原生 ground truth 均为 node 实测。
 */
import { describe, it, expect } from "vitest";
import { call, val } from "./eval-helpers.ts";

/** 断言折叠为指定精确值 */
function expectExact(src: string, value: unknown) {
  expect(val(src), `exact ${String(value)} for: ${src}`).toEqual({ ok: true, value });
}

/** 断言不折叠为指定精确值（允许抽象或相反精确值）——wrong-exact 消除 */
function expectNotExact(src: string, value: unknown) {
  const r = val(src);
  expect(r.ok && r.value === value, `must not fold exact ${String(value)} for: ${src}`).toBe(false);
}

/** 定抛：无 try/catch 时 throws 面是相应 Error brand */
function expectThrows(src: string, name: string) {
  const r = call(src);
  const got = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(got, `throws ${name} for: ${src}`).toBe(name);
}

describe("Bug 92 — 非构造命名空间无 prototype；Function.prototype fn 面", () => {
  it("Math/JSON/Reflect/Intl 的 .prototype 折 exact undefined", () => {
    expectExact(`export function f() { return typeof Math.prototype; }`, "undefined");
    expectExact(`export function f() { return typeof JSON.prototype; }`, "undefined");
    expectExact(`export function f() { return typeof Reflect.prototype; }`, "undefined");
    expectExact(`export function f() { return typeof Intl.prototype; }`, "undefined");
  });

  it("undefined 原型的成员读定抛 TypeError（原生同）", () => {
    expectThrows(`export function f() { return Math.prototype.zz; }`, "TypeError");
    expectThrows(`export function f() { return JSON.prototype.__proto__; }`, "TypeError");
  });

  it("Function.prototype 折 fn 面（原生唯一 callable 的 prototype）", () => {
    expectExact(`export function f() { return typeof Function.prototype; }`, "function");
    expectExact(
      `export function f() { return Function.prototype === Function.prototype; }`,
      true,
    );
    expectExact(`export function f() { return typeof Function.prototype.prototype; }`, "undefined");
    // 调用返 undefined 面目前 sound 抽象（String 折抽象串）——只断言不
    // wrong-exact（不得折出 "function" 等非 undefined 精确串）
    expectNotExact(`export function f() { return String(Function.prototype()); }`, "function");
    expectNotExact(`export function f() { return String(Function.prototype()); }`, "[object Function]");
  });

  it("构造命名空间 prototype 维持原型 brand（controls）", () => {
    expectExact(`export function f() { return typeof Object.prototype; }`, "object");
    expectExact(`export function f() { return typeof Array.prototype; }`, "object");
    expectExact(`export function f() { return typeof Map.prototype; }`, "object");
  });
});

describe("Bug 93 — generator 函数有 prototype（声明与表达式）；async/箭头无", () => {
  it("声明：typeof 折 \"object\"、expando 写读、constructor/getPrototypeOf 不恒等", () => {
    expectExact(`export function f() { function* d() {} return typeof d.prototype; }`, "object");
    expectExact(
      `export function f() { function* d1() {} d1.prototype.zz = 5; return d1.prototype.zz; }`,
      5,
    );
    // 原生 constructor 是 %GeneratorFunction%.prototype（不回指 d）、
    // [[Proto]] 非 Object.prototype——两者恒 false；引擎声明面 fn Abs
    // 与 builtinCtorAbs 身份不可证不等 → sound 抽象，断言不 wrong-exact
    expectNotExact(`export function f() { function* d() {} return d.prototype.constructor === d; }`, true);
    expectNotExact(
      `export function f() { function* d() {} return Object.getPrototypeOf(d.prototype) === Object.prototype; }`,
      true,
    );
  });

  it("表达式：$fnVal kind 标记面同折", () => {
    expectExact(
      `export function f() { const g = function* () {}; return typeof g.prototype; }`,
      "object",
    );
    expectExact(
      `export function f() { return typeof (function* () {}).prototype; }`,
      "object",
    );
    expectExact(
      `export function f() { const g = function* () {}; g.prototype.zz = 5; return g.prototype.zz; }`,
      5,
    );
    expectExact(
      `export function f() { const g = function* () {}; return g.prototype.constructor === g; }`,
      false,
    );
    expectNotExact(
      `export function f() { const g = function* () {}; return Object.getPrototypeOf(g.prototype) === Object.prototype; }`,
      true,
    );
  });

  it("async/箭头 controls 保持 exact undefined（原生无 prototype）", () => {
    expectExact(
      `export function f() { async function a() {} return a.prototype === undefined; }`,
      true,
    );
    expectExact(`export function f() { const ar = () => 1; return ar.prototype === undefined; }`, true);
    expectExact(
      `export function f() { const ar = async () => 1; return ar.prototype === undefined; }`,
      true,
    );
  });
});

describe("Bug 102 — TA 字符串形下标与数字形同域（长度字面量时精确）", () => {
  it("在界：折精确元素域（BigInt 家族为 bigint）", () => {
    expectExact(`export function f() { const v = new Uint8Array(3); return typeof v["1"]; }`, "number");
    expectExact(`export function f() { const v = new Float64Array(2); return typeof v["0"]; }`, "number");
    expectExact(
      `export function f() { const v = new BigInt64Array(2); return typeof v["1"]; }`,
      "bigint",
    );
  });

  it("越界（idx ≥ 长度字面量）：折 exact undefined", () => {
    expectExact(
      `export function f() { const v = new Uint8Array(3); return v["3"] === undefined; }`,
      true,
    );
    expectExact(
      `export function f() { const v = new Uint8Array(0); return v["0"] === undefined; }`,
      true,
    );
  });

  it("非下标字符串键不受影响（length 槽优先；非规范形 miss 折 undefined）", () => {
    expectExact(`export function f() { const v = new Uint8Array(3); return v["length"]; }`, 3);
    expectExact(
      `export function f() { const v = new Uint8Array(3); return v["-1"] === undefined; }`,
      true,
    );
    expectExact(
      `export function f() { const v = new Uint8Array(3); return v["1.5"] === undefined; }`,
      true,
    );
  });
});

describe("Bug 103 — 内建 brand getter-only 访问器写定抛 TypeError", () => {
  it("TA/DataView/Map/RegExp 的访问器键写", () => {
    expectThrows(`export function f() { const v = new Uint8Array(3); v.length = 4; return v; }`, "TypeError");
    expectThrows(
      `export function f() { const v = new Uint8Array(3); v.BYTES_PER_ELEMENT = 2; return v; }`,
      "TypeError",
    );
    expectThrows(
      `export function f() { const v = new DataView(new ArrayBuffer(8)); v.byteOffset = 0; return v; }`,
      "TypeError",
    );
    expectThrows(`export function f() { const m = new Map(); m.size = 9; return m; }`, "TypeError");
    expectThrows(`export function f() { const r = /a/g; r.source = "b"; return r; }`, "TypeError");
  });

  it("try/catch 吸收后正常返回（原生 strict TypeError 可捕获）", () => {
    expectExact(
      `export function f() { const v = new Uint8Array(3); try { v.length = 4; } catch (e) { return typeof e; } return "no"; }`,
      "object",
    );
  });

  it("可写键不受影响（元素写 / RegExp lastIndex，controls）", () => {
    expectExact(
      `export function f() { const v = new Uint8Array(3); v[1] = 9; return v["1"] === undefined ? "u" : "n"; }`,
      "n",
    );
    expectExact(`export function f() { const r = /a/g; r.lastIndex = 5; return r.lastIndex; }`, 5);
  });
});

describe("Bug 113 — new <函数声明>() 沿 protoBrandAbs 链解析 f.prototype", () => {
  it("实例缺槽读命中 f.prototype 写落槽", () => {
    expectExact(
      `export function f() { function g1() {} g1.prototype.zz = 5; return new g1().zz; }`,
      5,
    );
    expectExact(
      `export function f() { function g2() {} g2.prototype.zz = 5; return new g2().zz + g2.prototype.zz; }`,
      10,
    );
    expectExact(
      `export function f() { function g3() {} g3.prototype.m = () => 5; return typeof new g3().m; }`,
      "function",
    );
    expectExact(
      `export function f() { function g4() {} g4.prototype.zz = 5; return new g4().zz === undefined ? "undef" : "val"; }`,
      "val",
    );
  });

  it("in 判定见原型数据槽（class 实例同修）", () => {
    expectExact(
      `export function f() { function g5() {} g5.prototype.zz = 5; return "zz" in new g5(); }`,
      true,
    );
    expectExact(
      `export function f() { class C1 {} C1.prototype.zz = 5; return "zz" in new C1(); }`,
      true,
    );
    expectExact(`export function f() { function g6() {} return "zz" in new g6(); }`, false);
    expectExact(`export function f() { class C2 { m() {} } return "m" in new C2(); }`, true);
  });

  it("未写键保持 exact undefined（链无洞不误升 unknown）", () => {
    expectExact(
      `export function f() { function g7() {} return new g7().nope === undefined; }`,
      true,
    );
  });

  it("instanceof 恒真（control）", () => {
    expectExact(
      `export function f() { function g8() {} return new g8() instanceof g8; }`,
      true,
    );
  });
});

describe("Bug 114 — well-known symbol 键全表投影 + 内建 @@species", () => {
  it("类成员：species/iterator/for 键读写闭合", () => {
    // 访问器形态：getter 体 `return Array` 折 sound 抽象（typeof 非 exact
    // "function"）——断言 Bug 114 的 wrong-exact "undefined" 消除
    expectNotExact(
      `export function f() { class A { static get [Symbol.species]() { return Array; } } return typeof A[Symbol.species]; }`,
      "undefined",
    );
    expectNotExact(
      `export function f() { class B { get [Symbol.species]() { return Array; } } return typeof new B()[Symbol.species]; }`,
      "undefined",
    );
    // 数据字段/方法形态：fn 成员值折 exact "function"
    expectExact(
      `export function f() { class C { static [Symbol.species] = Array } return typeof C[Symbol.species]; }`,
      "function",
    );
    expectExact(
      `export function f() { class D { [Symbol.iterator]() {} } return typeof new D()[Symbol.iterator]; }`,
      "function",
    );
    expectExact(
      `export function f() { class E { static [Symbol.iterator]() {} } return typeof E[Symbol.iterator]; }`,
      "function",
    );
    expectExact(
      `export function f() { class F1 { static [Symbol.for] = 1 } return typeof F1[Symbol.for]; }`,
      "number",
    );
  });

  it("内建构造器 @@species 静态读折 fn 面（自有 + TA 全家继承）", () => {
    expectExact(`export function f() { return typeof Array[Symbol.species]; }`, "function");
    expectExact(`export function f() { return typeof Promise[Symbol.species]; }`, "function");
    expectExact(`export function f() { return typeof RegExp[Symbol.species]; }`, "function");
    expectExact(`export function f() { return typeof Map[Symbol.species]; }`, "function");
    expectExact(`export function f() { return typeof Set[Symbol.species]; }`, "function");
    expectExact(`export function f() { return typeof ArrayBuffer[Symbol.species]; }`, "function");
    expectExact(`export function f() { return typeof SharedArrayBuffer[Symbol.species]; }`, "function");
    expectExact(`export function f() { return typeof Uint8Array[Symbol.species]; }`, "function");
    expectExact(`export function f() { return typeof Float64Array[Symbol.species]; }`, "function");
    expectExact(`export function f() { return typeof BigInt64Array[Symbol.species]; }`, "function");
  });

  it("无 @@species 的内建折 exact undefined（controls）", () => {
    expectExact(`export function f() { return Date[Symbol.species] === undefined; }`, true);
    expectExact(`export function f() { return DataView[Symbol.species] === undefined; }`, true);
    expectExact(`export function f() { return Object[Symbol.species] === undefined; }`, true);
  });

  it("hasInstance/toStringTag 既有投影不回归（Bug 50/72 controls）", () => {
    expectExact(
      `export function f() { class G { static get [Symbol.hasInstance]() { return (x) => false; } } return typeof G[Symbol.hasInstance]; }`,
      "function",
    );
    expectExact(
      `export function f() { class H { static get [Symbol.toStringTag]() { return "S"; } } return typeof H[Symbol.toStringTag]; }`,
      "string",
    );
    expectExact(
      `export function f() { class I { get [Symbol.toStringTag]() { return "S"; } } return new I()[Symbol.toStringTag]; }`,
      "S",
    );
  });
});
