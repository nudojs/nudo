/**
 * N1：executor fork 双臂 settle 的上游收集（resolve 臂 × reject 臂）。
 *
 * 原生 new Promise((res, rej) => { if (c) res(1); else rej(2); }) 产出
 * fulfilled 1 或 rejected 2 的双通道 promise——fork 臂是替代路径，各臂首个
 * settle 均活；同路径顺序双 settle 才是 first-wins no-op。此前引擎用全局
 * hasSettle 折叠跨臂 settle：reject 臂被静默丢弃 → promise<1> 假确定
 * fulfilled，下游 .catch 变死代码（wrong-definite）。
 *
 * - fork 双臂（res|rej / rej|res）/ switch 臂 / 嵌套 fork：两通道并存
 *   （inner ⊔ 各臂值 × rejected ⊔ 各臂 reason），eff(promise) resolve 的
 *   rejected/unsettled 通道并入 join 面
 * - 同路径顺序双 settle（含 fork join 之后的顺序 settle）：first-wins 原样
 * - 单 resolve / 只 reject / 同步抛 executor 控制组不变（同步抛 → 确定拒绝，
 *   Bug 310：原生 promise 以抛出值拒绝）
 */
import { describe, it, expect } from "vitest";
import { formatAbs, runTranspiled, callTranspiledExportFull } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function fmt(a: unknown): string {
  return formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
}

type EffShape = {
  shape?: { k?: string; eff?: string; inner?: unknown; rejected?: unknown; unsettled?: boolean };
};

function promiseShape(r: unknown): { inner: string; rejected: string; unsettled: boolean } {
  const a = r as EffShape;
  expect(a?.shape?.k, "expected eff shape").toBe("eff");
  expect(a?.shape?.eff, "expected promise eff").toBe("promise");
  return {
    inner: fmt(a!.shape!.inner),
    rejected: a!.shape!.rejected === undefined ? "<none>" : fmt(a!.shape!.rejected),
    unsettled: a!.shape!.unsettled === true,
  };
}

const anyArg = { shape: { k: "any" }, conf: "path" } as never;

function callAbstract(src: string, argCount = 1): { inner: string; rejected: string; unsettled: boolean } {
  const exports = runTranspiled(src, { mode: "analyze" });
  const r = callTranspiledExportFull(exports, "f", Array.from({ length: argCount }, () => anyArg));
  return promiseShape(r.result);
}

describe("N1: executor fork 双臂 settle 收集", () => {
  it("resolve 臂 × reject 臂 → 两通道并存（不得丢 reject 臂）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve, reject) => { if (c) { resolve(1); } else { reject(2); } }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.rejected).toBe("2");
    expect(sh.unsettled).toBe(false);
  });

  it("reject 臂在前 × resolve 臂在后 → 同款两通道", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve, reject) => { if (c) { reject(2); } else { resolve(1); } }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.rejected).toBe("2");
  });

  it("switch 抽象 disc 臂与 $fork 同构：双通道收集", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve, reject) => { switch (c) { case 1: resolve(1); break; default: reject(2); } }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.rejected).toBe("2");
  });

  it("嵌套 fork：内层双 resolve join × 外层 reject 臂", () => {
    const sh = callAbstract(
      `export function f(c, d) { return new Promise((resolve, reject) => { if (c) { if (d) { resolve(1); } else { resolve(3); } } else { reject(2); } }); }`,
      2,
    );
    expect(["1 | 3", "3 | 1", "number"]).toContain(sh.inner);
    expect(sh.rejected).toBe("2");
  });

  it("下游 .catch(e => e) 暴露 1|2（reject 臂不再死代码）", () => {
    const exports = runTranspiled(
      `export function f(c) { return new Promise((resolve, reject) => { if (c) { resolve(1); } else { reject(2); } }).catch((e) => e); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", [anyArg]);
    const inner = promiseShape(r.result).inner;
    expect(inner).toContain("1");
    expect(inner).toContain("2");
  });

  it("链式 .catch(e => e).then(v => v) 不折 pre-join 态（值域含 1|2）", () => {
    // catch 结果微任务 join 回收臂前，链式 then 不得同步映射 pre-join inner
    // （假确定 promise<1>）；FIFO 微任务序下 then 微任务读活通道
    const exports = runTranspiled(
      `export function f(c) { return new Promise((resolve, reject) => { if (c) { resolve(1); } else { reject(2); } }).catch((e) => e).then((v) => v); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", [anyArg]);
    const inner = promiseShape(r.result).inner;
    expect(inner).toContain("1");
    expect(inner).toContain("2");
  });

  it("两参 then(f, g) 双臂均活：f(1) ⊔ g(2)", () => {
    const exports = runTranspiled(
      `export function f(c) { return new Promise((resolve, reject) => { if (c) { resolve(1); } else { reject(2); } }).then((v) => v + 10, (e) => e * 100); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", [anyArg]);
    const inner = promiseShape(r.result).inner;
    expect(inner).toContain("11");
    expect(inner).toContain("200");
  });

  it("fork 臂 resolve(rejected promise) → 采纳通道并入拒绝面", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve, reject) => { if (c) { resolve(Promise.reject(9)); } else { reject(2); } }); }`,
    );
    // c 真：resolve(定拒 9 的 promise) 原生递归采纳 → 本 promise 拒 9；
    // c 假：拒 2 → rejected 9|2，fulfilled 臂不可能
    expect(sh.inner).toBe("never");
    expect(sh.rejected).toContain("9");
    expect(sh.rejected).toContain("2");
  });
});

describe("N1 控制组：first-wins / 单路径不回归", () => {
  it("同路径顺序 res(1); rej(2) → first-wins 保持 promise<1>", () => {
    const r = call(`export function f() { return new Promise((r, j) => { r(1); j(2); }); }`);
    const sh = promiseShape(r.result);
    expect(sh.inner).toBe("1");
    expect(sh.rejected).toBe("<none>");
  });

  it("同路径顺序 rej(1); res(2) → first-wins 保持确定拒绝", () => {
    const r = call(`export function f() { return new Promise((r, j) => { j(1); r(2); }); }`);
    expect(fmt(r.result)).toBe("promise<never>");
    const sh = promiseShape(r.result);
    expect(sh.rejected).toBe("1");
  });

  it("fork join 之后的顺序双 settle 仍同路径 first-wins", () => {
    // 无关 fork（x 绑定）不改变 settle 路径：res(1) 后 rej(2) 是 no-op
    const sh = callAbstract(
      `export function f(c) { let x = 0; return new Promise((r, j) => { if (c) { x = 1; } else { x = 2; } r(1); j(2); }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.rejected).toBe("<none>");
  });

  it("臂内 settle 后 join 外再 settle：跨路径双活", () => {
    // c 真 → fulfilled 1（臂内首 settle 胜）；c 假 → fulfilled 2 → 1|2
    const sh = callAbstract(
      `export function f(c) { return new Promise((r) => { if (c) { r(1); } r(2); }); }`,
    );
    expect(["1 | 2", "2 | 1", "number"]).toContain(sh.inner);
    expect(sh.rejected).toBe("<none>");
  });

  it("外层 settle 后臂内 settle：臂被外层覆盖 → no-op（不定 rejected）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((r, j) => { r(1); if (c) { j(2); } else { j(3); } }); }`,
    );
    // 原生：r(1) 在 fork 前已 settle → 两臂 j 均 no-op → 确定 fulfilled 1
    expect(sh.inner).toBe("1");
    expect(sh.rejected).toBe("<none>");
  });

  it("单 resolve executor 保持精确 promise<7>", () => {
    const r = call(`export function f() { return new Promise((r) => r(7)); }`);
    const sh = promiseShape(r.result);
    expect(sh.inner).toBe("7");
    expect(sh.rejected).toBe("<none>");
    expect(sh.unsettled).toBe(false);
  });

  it("只 reject executor 保持确定拒绝", () => {
    const r = call(`export function f() { return new Promise((r, j) => j(new Error("x"))); }`);
    expect(fmt(r.result)).toBe("promise<never>");
  });

  it("executor 同步抛 → 确定拒绝（Bug 310：原生 promise 以抛出值拒绝）", () => {
    const r = call(`export function f() { return new Promise(() => { throw new Error("boom"); }); }`);
    const sh = promiseShape(r.result);
    // 原生：executor 抛错 → promise 拒绝（fulfilled 臂不可能）→ inner never
    // + rejected = Error("boom")（await 抛 → catch 臂可达）
    expect(sh.inner).toBe("never");
    expect(sh.rejected).toBe("Error");
    expect(sh.unsettled).toBe(false);
  });

  it("顺序双 resolve 保持 first-wins", () => {
    const r = call(`export function f() { return new Promise((r) => { r("a"); r("b"); }); }`);
    expect(promiseShape(r.result).inner).toBe('"a"');
  });
});
