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
 * ── 修法边界（结论同前，且已定位到**唯一**可行落点）────────────────────
 * 要让「体内对外层绑定的写」不写穿到调用方，需要**转译侧**为生成器体
 * 发出「绑定 pack/unpack」（循环绑定包机制已有：transpile 侧按循环体
 * 里的绑定名发 `$pack`/`$unpack`）或把生成器体降成可挂起/续跑的段
 * （`yield` 降级为挂起点）。两者都在 `exec/transpile/` ——**不在本分片
 * 可改范围**（只允许改 `exec/runtime/async.ts` + `builtins/promise.ts`）。
 * 在 runtime 侧「截断生成器体」同样不可行：收集序列会被截断 ⇒ 元素
 * 域退 unknown（既有 R1b exact 元组面与元素域回归全灭），且首个
 * `next()` 之后的写仍会写穿。
 *
 * 附：eager 收集本身是族 01 结论（`exec/runtime/async.ts` 的 `$gen`
 * 头注：「yield 收集保持 eager（既有值域建模，注释口径不变）」）⇒ 本条按
 * 「不改族 01 已提交语义」约束以 todo 记缺口。
 *
 * ── 研究级复勘（族 44 · 出路 B · 精确登记）──────────────────────────
 * **为什么 runtime 侧无法修**（两条独立硬约束）：
 * (1) **写穿无句柄**：体内对外层绑定的写 = 对**闭包变量的裸 JS 赋值**
 *     （转译产物 `((__v) => { $assignRecord("n", n, __v, …); return n = __v; })(…)`，
 *     见 `exec/transpile/expr/assignment.ts` 的标识符赋值发射点，当前 :399）——
 *     `$assignRecord` 只观测、**其返回值被丢弃** ⇒ runtime 无法让它「不写」；
 *     `$gen` 也拿不到调用方的变量句柄（JS 闭包变量不可寻址）。
 * (2) **eager 收集是值域/签名面的承重结构**：生成器对象的元素面（数字下标
 *     槽）与 conf 在**构造期**烘进 Abs 的 shape
 *     （`exec/runtime/async.ts` 的 `$gen`（当前 :1087，构造期跑 `body()`）
 *     → `makeGenObject`（当前 :772，shape/conf 落点当前 :974））⇒ 改成惰性
 *     会把 dts 的 `Generator<any | number>` 退成 `Generator<unknown>`，并把
 *     conf 从 exact 降级（conf 参与 leqAbs ⇒ 影响 L1/L2 门禁精度）。
 *
 * **唯一可行落点（转译侧，纯转译侧、不动公开面）**：在 `$gen` 的体外套
 * 「自由写快照 + 折回」——复用仓里已有的 `collectFreeAssignedNames`
 * （`exec/transpile/helpers.ts`，当前 :1239）算出「该体写到的**外层**绑定」，
 * 发射 `const __g0_n = $copy(n); try { …体… } finally { n = $join(__g0_n, n); }`
 * （`$copy`/`$join` 均已是 `exec/index.ts` 的既有导出 ⇒ 不触公开面冻结）。
 * 该形态把「确定的错值」变成「sound 的过近似」（`0 | 1` 而非 `1`）；
 * 逐点精确（native `1` / `"a"`）需「真挂起」（生成器体降成真 JS generator），
 * 属引擎内核级改造，建议另立族。
 *
 * 仓内可查证的回归钉（读者**不必出仓**即可复核本条口径 —— 本头**不**引用
 * 任何未入库的中间产物）：
 * - 族 01 的 eager 收集口径（协议面 / yield 序列 / 元素域）：
 *   `packages/core/src/algebra/__tests__/exec-generator.test.ts`
 *   （及同目录 `exec-generator-protocol/-precision/-consumption.test.ts`）；
 * - 本条自身的负控制用例（见下方两条 `it`）：协议面与 yield 序列不变、
 *   解构 lowering 取到元素。
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
