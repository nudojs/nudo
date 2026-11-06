/**
 * A1 · 步骤 2 旁路补齐：协议三方法 `next` / `return` / `throw` 的触发点。
 *
 * §5.2 原骨架只在 `match-iter.ts` 的 7 个**元素面读出函数**里挂
 * `fireGenTrigger`；但 `runtime/async.ts::makeGenObject` 的协议三方法读的是
 * 闭包 `full`，完全不经过那 7 个面 ⇒ 步骤 3 若把体延后，走
 * `it.next()` / `it.return()` / `it.throw()` 消费时体不会被触发。
 * 本轮补齐三条旁路（模块内导出 `fireGenTrigger`，**不进任何 barrel**）。
 *
 * 纪律：生产侧**不登记任何触发器** ⇒ 三条 `fireOnce()` 恒为 WeakMap miss，
 * 既有值面逐字不变。回归钉用「手工登记 + 真实协议调用」证明：
 * ① 三条旁路确实各能触发且幂等；② 与 7 个读出面共享同一触发器（先到先触发）；
 * ③ 未登记时协议面值面与 Bug 212 / 族 01 精确串一致。
 *
 * 本文件不改任何生产语义，只验证接线。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "../../abs.ts";
import { formatAbs } from "../../format/format.ts";
import { call, val } from "../../__tests__/eval-helpers.ts";
import {
  registerGenElements,
  registerGenTrigger,
  matchIterElements,
} from "../match-iter.ts";
import { $gen, $yield } from "../runtime/async.ts";
import { undef } from "../runtime/state.ts";
import { $call } from "../call.ts";
import { $get } from "../runtime/containers.ts";

/** 真实 `$gen` 产出的生成器对象（手工 body，yield 一个字面量）。 */
function realGen(): Abs {
  return $gen(() => {
    $yield(numLit(1), 0);
    return undef();
  });
}

/**
 * 调协议方法；`$get` 取 internal 槽的 fn Abs，再经 `$call` 派发。
 * `.throw()` 按原生语义同步抛 `NudoThrow`（Bug 34 延迟异常面）——本钉只
 * 关心「有没有触发」，故吞掉载荷；不吞会让调用本身中断，误判成接线失败。
 */
function invoke(g: Abs, name: "next" | "return" | "throw", args: Abs[] = []): void {
  const fn = $get(g, name, { silent: true });
  expect(fn, `协议方法 ${name} 应可读`).toBeDefined();
  try {
    $call(fn!, args);
  } catch {
    // .throw() 的 definite 载荷（原生同步抛）——触发点已在方法首行执行过。
  }
}

describe("A1 步骤 2 · 协议三方法触发点（生产不登记 ⇒ 零语义变化）", () => {
  for (const name of ["next", "return", "throw"] as const) {
    it(`${name}() 触发延迟体一次，重复调用不重复触发`, () => {
      const g = realGen();
      let fired = 0;
      registerGenTrigger(g, () => {
        fired += 1;
      });
      expect(fired).toBe(0);
      invoke(g, name);
      expect(fired, `${name} 首触`).toBe(1);
      invoke(g, name);
      invoke(g, name);
      expect(fired, `${name} 幂等`).toBe(1);
    });
  }

  it("协议面与 7 个读出面共享同一触发器（先到先触发）", () => {
    const g = realGen();
    let fired = 0;
    registerGenTrigger(g, () => {
      fired += 1;
      registerGenElements(g, [numLit(7)]);
    });
    invoke(g, "next");
    expect(fired).toBe(1);
    // 元素面读不再重复触发
    expect(matchIterElements(g)).toHaveLength(1);
    expect(fired).toBe(1);
  });

  it("未登记触发器时协议面零开销、值面逐字不变（族 01 精确串）", () => {
    expect(
      val(`export function f() {
        function* g() { yield 1; yield 2; }
        const gi = g();
        return gi.next().value + ":" + gi.next().value;
      }`),
    ).toEqual({ ok: true, value: "1:2" });
  });

  it("未登记触发器时步骤 1 join 折回不回归（Bug 212 c1 构造点）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n++; yield 1; }
      const it = g();
      return n;
    }`);
    expect(formatAbs(r.result)).toEqual("0 | 1  #exact");
  });

  it("未登记触发器时 eager 元素面承重不回归（族 01 / eval-bug-212）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* gen(x) { n = x; yield 1; yield n; }
      return gen(5);
    }`);
    expect(formatAbs(r.result)).toEqual('{ "0": 1, "1": 5 }  #exact');
  });
});
