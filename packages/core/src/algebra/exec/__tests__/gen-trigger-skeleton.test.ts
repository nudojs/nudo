/**
 * A1 步骤 2 骨架（`docs/design/generator-laziness.md` §5.2）：生成器
 * 「延迟体」触发点已收口到 `exec/match-iter.ts` 的 7 个读出函数。
 *
 * **本批次不改时序**：`$gen` 仍在构造期跑完体（eager 收集是元素域 /
 * `conf` 的承重结构），生产侧**不登记任何触发器** ⇒ 所有读出面的
 * `fireGenTrigger` 都是 WeakMap miss 即返回。下列钉证明两件事：
 * ① 触发器机制本身可用（触发 / 幂等 / 副本迁移）；
 * ② 构造期 eager 的既有值面逐字不变（复用 Bug 212 与族 01 的断言）。
 *
 * 步骤 3（首次消费点才跑）与步骤 4（真挂起）属内核改造，见同目录
 * `eval-generator-cross-function-consume.test.ts` 的前置钉与台账 A1 停点。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "../../abs.ts";
import { formatAbs } from "../../format/format.ts";
import { call } from "../../__tests__/eval-helpers.ts";
import {
  registerGenElements,
  registerGenDrain,
  registerGenDeferred,
  registerGenTrigger,
  copyMatchIterTables,
  drainGenElements,
  genDrainViewOf,
  peekGenElement,
  hasGenView,
  peekAllGenElements,
  replayGenDeferred,
  matchIterElements,
} from "../match-iter.ts";

function genLike(): Abs {
  return abs(
    { k: "obj", slots: { "@@iterator": { value: numLit(0) } } },
    undefined,
    undefined,
    "exact",
  );
}

describe("A1 步骤 2/3 · 延迟体触发点骨架（步骤 3 生产已接线）", () => {
  it("7 个读出面各触发一次，且按 Abs 身份幂等", () => {
    const faces: Array<[string, (a: Abs) => unknown]> = [
      ["drainGenElements", drainGenElements],
      ["genDrainViewOf", genDrainViewOf],
      ["peekGenElement", (a) => peekGenElement(a, 0)],
      ["hasGenView", hasGenView],
      ["peekAllGenElements", peekAllGenElements],
      ["replayGenDeferred", replayGenDeferred],
      ["matchIterElements", matchIterElements],
    ];
    for (const [name, read] of faces) {
      const a = genLike();
      let fired = 0;
      registerGenTrigger(a, () => {
        fired += 1;
      });
      read(a);
      expect(fired, name).toBe(1);
      read(a);
      read(a);
      expect(fired, `${name} 二次读不重复触发`).toBe(1);
    }
  });

  it("copyMatchIterTables 迁移待触发体，一次触发广播到全部别名", () => {
    const src = genLike();
    const dst = genLike();
    let fired = 0;
    registerGenTrigger(src, () => {
      fired += 1;
    });
    registerGenElements(src, [numLit(1), numLit(2)]);
    copyMatchIterTables(src, dst);

    expect(matchIterElements(dst)).toHaveLength(2);
    // 步骤 3：触发 dst 时广播到同族 src ⇒ 手工计数器收到 2 次调用。
    // 生产延迟体的 body 由 ensureFresh 缓存 ⇒ 体仍只跑一次。
    expect(fired).toBe(2);
    matchIterElements(dst);
    matchIterElements(src);
    expect(fired, "全部别名只触发一次，二次读幂等").toBe(2);
  });

  it("未登记触发器时读出面零开销、结果逐字不变", () => {
    const a = genLike();
    registerGenElements(a, [numLit(1), numLit(2)]);
    registerGenDrain(a, {
      drain: () => [numLit(3)],
      peek: () => numLit(3),
      peekAll: () => [numLit(3)],
      exact: true,
    });
    registerGenDeferred(a, { throw: undefined, soft: [] });

    expect(matchIterElements(a)).toHaveLength(2);
    expect(hasGenView(a)).toBe(true);
    expect(peekAllGenElements(a)).toHaveLength(1);
    expect(peekGenElement(a, 0)).toBeDefined();
    expect(drainGenElements(a)).toHaveLength(1);
    expect(genDrainViewOf(a)?.exact).toBe(true);
    expect(() => replayGenDeferred(a)).not.toThrow();
  });

  it("构造期 eager 元素面承重不回归（族 01 / eval-bug-212 精确串）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* gen(x) { n = x; yield 1; yield n; }
      return gen(5);
    }`);
    expect(formatAbs(r.result)).toEqual('{ "0": 1, "1": 5 }  #exact');
  });

  it("步骤 3 后构造点精确值（Bug 212 c1：native 0）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n++; yield 1; }
      const it = g();
      return n;
    }`);
    expect(formatAbs(r.result)).toEqual("0  #exact");
  });
});
