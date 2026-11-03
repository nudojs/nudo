/**
 * DX 改善：截断/宿主拦截诊断的 suggestion 带**具体修值/可粘贴骨架**。
 *
 * - `nudo:fork-truncated` → `package.json#nudo.analysis.maxForks=<N>`（N 从
 *   观测 fork 数推：max(20000, 观测×1.5 向上取整到千)；观测不可得回 20000）
 * - `nudo:host-effect-blocked` → 按 fetch/定时器/构造器分族的**单行**
 *   `@nudo:mock` 骨架。「粘贴可用」双向钉：无 mock 时报 issue + suggestion
 *   含骨架；骨架语义等价的 mock 注入后 issue 消失、签名恢复精确。
 *   （骨架的端到端粘贴验证——JSDoc 原样粘贴经 parser→service 全管线——
 *   见 docs/reference/diagnostics.md 的示例与 website mocking 文档。）
 * - `nudo:recursion-truncated` depth/calls 臂 → `@nudo:budget depth=128` /
 *   `calls=40000`（默认上限 ×2 起，或从观测值推）；cycle 臂维持「抬预算
 *   无效」的代码级建议不动。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkSource, pTrue, resetCheckSourceMemo, abs, absFunction, type Abs } from "@nudojs/core";
import {
  setEvalForkBudgetLimit,
  resetAbsCallBudget,
  MAX_EVAL_TOTAL_FORKS,
} from "@nudojs/core/internal";
import {
  hostEffectMockSkeleton,
  suggestedCallsCeiling,
  suggestedDepthCeiling,
  suggestedForkCeiling,
} from "../check-report.ts";

// —— 骨架语义等价的 Abs 构造（与 core-bug-274 的 mockFn 同族手法） ——

const num = (v: number) =>
  abs({ k: "prim", type: "number" }, { op: "lit", value: v }, pTrue, "exact");
const bool = (v: boolean) =>
  abs({ k: "prim", type: "boolean" }, { op: "lit", value: v }, pTrue, "exact");
const obj = (slots: Record<string, { value: Abs }>): Abs =>
  abs({ k: "obj", slots }, undefined, undefined, "exact");

/** `(url) => ({ ok: true, json: () => ({ id: 1 }) })` 骨架的等价 Abs */
function fetchMock(): Abs {
  return absFunction(["url"], {
    apply: () =>
      obj({
        ok: { value: bool(true) },
        json: { value: absFunction([], { apply: () => obj({ id: { value: num(1) } }) }) },
      }),
  });
}

/** `stub().returns(0)` 骨架的等价 Abs（定时器族） */
function timerMock(): Abs {
  return absFunction(["fn", "ms"], { apply: () => num(0) });
}

/** `stub().returns({ send: () => 1, close: () => 1 })` 骨架的等价 Abs（可构造） */
function wsMock(): Abs {
  return absFunction(
    ["url"],
    {
      apply: () =>
        obj({
          send: { value: absFunction([], { apply: () => num(1) }) },
          close: { value: absFunction([], { apply: () => num(1) }) },
        }),
    },
    { ctor: true },
  );
}

// —— 建议值/骨架单源 helper ——

describe("suggested{Fork,Depth,Calls}Ceiling：具体修值公式", () => {
  it("fork：max(20000, 观测×1.5 向上取整到千)；观测不可得回 20000", () => {
    expect(suggestedForkCeiling(0)).toBe(20_000);
    expect(suggestedForkCeiling(Number.NaN)).toBe(20_000);
    expect(suggestedForkCeiling(1)).toBe(20_000);
    expect(suggestedForkCeiling(14_000)).toBe(21_000);
    expect(suggestedForkCeiling(15_000)).toBe(23_000); // 22500 → 千位取整 23000
    expect(suggestedForkCeiling(30_000)).toBe(45_000);
  });

  it("depth：默认 64×2=128 起，观测×2 向上取整到 16", () => {
    expect(suggestedDepthCeiling(0)).toBe(128);
    expect(suggestedDepthCeiling(64)).toBe(128);
    expect(suggestedDepthCeiling(70)).toBe(144); // 140 → 16 位取整 144
    expect(suggestedDepthCeiling(100)).toBe(208); // 200 → 16 位取整 208
  });

  it("calls：默认 20000×2=40000 起，观测×2 向上取整到千", () => {
    expect(suggestedCallsCeiling(0)).toBe(40_000);
    expect(suggestedCallsCeiling(20_000)).toBe(40_000);
    expect(suggestedCallsCeiling(21_000)).toBe(42_000);
    expect(suggestedCallsCeiling(25_000)).toBe(50_000);
  });
});

describe("hostEffectMockSkeleton：分族骨架（单行纪律）", () => {
  it("fetch → 箭头 Response 形状", () => {
    expect(hostEffectMockSkeleton("fetch")).toBe(
      "@nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })",
    );
  });

  it("定时器/调度族 → stub().returns(0)", () => {
    for (const name of [
      "setTimeout",
      "setInterval",
      "setImmediate",
      "queueMicrotask",
      "requestAnimationFrame",
      "requestIdleCallback",
    ]) {
      expect(hostEffectMockSkeleton(name)).toBe(`@nudo:mock ${name} = stub().returns(0)`);
    }
  });

  it("构造器族 → stub().returns({ … })（new 只认 stub，箭头不可构造）", () => {
    expect(hostEffectMockSkeleton("WebSocket")).toBe(
      "@nudo:mock WebSocket = stub().returns({ send: () => 1, close: () => 1 })",
    );
    expect(hostEffectMockSkeleton("EventSource")).toBe(
      "@nudo:mock EventSource = stub().returns({ send: () => 1, close: () => 1 })",
    );
    expect(hostEffectMockSkeleton("XMLHttpRequest")).toBe(
      "@nudo:mock XMLHttpRequest = stub().returns({ open: () => 1, send: () => 1 })",
    );
  });

  it("全部骨架单行（@nudo:mock 载荷只读到行尾）且未知名回 undefined", () => {
    for (const name of [
      "fetch",
      "setTimeout",
      "setInterval",
      "setImmediate",
      "queueMicrotask",
      "requestAnimationFrame",
      "requestIdleCallback",
      "WebSocket",
      "EventSource",
      "XMLHttpRequest",
    ]) {
      const s = hostEffectMockSkeleton(name)!;
      expect(s.startsWith("@nudo:mock ")).toBe(true);
      expect(s.includes("\n")).toBe(false);
    }
    expect(hostEffectMockSkeleton("document")).toBeUndefined();
  });
});

// —— check 面：issue suggestion 带修值/骨架 ——

describe("nudo:fork-truncated suggestion 带具体修值", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetAbsCallBudget();
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
  });
  afterEach(() => {
    setEvalForkBudgetLimit(MAX_EVAL_TOTAL_FORKS);
    resetAbsCallBudget();
  });

  it("suggestion 含 maxForks=<N> 与 @nudo:budget forks=<N>；低观测 → 20000 兜底", () => {
    setEvalForkBudgetLimit(1);
    const src = `
export function branchy(n) {
  if (n > 0) { return n; }
  if (n < -1) { return -n; }
  return 0;
}
`;
    const r = checkSource("t-fork-hint.js", src, pTrue);
    const fork = r.issues.find((i) => i.code === "nudo:fork-truncated");
    expect(fork).toBeDefined();
    expect(fork!.severity).toBe("info");
    // 验收：suggestion 含 maxForks=\d+
    expect(fork!.suggestion).toMatch(/package\.json#nudo\.analysis\.maxForks=\d+/);
    expect(fork!.suggestion).toMatch(/@nudo:budget forks=\d+/);
    expect(fork!.suggestion).toMatch(/observed \d+ forks/);
    // 观测远低于 20000 ⇒ 默认推荐兜底（×1.5 仍被 max(20000, …) 抬到 20000）
    expect(fork!.suggestion).toContain("maxForks=20000");
  });
});

describe("nudo:host-effect-blocked suggestion 骨架（粘贴可用·双向）", () => {
  beforeEach(() => resetCheckSourceMemo());

  it("fetch：issue 含骨架；等价 mock 注入后 issue 消失、签名恢复形状", () => {
    const src = `export function loadUser(id) { return fetch("/api/users/" + id); }`;
    const off = checkSource("/t/net-off.js", src, pTrue);
    const issue = off.issues.find((i) => i.code === "nudo:host-effect-blocked");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("info");
    expect(issue!.fn).toBe("fetch");
    expect(issue!.suggestion).toContain("@nudo:mock");
    expect(issue!.suggestion).toContain(hostEffectMockSkeleton("fetch")!);
    expect(issue!.suggestion).toContain("pass the value in from a call site");

    // 方向 B：骨架语义等价的 mock 注入 → 诊断消失、结果精确
    const on = checkSource("/t/net-on.js", src, pTrue, {
      inject: { mocks: { fetch: fetchMock() } },
    });
    expect(on.issues.filter((i) => i.code === "nudo:host-effect-blocked")).toHaveLength(0);
    const sig = on.signatures.find((s) => s.name === "loadUser");
    expect(sig).toBeDefined();
    expect(sig!.display).toContain("ok: true");
  });

  it("setTimeout：issue 含定时器族骨架；等价 mock 注入后 issue 消失", () => {
    const src = `export function later(ms) { let t = 0; setTimeout(() => { t = 1; }, ms); return t; }`;
    const off = checkSource("/t/timer-off.js", src, pTrue);
    const issue = off.issues.find((i) => i.code === "nudo:host-effect-blocked");
    expect(issue).toBeDefined();
    expect(issue!.suggestion).toContain(hostEffectMockSkeleton("setTimeout")!);

    const on = checkSource("/t/timer-on.js", src, pTrue, {
      inject: { mocks: { setTimeout: timerMock() } },
    });
    expect(on.issues.filter((i) => i.code === "nudo:host-effect-blocked")).toHaveLength(0);
  });

  it("WebSocket：issue 含构造器族骨架（stub 形态，非箭头）；等价 mock 注入后 issue 消失", () => {
    const src = `export function watch(url) { const ws = new WebSocket(url); ws.send("hello"); return ws; }`;
    const off = checkSource("/t/ws-off.js", src, pTrue);
    const issue = off.issues.find((i) => i.code === "nudo:host-effect-blocked");
    expect(issue).toBeDefined();
    const skeleton = hostEffectMockSkeleton("WebSocket")!;
    expect(issue!.suggestion).toContain(skeleton);
    // 构造器族必须是 stub 形态（箭头 mock 不可 new）
    expect(skeleton).toContain("stub().returns(");

    const on = checkSource("/t/ws-on.js", src, pTrue, {
      inject: { mocks: { WebSocket: wsMock() } },
    });
    expect(on.issues.filter((i) => i.code === "nudo:host-effect-blocked")).toHaveLength(0);
  });
});

describe("nudo:recursion-truncated suggestion 带具体建议值", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetAbsCallBudget();
  });
  afterEach(() => resetAbsCallBudget());

  it("depth 臂：@nudo:budget depth=<N>（N ≥ 128）", () => {
    const src = `/**
 * @nudo:budget depth=2
 */
export function down(n) {
  if (n <= 0) { return 0; }
  return down(n - 1) + 1;
}
`;
    const r = checkSource("t-depth-hint.js", src, pTrue);
    const issue = r.issues.find((i) => i.code === "nudo:recursion-truncated" && i.reason === "depth");
    expect(issue).toBeDefined();
    const hint = issue!.suggestion!;
    expect(hint).toMatch(/@nudo:budget depth=\d+/);
    const m = /@nudo:budget depth=(\d+)/.exec(hint)!;
    expect(Number(m[1])).toBeGreaterThanOrEqual(128);
  });

  it("calls/depth 组合臂：@nudo:budget calls=<N> depth=<M>（N ≥ 40000、M ≥ 128）", () => {
    // 互递归 + @nudo:budget calls=10（低于默认）⇒ B 路径调用预算截断，
    // 归因 reasons 同时含 calls/depth ⇒ 组合臂（budget）文案带两个具体值
    const src = `/**
 * @nudo:budget calls=10
 */
export function a(n) { if (n <= 0) { return 0; } return b(n - 1) + 1; }
/**
 * @nudo:budget calls=10
 */
export function b(n) { if (n <= 0) { return 0; } return a(n - 1) + 1; }
`;
    const r = checkSource("t-calls-hint.js", src, pTrue);
    const issue = r.issues.find(
      (i) => i.code === "nudo:recursion-truncated" && i.reason === "budget",
    );
    expect(issue).toBeDefined();
    const hint = issue!.suggestion!;
    expect(hint).toMatch(/@nudo:budget calls=(\d+) depth=(\d+)/);
    const m = /@nudo:budget calls=(\d+) depth=(\d+)/.exec(hint)!;
    expect(Number(m[1])).toBeGreaterThanOrEqual(40_000);
    expect(Number(m[2])).toBeGreaterThanOrEqual(128);
  });

  it("cycle 臂：维持代码级建议，明说抬预算无效（不落数值 quickfix）", () => {
    const src = `export function sameArgs(x) { return sameArgs(x); }`;
    const r = checkSource("t-cycle-hint.js", src, pTrue);
    const issue = r.issues.find((i) => i.code === "nudo:recursion-truncated" && i.reason === "cycle");
    expect(issue).toBeDefined();
    expect(issue!.suggestion).toContain("make the recursion arguments vary per level");
    expect(issue!.suggestion).toContain("narrow the base case");
    expect(issue!.suggestion).toContain("@nudo:contract");
    expect(issue!.suggestion).toContain("raising @nudo:budget will not change this");
    expect(issue!.suggestion).not.toMatch(/@nudo:budget (depth|calls)=\d/);
  });
});
