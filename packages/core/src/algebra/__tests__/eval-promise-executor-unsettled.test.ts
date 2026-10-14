/**
 * N5：executor 替代路径的「走到末端而无 settle」面（unsettled 通道）。
 *
 * 原生 new Promise((resolve) => { if (c) resolve(1); }) 在 c 假时**永不
 * settle**（await 悬挂）。此前引擎只收集已发生的 settle → 折确定
 * promise<1>（wrong-definite 值域——下游 await 折 exact 1）。N5 把
 * fork/switch 隐式臂、抽象循环条件的体臂/出口臂、确定性死循环截断、
 * throw/return 退出臂都记入 executor 路径面：任一臂无 settle 覆盖 →
 * 结果带 unsettled（R3 通道：then/catch/await 拒绝面保持活）。
 *
 * 覆盖规则（保确定性的护栏）：
 * - trailing settle 覆盖全部臂：`if (c) resolve(1); resolve(2);` → 确定 1|2
 * - 两臂全 settle（resolve×reject / 嵌套）→ 精确两通道，无 unsettled
 * - 同路径顺序双 settle → first-wins 不变
 * - `while (c) { r(1); } r(2);` → 确定 1|2（体臂 settle + 出口臂被
 *   post-loop settle 覆盖——原生同款）；`while (true) { r(1); }` → 确定 1
 * - 退出臂（throw/return）延续被截断：join 后 settle 不在其路径 →
 *   `if (c) return; r(2);` 带 unsettled（原生 c 真时悬挂）
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

function callAbstract(
  src: string,
  argCount = 1,
): { inner: string; rejected: string; unsettled: boolean; full: string } {
  const exports = runTranspiled(src, { mode: "analyze" });
  const r = callTranspiledExportFull(exports, "f", Array.from({ length: argCount }, () => anyArg));
  return { ...promiseShape(r.result), full: fmt(r.result) };
}

describe("N5: 单臂 settle / 无 settle 路径 → unsettled 通道", () => {
  it("repro：if (c) resolve(1) 单臂 settle → promise<1> 带 unsettled（非确定）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve, reject) => { if (c) resolve(1); }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.rejected).toBe("<none>");
    expect(sh.unsettled).toBe(true);
  });

  it("空 then 臂（if (c) {} else resolve(1)）→ unsettled", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { if (c) {} else resolve(1); }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.unsettled).toBe(true);
  });

  it("嵌套单臂（if (c) { if (d) resolve(1); }）→ unsettled（c∧¬d 悬挂）", () => {
    const sh = callAbstract(
      `export function f(c, d) { return new Promise((resolve) => { if (c) { if (d) resolve(1); } }); }`,
      2,
    );
    expect(sh.inner).toBe("1");
    expect(sh.unsettled).toBe(true);
  });

  it("单臂 reject → 拒绝通道 + unsettled（拒绝也不确定）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((r, j) => { if (c) j(1); }); }`,
    );
    expect(sh.inner).toBe("never");
    expect(sh.rejected).toBe("1");
    expect(sh.unsettled).toBe(true);
  });

  it("switch 无 default（全 case 不命中路径）→ unsettled；带 default 双臂 settle → 确定", () => {
    const noDefault = callAbstract(
      `export function f(c) { return new Promise((resolve) => { switch (c) { case 1: resolve(1); break; } }); }`,
    );
    expect(noDefault.inner).toBe("1");
    expect(noDefault.unsettled).toBe(true);
    const withDefault = callAbstract(
      `export function f(c) { return new Promise((resolve, reject) => { switch (c) { case 1: resolve(1); break; default: reject(2); } }); }`,
    );
    expect(withDefault.inner).toBe("1");
    expect(withDefault.rejected).toBe("2");
    expect(withDefault.unsettled).toBe(false);
  });

  it("await 单臂 settle promise → 函数结果带 unsettled（不得折 exact 1）", () => {
    const sh = callAbstract(
      `export async function f(c) { const v = await new Promise((resolve) => { if (c) resolve(1); }); return v; }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.unsettled).toBe(true);
  });
});

describe("N5 护栏：确定 settle 语义不回归", () => {
  it("trailing settle 覆盖双臂：if (c) resolve(1); resolve(2) → 确定 1|2", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { if (c) resolve(1); resolve(2); }); }`,
    );
    expect(["1 | 2", "2 | 1"]).toContain(sh.inner);
    expect(sh.unsettled).toBe(false);
  });

  it("两臂全 settle → 精确两通道（N1 语义）无 unsettled", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve, reject) => { if (c) { resolve(1); } else { reject(2); } }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.rejected).toBe("2");
    expect(sh.unsettled).toBe(false);
  });

  it("嵌套两臂全 settle → 确定（子臂全覆盖 → 父臂覆盖）", () => {
    const sh = callAbstract(
      `export function f(c, d) { return new Promise((resolve, reject) => { if (c) { if (d) { resolve(1); } else { resolve(3); } } else { reject(2); } }); }`,
      2,
    );
    expect(["1 | 3", "3 | 1"]).toContain(sh.inner);
    expect(sh.rejected).toBe("2");
    expect(sh.unsettled).toBe(false);
  });

  it("同路径顺序双 settle 保持 first-wins（确定，无 unsettled）", () => {
    const r = call(`export function f() { return new Promise((r) => { r("a"); r("b"); }); }`);
    const sh = promiseShape(r.result);
    expect(sh.inner).toBe('"a"');
    expect(sh.unsettled).toBe(false);
  });

  it("单路径 settle 保持精确 promise<7>（无臂 → 无 unsettled）", () => {
    const r = call(`export function f() { return new Promise((r) => r(7)); }`);
    const sh = promiseShape(r.result);
    expect(sh.inner).toBe("7");
    expect(sh.rejected).toBe("<none>");
    expect(sh.unsettled).toBe(false);
  });

  it("settle 后 fork 内 settle：外层覆盖 → 臂 no-op，确定", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((r, j) => { r(1); if (c) { j(2); } else { j(3); } }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.rejected).toBe("<none>");
    expect(sh.unsettled).toBe(false);
  });
});

describe("N5: 循环路径面（while / do-while / for-of）", () => {
  it("while (c) { r(1); } 无 post-loop settle → unsettled（c 假首轮悬挂）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { while (c) { resolve(1); } }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.unsettled).toBe(true);
  });

  it("while (c) { r(1); } r(2) → 确定 1|2（出口臂被 post-loop settle 覆盖）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { while (c) { resolve(1); } resolve(2); }); }`,
    );
    expect(["1 | 2", "2 | 1"]).toContain(sh.inner);
    expect(sh.unsettled).toBe(false);
  });

  it("while (true) { r(1); } → 确定 1（具体条件迭代无臂）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { while (true) { resolve(1); } }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.unsettled).toBe(false);
  });

  it("确定性死循环 + post-loop settle：悬挂路径不可达 post-loop → unsettled", () => {
    // while (c) { c = true; }：c 真时恒真死循环（截断观测），c 假时直达 r(2)
    // —— r(2) 不在悬挂路径上 → 不得折确定 promise<2>
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { while (c) { c = true; } resolve(2); }); }`,
    );
    expect(sh.inner).toBe("2");
    expect(sh.unsettled).toBe(true);
  });

  it("do { r(1); } while (c) → 确定 1（体无条件执行一轮）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { do { resolve(1); } while (c); }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.unsettled).toBe(false);
  });

  it("for-of 抽象容器（可能空）：体内 settle 无 post-loop → unsettled", () => {
    const sh = callAbstract(
      `export function f(xs) { return new Promise((resolve) => { for (const x of xs) { resolve(x); } }); }`,
    );
    expect(sh.unsettled).toBe(true);
  });
});

describe("N5: 退出臂（throw / return）截断延续", () => {
  it("early return 臂：if (c) return; r(2) → unsettled（r(2) 不在 return 路径）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { if (c) return; resolve(2); }); }`,
    );
    expect(sh.inner).toBe("2");
    expect(sh.unsettled).toBe(true);
  });

  it("settle 后 return：if (c) { r(1); return; } r(2) → 确定 1|2", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { if (c) { resolve(1); return; } resolve(2); }); }`,
    );
    expect(["1 | 2", "2 | 1"]).toContain(sh.inner);
    expect(sh.unsettled).toBe(false);
  });

  it("try/catch 吞 throw（catch 无 settle）→ unsettled（throw 路径悬挂）", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { try { if (c) throw new Error("x"); resolve(1); } catch (e) {} }); }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.unsettled).toBe(true);
  });

  it("settle 后 throw：throw 在 settle 之后（原生 no-op）→ 确定", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { try { if (c) { resolve(1); throw new Error("y"); } resolve(2); } catch (e) {} }); }`,
    );
    expect(["1 | 2", "2 | 1"]).toContain(sh.inner);
    expect(sh.unsettled).toBe(false);
  });
});

describe("N5: 下游消费（then/catch/await 保持拒绝面活）", () => {
  it("then 映射单臂 settle → 结果值域含映射值且 unsettled", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve) => { if (c) resolve(1); }).then((v) => v + 10); }`,
    );
    expect(sh.inner).toBe("11");
    expect(sh.unsettled).toBe(true);
  });

  it("catch 拒绝臂保持活（单臂 resolve + catch）：两通道 + unsettled", () => {
    const sh = callAbstract(
      `export function f(c) { return new Promise((resolve, reject) => { if (c) resolve(1); }).catch((e) => "E"); }`,
    );
    expect(sh.inner).toContain("1");
    expect(sh.inner).toContain("E");
    expect(sh.unsettled).toBe(true);
  });

  it("确定 settle 的 await 保持 exact（无假 unsettled 泄漏）", () => {
    const sh = callAbstract(
      `export async function f(c) { const v = await new Promise((resolve) => { resolve(1); }); return v; }`,
    );
    expect(sh.inner).toBe("1");
    expect(sh.unsettled).toBe(false);
  });
});

describe("N5: 有意过近似（sound degradation，文档化）", () => {
  it("顺序独立 fork 全 settle 但首 fork 有隐式 else → unsettled（原生确定）", () => {
    // `if (c) r(1); if (d) r(3); else r(4);` 原生恒 settle（c 假路径进第二
    // fork 全臂 settle）；token 树不建模顺序延续（第二 fork 非首 fork 隐式
    // else 臂的子臂）→ 隐式 else 臂不可覆盖 → unsettled（过近似，sound）
    const sh = callAbstract(
      `export function f(c, d) { return new Promise((resolve) => { if (c) resolve(1); if (d) resolve(3); else resolve(4); }); }`,
      2,
    );
    expect(sh.inner).toContain("1");
    expect(sh.inner).toContain("3");
    expect(sh.inner).toContain("4");
    expect(sh.unsettled).toBe(true);
  });
});
