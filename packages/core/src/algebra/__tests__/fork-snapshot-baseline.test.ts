/**
 * 语句位 fork 快照基线回归（报告 Bug 135）。
 *
 * 语句级 `if` / `switch` 的 fork 快照（`__fk0_*` / `__sw0_*`）是**臂的
 * 基线**：臂入口 `n = $copy(__fk0_n)` 把绑定恢复到基线。基线必须取自
 * **测试 / 判别式求值之后**——此前快照行排在 `$fork(...)` 之前，而测试是
 * `$fork` 的第一实参（后求值），于是测试里的副作用（`f()` 计数 / getter /
 * 赋值 / 自增）在臂入口被整体回滚（原生保留）。
 *
 * 修法：测试 / 判别式先落临时量（`__fkT` / `__swD`），再取快照，
 * `$fork` / `$switch` 引用该临时量。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("语句位 fork 快照基线（测试 / 判别式先求值）", () => {
  it("if 的测试里调用函数的副作用不被回滚（修前折 0）", () => {
    const r = call(
      `export function f() { let n = 0; function g() { n++; return true; } if (g()) { n += 0; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("if 的测试里赋值不被回滚（修前折 0）", () => {
    const r = call(
      `export function f() { let n = 0; if ((n = 5) > 0) { n += 0; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("if 的测试里 getter 的副作用不被回滚（修前折 0）", () => {
    const r = call(
      `export function f() { let n = 0; const o = { get x() { n++; return 1; } }; if (o.x) { n += 0; } else { n += 0; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("无 fork 绑定的 if 不受影响：测试里的赋值保留", () => {
    const r = call(`export function f() { let n = 0; if ((n = 5) > 0) { } return n; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("switch 的判别式里赋值不被回滚（修前折 0）", () => {
    const r = call(
      `export function f() { let n = 0; switch ((n = 3, 1)) { case 1: break; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("switch 的判别式里调用函数的副作用不被回滚（修前折 0）", () => {
    const r = call(
      `export function f() { let n = 0; function g() { n++; return 1; } switch (g()) { case 1: n += 0; break; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("普通 switch 不受影响：case 体写回生效", () => {
    const r = call(`export function f() { let n = 0; switch (1) { case 1: n = 7; break; } return n; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 7 });
  });

  it("if 臂内写回：测试副作用 + 臂写同时保留", () => {
    const r = call(
      `export function f() { let n = 0; function g() { n++; return true; } if (g()) { n = 2; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("if / else 两臂都写：走真臂", () => {
    const r = call(
      `export function f() { let n = 0; function g() { n++; return true; } if (g()) { n = 1; } else { n = 2; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});
