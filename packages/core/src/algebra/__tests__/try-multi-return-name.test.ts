/**
 * try 区域重复 `return` 的临时量重名回归（报告 Bug 145）。
 *
 * try 内的 return 生成固定名临时量 `const __nudoRet = …`——同一词法块内
 * 出现两个 return 就是**重复 const 声明**：`new Function` 编译期
 * `SyntaxError: Identifier '__nudoRet' has already been declared` ⇒ **整模块
 * fail-closed**（文件里每个函数退化成 unknown / never；`nudo check` 对无关
 * 函数失去签名）。触发不需要执行到那段死代码——源码里存在即可。
 *
 * 修法：每个 return 的临时量收进**自己的块**（块作用域独立 → 不再同名
 * 冲突）；return 仍在块内——块不改变 return 的函数退出语义。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("try 区域重复 return 不再触发重复声明", () => {
  it("try 内两个 return：模块不 fail-closed，返回 1（修前整模块 never）", () => {
    const r = call(
      `export function f() { try { return 1; return 2; } catch (e) { return "c"; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("try 内嵌套块的两个 return：返回 1", () => {
    const r = call(
      `export function f() { try { { return 1; return 2; } } catch (e) { return "c"; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("嵌套 try 的两个 return：返回 1", () => {
    const r = call(
      `export function f() { try { try { return 1; return 2; } finally { } } catch (e) { return "c"; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("return 后仍有声明与第二个 return：返回 1", () => {
    const r = call(
      `export function f() { try { return 1; const q = 2; return q; } catch (e) { return "c"; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("单个 return 不受影响：返回 1", () => {
    const r = call(`export function f() { try { return 1; } catch (e) { return "c"; } }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("if 分支内的 return（自带块作用域）不受影响：返回 1", () => {
    const r = call(
      `export function f() { const x = true; try { if (x) return 1; return 2; } catch (e) { return "c"; } }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("同文件里的其他函数不受牵连（整模块 fail-closed 已消除）", () => {
    const r = call(
      `export function g() { return 42; }
       export function f() { try { return 1; return 2; } catch (e) { return "c"; } }`,
      "g",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });
  });
});
