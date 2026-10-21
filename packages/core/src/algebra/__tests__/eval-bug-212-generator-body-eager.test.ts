/**
 * Bug 212 回归钉（**未闭合**）：生成器体在**构造期**就跑完——外层绑定
 * 被提前改写。
 *
 * 原生：生成器函数被调用时**不执行体**——体只在首个 `next()` 时跑到
 * 第一个 `yield`。⇒ `const it = g();` 之后外层绑定仍是旧值；`it.next()`
 * 之后只跑到第一个 yield（第一个 yield 之后的写仍未发生）。引擎的
 * `$gen` 目前是**eager 收集**（构造期跑完整个体，收集 yield 序列）⇒
 * 外层绑定在构造期就被改写，且改成一个在任何原生观测点都不成立的值。
 *
 * ── 修法边界（本分片不可闭合）──────────────────────────────────────────
 * 要让「体内对外层绑定的写」不写穿到调用方，需要**转译侧**为生成器体
 * 发出「绑定 pack/unpack」（循环绑定包机制已有：transpile 侧按循环体
 * 里的绑定名发 `$pack`/`$unpack`）或把生成器体降成可挂起/续跑的段
 * （`yield` 降级为挂起点）。两者都在 `exec/transpile/` ——**不在本分片
 * 可改范围**（只允许改 `exec/runtime/async.ts` + `builtins/promise.ts`）。
 * 在 runtime 侧「截断生成器体」同样不可行：收集序列会被截断 ⇒ 元素
 * 域退 unknown（既有 R1b exact 元组面与元素域回归全灭），且首个
 * `next()` 之后的写仍会写穿。
 *
 * 附：eager 收集本身是族 01 结论（`exec-generator.test.ts` 头注：
 * 「yield 收集保持 eager（既有值域建模，注释口径不变）」）⇒ 本条按
 * 「不改族 01 已提交语义」约束以 todo 记缺口。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

describe("Bug 212：生成器体的构造期副作用（待转译侧绑定隔离 / 分段）", () => {
  it.todo("原生：const it = g() 之后外层绑定仍是旧值（n = 0）");
  it.todo("原生：const it = g() 之后 log 仍是空串");
  it.todo("原生：it.next() 之后只跑到第一个 yield（n = 1）");
  it.todo("原生：it.next() 之后 log = \"a\"（第一个 yield 之后的写未发生）");

  it("负控制：协议面与 yield 序列（族 01 eager 收集口径）不变", () => {
    expect(
      val(`export function f() {
        function* g() { yield 1; yield 2; }
        const gi = g();
        return gi.next().value + ":" + gi.next().value;
      }`),
    ).toEqual({ ok: true, value: "1:2" });
  });

  it("负控制：解构 lowering 取到元素（const [a] = g() → 1）", () => {
    expect(
      val(`export function f() {
        function* g() { yield 1; yield 2; }
        const gi = g();
        const [a] = gi;
        return a;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });
});
