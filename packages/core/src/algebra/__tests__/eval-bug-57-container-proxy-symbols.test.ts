/**
 * 族 57 · W7 · core 容器 / Proxy / 符号键 —— 8 条精度债的回归钉。
 *
 * 本钉的断言口径：**对拍原生**（node v26.10.0 实测）。
 * - 标「✅ 已修」= 引擎与原生逐字一致；
 * - 标「⚠️ 已知偏差」= 引擎仍与原生有差（**修法落在别的分片的文件范围**，
 *   本钉钉住**当前**行为以免静默漂移；修法落地后本断言需由主 agent 追认
 *   更新——见文件末尾「已知偏差路由」）。
 *
 * 逐条对应（族 57 台账）：
 * 1. Bug 207  `s.size` 精确值（派生类 brand）——✅ 已是原生（闭合点：
 *           exec/class/super.ts 的 $super「不重铸 Abs」——W9 并发落盘）
 * 2. Bug 234  宿主函数面 / 命名空间面的 `constructor`——✅ 已修（本片）
 * 3. Bug 219  包装 brand（Object(5) / Object(Symbol("x"))）的成员面——✅ 已是原生
 * 4. Proxy `has` / `set` 陷阱返回值 ToBoolean 归一——✅ 已是原生
 * 5. Proxy `ownKeys` 陷阱派发通道——✅ 已是原生
 * 6. 外-02    符号键槽寻址（普通对象面）——① 读写 ✅ 已修（本片）；② `in` /
 *             `delete` ✅ 已修（exec/runtime/members.ts，W8 落盘）
 * 7. Bug 140 残余：用户 iterable 同时带索引属性 ⇒ 迭代序优先——✅ 已是原生
 * 8. `mk().x += 2` 复合赋值到「调用结果成员」——✅ 已修（exec/transpile，W9 并发落盘）
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, tupleEls } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 结果是不是「非 exact 的抽象值」（已知偏差探针：引擎说「不知道」而非「说错」） */
function isInexact(src: string): boolean {
  const r = call(src, "f").result;
  return !litValue(r).ok;
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

/** 用户 iterable（迭代序与索引序**故意不同**——用于钉「迭代序优先」） */
const USER_ITER = `[Symbol.iterator](){ let i=0; return { next(){ return i<2 ? {value:"I"+i++, done:false} : {value:undefined, done:true} } } }`;

describe("族 57 · 第 1 条 · Bug 207 · 派生类 brand 的集合 size（✅ 已是原生）", () => {
  // 原生：class S extends Set {} ⇒ new S() 是 Set ⇒ s.add(1) 后 s.size === 1。
  // 引擎此前：派生类实例的 brand（"S"）**没有**集合内部表项——集合内部表按
  // **Abs 身份**驻留（collections.ts 的 WeakMap），而 super() 归位时**重铸**
  // 了 brand Abs ⇒ 表项失联 ⇒ size 折 number/path（引擎说「不知道」）。
  // 闭合点：exec/class/super.ts 的 $super 在「已是子类 brand 名」时**不重铸
  // Abs**（原生 super() 返回的就是同一个 this）⇒ 表项随 Abs 身份存活。
  it("派生类 Set：add 后 size 是精确值（原生 1）", () => {
    expect(v(wrap(`class S extends Set {}; const s = new S(); s.add(1); return s.size;`))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("派生类 Map：set 后 size 是精确值（原生 1）", () => {
    expect(v(wrap(`class M extends Map {}; const m = new M(); m.set("a", 1); return m.size;`))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("派生类 Set：has 走条目表（原生 true）", () => {
    expect(v(wrap(`class S extends Set {}; const s = new S(); s.add(1); return s.has(1);`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控：基础 Set / Map 的 size 仍是精确值（原生 2 / 1）", () => {
    expect(v(wrap(`const s = new Set([1, 2]); return s.size;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`const m = new Map([[1, 2]]); return m.size;`))).toEqual({ ok: true, value: 1 });
  });
});

describe("族 57 · 第 2 条 · Bug 234 · 宿主函数面 / 命名空间面的 constructor（✅ 已修）", () => {
  it("函数声明的 constructor === Function（原生 true）", () => {
    expect(v(wrap(`function f(){} return f.constructor === Function;`))).toEqual({ ok: true, value: true });
  });

  it("函数声明的 constructor.name === \"Function\"（原生 \"Function\"）", () => {
    expect(v(wrap(`function f(){} return f.constructor.name;`))).toEqual({ ok: true, value: "Function" });
  });

  it("生成器声明的 constructor.name === \"GeneratorFunction\"（原生同款）", () => {
    expect(v(wrap(`function* g(){} return g.constructor.name;`))).toEqual({ ok: true, value: "GeneratorFunction" });
  });

  it("async 声明的 constructor.name === \"AsyncFunction\"（原生同款）", () => {
    expect(v(wrap(`async function h(){} return h.constructor.name;`))).toEqual({ ok: true, value: "AsyncFunction" });
  });

  it("Number.constructor === Function（原生 true）", () => {
    expect(v(wrap(`return Number.constructor === Function;`))).toEqual({ ok: true, value: true });
  });

  it("Number.constructor.name === \"Function\"（原生 \"Function\"）", () => {
    expect(v(wrap(`return Number.constructor.name;`))).toEqual({ ok: true, value: "Function" });
  });

  it("Math.constructor === Object（原生 true）——命名空间是普通对象", () => {
    expect(v(wrap(`return Math.constructor === Object;`))).toEqual({ ok: true, value: true });
  });

  it("Math.constructor.name === \"Object\"（原生 \"Object\"）", () => {
    expect(v(wrap(`return Math.constructor.name;`))).toEqual({ ok: true, value: "Object" });
  });

  it("负控：函数声明的 name / length 不受影响", () => {
    expect(v(wrap(`function f(a, b){} return f.name;`))).toEqual({ ok: true, value: "f" });
    expect(v(wrap(`function f(a, b){} return f.length;`))).toEqual({ ok: true, value: 2 });
  });

  it("负控：类值的 constructor 仍是 Function（原生 true）", () => {
    expect(v(wrap(`class A {} return A.constructor === Function;`))).toEqual({ ok: true, value: true });
  });
});

describe("族 57 · 第 3 条 · Bug 219 · 包装 brand 的成员面（✅ 已是原生）", () => {
  it("Object(Symbol('x')).toString() → \"Symbol(x)\"", () => {
    expect(v(wrap(`return Object(Symbol("x")).toString();`))).toEqual({ ok: true, value: "Symbol(x)" });
  });

  it("Object(5).valueOf() → 5", () => {
    expect(v(wrap(`return Object(5).valueOf();`))).toEqual({ ok: true, value: 5 });
  });

  it("Object(5).constructor === Number（原生 true）", () => {
    expect(v(wrap(`return Object(5).constructor === Number;`))).toEqual({ ok: true, value: true });
  });

  it("包装 brand 的同名成员带 brand check：Object(Symbol('x')).toString.call(1) → TypeError", () => {
    const src = wrap(
      `try { return Object(Symbol("x")).toString.call(1); } catch (e) { return "caught:" + e.constructor.name; }`,
    );
    expect(v(src)).toEqual({ ok: true, value: "caught:TypeError" });
  });

  it("负控：Object.prototype.toString 的泛型面不受影响", () => {
    expect(v(wrap(`return Object.prototype.toString.call({});`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  });
});

describe("族 57 · 第 4 条 · Proxy has / set 陷阱返回值 ToBoolean（✅ 已是原生）", () => {
  it("has 陷阱返回 0 → false（原生 false）", () => {
    expect(v(wrap(`const p = new Proxy({}, { has: () => 0 }); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("has 陷阱返回 \"\" → false（原生 false）", () => {
    expect(v(wrap(`const p = new Proxy({}, { has: () => "" }); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("has 陷阱返回 [] → true（对象恒真，原生 true）", () => {
    expect(v(wrap(`const p = new Proxy({}, { has: () => [] }); return ("a" in p);`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("set 陷阱返回 falsy → strict TypeError（原生 strict 同款）", () => {
    for (const raw of ["0", '""', "null", "undefined", "false"]) {
      const r = call(wrap(`const p = new Proxy({}, { set: () => ${raw} }); p.x = 1; return "nothrow";`), "f");
      expect(r.result.shape.k).toBe("never");
    }
  });

  it("负控：无 has 陷阱 → 回退靶语义（原生 false）", () => {
    expect(v(wrap(`const p = new Proxy({}, {}); return ("a" in p);`))).toEqual({ ok: true, value: false });
  });
});

describe("族 57 · 第 5 条 · Proxy ownKeys 陷阱派发通道（✅ 已是原生）", () => {
  it("Object.keys 走 ownKeys 陷阱（原生 [\"a\",\"b\"]）", () => {
    const src = wrap(`const p = new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["a", "b"] }); return Object.keys(p);`);
    expect(tupleEls(call(src, "f").result)).toEqual(["a", "b"]);
  });

  it("Reflect.ownKeys 走 ownKeys 陷阱（原生 [\"a\",\"b\"]）", () => {
    const src = wrap(`const p = new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["a", "b"] }); return Reflect.ownKeys(p);`);
    expect(tupleEls(call(src, "f").result)).toEqual(["a", "b"]);
  });

  it("ownKeys 返靶外键 → Object.keys 按可枚举性过滤（原生 []）", () => {
    const src = wrap(`const p = new Proxy({ a: 1 }, { ownKeys: () => ["b", "c"] }); return Object.keys(p);`);
    expect(tupleEls(call(src, "f").result)).toEqual([]);
  });

  it("负控：无 ownKeys 陷阱 → Object.keys 走靶面（原生 [\"a\",\"b\"]）", () => {
    const src = wrap(`return Object.keys({ a: 1, b: 2 });`);
    expect(tupleEls(call(src, "f").result)).toEqual(["a", "b"]);
  });
});

describe("族 57 · 第 6 条 · 外-02 · 符号键槽寻址（① 读写 ✅ 已修；② in/delete ✅ 已修，W8 落盘）", () => {
  it("用户符号键写后可回读（原生 1）", () => {
    const src = wrap(`const s = Symbol("x"); const o = {}; o[s] = 1; return o[s];`);
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("用户符号键写字符串值可回读（原生 \"v\"）", () => {
    const src = wrap(`const s = Symbol("x"); const o = {}; o[s] = "v"; return o[s];`);
    expect(v(src)).toEqual({ ok: true, value: "v" });
  });

  it("运行时 well-known 符号键写后可回读（原生 1）", () => {
    const src = wrap(`const s = Symbol.iterator; const o = {}; o[s] = 1; return o[s];`);
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("两个不同用户符号互不串键（原生 \"b\"）", () => {
    const src = wrap(
      `const s1 = Symbol("x"); const s2 = Symbol("x"); const o = {}; o[s1] = "a"; o[s2] = "b"; return o[s2];`,
    );
    expect(v(src)).toEqual({ ok: true, value: "b" });
  });

  it("符号槽不落字符串枚举面（原生 [\"k\"]）", () => {
    const src = wrap(`const s = Symbol("x"); const o = { k: 1 }; o[s] = 2; return Object.keys(o);`);
    expect(tupleEls(call(src, "f").result)).toEqual(["k"]);
  });

  it("负控：字符串键读写逐字不变（原生 1）", () => {
    expect(v(wrap(`const o = {}; o["k"] = 1; return o["k"];`))).toEqual({ ok: true, value: 1 });
  });

  it("负控：Proxy get 陷阱仍收到**真 symbol**（原生 \"symbol\"，不走槽寻址）", () => {
    const src = wrap(
      `const s = Symbol("x"); const p = new Proxy({}, { get: (t, k) => typeof k }); return p[s];`,
    );
    expect(v(src)).toEqual({ ok: true, value: "symbol" });
  });

  it("负控：Proxy get 陷阱收到 well-known 符号（原生 \"symbol\"）", () => {
    const src = wrap(
      `const p = new Proxy({}, { get: (t, k) => typeof k }); return p[Symbol.iterator];`,
    );
    expect(v(src)).toEqual({ ok: true, value: "symbol" });
  });

  it("负控：数组下标读写逐字不变（原生 1）", () => {
    expect(v(wrap(`const a = []; a[0] = 1; return a[0];`))).toEqual({ ok: true, value: 1 });
  });

  it("✅ 已修：用户符号的 `in` 折确定 true（原生 true）——修法在 exec/runtime/members.ts（$in，W8 落盘）", () => {
    const src = wrap(`const s = Symbol("x"); const o = {}; o[s] = 1; return s in o;`);
    expect(v(src)).toEqual({ ok: true, value: true });
  });

  it("✅ 已修：well-known 符号的 delete 删掉槽（原生 false）——修法在 exec/runtime/members.ts（$del，W8 落盘）", () => {
    const src = wrap(`const o = { [Symbol.iterator]: 1 }; delete o[Symbol.iterator]; return Symbol.iterator in o;`);
    expect(v(src)).toEqual({ ok: true, value: false });
  });
});

describe("族 57 · 第 7 条 · Bug 140 残余 · 用户 iterable 同时带索引属性（✅ 已是原生）", () => {
  it("for-of 取迭代序而非索引序（原生 [\"I0\",\"I1\"]）", () => {
    const src = wrap(
      `const o = { 0: "A", 1: "B", ${USER_ITER} }; const out = []; for (const x of o) out.push(x); return out;`,
    );
    expect(tupleEls(call(src, "f").result)).toEqual(["I0", "I1"]);
  });

  it("解构取迭代序而非索引序（原生 [\"I0\",\"I1\"]）", () => {
    const src = wrap(`const o = { 0: "A", 1: "B", ${USER_ITER} }; const [a, b] = o; return [a, b];`);
    expect(tupleEls(call(src, "f").result)).toEqual(["I0", "I1"]);
  });

  it("spread 取迭代序而非索引序（原生 [\"I0\",\"I1\"]）", () => {
    const src = wrap(`const o = { 0: "A", 1: "B", ${USER_ITER} }; return [...o];`);
    expect(tupleEls(call(src, "f").result)).toEqual(["I0", "I1"]);
  });

  it("负控：纯用户 iterable 逐字不变（原生 [\"I0\",\"I1\"]）", () => {
    const src = wrap(`const o = { ${USER_ITER} }; const out = []; for (const x of o) out.push(x); return out;`);
    expect(tupleEls(call(src, "f").result)).toEqual(["I0", "I1"]);
  });

  it("负控：Set 的 for-of 逐字不变（原生 [\"A\",\"B\"]）", () => {
    const src = wrap(`const s = new Set(["A", "B"]); const out = []; for (const x of s) out.push(x); return out;`);
    expect(tupleEls(call(src, "f").result)).toEqual(["A", "B"]);
  });
});

describe("族 57 · 第 8 条 · mk().x += 2 复合赋值（✅ 已修）", () => {
  // 原生：mk().x += 2 ⇒ 读 1 → 写 3 ⇒ 表达式值 3。
  // 引擎：复合赋值到「调用结果成员」时 transpile 走「根不可重绑」分支
  // （exec/transpile/expr/assignment.ts）——该分支此前**丢 compoundFn** ⇒ 只发
  // 右值 ⇒ 表达式值 = 2（原生 3）。现已改为读-改-写（对象只求值一次、旧值读
  // → RHS → 写），表达式值 = 3（与原生逐字一致）。
  it("mk().x += 2 折 3（原生 3）——exec/transpile/expr/assignment.ts「根不可重绑」分支补回 compoundFn", () => {
    expect(v(wrap(`function mk(){ return { x: 1 }; } return mk().x += 2;`))).toEqual({ ok: true, value: 3 });
  });

  it("计算键同款：mk()[k] += 2 折 3（原生 3）", () => {
    expect(v(wrap(`function mk(){ return { x: 1 }; } const k = "x"; return mk()[k] += 2;`))).toEqual({ ok: true, value: 3 });
  });

  it("负控：可重绑根的复合赋值逐字不变（原生 3）", () => {
    expect(v(wrap(`const o = { x: 1 }; return o.x += 2;`))).toEqual({ ok: true, value: 3 });
  });

  it("负控：可重绑根的复合赋值读回（原生 3）", () => {
    expect(v(wrap(`const o = { x: 1 }; o.x += 2; return o.x;`))).toEqual({ ok: true, value: 3 });
  });
});

/**
 * 已知偏差路由（修法落在**别的**分片的文件范围 ⇒ 本片只报告，不越界改）：
 * - 第 6 条 ②（`in` / `delete`）已由 **W8 落盘**（exec/runtime/members.ts：
 *   `$in` 的 `symSlotKey` 改用 containers/symbol-slot.ts 的
 *   `symbolSlotKeyOf`（认用户符号）；`$del` 的 `keyStr` 改为
 *   `propertyKeyOf(key) ?? symbolSlotKeyOf(key)`）⇒ 本路由条目作废。
 */
describe("族 57 · 已知偏差的抛错面不回归", () => {
  it("Symbol 键的对象不会被误判成抛错面", () => {
    const src = wrap(`const s = Symbol("x"); const o = {}; o[s] = 1; return o[s];`);
    expect(throwName(src)).toBe("");
  });
});
