/**
 * A1 步骤 3 的 **R3-b 验收钉**（`docs/design/generator-laziness.md` §5.3）。
 *
 * 2026-11-07 步骤 3 已落地：`$gen` 构造期只登记待跑体，首个消费点触发，
 * 求值收口（core `exec/run.ts::callTranspiledExportFull`）排空未触发的壳。
 * 于是 body thunk 捕获的**活绑定**在消费时刻求值 ⇒ 与原生一致：
 * `yield n` 读到的是 `n = 9` 之后的值，不再是构造期的 0。
 *
 * 本文件钉住：① 跨函数消费的精确值；② 副作用只跑一次（绕开实验 E
 * 「重跑重复副作用」）；③ 元素域随值搬运、dts 不退化；④ 步骤 4 后
 * 「消费期绑定 × 挂起点回放」两套机制叠加仍逐点精确。
 */
import { describe, it, expect } from "vitest";
import { formatAbs } from "@nudojs/core";
import { anyAbs } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("A1 步骤 3 · 生成器跨函数消费（R3-b 验收）", () => {
  it("消费期绑定可见：`yield n` 在首次 next() 读到 9（native 9）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { yield n; }
      const it = g();
      n = 9;
      return it.next().value;
    }`);
    expect(formatAbs(r.result)).toEqual("9  #exact");
  });

  it("生成器对象被 return 出外层函数后，元素面仍取消费期绑定（9）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { yield n; }
      const it = g();
      n = 9;
      return it;
    }`);
    expect(formatAbs(r.result)).toContain('"0": 9');
    // 求值收口排空后，随值搬运的完整 yield 序列仍在 facets 上（dts 同源）
    expect(r.result.facets?.genElements).toHaveLength(1);
  });

  it("副作用只跑一次：构造 + 多次消费不重复执行体（n 只加一次）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n++; yield n; }
      const it = g();
      const first = it.next().value;
      return first + ":" + n;
    }`);
    // native：首次 next() 跑体 ⇒ value = 1、n = 1；重复跑体会给 1:2
    expect(formatAbs(r.result)).toContain("1:1");
  });

  it("dts 元素面不退化：求值收口后形状数字槽与 genElements 同源非空", () => {
    const r = call(`export function f() {
      function* g() { yield 1; yield 2; }
      return g();
    }`);
    expect(formatAbs(r.result)).toContain('"0": 1');
    expect(r.result.facets?.genElements).toHaveLength(2);
  });

  it("步骤 4 · 首个 yield 之后的写不提前落地：native 1 / \"a\" 精确复现", () => {
    const n = call(`export function f() {
      function* g() { n = 1; yield 1; n = 5; yield 2; }
      let n = 0;
      const it = g();
      it.next();
      return n;
    }`);
    expect(formatAbs(n.result)).toEqual("1  #exact");
    const log = call(`export function f() {
      let log = "";
      function* g() { log += "a"; yield 1; log += "b"; yield 2; }
      const it = g();
      it.next();
      return log;
    }`);
    expect(formatAbs(log.result)).toEqual('"a"  #exact');
  });

  it("步骤 4 × 步骤 3 叠加：消费期绑定 9 与逐挂起点回放（native 9:9:5）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { yield n; n = 5; yield 2; }
      const it = g();
      n = 9;
      const v = it.next().value;
      const a = n;
      it.next();
      const b = n;
      return "" + v + ":" + a + ":" + b;
    }`);
    // 首个 yield 读到消费期 9，且此刻体只跑到该 yield ⇒ n 仍是 9；
    // 第二次 next() 之后挂起点后移 ⇒ n = 5。
    expect(formatAbs(r.result)).toEqual('"9:9:5"  #exact');
  });

  it("步骤 4 sound 守卫：抽象分叉体回退到 join 过近似，不产自信错值", () => {
    const r = call(
      `export function f(flag) {
        let n = 0;
        function* g() { n = 1; if (flag) { yield 1; } else { yield 2; } n = 5; yield 3; }
        const it = g();
        it.next();
        return n;
      }`,
      "f",
      [anyAbs],
    );
    // fork 臂序列是 join、不是线性时间轴 ⇒ 整帧禁用 ⇒ 保留步骤 1 的
    // join(事前, 事后)，native 的 1 在该域内（sound），不是单个错值。
    expect(formatAbs(r.result)).toEqual("0 | 5  #exact");
  });

  it("步骤 4：**线性对齐**的 yield* 委托保留时间轴（挂起点精确）", () => {
    // ABS-13：A1 守卫从「含委托整帧禁用」收窄为「逐元素同一 Abs、无区间
    // 重叠、下标在界内」——对齐委托的外层快照仍可信 ⇒ 首个委托 yield 处
    // 的 n 精确为 1（native），不再回退 join(0,5)。fork 合并致漂移仍禁用。
    const r = call(`export function f() {
      let n = 0;
      function* g() { n = 1; yield* [1, 2]; n = 5; }
      const it = g();
      it.next();
      return n;
    }`);
    expect(formatAbs(r.result)).toEqual("1  #exact");
  });

  it("步骤 4 · .return() 落在未启动生成器上不推进时间轴（保留 sound join）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n = 1; yield 1; n = 5; yield 2; }
      const it = g();
      it.return(9);
      return n;
    }`);
    // 原生体根本不跑（n = 0）；引擎已在首消费点跑完体 ⇒ 只能给
    // join(事前, 事后)。推进到时间轴末尾会产 wrong-exact 5，故不推进。
    expect(formatAbs(r.result)).toEqual("0 | 5  #exact");
  });
});
