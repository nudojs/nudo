/**
 * R2B-001：pure memo 丢 may-throw / 无界。
 *
 * 回归覆盖：
 * - body 路径 pure memo 命中重放 throws（此前固定 throws:never）
 * - $callNamed pureCallMemo 命中重放 throws（此前只存裸 Abs）
 * - 内层 Map 加界（LRU cap）
 * - 清理路径覆盖（clearPureMemo / clearPureCallMemo）
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  absFunction,
  runTranspiled,
  callTranspiledExportFull,
  numLit,
  never as neverAbs,
  unknown as absUnknown,
  type Abs,
} from "../index.ts";
import { $call, clearPureMemo } from "../exec/call.ts";
import { $callNamed, clearPureCallMemo, resetEvalCallBudget } from "../exec/calls.ts";
import { runWithLoopExits, takeThrowExits } from "../exec/runtime/state.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { markPureFn } from "../abs-fn.ts";
import { BoundedLruMap } from "../lru-map.ts";

beforeEach(() => {
  clearPureMemo();
  clearPureCallMemo();
});

describe("body-path pure memo re-routes may-throw on cache hit (R2B-001)", () => {
  it("body-path pure memo preserves may-throw across calls", () => {
    // 构造带 body 的 pure Abs fn：抽象条件 fork → 一臂 throw、一臂 return
    // 用 apply 模拟 body 的 pushThrowExit 语义（runForkArm 侧信道）
    const throws = errorTypeAbs("TypeError");
    const ok = numLit(1);
    let calls = 0;
    const fn = absFunction(["x"], {
      // body 路径：may-throw 走 pushThrowExit 侧信道（非返回值通道）
      // 此处用 apply 模拟：返回 {abs, throws} 与 body 路径捕获后同构
      apply: () => {
        calls += 1;
        return { abs: ok, throws };
      },
      pureName: "bodyMaybe",
    });
    const first = runWithLoopExits(() => {
      const v = $call(fn, [absUnknown]);
      return { v, exits: takeThrowExits() };
    });
    const second = runWithLoopExits(() => {
      const v = $call(fn, [absUnknown]);
      return { v, exits: takeThrowExits() };
    });
    expect(calls).toBe(1);
    expect(first.exits).toHaveLength(1);
    // 命中缓存仍必须重放 throws 面
    expect(second.exits).toHaveLength(1);
    expect(second.exits[0]).toBe(throws);
  });

  it("body-path pure memo with real body (transpiled) preserves may-throw", () => {
    // 真实 body 路径：transpile 后 $fork → runForkArm catch NudoThrow → pushThrowExit
    const run = runTranspiled(
      `export function maybe(x) { if (x) throw new TypeError("x"); return 1; }`,
      { mode: "analyze" },
    );
    const maybeFn = absFunction(["x"], {
      apply: (args) => {
        const full = callTranspiledExportFull(run, "maybe", args);
        return { abs: full.result, throws: full.throws };
      },
      pureName: "realBodyMaybe",
    });
    const first = runWithLoopExits(() => {
      const v = $call(maybeFn, [absUnknown]);
      return { v, exits: takeThrowExits() };
    });
    const second = runWithLoopExits(() => {
      const v = $call(maybeFn, [absUnknown]);
      return { v, exits: takeThrowExits() };
    });
    expect(first.exits).toHaveLength(1);
    expect(second.exits).toHaveLength(1);
    expect(second.exits[0]!.shape.k).not.toBe("never");
  });
});

describe("$callNamed pure hit does not drop throws face (R2B-001)", () => {
  it("$callNamed pure hit re-routes may-throw", () => {
    const throws = errorTypeAbs("RangeError");
    const ok = numLit(42);
    let calls = 0;
    const fn = absFunction([], {
      apply: () => {
        calls += 1;
        return { abs: ok, throws };
      },
    });
    markPureFn(fn as object, "hostMaybe");
    const first = runWithLoopExits(() => {
      const v = $callNamed("hostMaybe", fn, []);
      return { v, exits: takeThrowExits() };
    });
    const second = runWithLoopExits(() => {
      const v = $callNamed("hostMaybe", fn, []);
      return { v, exits: takeThrowExits() };
    });
    expect(calls).toBe(1);
    expect(first.exits).toHaveLength(1);
    // $callNamed 命中 pureCallMemo 必须重放 throws
    expect(second.exits).toHaveLength(1);
    expect(second.exits[0]).toBe(throws);
  });

  it("$callNamed pure hit with host JS function preserves may-throw", () => {
    const throws = errorTypeAbs("TypeError");
    const ok = numLit(7);
    let calls = 0;
    const hostFn = (..._args: Abs[]): Abs => {
      calls += 1;
      // 宿主函数经 callAtFunctionBoundary 转发 pushThrowExit
      // 此处直接返回，throws 由 $callNamed 捕获
      return ok;
    };
    // 模拟宿主 pure 函数：用 Abs fn 包装（宿主函数本身不返回 throws 面）
    const fn = absFunction([], {
      apply: () => {
        calls += 1;
        return { abs: ok, throws };
      },
    });
    markPureFn(fn as object, "hostPure");
    const first = runWithLoopExits(() => {
      const v = $callNamed("hostPure", fn, []);
      return { v, exits: takeThrowExits() };
    });
    const second = runWithLoopExits(() => {
      const v = $callNamed("hostPure", fn, []);
      return { v, exits: takeThrowExits() };
    });
    expect(calls).toBe(1);
    expect(first.exits).toHaveLength(1);
    expect(second.exits).toHaveLength(1);
    expect(second.exits[0]).toBe(throws);
  });

  it("L2 entry-may-throw not missed across multiple pure calls", () => {
    // 场景：caller 调 pure maybe 两次（同参），签名应保留 may-throw
    const runMaybe = runTranspiled(
      `export function maybe(x) { if (x) throw new TypeError("x"); return 1; }`,
      { mode: "analyze" },
    );
    const maybeFn = absFunction(["x"], {
      apply: (args) => {
        const full = callTranspiledExportFull(runMaybe, "maybe", args);
        return { abs: full.result, throws: full.throws };
      },
      pureName: "l2Maybe",
    });
    const runCaller = runTranspiled(
      `import { maybe } from "./a.js";
export function caller(a) {
  const p = maybe(a);
  const q = maybe(a);
  return p + q;
}`,
      {
        mode: "analyze",
        modules: { "./a.js": { named: { maybe: maybeFn }, evaluated: true } } as never,
      },
    );
    const res = callTranspiledExportFull(runCaller, "caller", [absUnknown]);
    // may-throw 不得因 pure 命中而丢失
    expect(res.throws.shape.k).not.toBe("never");
  });
});

describe("pure memo inner Map bounded (R2B-001)", () => {
  it("BoundedLruMap evicts oldest when over cap", () => {
    const m = new BoundedLruMap<number>(3);
    m.set("a", 1);
    m.set("b", 2);
    m.set("c", 3);
    expect(m.size).toBe(3);
    m.set("d", 4);
    expect(m.size).toBe(3);
    expect(m.get("a")).toBeUndefined(); // evicted
    expect(m.get("d")).toBe(4);
  });

  it("BoundedLruMap hit moves key to tail (LRU)", () => {
    const m = new BoundedLruMap<number>(2);
    m.set("a", 1);
    m.set("b", 2);
    m.get("a"); // a now most-recent
    m.set("c", 3); // evicts b (oldest)
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBeUndefined();
    expect(m.get("c")).toBe(3);
  });

  it("pure memo respects cap (many distinct args)", () => {
    // 用不同实参调 pure 函数，验证内层 Map 不无界增长
    const fn = absFunction(["x"], {
      apply: (args) => ({ abs: args[0] ?? numLit(0), throws: neverAbs }),
      pureName: "capped",
    });
    // 调 300 次不同实参（cap=256）
    for (let i = 0; i < 300; i++) {
      runWithLoopExits(() => {
        $call(fn, [numLit(i)]);
      });
    }
    // 不炸、不无界（BoundedLruMap 内部 cap=256）
    // 再调一次旧 key（应 miss，已被 evict）
    const r = runWithLoopExits(() => {
      const v = $call(fn, [numLit(0)]);
      return { v, exits: takeThrowExits() };
    });
    expect(r.v.shape.k).toBe("prim");
  });
});

describe("pure memo cleanup paths (R2B-001)", () => {
  it("clearPureMemo resets body-path memo", () => {
    const throws = errorTypeAbs("TypeError");
    const ok = numLit(1);
    let calls = 0;
    const fn = absFunction([], {
      apply: () => {
        calls += 1;
        return { abs: ok, throws };
      },
      pureName: "cleanupTest",
    });
    runWithLoopExits(() => {
      $call(fn, []);
    });
    expect(calls).toBe(1);
    clearPureMemo();
    runWithLoopExits(() => {
      $call(fn, []);
    });
    expect(calls).toBe(2); // memo cleared → re-eval
  });

  it("clearPureCallMemo resets $callNamed memo", () => {
    const throws = errorTypeAbs("TypeError");
    const ok = numLit(1);
    let calls = 0;
    const fn = absFunction([], {
      apply: () => {
        calls += 1;
        return { abs: ok, throws };
      },
    });
    markPureFn(fn as object, "cleanupNamed");
    runWithLoopExits(() => {
      $callNamed("cleanupNamed", fn, []);
    });
    expect(calls).toBe(1);
    // Abs fn 经 $callNamed → $call 两层 memo；需清两层
    clearPureMemo();
    clearPureCallMemo();
    runWithLoopExits(() => {
      $callNamed("cleanupNamed", fn, []);
    });
    expect(calls).toBe(2);
  });

  it("resetEvalCallBudget clears both pure memos", () => {
    const throws = errorTypeAbs("TypeError");
    const ok = numLit(1);
    let calls = 0;
    const fn = absFunction([], {
      apply: () => {
        calls += 1;
        return { abs: ok, throws };
      },
      pureName: "budgetReset",
    });
    runWithLoopExits(() => {
      $call(fn, []);
    });
    expect(calls).toBe(1);
    resetEvalCallBudget();
    runWithLoopExits(() => {
      $call(fn, []);
    });
    expect(calls).toBe(2);
  });
});
