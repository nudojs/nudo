// MERGED (topic-related bug pins): eval-bug-295-enum-surface-symbol.test.ts + eval-bug-295-proto-constructor-non-enumerable.test.ts + eval-bug-295-symbol-key-enum-copy.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { litValue, num, type Abs } from "../abs.ts";
import { call, tupleEls } from "./eval-helpers.ts";
import { formatShape } from "../index.ts";
import { enumOwnKeys, enumOwnStringKeys } from "../builtins/invariants.ts";
import { objOf } from "../objects.ts";

describe("[merged] eval-bug-295-enum-surface-symbol.test.ts", () => {
/**
 * Bug 295 回归（分片：**枚举面接线**）——symbol 键（`[Symbol.X]`）不得出现在
 * **字符串键枚举面**。
 *
 * 本文件钉的是**主 agent 刚落地的枚举面接线**（for-in / keys 家族 / gOPD /
 * Reflect.ownKeys / `in`）；**复制面**（spread / Object.assign / 对象 rest）
 * 由同 bug 的另一分片 `eval-bug-295-symbol-key-enum-copy.test.ts` 钉——
 * 两套枚举口径必须分流（字符串键视图 vs CopyDataProperties 视图）。
 *
 * 原生依据（**node v26.10.0 实测**；本文件每条断言的期望值都先跑原生确认，
 * 不用印象值）：
 * - `Object.keys` / `Object.getOwnPropertyNames` / for-in / `JSON.stringify`
 *   只枚举**字符串**键 ⇒ `[Symbol.toStringTag]` 这类 symbol 键**看不到**。
 * - **Bug 1075 更正**：`Object.getOwnPropertyDescriptors` **不在**该清单里——
 *   原生 gOPDs 走 [[OwnPropertyKeys]]（**含** symbol 键：结果对象带**真
 *   symbol** 键 ⇒ `Reflect.ownKeys(gOPDs(o)).length === 2`、
 *   `Object.getOwnPropertySymbols(gOPDs(o)).length === 1`；而
 *   `Object.keys(gOPDs(o))` / `Object.getOwnPropertyNames(gOPDs(o))` 仍只有
 *   `"a"`——字符串键面不受影响）。本文件此前把 gOPDs 误列入「只枚举字符串
 *   键」清单并据此断言 ownKeys 长度 1 ⇒ 该断言钉的是**错行为**，已更正。
 * - `Reflect.ownKeys` 枚举**自有可枚举**键（字符串 + symbol）⇒ symbol 键**在**，
 *   且取回的是**真 symbol**（`typeof === "symbol"`，`=== Symbol.toStringTag`）。
 * - `"@@toStringTag" in o` 是**假**（原型链上没有这个字符串键）；
 *   `Symbol.toStringTag in o` 是**真**（symbol 键本身在）。
 *
 * 改前（改前 = HEAD，本 worktree 的枚举面接线落盘前；探针实测）：
 * - for-in 发布伪键 `"@@toStringTag"`（`"a,@@toStringTag"`）；
 * - `Object.getOwnPropertyDescriptors(o)` 含伪键（`"a,@@toStringTag"`）；
 * - `Reflect.ownKeys(o)[1]` 是**字符串**（`typeof` → `"string"`）；
 * - `"@@toStringTag" in o` 假真（原生为假）。
 *
 * 接线落点（主 agent 已落地；**本文件只钉行为，不改源码**）：
 * - `builtins/invariants.ts`：新增 `enumOwnStringKeys`（剔除 symbol 投影槽
 *   与 internal 私有槽）；`isNonEnumerable` 并查 brand 自身 / brand 内层 obj
 *   两套 flags 载体。
 * - `exec/runtime/containers/iterate.ts`：for-in 三处枚举改走字符串键视图。
 * - `builtins/object/methods.ts`：`getOwnPropertyDescriptors` 的 open/闭 obj
 *   两分支**保留** symbol 槽（Bug 1075：原生 gOPDs 含 symbol 键——symbol
 *   投影槽带 `symbolKey` 标记随结果对象走 ⇒ 字符串键面仍剔除它）；
 *   `classInstanceEnumEntries` 用剔除 symbol 的 `enumKeys`。
 * - `builtins/reflect.ts`：`Reflect.ownKeys` 把 symbol 槽还原成宿主**真 symbol**。
 * - `exec/runtime/members.ts`：`$in` 的 obj/brand 臂——symbol 键槽不被字符串
 *   键命中（原生 `"@@toStringTag" in o` === false）。
 * - `builtins/object/descriptor.ts` + `exec/class/assign.ts`：复制面携带
 *   `symbolKey` 标记（symbol 键不降级成字符串键）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 295 — 枚举面：symbol 键不进字符串键视图", () => {
  it("Object.keys({a:1, [Symbol.toStringTag]:2}) → [\"a\"]（symbol 键不进 keys）", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(o).join(",");`)),
    ).toEqual({ ok: true, value: "a" });
  });

  it("for-in {a:1, [Symbol.toStringTag]:2} → 只得 \"a\"（原生：[\"a\"]）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const r = []; for (const k in o) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Object.getOwnPropertyNames({a:1, [Symbol.toStringTag]:2}) → [\"a\"]", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.getOwnPropertyNames(o).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Object.getOwnPropertyDescriptors({a:1, [Symbol.toStringTag]:2}) → 字符串键面只有 a；自有键面含 symbol 键（Bug 1075）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(Object.getOwnPropertyDescriptors(o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.getOwnPropertyNames(Object.getOwnPropertyDescriptors(o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
    // 原生：gOPDs 走 [[OwnPropertyKeys]]——**含** symbol 键 ⇒ 自有键面 2 条
    // （"a" + Symbol.toStringTag；字符串键段在前——ES2024 OrdinaryOwnPropertyKeys）
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(Object.getOwnPropertyDescriptors(o)).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(Object.getOwnPropertyDescriptors(o))[0];`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Reflect.ownKeys({a:1, [Symbol.toStringTag]:2}) → 长度 2；[0] 是字符串 \"a\"；[1] typeof 是 \"symbol\"", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o).length;`)),
    ).toEqual({ ok: true, value: 2 });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o)[0];`)),
    ).toEqual({ ok: true, value: "a" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return typeof Reflect.ownKeys(o)[0];`)),
    ).toEqual({ ok: true, value: "string" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return typeof Reflect.ownKeys(o)[1];`)),
    ).toEqual({ ok: true, value: "symbol" });
    // 原生：ownKeys[1] 是**真 symbol**（还原成 Symbol.toStringTag 本身）
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o)[1] === Symbol.toStringTag;`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("\"@@toStringTag\" in o → false；Symbol.toStringTag in o → true（字符串键不误命中 symbol 槽）", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return ("@@toStringTag" in o);`)),
    ).toEqual({ ok: true, value: false });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return (Symbol.toStringTag in o);`)),
    ).toEqual({ ok: true, value: true });
  });

  it("Object.assign(A.prototype, {a:1, [Symbol.toStringTag]:2}) → A.prototype 的 for-in **不含** \"@@toStringTag\"", () => {
    // 原生：for-in on A.prototype → ["a"]（symbol 键不降级成字符串键）
    expect(
      v(
        wrap(
          `class Bug295SymProto {}; Object.assign(Bug295SymProto.prototype, { a: 1, [Symbol.toStringTag]: 2 }); const r = []; for (const k in Bug295SymProto.prototype) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
    // 显式负断言：伪键 "@@toStringTag" 不在枚举面里
    expect(
      v(
        wrap(
          `class Bug295SymProto2 {}; Object.assign(Bug295SymProto2.prototype, { a: 1, [Symbol.toStringTag]: 2 }); const r = []; for (const k in Bug295SymProto2.prototype) r.push(k); return r.indexOf("@@toStringTag");`,
        ),
      ),
    ).toEqual({ ok: true, value: -1 });
    // 原生同款：symbol 键本身被**拷贝**到原型上（读得到 2）
    expect(
      v(
        wrap(
          `class Bug295SymProto3 {}; Object.assign(Bug295SymProto3.prototype, { a: 1, [Symbol.toStringTag]: 2 }); return String(Bug295SymProto3.prototype[Symbol.toStringTag]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
  });

  it("JSON.stringify({a:1, [Symbol.toStringTag]:2}) → '{\"a\":1}'（symbol 键不进 JSON 面）", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return JSON.stringify(o);`)),
    ).toEqual({ ok: true, value: '{"a":1}' });
  });
});

describe("Bug 295 — 负控制：过滤只剔字符串视图，不误伤真 symbol", () => {
  it("真 symbol 键仍被命中：o[Symbol.toStringTag] 读到 2 且 Symbol.toStringTag in o 为真", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return String(o[Symbol.toStringTag]);`)),
    ).toEqual({ ok: true, value: "2" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return (Symbol.toStringTag in o);`)),
    ).toEqual({ ok: true, value: true });
  });

  it("字面量字符串键 \"@@toStringTag\" 不是 symbol 键：照常枚举（不被误剔）", () => {
    // 原生：{ "@@toStringTag": 7 } 的字符串键照常进 Object.keys / for-in
    expect(
      v(wrap(`const o = { "@@toStringTag": 7 }; return Object.keys(o).join(",");`)),
    ).toEqual({ ok: true, value: "@@toStringTag" });
    expect(
      v(
        wrap(
          `const o = { "@@toStringTag": 7 }; const r = []; for (const k in o) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "@@toStringTag" });
  });

  it("无 symbol 键的普通对象：各枚举面照常（不回归）", () => {
    expect(v(wrap(`return Object.keys({ a: 1, b: 2 }).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(v(wrap(`return Object.getOwnPropertyNames({ a: 1, b: 2 }).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(
      v(
        wrap(
          `const r = []; for (const k in { a: 1, b: 2 }) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,b" });
    expect(v(wrap(`return JSON.stringify({ a: 1, b: 2 });`))).toEqual({
      ok: true,
      value: '{"a":1,"b":2}',
    });
  });

  it("Reflect.ownKeys 仍是**字符串 + symbol** 双族视图（不是只剩字符串）", () => {
    // 原生：Reflect.ownKeys({a:1}) → ["a"]（只有字符串键时长度 1）
    expect(v(wrap(`return Reflect.ownKeys({ a: 1 }).length;`))).toEqual({
      ok: true,
      value: 1,
    });
    // 带 symbol 键时：ownKeys 的第 2 项是 **symbol 形**（不是 string 形）
    // ——格式化面把 symbol 印成 undefined，故按元素形状断言。
    const r = call(
      wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o);`),
      "f",
    ).result;
    const shape = r.shape as {
      k: string;
      elements?: { shape?: { k?: string; type?: string } }[];
    };
    expect(shape.k).toBe("tuple");
    expect(shape.elements).toHaveLength(2);
    expect(shape.elements![0].shape).toMatchObject({ k: "prim", type: "string" });
    expect(shape.elements![1].shape).toMatchObject({ k: "prim", type: "symbol" });
    // 且第 2 项就是 Symbol.toStringTag 本体（真 symbol 被还原）
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Reflect.ownKeys(o)[1] === Symbol.toStringTag;`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });
});
});

describe("[merged] eval-bug-295-proto-constructor-non-enumerable.test.ts", () => {
/**
 * Bug 295 回归（分片：**原型 `constructor` 不可枚举**）——类 / 函数原型的
 * `constructor` 是**不可枚举**自有数据属性 ⇒ 字符串键枚举面（for-in /
 * Object.keys）**看不到**它；但**不可枚举 ≠ 不可见**（gOPN 仍列它）。
 *
 * 本文件钉的是**主 agent 刚落地的枚举面接线**中「原型 `constructor` 标记」
 * 这一支（`builtins/invariants.ts` 的 flags 并查 + `builtins/ctor.ts` /
 * `exec/class-registry.ts` 的 `enumerable: false` 标记）。
 *
 * 原生依据（**node v26.10.0 实测**；每条断言的期望值都先跑原生确认）：
 * - `for (const k in A.prototype)` → **[]**（原生类方法与 `constructor` 都不可枚举）；
 * - `for (const k in Object.prototype)` → **[]**；
 * - `for (const k in (function(){}).prototype)` → **[]**；
 * - `Object.getOwnPropertyNames(A.prototype)` → **["constructor"]**
 *   （不可枚举 ≠ 不可见）；
 * - `for (const k in new A())` → **[]**（实例无自有可枚举键；`constructor`
 *   在原型上且不可枚举）。
 *
 * 改前（改前 = HEAD；探针实测）：引擎把原型的 `constructor` 当**可枚举**键
 * 发布 ⇒ `for (const k in A.prototype)` 得 `["constructor"]`、
 * `for (const k in Object.prototype)` 得 `["constructor"]`、
 * `for (const k in (function(){}).prototype)` 得 `["constructor"]`、
 * `class A{ m(){} }` 的原型 for-in 得 `["constructor"]`。
 *
 * 接线落点（主 agent 已落地；**本文件只钉行为，不改源码**）：
 * - `builtins/invariants.ts`：`isNonEnumerable` / `enumOwnKeys` /
 *   `enumOwnStringKeys` / `isEnumerableView` 经 `isNonEnumerable` 判定——
 *   该函数**并查两套 flags 载体**（brand 自身的 flags + brand 内层 obj 的
 *   flags），修掉「原型 `constructor` 的不可枚举标记挂在 brand、枚举面却查
 *   inner ⇒ 漏查」的缺陷。
 * - `exec/runtime/containers/iterate.ts`：for-in 三处枚举改走
 *   `enumOwnStringKeys`；brand 原型自身那处把 **brand**（不是 inner）传给
 *   枚举面以查 flags。
 * - `builtins/ctor.ts`：`protoBrandAbs(name)` 给 prototype 的 `constructor` 槽
 *   打 `enumerable: false`。
 * - `exec/class-registry.ts`：`fnProtoOf` 给函数原型的 `constructor` 槽打
 *   `enumerable: false`（`Object.prototype` 早就这么打）。
 *
 * ⚠️ **类名唯一性**：引擎的类注册表按**类名**全局驻留（`classRegistry` /
 * `protoBrandByName`），同名类跨求值 run 共享同一原型对象 ⇒ 本文件每个用例
 * 用**互不相同**的类名，避免用例间互相污染。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 295 — 原型 `constructor` 不可枚举：for-in 枚举面看不到它", () => {
  it("class A{} → for (const k in A.prototype) 是**空**（原生 []；改前引擎给 [\"constructor\"]）", () => {
    expect(
      v(
        wrap(
          `class Bug295ProtoA {}; const r = []; for (const k in Bug295ProtoA.prototype) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "" });
    expect(
      v(
        wrap(
          `class Bug295ProtoA2 {}; const r = []; for (const k in Bug295ProtoA2.prototype) r.push(k); return r.length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it("for (const k in Object.prototype) 是**空**（原生 []；改前引擎给 [\"constructor\"]）", () => {
    expect(
      v(wrap(`const r = []; for (const k in Object.prototype) r.push(k); return r.join(",");`)),
    ).toEqual({ ok: true, value: "" });
    expect(
      v(wrap(`const r = []; for (const k in Object.prototype) r.push(k); return r.length;`)),
    ).toEqual({ ok: true, value: 0 });
  });

  it("(function(){}).prototype 的 for-in 是**空**（原生 []；改前引擎给 [\"constructor\"]）", () => {
    expect(
      v(wrap(`const r = []; for (const k in (function(){}).prototype) r.push(k); return r.join(",");`)),
    ).toEqual({ ok: true, value: "" });
    expect(
      v(wrap(`const r = []; for (const k in (function(){}).prototype) r.push(k); return r.length;`)),
    ).toEqual({ ok: true, value: 0 });
  });

  it("class A{ m(){} } → for (const k in A.prototype) 是**空**（类方法本身也不可枚举）", () => {
    expect(
      v(
        wrap(
          `class Bug295ProtoB { m() {} } const r = []; for (const k in Bug295ProtoB.prototype) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "" });
    expect(
      v(
        wrap(
          `class Bug295ProtoB2 { m() {} } const r = []; for (const k in Bug295ProtoB2.prototype) r.push(k); return r.length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it("class A{} → new A() 实例的 for-in 是**空**（实例无自有可枚举键）", () => {
    expect(
      v(
        wrap(
          `class Bug295ProtoC {}; const r = []; for (const k in new Bug295ProtoC()) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "" });
    expect(
      v(
        wrap(
          `class Bug295ProtoC2 {}; const r = []; for (const k in new Bug295ProtoC2()) r.push(k); return r.length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it("实例的原型面同样为空：for (const k in Object.getPrototypeOf(new A()))", () => {
    expect(
      v(
        wrap(
          `class Bug295ProtoD {}; const r = []; for (const k in Object.getPrototypeOf(new Bug295ProtoD())) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "" });
  });
});

describe("Bug 295 — 不可枚举 ≠ 不可见：gOPN 仍列 `constructor`", () => {
  it("Object.getOwnPropertyNames(A.prototype) 精确 [\"constructor\"]（原生 [\"constructor\"]）", () => {
    // 原生 oracle（node v26）：["constructor"]。
    // 引擎口径（族 58 · Bug 321/3 落盘后）：类原型的 gOPN 由**保守域** `string[]`
    // 升为**精确元组** ["constructor"]（引擎已建模该原型的自有成员 ⇒ 自有键集
    // 静态可知）——与原生 oracle 逐字一致（本断言由「保守域」期望**加强**为
    // 「精确原生」期望，未删未弱化）。
    const r = call(
      wrap(`class Bug295ProtoE {}; return Object.getOwnPropertyNames(Bug295ProtoE.prototype);`),
      "f",
    ).result;
    expect(formatShape(r)).toBe('["constructor"]');
    expect(tupleEls(r)).toEqual(["constructor"]);
    // 可见性（精确）：`constructor` 是原型的**自有**属性——不可枚举 ≠ 不可见
    expect(
      v(
        wrap(
          `class Bug295ProtoE2 {}; return Object.prototype.hasOwnProperty.call(Bug295ProtoE2.prototype, "constructor");`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("函数原型：Object.getOwnPropertyNames((function(){}).prototype) → 精确 [\"constructor\"]（原生同款）", () => {
    expect(
      v(wrap(`return Object.getOwnPropertyNames((function(){}).prototype).join(",");`)),
    ).toEqual({ ok: true, value: "constructor" });
    // 同一枚硬币的另一面：它**不可枚举** ⇒ Object.keys 看不到
    expect(
      v(wrap(`return Object.keys((function(){}).prototype).join(",");`)),
    ).toEqual({ ok: true, value: "" });
  });

  it("原生描述符口径：函数原型的 constructor 描述符 enumerable 为 false", () => {
    // 原生 oracle：`Object.getOwnPropertyDescriptor((function(){}).prototype,
    // "constructor").enumerable` → false
    expect(
      v(
        wrap(
          `const d = Object.getOwnPropertyDescriptor((function(){}).prototype, "constructor"); return d.enumerable;`,
        ),
      ),
    ).toEqual({ ok: true, value: false });
  });
});
});

describe("[merged] eval-bug-295-symbol-key-enum-copy.test.ts", () => {
/**
 * Bug 295 回归：symbol 键（`[Symbol.X]`）在**复制面**不得退化成普通字符串键。
 *
 * ES 语义（node v26 实测）：
 * - `[Symbol.X]` 是 **symbol 键**，不是字符串键 `"@@X"`；引擎的槽表用
 *   `"@@X"` 作投影键 + `Slot.symbolKey` 标记表示它（Bug 73/117）。
 * - `Object.assign` / spread / **对象 rest** 复制的是**可枚举 symbol 键本身**
 *   （node 实测 rest 也拷 symbol ⇒ `rest[Symbol.toStringTag] === 2`）⇒
 *   复制后 `Object.keys/values/entries` / `JSON.stringify` **看不到**它，
 *   但 `t[Symbol.toStringTag]` **读得到**值。
 * - for-in / `Object.keys|values|entries` / `getOwnPropertyNames` /
 *   `getOwnPropertyDescriptors` / `JSON.stringify` **只枚举字符串键**。
 *
 * 修复前：`exec/class/assign.ts` 的 mergeObj 拷源槽时**丢掉 symbolKey 标记**
 * ⇒ `"@@X"` 投影槽退化成**普通字符串键** ⇒ 目标上的伪键进了
 * `Object.keys/values/entries` / `JSON.stringify` 面（原生看不到）。
 *
 * 修法（`exec/class/assign.ts`）：拷贝时**迁移源槽的 symbolKey 标记**。
 *
 * ⚠️ 本条只修**复制面**。其余枚举面（for-in / gOPD / Reflect.ownKeys /
 * `in`）的修复需改**本分片清单外**的文件（见报告越界诉求）：
 * `builtins/invariants.ts` 已**留好接口** `enumOwnStringKeys`（字符串键
 * 视图）+ `enumOwnKeys`（CopyDataProperties 视图，含 symbol 键）。
 */








const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 295 — Object.assign 复制 symbol 键时不退化成字符串键", () => {
  it("Object.keys(Object.assign({}, o))：只含字符串键 \"a\"（改前含伪键 \"@@toStringTag\"）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(Object.assign({}, o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Object.values(Object.assign({}, o))：只含字符串键的值（改前含 2）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.values(Object.assign({}, o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("Object.entries(Object.assign({}, o))：只含字符串键的条目（改前含 \"@@toStringTag:2\"）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.entries(Object.assign({}, o)).map((e) => e.join(":")).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a:1" });
  });

  it("JSON.stringify(Object.assign({}, o))：不发布伪键（改前含 \"@@toStringTag\"）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return JSON.stringify(Object.assign({}, o));`,
        ),
      ),
    ).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("Object.getOwnPropertyNames(Object.assign({}, o))：只含字符串键（改前含伪键）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.getOwnPropertyNames(Object.assign({}, o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Object.assign 仍**拷贝** symbol 键本身：t[Symbol.toStringTag] 读得到 2（原生同款）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const t = Object.assign({}, o); return String(t[Symbol.toStringTag]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
  });
});

describe("Bug 295 — 负控制（复制面 / 枚举面的邻近形态不回归）", () => {
  it("源对象自身的字符串键枚举面不变：Object.keys/values/entries/JSON.stringify", () => {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(o).join(",");`)),
    ).toEqual({ ok: true, value: "a" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.values(o).join(",");`)),
    ).toEqual({ ok: true, value: "1" });
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.entries(o).map((e) => e.join(":")).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a:1" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return JSON.stringify(o);`)),
    ).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("spread / 对象 rest 仍**拷贝** symbol 键（原生同款：node 实测 rest 也拷）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const t = { ...o }; return String(t[Symbol.toStringTag]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const { a, ...rest } = o; return String(rest[Symbol.toStringTag]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
  });

  it("无 symbol 键的普通对象：assign / 枚举面照常", () => {
    expect(v(wrap(`return Object.keys(Object.assign({}, { a: 1, b: 2 })).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(v(wrap(`return Object.getOwnPropertyNames({ a: 1, b: 2 }).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
  });

  it("字面量字符串键 \"@@toStringTag\" 不是 symbol 键：照常枚举（不被误剔）", () => {
    expect(
      v(wrap(`const o = { "@@toStringTag": 7 }; return Object.keys(Object.assign({}, o)).join(",");`)),
    ).toEqual({ ok: true, value: "@@toStringTag" });
  });
});

describe("Bug 295 — 枚举视图两套口径（留接口：enumOwnKeys vs enumOwnStringKeys）", () => {
  const o = objOf({
    a: { value: num() },
    "@@toStringTag": { value: num(), symbolKey: true },
  });
  const slots = (o.shape as Extract<Abs["shape"], { k: "obj" }>).slots;

  it("enumOwnKeys = CopyDataProperties 视图（含 symbol 键——spread/assign 拷贝链要它）", () => {
    expect(enumOwnKeys(o, slots).sort()).toEqual(["@@toStringTag", "a"]);
  });

  it("enumOwnStringKeys = 字符串键视图（剔除 symbol 投影槽——for-in / keys 家族要它）", () => {
    expect(enumOwnStringKeys(o, slots)).toEqual(["a"]);
  });
});
});
