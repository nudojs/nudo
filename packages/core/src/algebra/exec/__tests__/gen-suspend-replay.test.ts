/**
 * A1 步骤 4（2026-11-07）：**挂起点绑定回放**的机制回归钉。
 *
 * 本文件用「手工 `$gen` body + 显式 capture/restore 钩子」直接钉住 core 侧
 * 时间轴机制本身（不经转译链）：构造期零捕获、首个 `next()` 回放到第 1 个
 * 挂起点、后续 `next()` / 迭代 drain 单调推进、别名共享、async 同编、无钩子
 * 时零开销。端到端的 native 值面验收见
 * `algebra/__tests__/eval-bug-212-generator-body-eager.test.ts`。
 *
 * 纪律：体仍只跑一次、只捕获一次序列；回放**不重跑体**（实验 E 的重复
 * 副作用不得回归），且绝不回卷（`.return()` / 耗尽后的 `next()` 不倒退）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { numLit, type Abs } from "../../abs.ts";
import { formatAbs } from "../../format/format.ts";
import { $copy, $get } from "../runtime/containers.ts";
import { $gen, $yield, type GenSuspendHooks } from "../runtime/async.ts";
import { undef } from "../runtime/state.ts";
import { $call } from "../call.ts";
import { drainPendingGens, drainGenElements } from "../match-iter.ts";
import { snapshotAbs } from "../../hof.ts";

/** 求值收口清掉本例登记的待跑壳，避免跨用例串台。 */
afterEach(() => drainPendingGens());

/** 两个挂起点：`n = 1 → yield 1 → n = 5 → yield 2`。 */
function twoSuspensions(withHooks = true, asyncMode = false) {
  let n: Abs = numLit(0);
  let captures = 0;
  let runs = 0;
  const hooks: GenSuspendHooks = {
    capture: () => {
      captures += 1;
      // 与转译侧同口径：容器/别名快照用 $copy（本例是字面量，仍走同路径）
      return [$copy(n)];
    },
    restore: (v) => {
      n = v[0]!;
    },
  };
  const g = $gen(() => {
    runs += 1;
    n = numLit(1);
    $yield(numLit(1), 0);
    n = numLit(5);
    $yield(numLit(2), 0);
    return undef();
  }, asyncMode, withHooks ? hooks : undefined);
  return {
    g,
    read: (): string => formatAbs(n),
    captures: (): number => captures,
    runs: (): number => runs,
  };
}

/** 经 internal 槽取协议方法并真实派发（与 gen-trigger-protocol-faces 同口径）。 */
function nextOf(g: Abs): void {
  const fn = $get(g, "next", { silent: true });
  expect(fn, "next 槽应可读").toBeDefined();
  $call(fn!, []);
}

describe("A1 步骤 4 · 挂起点绑定回放（core 机制）", () => {
  it("构造期零捕获：体未跑、时间轴为空、元素面为空", () => {
    const s = twoSuspensions();
    expect(s.runs()).toBe(0);
    expect(s.captures()).toBe(0);
    expect(s.read()).toBe("0  #exact");
    // 不读任何消费面（读出即触发）：空壳的形状/genElements 都是空的
    expect(formatAbs(s.g)).toBe("{  }  #path");
    expect(s.g.facets?.genElements).toHaveLength(0);
  });

  it("首个 next() 回放到第 1 个挂起点：n = 1（体只跑一次）", () => {
    const s = twoSuspensions();
    nextOf(s.g);
    expect(s.read()).toBe("1  #exact");
    expect(s.runs()).toBe(1);
    // 2 个挂起点 + 1 格终态（体跑完）＝ 3 次捕获，仍是一体一次求值
    expect(s.captures()).toBe(3);
    expect(s.g.facets?.genElements).toHaveLength(2);
  });

  it("连续 next() 单调推进到第 2 个挂起点；耗尽后不回卷", () => {
    const s = twoSuspensions();
    nextOf(s.g);
    expect(s.read()).toBe("1  #exact");
    nextOf(s.g);
    expect(s.read()).toBe("5  #exact");
    nextOf(s.g); // done:true，不再推进、不回卷
    nextOf(s.g);
    expect(s.read()).toBe("5  #exact");
    expect(s.runs()).toBe(1);
  });

  it("迭代整体 drain 推进到时间轴末尾（与 native 体跑完一致）", () => {
    const s = twoSuspensions();
    const els = drainGenElements(s.g);
    expect(els).toHaveLength(2);
    expect(s.read()).toBe("5  #exact");
    expect(s.runs()).toBe(1);
  });

  it("副本别名广播：副本先消费，回放仍落到同一个外层绑定", () => {
    const s = twoSuspensions();
    const copy = snapshotAbs(s.g);
    nextOf(copy);
    expect(s.read()).toBe("1  #exact");
    nextOf(s.g);
    expect(s.read()).toBe("5  #exact");
    expect(s.runs()).toBe(1);
  });

  it("async generator 同编：@@asyncIterator 身份下回放仍生效", () => {
    const s = twoSuspensions(true, true);
    expect(s.g.facets?.brand).toBe("AsyncGenerator");
    nextOf(s.g);
    expect(s.read()).toBe("1  #exact");
    expect(s.g.facets?.genElements).toHaveLength(2);
  });

  it("嵌套生成器不污染外层时间轴；耗尽时推进到终态格（不丢最后一个 yield 之后的写）", () => {
    let n: Abs = numLit(0);
    let captures = 0;
    const hooks: GenSuspendHooks = {
      capture: () => {
        captures += 1;
        return [$copy(n)];
      },
      restore: (v) => {
        n = v[0]!;
      },
    };
    const outer = $gen(() => {
      n = numLit(1);
      $yield(numLit(1), 0);
      // 外层体**内部**创建并消费一个无钩子的内层生成器：它的 $yield
      // 不得写进外层帧（帧栈必须靠 undefined 哨兵隔离）。
      const inner = $gen(() => {
        $yield(numLit(10), 0);
        return undef();
      });
      const innerNext = $get(inner, "next", { silent: true });
      expect(innerNext).toBeDefined();
      $call(innerNext!, []);
      n = numLit(77); // 最后一个 yield 之后的写
      return undef();
    }, false, hooks);

    nextOf(outer); // 第 1 个 yield ⇒ n = 1
    expect(formatAbs(n)).toBe("1  #exact");
    nextOf(outer); // 耗尽 ⇒ 终态格 n = 77（而非停在 1 的 wrong-exact）
    expect(formatAbs(n)).toBe("77  #exact");
    // 外层只捕获 2 次（1 个挂起点 + 1 格终态）；内层 $yield 未混入
    expect(captures).toBe(2);
  });

  it("无钩子时零开销：步骤 3 延迟体与元素面逐字不变", () => {
    const s = twoSuspensions(false);
    expect(s.g.facets?.genElements).toHaveLength(0);
    nextOf(s.g);
    expect(s.g.facets?.genElements).toHaveLength(2);
    // 无 restore ⇒ 外层绑定保持体跑完后的 5（步骤 3 口径，无时间轴）
    expect(s.read()).toBe("5  #exact");
    expect(s.captures()).toBe(0);
    expect(s.runs()).toBe(1);
  });
});
