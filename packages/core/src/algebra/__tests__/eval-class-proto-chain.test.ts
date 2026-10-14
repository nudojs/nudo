/**
 * 原型链 / instanceof 家族回归（Bug 50 / 58 / 64 / 65 / 67）：
 *
 * - Bug 65：`Object.prototype instanceof Object` —— Object.prototype 的
 *   [[Prototype]] 是 null（链终结符），OrdinaryHasInstance 从
 *   O.[[Prototype]] 起步比较 → instanceof 任何构造器恒 false。
 * - Bug 50：类值 `static [Symbol.hasInstance]` 此前只进 staticMethods/
 *   computedKeys，从不作为 @@hasInstance 槽挂到类值 → $instanceof 忽略。
 *   修复：计算键求值为宿主 well-known Symbol.hasInstance 时投影为
 *   "@@hasInstance" 槽（镜像对象字面量 [Symbol.X] → "@@X" 投影）；
 *   继承（D extends C）经 registry 链查找。
 * - Bug 58：protoOfRecv 无类值分支——`Object.getPrototypeOf(B) === A`
 *   折假 false。修复：类值（markClassValue）→ 父构造器（注册类值回取，
 *   引用恒等）/ Function.prototype（基类）；B.__proto__ 同款。
 * - Bug 64（链走半）：evalClassChain 按 owner 走 ".prototype" 后缀品牌——
 *   `X.prototype instanceof Super` 命中 owner 的 super 链（含内建错误
 *   层级 BUILTIN_ERROR_SUPER），`X.prototype instanceof X` 保持 false。
 *   （$get(X,"prototype") → protoBrandAbs 的品牌化半由 ContainerIdentity
 *   负责；品牌输入到达前的链逻辑用合成 protoBrandAbs 钉。）
 * - Bug 67：`class A extends null {}` 的 A.prototype [[Prototype]] 是
 *   null——protoOfRecv 的类原型品牌臂按 owner extends 投影（null /
 *   super.prototype / Object.prototype），extends null 的
 *   instanceof Object 不折 true。
 *
 * 原生 ground truth 均为 node 实测（strict）。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree 的 vite8
// 别名解析会把裸包名落到 dist 旧产物，同 eval-harness 口径）
import { call } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";
import { runTranspiled } from "../exec/run.ts";
import { protoOfRecv, protoBrandAbs, objectProtoBrand } from "../builtins/ctor.ts";
import { $instanceof } from "../exec/runtime/members.ts";

function expectExact(src: string, value: unknown) {
  expect(litValue(call(src).result)).toEqual({ ok: true, value });
}

/** 非精确但值域内不得出错的断言：abstract（ok:false）或与 native 一致 */
function expectNotWrong(src: string, native: boolean) {
  const lv = litValue(call(src).result);
  if (lv.ok) expect(lv.value).toBe(native);
  else expect(lv.ok).toBe(false);
}

describe("Bug 65 — Object.prototype instanceof X（链终结符）", () => {
  it("Object.prototype instanceof Object → false", () => {
    expectExact(`export function f() { return Object.prototype instanceof Object; }`, false);
  });
  it("controls stay native-aligned", () => {
    expectExact(`export function f() { return Error.prototype instanceof Object; }`, true);
    expectExact(`export function f() { return Function.prototype instanceof Object; }`, true);
    expectExact(`export function f() { return Object.prototype instanceof Function; }`, false);
    expectExact(`export function f() { return Object.prototype instanceof RangeError; }`, false);
  });
  it("Object.prototype.__proto__ === null", () => {
    expectExact(`export function f() { return Object.prototype.__proto__ === null; }`, true);
  });
});

describe("Bug 50 — 类值 static [Symbol.hasInstance]", () => {
  it("method form: 5 instanceof C → true / -5 → false", () => {
    expectExact(
      `export function f() { class C { static [Symbol.hasInstance](x) { return x > 0; } } return 5 instanceof C; }`,
      true,
    );
    expectExact(
      `export function f() { class C { static [Symbol.hasInstance](x) { return x > 0; } } return -5 instanceof C; }`,
      false,
    );
  });

  it("ToBoolean coercion mirrors object-literal form (return 0 → false)", () => {
    expectExact(
      `export function f() { class C { static [Symbol.hasInstance](x) { return 0; } } return 5 instanceof C; }`,
      false,
    );
  });

  it("handler applies to instances too (handler wins over chain)", () => {
    expectExact(
      `export function f() { class C { static [Symbol.hasInstance](x) { return false; } } return new C() instanceof C; }`,
      false,
    );
  });

  it("inherited through static chain (D extends C)", () => {
    expectExact(
      `export function f() { class C { static [Symbol.hasInstance](x) { return x > 0; } } class D extends C {} return 5 instanceof D; }`,
      true,
    );
  });

  it("static field form: static [Symbol.hasInstance] = arrow", () => {
    expectExact(
      `export function f() { class C { static [Symbol.hasInstance] = (x) => x > 0; } return 5 instanceof C; }`,
      true,
    );
  });

  it("first-class read of C[Symbol.hasInstance] is a function", () => {
    expectExact(
      `export function f() { class C { static [Symbol.hasInstance](x) { return true; } } return typeof C[Symbol.hasInstance]; }`,
      "function",
    );
  });

  it("left operand reaches the handler (witness binding)", () => {
    expectExact(
      `export function f() { let got = null; class C { static [Symbol.hasInstance](v) { got = v; return true; } } 5 instanceof C; return got; }`,
      5,
    );
  });
});

describe("Bug 58 — Object.getPrototypeOf(Derived) 静态链", () => {
  it("Object.getPrototypeOf(B) === A → true", () => {
    expectExact(
      `export function f() { class A {} class B extends A {} return Object.getPrototypeOf(B) === A; }`,
      true,
    );
  });

  it("Reflect.getPrototypeOf(B) === A → true", () => {
    expectExact(
      `export function f() { class A {} class B extends A {} return Reflect.getPrototypeOf(B) === A; }`,
      true,
    );
  });

  it("B.__proto__ === A → true", () => {
    expectExact(
      `export function f() { class A {} class B extends A {} return B.__proto__ === A; }`,
      true,
    );
  });

  it("static method dispatch through the chain: getPrototypeOf(B).m() → 1", () => {
    expectExact(
      `export function f() { class A { static m() { return 1; } } class B extends A {} return Object.getPrototypeOf(B).m(); }`,
      1,
    );
  });

  it("base class → Function.prototype (abstract-or-true, never wrong false)", () => {
    expectNotWrong(
      `export function f() { class A {} return Object.getPrototypeOf(A) === Function.prototype; }`,
      true,
    );
  });

  it("class E extends Error → abstract-or-true (native true)", () => {
    expectNotWrong(
      `export function f() { class E extends Error {} return Object.getPrototypeOf(E) === Error; }`,
      true,
    );
  });

  it("control: B instanceof A stays false (class value is not an instance)", () => {
    expectExact(
      `export function f() { class A {} class B extends A {} return B instanceof A; }`,
      false,
    );
  });

  it("extends null class VALUE still → Function.prototype domain", () => {
    expectNotWrong(
      `export function f() { class A extends null {} return Object.getPrototypeOf(A) === Function.prototype; }`,
      true,
    );
  });
});

describe("Bug 64 — X.prototype instanceof SuperCtor（品牌链走半）", () => {
  // $get(X,"prototype") 的品牌化（protoBrandAbs）由 ContainerIdentity 半负责；
  // 链逻辑在此用合成 protoBrandAbs 输入钉（品牌到达即正确）。
  it("synthetic: builtin error-subclass prototypes instanceof Error → true", () => {
    for (const n of [
      "RangeError", "TypeError", "ReferenceError", "SyntaxError",
      "EvalError", "URIError", "AggregateError",
    ]) {
      const r = $instanceof(protoBrandAbs(n), "Error");
      expect(litValue(r as never), n).toEqual({ ok: true, value: true });
    }
  });

  it("synthetic: user-class prototypes chain via registry extends", () => {
    runTranspiled(
      `class MyErr extends Error {}
class MyArr extends Array {}
class Mid extends Error {}
class Deep extends Mid {}`,
      { mode: "analyze" },
    );
    expect(litValue($instanceof(protoBrandAbs("MyErr"), "Error") as never)).toEqual({ ok: true, value: true });
    expect(litValue($instanceof(protoBrandAbs("MyArr"), "Array") as never)).toEqual({ ok: true, value: true });
    expect(litValue($instanceof(protoBrandAbs("MyArr"), "Object") as never)).toEqual({ ok: true, value: true });
    expect(litValue($instanceof(protoBrandAbs("Deep"), "Error") as never)).toEqual({ ok: true, value: true });
    // owner 自身不在链上（OrdinaryHasInstance 从 O.[[Proto]] 起步）
    expect(litValue($instanceof(protoBrandAbs("MyErr"), "MyErr") as never)).toEqual({ ok: true, value: false });
    expect(litValue($instanceof(protoBrandAbs("RangeError"), "TypeError") as never)).toEqual({ ok: true, value: false });
    expect(litValue($instanceof(protoBrandAbs("Error"), "Error") as never)).toEqual({ ok: true, value: false });
  });

  it("synthetic: protoOfRecv of .prototype brands walks owner extends", () => {
    runTranspiled(`class Plain {}\nclass NullBase extends null {}`, { mode: "analyze" });
    expect(litValue(protoOfRecv(protoBrandAbs("RangeError")) as never)).toEqual(
      litValue(protoBrandAbs("Error") as never),
    );
    // memoized identity: gPo(RangeError.prototype) === Error.prototype
    expect(protoOfRecv(protoBrandAbs("RangeError"))).toBe(protoBrandAbs("Error"));
    expect(protoOfRecv(protoBrandAbs("Plain"))).toBe(objectProtoBrand());
    expect(litValue(protoOfRecv(protoBrandAbs("Object")) as never)).toEqual({ ok: true, value: null });
  });

  it("end-to-end (namespace brands): Error.prototype chain", () => {
    expectExact(`export function f() { return Error.prototype instanceof Object; }`, true);
    expectExact(`export function f() { return Error.prototype instanceof Error; }`, false);
    // RangeError 非命名空间表内 ctor：$get(RangeError,"prototype") 的品牌化
    // 由 ContainerIdentity/Bug 68 半负责——品牌到达后此处折 exact true
    expectNotWrong(
      `export function f() { return Object.getPrototypeOf(RangeError.prototype) === Error.prototype; }`,
      true,
    );
    expectExact(`export function f() { return typeof Error.prototype; }`, "object");
  });
});

describe("Bug 67 — class A extends null 的原型投影", () => {
  it("synthetic: protoOfRecv(A.prototype) → null（owner extends null）", () => {
    runTranspiled(`class NullBase extends null {}`, { mode: "analyze" });
    expect(litValue(protoOfRecv(protoBrandAbs("NullBase")) as never)).toEqual({ ok: true, value: null });
    // 链终结符：extends null 的 .prototype instanceof 任何构造器恒 false
    expect(litValue($instanceof(protoBrandAbs("NullBase"), "Object") as never)).toEqual({ ok: true, value: false });
    expect(litValue($instanceof(protoBrandAbs("NullBase"), "Function") as never)).toEqual({ ok: true, value: false });
  });

  it("controls: plain class prototype → Object.prototype domain", () => {
    runTranspiled(`class Plain {}`, { mode: "analyze" });
    expect(protoOfRecv(protoBrandAbs("Plain"))).toBe(objectProtoBrand());
    expect(litValue($instanceof(protoBrandAbs("Plain"), "Object") as never)).toEqual({ ok: true, value: true });
  });

  it("open obj created from a null-terminated proto does not fold instanceof Object true", () => {
    // Object.create(<null 原型对象>) 链 null 终止：native false；
    // 引擎 protoTable 记录 + 链终止判定（不得 wrong-exact true）
    expectNotWrong(
      `export function f() { return Object.create(Object.create(null)) instanceof Object; }`,
      false,
    );
  });

  it("plain Object.create receivers keep exact instanceof Object true", () => {
    expectExact(`export function f() { return Object.create([]) instanceof Object; }`, true);
    expectExact(`export function f() { return Object.create({ x: 1 }) instanceof Object; }`, true);
  });
});
