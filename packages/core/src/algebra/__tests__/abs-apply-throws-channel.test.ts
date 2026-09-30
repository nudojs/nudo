/**
 * FIX-D7 / H1：Abs fn apply 契约 throws 通道。
 *
 * 契约（DESIGN-003 根治）：
 * - apply 可返回裸 Abs（= 不抛）或 AbsApplyResult `{ abs, throws }`（throws 必填）。
 * - $call 单点路由 throws 面：always-throw → NudoThrow；may-throw → pushThrowExit。
 * - 包装 callTranspiledExportFull 的唯一入口是 callTranspiledExportApply——
 *   新包装点经该工厂不可能再丢 throws。
 */
import { describe, it, expect } from "vitest";
import {
  absFunction,
  isAbsApplyResult,
  runTranspiled,
  callTranspiledExportFull,
  callTranspiledExportApply,
  numLit,
  never as neverAbs,
  unknown as absUnknown,
  type Abs,
  type AbsApplyResult,
} from "../index.ts";
import { $call } from "../exec/call.ts";
import { isNudoThrow, NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { runWithLoopExits, takeThrowExits } from "../exec/runtime/state.ts";

describe("AbsApplyResult contract", () => {
  it("isAbsApplyResult discriminates object form from bare Abs", () => {
    const bare: Abs = numLit(1);
    const full: AbsApplyResult = { abs: numLit(1), throws: neverAbs };
    expect(isAbsApplyResult(bare)).toBe(false);
    expect(isAbsApplyResult(full)).toBe(true);
  });
});

describe("$call routes apply throws channel (H1)", () => {
  it("always-throw AbsApplyResult → NudoThrow from $call", () => {
    const throws = errorTypeAbs("TypeError");
    const fn = absFunction([], {
      apply: () => ({ abs: neverAbs, throws }),
    });
    let caught: unknown;
    try {
      $call(fn, []);
    } catch (e) {
      caught = e;
    }
    expect(isNudoThrow(caught)).toBe(true);
    expect((caught as NudoThrow).absValue).toBe(throws);
  });

  it("may-throw AbsApplyResult → pushThrowExit into caller frame, returns abs", () => {
    const throws = errorTypeAbs("RangeError");
    const ok = numLit(42);
    const fn = absFunction([], {
      apply: () => ({ abs: ok, throws }),
    });
    const r = runWithLoopExits(() => {
      const v = $call(fn, []);
      return { v, exits: takeThrowExits() };
    });
    expect(r.v).toBe(ok);
    expect(r.exits).toHaveLength(1);
    expect(r.exits[0]).toBe(throws);
  });

  it("never throws face routes as pure return (no throw exit)", () => {
    const ok = numLit(7);
    const fn = absFunction([], {
      apply: () => ({ abs: ok, throws: neverAbs }),
    });
    const r = runWithLoopExits(() => {
      const v = $call(fn, []);
      return { v, exits: takeThrowExits() };
    });
    expect(r.v).toBe(ok);
    expect(r.exits).toHaveLength(0);
  });

  it("bare Abs apply still means no throws (legacy simple applies)", () => {
    const ok = numLit(1);
    const fn = absFunction([], { apply: () => ok });
    const r = runWithLoopExits(() => {
      const v = $call(fn, []);
      return { v, exits: takeThrowExits() };
    });
    expect(r.v).toBe(ok);
    expect(r.exits).toHaveLength(0);
  });

  it("pure memo re-routes throws on cache hit (does not drop may-throw)", () => {
    const throws = errorTypeAbs("TypeError");
    const ok = numLit(3);
    let calls = 0;
    const fn = absFunction([], {
      apply: () => {
        calls += 1;
        return { abs: ok, throws };
      },
      pureName: "memoThrows",
    });
    const first = runWithLoopExits(() => {
      const v = $call(fn, []);
      return { v, exits: takeThrowExits() };
    });
    const second = runWithLoopExits(() => {
      const v = $call(fn, []);
      return { v, exits: takeThrowExits() };
    });
    expect(calls).toBe(1);
    expect(first.exits).toHaveLength(1);
    // 命中缓存仍必须重放 throws 面——只缓存 abs 会在命中时假「不抛」
    expect(second.exits).toHaveLength(1);
    expect(second.exits[0]).toBe(throws);
  });
});

describe("callTranspiledExportApply — the only wrap point for callTranspiledExportFull", () => {
  it("always-throw export surfaces throws via apply return channel", () => {
    const run = runTranspiled(
      `export function boom() { throw new TypeError("x"); }`,
      { mode: "analyze" },
    );
    const apply = callTranspiledExportApply(run, "boom");
    const full = apply([]);
    expect(isAbsApplyResult(full)).toBe(true);
    const { abs: r, throws } = full as AbsApplyResult;
    expect(r.shape.k).toBe("never");
    expect(throws.shape.k).not.toBe("never");
    // $call 路由后：NudoThrow 冒泡
    const fn = absFunction([], { apply: callTranspiledExportApply(run, "boom") });
    let caught: unknown;
    try {
      $call(fn, []);
    } catch (e) {
      caught = e;
    }
    expect(isNudoThrow(caught)).toBe(true);
  });

  it("may-throw export surfaces throws via apply return channel", () => {
    const run = runTranspiled(
      `export function maybe(x) { if (x) throw new TypeError("x"); return 1; }`,
      { mode: "analyze" },
    );
    // 抽象实参（unknown）→ 条件分支 fork：一臂 throw、一臂 return = may-throw
    const apply = callTranspiledExportApply(run, "maybe");
    const full = apply([absUnknown]);
    const { abs: r, throws } = full as AbsApplyResult;
    expect(r.shape.k).not.toBe("never");
    expect(throws.shape.k).not.toBe("never");
    // $call 路由后：pushThrowExit
    const fn = absFunction(["x"], { apply: callTranspiledExportApply(run, "maybe") });
    const routed = runWithLoopExits(() => {
      const v = $call(fn, [absUnknown]);
      return { v, exits: takeThrowExits() };
    });
    expect(routed.exits).toHaveLength(1);
  });

  it("cross-module always-throw: caller result=never, throws non-never (gold)", () => {
    const runBoom = runTranspiled(
      `export function boom() { throw new TypeError("x"); }`,
      { mode: "analyze" },
    );
    // 模拟导出桥（新包装点走工厂——throws 不可丢）
    const boomFn = absFunction([], {
      apply: callTranspiledExportApply(runBoom, "boom"),
      kind: "eval-export",
      fingerprint: "a#boom",
    });
    const runF = runTranspiled(
      `import { boom } from "./a.js";\nexport function f() { return boom(); }`,
      {
        mode: "analyze",
        modules: { "./a.js": { named: { boom: boomFn }, evaluated: true } } as never,
      },
    );
    const res = callTranspiledExportFull(runF, "f", []);
    expect(res.result.shape.k).toBe("never");
    expect(res.throws.shape.k).not.toBe("never");
  });

  it("cross-module may-throw: caller throws non-never (gold)", () => {
    const runMaybe = runTranspiled(
      `export function maybe(x) { if (x) throw new TypeError("x"); return 1; }`,
      { mode: "analyze" },
    );
    const maybeFn = absFunction(["x"], {
      apply: callTranspiledExportApply(runMaybe, "maybe"),
      kind: "eval-export",
      fingerprint: "a#maybe",
    });
    const runF = runTranspiled(
      `import { maybe } from "./a.js";\nexport function f(x) { return maybe(x); }`,
      {
        mode: "analyze",
        modules: { "./a.js": { named: { maybe: maybeFn }, evaluated: true } } as never,
      },
    );
    const res = callTranspiledExportFull(runF, "f", [absUnknown]);
    expect(res.throws.shape.k).not.toBe("never");
    // may-throw 双面：result 非 never（不得折成 always-throw）
    expect(res.result.shape.k).not.toBe("never");
  });
});

describe("source gate — new wrap points cannot drop throws (FIX-D7)", () => {
  it("production apply callbacks never hand-unwrap callTranspiledExportFull(...).result", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const roots = [
      join(here, "..", "..", ".."), // packages/core/src
      join(here, "..", "..", "..", "..", "service", "src"),
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir)) {
        const p = join(dir, ent);
        const st = statSync(p);
        if (st.isDirectory()) {
          if (ent === "__tests__" || ent === "node_modules" || ent === "dist") continue;
          walk(p);
          continue;
        }
        if (!p.endsWith(".ts") || p.endsWith(".test.ts")) continue;
        const text = readFileSync(p, "utf-8");
        // 危险模式：apply 回调内手拆 callTranspiledExportFull(...).result
        // （BUG-006 根因）。合法路径是 callTranspiledExportApply 工厂。
        const re = /apply\s*:[\s\S]{0,200}?callTranspiledExportFull\s*\([\s\S]{0,120}?\)\s*\.result/g;
        if (re.test(text)) offenders.push(p);
      }
    };
    for (const r of roots) walk(r);
    expect(offenders, `hand-unwrapped callTranspiledExportFull(...).result in apply: ${offenders.join(", ")}`).toEqual([]);
  });
});
