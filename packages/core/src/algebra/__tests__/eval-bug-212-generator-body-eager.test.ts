/**
 * Bug 212 回归钉（**步骤 1 已落地**：转译侧「自由写快照 + $join 折回」，
 * 见 docs/design/generator-laziness.md §5.1 / 架构债台账 A1）。
 *
 * 原生：生成器函数被调用时**不执行体**——体只在首个 `next()` 时跑到
 * 第一个 `yield`。⇒ `const it = g();` 之后外层绑定仍是旧值；`it.next()`
 * 之后只跑到第一个 yield（第一个 yield 之后的写仍未发生）。
 *
 * 引擎的 `$gen` 保持 **eager 收集**（构造期跑完整个体，收集 yield 序列
 * ——元素域 / conf 的承重结构，步骤 2+ 才动）；但体的**外层自由写**不再
 * 确定地写穿：`$gen` 体外套「快照（`$copy`）+ `finally` 里 `$join(事前,
 * 事后)` 折回」（`exec/transpile/emit.ts` 的 `genOuterFreeWriteNames` /
 * `genFreeWriteWrap`，四个 `$gen` 发射点：声明 / 函数表达式 / 对象方法 /
 * 类方法）。
 *
 * ⇒ 四行症状从「**确定的错值**」（在任何原生观测点都不成立）变成
 * 「**sound 的过近似**」（native 构造点值 ∈ join）：
 *
 * | body 观测 | native | 改前引擎 | 步骤 1 引擎 |
 * |---|---|---|---|
 * | 构造点 n | `0` | `1` ✗ wrong-exact | `0 \| 1` ✓ | `0` ✓ |
 * | 构造点 log | `""` | `"ab"` ✗ | `"" \| "ab"` ✓ | `""` ✓ |
 * | it.next() 后 n | `1` | `5` ✗ | `0 \| 5` ✓（残余：`1` 不在 join）| `1` ✓ |
 * | it.next() 后 log | `"a"` | `"ab"` ✗ | `"" \| "ab"` ✓（残余）| `"a"` ✓ |
 *
 * **步骤 4（2026-11-07，挂起点绑定回放）**：体仍一次跑完（步骤 3 不变量），
 * 但转译侧给 `$gen` 传入 `capture`/`restore` 钩子，core 在每个 `$yield`
 * 记下外层自由写绑定的 Abs 快照成时间轴；消费推进到第 k 个 yield 时把绑定
 * 回放到 `timeline[k-1]` ⇒ 首个 yield 挂起点的中间值（`1` / `"a"`）精确
 * 复现。sound 守卫：路径敏感 / 体内延迟异常 / `yield*` 委托整帧禁用，
 * 严格回退到步骤 1 的 join 过近似。
 *
 * 注意：这是**值面**挂起（外层绑定的时间轴），不是把体降成真 JS
 * generator——引擎的分支/循环臂是宿主箭头，真 `yield` 落进去是
 * SyntaxError，且抽象 fork 一次跑完双臂无法只停一臂（见
 * `generator-laziness.md` 步骤 4 记录）。非绑定类副作用（宿主调用、
 * may-throw 收集）的时序仍按首次消费点整体发生，属已知边界。
 *
 * 仓内可查证的回归钉（读者**不必出仓**即可复核本条口径）：
 * - 族 01 的 eager 收集口径（协议面 / yield 序列 / 元素域）：
 *   `packages/core/src/algebra/__tests__/exec-generator.test.ts`
 *   （及同目录 `exec-generator-protocol/-precision/-consumption.test.ts`）；
 * - 本文件的负控制用例（协议面与 yield 序列不变、解构 lowering 取到元素）。
 */
import {describe, it, expect} from "vitest";
import {formatAbs} from "@nudojs/core";
import {call, val} from "./eval-helpers.ts";

describe("Bug 212：生成器体构造期副作用——步骤 1 join 隔离（wrong-exact 消灭）", () => {
  it("c1 构造点：n = 0（步骤 3：体在消费点跑，构造点 native 0 精确）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n++; yield 1; }
      const it = g();
      return n;
    }`);
    expect(formatAbs(r.result)).toEqual('0  #exact');
  });

  it("c2 构造点：log = \"\" | \"ab\"（native \"\" ∈ join；改前 wrong-exact \"ab\"）", () => {
    const r = call(`export function f() {
      let log = "";
      function* g() { log += "a"; yield 1; log += "b"; yield 2; }
      const it = g();
      return log;
    }`);
    expect(formatAbs(r.result)).toEqual('""  #exact');
  });

  it("c3 it.next() 后：n = 1（步骤 4 挂起点回放；native 1，步骤 3 为 0 | 5）", () => {
    const r = call(`export function f() {
      function* g() { n = 1; yield 1; n = 5; yield 2; }
      let n = 0;
      const it = g();
      it.next();
      return n;
    }`);
    expect(formatAbs(r.result)).toEqual('1  #exact');
  });

  it("c4 it.next() 后：log = \"a\"（步骤 4 挂起点回放；native \"a\"，步骤 3 为 \"\" | \"ab\"）", () => {
    const r = call(`export function f() {
      let log = "";
      function* g() { log += "a"; yield 1; log += "b"; yield 2; }
      const it = g();
      it.next();
      return log;
    }`);
    expect(formatAbs(r.result)).toEqual('"a"  #exact');
  });

  it("步骤 4 · 连续两次 next() 单调推进到第二个挂起点（native 5 / \"ab\"）", () => {
    const n = call(`export function f() {
      let n = 0;
      function* g() { n = 1; yield 1; n = 5; yield 2; }
      const it = g();
      it.next(); it.next();
      return n;
    }`);
    expect(formatAbs(n.result)).toEqual('5  #exact');
    const log = call(`export function f() {
      let log = "";
      function* g() { log += "a"; yield 1; log += "b"; yield 2; }
      const it = g();
      it.next(); it.next();
      return log;
    }`);
    expect(formatAbs(log.result)).toEqual('"ab"  #exact');
  });

  it("步骤 4 · 分段读取：两个挂起点各自的绑定值分别精确（native 1:5）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n = 1; yield 1; n = 5; yield 2; }
      const it = g();
      const a = it.next().value;
      const x = n;
      const b = it.next().value;
      const y = n;
      return "" + a + ":" + x + ":" + b + ":" + y;
    }`);
    expect(formatAbs(r.result)).toEqual('"1:1:2:5"  #exact');
  });

  it("四种 $gen 发射点同编：函数表达式 / 对象方法 / 类方法 / async 生成器（各 n = 0）", () => {
    const expr = call(`export function f() {
      let n = 0;
      const g = function* () { n++; yield 1; };
      const it = g();
      return n;
    }`);
    expect(formatAbs(expr.result)).toEqual('0  #exact');

    const obj = call(`export function f() {
      let n = 0;
      const o = { *g() { n++; yield 1; } };
      const it = o.g();
      return n;
    }`);
    expect(formatAbs(obj.result)).toEqual('0  #exact');

    const cls = call(`export function f() {
      let n = 0;
      class C { *g() { n++; yield 1; } }
      const it = new C().g();
      return n;
    }`);
    expect(formatAbs(cls.result)).toEqual('0  #exact');

    const asyncGen = call(`export function f() {
      let n = 0;
      async function* g() { n++; yield 1; }
      const it = g();
      return n;
    }`);
    expect(formatAbs(asyncGen.result)).toEqual('0  #exact');
  });

  it("eager 值域承重不回归：体写外层绑定的生成器，元素面仍 exact（元素域来自 yield 收集，与外层 join 无关）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* gen(x) { n = x; yield 1; yield n; }
      return gen(5);
    }`);
    // 元素槽 = 构造期 yield 收集（1 与 5 均 #exact）；外层 n 的 join 折回
    // 发生在收集**之后**（finally）⇒ 不污染元素面。
    expect(formatAbs(r.result)).toEqual('{ "0": 1, "1": 5 }  #exact');
  });

  it("容器 mutator 接收者同样入快照集：arr.length 折成长度域（native 构造点 0 ∈ 域；改前 wrong-exact 1）", () => {
    const r = call(`export function f() {
      const arr = [];
      function* g() { arr.push(1); yield 1; }
      const it = g();
      return arr.length;
    }`);
    // R1-c 口径：容器是深拷贝快照 + join ⇒ 长度面从 exact 1 退成 sound 的
    // 步骤 3：构造期不跑体 ⇒ mutator 未落地 ⇒ 构造点 native 0 精确（不再是长度域过近似）。
    expect(formatAbs(r.result)).toBe("0  #exact");
  });

  it("const 别名组一起快照：const a = {...}; const b = a; 经 a 写后 b.v = 0（步骤 3 构造点精确）", () => {
    const r = call(`export function f() {
      const a = { v: 0 };
      const b = a;
      function* g() { a.v = 1; yield 1; }
      const it = g();
      return b.v;
    }`);
    expect(formatAbs(r.result)).toEqual("0  #exact");
  });

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

  it("负控制：不写外层绑定的生成器体产物逐字不变（值面 1:2 精确）", () => {
    expect(
      val(`export function f() {
        function* cnt(n) { while (n > 0) { yield n; n--; } }
        return [...cnt(3)].join(",");
      }`),
    ).toEqual({ ok: true, value: "3,2,1" });
  });

  it("负控制：体内 var / 形参写是生成器局部，不入快照集（值面不折 join）", () => {
    expect(
      val(`export function f() {
        function* g() { var acc = 0; acc += 5; yield acc; acc = 1; yield acc; }
        return [...g()].join(",");
      }`),
    ).toEqual({ ok: true, value: "5,1" });
  });
});
