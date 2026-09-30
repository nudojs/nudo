/**
 * 后缀 ++/-- 同表达式副作用顺序回归。
 *
 * 回归背景：标识符后缀 `x++` 此前只产出旧值（`return arg.name`），
 * 写回交给语句级 rebind pass——整条表达式求值完才自增。于是
 * 同一表达式里后续读到未自增的旧值：
 *   let x=5; return x++ + x;     // 原生 11，折 10
 *   let x=5; return x++ + ':' + x; // 原生 "5:6"，折 "5:5"
 *   let x=5; return x-- + x;     // 原生 9，折 10
 *   let x=5; return x++ + x++;   // 原生 11，折 10
 *
 * 前缀 `--x + x` 一直正确（`x = x-1` 自包含）。同类排查：
 * 语句级 `x++` / `return x++` / for 步进各自写回正确；缺口只在
 * 「后缀嵌在更大表达式里」。成员目标 `o.p++` 仍走语句级写回
 * （无匿名临时量），不在本类。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
} from "../index.ts";

function val(src: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return litValue(callTranspiledExportFull(exports, "f", []).result);
}

describe("postfix ++/-- side effects sequence within expressions", () => {
  it("x++ then read x in the same +", () => {
    expect(val(`export function f() { let x=5; return x++ + x; }`)).toEqual({ ok: true, value: 11 });
    expect(val(`export function f() { let x=5; return x++ + ':' + x; }`)).toEqual({ ok: true, value: "5:6", });
    expect(val(`export function f() { let x=5; return (x++) + x; }`)).toEqual({ ok: true, value: 11 });
  });

  it("x-- then read x in the same +", () => {
    expect(val(`export function f() { let x=5; return x-- + x; }`)).toEqual({ ok: true, value: 9 });
    expect(val(`export function f() { let x=5; return x-- + ':' + x; }`)).toEqual({ ok: true, value: "5:4", });
  });

  it("chained postfix uses successive values", () => {
    expect(val(`export function f() { let x=5; return x++ + x++; }`)).toEqual({ ok: true, value: 11 });
    expect(val(`export function f() { let x=5; return x-- + x--; }`)).toEqual({ ok: true, value: 9 });
  });

  it("postfix alone still yields the old value and mutates", () => {
    expect(val(`export function f() { let x=5; return x++; }`)).toEqual({ ok: true, value: 5 });
    expect(val(`export function f() { let x=5; x++; return x; }`)).toEqual({ ok: true, value: 6 });
    expect(val(`export function f() { let x=5; return x--; }`)).toEqual({ ok: true, value: 5 });
    expect(val(`export function f() { let x=5; x--; return x; }`)).toEqual({ ok: true, value: 4 });
  });

  it("prefix remains correct", () => {
    expect(val(`export function f() { let x=5; return --x + x; }`)).toEqual({ ok: true, value: 8 });
    expect(val(`export function f() { let x=5; return ++x + x; }`)).toEqual({ ok: true, value: 12 });
    expect(val(`export function f() { let x=5; return ++x; }`)).toEqual({ ok: true, value: 6 });
  });

  it("void postfix keeps sequencing", () => {
    expect(val(`export function f() { let x=5; return void x++ + ':' + x; }`)).toEqual({ ok: true, value: "undefined:6", });
  });
});
