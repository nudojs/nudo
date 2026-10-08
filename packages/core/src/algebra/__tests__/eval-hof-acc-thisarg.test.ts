/**
 * 类 C 抽象求值回归（Bug 6 / 21）——数组 HOF 累加器 / thisArg 同族：
 * - Bug 6：无初值 reduce / reduceRight（抽象数组）累加器钉 unknown → 回调
 *   内 `unknown + number` 凭空多出 `+` 的字符串拼接臂（`number | string`）。
 *   原生语义：无初值首累加器 = 首元素，域 = 元素域（number）。
 * - Bug 21：map/filter/forEach/some/every/find/… 的第二实参 thisArg 被忽略
 *   → 回调宿主 this = undefined → `this.k` 假 may-throw（property on
 *   undefined）→ 回调路径折 bottom → 整体 `never`。原生 GetThisBinding：
 *   thisArg 即回调 this（字面量对象透传，恒 total）。
 * 修复：reduce 无初值 acc = 元素域（tuple 路径原生首/末在场元素不变）；
 * callFn 增可选 thisVal → applyCallbackAbs/$call/impl.apply 钩子注入宿主
 * this（回调体 $rawThis 原样接到，与 call/apply/bind 同通道）。
 * 原生 ground truth：node v26 实测（[1,2].map(function(){return this.k},{k:7})
 * → [7,7]；[1,2,3].reduce((a,b)=>a+b) → 5）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  formatAbs,
  abs,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";

const arrNum = abs(
  { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "path") },
  undefined,
  undefined,
  "partial",
);

function evalWithArgs(
  src: string,
  args: unknown[],
  fnName = "f",
): { value: string; throws: string; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

describe("Bug 6: 无初值 reduce / reduceRight 累加器域 = 元素域", () => {
  it("xs.reduce((a,b)=>a+b) → number（不再 number | string）", () => {
    const r = evalWithArgs(
      `export function f(xs) { return xs.reduce((a, b) => a + b); }`,
      [arrNum],
    );
    expect(r.value).toBe("number");
    // L2 面不变：无初值空数组原生 may TypeError（正确记账）
    expect(r.effects).toContain("TypeError");
  });

  it("xs.reduceRight((a,b)=>a+b) → number", () => {
    const r = evalWithArgs(
      `export function f(xs) { return xs.reduceRight((a, b) => a + b); }`,
      [arrNum],
    );
    expect(r.value).toBe("number");
    expect(r.effects).toContain("TypeError");
  });

  it("带初值 / 乘法 / tuple 无初值路径不回归", () => {
    expect(
      evalWithArgs(`export function f(xs) { return xs.reduce((a, b) => a + b, 0); }`, [arrNum]).value,
    ).toBe("number");
    expect(
      evalWithArgs(`export function f(xs) { return xs.reduce((a, b) => a * b); }`, [arrNum]).value,
    ).toBe("number");
    const lit = evalWithArgs(`export function f() { return [1, 2].reduce((a, b) => a + b); }`, []);
    expect(lit.value).toBe("3");
  });

  it("回调首参域 = 元素域（a * 2 可判）", () => {
    const r = evalWithArgs(
      `export function f(xs) { return xs.reduce((a, b) => a + b * 2); }`,
      [arrNum],
    );
    expect(r.value).toBe("number");
  });
});

describe("Bug 21: 数组 HOF thisArg 注入（GetThisBinding）", () => {
  it("map：字面量 thisArg 透传 → [7, 7]（node 实测）", () => {
    const r = evalWithArgs(
      `export function f() { const xs = [1, 2]; return xs.map(function () { return this.k; }, { k: 7 }); }`,
      [],
    );
    expect(r.value).toBe("[7, 7]");
    expect(r.effects).toEqual([]);
    expect(r.throws).toBe("never");
  });

  it("filter / some / find：thisArg 谓词（node 实测 [2,3] / true / 2）", () => {
    expect(
      evalWithArgs(
        `export function f() { const xs = [1, 2, 3]; return xs.filter(function (v) { return v > this.k; }, { k: 1 }); }`,
        [],
      ).value,
    ).toBe("[2, 3]");
    expect(
      evalWithArgs(
        `export function f() { const xs = [1, 2]; return xs.some(function (v) { return v === this.k; }, { k: 2 }); }`,
        [],
      ).value,
    ).toBe("true");
    expect(
      evalWithArgs(
        `export function f() { const xs = [1, 2]; return xs.find(function (v) { return v === this.k; }, { k: 2 }); }`,
        [],
      ).value,
    ).toBe("2");
  });

  it("forEach：thisArg 累加 → 23（node 实测）", () => {
    const r = evalWithArgs(
      `export function f() { const xs = [1, 2]; let s = 0; xs.forEach(function (v) { s += v + this.off; }, { off: 10 }); return s; }`,
      [],
    );
    expect(r.value).toBe("23");
    expect(r.effects).toEqual([]);
  });

  it("抽象接收者 + thisArg：xs.map(cb, {k:7}) → number[]（不再 never + 假 throw）", () => {
    const r = evalWithArgs(
      `export function f(xs) { return xs.map(function (v) { return v + this.k; }, { k: 7 }); }`,
      [arrNum],
    );
    expect(r.value).toBe("number[]");
    expect(r.effects).toEqual([]);
  });

  it("缺省 thisArg ≡ 现状：回调 this 仍是 undefined（假 may-throw 面保留）", () => {
    const r = evalWithArgs(
      `export function f() { const xs = [1, 2]; return xs.map(function () { return this.k; }); }`,
      [],
    );
    // 原生：strict 回调 this=undefined → this.k 抛 TypeError——引擎 L2 面
    // 继续如实记账（thisArg 缺省不注入）
    expect(r.effects).toContain("TypeError");
  });

  it("箭头回调忽略 thisArg（词法 this）", () => {
    const r = evalWithArgs(
      `export function f() { const xs = [1, 2]; const k = 9; return xs.map((v) => v + k, { k: 7 }); }`,
      [],
    );
    expect(r.value).toBe("[10, 11]");
    expect(r.effects).toEqual([]);
  });

  it("宿主函数回调（map(Number)）不受 thisVal 影响", () => {
    const r = evalWithArgs(`export function f() { return [1, 2].map(Number); }`, []);
    expect(r.value).toBe("[1, 2]");
  });
});
