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
 * | 构造点 n | `0` | `1` ✗ wrong-exact | `0 \| 1` ✓ |
 * | 构造点 log | `""` | `"ab"` ✗ | `"" \| "ab"` ✓ |
 * | it.next() 后 n | `1` | `5` ✗ | `0 \| 5` ✓（残余：`1` 不在 join）|
 * | it.next() 后 log | `"a"` | `"ab"` ✗ | `"" \| "ab"` ✓（残余：`"a"` 不在 join）|
 *
 * **残余**（步骤 4 真挂起才闭合）：join 覆盖「构造点（事前）」与「体跑完
 * （事后）」两个观测点；**首个 yield 挂起点**的中间值（native `1` /
 * `"a"`）不在 join 内——Abs 域没有时间轴（一个程序点一个 join 值，无
 * 「停在第 k 个 yield」这一维）。
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
  it("c1 构造点：n = 0 | 1（native 0 ∈ join；改前 wrong-exact 1）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n++; yield 1; }
      const it = g();
      return n;
    }`);
    expect(formatAbs(r.result)).toEqual('0 | 1  #exact');
  });

  it("c2 构造点：log = \"\" | \"ab\"（native \"\" ∈ join；改前 wrong-exact \"ab\"）", () => {
    const r = call(`export function f() {
      let log = "";
      function* g() { log += "a"; yield 1; log += "b"; yield 2; }
      const it = g();
      return log;
    }`);
    expect(formatAbs(r.result)).toEqual('"" | "ab"  #exact');
  });

  it("c3 it.next() 后：n = 0 | 5（改前 wrong-exact 5；残余：native 1 = 首个 yield 挂起点中间值，不在 join——需步骤 4 真挂起）", () => {
    const r = call(`export function f() {
      function* g() { n = 1; yield 1; n = 5; yield 2; }
      let n = 0;
      const it = g();
      it.next();
      return n;
    }`);
    expect(formatAbs(r.result)).toEqual('0 | 5  #exact');
  });

  it("c4 it.next() 后：log = \"\" | \"ab\"（改前 wrong-exact \"ab\"；残余：native \"a\" 同上）", () => {
    const r = call(`export function f() {
      let log = "";
      function* g() { log += "a"; yield 1; log += "b"; yield 2; }
      const it = g();
      it.next();
      return log;
    }`);
    expect(formatAbs(r.result)).toEqual('"" | "ab"  #exact');
  });

  it("四种 $gen 发射点同编：函数表达式 / 对象方法 / 类方法 / async 生成器（各 n = 0 | 1）", () => {
    const expr = call(`export function f() {
      let n = 0;
      const g = function* () { n++; yield 1; };
      const it = g();
      return n;
    }`);
    expect(formatAbs(expr.result)).toEqual('0 | 1  #exact');

    const obj = call(`export function f() {
      let n = 0;
      const o = { *g() { n++; yield 1; } };
      const it = o.g();
      return n;
    }`);
    expect(formatAbs(obj.result)).toEqual('0 | 1  #exact');

    const cls = call(`export function f() {
      let n = 0;
      class C { *g() { n++; yield 1; } }
      const it = new C().g();
      return n;
    }`);
    expect(formatAbs(cls.result)).toEqual('0 | 1  #exact');

    const asyncGen = call(`export function f() {
      let n = 0;
      async function* g() { n++; yield 1; }
      const it = g();
      return n;
    }`);
    expect(formatAbs(asyncGen.result)).toEqual('0 | 1  #exact');
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
    // 长度域（len#0 ≥ 0 覆盖构造点 0 与 drain 后 1）。
    expect(formatAbs(r.result)).toBe("number  = len#0  where len#0 ≥ 0  #path");
  });

  it("const 别名组一起快照：const a = {...}; const b = a; 经 a 写后 b.v = 0 | 1（改前 wrong-exact 1）", () => {
    const r = call(`export function f() {
      const a = { v: 0 };
      const b = a;
      function* g() { a.v = 1; yield 1; }
      const it = g();
      return b.v;
    }`);
    expect(formatAbs(r.result)).toEqual("0 | 1  #exact");
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
