/**
 * 模块套件：求值面：内置对象/容器/字符串。
 */
import { describe, expect, it } from "vitest";
import { abs, litValue, num, type Abs } from "../abs.ts";
import { STRING_METHODS } from "../exec/member-diag.ts";
import { call, effects, throwsError, isNever, val, tupleEls } from "./eval-helpers.ts";
import { litValue as litValue___nudojs_core, formatShape as formatShape___nudojs_core, runTranspiled, callTranspiledExportFull, abs as abs___nudojs_core, } from "@nudojs/core";
import { formatShape, checkSource as checkSource_____index_ts, pTrue } from "../index.ts";
import { enumOwnKeys, enumOwnStringKeys } from "../builtins/invariants.ts";
import { objOf } from "../objects.ts";
import { l2Count, sigOf } from "./nudo-constraints.ts";
import { checkSource } from "../check/check.ts";
import { hostNameAvailable } from "./builtin-coverage-registry.ts";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../diagnostics/may-throw.ts";
import { v as termVar, lit as termLit } from "../term.ts";
import { and, gt, lt, type Pred } from "../pred.ts";

// ---------------------------------------------------------------------------
// String.prototype ES2017 别名（trimLeft / trimRight）方法值读
// ---------------------------------------------------------------------------
describe("String.prototype ES2017 别名（trimLeft / trimRight）方法值读", () => {
/**
 * 回归钉：String.prototype 的 **ES2017 别名**（trimLeft / trimRight）
 * 方法值读通道（core `exec/member-diag.ts` 的 `STRING_METHODS` 白名单）。
 *
 * 病灶（修前，HEAD 4d1a249d）：
 * - `STRING_METHODS` 只列了 `trimStart` / `trimEnd`，漏列宿主**真实存在**的
 * 两个 ES2017 别名 `trimLeft` / `trimRight`（≡ trimStart / trimEnd，原生
 * 同一内置）⇒ 同一引擎两套字符串方法名集合自相矛盾：
 * - 派发面（`algebra/methods.ts`）认识这两个别名 ⇒ `s.trimLeft()` 正常；
 * - 读面（`STRING_METHODS`）不认识 ⇒ prim 接收者值读落 exact `undefined`
 * （原生是 function）⇒ 原型对象面 `String.prototype.trimLeft` 同落
 * `undefined` ⇒ `String.prototype.trimLeft.call(s)` ⇒「property 'call'
 * on undefined」⇒ 硬 TypeError ⇒ **L2 门禁假红**（nudo:entry-may-throw）。
 *
 * 修法：`STRING_METHODS` 补 `"trimLeft"` / `"trimRight"`（只加表项，不动
 * 导出面）。
 *
 * 原生 ground truth：node v26.10.0 实测对照
 * （`Object.getOwnPropertyNames(String.prototype)` 自有方法 50 个 = 本表 50 个，
 * 无漏列 / 无多列）。
 */





/** 抽象 prim string 实参（等价于侧车把形参约束成 string()） */
const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");


  it("prim 接收者：别名的方法值读是 function（原生同）；原型对象面：String.prototype.<别名> 值读是 function（原生同）；调用面别修坏：别名 ≡ trimStart / trimEnd（原生同）；负控：表外名字仍折 exact undefined（没把整张表改成全放行）；may-throw 通道：String.prototype.<别名>.call(s) 不再记 TypeError（L2 假红消失）；表与宿主同名集同源（node 实测对拍，防", () => {
  {
    expect(litValue(call(`export function f(){ return typeof " ab ".trimLeft; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f(){ return typeof " ab ".trimRight; }`).result))
      .toEqual({ ok: true, value: "function" });
    // 对照：早就在表内的 trimStart / trimEnd 同为 function（别修坏）
    expect(litValue(call(`export function f(){ return typeof " ab ".trimStart; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f(){ return typeof " ab ".trimEnd; }`).result))
      .toEqual({ ok: true, value: "function" });
  }
  {
    expect(litValue(call(`export function f(){ return typeof String.prototype.trimLeft; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f(){ return typeof String.prototype.trimRight; }`).result))
      .toEqual({ ok: true, value: "function" });
    // 对照
    expect(litValue(call(`export function f(){ return typeof String.prototype.trimStart; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f(){ return typeof String.prototype.trimEnd; }`).result))
      .toEqual({ ok: true, value: "function" });
  }
  {
    // 原生 trimLeft 只削左、trimRight 只削右（修前修后同）
    expect(litValue(call(`export function f(){ return " ab ".trimLeft(); }`).result))
      .toEqual({ ok: true, value: "ab " });
    expect(litValue(call(`export function f(){ return " ab ".trimRight(); }`).result))
      .toEqual({ ok: true, value: " ab" });
    expect(litValue(call(`export function f(){ return " ab".trimLeft(); }`).result))
      .toEqual({ ok: true, value: "ab" });
    expect(litValue(call(`export function f(){ return "ab ".trimRight(); }`).result))
      .toEqual({ ok: true, value: "ab" });
    // 对照：与别名同构的 trimStart / trimEnd
    expect(litValue(call(`export function f(){ return " ab ".trimStart(); }`).result))
      .toEqual({ ok: true, value: "ab " });
    expect(litValue(call(`export function f(){ return " ab ".trimEnd(); }`).result))
      .toEqual({ ok: true, value: " ab" });
  }
  {
    expect(litValue(call(`export function f(){ return typeof " ab ".notARealMethod; }`).result))
      .toEqual({ ok: true, value: "undefined" });
    expect(litValue(call(`export function f(){ return typeof String.prototype.notAReal; }`).result))
      .toEqual({ ok: true, value: "undefined" });
    // 本体是 exact undefined（不是 unknown——unknown 是「推断失败」，不是宿主真值）
    expect(litValue(call(`export function f(){ return " ab ".notARealMethod; }`).result))
      .toEqual({ ok: true, value: undefined });
    expect(litValue(call(`export function f(){ return String.prototype.notAReal; }`).result))
      .toEqual({ ok: true, value: undefined });
  }
  {
    // 字面量接收者：effects() 收集 may-throw 效果面
    expect(effects(`export function f(){ return String.prototype.trimLeft.call(" ab "); }`))
      .toEqual([]);
    expect(effects(`export function f(){ return String.prototype.trimRight.call(" ab "); }`))
      .toEqual([]);
    // 对照（早就在表内）：同样零效果
    expect(effects(`export function f(){ return String.prototype.trimEnd.call(" ab "); }`))
      .toEqual([]);
    // 负控：表外名字仍记 TypeError（没把整张表改成全放行）
    expect(effects(`export function f(){ return String.prototype.notAReal.call(" ab "); }`))
      .toEqual(["TypeError"]);

    // 抽象 string 接收者：throws 面不得是 TypeError
    const ok1 = call(`export function f(s){ return String.prototype.trimLeft.call(s); }`, "f", [strAbs]);
    expect(throwsError(ok1.throws, "TypeError")).toBe(false);
    const ok2 = call(`export function f(s){ return String.prototype.trimRight.call(s); }`, "f", [strAbs]);
    expect(throwsError(ok2.throws, "TypeError")).toBe(false);
    // 对照
    const ok3 = call(`export function f(s){ return String.prototype.trimEnd.call(s); }`, "f", [strAbs]);
    expect(throwsError(ok3.throws, "TypeError")).toBe(false);
    // 负控
    const bad = call(`export function f(s){ return String.prototype.notAReal.call(s); }`, "f", [strAbs]);
    expect(throwsError(bad.throws, "TypeError")).toBe(true);
  }
  {
    const host = Object.getOwnPropertyNames(String.prototype)
      .filter((n) => n !== "length" && n !== "name" && n !== "constructor")
      .sort();
    const table = [...STRING_METHODS].sort();
    expect(
      table.filter((n) => !host.includes(n)),
      "表里多出的名字（宿主 String.prototype 无此方法）",
    ).toEqual([]);
    expect(
      host.filter((n) => !STRING_METHODS.has(n)),
      "宿主有、表漏的名字（漏列 ⇒ 值读折 exact undefined ⇒ 调用即抛 ⇒ L2 假红）",
    ).toEqual([]);
  }
});






});

// ---------------------------------------------------------------------------
// Proxy has 陷阱返回值 ToBoolean
// ---------------------------------------------------------------------------
describe("Proxy has 陷阱返回值 ToBoolean", () => {
/**
 * 回归：Proxy `has` 陷阱的返回值必须按规范 **ToBoolean**。
 *
 * ES 语义（`[[HasProperty]]` → `ToBoolean(trapResult)`）：
 * `has:()=>0` → false、`has:()=>1` → true、`has:()=>""` → false、
 * `has:()=>null` → false、`has:()=>[]` → true（对象恒真）。
 *
 * 修复前：`$in` 把陷阱的**原始返回值**直接当判定结果（number 0 折「有」、
 * 空串折「有」：wrong-exact——`"a" in p` 与原生相反）。
 *
 * `set` 陷阱的同款 ToBoolean 缺口在 member.ts 的 set 臂（本分片越界 → S3
 * 分片已接线：`rv.ok && !rv.value` → falsy 一律 strict TypeError；
 * containers/arr-index.ts 的下标写 Proxy 臂同款）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 结果字面量值（litValue）——别名（避开 describe 内的 v 遮蔽） */
function v2(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}


  it("has:()=>0 → false（此前折「有」）；has:()=>1 → true；has:()=>\"\" → false（此前折「有」）；has:()=>null → false；has:()=>[] → true（对象恒真）；负控制：has:()=>true → true；负控制：无 has 陷阱 → 回退靶语义（普通对象缺席 → false）；Proxy set 陷阱返回 falsy 非 false（0/\"\"/null/undefined）→ strict TypeEr", () => {
  {
    expect(v(wrap(`const p=new Proxy({},{has:()=>0}); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    expect(v(wrap(`const p=new Proxy({},{has:()=>1}); return ("a" in p);`))).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    expect(v(wrap(`const p=new Proxy({},{has:()=>""}); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    expect(v(wrap(`const p=new Proxy({},{has:()=>null}); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    expect(v(wrap(`const p=new Proxy({},{has:()=>[]}); return ("a" in p);`))).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    expect(v(wrap(`const p=new Proxy({},{has:()=>true}); return ("a" in p);`))).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    expect(v(wrap(`const p=new Proxy({},{ }); return ("a" in p);`))).toEqual({ ok: true, value: false });
  }
  {
    for (const v of ["0", '""', "null", "undefined"]) {
      const r = call(wrap(`const p=new Proxy({},{set:()=>${v}}); p.x=1; return "nothrow";`), "f");
      expect(r.result.shape.k).toBe("never");
    }
  }
  {
    for (const v of ["true", "1"]) {
      expect(v2(wrap(`const p=new Proxy({},{set:()=>${v}}); p.x=1; return "nothrow";`))).toEqual({
        ok: true,
        value: "nothrow",
      });
    }
  }
});









});

// ---------------------------------------------------------------------------
// Proxy [[Get]] 不变量（不可配置+不可写属性须返回实际值）
// ---------------------------------------------------------------------------
describe("Proxy [[Get]] 不变量（不可配置+不可写属性须返回实际值）", () => {
/**
 * 回归：Proxy **不变量校验**（ES2024 10.5 Proxy 内部方法）。
 *
 * ① [[Get]] 不变量（ES2024 10.5.4 step 6）：靶上某自有属性**不可配置且
 * 不可写**（数据属性）时，get 陷阱的返回值必须与靶的实际值 SameValue，
 * 否则原生定抛 TypeError（"'get' on proxy: property 'a' is a read-only
 * and non-configurable data property on the proxy target but the proxy
 * did not return its actual value"）。
 * —— 只在**同时**不可写 + 不可配置时成立：仅不可写（configurable:true）
 * / 仅不可配置（writable:true）/ 密封靶（不可配置但可写）都**不**抛。
 * ② [[OwnPropertyKeys]] 不变量（ES2024 10.5.5）：陷阱结果不得含重复项、
 * 不得含非字符串/symbol 键；靶的**不可配置**自有键必须都在陷阱结果里
 * （与靶可扩展性无关）；靶**不可扩展**时陷阱结果须恰为靶的自有键集
 * （不多不少——多余键也抛）。
 * ③ [[OwnPropertyKeys]] **派发点**：handler 的 "ownKeys" 陷阱此前从不被
 * 调用（Reflect.ownKeys / Object.keys / Object.getOwnPropertyNames 直
 * 接走靶面）——原生先查 handler 的 "ownKeys" 槽；无陷阱时转发靶面。
 *
 * 修复前：引擎的 Proxy 内部方法只做「派发陷阱 + 采用返回值」，零不变量
 * 校验 → 上述四类原生 TypeError 全部静默通过（wrong-exact）。
 *
 * 成员读面（`p.a`）的 [[Get]] 不变量在 exec/runtime/containers/member.ts
 * 的陷阱臂——已接线（该臂取到陷阱返回值后过 state.ts 的
 * enforceProxyGetInvariant）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("Reflect.get(冻结靶代理, 'a') → TypeError（此前折 2 且声称不抛）；冻结靶 + 陷阱返回**实际值** → 正常返回 1；冻结靶 + 读**非自有**键 → 不抛（不变量只管自有属性）；仅不可写（configurable:true）→ 不抛；仅不可配置（writable:true）→ 不抛；密封靶（不可配置但可写）→ 不抛；负控制：普通冻结对象读 → 1（不涉及 Proxy）；负控制：可扩展靶 + get 陷阱 → 2（无 [[Get]] 约束）", () => {
  {
    expect(
      throwName(
        wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"a");`),
      ),
    ).toBe("TypeError");
  }
  {
    expect(
      v(wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>1}); return Reflect.get(p,"a");`)),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"b");`)),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      v(
        wrap(
          `const t={}; Object.defineProperty(t,"a",{value:1,writable:false,configurable:true}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"a");`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      v(
        wrap(
          `const t={}; Object.defineProperty(t,"a",{value:1,writable:true,configurable:false}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"a");`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      v(wrap(`const t=Object.seal({a:1}); const p=new Proxy(t,{get:()=>2}); return Reflect.get(p,"a");`)),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(v(wrap(`const o=Object.freeze({a:1}); return o.a;`))).toEqual({ ok: true, value: 1 });
  }
  {
    expect(v(wrap(`const p=new Proxy({a:1},{get:()=>2}); return Reflect.get(p,"a");`))).toEqual({
      ok: true,
      value: 2,
    });
  }
  {
    expect(
      throwName(wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>2}); return p.a;`)),
    ).toBe("TypeError");
  }
  {
    expect(
      v(wrap(`const t=Object.freeze({a:1}); const p=new Proxy(t,{get:()=>1}); return p.a;`)),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(
        wrap(
          `const t={}; Object.defineProperty(t,"a",{value:1,writable:false,configurable:true}); const p=new Proxy(t,{get:()=>2}); return p.a;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(v(wrap(`const p=new Proxy({a:1},{get:()=>2}); return p.a;`))).toEqual({
      ok: true,
      value: 2,
    });
  }
});













describe("Proxy [[OwnPropertyKeys]] 不变量 + 陷阱派发", () => {
  it("ownKeys 陷阱结果含重复名 → TypeError（此前折 'a,a'）；不可扩展靶 + 陷阱漏掉其自有键 → TypeError（此前折 'b'）；不可扩展靶 + 陷阱**多出**靶没有的键 → TypeError（此前折 'a,b'）；可扩展靶 + 陷阱漏掉其**不可配置**自有键 → TypeError（此前折 ''）；ownKeys 陷阱结果含非字符串键 → TypeError；ownKeys 陷阱返回非对象 → TypeError；gOPN 走 ownKeys", () => {
  {
    expect(
      throwName(wrap(`const p=new Proxy({},{ownKeys:()=>["a","a"]}); return Reflect.ownKeys(p).join(",");`)),
    ).toBe("TypeError");
  }
  {
    expect(
      throwName(
        wrap(`const t=Object.preventExtensions({a:1}); const p=new Proxy(t,{ownKeys:()=>["b"]}); return Reflect.ownKeys(p).join(",");`),
      ),
    ).toBe("TypeError");
  }
  {
    expect(
      throwName(
        wrap(`const t=Object.preventExtensions({a:1}); const p=new Proxy(t,{ownKeys:()=>["a","b"]}); return Reflect.ownKeys(p).join(",");`),
      ),
    ).toBe("TypeError");
  }
  {
    expect(
      throwName(
        wrap(`const t={}; Object.defineProperty(t,"a",{value:1,configurable:false}); const p=new Proxy(t,{ownKeys:()=>[]}); return Reflect.ownKeys(p).join(",");`),
      ),
    ).toBe("TypeError");
  }
  {
    expect(
      throwName(wrap(`const p=new Proxy({},{ownKeys:()=>[1]}); return Reflect.ownKeys(p).join(",");`)),
    ).toBe("TypeError");
  }
  {
    expect(
      throwName(wrap(`const p=new Proxy({},{ownKeys:()=>1}); return Reflect.ownKeys(p).join(",");`)),
    ).toBe("TypeError");
  }
  {
    expect(
      throwName(
        wrap(`const p=new Proxy({},{ownKeys:()=>["a","a"]}); return Object.getOwnPropertyNames(p).join(",");`),
      ),
    ).toBe("TypeError");
  }
  {
    expect(
      v(wrap(`const p=new Proxy({a:1},{ownKeys:()=>["a","b"]}); return Reflect.ownKeys(p).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  }
  {
    expect(
      v(wrap(`const p=new Proxy({a:1,b:2},{ownKeys:()=>["a"]}); return Object.keys(p).join(",");`)),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(
      v(wrap(`const p=new Proxy({a:1,b:2},{ownKeys:()=>["a"]}); return Object.getOwnPropertyNames(p).join(",");`)),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(
      v(wrap(`const p=new Proxy({a:1,b:2},{}); return Reflect.ownKeys(p).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
    expect(v(wrap(`const p=new Proxy({a:1,b:2},{}); return Object.keys(p).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(
      v(wrap(`const p=new Proxy({a:1,b:2},{}); return Object.getOwnPropertyNames(p).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  }
  {
    expect(v(wrap(`return Reflect.ownKeys({a:1,b:2}).join(",");`))).toEqual({ ok: true, value: "a,b" });
    expect(v(wrap(`return Object.keys({a:1,b:2}).join(",");`))).toEqual({ ok: true, value: "a,b" });
  }
});











});
});

// ---------------------------------------------------------------------------
// 内建命名空间对象的 Symbol.toStringTag
// ---------------------------------------------------------------------------
describe("内建命名空间对象的 Symbol.toStringTag", () => {
/**
 * 回归：内建命名空间对象（Math / JSON / Reflect / Intl / Atomics）的
 * `Symbol.toStringTag` 必须读到**原生标签**。
 *
 * ES 语义：命名空间对象把 `Symbol.toStringTag` 挂在**自己**上（自有数据属性）
 * —— `Math[Symbol.toStringTag] === "Math"`、`Atomics[Symbol.toStringTag] ===
 * "Atomics"`；`Object.prototype.toString.call(Math)` → "[object Math]"。
 *
 * 修复前：符号键投影（"@@toStringTag"）在宿主对象上按**投影串**裸读 ⇒ 恒
 * undefined（wrong-exact：自信的错值）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}


  it("命名空间对象的 Symbol.toStringTag 是原生标签；标签面：Object.prototype.toString.call(命名空间) → [object X]；负控制：字面量串键 \"@@toStringTag\" 仍是字符串键（不被当成 symbol）；负控制：普通对象无 Symbol.toStringTag（标签仍是 [object Object]）；负控制：函数值的标签面不变", () => {
  {
    for (const [ns, tag] of [
      ["Math", "Math"],
      ["JSON", "JSON"],
      ["Reflect", "Reflect"],
      ["Intl", "Intl"],
      ["Atomics", "Atomics"],
    ] as const) {
      expect(v(wrap(`return String(${ns}[Symbol.toStringTag]);`))).toEqual({
        ok: true,
        value: tag,
      });
    }
  }
  {
    for (const [ns, tag] of [
      ["Math", "Math"],
      ["JSON", "JSON"],
      ["Reflect", "Reflect"],
      ["Intl", "Intl"],
      ["Atomics", "Atomics"],
    ] as const) {
      expect(v(wrap(`return Object.prototype.toString.call(${ns});`))).toEqual({
        ok: true,
        value: `[object ${tag}]`,
      });
    }
  }
  {
    expect(v(wrap(`const o = { "@@toStringTag": 1 }; return String(o["@@toStringTag"]);`))).toEqual({
      ok: true,
      value: "1",
    });
  }
  {
    expect(v(wrap(`return Object.prototype.toString.call({});`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  }
  {
    expect(v(wrap(`return Object.prototype.toString.call(Math.max);`))).toEqual({
      ok: true,
      value: "[object Function]",
    });
  }
});





});

// ---------------------------------------------------------------------------
// length 域校验走 ToNumber（具体非数值定抛 RangeError）
// ---------------------------------------------------------------------------
describe("length 域校验走 ToNumber（具体非数值定抛 RangeError）", () => {
/**
 * `a.length = undefined` / `a.length = {}` 不抛 RangeError（原生
 * `Invalid array length`）→ 数值域校验只覆盖**数字**字面量，具体非数值被
 * 误当抽象值放行 → 门禁假绿。
 *
 * 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts
 * 的 `lengthToNumber`）：原生 ArraySetLength 先 `ToNumber(value)` 再判整数与
 * [0, 2^32-1] 界——引擎此前只判「**数字**字面量」，具体非数值（undefined /
 * {} / "abc"）落进抽象回退（不抛）。
 *
 * 负控制：数字 / 数字字符串 / null / 布尔 / 数组字面量（ToNumber 合法）→
 * 原生不抛；小数 / 负数（既有 RangeError）保持。
 */




function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

function threw(src: string, name = "RangeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}


  it("a.length = undefined → RangeError；a.length = {} → RangeError；a.length = \"abc\" → RangeError；负控制：a.length = 1 → length = 1；负控制：a.length = \"2\" → length = 2（ToNumber 合法）；负控制：a.length = null → length = 0；负控制：a.length = true → length = 1；负控制：a.le", () => {
  {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = undefined;
        return "nothrow";
      }`),
    ).toBe(true);
  }
  {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = {};
        return "nothrow";
      }`),
    ).toBe(true);
  }
  {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = "abc";
        return "nothrow";
      }`),
    ).toBe(true);
  }
  {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = 1;
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = "2";
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = null;
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 0 });
  }
  {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = true;
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        a.length = [];
        return a.length;
      }`),
    ).toEqual({ ok: true, value: 0 });
  }
  {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = 1.7;
        return "nothrow";
      }`),
    ).toBe(true);
  }
  {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        a.length = -1;
        return "nothrow";
      }`),
    ).toBe(true);
  }
});










});

// ---------------------------------------------------------------------------
// 数组 expando 键读回不得假精确
// ---------------------------------------------------------------------------
describe("数组 expando 键读回不得假精确", () => {
/**
 * 数组**非下标键写**被丢弃后读回折成 **exact `undefined`**
 * （原生读回写入值 9）→ 违反引擎自己「不得假精确」的不变式。
 *
 * 写侧（expando 写降级为 arr，值被丢弃）属 S3 分片；本分片修**读面**：
 * arr 形的确定非下标键读不得折 exact undefined，须与字符串键路径同口径
 * 降级为抽象值（unknown）。
 */




/** 引擎的「自信的 undefined」：shape=unknown 令牌 + lit undefined term + exact */
function isExactUndef(r: unknown): boolean {
  const a = r as {
    shape?: { k?: string };
    term?: { op?: string; value?: unknown };
    conf?: string;
  };
  return (
    a?.shape?.k === "unknown" &&
    a.term?.op === "lit" &&
    a.term.value === undefined &&
    a.conf === "exact"
  );
}


  it("负下标写后读回不是 exact undefined（改前是）；非整数下标写后读回不是 exact undefined；负控制：闭元组（无 expando 写）的非下标读仍是 exact undefined；负控制：元组的规范下标读仍是元素值；负控制：字符串键 expando 路径的既有口径（unknown）不变", () => {
  {
    const r = call(`export function f() { const a=[1,2,3]; a[-1]=9; return a[-1]; }`, "f").result;
    expect(isExactUndef(r)).toBe(false);
  }
  {
    const r = call(`export function f() { const a=[1,2,3]; a[1.5]=9; return a[1.5]; }`, "f").result;
    expect(isExactUndef(r)).toBe(false);
  }
  {
    const r = call(`export function f() { const a=[1,2,3]; return a[-1]; }`, "f").result;
    expect(isExactUndef(r)).toBe(true);
  }
  {
    const r = litValue___nudojs_core(call(`export function f() { const a=[1,2,3]; return a[0]; }`, "f").result);
    expect(r).toEqual({ ok: true, value: 1 });
  }
  {
    const r = call(`export function f() { const a=[1,2,3]; a.foo=9; return a.foo; }`, "f").result;
    expect(isExactUndef(r)).toBe(false);
    expect((r as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  }
});





});

// ---------------------------------------------------------------------------
// String 包装对象可迭代
// ---------------------------------------------------------------------------
describe("String 包装对象可迭代", () => {
/**
 * 回归：**String 包装对象可迭代**（`new String("ab")` 展开得字符序列），
 * 而 Number / Boolean 包装对象**不可迭代**（原生定抛 TypeError）。
 *
 * ES 语义（ES5 §15.10.5 / ES2015+ 包装对象）：`String` 包装对象内部持有
 * [[StringData]]，其 `@@iterator` 继承自 `String.prototype[Symbol.iterator]`
 * ⇒ 展开得字符序列；`Number` / `Boolean` 包装对象**没有**可迭代协议 ⇒ 展开
 * 定抛 TypeError。
 *
 * 修复前：引擎把 String 包装对象建成**不可迭代**的品牌 ⇒ `[...new String("ab")]`
 * **假抛** TypeError（并且 L2 门禁 entry-may-throw 因此**假红**——
 * 原生这段代码不抛）。
 *
 * 负控制：原始字符串仍可迭代；Number 包装对象仍**定抛**（不得被本次修复
 * 一起放开）。
 */




  it("[...new String(\"ab\")] → [\"a\",\"b\"]（原生不抛）；for-of 遍历 String 包装对象 → 字符序列；String 包装对象展开：不记 TypeError（L2 门禁不再假红）；负控制：[...new Number(1)] 仍定抛 TypeError（不得一起放开）；负控制：[...new Boolean(true)] 仍定抛 TypeError；负控制：原始字符串仍可迭代；负控制：原始 number 仍不可迭代；负控制：Map / Set", () => {
  {
    expect(val(`export function f() { return [...new String("ab")].join(","); }`)).toEqual({
      ok: true,
      value: "a,b",
    });
  }
  {
    expect(
      val(`export function f() { let k = ""; for (const c of new String("ab")) k += c; return k; }`),
    ).toEqual({ ok: true, value: "ab" });
  }
  {
    const rec = call(`export function f() { return [...new String("ab")]; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
  }
  {
    const rec = call(`export function f() { return [...new Number(1)]; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const rec = call(`export function f() { return [...new Boolean(true)]; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    expect(val(`export function f() { return [..."ab"].join(","); }`)).toEqual({ ok: true, value: "a,b" });
  }
  {
    const rec = call(`export function f() { return [...(1)]; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      val(`export function f() { const a = [...new Map([[1,2]])]; return a.length + "|" + a[0].join(":"); }`),
    ).toEqual({ ok: true, value: "1|1:2" });
    expect(val(`export function f() { return [...new Set([1])].length; }`)).toEqual({
      ok: true,
      value: 1,
    });
  }
});








});

// ---------------------------------------------------------------------------
// 未建模 Intl 子构造器不得返回内部伪名 brand
// ---------------------------------------------------------------------------
describe("未建模 Intl 子构造器不得返回内部伪名 brand", () => {
/**
 * 回归：`new Intl.Collator('en')` 等**未建模子构造器**返回内部伪名
 * brand（`__nudoFnParentN`），该伪名泄漏进 `nudo check` 签名 / dts 产物
 * （TS2304：伪名是合法 JS 标识符却从未声明）/ schema 产物
 * （`z.instanceof(伪名)` ⇒ 加载即 ReferenceError）。
 *
 * 根因两处：
 * 1. 命名空间成员 fn 投影（containers/member.ts）**不带 name** ⇒ `new` 落
 * 「伪父名」兜底（`ensureFnParentName`）——伪名成了实例的**类型名**；
 * 2. `$new`（packages/core/src/algebra/exec/class/declare.ts）用伪名兜底时
 * 直接造出 brand 实例。
 *
 * 修法：
 * - core 侧（declare.ts）：伪名**不得**成为实例的类型名——命名空间成员
 * 构造器（宿主成员函数：无体、只有 apply 钩子）未建模 ⇒ 折 unknown
 * （台账口径：Intl 成员未建模，接受 unknown）；
 * - 命名空间成员投影带 name（containers/member.ts，S2a 的 修复）⇒
 * 实例 brand 拿到真名（`Intl.<Sub>`），不再落伪名。
 *
 * 本文件钉住**行为**（实例 brand 名不得是内部伪名 + 产物面不得引用伪名），
 * 与具体由哪一侧收口无关。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 结果的 brand 名（非 brand → ""） */
function brandName(src: string): string {
  const r = call(src, "f").result as { shape?: { k?: string; name?: string } };
  return r?.shape?.k === "brand" ? (r.shape.name ?? "") : "";
}

/** 内部伪名的判定（`__nudoFnParentN` 一族——实现细节，不得出现在类型面上） */
function isInternalPseudoName(name: string): boolean {
  return /^__nudoFnParent\d*$/.test(name);
}


  it("new Intl.Collator('en') 的 brand 名不是内部伪名；new Intl.ListFormat('en') / new Intl.Locale('en') 的 brand 名不是内部伪名；负控制：已建模的 Intl 子构造器保留其 brand 名（Intl.NumberFormat）；负控制：未建模子构造器的**调用**形（Intl.Collator('en')）折 unknown（台账：接受 unknown）；负控制：用户类的实例 brand 仍是用", () => {
  {
    const name = brandName(wrap(`return new Intl.Collator('en');`));
    expect(isInternalPseudoName(name)).toBe(false);
  }
  {
    for (const ctor of ["ListFormat", "Locale"]) {
      const name = brandName(wrap(`return new Intl.${ctor}('en');`));
      expect(isInternalPseudoName(name), ctor).toBe(false);
    }
  }
  {
    const name = brandName(wrap(`return new Intl.NumberFormat('en');`));
    expect(isInternalPseudoName(name)).toBe(false);
    expect(name).not.toBe("");
  }
  {
    const r = call(wrap(`return Intl.Collator('en');`), "f").result as { shape?: { k?: string } };
    expect(r?.shape?.k).toBe("unknown");
  }
  {
    const name = brandName(wrap(`class User242 { constructor(){ this.n = 1; } } return new User242();`));
    expect(name).toBe("User242");
    expect(isInternalPseudoName(name)).toBe(false);
  }
});





});

// ---------------------------------------------------------------------------
// [merged] enum-surface-symbol
// ---------------------------------------------------------------------------
describe("enum-surface-symbol", () => {
// MERGED (topic-related bug pins): enum-surface-symbol + proto-constructor-non-enumerable + symbol-key-enum-copy
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>







{
/**
 * 回归（分片：**枚举面接线**）——symbol 键（`[Symbol.X]`）不得出现在
 * **字符串键枚举面**。
 *
 * 本文件钉的是**主 agent 刚落地的枚举面接线**（for-in / keys 家族 / gOPD /
 * Reflect.ownKeys / `in`）；**复制面**（spread / Object.assign / 对象 rest）
 * 由同 bug 的另一分片 `symbol-key-enum-copy` 钉——
 * 两套枚举口径必须分流（字符串键视图 vs CopyDataProperties 视图）。
 *
 * 原生依据（**node v26.10.0 实测**；本文件每条断言的期望值都先跑原生确认，
 * 不用印象值）：
 * - `Object.keys` / `Object.getOwnPropertyNames` / for-in / `JSON.stringify`
 * 只枚举**字符串**键 ⇒ `[Symbol.toStringTag]` 这类 symbol 键**看不到**。
 * - **更正**：`Object.getOwnPropertyDescriptors` **不在**该清单里——
 * 原生 gOPDs 走 [[OwnPropertyKeys]]（**含** symbol 键：结果对象带**真
 * symbol** 键 ⇒ `Reflect.ownKeys(gOPDs(o)).length === 2`、
 * `Object.getOwnPropertySymbols(gOPDs(o)).length === 1`；而
 * `Object.keys(gOPDs(o))` / `Object.getOwnPropertyNames(gOPDs(o))` 仍只有
 * `"a"`——字符串键面不受影响）。本文件此前把 gOPDs 误列入「只枚举字符串
 * 键」清单并据此断言 ownKeys 长度 1 ⇒ 该断言钉的是**错行为**，已更正。
 * - `Reflect.ownKeys` 枚举**自有可枚举**键（字符串 + symbol）⇒ symbol 键**在**，
 * 且取回的是**真 symbol**（`typeof === "symbol"`，`=== Symbol.toStringTag`）。
 * - `"@@toStringTag" in o` 是**假**（原型链上没有这个字符串键）；
 * `Symbol.toStringTag in o` 是**真**（symbol 键本身在）。
 *
 * 改前（改前 = HEAD，本 worktree 的枚举面接线落盘前；探针实测）：
 * - for-in 发布伪键 `"@@toStringTag"`（`"a,@@toStringTag"`）；
 * - `Object.getOwnPropertyDescriptors(o)` 含伪键（`"a,@@toStringTag"`）；
 * - `Reflect.ownKeys(o)[1]` 是**字符串**（`typeof` → `"string"`）；
 * - `"@@toStringTag" in o` 假真（原生为假）。
 *
 * 接线落点（主 agent 已落地；**本文件只钉行为，不改源码**）：
 * - `builtins/invariants.ts`：新增 `enumOwnStringKeys`（剔除 symbol 投影槽
 * 与 internal 私有槽）；`isNonEnumerable` 并查 brand 自身 / brand 内层 obj
 * 两套 flags 载体。
 * - `exec/runtime/containers/iterate.ts`：for-in 三处枚举改走字符串键视图。
 * - `builtins/object/methods.ts`：`getOwnPropertyDescriptors` 的 open/闭 obj
 * 两分支**保留** symbol 槽（原生 gOPDs 含 symbol 键——symbol
 * 投影槽带 `symbolKey` 标记随结果对象走 ⇒ 字符串键面仍剔除它）；
 * `classInstanceEnumEntries` 用剔除 symbol 的 `enumKeys`。
 * - `builtins/reflect.ts`：`Reflect.ownKeys` 把 symbol 槽还原成宿主**真 symbol**。
 * - `exec/runtime/members.ts`：`$in` 的 obj/brand 臂——symbol 键槽不被字符串
 * 键命中（原生 `"@@toStringTag" in o` === false）。
 * - `builtins/object/descriptor.ts` + `exec/class/assign.ts`：复制面携带
 * `symbolKey` 标记（symbol 键不降级成字符串键）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("枚举面：symbol 键不进字符串键视图", () => {
  it("Object.keys({a:1, [Symbol.toStringTag]:2}) → [\"a\"]（symbol 键不进 keys）；for-in {a:1, [Symbol.toStringTag]:2} → 只得 \"a\"（原生：[\"a\"]）；Object.getOwnPropertyNames({a:1, [Symbol.toStringTag]:2}) → [\"a\"]；Object.getOwnPropertyDescriptors({a:1, [Symbol.toS", () => {
  {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(o).join(",");`)),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const r = []; for (const k in o) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.getOwnPropertyNames(o).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  }
  {
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
  }
  {
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
  }
  {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return ("@@toStringTag" in o);`)),
    ).toEqual({ ok: true, value: false });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return (Symbol.toStringTag in o);`)),
    ).toEqual({ ok: true, value: true });
  }
  {
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
  }
  {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return JSON.stringify(o);`)),
    ).toEqual({ ok: true, value: '{"a":1}' });
  }
});







});

describe("负控制：过滤只剔字符串视图，不误伤真 symbol", () => {
  it("真 symbol 键仍被命中：o[Symbol.toStringTag] 读到 2 且 Symbol.toStringTag in o 为真；字面量字符串键 \"@@toStringTag\" 不是 symbol 键：照常枚举（不被误剔）；无 symbol 键的普通对象：各枚举面照常（不回归）；Reflect.ownKeys 仍是**字符串 + symbol** 双族视图（不是只剩字符串）", () => {
  {
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return String(o[Symbol.toStringTag]);`)),
    ).toEqual({ ok: true, value: "2" });
    expect(
      v(wrap(`const o = { a: 1, [Symbol.toStringTag]: 2 }; return (Symbol.toStringTag in o);`)),
    ).toEqual({ ok: true, value: true });
  }
  {
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
  }
  {
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
  }
  {
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
  }
});



});
}

describe("proto-constructor-non-enumerable", () => {
/**
 * 回归（分片：**原型 `constructor` 不可枚举**）——类 / 函数原型的
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
 * （不可枚举 ≠ 不可见）；
 * - `for (const k in new A())` → **[]**（实例无自有可枚举键；`constructor`
 * 在原型上且不可枚举）。
 *
 * 改前（改前 = HEAD；探针实测）：引擎把原型的 `constructor` 当**可枚举**键
 * 发布 ⇒ `for (const k in A.prototype)` 得 `["constructor"]`、
 * `for (const k in Object.prototype)` 得 `["constructor"]`、
 * `for (const k in (function(){}).prototype)` 得 `["constructor"]`、
 * `class A{ m(){} }` 的原型 for-in 得 `["constructor"]`。
 *
 * 接线落点（主 agent 已落地；**本文件只钉行为，不改源码**）：
 * - `builtins/invariants.ts`：`isNonEnumerable` / `enumOwnKeys` /
 * `enumOwnStringKeys` / `isEnumerableView` 经 `isNonEnumerable` 判定——
 * 该函数**并查两套 flags 载体**（brand 自身的 flags + brand 内层 obj 的
 * flags），修掉「原型 `constructor` 的不可枚举标记挂在 brand、枚举面却查
 * inner ⇒ 漏查」的缺陷。
 * - `exec/runtime/containers/iterate.ts`：for-in 三处枚举改走
 * `enumOwnStringKeys`；brand 原型自身那处把 **brand**（不是 inner）传给
 * 枚举面以查 flags。
 * - `builtins/ctor.ts`：`protoBrandAbs(name)` 给 prototype 的 `constructor` 槽
 * 打 `enumerable: false`。
 * - `exec/class-registry.ts`：`fnProtoOf` 给函数原型的 `constructor` 槽打
 * `enumerable: false`（`Object.prototype` 早就这么打）。
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

describe("原型 `constructor` 不可枚举：for-in 枚举面看不到它", () => {
  it("class A{} → for (const k in A.prototype) 是**空**（原生 []；改前引擎给 [\"constructor\"]）；for (const k in Object.prototype) 是**空**（原生 []；改前引擎给 [\"constructor\"]）；(function(){}).prototype 的 for-in 是**空**（原生 []；改前引擎给 [\"constructor\"]）；class A{ m(){} } → for ", () => {
  {
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
  }
  {
    expect(
      v(wrap(`const r = []; for (const k in Object.prototype) r.push(k); return r.join(",");`)),
    ).toEqual({ ok: true, value: "" });
    expect(
      v(wrap(`const r = []; for (const k in Object.prototype) r.push(k); return r.length;`)),
    ).toEqual({ ok: true, value: 0 });
  }
  {
    expect(
      v(wrap(`const r = []; for (const k in (function(){}).prototype) r.push(k); return r.join(",");`)),
    ).toEqual({ ok: true, value: "" });
    expect(
      v(wrap(`const r = []; for (const k in (function(){}).prototype) r.push(k); return r.length;`)),
    ).toEqual({ ok: true, value: 0 });
  }
  {
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
  }
  {
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
  }
  {
    expect(
      v(
        wrap(
          `class Bug295ProtoD {}; const r = []; for (const k in Object.getPrototypeOf(new Bug295ProtoD())) r.push(k); return r.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "" });
  }
});





});

describe("不可枚举 ≠ 不可见：gOPN 仍列 `constructor`", () => {
  it("Object.getOwnPropertyNames(A.prototype) 精确 [\"constructor\"]（原生 [\"constructor\"]）；函数原型：Object.getOwnPropertyNames((function(){}).prototype) → 精确 [\"constructor\"]（原生同款）；原生描述符口径：函数原型的 constructor 描述符 enumerable 为 false", () => {
  {
    // 原生 oracle（node v26）：["constructor"]。
    // 引擎口径（族 58 · 落盘后）：类原型的 gOPN 由**保守域** `string[]`
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
  }
  {
    expect(
      v(wrap(`return Object.getOwnPropertyNames((function(){}).prototype).join(",");`)),
    ).toEqual({ ok: true, value: "constructor" });
    // 同一枚硬币的另一面：它**不可枚举** ⇒ Object.keys 看不到
    expect(
      v(wrap(`return Object.keys((function(){}).prototype).join(",");`)),
    ).toEqual({ ok: true, value: "" });
  }
  {
    // 原生 oracle：`Object.getOwnPropertyDescriptor((function(){}).prototype,
    // "constructor").enumerable` → false
    expect(
      v(
        wrap(
          `const d = Object.getOwnPropertyDescriptor((function(){}).prototype, "constructor"); return d.enumerable;`,
        ),
      ),
    ).toEqual({ ok: true, value: false });
  }
});


});
});

describe("symbol-key-enum-copy", () => {
/**
 * 回归：symbol 键（`[Symbol.X]`）在**复制面**不得退化成普通字符串键。
 *
 * ES 语义（node v26 实测）：
 * - `[Symbol.X]` 是 **symbol 键**，不是字符串键 `"@@X"`；引擎的槽表用
 * `"@@X"` 作投影键 + `Slot.symbolKey` 标记表示它（）。
 * - `Object.assign` / spread / **对象 rest** 复制的是**可枚举 symbol 键本身**
 * （node 实测 rest 也拷 symbol ⇒ `rest[Symbol.toStringTag] === 2`）⇒
 * 复制后 `Object.keys/values/entries` / `JSON.stringify` **看不到**它，
 * 但 `t[Symbol.toStringTag]` **读得到**值。
 * - for-in / `Object.keys|values|entries` / `getOwnPropertyNames` /
 * `getOwnPropertyDescriptors` / `JSON.stringify` **只枚举字符串键**。
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

describe("Object.assign 复制 symbol 键时不退化成字符串键", () => {
  it("Object.keys(Object.assign({}, o))：只含字符串键 \"a\"（改前含伪键 \"@@toStringTag\"）；Object.values(Object.assign({}, o))：只含字符串键的值（改前含 2）；Object.entries(Object.assign({}, o))：只含字符串键的条目（改前含 \"@@toStringTag:2\"）；JSON.stringify(Object.assign({}, o))：不发布伪键（改前含 \"@@", () => {
  {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.keys(Object.assign({}, o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.values(Object.assign({}, o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "1" });
  }
  {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.entries(Object.assign({}, o)).map((e) => e.join(":")).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a:1" });
  }
  {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return JSON.stringify(Object.assign({}, o));`,
        ),
      ),
    ).toEqual({ ok: true, value: '{"a":1}' });
  }
  {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; return Object.getOwnPropertyNames(Object.assign({}, o)).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(
      v(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const t = Object.assign({}, o); return String(t[Symbol.toStringTag]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
  }
});





});

describe("负控制（复制面 / 枚举面的邻近形态不回归）", () => {
  it("源对象自身的字符串键枚举面不变：Object.keys/values/entries/JSON.stringify；spread / 对象 rest 仍**拷贝** symbol 键（原生同款：node 实测 rest 也拷）；无 symbol 键的普通对象：assign / 枚举面照常；字面量字符串键 \"@@toStringTag\" 不是 symbol 键：照常枚举（不被误剔）", () => {
  {
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
  }
  {
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
  }
  {
    expect(v(wrap(`return Object.keys(Object.assign({}, { a: 1, b: 2 })).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(v(wrap(`return Object.getOwnPropertyNames({ a: 1, b: 2 }).join(",");`))).toEqual({
      ok: true,
      value: "a,b",
    });
  }
  {
    expect(
      v(wrap(`const o = { "@@toStringTag": 7 }; return Object.keys(Object.assign({}, o)).join(",");`)),
    ).toEqual({ ok: true, value: "@@toStringTag" });
  }
});



});

describe("枚举视图两套口径（留接口：enumOwnKeys vs enumOwnStringKeys）", () => {
  const o = objOf({
    a: { value: num() },
    "@@toStringTag": { value: num(), symbolKey: true },
  });
  const slots = (o.shape as Extract<Abs["shape"], { k: "obj" }>).slots;

  it("enumOwnKeys = CopyDataProperties 视图（含 symbol 键——spread/assign 拷贝链要它）；enumOwnStringKeys = 字符串键视图（剔除 symbol 投影槽——for-in / keys 家族要它）", () => {
  {
    expect(enumOwnKeys(o, slots).sort()).toEqual(["@@toStringTag", "a"]);
  }
  {
    expect(enumOwnStringKeys(o, slots)).toEqual(["a"]);
  }
});

});
});
});

// ---------------------------------------------------------------------------
// Date.prototype.set* 回写 time value（精确面不再过期）
// ---------------------------------------------------------------------------
describe("Date.prototype.set* 回写 time value（精确面不再过期）", () => {
/**
 * 回归：`Date.prototype.set*` 族不再是空操作——time value 回写，
 * 精确渲染面（toISOString）不再给**过期**日期。
 *
 * ES 语义（node 实测）：
 * - `setUTCFullYear` / `setUTCMonth` / `setUTCDate` / `setUTCHours` /
 * `setUTCMinutes` / `setUTCSeconds` / `setUTCMilliseconds` / `setTime`
 * 按规范 MakeDay/MakeTime 归一化后回写 [[DateValue]]（1 月 31 日
 * setUTCMonth(1) → 3 月 2 日）；本地族（setFullYear / setMonth / …）同款
 * （本地时区口径，与宿主 Date 同）。
 * - setter **返回**新 time value（number）。
 * - 实参不可判定（抽象 number）→ 新 time value 不可知 ⇒ 精确面必须降级
 * （不得给过期日期）。
 * - 实参是 Symbol / BigInt → 确定 TypeError（既有口径，不回归）。
 *
 * 修复前：setter 臂只做实参校验就返回抽象 number，从不回写 time value
 * ⇒ `toISOString()` 恒给**构造期**的日期（wrong-exact）。
 *
 * 不变量（负控制钉住）：
 * - 无 setter 的构造期精确 ISO 不变；
 * - 两个实例互不影响（各自持有自己的 time value）；
 * - `new Date()`（tv 不可知）上的 setter 仍返回抽象 number，且不记抛；
 * - `Date.now()` / `Date.prototype.setTime` 成员面不变；
 * - JSON.stringify（投影面）与读面同源（同一 time value）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("setUTCFullYear / setUTCMonth / setUTCDate → ISO 更新；setUTCHours / setUTCMinutes / setUTCSeconds / setUTCMilliseconds → ISO 更新；setTime → time value 回写（ISO 同步）；MakeDay 归一化：1 月 31 日 setUTCMonth(1) → 3 月 2 日（原生口径）；多实参形态：setUTCFullYear(y, m, d) /", () => {
  {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCFullYear(2021); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2021-01-01T00:00:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCMonth(5); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-06-01T00:00:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCDate(15); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-15T00:00:00.000Z" });
  }
  {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCHours(5); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T05:00:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCMinutes(30); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T00:30:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCSeconds(30); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T00:00:30.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCMilliseconds(500); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T00:00:00.500Z" });
  }
  {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setTime(0); return d.toISOString();`)))
      .toEqual({ ok: true, value: "1970-01-01T00:00:00.000Z" });
  }
  {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,31)); d.setUTCMonth(1); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-03-02T00:00:00.000Z" });
  }
  {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCFullYear(2021,5,15); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2021-06-15T00:00:00.000Z" });
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCHours(3,4,5,6); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T03:04:05.006Z" });
  }
  {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); return d.setUTCFullYear(2021);`)))
      .toEqual({ ok: true, value: Date.UTC(2021, 0, 1) });
  }
  {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setUTCFullYear(2021); return d.getTime();`)))
      .toEqual({ ok: true, value: Date.UTC(2021, 0, 1) });
    expect(v(wrap(`const d = new Date(0); d.setTime(5000); return d.valueOf();`)))
      .toEqual({ ok: true, value: 5000 });
  }
  {
    expect(throwName(wrap(`const d = new Date(Date.UTC(2020,0,1)); d.setTime(1e20); return d.toISOString();`)))
      .toBe("RangeError");
  }
  {
    expect(v(wrap(`const d = new Date(Date.UTC(2020,0,1)); return d.toISOString();`)))
      .toEqual({ ok: true, value: "2020-01-01T00:00:00.000Z" });
  }
  {
    expect(v(wrap(`const a = new Date(Date.UTC(2020,0,1)); const b = new Date(Date.UTC(1999,0,1)); a.setUTCFullYear(2021); return a.toISOString() + "|" + b.toISOString();`)))
      .toEqual({ ok: true, value: "2021-01-01T00:00:00.000Z|1999-01-01T00:00:00.000Z" });
  }
  {
    expect(throwName(wrap(`const d = new Date(0); d.setUTCFullYear(Symbol()); return "no";`))).toBe("TypeError");
    expect(throwName(wrap(`const d = new Date(0); d.setTime(1n); return "no";`))).toBe("TypeError");
  }
  {
    expect(v(wrap(`const d = new Date(); return d.setTime(5);`))).toEqual({ ok: false });
    expect(throwName(wrap(`const d = new Date(); return d.setTime(5);`))).toBe("");
  }
  {
    expect(v(wrap(`return typeof Date.now();`))).toEqual({ ok: true, value: "number" });
    expect(v(wrap(`return typeof Date.prototype.setTime;`))).toEqual({ ok: true, value: "function" });
  }
});













});

// ---------------------------------------------------------------------------
// JSON.parse 的 callable reviver 副作用通道
// ---------------------------------------------------------------------------
describe("JSON.parse 的 callable reviver 副作用通道", () => {
/**
 * 回归：JSON.parse 的 **callable reviver 真执行**（原生
 * InternalizeJSONProperty 语义）。
 *
 * 修前：reviver **一次都不执行** ⇒ 回调副作用（计数器 / 累加串 / 捕获变量
 * 写 / this 绑定）整体丢失，捕获变量保留**确定旧值**（引擎内部不对称：
 * 同文件的 stringify replacer 却真执行）。
 *
 * 修法（json.ts `runJsonReviver`）：解析成功后按原生**后序深度优先**逐键
 * 调 reviver.call(holder, key, value)——调用次数 = JSON 结构节点数，根键
 * "" 也算一次；holder = 根对象（this 恒为它）。
 *
 * 值域仍保守 unknown（逐键变换未建模——既有回归 eval-json.test.ts 与
 * object-json.test.ts 钉此口径）；本条钉的是**副作用通道**。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */




function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}


  it("reviver 调用次数 = 节点数（node: 3）；标量文本：根键一次（node: 1）；键序 = 后序深度优先（node: \"b;a;;\"）；function 表达式 reviver 同样被调用（node: 2）；this 绑定 = holder（原生 typeof this === \"object\"）；reviver 抛错原样传播（原生抛原异常——不是 SyntaxError）；reviver 抛错不被降级成 SyntaxError（负控制：解析失败仍是 Syntax", () => {
  {
    expect(
      v(`export function f() { let n = 0; JSON.parse("[1,2]", (k, v) => { n++; return v; }); return n; }`),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    expect(
      v(`export function f() { let n = 0; JSON.parse("1", (k, v) => { n++; return v; }); return n; }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      v(
        `export function f() { let s = ""; JSON.parse('{"a":{"b":1}}', (k, v) => { s += k + ";"; return v; }); return s; }`,
      ),
    ).toEqual({ ok: true, value: "b;a;;" });
  }
  {
    expect(
      v(
        `export function f() { let n = 0; JSON.parse('{"a":1}', function (k, v) { n++; return v; }); return n; }`,
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      v(
        `export function f() { let s = ""; JSON.parse('{"a":1}', function (k, v) { s += typeof this + ";"; return v; }); return s; }`,
      ),
    ).toEqual({ ok: true, value: "object;object;" });
  }
  {
    const r = call(
      `export function f() { try { JSON.parse("1", () => { throw new TypeError("boom"); }); return "no-throw"; } catch (e) { return "caught"; } }`,
      "f",
    );
    expect(v(`export function f() { try { JSON.parse("1", () => { throw new TypeError("boom"); }); return "no-throw"; } catch (e) { return "caught"; } }`)).toEqual({
      ok: true,
      value: "caught",
    });
    expect(isNever(r.throws)).toBe(true);
  }
  {
    const r = call(`export function f() { return JSON.parse("{", 1); }`, "f");
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  }
  {
    expect(v(`export function f() { return JSON.stringify(JSON.parse('{"a":1}', 1)); }`)).toEqual({
      ok: true,
      value: '{"a":1}',
    });
    expect(v(`export function f() { return JSON.stringify(JSON.parse('{"a":1}', null)); }`)).toEqual({
      ok: true,
      value: '{"a":1}',
    });
  }
  {
    expect(
      v(
        `export function f() { let n = 0; JSON.stringify({ a: { b: 1 } }, (k, v) => { n++; return v; }); return n; }`,
      ),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    const r = call(`export function f() { return JSON.parse('{"a":1}', (k, v) => v); }`, "f");
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  }
});










});

// ---------------------------------------------------------------------------
// Reflect.set 的 receiver 语义 + Proxy 反射口径
// ---------------------------------------------------------------------------
describe("Reflect.set 的 receiver 语义 + Proxy 反射口径", () => {
/**
 * 回归：`Reflect.set` 落 [[Set]] 语义——**第 4 实参 receiver** 参与
 * 写语义，且 Proxy 走**反射口径**（ToBoolean(陷阱结果)，失败返 false 不抛）。
 *
 * 原生（node v26 实测，ES2024 13.15.2 OrdinarySetWithOwnDescriptor）：
 * - `Reflect.set(t,"a",2,r)`：t 有自有数据属性 "a" ⇒ **receiver** 建自有
 * 数据属性（t 不变、r.a = 2）；t 无自有 "b" ⇒ 沿原型链上溯后 receiver 建
 * 自有属性（t.b 仍 undefined）；
 * - receiver 自有**访问器**属性 ⇒ 写门失败 → 返 **false**（不抛）；
 * - Proxy 的 set 陷阱返 false / 0 ⇒ `Reflect.set` 返 **false**（不抛）——
 * 抛错是**赋值运算符**（strict）的语义，不是 Reflect 的语义。
 *
 * 修复前：第 4 实参被丢弃（写恒落在 target 上）；Proxy 走 $set 的赋值口径
 * ⇒ 陷阱返 false 时定抛 TypeError、返回值恒 true。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 入口 throws 面（brand 名）——未抛则 undefined */
function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("第 4 实参 receiver：写落在 receiver，target 不变；第 4 实参 receiver：target 无自有键 ⇒ receiver 建自有键，target 不变；receiver 自有访问器属性 → 写门失败返 false（原生不抛、不改写）；缺省 receiver ≡ target：写在 target 上；Proxy set 陷阱返 false / 0 → Reflect.set 返 false（改前定抛 TypeError）；Proxy set 陷", () => {
  {
    expect(
      v(
        wrap(
          `const t = { a: 1 }; const r = { a: 9 }; Reflect.set(t, "a", 2, r); return String(t.a) + ":" + String(r.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "1:2" });
  }
  {
    expect(
      v(
        wrap(
          `const t = { a: 1 }; const r = {}; Reflect.set(t, "b", 2, r); return String(r.b) + ":" + String(t.b);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2:undefined" });
  }
  {
    expect(
      v(
        wrap(
          `const t = {}; const r = { set v(x){ this._v = x; }, get v(){ return this._v; } }; const ok = Reflect.set(t, "v", 5, r); return String(ok) + ":" + String(r.v);`,
        ),
      ),
    ).toEqual({ ok: true, value: "false:undefined" });
  }
  {
    expect(
      v(wrap(`const o = { a: 1 }; Reflect.set(o, "a", 2); return String(o.a);`)),
    ).toEqual({ ok: true, value: "2" });
  }
  {
    expect(
      v(wrap(`const p = new Proxy({}, { set: () => false }); return String(Reflect.set(p, "x", 1));`)),
    ).toEqual({ ok: true, value: "false" });
    expect(
      v(wrap(`const p = new Proxy({}, { set: () => 0 }); return String(Reflect.set(p, "x", 1));`)),
    ).toEqual({ ok: true, value: "false" });
    expect(
      thrown(wrap(`const p = new Proxy({}, { set: () => false }); Reflect.set(p, "x", 1);`)),
    ).toBeUndefined();
  }
  {
    expect(
      v(wrap(`const p = new Proxy({}, { set: () => true }); return String(Reflect.set(p, "x", 1));`)),
    ).toEqual({ ok: true, value: "true" });
  }
  {
    expect(
      v(wrap(`const o = Object.freeze({ a: 1 }); return String(Reflect.set(o, "a", 2));`)),
    ).toEqual({ ok: true, value: "false" });
  }
});







});

// ---------------------------------------------------------------------------
// TA buffer 形态缺省长度非整数倍 → definite RangeError
// ---------------------------------------------------------------------------
describe("TA buffer 形态缺省长度非整数倍 → definite RangeError", () => {
/**
 * 回归：new <TypedArray>(buffer) 缺省长度——「buffer 剩余字节数须为
 * 元素大小整数倍」的 RangeError 检查。
 *
 * 原生 AllocateTypedArrayBuffer（node v26 实测）：
 * new Int32Array(new ArrayBuffer(6)) → RangeError（byte length 须是 4 的倍数）
 * new Float64Array(new ArrayBuffer(9)) → RangeError
 * new Int16Array(new ArrayBuffer(3)) → RangeError
 * new Int32Array(new ArrayBuffer(9), 4) → RangeError（剩余 5 字节非倍数）
 * new Int32Array(new ArrayBuffer(8), 4) → length 1（剩余 4 字节，合法）
 * 引擎此前只判「offset 越界」与「offset 对齐」两道，缺省长度臂整支缺失 ⇒
 * Math.floor 静默截断折出**确定的错长度**（buf6 → 1），且门禁恒绿。
 *
 * 修法：binary.ts makeTypedArrayFromBuffer 的 lenDefaulted 分支补
 * `(bufLenV - offV) % bpe !== 0 → RangeError`；bufLen 不可判 → may RangeError。
 */






/** 原生：定抛（try/catch 吸收后返回 "caught"） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛：无 try/catch 时 throws 面是相应 Error brand */
function expectThrows(src: string, name: string) {
  const r = call(src);
  const got = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(got, `throws ${name} for: ${src}`).toBe(name);
}

function check(src: string) {
  return checkSource("/t/eval-bug-303.js", src);
}

// ---------------------------------------------------------------------------
// 改前会失败的形态：非整数倍尾段 → definite RangeError
// ---------------------------------------------------------------------------

{
  it.each([
    ["Int32Array / 6 字节", `const b = new ArrayBuffer(6); return new Int32Array(b).length;`],
    ["Float64Array / 9 字节", `const b = new ArrayBuffer(9); return new Float64Array(b).length;`],
    ["Int16Array / 3 字节", `const b = new ArrayBuffer(3); return new Int16Array(b).length;`],
    ["Int32Array / 9 字节 off 4（剩余 5）", `const b = new ArrayBuffer(9); return new Int32Array(b, 4).length;`],
    ["BigInt64Array / 12 字节", `const b = new ArrayBuffer(12); return new BigInt64Array(b).length;`],
    ["SharedArrayBuffer / 6 字节", `const b = new SharedArrayBuffer(6); return new Int32Array(b).length;`],
    ["Uint16Array / 5 字节", `const b = new ArrayBuffer(5); return new Uint16Array(b).length;`],
    ["Float32Array / 10 字节", `const b = new ArrayBuffer(10); return new Float32Array(b).length;`],
  ])("%s → RangeError", (_name, body) => {
    expectThrows(`export function f() { ${body} }`, "RangeError");
    expectCaught(`export function f() { try { ${body}; return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("构造期 RangeError 进 throws 域（此前 throws=never 假 total）", () => {
    const r = call(`export function f() { const b = new ArrayBuffer(6); return new Int32Array(b).length; }`);
    expect(r.result.shape.k).toBe("never");
  });
}

// ---------------------------------------------------------------------------
// 负控制：整数倍尾段 / 显式长度 / 对齐与越界档——不得被本修复波及
// ---------------------------------------------------------------------------

describe("负控制：合法 buffer 形态不回退", () => {
  it.each([
    ["Int32Array / 8 字节 → 2", `const b = new ArrayBuffer(8); return new Int32Array(b).length;`, 2],
    ["Int32Array / 8 字节 off 4 → 1", `const b = new ArrayBuffer(8); return new Int32Array(b, 4).length;`, 1],
    ["Int32Array / 12 字节 off 4 → 2", `const b = new ArrayBuffer(12); return new Int32Array(b, 4).length;`, 2],
    ["Uint8Array / 6 字节 → 6（BPE=1 恒整除）", `const b = new ArrayBuffer(6); return new Uint8Array(b).length;`, 6],
    ["Uint8Array / 3 字节 off 1 → 2", `const b = new ArrayBuffer(3); return new Uint8Array(b, 1).length;`, 2],
    ["BigInt64Array / 16 字节 → 2", `const b = new ArrayBuffer(16); return new BigInt64Array(b).length;`, 2],
    ...(hostNameAvailable("Float16Array")
      ? [["Float16Array / 6 字节 → 3", `const b = new ArrayBuffer(6); return new Float16Array(b).length;`, 3] as [string, string, number]]
      : []),
    ["Int32Array / 0 字节 → 0", `const b = new ArrayBuffer(0); return new Int32Array(b).length;`, 0],
    ["Int32Array / 4 字节 off 4 → 0", `const b = new ArrayBuffer(4); return new Int32Array(b, 4).length;`, 0],
  ])("%s", (_name, body, expected) => {
    expect(val(`export function f() { ${body} }`)).toEqual({ ok: true, value: expected });
  });

  it("显式 byteLength 臂不查整除（原生同：new Int32Array(buf6, 0, 1) → 1）；offset 对齐档先于整除档（原生报错序：Int32(buf6, 2) → 偏移未对齐）", () => {
  {
    expect(val(`export function f() { const b = new ArrayBuffer(6); return new Int32Array(b, 0, 1).length; }`))
      .toEqual({ ok: true, value: 1 });
    // 显式长度越界仍是 RangeError（既有 档不回退）
    expectThrows(
      `export function f() { const b = new ArrayBuffer(6); return new Int32Array(b, 4, 1).length; }`,
      "RangeError",
    );
  }
  {
    expectThrows(
      `export function f() { const b = new ArrayBuffer(6); return new Int32Array(b, 2).length; }`,
      "RangeError",
    );
  }
});

});

// ---------------------------------------------------------------------------
// 门禁面：抽象 buffer 长度 → may RangeError（不误报定抛）
// ---------------------------------------------------------------------------

describe("gate 面", () => {
  it("抽象 buffer byteLength（缺省长度臂整除不可判）→ may RangeError；抽象 buffer byteLength + 显式长度 → may RangeError（既有越界档）；定抛臂进 L2（entry-may-throw 记账）", () => {
  {
    const src = `export function f(x) { const b = new ArrayBuffer(x); return new Int32Array(b).length; }`;
    expect(effects(src)).toContain("RangeError");
  }
  {
    const src = `export function f(x) { const b = new ArrayBuffer(x); return new Int32Array(b, 0, 1).length; }`;
    expect(effects(src)).toContain("RangeError");
  }
  {
    const src = `export function f() { const b = new ArrayBuffer(6); return new Int32Array(b).length; }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
  }
});


});
});

// ---------------------------------------------------------------------------
// TA set 跨内容类型 → definite TypeError
// ---------------------------------------------------------------------------
describe("TA set 跨内容类型 → definite TypeError", () => {
/**
 * 回归：%TypedArray%.prototype.set 缺「源/目标**内容类型**（number vs
 * bigint）一致」校验。
 *
 * 原生（node v26 实测）：
 * new Uint8Array(2).set(new BigInt64Array(1)) → TypeError
 * （Cannot mix BigInt and other types, use explicit conversions）
 * new BigInt64Array(2).set(new Uint8Array(1)) → TypeError
 * 规范约束的是**内容类型**（[[ContentType]] number/bigint）而**不是家族名**：
 * new Uint8Array(2).set(new Int8Array(1)) → 合法（不抛）
 * new BigInt64Array(2).set(new BigUint64Array(1)) → 合法（不抛）
 * 引擎此前从不比较源与目标的 brand ⇒ 跨内容类型 set 一律 no-throw（假 no-throw），
 * 门禁恒绿、L2 may-throw 记账缺失。
 *
 * 修法：dispatch.ts set 分支在源带 [[TypedArrayName]] 槽时比对 [[ContentType]]
 * （taContentTypeOf），不一致即定抛 TypeError（原生报错序：越界 RangeError
 * 先于内容类型 TypeError——越界不可判时只记 may）。
 */





/** 原生：定抛（try/catch 吸收后返回 "caught"） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛：无 try/catch 时 throws 面是相应 Error brand */
function expectThrows(src: string, name: string) {
  const r = call(src);
  const got = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(got, `throws ${name} for: ${src}`).toBe(name);
}

function check(src: string) {
  return checkSource("/t/eval-bug-304.js", src);
}

// ---------------------------------------------------------------------------
// 改前会失败的形态：跨内容类型 set → definite TypeError
// ---------------------------------------------------------------------------

{
  it.each([
    ["number 目标 ← bigint 源", `const ta = new Uint8Array(2); ta.set(new BigInt64Array(1)); return "no-throw";`],
    ["bigint 目标 ← number 源", `const ta = new BigInt64Array(2); ta.set(new Uint8Array(1)); return "no-throw";`],
    ["number 目标 ← BigUint64 源", `const ta = new Int32Array(2); ta.set(new BigUint64Array(1)); return "no-throw";`],
    ["bigint 目标 ← Float64 源", `const ta = new BigUint64Array(2); ta.set(new Float64Array(1)); return "no-throw";`],
    ["number 目标 ← bigint 源（带 offset）", `const ta = new Uint8Array(4); ta.set(new BigInt64Array(1), 1); return "no-throw";`],
  ])("%s → TypeError", (_name, body) => {
    expectThrows(`export function f() { ${body} }`, "TypeError");
    expectCaught(`export function f() { try { ${body}; return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("跨内容类型 set 进 throws 域（此前 throws=never 假 total）", () => {
    const r = call(`export function f() { const ta = new Uint8Array(2); ta.set(new BigInt64Array(1)); return "no-throw"; }`);
    expect(r.result.shape.k).toBe("never");
  });
}

// ---------------------------------------------------------------------------
// 负控制：同内容类型跨家族合法（规范约束内容类型而非家族名）
// ---------------------------------------------------------------------------

describe("负控制：同内容类型跨家族 set 合法", () => {
  it.each([
    ["Uint8 ← Int8", `const ta = new Uint8Array(2); ta.set(new Int8Array(1)); return "no-throw";`],
    ["Uint8 ← Int16", `const ta = new Uint8Array(2); ta.set(new Int16Array(1)); return "no-throw";`],
    ["Uint8 ← Float64", `const ta = new Uint8Array(2); ta.set(new Float64Array(1)); return "no-throw";`],
    ["BigInt64 ← BigUint64", `const ta = new BigInt64Array(2); ta.set(new BigUint64Array(1)); return "no-throw";`],
    ["BigUint64 ← BigInt64", `const ta = new BigUint64Array(2); ta.set(new BigInt64Array(1)); return "no-throw";`],
  ])("%s → no-throw", (_name, body) => {
    expect(val(`export function f() { ${body} }`)).toEqual({ ok: true, value: "no-throw" });
  });

  it("非 TA 源（数组/字符串）不受内容类型校验影响；越界档优先于内容类型档（原生报错序：u8.set(bi64(1), 2) → RangeError）", () => {
  {
    expect(val(`export function f() { const ta = new Uint8Array(2); ta.set([1]); return "no-throw"; }`))
      .toEqual({ ok: true, value: "no-throw" });
    expect(val(`export function f() { const ta = new BigInt64Array(2); ta.set([1n]); return "no-throw"; }`))
      .toEqual({ ok: true, value: "no-throw" });
  }
  {
    expectThrows(
      `export function f() { const ta = new Uint8Array(2); ta.set(new BigInt64Array(1), 2); return "no-throw"; }`,
      "RangeError",
    );
  }
});

});

// ---------------------------------------------------------------------------
// 门禁面
// ---------------------------------------------------------------------------

describe("gate 面", () => {
  it("跨内容类型 set 进 L2（entry-may-throw 记账）；抽象源（any）→ may TypeError（不误报定抛）", () => {
  {
    const src = `export function f() { const ta = new Uint8Array(2); ta.set(new BigInt64Array(1)); return "no-throw"; }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
  }
  {
    const src = `export function f(x) { const ta = new Uint8Array(2); ta.set(x); return "no-throw"; }`;
    expect(effects(src)).toContain("TypeError");
  }
});

});
});

// ---------------------------------------------------------------------------
// TA set 逐元素转换 → definite TypeError
// ---------------------------------------------------------------------------
describe("TA set 逐元素转换 → definite TypeError", () => {
/**
 * 回归：%TypedArray%.prototype.set 缺**逐元素 ToNumber / ToBigInt**
 * 转换校验。
 *
 * 原生（node v26 实测）：
 * new Uint8Array(2).set([1n]) → TypeError（Cannot convert a BigInt
 * value to a number）
 * new BigInt64Array(2).set([1]) → TypeError（Invalid argument type in
 * ToBigInt operation）
 * new BigInt64Array(2).set([1.5]) → TypeError
 * new BigInt64Array(2).set([null]) → TypeError
 * new BigInt64Array(2).set([undefined]) → TypeError
 * 合法（ToBigInt(true) / ToBigInt("2") / ToNumber(null) / ToNumber(undefined)）：
 * new BigInt64Array(2).set([true]) → no-throw
 * new BigInt64Array(2).set(["2"]) → no-throw
 * new Uint8Array(2).set([null]) → no-throw
 * new Uint8Array(2).set([undefined])→ no-throw
 * new Uint8Array(2).set([1.5]) → no-throw
 *
 * 引擎此前 set 路径完全不接元素转换面（只读源长度做越界档）⇒ 原生 TypeError
 * 被折成 no-throw。修法：复用 binary.ts 的 enforceTaItem /
 * enforceTaItemConversion（构造器 / from / of 同一口径）做逐元素判定。
 *
 * 原生报错序（node v26）：越界（RangeError）先于元素转换（TypeError）——
 * new Uint8Array(2).set([1n, 2n, 3n]) → RangeError（既有 档）。
 */





/** 原生：定抛（try/catch 吸收后返回 "caught"） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛：无 try/catch 时 throws 面是相应 Error brand */
function expectThrows(src: string, name: string) {
  const r = call(src);
  const got = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(got, `throws ${name} for: ${src}`).toBe(name);
}

function check(src: string) {
  return checkSource("/t/eval-bug-305.js", src);
}

// ---------------------------------------------------------------------------
// 改前会失败的形态：逐元素转换 → definite TypeError
// ---------------------------------------------------------------------------

{
  it.each([
    ["number 域收 bigint 字面量", `const ta = new Uint8Array(2); ta.set([1n]); return "no-throw";`],
    ["number 域收 bigint 字面量（混合）", `const ta = new Uint8Array(2); ta.set([1, 2n]); return "no-throw";`],
    ["number 域收 symbol", `const ta = new Uint8Array(2); ta.set([Symbol("x")]); return "no-throw";`],
    ["bigint 域收 number 字面量", `const ta = new BigInt64Array(2); ta.set([1]); return "no-throw";`],
    ["bigint 域收小数字面量", `const ta = new BigInt64Array(2); ta.set([1.5]); return "no-throw";`],
    ["bigint 域收 null", `const ta = new BigInt64Array(2); ta.set([null]); return "no-throw";`],
    ["bigint 域收 undefined", `const ta = new BigInt64Array(2); ta.set([undefined]); return "no-throw";`],
    ["bigint 域收 symbol", `const ta = new BigInt64Array(2); ta.set([Symbol("x")]); return "no-throw";`],
    ["bigint 域收坏 string → SyntaxError", `const ta = new BigInt64Array(2); ta.set(["abc"]); return "no-throw";`],
  ])("%s", (_name, body) => {
    const name = body.includes("SyntaxError") || body.includes('"abc"') ? "SyntaxError" : "TypeError";
    expectThrows(`export function f() { ${body} }`, name);
    expectCaught(`export function f() { try { ${body}; return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("逐元素转换错误进 throws 域（此前 throws=never 假 total）", () => {
    const r = call(`export function f() { const ta = new Uint8Array(2); ta.set([1n]); return "no-throw"; }`);
    expect(r.result.shape.k).toBe("never");
  });
}

// ---------------------------------------------------------------------------
// 负控制：合法转换（ToBigInt(true) / ToBigInt("2") / ToNumber(null) / …）
// ---------------------------------------------------------------------------

describe("负控制：合法元素转换不回退", () => {
  it.each([
    ["bigint 域收 boolean", `const ta = new BigInt64Array(2); ta.set([true]); return "no-throw";`],
    ["bigint 域收数字字符串", `const ta = new BigInt64Array(2); ta.set(["2"]); return "no-throw";`],
    ["number 域收 null", `const ta = new Uint8Array(2); ta.set([null]); return "no-throw";`],
    ["number 域收 undefined", `const ta = new Uint8Array(2); ta.set([undefined]); return "no-throw";`],
    ["number 域收小数", `const ta = new Uint8Array(2); ta.set([1.5]); return "no-throw";`],
    ["number 域收数字字符串", `const ta = new Uint8Array(2); ta.set(["2"]); return "no-throw";`],
    ["number 域收 boolean", `const ta = new Uint8Array(2); ta.set([true]); return "no-throw";`],
    ["bigint 域收 bigint", `const ta = new BigInt64Array(2); ta.set([1n]); return "no-throw";`],
    ["number 域收 number", `const ta = new Uint8Array(2); ta.set([1]); return "no-throw";`],
  ])("%s → no-throw", (_name, body) => {
    expect(val(`export function f() { ${body} }`)).toEqual({ ok: true, value: "no-throw" });
  });

  it("字符串源：number 域不抛（ToNumber(字符) 恒 NaN→0）；越界档优先于元素转换档（原生报错序：u8.set([1n,2n,3n]) → RangeError）；既有 Bug 38 档不回退：BigInt 家族越界 RangeError / nullish 源 TypeError", () => {
  {
    expect(val(`export function f() { const ta = new Uint8Array(3); ta.set("abc"); return "no-throw"; }`))
      .toEqual({ ok: true, value: "no-throw" });
  }
  {
    expectThrows(
      `export function f() { const ta = new Uint8Array(2); ta.set([1n, 2n, 3n]); return "no-throw"; }`,
      "RangeError",
    );
  }
  {
    expectThrows(
      `export function f() { const ta = new BigInt64Array(2); ta.set([1n, 2n, 3n]); return "no-throw"; }`,
      "RangeError",
    );
    expectThrows(
      `export function f() { const ta = new BigUint64Array(2); ta.set(null); return "no-throw"; }`,
      "TypeError",
    );
  }
});


});

// ---------------------------------------------------------------------------
// 门禁面
// ---------------------------------------------------------------------------

describe("gate 面", () => {
  it("逐元素转换错误进 L2（entry-may-throw 记账）；抽象元素 → may TypeError（不误报定抛）", () => {
  {
    const src = `export function f() { const ta = new Uint8Array(2); ta.set([1n]); return "no-throw"; }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
  }
  {
    const src = `export function f(x) { const ta = new Uint8Array(2); ta.set([x]); return "no-throw"; }`;
    expect(effects(src)).toContain("TypeError");
  }
});

});
});

// ---------------------------------------------------------------------------
// RegExp 自有 lastIndex 进 gOPN / gOPD
// ---------------------------------------------------------------------------
describe("RegExp 自有 lastIndex 进 gOPN / gOPD", () => {
/**
 * 回归：RegExp 实例的**自有 `lastIndex`**（ECMA-262 §22.2.6）。
 *
 * 原生（node v26 实测）：
 * - `Object.getOwnPropertyNames(/x/)` === ["lastIndex"]（gOPN 是「**全部**
 * 自有键」语义——lastIndex 自有但**非可枚举**）；
 * - `Object.getOwnPropertyDescriptor(/x/, "lastIndex").writable` === true
 * （数据属性：可写、非可枚举、不可配置）；
 * - `Object.keys(/x/)` === []（**可枚举**自有键视图——lastIndex 非可枚举）。
 *
 * 修复前：gOPN 复用了「零**可枚举**自有键」表 ⇒ 折 exact 空元组（自信的
 * 确切错值）；gOPD 落「descriptor | undefined」⇒ 读 .writable 即定抛
 * TypeError。
 */




function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("gOPN：列出自有 lastIndex（改前折空元组）；gOPN：全局正则同样列 lastIndex（改前折空元组）；gOPD：lastIndex 折可写的数据描述符（改前读 .writable 定抛 TypeError）；负控制：Object.keys 仍为空（lastIndex 非可枚举）；负控制：Map / Set 的 gOPN 仍为空（无自有键）", () => {
  {
    expect(v(wrap(`return JSON.stringify(Object.getOwnPropertyNames(/x/));`))).toEqual({
      ok: true,
      value: '["lastIndex"]',
    });
  }
  {
    expect(v(wrap(`return JSON.stringify(Object.getOwnPropertyNames(/x/g));`))).toEqual({
      ok: true,
      value: '["lastIndex"]',
    });
  }
  {
    expect(
      v(
        wrap(
          `const d = Object.getOwnPropertyDescriptor(/x/, "lastIndex"); return String(d.writable) + "," + String(d.enumerable) + "," + String(d.configurable);`,
        ),
      ),
    ).toEqual({ ok: true, value: "true,false,false" });
  }
  {
    expect(v(wrap(`return JSON.stringify(Object.keys(/x/));`))).toEqual({
      ok: true,
      value: "[]",
    });
  }
  {
    expect(v(wrap(`return JSON.stringify(Object.getOwnPropertyNames(new Map()));`))).toEqual({
      ok: true,
      value: "[]",
    });
  }
});





});

// ---------------------------------------------------------------------------
// URL brand 的 searchParams 组件槽
// ---------------------------------------------------------------------------
describe("URL brand 的 searchParams 组件槽", () => {
/**
 * 回归：URL brand 的 `searchParams` 组件槽。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 * new URL("https://x/?a=1").searchParams → URLSearchParams 实例
 * （constructor.name
 * === "URLSearchParams"；
 * instanceof URLSearchParams）
 * new URL("https://x/?a=1").searchParams.get("a") → "1"
 * new URL("https://x/?a=1").href → "https://x/?a=1"
 * new URL("https://x/?a=1").search → "?a=1"
 * typeof new URL("https://x/?a=1").searchParams → "object"
 *
 * 修前：URL 组件槽表**独缺 searchParams** ⇒ 读它落「槽缺失 ⇒ undefined」
 * ⇒ `.get(...)` 在 undefined 上调用 ⇒ **确定 TypeError** ⇒ 返回值折 never
 * （**自信的错值**：原生返回 "1"）⇒ 对完全合法、确定性的代码报
 * `nudo:entry-may-throw` **假红**（L2/L5）。
 *
 * 取证（原生 oracle）：
 * node -e 'const u=new URL("https://x/?a=1");
 * console.log(u.searchParams.constructor.name, u.searchParams.get("a"),
 * u.href, u.search, typeof u.searchParams)'
 */




const wrap = (body: string) => `export function f() { ${body} }`;


  it("new URL(u).searchParams.get(\"a\") → 精确 \"1\"（修前：确定抛 TypeError ⇒ 折 never）；new URL(u).searchParams 是 URLSearchParams 品牌（不再是 undefined）；typeof new URL(u).searchParams → \"object\"（原生同款；修前是 \"undefined\"）", () => {
  {
    const r = call(wrap(`return new URL("https://x/?a=1").searchParams.get("a");`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  }
  {
    const r = call(wrap(`return new URL("https://x/?a=1").searchParams;`), "f");
    expect(formatShape___nudojs_core(r.result)).toBe("URLSearchParams");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return typeof new URL("https://x/?a=1").searchParams;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "object" });
  }
});




describe("负控制（URL 其它组件槽不变 + 非法 URL 仍确定抛）", () => {
  it("new URL(u).href → \"https://x/?a=1\"；new URL(u).search → \"?a=1\"；new URL(u).origin → \"https://x\"（相邻组件槽不回归）；非法 URL 仍确定抛 TypeError（不被 searchParams 补丁放宽）", () => {
  {
    const r = call(wrap(`return new URL("https://x/?a=1").href;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "https://x/?a=1" });
  }
  {
    const r = call(wrap(`return new URL("https://x/?a=1").search;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "?a=1" });
  }
  {
    const r = call(wrap(`return new URL("https://x/?a=1").origin;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "https://x" });
  }
  {
    const r = call(wrap(`return new URL("not a url").href;`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
});



});
});

// ---------------------------------------------------------------------------
// Object.prototype.toLocaleString 委派 this.toString()
// ---------------------------------------------------------------------------
describe("Object.prototype.toLocaleString 委派 this.toString()", () => {
/**
 * 回归：Object.prototype.toLocaleString **委派接收者的 toString()**。
 *
 * 原生（node v26 实测）：
 * - `Object.prototype.toLocaleString.call({toString(){return "CUSTOM"}})`
 * === "CUSTOM"（委派接收者的 toString；**不**调接收者自有的
 * toLocaleString——自有 toLocaleString 原生永不被调用）；
 * - 接收者的 toString 抛错 ⇒ 原样冒泡；
 * - `Object.create(null)` 接收者 ⇒ TypeError（没有 toString 可委派）；
 * - `[1,2]` ⇒ "1,2"（Array.prototype.toString）、`5` ⇒ "5"
 * （Number.prototype.toString）。
 *
 * 修复前：toLocaleString 与 toString 合流折 "[object X]" ⇒ 用户自定义
 * toString 的**值与抛错全被吞**；null 原型接收者 no-throw。
 */




function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("自定义 toString 的值透传（改前折 \"[object Object]\"）；自定义 toString 的抛错透传（改前被吞成标签）；成员调用面同样委派（o.toLocaleString() === o.toString()）；null 原型接收者 ⇒ TypeError（改前 no-throw / 折 unknown）；数组接收者 ⇒ Array.prototype.toString 的值（原生 \"1,2\"）；数字接收者 ⇒ Number.prototype.toStr", () => {
  {
    expect(
      v(wrap(`const o = { toString() { return "CUSTOM"; } }; return Object.prototype.toLocaleString.call(o);`)),
    ).toEqual({ ok: true, value: "CUSTOM" });
  }
  {
    expect(
      v(
        wrap(
          `const o = { toString() { throw new Error("boom"); } }; try { return Object.prototype.toLocaleString.call(o); } catch (e) { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  }
  {
    expect(
      v(wrap(`const o = { toString() { return "X"; } }; return o.toLocaleString();`)),
    ).toEqual({ ok: true, value: "X" });
  }
  {
    expect(
      v(
        wrap(
          `try { return Object.prototype.toLocaleString.call(Object.create(null)); } catch (e) { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  }
  {
    expect(
      v(wrap(`return Object.prototype.toLocaleString.call([1, 2]);`)),
    ).toEqual({ ok: true, value: "1,2" });
  }
  {
    expect(v(wrap(`return Object.prototype.toLocaleString.call(5);`))).toEqual({
      ok: true,
      value: "5",
    });
  }
  {
    expect(v(wrap(`return Object.prototype.toLocaleString.call({ a: 1 });`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  }
  {
    expect(v(wrap(`return Object.prototype.toString.call({ a: 1 });`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  }
});








});

// ---------------------------------------------------------------------------
// Error cause slot only when options has a cause key
// ---------------------------------------------------------------------------
describe("Error cause slot only when options has a cause key", () => {
/**
 * `new Error("m", {})`（options **无 cause 键**）仍被装上自有 cause 槽。
 *
 * 原生 InstallErrorCause（ES2022 10.2.1）：**只有** options 真有 `cause`
 * 键时才 CreateNonEnumerableDataPropertyOrThrow(error, "cause", cause)——
 * options 无 cause 键 ⇒ 错误对象**无**自有 cause 槽（hasOwnProperty /
 * Object.hasOwn / `"cause" in e` 恒 false）；cause 键存在但值是 undefined
 * ⇒ 装槽、值为 undefined。
 *
 * node v26.10.0 原生实测（oracle）：
 * new Error("m", {}).hasOwnProperty("cause") → false
 * "cause" in new Error("m", {}) → false
 * new Error("m", {}).cause → undefined
 * new Error("m", {cause: 42}).hasOwnProperty("cause") → true
 * new Error("m", {cause: 42}).cause → 42
 * new Error("m", {cause: undefined}).hasOwnProperty(..) → true（值 undefined）
 * new Error("m").hasOwnProperty("cause") → false
 * Object.getOwnPropertyNames(new Error("m", {})) → ["stack","message"]
 * Object.getOwnPropertyNames(new Error("m", {cause: 1})) → ["stack","message","cause"]
 *
 * 修前：options 无 cause 键也装一个 undefAbs() 槽 ⇒ 自有面假 true
 * （"cause" in e 也假 true——$in 走槽存在性判定）。
 * 修复：error-family.ts 的 errorBrandAbs —— cause 槽**仅在** options 真有
 * cause 键时装。
 */




/** 调用 f() 的字面量结果（非字面量 → undefined） */
function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : undefined;
}

const HOP = "Object.prototype.hasOwnProperty.call";


  it("options 无 cause 键 ⇒ 无自有 cause 槽（hasOwnProperty false）；options 无 cause 键 ⇒ \"cause\" in e 恒 false（$in 走槽存在性）；options 无 cause 键 ⇒ e.cause 读出 undefined（缺席槽）；Object.hasOwn：无 cause 键 ⇒ false；options 有 cause 键 ⇒ 装槽（自有、值精确）；cause 键存在但值为 undefined ⇒ ", () => {
  {
    expect(v(`export function f() { return ${HOP}(new Error("m", {}), "cause"); }`)).toBe(false);
    expect(v(`export function f() { return ${HOP}(new TypeError("m", {}), "cause"); }`)).toBe(false);
    expect(v(`export function f() { return ${HOP}(new RangeError("m", {}), "cause"); }`)).toBe(false);
    expect(v(`export function f() { return ${HOP}(new AggregateError([1], "m", {}), "cause"); }`)).toBe(false);
  }
  {
    expect(v(`export function f() { return "cause" in new Error("m", {}); }`)).toBe(false);
    expect(v(`export function f() { return "cause" in new TypeError("m", {}); }`)).toBe(false);
    expect(v(`export function f() { return "cause" in new Error("m"); }`)).toBe(false);
  }
  {
    expect(v(`export function f() { return new Error("m", {}).cause; }`)).toBe(undefined);
    expect(v(`export function f() { return new Error("m").cause; }`)).toBe(undefined);
  }
  {
    expect(v(`export function f() { return Object.hasOwn(new Error("m", {}), "cause"); }`)).toBe(false);
    expect(v(`export function f() { return Object.hasOwn(new Error("m"), "cause"); }`)).toBe(false);
  }
  {
    expect(v(`export function f() { return ${HOP}(new Error("m", {cause: 42}), "cause"); }`)).toBe(true);
    expect(v(`export function f() { return new Error("m", {cause: 42}).cause; }`)).toBe(42);
    expect(v(`export function f() { return "cause" in new Error("m", {cause: 42}); }`)).toBe(true);
    expect(v(`export function f() { return Object.hasOwn(new Error("m", {cause: 1}), "cause"); }`)).toBe(true);
  }
  {
    expect(v(`export function f() { return ${HOP}(new Error("m", {cause: undefined}), "cause"); }`)).toBe(true);
    expect(v(`export function f() { return String(new Error("m", {cause: undefined}).cause); }`)).toBe("undefined");
  }
  {
    expect(v(`export function f() { return Object.getOwnPropertyNames(new Error("m", {})).join(","); }`)).toBe("stack,message");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new Error("m")).join(","); }`)).toBe("stack,message");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new Error("m", {cause: 1})).join(","); }`)).toBe("stack,message,cause");
    expect(v(`export function f() { return Object.getOwnPropertyNames(new AggregateError([1], "m", {cause: 1})).join(","); }`)).toBe("stack,message,cause,errors");
  }
  {
    expect(v(`export function f() { return String(Object.getOwnPropertyDescriptor(new Error("m", {}), "cause")); }`)).toBe("undefined");
    expect(v(`export function f() { const d = Object.getOwnPropertyDescriptor(new Error("m", {cause: 42}), "cause"); return [d.value, d.writable, d.enumerable, d.configurable].join(","); }`)).toBe("42,true,false,true");
  }
  {
    expect(v(`export function f() { return new Error("m", {cause: 1}).propertyIsEnumerable("cause"); }`)).toBe(false);
    expect(v(`export function f() { return new Error("m", {}).propertyIsEnumerable("cause"); }`)).toBe(false);
  }
});









});

// ---------------------------------------------------------------------------
// AggregateError errors is an IterableToList copy
// ---------------------------------------------------------------------------
describe("AggregateError errors is an IterableToList copy", () => {
/**
 * AggregateError(errors) 的 errors 槽与入参**共享同一 Abs**
 * （无 IterableToList 拷贝）。
 *
 * 原生 AggregateError 构造器走 `errors = IterableToList(errors)`——产出
 * **新列表**（元素同、列表不同）：
 * const a=[1,2]; const e=new AggregateError(a,"msg"); String(e.errors === a) → "false"
 * const a=[1,2]; const e=new AggregateError(a,"msg"); a.push(3); e.errors.length → 2
 *
 * node v26.10.0 原生实测（oracle）：
 * e.errors === a → false
 * a.push(3) 后 e.errors.length → 2（a.length → 3）
 * new AggregateError([1,2],"m").errors.length → 2
 * new AggregateError([1,2],"m").errors[0] → 1
 * new AggregateError([1,2],"m").errors.join("-") → "1-2"
 * Array.isArray(new AggregateError([1,2],"m").errors) → true
 * e.errors === e.errors → true（同一列表）
 * e1.errors === e2.errors → false（两次构造两个列表）
 * gOPD(errors) → {value:[1], writable:true, enumerable:false, configurable:true}
 *
 * 修前：slots["errors"] 直接存**同一个**入参 Abs（别名）⇒ `e.errors === a`
 * 折 true、`a.push(3)` 就地改写 e.errors.length。
 * 修复：error-family.ts 的 iterableListCopy —— tuple/arr 入参造**新 Abs**
 * （元素同、身份异；elements 数组另拷贝；打新鲜实例标使 === 折 exact false）。
 */




/** 调用 f() 的字面量结果（非字面量 → undefined） */
function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : undefined;
}


  it("e.errors !== 入参（原生 false；修前折 true）；入参后续变更不改写 e.errors（原生 length 不变）；拷贝内容与入参一致（长度 / 下标 / join / isArray）；同一实例的 errors 恒等；两次构造互不等（两个独立列表）；errors 槽仍是自有不可枚举数据属性（gOPD 描述符不变）", () => {
  {
    expect(
      v(`export function f() { const a=[1,2]; const e=new AggregateError(a,"msg"); return String(e.errors === a); }`),
    ).toBe("false");
  }
  {
    expect(
      v(`export function f() { const a=[1,2]; const e=new AggregateError(a,"msg"); a.push(3); return e.errors.length; }`),
    ).toBe(2);
    // 对照：入参自身确实被改写了（长度 3）
    expect(
      v(`export function f() { const a=[1,2]; const e=new AggregateError(a,"msg"); a.push(3); return a.length; }`),
    ).toBe(3);
  }
  {
    expect(v(`export function f() { return new AggregateError([1,2],"msg").errors.length; }`)).toBe(2);
    expect(v(`export function f() { return new AggregateError([1,2],"msg").errors[0]; }`)).toBe(1);
    expect(v(`export function f() { return new AggregateError([1,2],"msg").errors.join("-"); }`)).toBe("1-2");
    expect(v(`export function f() { return Array.isArray(new AggregateError([1,2],"msg").errors); }`)).toBe(true);
    expect(v(`export function f() { return new AggregateError([],"msg").errors.length; }`)).toBe(0);
    expect(v(`export function f() { return new AggregateError(["x"],"msg").errors[0]; }`)).toBe("x");
  }
  {
    expect(
      v(`export function f() { const e=new AggregateError([1],"msg"); return String(e.errors === e.errors); }`),
    ).toBe("true");
    expect(
      v(`export function f() { const e1=new AggregateError([1],"msg"); const e2=new AggregateError([1],"msg"); return String(e1.errors === e2.errors); }`),
    ).toBe("false");
  }
  {
    expect(
      v(`export function f() { const d = Object.getOwnPropertyDescriptor(new AggregateError([1], "m"), "errors"); return [d.value.length, d.writable, d.enumerable, d.configurable].join(","); }`),
    ).toBe("1,true,false,true");
    expect(
      v(`export function f() { return new AggregateError([1], "m").hasOwnProperty("errors"); }`),
    ).toBe(true);
    expect(
      v(`export function f() { return new AggregateError([1], "m").propertyIsEnumerable("errors"); }`),
    ).toBe(false);
  }
});





});

// ---------------------------------------------------------------------------
// Date.prototype.toJSON 对非法日期返回 null
// ---------------------------------------------------------------------------
describe("Date.prototype.toJSON 对非法日期返回 null", () => {
/**
 * 回归：`Date.prototype.toJSON` 对**非法日期**（time value = NaN）
 * 返回 **null**（不是字符串）。
 *
 * ES 语义（node 实测）：
 * - `Date.prototype.toJSON(key)`：取 [[DateValue]]；**NaN → null**；否则
 * 返回 ISO 串（≡ toISOString）。
 * - `new Date(NaN).toJSON()` → null；`new Date(0).toJSON()` → ISO 串；
 * `JSON.stringify(new Date(NaN))` → "null"（JSON 侧既有口径）。
 *
 * 修复前：toJSON 混进「恒返回 string」的方法集合 ⇒ 非法日期也折成**抽象
 * string**（既不是 null 也不是确定值）；`d.toJSON() === null` 折**确定的
 * false**（自信的错值）。
 *
 * 不变量（负控制钉住）：
 * - 有效日期的 toJSON 仍是 ISO 串；
 * - `JSON.stringify` 投影面不变（Date → ISO 串 / Invalid → "null"）；
 * - toISOString 对非法日期仍**确定抛 RangeError**（toJSON 不抛——返回 null）；
 * - 抽象 Date（time value 不可知）→ `string | null` 域（不折确定 false）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("new Date(NaN).toJSON() → null（原生口径）；toJSON() === null → true（修复前折确定的 false）；String(new Date(NaN).toJSON()) → \"null\"；有效日期的 toJSON → ISO 串（原生口径）；负控制：JSON.stringify 投影面不变（Invalid → \"null\"，有效 → ISO 串）；负控制：toISOString 对非法日期仍确定抛 RangeError（toJSON", () => {
  {
    expect(v(wrap(`const d = new Date(NaN); return d.toJSON();`))).toEqual({ ok: true, value: null });
  }
  {
    expect(v(wrap(`const d = new Date(NaN); return String(d.toJSON() === null);`)))
      .toEqual({ ok: true, value: "true" });
    expect(v(wrap(`const d = new Date(0); return String(d.toJSON() === null);`)))
      .toEqual({ ok: true, value: "false" });
  }
  {
    expect(v(wrap(`const j = new Date(NaN).toJSON(); return String(j);`)))
      .toEqual({ ok: true, value: "null" });
  }
  {
    expect(v(wrap(`const d = new Date(0); return d.toJSON();`)))
      .toEqual({ ok: true, value: "1970-01-01T00:00:00.000Z" });
    expect(v(wrap(`const d = new Date("2020-01-02T03:04:05Z"); return d.toJSON();`)))
      .toEqual({ ok: true, value: "2020-01-02T03:04:05.000Z" });
  }
  {
    expect(v(wrap(`const d = new Date(NaN); return JSON.stringify(d);`)))
      .toEqual({ ok: true, value: "null" });
    expect(v(wrap(`const d = new Date(0); return JSON.stringify(d);`)))
      .toEqual({ ok: true, value: "\"1970-01-01T00:00:00.000Z\"" });
  }
  {
    expect(throwName(wrap(`const d = new Date(NaN); return d.toISOString();`))).toBe("RangeError");
    expect(throwName(wrap(`const d = new Date(NaN); return d.toJSON();`))).toBe("");
  }
  {
    // 零参 new Date() 取当前时间：规范保证落在可表示区间内 ⇒ 恒非 Invalid
    // Date ⇒ toJSON 恒 ISO 串（null 只属于 Invalid Date）⇒ 比较可折确定 false。
    // （抽象 Date / new Date(undefined) 才是 `string | null` 的 may 档。）
    expect(v(wrap(`const d = new Date(); return d.toJSON() === null;`)))
      .toEqual({ ok: true, value: false });
    expect(v(wrap(`const d = new Date(undefined); return d.toJSON() === null;`)))
      .toEqual({ ok: true, value: true });
  }
});







});

// ---------------------------------------------------------------------------
// Reflect.set(arr, "length", v) 落 ArraySetLength
// ---------------------------------------------------------------------------
describe("Reflect.set(arr, \"length\", v) 落 ArraySetLength", () => {
/**
 * 回归：`Reflect.set(arr, "length", v)` 落 [[Set]] → **ArraySetLength**
 * （原生：length 被改成 v，元素被截断/延长），改前**静默丢弃写入**
 * （引擎 length 不变 ⇒ 错值）。
 *
 * 原生（node v26 实测）：
 * - `Reflect.set(a, "length", 1)` → a.length = 1、a = [1]、返回 true；
 * - `Reflect.set(a, "length", 5)` → a.length = 5（延长出 hole）；
 * - 非法 length（-1 / 1.5）→ RangeError（原生同款）。
 *
 * 修复前：数组面只接下标键（canonicalArrayIndex），"length" 键既不建模
 * 也不写 ⇒ 写被丢弃、返回值恒抽象 boolean。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 入口 throws 面（brand 名）——未抛则 undefined */
function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("length 被截断（原生 1 / [1]，改前 3 / [1,2,3]）；length 被延长（原生 5）；返回值是 true（原生同款）；下标写不受影响（负控制）；直接赋值 length 仍可用（负控制）", () => {
  {
    expect(
      v(wrap(`const a = [1,2,3]; Reflect.set(a, "length", 1); return String(a.length) + ":" + a.join(",");`)),
    ).toEqual({ ok: true, value: "1:1" });
  }
  {
    expect(
      v(wrap(`const a = [1,2,3]; Reflect.set(a, "length", 5); return String(a.length);`)),
    ).toEqual({ ok: true, value: "5" });
  }
  {
    expect(
      v(wrap(`const a = [1,2,3]; return String(Reflect.set(a, "length", 1));`)),
    ).toEqual({ ok: true, value: "true" });
  }
  {
    expect(
      v(wrap(`const a = [1,2,3]; Reflect.set(a, "0", 9); return a.join(",");`)),
    ).toEqual({ ok: true, value: "9,2,3" });
  }
  {
    expect(
      v(wrap(`const a = [1,2,3]; a.length = 1; return String(a.length);`)),
    ).toEqual({ ok: true, value: "1" });
  }
});





});

// ---------------------------------------------------------------------------
// [merged] url-searchparams-entries
// ---------------------------------------------------------------------------
describe("url-searchparams-entries", () => {
// MERGED (topic-related bug pins): url-searchparams-entries + url-searchparams-slot
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>




{
/**
 * 回归：**URLSearchParams 条目表**（[[name, value]] 对的序列）建模与
 * 品牌方法派发。
 *
 * 本文件钉的是**主 agent 刚完成的接线**：
 * - `packages/core/src/algebra/builtins/error/web.ts`：新增内部槽
 * `URL_SEARCH_PARAMS_ENTRIES_SLOT`（`"@@entries"`）、`urlSearchParamsEntriesOf(a)`
 * （读表）、`urlSearchParamsSetEntries(a, entries)`（写表）；
 * `urlBrandAbs(u)` 给 URL brand 补 `searchParams` 槽（**宿主 URL** ⇒ 条目表
 * 由 `u.search` 按 WHATWG 查询串解析**精确**推出；**抽象 URL** ⇒ 条目表不可知）；
 * `makeUrlSearchParamsAbs(init)`：init 缺席/nullish ⇒ 空表；字符串/数字/布尔/
 * bigint **字面量** ⇒ 按查询串解析；**二元组 tuple** ⇒ 元素两侧均为字符串
 * 字面量时逐条精确；**record obj** ⇒ 槽值均为字符串字面量时精确；否则表不可知。
 * - `packages/core/src/algebra/builtins/error/dispatch.ts`：
 * `evalBuiltinInstanceMethod` 新增 `URLSearchParams` 派发臂 → `evalUrlSearchParamsMethod`
 * （get / getAll / has / size / toString / set / append / delete / sort / keys /
 * values / entries）。
 * - `packages/core/src/algebra/exec/runtime/containers/member.ts`：`size` 读取
 * 分派新增 `URLSearchParams`（原生 `size` 是 **getter**，不是方法）。
 *
 * 原生语义要点（node v26.10.0 实测）：
 * - `get(name)` 无匹配返 **null**（不是 undefined）；`delete(name)` 返
 * **undefined**（不是 boolean）；`set` / `append` 返 undefined；`size` 是条目数；
 * - `append` **追加**一条（同键不去重）⇒ `new URLSearchParams("a=1&b=2")` 后
 * `append("b","2")` ⇒ `toString()` === `"a=1&b=2&b=2"`；
 * - `set(name, value)` **替换**全部同键条目 ⇒ `getAll("a")` === `["9"]`。
 *
 * 原生依据（node v26.10.0 实测）：
 * - `new URL("http://x/?a=1&b=2").searchParams.get("a")` === `"1"`
 * - `new URL("http://x/?a=1&b=2").searchParams.get("z")` === `null`
 * - `new URL("http://x/?a=1&a=2").searchParams.getAll("a")` === `["1","2"]`
 * - `new URL("http://x/?a=1&b=2").searchParams.has("a")` === `true`
 * - `new URL("http://x/?a=1&b=2").searchParams.has("z")` === `false`
 * - `new URL("http://x/?a=1&b=2").searchParams.size` === `2`
 * - `new URL("http://x/?a=1&b=2").searchParams.toString()` === `"a=1&b=2"`
 * - `new URLSearchParams("a=1&b=2").get("b")` === `"2"`
 * - `new URLSearchParams().size` === `0`
 * - `new URLSearchParams([["a","1"]]).get("a")` === `"1"`
 * - `new URLSearchParams({a:"1"}).get("a")` === `"1"`（record init）
 * - `new URLSearchParams(5).toString()` === `"5="`（数字字面量 init）
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 抽象（不可知）实参——init 不可知时的口径 */
const unknownAbs = abs({ k: "unknown" }, undefined, undefined, "partial");

describe("URL brand 的 searchParams 条目表（精确取值）", () => {
  it("get(name) 命中 → 精确值（原生 \"1\"）；get(name) 未命中 → null（原生 null，**不是** undefined）；getAll(name) → 全部匹配值（原生 [\"1\",\"2\"]）；has(name) → 命中 true / 未命中 false（原生同款）；size 是 **getter**（原生 2，条目数）；toString() → 查询串（原生 \"a=1&b=2\"）", () => {
  {
    const r = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.get("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.get("z");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: null });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(
      wrap(`return new URL("http://x/?a=1&a=2").searchParams.getAll("a");`),
      "f",
    );
    expect(tupleEls(r.result)).toEqual(["1", "2"]);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const hit = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.has("a");`), "f");
    expect(litValue(hit.result)).toEqual({ ok: true, value: true });
    const miss = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.has("z");`), "f");
    expect(litValue(miss.result)).toEqual({ ok: true, value: false });
    expect(throwsError(miss.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.size;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.toString();`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "a=1&b=2" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
});





});

describe("new URLSearchParams(init) 的条目表", () => {
  it("字符串 init → 查询串解析（原生 get(\"b\") === \"2\"）；init 缺席 → 空表（原生 size === 0）；二元组 tuple init → 逐条精确（原生 get(\"a\") === \"1\"）；record init → 槽值为字符串字面量时精确（原生 get(\"a\") === \"1\"）；数字 / 布尔字面量 init → 按查询串解析（原生 \"5=\" / \"true=\"）", () => {
  {
    const r = call(wrap(`return new URLSearchParams("a=1&b=2").get("b");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "2" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return new URLSearchParams().size;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return new URLSearchParams([["a","1"]]).get("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return new URLSearchParams({ a: "1" }).get("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const num = call(wrap(`return new URLSearchParams(5).toString();`), "f");
    expect(litValue(num.result)).toEqual({ ok: true, value: "5=" });
    const bool = call(wrap(`return new URLSearchParams(true).toString();`), "f");
    expect(litValue(bool.result)).toEqual({ ok: true, value: "true=" });
    expect(throwsError(bool.throws, "TypeError")).toBe(false);
  }
});




});

describe("变更面：set / append / delete / sort", () => {
  it("append 追加一条（同键不去重）→ toString 原生 \"a=1&b=2&b=2\"；set 替换全部同键条目 → getAll(\"a\") 原生 [\"9\"]；delete 返 **undefined**（原生 undefined，**不是** boolean）；delete 真的移除条目（原生 get(\"a\") === null、size === 1）；set / append 返 undefined（原生同款）；sort 按名排序（原生 \"a=1&b=2\"）；keys", () => {
  {
    const r = call(
      wrap(
        `const sp = new URLSearchParams("a=1&b=2"); sp.append("b", "2"); return sp.toString();`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a=1&b=2&b=2" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(
      wrap(
        `const sp = new URLSearchParams("a=1&a=2"); sp.set("a", "9"); return sp.getAll("a");`,
      ),
      "f",
    );
    expect(tupleEls(r.result)).toEqual(["9"]);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`const sp = new URLSearchParams("a=1&b=2"); return sp.delete("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(
      wrap(
        `const sp = new URLSearchParams("a=1&b=2"); sp.delete("a"); return [sp.get("a"), sp.get("b"), sp.size];`,
      ),
      "f",
    );
    expect(tupleEls(r.result)).toEqual([null, "2", 1]);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const setR = call(wrap(`const sp = new URLSearchParams("a=1"); return sp.set("b", "2");`), "f");
    expect(litValue(setR.result)).toEqual({ ok: true, value: undefined });
    const appR = call(wrap(`const sp = new URLSearchParams("a=1"); return sp.append("b", "2");`), "f");
    expect(litValue(appR.result)).toEqual({ ok: true, value: undefined });
    expect(throwsError(appR.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(
      wrap(`const sp = new URLSearchParams("b=2&a=1"); sp.sort(); return sp.toString();`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a=1&b=2" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const keys = call(wrap(`return [...new URLSearchParams("a=1&b=2").keys()];`), "f");
    expect(tupleEls(keys.result)).toEqual(["a", "b"]);
    const values = call(wrap(`return [...new URLSearchParams("a=1&b=2").values()];`), "f");
    expect(tupleEls(values.result)).toEqual(["1", "2"]);
    expect(throwsError(values.throws, "TypeError")).toBe(false);
  }
});






});

describe("负控制 / 精度口径", () => {
  it("URL 的其它组件槽不变（href / search）；非法 URL 仍确定抛 TypeError（不被 searchParams 补丁放宽）；条目表不可知时**不假精确**（抽象 init → unknown 域，且不抛）；抽象 URL 的 searchParams 条目表同样不可知（unknown 域，不抛）", () => {
  {
    expect(litValue(call(wrap(`return new URL("http://x/?a=1").href;`), "f").result)).toEqual({
      ok: true,
      value: "http://x/?a=1",
    });
    expect(litValue(call(wrap(`return new URL("http://x/?a=1").search;`), "f").result)).toEqual({
      ok: true,
      value: "?a=1",
    });
  }
  {
    const r = call(wrap(`return new URL("not a url").href;`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    // 原生：`new URLSearchParams(抽象值)` 的条目表取决于运行时值 ⇒ 引擎不可知。
    // 口径：折 **unknown**（不是某个自信的确定值），且**不记假抛**。
    const r = call(
      `export function f(x) { return new URLSearchParams(x).get("a"); }`,
      "f",
      [unknownAbs],
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  }
  {
    const r = call(
      `export function f(x) { return new URL(x).searchParams.get("a"); }`,
      "f",
      [unknownAbs],
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  }
});



});
}

describe("url-searchparams-slot", () => {
/**
 * 回归：`new URL(...)` 的实例模型补 `searchParams` 槽。
 *
 * ES 语义（node 实测）：`new URL(u).searchParams` **恒**是 URLSearchParams
 * 实例——原生 URL 的组件槽表里 `searchParams` 与 href/origin/protocol/…
 * 平级，读面**不是 undefined**。
 *
 * 修复前：core 的 URL 组件槽表只列了 10 个 URL 组件，**独缺 searchParams**
 * ⇒ 读它落「槽缺失 ⇒ undefined」⇒ `.get(...)` 在 undefined 上调用 ⇒
 * **确定 TypeError** ⇒ 返回值折 `never`（**错的确定值**；原生返回 "1"）
 * ⇒ 对完全合法、确定性的代码报 `nudo:entry-may-throw` **假红**（L2/L5）。
 *
 * 修法（`exec/class/declare.ts` 的构造面）：`$new` 的宿主构造器分支给
 * URL brand 的内层 obj 补一个 `searchParams` 槽，值 = URLSearchParams
 * brand（`makeUrlSearchParamsAbs`）。
 *
 * 精度口径（**不得**折假精确）：URLSearchParams 的**条目表不建模**（仓内
 * 既有精度债——builtin-coverage-registry 登记 "URLSearchParams.proto.get：
 * 条目表不建模，接受 unknown"）⇒ `searchParams.get(k)` 折 **unknown**
 * （原生给具体字符串）。本条修的是**假抛 / never**（确定的错），不是把
 * unknown 升级成具体值（那要建模条目表——非本分片地盘，见报告越界诉求）。
 *
 * 负控制钉住：URL 其它组件槽不变、非法 URL 仍确定抛 TypeError、
 * `new URLSearchParams(...)` 的 get 口径不变（仍是 unknown）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

describe("new URL(...).searchParams 不再是「读 undefined → 确定抛」", () => {
  it("new URL(u).searchParams.get(\"a\")：不再是 never（改前确定抛 TypeError ⇒ 折 never）；new URL(u).searchParams.get(\"a\")：值口径精确 \"1\"（条目表已建模——原生同值）；typeof new URL(u).searchParams === \"object\"（原生同款；改前是 \"undefined\"）；new URL(u).searchParams.has(\"a\")：不再是 never（同款假抛", () => {
  {
    const r = call(
      wrap(`return new URL("https://example.com/?a=1").searchParams.get("a");`),
      "f",
    );
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    // 口径演进：条目表此前**不建模**（值域 unknown，保守但不准）⇒ 引擎自
    // 己的「不折假精确」纪律。收口时条目表已按 WHATWG 查询串
    // 解析建模（URL brand 的 search 组件 → 宿主 URLSearchParams 解析）⇒
    // 值域**精确**且与原生一致（node v26：get("a") === "1"）。
    const r = call(
      wrap(`return new URL("https://example.com/?a=1").searchParams.get("a");`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
  }
  {
    const r = call(wrap(`return typeof new URL("https://example.com/?a=1").searchParams;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
  }
  {
    const r = call(
      wrap(`return new URL("https://example.com/?a=1").searchParams.has("a");`),
      "f",
    );
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
});



});

describe("负控制（URL 构造面的邻近形态不回归）", () => {
  it("URL 其它组件槽不变：href / protocol / search / toString；new URLSearchParams(\"a=1\").get(\"a\")：条目表已建模 ⇒ 精确 \"1\"（原生同值）；new URLSearchParams(\"a=1\").get 是函数（品牌方法名集仍生效）", () => {
  {
    expect(litValue(call(wrap(`return new URL("https://x/").href;`), "f").result)).toEqual({
      ok: true,
      value: "https://x/",
    });
    expect(litValue(call(wrap(`return new URL("https://x/").protocol;`), "f").result)).toEqual({
      ok: true,
      value: "https:",
    });
    expect(litValue(call(wrap(`return new URL("https://x/?a=1").search;`), "f").result)).toEqual({
      ok: true,
      value: "?a=1",
    });
  }
  {
    // 同上：字符串 init 按 WHATWG 查询串解析建模 ⇒ 精确值（原生 "1"）。
    const r = call(wrap(`return new URLSearchParams("a=1").get("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return typeof new URLSearchParams("a=1").get;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  }
});


});
});
});

// ---------------------------------------------------------------------------
// 开放键集对象的 keys/values/entries 折 partial
// ---------------------------------------------------------------------------
describe("开放键集对象的 keys/values/entries 折 partial", () => {
/**
 * 回归：Object.keys / values / entries 对**自有键集不完备**的对象
 * （Object.groupBy 的分组对象——组键由回调运行时 ToPropertyKey 决定，静态
 * 不可知）折 **partial**，不再折 exact 空元组。
 *
 * 原生（node v26 实测）：`Object.keys(Object.groupBy([1,2], f))` ===
 * ["[object Object]"]（组键 = 回调返回值的字符串化）——引擎折 exact [] 是
 * **自信的确切错值** ⇒ dts / zod / guard 三个产物面据此判「只接受空数组」
 * ⇒ TS 消费方吃假红、运行时校验器拒掉每一个真实值。
 *
 * 修复前：组键不可判时分组对象是「开放 obj + 零槽」⇒ 键家族精确枚举空槽
 * 表 ⇒ 折 exact []。
 *
 * 判据载体：prop flags 侧表里的标记键（不落 shape 字段——shape 类型在共享
 * 文件里）；「自有键集确为空」的开放对象（Object.create 的空槽产品）不受
 * 影响（负控制钉住）。
 */




function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;


  it("Object.groupBy 的 keys 不再折 exact 空元组（改前折 []）；Object.groupBy 的 values / entries 同样不再折 exact 空元组；组键可判时（字面量键）仍折精确键集（原生 keys === [\"a\"]）；负控制：普通对象的 keys/values/entries 仍精确；负控制：Object.create(<obj>) 的自有键集确为空 ⇒ 仍精确折 []（Bug 41 pin）", () => {
  {
    const r = call(
      wrap(`return Object.keys(Object.groupBy([1, 2], (x) => ({ t: "x" })));`),
      "f",
    );
    // 折 partial（arr 保守域，元素 string）⇒ 不是「确切空元组」
    expect(r.result.shape.k).toBe("arr");
    expect(r.result.conf).toBe("partial");
  }
  {
    for (const m of ["values", "entries"]) {
      const r = call(
        wrap(`return Object.${m}(Object.groupBy([1, 2], (x) => ({ t: "x" })));`),
        "f",
      );
      expect(r.result.shape.k).toBe("arr");
      expect(r.result.conf).toBe("partial");
    }
  }
  {
    expect(
      v(wrap(`return JSON.stringify(Object.keys(Object.groupBy([1, 2], (x) => "a")));`)),
    ).toEqual({ ok: true, value: '["a"]' });
  }
  {
    expect(v(wrap(`return JSON.stringify(Object.keys({ a: 1 }));`))).toEqual({
      ok: true,
      value: '["a"]',
    });
    expect(v(wrap(`return JSON.stringify(Object.values({ a: 1 }));`))).toEqual({
      ok: true,
      value: "[1]",
    });
    expect(v(wrap(`return JSON.stringify(Object.entries({ a: 1 }));`))).toEqual({
      ok: true,
      value: '[["a",1]]',
    });
  }
  {
    expect(v(wrap(`return JSON.stringify(Object.keys(Object.create({ a: 1 })));`))).toEqual({
      ok: true,
      value: "[]",
    });
  }
});





});

// ---------------------------------------------------------------------------
// [merged] json-eff-and-replacer
// ---------------------------------------------------------------------------
describe("json-eff-and-replacer", () => {
// MERGED (topic-related bug pins): json-eff-and-replacer + json-nested-brand
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






{
/**
 * 回归：JSON 面的 **eff（Promise / 生成器对象）折叠** 与
 * **不可调用 replacer 被忽略**。
 *
 * 本文件钉的是**主 agent 刚完成的接线**（`packages/core/src/algebra/builtins/json.ts`）：
 * - `absToJsonNative` 新增 `eff` 臂 ⇒ 恒返回 `{}`（原生：Promise / 生成器
 * 对象无自有可枚举属性、无 toJSON ⇒ `JSON.stringify({p: Promise.resolve(1)})`
 * === `'{"p":{}}'` 且**不抛**）；
 * - `jsonStringifyTotal` 新增 `eff` ⇒ total（恒不抛）；
 * - replacer **可调用性**判定：`brand` **不再一律**记 may-throw——只有
 * **构造器 brand**（`classNameOfValue(abs) !== undefined` ⇒ class 值 / 内建
 * 构造器）才记 may-throw（可调用）；`brand` **实例**（`new Map()` /
 * `new Date()` / 用户类实例）与 `eff` 都**不可调用** ⇒ 原生忽略 replacer ⇒
 * **不抛**。
 *
 * 修前：eff 无臂 ⇒ 落 NOT_LITERAL ⇒ 父层记 may-throw ⇒ **L1/L2 假红**；
 * brand/eff 作 replacer 一律记 may-throw ⇒ 同款假红。
 *
 * 原生依据（node v26.10.0 实测）：
 * - `JSON.stringify({p: Promise.resolve(1)})` === `'{"p":{}}'`（不抛）
 * - `JSON.stringify({m: new Map()})` === `'{"m":{}}'`（不抛）
 * - `JSON.stringify({d: new Date(0)})` === `'{"d":"1970-01-01T00:00:00.000Z"}'`
 * - `JSON.stringify({g: (function*(){})()})` === `'{"g":{}}'`（不抛）
 * - `JSON.stringify({a:1}, new Map())` === `'{"a":1}'`（**不抛**——brand 实例
 * 不可调用 ⇒ replacer 被忽略）
 * - `JSON.stringify({a:1}, Promise.resolve(1))` === `'{"a":1}'`（不抛）
 * - `JSON.stringify({a:1}, {})` === `'{"a":1}'`（不抛）
 * - `JSON.stringify({a:1}, Map)` → **抛 TypeError**（原生
 * "Constructor Map requires 'new'"——构造器 brand **可调用** ⇒ 逐键调用
 * ⇒ 抛）★ 本文件的核心区分。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 带 any 实参的入口（effects 面用——抽象接收者才走 may-throw 记账） */
const wrapArg = (body: string) => `export function f(x) { ${body} }`;

describe("JSON 面的 eff（Promise / 生成器对象）折叠", () => {
  it("Promise 对象 → {}（原生 '{\"p\":{}}'，不抛）；Map 实例 → {}（原生 '{\"m\":{}}'，不抛）；Date 实例 → ISO 串（原生 '{\"d\":\"1970-01-01T00:00:00.000Z\"}'）；生成器对象 → {}（原生 '{\"g\":{}}'，不抛）；eff 臂不记 may-throw（产品面 L1/L2 假红消失）", () => {
  {
    const r = call(wrap(`return JSON.stringify({ p: Promise.resolve(1) });`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"p":{}}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return JSON.stringify({ m: new Map() });`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"m":{}}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return JSON.stringify({ d: new Date(0) });`), "f");
    expect(litValue(r.result)).toEqual({
      ok: true,
      value: '{"d":"1970-01-01T00:00:00.000Z"}',
    });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return JSON.stringify({ g: (function* () {})() });`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"g":{}}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    expect(effects(wrap(`return JSON.stringify({ p: Promise.resolve(1) });`))).not.toContain(
      "TypeError",
    );
    expect(effects(wrap(`return JSON.stringify({ g: (function* () {})() });`))).not.toContain(
      "TypeError",
    );
  }
});




});

describe("replacer 可调用性：构造器 brand 可调用，brand 实例 / eff 不可调用", () => {
  it("★ 构造器 brand 作 replacer → 抛 TypeError（原生 'Constructor Map requires new'）；★ brand **实例**作 replacer → 不抛（原生 '{\"a\":1}'）；eff 作 replacer → 不抛（原生 '{\"a\":1}'）；普通对象作 replacer → 不抛（原生 '{\"a\":1}'）；brand 实例 / eff 作 replacer 不记 may-throw（负控制：构造器 brand 仍记）", () => {
  {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, Map);`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, new Map());`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, Promise.resolve(1));`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, {});`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    // 不可调用的 replacer 被原生忽略 ⇒ 不可能抛 ⇒ 引擎不得记 may-throw。
    expect(effects(wrap(`return JSON.stringify({ a: 1 }, new Map());`))).not.toContain(
      "TypeError",
    );
    expect(effects(wrap(`return JSON.stringify({ a: 1 }, Promise.resolve(1));`))).not.toContain(
      "TypeError",
    );
    expect(effects(wrap(`return JSON.stringify({ a: 1 }, {});`))).not.toContain("TypeError");
  }
});




});

describe("负控制（邻近形态不回归）", () => {
  it("可调用 replacer 仍逐键生效（原生同款）；普通对象 / 数组序列化不回归（原生 '{\"a\":1,\"b\":[1,2]}'）；用户 toJSON 面仍不可折（仍记 may-throw）；BigInt 元素家族仍记 may-throw TypeError（原生定抛，不在 total 集）", () => {
  {
    const r = call(wrap(`return JSON.stringify({ a: 1 }, (k, v) => v);`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return JSON.stringify({ a: 1, b: [1, 2] });`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: '{"a":1,"b":[1,2]}' });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    // 负控制：eff / brand 实例的豁免**不外溢**到「用户面可能抛」的分支。
    expect(effects(wrapArg(`return JSON.stringify(x);`))).toContain("TypeError");
  }
  {
    // 原生：JSON.stringify({b: new BigInt64Array([1n])}) 定抛 TypeError
    //（"Do not know how to serialize a BigInt64Array"）。引擎按 may-throw
    // 记账（入口 throws 面不落定抛）⇒ 钉 effects 面。
    expect(effects(wrapArg(`return JSON.stringify({ b: new BigInt64Array([1n]) });`))).toContain(
      "TypeError",
    );
  }
});



});
}

describe("json-nested-brand", () => {
/**
 * 回归：JSON.stringify 的**内建 brand 折叠是递归的**（顶层与
 * 对象/数组**成员**同款）。
 *
 * 修前：`foldJsonTotalBrand` 只喂**顶层**接收者 ⇒ **嵌套** brand 一律落
 * 「may carry BigInt / circular / throwing toJSON」⇒ **记 may-throw**
 * ⇒ L1/L2 **假红**（native 全部正常返回）；而同一 brand 放在顶层则完全
 * 正确 ⇒「total brand 白名单只对顶层接收者生效」。
 *
 * 修法（json.ts `jsonBrandFold` 单一事实源 + `absToJsonNative` 的 brand
 * 臂 + `jsonStringifyTotal` 的 brand 臂）：
 * - 精确可折：RegExp/Map/Set 族/Error 族 → {}；Date → ISO 串（Invalid →
 * null）；URL → href；装箱 Number/String/Boolean → 拆箱后的原始值；
 * - total 但值不可知：TypedArray 家族（元素值未建模）——**恒不抛**；
 * - 不可折（仍记 may-throw）：用户 toJSON 面、BigInt 元素家族
 * （BigInt64Array/BigUint64Array —— 原生**定抛** TypeError）。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */





const anyAbs = abs___nudojs_core({ k: "any" }, undefined, undefined, "path");

/** 源级求值（带 any 实参）：{ value, throws, effects } 三面 */
function evalSrc(src: string, fnName = "f"): { value: unknown; throws: unknown; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, [anyAbs] as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    value: result.result,
    throws: result.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("JSON.stringify 的嵌套内建 brand（不记 may-throw）", () => {
  it("嵌套 Date → 精确折叠（node: {\"when\":\"1970-01-01T00:00:00.000Z\"}）；嵌套 Map / Set / RegExp / Error → {}（node）；装箱 prim → 拆箱后的原始值（node: {\"s\":\"ab\"}）；嵌套 brand 不再记 may-throw（负控制：BigInt 元素家族仍记）；嵌套 brand 的入口不记 may-throw（产品面 L2 假红消失）；深层嵌套（数组 / 多层对象）同样折叠（node）", () => {
  {
    expect(v(`export function f() { return JSON.stringify({ when: new Date(0) }); }`)).toEqual({
      ok: true,
      value: '{"when":"1970-01-01T00:00:00.000Z"}',
    });
  }
  {
    expect(v(`export function f() { return JSON.stringify({ m: new Map([[1,2]]) }); }`)).toEqual({
      ok: true,
      value: '{"m":{}}',
    });
    expect(v(`export function f() { return JSON.stringify({ s: new Set([1,2]) }); }`)).toEqual({
      ok: true,
      value: '{"s":{}}',
    });
    expect(v(`export function f() { return JSON.stringify({ r: /a(b)/g }); }`)).toEqual({
      ok: true,
      value: '{"r":{}}',
    });
    expect(v(`export function f() { return JSON.stringify({ e: new Error("x") }); }`)).toEqual({
      ok: true,
      value: '{"e":{}}',
    });
  }
  {
    expect(v(`export function f() { return JSON.stringify({ s: new String("ab") }); }`)).toEqual({
      ok: true,
      value: '{"s":"ab"}',
    });
    expect(v(`export function f() { return JSON.stringify({ n: new Number(5) }); }`)).toEqual({
      ok: true,
      value: '{"n":5}',
    });
    expect(v(`export function f() { return JSON.stringify({ b: new Boolean(true) }); }`)).toEqual({
      ok: true,
      value: '{"b":true}',
    });
  }
  {
    const ok = evalSrc(`export function f(x) { return JSON.stringify({ when: new Date(0) }); }`);
    expect(ok.effects).not.toContain("TypeError");
    const bi = evalSrc(`export function f(x) { return JSON.stringify({ b: new BigInt64Array([1n]) }); }`);
    expect(bi.effects).toContain("TypeError");
  }
  {
    const r = call(`export function f() { return JSON.stringify({ when: new Date(0) }); }`, "f");
    expect((r.throws as { shape?: { k?: string } }).shape?.k).toBe("never");
  }
  {
    expect(v(`export function f() { return JSON.stringify([[new Date(0)]]); }`)).toEqual({
      ok: true,
      value: '[["1970-01-01T00:00:00.000Z"]]',
    });
    expect(v(`export function f() { return JSON.stringify({ deep: { deeper: new Date(0) } }); }`)).toEqual({
      ok: true,
      value: '{"deep":{"deeper":"1970-01-01T00:00:00.000Z"}}',
    });
  }
  {
    expect(
      v(`export function f() { return JSON.stringify({ url: new URL("https://x.test/") }); }`),
    ).toEqual({ ok: true, value: '{"url":"https://x.test/"}' });
  }
  {
    expect(
      v(`export function f() { return JSON.stringify({ when: new Date(0) }, (k, v) => v); }`),
    ).toEqual({ ok: true, value: '{"when":"1970-01-01T00:00:00.000Z"}' });
    expect(
      v(`export function f() { return JSON.stringify({ m: new Map() }, (k, v) => v); }`),
    ).toEqual({ ok: true, value: '{"m":{}}' });
  }
  {
    expect(v(`export function f() { return JSON.stringify(new Date(0)); }`)).toEqual({
      ok: true,
      value: '"1970-01-01T00:00:00.000Z"',
    });
  }
  {
    const r = evalSrc(`export function f(x) { return JSON.stringify({ u: new Uint8Array([1,2]) }); }`);
    expect(r.effects).not.toContain("TypeError");
    const r2 = call(`export function f() { return JSON.stringify({ u: new Uint8Array([1,2]) }); }`, "f");
    expect((r2.throws as { shape?: { k?: string } }).shape?.k).toBe("never");
  }
  {
    const r = evalSrc(`export function f(x) { return JSON.stringify(x); }`);
    expect(r.effects).toContain("TypeError");
  }
  {
    expect(v(`export function f() { return JSON.stringify({ a: 1, b: [1, 2] }); }`)).toEqual({
      ok: true,
      value: '{"a":1,"b":[1,2]}',
    });
  }
});











});
});
});

// ---------------------------------------------------------------------------
// String(<brand>) 不再一律记 may-throw TypeError
// ---------------------------------------------------------------------------
describe("String(<brand>) 不再一律记 may-throw TypeError", () => {
/**
 * 回归：`String(<brand>)` 的抽象臂不再一律记 may-throw TypeError。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 * String(new Date(0)) → "Thu Jan 01 1970 08:00:00 GMT+0800 (中国标准时间)"
 * （**不抛**）
 * String(new Map()) → "[object Map]"（**不抛**）
 * String({}) → "[object Object]"（**不抛**）
 * `${new Date(0)}` → 与 String(new Date(0)) 同值（**不抛**）
 * String(new Date(0)) === `${new Date(0)}` → true（**两侧都不抛**）
 *
 * 修前：`String(x)` 的抽象臂对**带品牌**的 x 一律记 may-throw TypeError
 * ⇒ 对 `String(new Date(0))` 这种**确定不抛**的代码报 may-throw（假红，
 * L2/L5 的 `nudo:entry-may-throw` 误报）；且同一载荷内部**自相矛盾**——
 * `String()` 记 may-throw、模板串判 OK（同一语义两种写法结论相反）。
 *
 * 引擎当前（保守域口径）：`String(new Date(0))` 落**保守 string 域**
 * （formatShape = "string"，litValue 不 ok）——值域是 string（原生同域），
 * 但不是具体日期串（精度债，非错值）。本文件按「**不抛** + 值域是 string」
 * 钉；**不得**断言精确日期串（会假红），也**不得**断言记 may-throw
 * （那是修前的假红）。
 *
 * 取证（原生 oracle）：
 * node -e 'console.log(String(new Date(0)), String(new Map()), String({}),
 * `${new Date(0)}` === String(new Date(0)))'
 */




const wrap = (body: string) => `export function f() { ${body} }`;


  it("String(new Date(0))：不抛 + 值域是 string（原生给日期串，不抛）；String(new Map())：不抛 + 值域是 string（原生 \"[object Map]\"，不抛）；String({})：不抛 + 值域是 string（原生 \"[object Object]\"，不抛）；模板串 `${new Date(0)}`：与 String() 同口径——不抛 + 值域是 string", () => {
  {
    const r = call(wrap(`return String(new Date(0));`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape___nudojs_core(r.result)).toBe("string");
  }
  {
    const r = call(wrap(`return String(new Map());`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape___nudojs_core(r.result)).toBe("string");
  }
  {
    const r = call(wrap(`return String({});`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    // BUG-142：闭普通对象无自有钩子 ⇒ 继承 Object.prototype.toString，
    // 原生 "[object Object]"；引擎现在按钩子结果折出精确字面量。
    expect(formatShape___nudojs_core(r.result)).toBe('"[object Object]"');
  }
  {
    const r = call(wrap("return `${new Date(0)}`;"), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape___nudojs_core(r.result)).toBe("string");
  }
});





describe("负控制（同一载荷内部不再自相矛盾 + 相邻面不回归）", () => {
  it("String(new Date(0)) 与模板串**同样不抛**（修前：String 记 may-throw、模板串判 OK）；String(123) → 精确 \"123\"（原始值路径的精确面不回归）；String(new Error(\"x\"))：不抛 + 值域是 string（Error 品牌同样不抛）；String(null) → 精确 \"null\"、String(undefined) → 精确 \"undefined\"（原始值面）", () => {
  {
    const viaString = call(wrap(`return String(new Date(0));`), "f");
    const viaTemplate = call(wrap("return `${new Date(0)}`;"), "f");
    expect(throwsError(viaString.throws, "TypeError")).toBe(false);
    expect(throwsError(viaTemplate.throws, "TypeError")).toBe(false);
    // 两侧的值域一致（都是 string 域）
    expect(formatShape___nudojs_core(viaString.result)).toBe(formatShape___nudojs_core(viaTemplate.result));
  }
  {
    const r = call(wrap(`return String(123);`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "123" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return String(new Error("x"));`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape___nudojs_core(r.result)).toBe("string");
  }
  {
    expect(litValue___nudojs_core(call(wrap(`return String(null);`), "f").result)).toEqual({
      ok: true,
      value: "null",
    });
    expect(litValue___nudojs_core(call(wrap(`return String(undefined);`), "f").result)).toEqual({
      ok: true,
      value: "undefined",
    });
  }
});



});
});

// ---------------------------------------------------------------------------
// Intl.Collator 的形状
// ---------------------------------------------------------------------------
describe("Intl.Collator 的形状", () => {
/**
 * 回归：`Intl.Collator` 的形状（构造器 fn 的 name 面 + 实例面）。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 * typeof new Intl.Collator() → "object"
 * new Intl.Collator().name → **undefined**（实例**没有** name 属性；
 * "Collator" 是**构造器函数**
 * `Intl.Collator.name`，不是实例的）
 * Intl.Collator.name → "Collator"（构造器函数的 name 属性）
 * Intl.NumberFormat.name → "NumberFormat"
 * Intl.DateTimeFormat.name → "DateTimeFormat"
 * Intl.Locale.name → "Locale"
 * typeof new Intl.Collator().compare → "function"（实例继承原型上的
 * brand check 访问器）
 *
 * 修前：Intl 子构造器的 fn **name** 面折**限定名**（"Intl.Collator"）——
 * 原生是**子构造器名**（"Collator"）⇒ 对 `Intl.Collator.name` 给出
 * **自信的错值**。修法（`builtins/error/intl.ts` 的 `makeIntlCtorAbs`）：
 * fn shape.name 是 $new 的**派发键**（不能改），改走**自有 name 槽**。
 *
 * 报告勘误（**勿照抄报告**）：原始报告把「原生 `Intl.Collator.name` 是
 * "Collator"」写成了 `new Intl.Collator().name`——**实例上根本没有 name
 * 属性**（原生是 undefined）。本文件按**原生**分别钉：实例 `.name` → undefined，
 * 构造器 `Intl.Collator.name` → "Collator"。
 *
 * 引擎当前：`makeIntlCtorAbs` 覆盖的 NumberFormat / DateTimeFormat 已按
 * 原生给 "NumberFormat" / "DateTimeFormat" ✅；**但**经「命名空间成员」
 * 通道投影的 Collator / Locale 等**未覆盖**（仍给限定名）。
 * 「命名空间成员」那条按「原生期望 + TODO(族05)」用 `it.fails` 钉住
 * （**旗标口径**：引擎修好后 `it.fails` 会翻红，提醒摘掉旗标并进主门禁
 * ——同 `check-recall-gold.test.ts` 的 it.fails 口径）。
 * 实例方法面那条（`typeof new Intl.Collator().compare` ⇒ "function"）已由
 * **族 65 · 第 4 条**收口（core 的 `BUILTIN_BRAND_METHODS` 补
 * "Intl.Collator"）⇒ 旗标已摘、断言转正。
 *
 * 取证（原生 oracle）：
 * node -e 'const c=new Intl.Collator();
 * console.log(typeof c, c.name, Intl.Collator.name, Intl.NumberFormat.name,
 * typeof c.compare)'
 */




const wrap = (body: string) => `export function f() { ${body} }`;


  it("typeof new Intl.Collator() → \"object\"（原生同款）；new Intl.Collator() 是 Intl.Collator 品牌实例（不是 undefined / 伪名）；new Intl.Collator().name → undefined（**实例**没有 name 属性——报告的 \"Collator\" 是勘误）；new Intl.Collator(\"en\").name → undefined（带 locale 参数同款）；typeo", () => {
  {
    const r = call(wrap(`return typeof new Intl.Collator();`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "object" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    const r = call(wrap(`return new Intl.Collator();`), "f");
    expect(formatShape___nudojs_core(r.result)).toBe("Intl.Collator");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
  {
    // node v26.10.0：new Intl.Collator().name === undefined
    // （"Collator" 是**构造器函数** Intl.Collator.name，见下一组断言）
    const r = call(wrap(`return new Intl.Collator().name;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: undefined });
  }
  {
    const r = call(wrap(`return new Intl.Collator("en").name;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: undefined });
  }
  {
    const r = call(wrap(`return typeof Intl.Collator;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "function" });
  }
});






describe("构造器 fn 的 name 面（原生是**子构造器名**，非限定名）", () => {
  it("Intl.NumberFormat.name → \"NumberFormat\"（已建模子构造器：原生同款）；Intl.DateTimeFormat.name → \"DateTimeFormat\"（已建模子构造器：原生同款）；Intl.Collator.name → \"Collator\"（原生同款：非限定名）；Intl.Locale.name → \"Locale\"（原生同款：非限定名）", () => {
  {
    const r = call(wrap(`return Intl.NumberFormat.name;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "NumberFormat" });
  }
  {
    const r = call(wrap(`return Intl.DateTimeFormat.name;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "DateTimeFormat" });
  }
  {
    // 收口：Intl 子构造器的**内部派发键**（"Intl.Collator"）只留在
    // shape.name（原型 brand 路由要它），读面剥掉 "Intl." 前缀 ⇒ 原生
    // `fn.name` 投影（非限定名）。
    const r = call(wrap(`return Intl.Collator.name;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "Collator" });
  }
  {
    const r = call(wrap(`return Intl.Locale.name;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "Locale" });
  }
});



});

describe("实例方法面（未建模子构造器）", () => {
  it("typeof new Intl.Collator().compare → \"function\"（族 65 第 4 条已建模）；new Intl.Collator().compare(\"a\", \"b\")：不抛（原生返回 -1 / 1，不抛）", () => {
  {
    // 原生：typeof new Intl.Collator().compare === "function"
    // （实例继承 Intl.Collator.prototype 上的方法）
    // 族 65 · 第 4 条：`BUILTIN_BRAND_METHODS` 补 "Intl.Collator"
    // （compare / resolvedOptions）⇒ 实例方法面折精确 "function"
    // （此前是 unknown 域——imprecise 但 sound）。
    const r = call(wrap(`return typeof new Intl.Collator().compare;`), "f");
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "function" });
  }
  {
    const r = call(wrap(`return new Intl.Collator().compare("a", "b");`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
});

});
});

// ---------------------------------------------------------------------------
// 族 57 · 第 1 条 · 派生类 brand 的集合 size（✅ 已是原生）
// ---------------------------------------------------------------------------
describe("派生类 brand 的集合 size（✅ 已是原生）", () => {
/**
 * 族 57 · W7 · core 容器 / Proxy / 符号键 —— 8 条精度债的回归钉。
 *
 * 本钉的断言口径：**对拍原生**（node v26.10.0 实测）。
 * - 标「✅ 已修」= 引擎与原生逐字一致；
 * - 标「⚠️ 已知偏差」= 引擎仍与原生有差（**修法落在别的分片的文件范围**，
 * 本钉钉住**当前**行为以免静默漂移；修法落地后本断言需由主 agent 追认
 * 更新——见文件末尾「已知偏差路由」）。
 *
 * 逐条对应（族 57 台账）：
 * 1. `s.size` 精确值（派生类 brand）——✅ 已是原生（闭合点：
 * exec/class/super.ts 的 $super「不重铸 Abs」——W9 并发落盘）
 * 2. 宿主函数面 / 命名空间面的 `constructor`——✅ 已修（本片）
 * 3. 包装 brand（Object(5) / Object(Symbol("x"))）的成员面——✅ 已是原生
 * 4. Proxy `has` / `set` 陷阱返回值 ToBoolean 归一——✅ 已是原生
 * 5. Proxy `ownKeys` 陷阱派发通道——✅ 已是原生
 * 6. 外-02 符号键槽寻址（普通对象面）——① 读写 ✅ 已修（本片）；② `in` /
 * `delete` ✅ 已修（exec/runtime/members.ts，W8 落盘）
 * 7. 残余：用户 iterable 同时带索引属性 ⇒ 迭代序优先——✅ 已是原生
 * 8. `mk().x += 2` 复合赋值到「调用结果成员」——✅ 已修（exec/transpile，W9 并发落盘）
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 结果是不是「非 exact 的抽象值」（已知偏差探针：引擎说「不知道」而非「说错」） */
function isInexact(src: string): boolean {
  const r = call(src, "f").result;
  return !litValue___nudojs_core(r).ok;
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

/** 用户 iterable（迭代序与索引序**故意不同**——用于钉「迭代序优先」） */
const USER_ITER = `[Symbol.iterator](){ let i=0; return { next(){ return i<2 ? {value:"I"+i++, done:false} : {value:undefined, done:true} } } }`;


  // 原生：class S extends Set {} ⇒ new S() 是 Set ⇒ s.add(1) 后 s.size === 1。
  // 引擎此前：派生类实例的 brand（"S"）**没有**集合内部表项——集合内部表按
  // **Abs 身份**驻留（collections.ts 的 WeakMap），而 super() 归位时**重铸**
  // 了 brand Abs ⇒ 表项失联 ⇒ size 折 number/path（引擎说「不知道」）。
  // 闭合点：exec/class/super.ts 的 $super 在「已是子类 brand 名」时**不重铸
  // Abs**（原生 super() 返回的就是同一个 this）⇒ 表项随 Abs 身份存活。
  it("派生类 Set：add 后 size 是精确值（原生 1）；派生类 Map：set 后 size 是精确值（原生 1）；派生类 Set：has 走条目表（原生 true）；负控：基础 Set / Map 的 size 仍是精确值（原生 2 / 1）", () => {
  {
    expect(v(wrap(`class S extends Set {}; const s = new S(); s.add(1); return s.size;`))).toEqual({
      ok: true,
      value: 1,
    });
  }
  {
    expect(v(wrap(`class M extends Map {}; const m = new M(); m.set("a", 1); return m.size;`))).toEqual({
      ok: true,
      value: 1,
    });
  }
  {
    expect(v(wrap(`class S extends Set {}; const s = new S(); s.add(1); return s.has(1);`))).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    expect(v(wrap(`const s = new Set([1, 2]); return s.size;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`const m = new Map([[1, 2]]); return m.size;`))).toEqual({ ok: true, value: 1 });
  }
});





describe("宿主函数面 / 命名空间面的 constructor（✅ 已修）", () => {
  it("函数声明的 constructor === Function（原生 true）；函数声明的 constructor.name === \"Function\"（原生 \"Function\"）；生成器声明的 constructor.name === \"GeneratorFunction\"（原生同款）；async 声明的 constructor.name === \"AsyncFunction\"（原生同款）；Number.constructor === Function（原生 true）", () => {
  {
    expect(v(wrap(`function f(){} return f.constructor === Function;`))).toEqual({ ok: true, value: true });
  }
  {
    expect(v(wrap(`function f(){} return f.constructor.name;`))).toEqual({ ok: true, value: "Function" });
  }
  {
    expect(v(wrap(`function* g(){} return g.constructor.name;`))).toEqual({ ok: true, value: "GeneratorFunction" });
  }
  {
    expect(v(wrap(`async function h(){} return h.constructor.name;`))).toEqual({ ok: true, value: "AsyncFunction" });
  }
  {
    expect(v(wrap(`return Number.constructor === Function;`))).toEqual({ ok: true, value: true });
  }
  {
    expect(v(wrap(`return Number.constructor.name;`))).toEqual({ ok: true, value: "Function" });
  }
  {
    expect(v(wrap(`return Math.constructor === Object;`))).toEqual({ ok: true, value: true });
  }
  {
    expect(v(wrap(`return Math.constructor.name;`))).toEqual({ ok: true, value: "Object" });
  }
  {
    expect(v(wrap(`function f(a, b){} return f.name;`))).toEqual({ ok: true, value: "f" });
    expect(v(wrap(`function f(a, b){} return f.length;`))).toEqual({ ok: true, value: 2 });
  }
  {
    expect(v(wrap(`class A {} return A.constructor === Function;`))).toEqual({ ok: true, value: true });
  }
});









});

describe("包装 brand 的成员面（✅ 已是原生）", () => {
  it("Object(Symbol('x')).toString() → \"Symbol(x)\"；Object(5).valueOf() → 5；Object(5).constructor === Number（原生 true）；包装 brand 的同名成员带 brand check：Object(Symbol('x')).toString.call(1) → TypeError；负控：Object.prototype.toString 的泛型面不受影响", () => {
  {
    expect(v(wrap(`return Object(Symbol("x")).toString();`))).toEqual({ ok: true, value: "Symbol(x)" });
  }
  {
    expect(v(wrap(`return Object(5).valueOf();`))).toEqual({ ok: true, value: 5 });
  }
  {
    expect(v(wrap(`return Object(5).constructor === Number;`))).toEqual({ ok: true, value: true });
  }
  {
    const src = wrap(
      `try { return Object(Symbol("x")).toString.call(1); } catch (e) { return "caught:" + e.constructor.name; }`,
    );
    expect(v(src)).toEqual({ ok: true, value: "caught:TypeError" });
  }
  {
    expect(v(wrap(`return Object.prototype.toString.call({});`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  }
});




});

describe("Proxy has / set 陷阱返回值 ToBoolean（✅ 已是原生）", () => {
  it("has 陷阱返回 0 → false（原生 false）；has 陷阱返回 \"\" → false（原生 false）；has 陷阱返回 [] → true（对象恒真，原生 true）；set 陷阱返回 falsy → strict TypeError（原生 strict 同款）；负控：无 has 陷阱 → 回退靶语义（原生 false）", () => {
  {
    expect(v(wrap(`const p = new Proxy({}, { has: () => 0 }); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    expect(v(wrap(`const p = new Proxy({}, { has: () => "" }); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    expect(v(wrap(`const p = new Proxy({}, { has: () => [] }); return ("a" in p);`))).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    for (const raw of ["0", '""', "null", "undefined", "false"]) {
      const r = call(wrap(`const p = new Proxy({}, { set: () => ${raw} }); p.x = 1; return "nothrow";`), "f");
      expect(r.result.shape.k).toBe("never");
    }
  }
  {
    expect(v(wrap(`const p = new Proxy({}, {}); return ("a" in p);`))).toEqual({ ok: true, value: false });
  }
});




});

describe("Proxy ownKeys 陷阱派发通道（✅ 已是原生）", () => {
  it("Object.keys 走 ownKeys 陷阱（原生 [\"a\",\"b\"]）；Reflect.ownKeys 走 ownKeys 陷阱（原生 [\"a\",\"b\"]）；ownKeys 返靶外键 → Object.keys 按可枚举性过滤（原生 []）；负控：无 ownKeys 陷阱 → Object.keys 走靶面（原生 [\"a\",\"b\"]）", () => {
  {
    const src = wrap(`const p = new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["a", "b"] }); return Object.keys(p);`);
    expect(tupleEls(call(src, "f").result)).toEqual(["a", "b"]);
  }
  {
    const src = wrap(`const p = new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["a", "b"] }); return Reflect.ownKeys(p);`);
    expect(tupleEls(call(src, "f").result)).toEqual(["a", "b"]);
  }
  {
    const src = wrap(`const p = new Proxy({ a: 1 }, { ownKeys: () => ["b", "c"] }); return Object.keys(p);`);
    expect(tupleEls(call(src, "f").result)).toEqual([]);
  }
  {
    const src = wrap(`return Object.keys({ a: 1, b: 2 });`);
    expect(tupleEls(call(src, "f").result)).toEqual(["a", "b"]);
  }
});



});

describe("外-02 · 符号键槽寻址（① 读写 ✅ 已修；② in/delete ✅ 已修，W8 落盘）", () => {
  it("用户符号键写后可回读（原生 1）；用户符号键写字符串值可回读（原生 \"v\"）；运行时 well-known 符号键写后可回读（原生 1）；两个不同用户符号互不串键（原生 \"b\"）；符号槽不落字符串枚举面（原生 [\"k\"]）；负控：字符串键读写逐字不变（原生 1）；负控：Proxy get 陷阱仍收到**真 symbol**（原生 \"symbol\"，不走槽寻址）；负控：Proxy get 陷阱收到 well-known 符号（原生 \"symbol\"）；负控：数组下标读写逐字不变", () => {
  {
    const src = wrap(`const s = Symbol("x"); const o = {}; o[s] = 1; return o[s];`);
    expect(v(src)).toEqual({ ok: true, value: 1 });
  }
  {
    const src = wrap(`const s = Symbol("x"); const o = {}; o[s] = "v"; return o[s];`);
    expect(v(src)).toEqual({ ok: true, value: "v" });
  }
  {
    const src = wrap(`const s = Symbol.iterator; const o = {}; o[s] = 1; return o[s];`);
    expect(v(src)).toEqual({ ok: true, value: 1 });
  }
  {
    const src = wrap(
      `const s1 = Symbol("x"); const s2 = Symbol("x"); const o = {}; o[s1] = "a"; o[s2] = "b"; return o[s2];`,
    );
    expect(v(src)).toEqual({ ok: true, value: "b" });
  }
  {
    const src = wrap(`const s = Symbol("x"); const o = { k: 1 }; o[s] = 2; return Object.keys(o);`);
    expect(tupleEls(call(src, "f").result)).toEqual(["k"]);
  }
  {
    expect(v(wrap(`const o = {}; o["k"] = 1; return o["k"];`))).toEqual({ ok: true, value: 1 });
  }
  {
    const src = wrap(
      `const s = Symbol("x"); const p = new Proxy({}, { get: (t, k) => typeof k }); return p[s];`,
    );
    expect(v(src)).toEqual({ ok: true, value: "symbol" });
  }
  {
    const src = wrap(
      `const p = new Proxy({}, { get: (t, k) => typeof k }); return p[Symbol.iterator];`,
    );
    expect(v(src)).toEqual({ ok: true, value: "symbol" });
  }
  {
    expect(v(wrap(`const a = []; a[0] = 1; return a[0];`))).toEqual({ ok: true, value: 1 });
  }
  {
    const src = wrap(`const s = Symbol("x"); const o = {}; o[s] = 1; return s in o;`);
    expect(v(src)).toEqual({ ok: true, value: true });
  }
  {
    const src = wrap(`const o = { [Symbol.iterator]: 1 }; delete o[Symbol.iterator]; return Symbol.iterator in o;`);
    expect(v(src)).toEqual({ ok: true, value: false });
  }
});










});

describe("残余 · 用户 iterable 同时带索引属性（✅ 已是原生）", () => {
  it("for-of 取迭代序而非索引序（原生 [\"I0\",\"I1\"]）；解构取迭代序而非索引序（原生 [\"I0\",\"I1\"]）；spread 取迭代序而非索引序（原生 [\"I0\",\"I1\"]）；负控：纯用户 iterable 逐字不变（原生 [\"I0\",\"I1\"]）；负控：Set 的 for-of 逐字不变（原生 [\"A\",\"B\"]）", () => {
  {
    const src = wrap(
      `const o = { 0: "A", 1: "B", ${USER_ITER} }; const out = []; for (const x of o) out.push(x); return out;`,
    );
    expect(tupleEls(call(src, "f").result)).toEqual(["I0", "I1"]);
  }
  {
    const src = wrap(`const o = { 0: "A", 1: "B", ${USER_ITER} }; const [a, b] = o; return [a, b];`);
    expect(tupleEls(call(src, "f").result)).toEqual(["I0", "I1"]);
  }
  {
    const src = wrap(`const o = { 0: "A", 1: "B", ${USER_ITER} }; return [...o];`);
    expect(tupleEls(call(src, "f").result)).toEqual(["I0", "I1"]);
  }
  {
    const src = wrap(`const o = { ${USER_ITER} }; const out = []; for (const x of o) out.push(x); return out;`);
    expect(tupleEls(call(src, "f").result)).toEqual(["I0", "I1"]);
  }
  {
    const src = wrap(`const s = new Set(["A", "B"]); const out = []; for (const x of s) out.push(x); return out;`);
    expect(tupleEls(call(src, "f").result)).toEqual(["A", "B"]);
  }
});




});

describe("mk().x += 2 复合赋值（✅ 已修）", () => {
  // 原生：mk().x += 2 ⇒ 读 1 → 写 3 ⇒ 表达式值 3。
  // 引擎：复合赋值到「调用结果成员」时 transpile 走「根不可重绑」分支
  // （exec/transpile/expr/assignment.ts）——该分支此前**丢 compoundFn** ⇒ 只发
  // 右值 ⇒ 表达式值 = 2（原生 3）。现已改为读-改-写（对象只求值一次、旧值读
  // → RHS → 写），表达式值 = 3（与原生逐字一致）。
  it("mk().x += 2 折 3（原生 3）——exec/transpile/expr/assignment.ts「根不可重绑」分支补回 compoundFn；计算键同款：mk()[k] += 2 折 3（原生 3）；负控：可重绑根的复合赋值逐字不变（原生 3）；负控：可重绑根的复合赋值读回（原生 3）", () => {
  {
    expect(v(wrap(`function mk(){ return { x: 1 }; } return mk().x += 2;`))).toEqual({ ok: true, value: 3 });
  }
  {
    expect(v(wrap(`function mk(){ return { x: 1 }; } const k = "x"; return mk()[k] += 2;`))).toEqual({ ok: true, value: 3 });
  }
  {
    expect(v(wrap(`const o = { x: 1 }; return o.x += 2;`))).toEqual({ ok: true, value: 3 });
  }
  {
    expect(v(wrap(`const o = { x: 1 }; o.x += 2; return o.x;`))).toEqual({ ok: true, value: 3 });
  }
});



});

/**
 * 已知偏差路由（修法落在**别的**分片的文件范围 ⇒ 本片只报告，不越界改）：
 * - 第 6 条 ②（`in` / `delete`）已由 **W8 落盘**（exec/runtime/members.ts：
 * `$in` 的 `symSlotKey` 改用 containers/symbol-slot.ts 的
 * `symbolSlotKeyOf`（认用户符号）；`$del` 的 `keyStr` 改为
 * `propertyKeyOf(key) ?? symbolSlotKeyOf(key)`）⇒ 本路由条目作废。
 */
describe("已知偏差的抛错面不回归", () => {
  it("Symbol 键的对象不会被误判成抛错面", () => {
    const src = wrap(`const s = Symbol("x"); const o = {}; o[s] = 1; return o[s];`);
    expect(throwName(src)).toBe("");
  });
});
});

// ---------------------------------------------------------------------------
// Math.min / Math.max 区间端点合并（合取位取更松的一侧）
// ---------------------------------------------------------------------------
describe("Math.min / Math.max 区间端点合并（合取位取更松的一侧）", () => {
/**
 * 回归：Math.min / Math.max 的**区间端点合并**按合取/析取分家。
 *
 * ES 语义（node 实测）：
 * - `Math.min(a,b) ≥ L ⟺ a ≥ L ∧ b ≥ L`（**合取**）⇒ 端点值相同时只能取
 * **更松**（非 strict）的一侧：`a > 0 ∧ b ≥ 0` 时 `min(a,b)` 可能恰为 0
 * （b = 0）⇒ 只能推出 `min(a,b) ≥ 0`。
 * - `Math.max(a,b) ≤ U ⟺ a ≤ U ∧ b ≤ U`（**合取**）⇒ 同款取更松的一侧。
 * - `Math.max(a,b) ≥ L ⟺ a ≥ L ∨ b ≥ L`（**析取**）与
 * `Math.min(a,b) ≤ U ⟺ a ≤ U ∨ b ≤ U`（**析取**）⇒ 取**更严**的一侧。
 *
 * 修复前：`loMin`（min 的 lo）与 `hiMax`（max 的 hi）照抄了析取位的条件
 * （`b.strict && !a.strict → b`）⇒ 取了**更严**的一侧 ⇒ 端点同值时产出
 * **不可满足**谓词（`min(x,0) > 0 ∧ min(x,0) ≤ 0`）⇒
 * ① 证明器 ex falso 放电 ⇒ L1 返回契约门禁**假绿**（恒为 0 的函数被判
 * 满足 `number().gt(0)`）；
 * ② 分支选择把不可满足谓词当恒真 ⇒ 走错臂且 `conf: exact`
 * （`Math.min(x,0) > 0 ? "pos" : "nonpos"` 折成 `"pos"`，原生恒
 * `"nonpos"`）。
 *
 * 修法（`builtins/math.ts`）：`loMin` / `hiMax` 的 tie-break 改成取**非
 * strict**（更松）的一侧；`loMax` / `hiMin`（析取位）保持取更严的一侧。
 *
 * 负控制钉住：常量取 1（区间自洽）、字面量折叠路径、round/abs 不走区间
 * 合并、max 的析取位（`Math.max(x,-1) > 0`）语义不变。
 */









/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 带数值界的实参（x > 0 / x < 0）——驱动 numericBounds 区间路径 */
function numArg(id: string, op: "gt" | "lt", n: number) {
  const t = termVar(id);
  const pred: Pred =
    op === "gt" ? { op: "gt", a: t, b: termLit(n) } : { op: "lt", a: t, b: termLit(n) };
  return abs({ k: "prim", type: "number" }, t, pred, "exact");
}

const sidecarOpts = (sidecar: string) => ({
  loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
  fromFile: "/t/math-bounds.js",
});

function checkOf(src: string, sidecar: string) {
  return checkSource_____index_ts("/t/math-bounds.js", src, pTrue, sidecarOpts(sidecar));
}


  it("Math.min(x,0) > 0：x>0 时原生恒 \"nonpos\"（改前折 \"pos\" 且 conf: exact）；Math.max(x,0) < 0：x<0 时原生恒 \"nonneg\"（改前折 \"neg\"）；Math.min(x,0) < 0：x>0 时原生恒 \"nonneg\"（区间下界不再是 > 0 的矛盾谓词）；Math.max(x,0) > 0：x<0 时原生恒 \"nonpos\"（区间上界不再是 < 0 的矛盾谓词）；L1 返回契约门禁：Math.min(x,0", () => {
  {
    const r = call(
      `export function f(x) { return Math.min(x, 0) > 0 ? "pos" : "nonpos"; }`,
      "f",
      [numArg("x", "gt", 0)],
    );
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "nonpos" });
  }
  {
    const r = call(
      `export function f(x) { return Math.max(x, 0) < 0 ? "neg" : "nonneg"; }`,
      "f",
      [numArg("x", "lt", 0)],
    );
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "nonneg" });
  }
  {
    const r = call(
      `export function f(x) { return Math.min(x, 0) < 0 ? "neg" : "nonneg"; }`,
      "f",
      [numArg("x", "gt", 0)],
    );
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "nonneg" });
  }
  {
    const r = call(
      `export function f(x) { return Math.max(x, 0) > 0 ? "pos" : "nonpos"; }`,
      "f",
      [numArg("x", "lt", 0)],
    );
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "nonpos" });
  }
  {
    const r = checkOf(
      `export function branch(x) { return Math.min(x, 0); }`,
      `import { fn, number } from "@nudojs/core";
export const branch = fn({ x: number().gt(0) }, number().gt(0));`,
    );
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  }
  {
    const r = checkOf(
      `export function branchMax(x) { return Math.max(x, 0); }`,
      `import { fn, number } from "@nudojs/core";
export const branchMax = fn({ x: number().lt(0) }, number().lt(0));`,
    );
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  }
  {
    const r = checkOf(
      `export function branchOne(x) { return Math.min(x, 1); }`,
      `import { fn, number } from "@nudojs/core";
export const branchOne = fn({ x: number().gt(0) }, number().gt(0));`,
    );
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(0);
  }
  {
    // 操作数自身区间不相容（x > 5 ∧ x < 3）⇒ Math.min(x,10) 的合并区间
    // [5,3) 为空 ⇒ 两条端点事实互斥 ⇒ 不得合成为不可满足 pred。
    const t = termVar("x");
    const bad = abs(
      { k: "prim", type: "number" },
      t,
      and(gt(t, termLit(5)), lt(t, termLit(3))),
      "exact",
    );
    const r = call(
      `export function f(x) { return Math.min(x, 10) > 100 ? "big" : "small"; }`,
      "f",
      [bad],
    );
    // ex falso 会把矛盾的 `> 5 ∧ < 3` 当恒真 ⇒ 折成 "big"（错的确定值）
    expect(litValue___nudojs_core(r.result)).not.toEqual({ ok: true, value: "big" });
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: false });
  }
});









describe("负控制（区间合并的邻近形态不回归）", () => {
  it("Math.min(x,1) > 0：x>0 时原生恒 \"pos\"；Math.max(x,-1) > 0：x>0 时原生恒 \"pos\"（max 的析取位语义不变）；Math.max(x,0) < 0：x<0 时原生恒 \"nonneg\"（与 min 臂对称）；字面量折叠路径不变：Math.min(3,5)=3 / Math.max(3,5)=5；round / abs 不走区间合并路径，结果不变", () => {
  {
    const r = call(
      `export function f(x) { return Math.min(x, 1) > 0 ? "pos" : "nonpos"; }`,
      "f",
      [numArg("x", "gt", 0)],
    );
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "pos" });
  }
  {
    const r = call(
      `export function f(x) { return Math.max(x, -1) > 0 ? "pos" : "nonpos"; }`,
      "f",
      [numArg("x", "gt", 0)],
    );
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "pos" });
  }
  {
    const r = call(
      `export function f(x) { return Math.max(x, 0) < 0 ? "neg" : "nonneg"; }`,
      "f",
      [numArg("x", "lt", 0)],
    );
    expect(litValue___nudojs_core(r.result)).toEqual({ ok: true, value: "nonneg" });
  }
  {
    expect(v(`export function f() { return Math.min(3, 5); }`)).toEqual({ ok: true, value: 3 });
    expect(v(`export function f() { return Math.max(3, 5); }`)).toEqual({ ok: true, value: 5 });
  }
  {
    expect(v(`export function f() { return Math.abs(-3); }`)).toEqual({ ok: true, value: 3 });
    expect(v(`export function f() { return Math.round(2.4); }`)).toEqual({ ok: true, value: 2 });
  }
});

// ---------------------------------------------------------------------------
// fix-16：BUG-289 Object.fromEntries 条目数组 / BUG-365 values·entries 值域
// ---------------------------------------------------------------------------
describe("Object.fromEntries 条目数组与键家族值域投影", () => {
  const SRC = `
export function feLit(): number { return Object.fromEntries([["a", 1]]).a ?? 0; }
export function fePairs(kv: [string, number][]): number { return Object.fromEntries(kv).a ?? 0; }
export function feRead(kv: [string, number][], k: string): number { return Object.fromEntries(kv)[k] ?? 0; }
export function roundTrip(o: { a: number }): number { return Object.fromEntries(Object.entries(o)).a ?? 0; }
export function paramVals(o: { a: number; b: string }) { return Object.values(o); }
export function paramEnt(o: { a: number; b: string }) { return Object.entries(o); }
export function localVals() { const local = { a: 1, b: "s" }; return Object.values(local); }
`;
  const check = () => checkSource("/t/fix16obj.js", SRC, pTrue, {});

  it("BUG-289：已定型条目数组不落 may-throw（fePairs / feRead / roundTrip 均 total）", () => {
    const r = check();
    for (const fn of ["fePairs", "feRead", "roundTrip"]) {
      expect(l2Count(r, fn), fn).toBe(0);
      expect(sigOf(r, fn), fn).toBe("number");
    }
    expect(sigOf(r, "feLit")).toBe("1");
  });

  it("BUG-289：抽象键条目在结果对象上留下索引值域（.a / [k] 读 number）", () => {
    const kvAbs = abs(
      { k: "arr", element: abs({ k: "tuple", elements: [abs({ k: "prim", type: "string" }, undefined, undefined, "path"), num()] }, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    const readA = call(`export function f(kv) { return Object.fromEntries(kv).a; }`, "f", [kvAbs]);
    expect(formatShape(readA.result as never)).toBe("number");
    const readK = call(`export function f(kv, k) { return Object.fromEntries(kv)[k]; }`, "f", [
      kvAbs,
      abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
    ]);
    expect(formatShape(readK.result as never)).toBe("number");
  });

  it("BUG-365：values / entries 投影已声明槽值域（不是 unknown）", () => {
    const r = check();
    expect(sigOf(r, "paramVals")).toBe("(number | string)[]");
    expect(sigOf(r, "paramEnt")).toBe("[string, number | string][]");
    // 本地字面量对照：仍是精确元组（键集封闭）
    expect(sigOf(r, "localVals")).toBe('[1, "s"]');
  });
});




});
});
