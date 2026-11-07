/**
 * A1 步骤 3（2026-11-07）：`$gen` 构造期只登记待跑体，首个消费点触发。
 *
 * 本文件用**真实 `$gen` / `$yield` 手工 body** 钉住机制本身（不经转译链）：
 * 构造期零体求值、体只跑一次、触发器幂等、副本别名广播、async 同编。
 * 端到端的 R3-b 值面验收见 `algebra/__tests__/eval-generator-cross-function-consume.test.ts`。
 */
import { describe, it, expect } from "vitest";
import { numLit, type Abs } from "../../abs.ts";
import { snapshotAbs } from "../../hof.ts";
import { formatAbs } from "../../format/format.ts";
import { $gen, $yield } from "../runtime/async.ts";
import { undef } from "../runtime/state.ts";
import { matchIterElements, fireGenTrigger } from "../match-iter.ts";

const shown = (xs: Abs[] | undefined): string[] =>
  (xs ?? []).map((a) => formatAbs(a));

function twoYields(onRun?: () => void): Abs {
  return $gen(() => {
    onRun?.();
    $yield(numLit(1), 0);
    $yield(numLit(2), 0);
    return undef();
  });
}

describe("A1 步骤 3 · 延迟体触发（构造期不跑体）", () => {
  it("构造期是空壳：体未执行、元素槽与 genElements 皆空", () => {
    let runs = 0;
    const g = twoYields(() => { runs++; });
    expect(runs).toBe(0);
    expect(formatAbs(g)).toBe("{  }  #path");
    expect(g.facets?.genElements).toHaveLength(0);
  });

  it("首个消费点触发：一次读出即得完整序列，且体只跑一次", () => {
    let runs = 0;
    const g = twoYields(() => { runs++; });
    expect(shown(matchIterElements(g))).toEqual(["1  #exact", "2  #exact"]);
    expect(runs).toBe(1);
    expect(formatAbs(g)).toContain('"0": 1');
    expect(g.facets?.genElements).toHaveLength(2);
  });

  it("触发器幂等：重复 fireGenTrigger 不重跑体（绕开实验 E 的重复副作用）", () => {
    let runs = 0;
    const g = twoYields(() => { runs++; });
    fireGenTrigger(g);
    fireGenTrigger(g);
    expect(shown(matchIterElements(g))).toEqual(["1  #exact", "2  #exact"]);
    expect(runs).toBe(1);
  });

  it("副本别名广播：副本先消费，原对象与副本的元素面/genElements 都完整", () => {
    let runs = 0;
    const g = twoYields(() => { runs++; });
    const copy = snapshotAbs(g);
    expect(shown(matchIterElements(copy))).toEqual(["1  #exact", "2  #exact"]);
    expect(formatAbs(g)).toContain('"0": 1');
    expect(formatAbs(copy)).toContain('"1": 2');
    expect(g.facets?.genElements).toHaveLength(2);
    expect(copy.facets?.genElements).toHaveLength(2);
    expect(runs).toBe(1);
  });

  it("async 生成器同编：@@asyncIterator 身份下延迟体仍可触发", () => {
    let runs = 0;
    const g = $gen(() => {
      runs++;
      $yield(numLit(7), 0);
      return undef();
    }, true);
    expect(g.facets?.brand).toBe("AsyncGenerator");
    expect(runs).toBe(0);
    // async generator 无 @@iterator 槽 ⇒ matchIterElements 不适用；
    // 直接 fire 等价于 @@asyncIterator 协议面首消费。
    fireGenTrigger(g);
    expect(shown(g.facets?.genElements)).toEqual(["7  #exact"]);
    expect(runs).toBe(1);
  });
});
