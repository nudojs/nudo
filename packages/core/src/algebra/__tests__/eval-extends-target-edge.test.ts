/**
 * P3：extends 目标边缘缺口（N2 静态继承波后续）。
 *
 * P3a —— NAMESPACE_GLOBALS-only 宿主父类（hostBuiltinCtorName 名单外的
 * 可扩展类）：URL / ArrayBuffer / SharedArrayBuffer / DataView / WeakRef /
 * FinalizationRegistry。此前 superBuiltinHost 不放行：
 * - 静态读 typeof AB.isView / U.canParse 折精确 undefined（wrong-exact，
 *   原生 "function"）；缺席键同样不可判；
 * - 构造面 new AB(8).byteLength 折 undefined（原生 8——constructClass 的
 *   !spec 分支原样返回 thisVal，args 丢弃）。
 * 修复：hostBuiltinCtorOf 增 NAMESPACE_ONLY_HOST_CTORS 身份校验（静态读
 * 走宿主通道——出席键 ns 投影 / 缺席键折 undefined）；constructClass 对
 * 宿主父名路由 evalBuiltinNew（内建槽嫁接到被构造 brand 名——instanceof
 * 沿链继续命中）；ArrayBuffer.isView 入白名单（纯谓词：DV/TA → true、
 * AB/SAB/prim/obj 面 → false、其余不可判 boolean）。
 *
 * P3b —— 非 Identifier fn 表达式父类（`const Base = function(){}; class B
 * extends Base {}`）：transpile 后父是 $fnVal fn Abs，无 shape.name 可作
 * superName 链键——静态/原型/构造链全断（B.prototype.constructor === B 折
 * false、B.prototype.x / new B().x 折 undefined）。修复：按 fn Abs 驻留
 * 「伪父名」（ensureFnParentName——空 spec + 类值映射 = fn Abs 本身）；
 * fn 的 prototype 对象按 fn Abs 驻留（fnProtoOf——constructor 槽指回 fn，
 * 原地可变跨读存活）；$set fn 臂就地表 expando 静态槽；原型链数据槽读
 * （chainProtoSlotOf——实例/原型品牌沿链）；strictEqAbs 类值不同名必不
 * 同值；$new 匿名 fn 构造器实例 brand 用伪父名（new Base().x 沿 proto 折）。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const v = (src: string) => val(`function f() { ${src} }`);

describe("P3a: NAMESPACE_GLOBALS-only 宿主父类——静态读面", () => {
  it("typeof AB.isView → function（ArrayBuffer 父）", () => {
    expect(v(`class AB extends ArrayBuffer {} return typeof AB.isView;`)).toEqual({ ok: true, value: "function" });
  });
  it("typeof U.canParse → function（URL 父）", () => {
    expect(v(`class U extends URL {} return typeof U.canParse;`)).toEqual({ ok: true, value: "function" });
  });
  it("缺席静态键折 undefined（AB.nope）", () => {
    expect(v(`class AB extends ArrayBuffer {} return typeof AB.nope;`)).toEqual({ ok: true, value: "undefined" });
    expect(v(`class WR extends WeakRef {} return typeof WR.nope;`)).toEqual({ ok: true, value: "undefined" });
  });
  it("DataView / SAB / FCR 父类 typeof 类值 → function", () => {
    expect(v(`class Dv extends DataView {} return typeof Dv;`)).toEqual({ ok: true, value: "function" });
    expect(v(`class Sab extends SharedArrayBuffer {} return typeof Sab;`)).toEqual({ ok: true, value: "function" });
    expect(v(`class Fcr extends FinalizationRegistry {} return typeof Fcr;`)).toEqual({ ok: true, value: "function" });
  });
});

describe("P3a: ArrayBuffer.isView 白名单调用（纯谓词）", () => {
  it("isView(new ArrayBuffer(4)) → false（视图仅 DV/TA——node 实测）", () => {
    expect(v(`class AB extends ArrayBuffer {} return AB.isView(new ArrayBuffer(4));`)).toEqual({ ok: true, value: false });
  });
  it("isView(new Uint8Array(4)) → true", () => {
    expect(v(`class AB extends ArrayBuffer {} return AB.isView(new Uint8Array(4));`)).toEqual({ ok: true, value: true });
  });
  it("isView(prim) → false；派生 brand 实参不可判（sound 不折）", () => {
    expect(v(`class AB extends ArrayBuffer {} return AB.isView("x");`)).toEqual({ ok: true, value: false });
    // new AB(4) 原生是 ArrayBuffer（false），引擎 brand "AB" 不在谓词表 → boolean
    expect((v(`class AB extends ArrayBuffer {} return AB.isView(new AB(4));`) as { ok: boolean }).ok).toBe(false);
  });
  it("非白名单静态调用保持 sound（AB.slice 属实例面 → undefined）", () => {
    expect(v(`class AB extends ArrayBuffer {} return typeof AB.slice;`)).toEqual({ ok: true, value: "undefined" });
  });
});

describe("P3a: 宿主父类构造面（constructClass → evalBuiltinNew）", () => {
  it("new AB(8).byteLength → 8", () => {
    expect(v(`class AB extends ArrayBuffer {} return new AB(8).byteLength;`)).toEqual({ ok: true, value: 8 });
  });
  it("new U(href).href 精确（URL 解析槽）", () => {
    expect(v(`class U extends URL {} return new U("https://x.com/a").href;`)).toEqual({ ok: true, value: "https://x.com/a" });
  });
  it("new Dv(buf, 0, 8).byteLength → 8", () => {
    expect(v(`class Dv extends DataView {} return new Dv(new ArrayBuffer(8), 0, 8).byteLength;`)).toEqual({ ok: true, value: 8 });
  });
  it("instanceof 沿链命中（brand 名不换）", () => {
    expect(v(`class AB extends ArrayBuffer {} return new AB(8) instanceof AB;`)).toEqual({ ok: true, value: true });
    expect(v(`class AB extends ArrayBuffer {} return new AB(8) instanceof ArrayBuffer;`)).toEqual({ ok: true, value: true });
  });
  it("派生原型链：gPo(AB.prototype) === ArrayBuffer.prototype", () => {
    expect(
      v(`class AB extends ArrayBuffer {} return Object.getPrototypeOf(AB.prototype) === ArrayBuffer.prototype;`),
    ).toEqual({ ok: true, value: true });
  });
  it("U.canParse 字面量折（白名单静态调用）", () => {
    expect(v(`class U extends URL {} return U.canParse("https://x.com/");`)).toEqual({ ok: true, value: true });
    expect(v(`class U extends URL {} return U.canParse("not a url");`)).toEqual({ ok: true, value: false });
  });
  it("N2 控制不回归：Error/Object 父静态通道", () => {
    expect(v(`class E extends Error {} return typeof E.captureStackTrace;`)).toEqual({ ok: true, value: "function" });
    expect(v(`class B extends Object {} return typeof B.keys;`)).toEqual({ ok: true, value: "function" });
  });
});

describe("P3b: fn 表达式父类——链身份与成员读", () => {
  const pre = `const Base = function(){}; Base.prototype.x = 1; class B extends Base {} `;

  it("B.prototype.constructor === B → true（=== Base → false）", () => {
    expect(v(`const Base = function(){}; class B extends Base {} return B.prototype.constructor === B;`)).toEqual({ ok: true, value: true });
    expect(v(`${pre}return B.prototype.constructor === Base;`)).toEqual({ ok: true, value: false });
  });
  it("B.prototype.x / new B().x → 1（沿 memo prototype）", () => {
    expect(v(`${pre}return B.prototype.x;`)).toEqual({ ok: true, value: 1 });
    expect(v(`${pre}return new B().x;`)).toEqual({ ok: true, value: 1 });
  });
  it("new B().zz 不折缺席（fn 父 ctor 体不透明 → sound）", () => {
    expect((v(`${pre}return new B().zz;`) as { ok: boolean }).ok).toBe(false);
  });
  it("new B() instanceof Base → true（注册类值身份匹配）", () => {
    expect(v(`${pre}return new B() instanceof Base;`)).toEqual({ ok: true, value: true });
  });
  it("gPo(B) === Base / gPo(B.prototype) === Base.prototype → true", () => {
    expect(v(`const Base = function(){}; class B extends Base {} return Object.getPrototypeOf(B) === Base;`)).toEqual({ ok: true, value: true });
    expect(v(`${pre}return Object.getPrototypeOf(B.prototype) === Base.prototype;`)).toEqual({ ok: true, value: true });
  });
  it("Base.prototype.constructor === Base → true；原型身份恒等", () => {
    expect(v(`const Base = function(){}; return Base.prototype.constructor === Base;`)).toEqual({ ok: true, value: true });
    expect(v(`const Base = function(){}; return Base.prototype === Base.prototype;`)).toEqual({ ok: true, value: true });
  });
  it("写后读存活（此前每次读捏新闭 obj）", () => {
    expect(v(`const Base = function(){}; Base.prototype.x = 1; return Base.prototype.x;`)).toEqual({ ok: true, value: 1 });
  });
});

describe("P3b: 命名 fn 表达式 / expando 静态 / 直接构造", () => {
  it("命名 NFE 父类同样链接（B2.prototype.constructor === B2）", () => {
    expect(
      v(`const Base2 = function Named(){}; class B2 extends Base2 {} return B2.prototype.constructor === B2;`),
    ).toEqual({ ok: true, value: true });
    expect(
      v(`const Base2 = function Named(){}; return Base2.prototype.constructor === Base2;`),
    ).toEqual({ ok: true, value: true });
  });
  it("父 expando 静态经链读（Base2.st = 2 → B2.st；Base.px = 5 → B.px）", () => {
    expect(v(`const Base2 = function Named(){}; Base2.st = 2; class B2 extends Base2 {} return B2.st;`)).toEqual({ ok: true, value: 2 });
    expect(v(`const Base = function(){}; Base.px = 5; class B extends Base {} return B.px;`)).toEqual({ ok: true, value: 5 });
  });
  it("直接 new Base()：匿名 fn 构造器实例沿 memo prototype 折", () => {
    expect(v(`const Base = function(){}; Base.prototype.x = 1; return new Base().x;`)).toEqual({ ok: true, value: 1 });
    expect(v(`const Base = function(){}; return typeof new Base();`)).toEqual({ ok: true, value: "object" });
  });
  it("子类自有原型槽遮蔽继承槽（own 优先）", () => {
    expect(
      v(`const Base = function(){}; Base.prototype.x = 1; class B extends Base {} B.prototype.x = 2; return B.prototype.x;`),
    ).toEqual({ ok: true, value: 2 });
  });
});

describe("P3: 控制组（既有面不回归）", () => {
  it("用户类父链：constructor === B / !== A", () => {
    expect(v(`class A {} class B extends A {} return B.prototype.constructor === B;`)).toEqual({ ok: true, value: true });
    expect(v(`class A {} class B extends A {} return B.prototype.constructor === A;`)).toEqual({ ok: true, value: false });
  });
  it("用户类原型数据槽（A.prototype.x = 1 → new A().x / B.prototype.x）", () => {
    // 类名跨 run 全局驻留（registry last-wins 语义）——用独立名避免
    // 同文件其他用例对同名类原型的写串扰。
    expect(v(`class P1 {} P1.prototype.x = 1; return new P1().x;`)).toEqual({ ok: true, value: 1 });
    expect(v(`class P2 {} class Q2 extends P2 {} P2.prototype.x = 1; return Q2.prototype.x;`)).toEqual({ ok: true, value: 1 });
    expect(v(`class P3 {} class Q3 extends P3 {} P3.prototype.x = 1; return new Q3().x;`)).toEqual({ ok: true, value: 1 });
  });
  it("类表达式 / 混合表达式父类：定义期合法，类值可用（sound 降级面）", () => {
    expect(v(`class B3 extends (class {}) {} return typeof B3;`)).toEqual({ ok: true, value: "function" });
    expect(v(`const Base = function(){}; class B4 extends (Base || Object) {} return typeof B4;`)).toEqual({ ok: true, value: "function" });
  });
  it("TA / Map / Promise 内建父静态不回归", () => {
    expect(v(`class TA extends Uint8Array {} return TA.BYTES_PER_ELEMENT;`)).toEqual({ ok: true, value: 1 });
    expect(v(`class Mp extends Map {} return typeof Mp.groupBy;`)).toEqual({ ok: true, value: "function" });
    expect(v(`class Pg extends Promise {} return typeof Pg.all;`)).toEqual({ ok: true, value: "function" });
  });
});
