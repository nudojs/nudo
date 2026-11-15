/**
 * Bug 180 回归（core 转译层）：**成员目标** `o.n++` 的写回必须发生在宿主
 * 表达式求值的**那一刻**（先读旧值参与比较，再写回）⇒ if 测试位 / switch
 * 判别位 / for·while 步进位都走对分支。
 *
 * 修复前（报告口径）：成员臂的 `UpdateExpression` **不自包含**——表达式位
 * 只发射纯读，写回被外包给语句级 rebind pass；而 rebind 的发射位置在
 * if/switch 里排在宿主表达式**之前**（⇒ 测试读到写回后的值 ⇒ 走错分支），
 * 在 for/while 步进闭包里干脆**不存在**（⇒ 计数器不前进 ⇒ 跑到迭代上限）。
 *
 * 现状：成员臂已随 Bug 155 的修法**自包含**（一次 Get + 一次 Put，写回
 * 下沉到表达式内）⇒ 四个位同时正确。本测试把这四个位**钉住**，防止回退。
 *
 * 负控制钉住：标识符目标（本就正确）、`+=` 复合赋值、语句位 `o.n++`。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

/** 调用结果的字面量值（val 返回 litValue 的 {ok,value} 包装） */
function valOf(src: string): unknown {
  const r = val(src);
  return r.ok ? r.value : "not-lit";
}

describe("Bug 180: 成员目标自增的写回时刻（测试位 / 判别位 / 步进位）", () => {
  it("if 测试位：比较用旧值，写回在求值点", () => {
    // 原生：[1]（o.n++ 读旧值 0 参与比较 → then；写回后 o.n = 1）
    expect(valOf(`export function f() {
  const o = { n: 0 };
  const r = [];
  if (o.n++ === 0) { r.push(o.n); } else { r.push(-1); }
  return r.join(",");
}`)).toBe("1");
  });

  it("if 测试位：前缀与字符串分支同样走对", () => {
    expect(valOf(`export function f() {
  const o = { n: 0 };
  const r = [];
  if (o.n++ === 0) { r.push("a"); } else { r.push("b"); }
  return r.join(",");
}`)).toBe("a");
    expect(valOf(`export function f() {
  const o = { n: 5 };
  const r = [];
  if (o.n-- === 5) { r.push(o.n); } else { r.push(-1); }
  return r.join(",");
}`)).toBe("4");
  });

  it("switch 判别位：判别式取旧值（匹配 case 0）", () => {
    expect(valOf(`export function f() {
  const o = { n: 0 };
  const r = [];
  switch (o.n++) { case 0: r.push("zero"); break; case 1: r.push("one"); break; default: r.push("other"); }
  return r.join(",");
}`)).toBe("zero");
  });

  it("for 步进位：计数器前进（不撞迭代上限）", () => {
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  for (o.n = 0; o.n < 3; o.n++) { c++; }
  return [o.n, c].join(",");
}`)).toBe("3,3");
  });

  it("while 测试位：写回在求值点（多一次自增）", () => {
    // 原生：[4,3]
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  while (o.n++ < 3) { c++; }
  return [o.n, c].join(",");
}`)).toBe("4,3");
  });

  it("负控制：标识符目标 / 复合赋值 / 语句位不受影响", () => {
    expect(valOf(`export function f() {
  let n = 0;
  const r = [];
  if (n++ === 0) { r.push(n); } else { r.push(-1); }
  return r.join(",");
}`)).toBe("1");
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  for (o.n = 0; o.n < 5; o.n += 1) { c++; }
  return [o.n, c].join(",");
}`)).toBe("5,5");
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  while (o.n < 3) { o.n++; c++; }
  return [o.n, c].join(",");
}`)).toBe("3,3");
  });
});
