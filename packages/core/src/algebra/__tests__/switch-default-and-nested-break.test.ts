/**
 * switch default 双发射（146）+ 臂内嵌套循环 break 被吞（173）回归。
 *
 * Bug 146：`case 1: default: body`——default 的 consequent 与前一个 case 臂
 * **共享同一份语句**（case 臂负责「命中 case 1 落入 default 体」，default 臂
 * 负责「全不命中也落入 default 体」）。合并阶段（fall-through 把后续臂体串
 * 进当前臂）又串了一份 ⇒ 体在同一条臂里执行两次（返回值 "dd"、副作用翻倍）。
 *
 * Bug 173：switch 臂的 `inSwitchArm` 标记**带进了嵌套循环**（循环体 opts
 * 从不清除）⇒ 循环内的无标签 break 被当成「臂结束」（`return;`）⇒ 循环跑到
 * 结束（迭代数错：`f() => 3`，原生 1）。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("switch default 共享主体只执行一次", () => {
  it("case 1: default: body → \"d\"（修前 \"dd\"）", () => {
    const r = call(
      `export function f() { let r = ""; switch (1) { case 1: default: r += "d"; } return r; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "d" });
  });

  it("case 1: case 2: default: body → \"d\"（修前 \"dd\"）", () => {
    const r = call(
      `export function f() { let r = ""; switch (1) { case 1: case 2: default: r += "d"; } return r; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "d" });
  });

  it("default 体的副作用只跑一次（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; function side(){ n++; } switch (1) { case 1: default: side(); } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("default 体的 getter 只读一次（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const o = { get v(){ n++; return 1; } }; switch (1) { case 1: default: n += o.v; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("全不命中时仍走 default 体 → \"d\"", () => {
    const r = call(`export function f() { let r = ""; switch (7) { case 1: default: r += "d"; } return r; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "d" });
  });

  it("default 体带 break → \"d\"", () => {
    const r = call(
      `export function f() { let r = ""; switch (1) { case 1: default: r += "d"; break; case 3: r += "3"; } return r; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "d" });
  });

  it("非空 case 后接 default → \"1d\"", () => {
    const r = call(
      `export function f() { let r = ""; switch (1) { case 1: r += "1"; default: r += "d"; break; } return r; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "1d" });
  });

  it("独立 default 臂不受影响 → \"d\"", () => {
    const r = call(
      `export function f() { let r = ""; switch (2) { case 1: r += "1"; break; default: r += "d"; break; } return r; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "d" });
  });
});

describe("switch 臂内嵌套循环的 break 属于循环", () => {
  it("臂内 for 的 break 退出循环（修前循环跑完 → 3，原生 1）", () => {
    const r = call(
      `export function f() { let n = 0; switch (0) { case 0: for (let i = 0; i < 3; i++) { if (i === 1) { break; } n = n + 1; } break; } return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("臂内 for 的日志止于 break（修前 \"0,1,2\"）", () => {
    const r = call(
      `export function f() { let log = []; switch (0) { case 0: for (let i = 0; i < 3; i++) { log.push(i); if (i === 1) { break; } } break; } return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "0,1" });
  });

  it("臂内 while 的 break 退出循环 → \"1,2\"", () => {
    const r = call(
      `export function f() { let log = []; let i = 0; switch (0) { case 0: while (i < 3) { i++; log.push(i); if (i === 2) { break; } } break; } return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "1,2" });
  });

  it("臂内 do-while 的 break 退出循环 → \"1,2\"", () => {
    const r = call(
      `export function f() { let log = []; let i = 0; switch (0) { case 0: do { i++; log.push(i); if (i === 2) { break; } } while (i < 3); break; } return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "1,2" });
  });

  it("臂内 for-of 的 break 退出循环 → \"1,2\"", () => {
    const r = call(
      `export function f() { let log = []; switch (0) { case 0: for (const v of [1,2,3]) { log.push(v); if (v === 2) { break; } } break; } return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "1,2" });
  });

  it("switch 臂外的循环不受影响 → \"0,1\"", () => {
    const r = call(
      `export function f() { let log = []; for (let i = 0; i < 3; i++) { log.push(i); if (i === 1) { break; } } return log.join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "0,1" });
  });
});
