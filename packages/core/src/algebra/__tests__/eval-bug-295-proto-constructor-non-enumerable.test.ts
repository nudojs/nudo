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
import { describe, it, expect } from "vitest";
import { litValue, formatShape } from "../index.ts";
import { call, tupleEls } from "./eval-helpers.ts";

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
