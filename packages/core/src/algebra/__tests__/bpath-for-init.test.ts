/**
 * B 路径 for 语句 init 形态：此前 transpile 只支持 `for (let i = …;…)` 单一
 * 声明 init——extractForInitName 对表达式/空 init 返回 null，整条循环被丢弃
 * （`// unsupported for-init`），循环体零次执行：
 *   - for(;;) 无限循环变空跑
 *   - for(;cond;) / for(;cond;step) 外部计数变量循环全废
 *   - for(i=0;…) 赋值表达式 init 全废（continue/break 同损）
 *   - for(i=0,j=N;…) 逗号序列 init 全废
 *   - 逗号在 test/update 部位同样触发丢弃
 * 修复：非声明 init 回退路径——init 就地求值（副作用写真实绑定），
 * 以合成计数器为 $for 状态线程，test/update/body 闭包读真实绑定。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("B-path for statement init forms", () => {
  it("for(;;) with break terminates", () => {
    const r = call(
      `export function f() { let i = 0; for (;;) { if (++i === 3) break; } return i; }`,
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("empty init with test/step counts outer variable", () => {
    const r = call(
      `export function f() { let i = 0, s = ""; for (; i < 3; i++) { s += i; } return s; }`,
    );
    expect(litValue(r.result)).toBe("012");
  });

  it("empty init and empty step loops via body mutation", () => {
    const r = call(
      `export function f() { let i = 0, s = ""; for (; i < 3; ) { s += i; i++; } return s; }`,
    );
    expect(litValue(r.result)).toBe("012");
  });

  it("assignment-expression init runs the loop", () => {
    const r = call(
      `export function f() { let i = 0, s = ""; for (i = 0; i < 3; i++) { s += i; } return s; }`,
    );
    expect(litValue(r.result)).toBe("012");
  });

  it("sequence init (comma) drives multiple variables", () => {
    const r = call(
      `export function f() { let i = 0, j = 3, s = ""; for (i = 0, j = 3; i < 2; i++, j--) { s += j; } return s; }`,
    );
    expect(litValue(r.result)).toBe("32");
  });

  it("comma in test and update works with expression init", () => {
    const r = call(
      `export function f() { let i = 0, j = 5, s = ""; for (i = 0; i < 2 && j > 3; i++, j--) { s += j; } return s; }`,
    );
    expect(litValue(r.result)).toBe("54");
  });

  it("side-effecting update expression runs", () => {
    const r = call(
      `export function f() { let i = 0, s = ""; for (i = 0; i < 2; i++, s += "x") {} return s; }`,
    );
    expect(litValue(r.result)).toBe("xx");
  });

  it("continue works with assignment-init loop", () => {
    const r = call(
      `export function f() { let i = 0, s = ""; for (i = 0; i < 3; i++) { if (i === 1) continue; s += i; } return s; }`,
    );
    expect(litValue(r.result)).toBe("02");
  });

  it("break works with sequence-init loop", () => {
    const r = call(
      `export function f() { let i = 0; for (i = 0, i = 0; i < 10; i++) { if (i === 2) break; } return i; }`,
    );
    expect(litValue(r.result)).toBe(2);
  });

  it("labeled break through expression-init loop", () => {
    const r = call(
      `export function f() { let i = 0; outer: for (i = 0; i < 10; i++) { for (let j = 0; j < 10; j++) { if (j === 2) break outer; } } return i; }`,
    );
    expect(litValue(r.result)).toBe(0);
  });

  it("expression-init loop still packs outer writes across abstract exit", () => {
    // 抽象条件下循环体的写必须在退出态可见（不因回退路径丢 pack/unpack）
    const r = call(
      `export function f(n) { let s = 0; for (n = 1; n > 0; n--) { s += n; } return s; }`,
    );
    expect(litValue(r.result)).toBe(1);
  });
});
