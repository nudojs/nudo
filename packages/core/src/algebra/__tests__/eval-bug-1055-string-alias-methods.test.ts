/**
 * Bug 1055 回归钉：String.prototype 的 **ES2017 别名**（trimLeft / trimRight）
 * 方法值读通道（core `exec/member-diag.ts` 的 `STRING_METHODS` 白名单）。
 *
 * 病灶（修前，HEAD 4d1a249d）：
 * - `STRING_METHODS` 只列了 `trimStart` / `trimEnd`，漏列宿主**真实存在**的
 *   两个 ES2017 别名 `trimLeft` / `trimRight`（≡ trimStart / trimEnd，原生
 *   同一内置）⇒ 同一引擎两套字符串方法名集合自相矛盾：
 *   - 派发面（`algebra/methods.ts`）认识这两个别名 ⇒ `s.trimLeft()` 正常；
 *   - 读面（`STRING_METHODS`）不认识 ⇒ prim 接收者值读落 exact `undefined`
 *     （原生是 function）⇒ 原型对象面 `String.prototype.trimLeft` 同落
 *     `undefined` ⇒ `String.prototype.trimLeft.call(s)` ⇒「property 'call'
 *     on undefined」⇒ 硬 TypeError ⇒ **L2 门禁假红**（nudo:entry-may-throw）。
 *
 * 修法：`STRING_METHODS` 补 `"trimLeft"` / `"trimRight"`（只加表项，不动
 * 导出面）。
 *
 * 原生 ground truth：node v26.10.0 实测对照
 * （`Object.getOwnPropertyNames(String.prototype)` 自有方法 50 个 = 本表 50 个，
 * 无漏列 / 无多列）。
 */
import { describe, expect, it } from "vitest";
import { abs, litValue } from "../abs.ts";
import { STRING_METHODS } from "../exec/member-diag.ts";
import { call, effects, throwsError } from "./eval-helpers.ts";

/** 抽象 prim string 实参（等价于侧车把形参约束成 string()） */
const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");

describe("Bug 1055: String.prototype ES2017 别名（trimLeft / trimRight）方法值读", () => {
  it("prim 接收者：别名的方法值读是 function（原生同）", () => {
    expect(litValue(call(`export function f(){ return typeof " ab ".trimLeft; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f(){ return typeof " ab ".trimRight; }`).result))
      .toEqual({ ok: true, value: "function" });
    // 对照：早就在表内的 trimStart / trimEnd 同为 function（别修坏）
    expect(litValue(call(`export function f(){ return typeof " ab ".trimStart; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f(){ return typeof " ab ".trimEnd; }`).result))
      .toEqual({ ok: true, value: "function" });
  });

  it("原型对象面：String.prototype.<别名> 值读是 function（原生同）", () => {
    expect(litValue(call(`export function f(){ return typeof String.prototype.trimLeft; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f(){ return typeof String.prototype.trimRight; }`).result))
      .toEqual({ ok: true, value: "function" });
    // 对照
    expect(litValue(call(`export function f(){ return typeof String.prototype.trimStart; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f(){ return typeof String.prototype.trimEnd; }`).result))
      .toEqual({ ok: true, value: "function" });
  });

  it("调用面别修坏：别名 ≡ trimStart / trimEnd（原生同）", () => {
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
  });

  it("负控：表外名字仍折 exact undefined（没把整张表改成全放行）", () => {
    expect(litValue(call(`export function f(){ return typeof " ab ".notARealMethod; }`).result))
      .toEqual({ ok: true, value: "undefined" });
    expect(litValue(call(`export function f(){ return typeof String.prototype.notAReal; }`).result))
      .toEqual({ ok: true, value: "undefined" });
    // 本体是 exact undefined（不是 unknown——unknown 是「推断失败」，不是宿主真值）
    expect(litValue(call(`export function f(){ return " ab ".notARealMethod; }`).result))
      .toEqual({ ok: true, value: undefined });
    expect(litValue(call(`export function f(){ return String.prototype.notAReal; }`).result))
      .toEqual({ ok: true, value: undefined });
  });

  it("may-throw 通道：String.prototype.<别名>.call(s) 不再记 TypeError（L2 假红消失）", () => {
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
  });

  it("表与宿主同名集同源（node 实测对拍，防「派发面认识、读面不认识」再次分裂）", () => {
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
  });
});
