/**
 * Bug 170 回归（core 转译层）：do-while 体的 `break` / `continue` **只作用于
 * 该循环**，不得逃出整个函数。
 *
 * 修复前：do-while 被降级成「先跑一份体，再跑 `$whileSeq(() => T, () => {体})`」
 * ——首份体在**任何循环运行时之外**执行 ⇒ 其 `break` / `continue` 发射的
 * `$loopBreak()` / `$loopContinue()` 无人吸收 ⇒ 信号冒泡出函数体 ⇒ 被记成
 * 「函数抛 NudoLoopSignal」（L2 门禁假红 + 签名退化成 unknown）。
 *
 * 修复后：体**恒在循环 thunk 内**执行（首轮用「首轮标记」把首份体移进
 * thunk）⇒ break 跳出循环、continue 转到条件求值，与原生一致。
 *
 * 负控制钉住：while / for 的 break（本就正确）、无 break/continue 的
 * do-while（轮数与返回值不变）、do-while 内的嵌套 do-while。
 */
import { describe, it, expect } from "vitest";
import { call, val } from "./eval-helpers.ts";
import { throwsError } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

/** 调用结果的字面量值（val 返回 litValue 的 {ok,value} 包装） */
function valOf(src: string): unknown {
  const r = val(src);
  return r.ok ? r.value : "not-lit";
}

describe("Bug 170: do-while 体的 break / continue 不逃出函数", () => {
  it("体里的 break 跳出循环（不是跳出函数）", () => {
    const rec = call(
      `export function f() {
  let c = 0;
  do { c = c + 1; break; } while (true);
  return c;
}`,
    );
    // 修复前：throws 面 = NudoLoopSignal，结果 unknown
    expect(throwsError(rec.throws, "NudoLoopSignal")).toBe(false);
    expect(valOf(`export function f() {
  let c = 0;
  do { c = c + 1; break; } while (true);
  return c;
}`)).toBe(1);
  });

  it("体里的 continue 转到条件求值（首轮后不再执行体）", () => {
    const rec = call(
      `export function f() {
  let c = 0;
  do { c = c + 1; continue; } while (false);
  return c;
}`,
    );
    expect(throwsError(rec.throws, "NudoLoopSignal")).toBe(false);
    expect(valOf(`export function f() {
  let c = 0;
  do { c = c + 1; continue; } while (false);
  return c;
}`)).toBe(1);
  });

  it("条件里的 break（事实臂）同样只跳出循环", () => {
    const rec = call(
      `export function f() {
  let c = 0;
  do { if (c === 0) { c = c + 1; break; } c = c + 1; } while (true);
  return c;
}`,
    );
    expect(throwsError(rec.throws, "NudoLoopSignal")).toBe(false);
    expect(valOf(`export function f() {
  let c = 0;
  do { if (c === 0) { c = c + 1; break; } c = c + 1; } while (true);
  return c;
}`)).toBe(1);
  });

  it("负控制：无 break/continue 的 do-while 轮数与返回值不变", () => {
    expect(valOf(`export function f() {
  let c = 0;
  do { c = c + 1; } while (c < 3);
  return c;
}`)).toBe(3);
    // 成员写 + 计数：原生 "3,3"
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  do { o.n++; c++; } while (o.n < 3);
  return [o.n, c].join(",");
}`)).toBe("3,3");
  });

  it("负控制：嵌套 do-while 的 break 只跳出内层循环", () => {
    expect(valOf(`export function f() {
  let c = 0;
  do { let d = 0; do { d = d + 1; break; } while (true); c = c + d; break; } while (true);
  return c;
}`)).toBe(1);
  });

  it("负控制：while / for 的 break 语义不受影响", () => {
    expect(valOf(`export function f() {
  let c = 0;
  while (true) { c = c + 1; break; }
  return c;
}`)).toBe(1);
    expect(valOf(`export function f() {
  let c = 0;
  for (let i = 0; i < 3; i++) { c = c + 1; break; }
  return c;
}`)).toBe(1);
  });
});
