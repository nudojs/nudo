/**
 * BUG-013 预算共享态：跨导出桥嵌套进入不得 reset 外层深度/cycle 键。
 *
 * 此前 callTranspiledExportFull 入口 resetEvalCallBudget() 把
 * evalCallDepth / evalActiveCallKeys 清零——导出桥（$call → apply →
 * callTranspiledExportFull）是被调帧，嵌套进入会抹掉外层记账，$callNamed
 * 的 evalExitCall 再把 depth 打成负数，深度/cycle 守卫从此失效。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  numLit,
  litValue,
  formatAbs,
  absFunction,
  resetEvalCallBudget,
  MAX_EVAL_CALL_DEPTH,
  type Abs,
} from "@nudojs/core";
import {
  getEvalCallBudgetState,
  setAbsTruncationCollector,
} from "@nudojs/core/internal";

afterEach(() => {
  resetEvalCallBudget();
  setAbsTruncationCollector(null);
});

/** 模拟 abs-modules-graph 导出桥：JS 导出包成 Abs fn，apply 回 callTranspiledExportFull */
function bridgeExport(
  run: Record<string, unknown>,
  name: string,
  fingerprint: string,
): Abs {
  return absFunction(["n"], {
    apply: (args: Abs[]) => callTranspiledExportFull(run, name, args).result,
    kind: "eval-export",
    fingerprint,
  });
}

/** 装配 A 调 import f（B 导出桥） */
function setupCrossModule(fExport: {
  src: string;
  probe?: (args: Abs[]) => void;
}): {
  runA: Record<string, unknown>;
  runB: Record<string, unknown>;
} {
  const runB = runTranspiled(fExport.src, { mode: "analyze" });
  if (fExport.probe) {
    const orig = runB.f as (...a: Abs[]) => Abs;
    runB.f = ((...args: Abs[]) => {
      fExport.probe!(args);
      return orig(...args);
    }) as never;
  }
  const fBridge = bridgeExport(runB, "f", "eval:b#f");
  const runA = runTranspiled(
    `import { f } from "./b.js";\nexport function g(n) { return f(n); }`,
    {
      mode: "analyze",
      modules: { "./b.js": { named: { f: fBridge } } } as never,
    },
  );
  return { runA, runB };
}

describe("BUG-013 nested call budget session", () => {
  it("nested export-bridge entry inherits outer depth (does not clear mid-flight)", () => {
    let midState: ReturnType<typeof getEvalCallBudgetState> | null = null;
    const { runA } = setupCrossModule({
      src: `export function f(n) { return n; }`,
      probe: () => {
        // 嵌套 callTranspiledExportFull 已 enter session、正在调用 fn 时，
        // 外层 $callNamed 帧必须仍在记账中（旧代码此处 depth/keys 已被清零）。
        midState = getEvalCallBudgetState();
      },
    });

    const r = callTranspiledExportFull(runA, "g", [numLit(7)]);
    expect(litValue(r.result)).toBe(7);
    expect(midState).not.toBeNull();
    expect(midState!.sessionDepth).toBeGreaterThanOrEqual(1);
    expect(midState!.depth).toBeGreaterThanOrEqual(1);
    expect(midState!.activeKeys).toBeGreaterThanOrEqual(1);
    expect(getEvalCallBudgetState()).toMatchObject({
      depth: 0,
      activeKeys: 0,
      sessionDepth: 0,
    });
    expect(getEvalCallBudgetState().depth).toBeGreaterThanOrEqual(0);
  });

  it("mutual cross-module recursion truncates via MAX_EVAL_CALL_DEPTH (no native stack blow)", () => {
    // a.f ⇄ b.g 互递归（每次跨导出桥）。旧代码每跨一桥就 reset，深度永远
    // 从 0/1 重新数 → 原生栈溢出被吞成 unknown；新代码深度跨桥累计 → 截断。
    let runA: Record<string, unknown> | undefined;
    const fBridge = absFunction(["n"], {
      apply: (args: Abs[]) => callTranspiledExportFull(runA!, "f", args).result,
      kind: "eval-export",
      fingerprint: "eval:a#f",
    });
    const runB = runTranspiled(
      `import { f } from "./a.js";\nexport function g(n) { if (n <= 0) { return 0; } return f(n - 1); }`,
      {
        mode: "analyze",
        modules: { "./a.js": { named: { f: fBridge } } } as never,
      },
    );
    runA = runTranspiled(
      `import { g } from "./b.js";\nexport function f(n) { if (n <= 0) { return 0; } return g(n - 1); }`,
      {
        mode: "analyze",
        modules: {
          "./b.js": {
            named: {
              g: absFunction(["n"], {
                apply: (args: Abs[]) =>
                  callTranspiledExportFull(runB, "g", args).result,
                kind: "eval-export",
                fingerprint: "eval:b#g",
              }),
            },
          },
        } as never,
      },
    );

    const r = callTranspiledExportFull(runA, "f", [numLit(500)]);
    expect(r.result.conf).toBe("opaque");
    expect(getEvalCallBudgetState()).toMatchObject({ depth: 0, sessionDepth: 0 });
  });

  it("cross-module recursion is bounded by MAX_EVAL_CALL_DEPTH", () => {
    const { runA } = setupCrossModule({
      src: `export function f(n) { if (n <= 0) { return 0; } return f(n - 1); }`,
    });
    // 200 层 > MAX_EVAL_CALL_DEPTH=64：跨桥后深度必须累计，触发截断
    const r = callTranspiledExportFull(runA, "g", [numLit(200)]).result;
    expect(r.conf).toBe("opaque");
    expect(getEvalCallBudgetState()).toMatchObject({
      depth: 0,
      activeKeys: 0,
      sessionDepth: 0,
    });
  });

  it("depth guard survives a nested bridge call (no stuck-negative depth)", () => {
    // 先走一次跨桥调用（旧代码会把 depth 打成负数，守卫从此失效），
    // 再跑深递归——必须仍能按 MAX_EVAL_CALL_DEPTH 截断。
    const { runA } = setupCrossModule({ src: `export function f(n) { return n; }` });
    const ok = callTranspiledExportFull(runA, "g", [numLit(3)]);
    expect(litValue(ok.result)).toBe(3);
    expect(getEvalCallBudgetState().depth).toBe(0);

    const deep = runTranspiled(
      `export function down(n) { if (n <= 0) { return 0; } return down(n - 1); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(deep, "down", [
      numLit(MAX_EVAL_CALL_DEPTH + 10),
    ]);
    expect(r.result.conf).toBe("opaque");
  });

  it("sequential host entries still get a fresh budget", () => {
    const src = `export function down(n) { if (n <= 0) { return 0; } return down(n - 1); }`;
    const run = runTranspiled(src, { mode: "analyze" });
    const a = callTranspiledExportFull(run, "down", [numLit(10)]);
    expect(litValue(a.result)).toBe(0);
    expect(getEvalCallBudgetState()).toMatchObject({
      depth: 0,
      activeKeys: 0,
      sessionDepth: 0,
    });

    const b = callTranspiledExportFull(run, "down", [numLit(10)]);
    expect(litValue(b.result)).toBe(0);
    expect(getEvalCallBudgetState()).toMatchObject({
      depth: 0,
      activeKeys: 0,
      sessionDepth: 0,
    });
  });

  it("truncation reports never throws (no false may-throw)", () => {
    const src = `export function forever(n) { return forever(n); }`;
    const run = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(run, "forever", [numLit(1)]);
    expect(r.result.conf).toBe("opaque");
    expect(formatAbs(r.throws)).toContain("never");
  });
});
