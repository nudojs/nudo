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
  absOnly,
  getFnImpl,
  isAbsApplyResult,
  makeAbsApplyResult,
  relationFn,
  runTranspiled,
  callTranspiledExportFull,
  callTranspiledExportApply,
  num,
  numLit,
  objOf,
  str,
  litValue,
  never as neverAbs,
  unknown as absUnknown,
  type Abs,
  type AbsApplyNoThrow,
  type AbsApplyNoThrowFn,
  type AbsApplyResult,
} from "../index.ts";
import { $call } from "../exec/call.ts";
import { $new } from "../exec/class/construct.ts";
import { $invoke } from "../exec/class/invoke.ts";
import { isNudoThrow, NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { runWithLoopExits, takeThrowExits } from "../exec/runtime/state.ts";

describe("AbsApplyResult contract", () => {
  it("isAbsApplyResult discriminates object form from bare Abs", () => {
    const bare: Abs = numLit(1);
    const full: AbsApplyResult = makeAbsApplyResult(numLit(1), neverAbs);
    expect(isAbsApplyResult(bare)).toBe(false);
    expect(isAbsApplyResult(full)).toBe(true);
  });

  it("absOnly peels the abs facet from either return form", () => {
    const bare: AbsApplyNoThrow = numLit(7);
    const full: AbsApplyResult = makeAbsApplyResult(numLit(7), neverAbs);
    expect(absOnly(bare)).toBe(bare);
    expect(absOnly(full)).toBe(full.abs);
  });

  it("AbsApplyNoThrowFn is assignable to AbsFnImpl.apply (no-throw face)", () => {
    const apply: AbsApplyNoThrowFn = (args) => args[0] ?? numLit(0);
    const fn = absFunction(["x"], { apply });
    const impl = getFnImpl(fn);
    expect(impl?.apply).toBeTypeOf("function");
    const out = absOnly(impl!.apply!([numLit(3)]));
    expect(litValue(out)).toEqual({ ok: true, value: 3 });
  });
});

describe("$call routes apply throws channel (H1)", () => {
  it("always-throw AbsApplyResult → NudoThrow from $call", () => {
    const throws = errorTypeAbs("TypeError");
    const fn = absFunction([], {
      apply: () => makeAbsApplyResult(neverAbs, throws),
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
      apply: () => makeAbsApplyResult(ok, throws),
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
      apply: () => makeAbsApplyResult(ok, neverAbs),
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
        return makeAbsApplyResult(ok, throws);
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

/**
 * FIX-RESIDUAL-4 项 3：absOnly 误用门禁。
 *
 * `absOnly` 丢 throws 通道（测试/宿主便利）。产品内 `$call` / `$callNamed`
 * 统一路由必须消费 `AbsApplyResult`（normalizeApplyReturn + routeApplyThrows）——
 * 一旦路由点改用 `absOnly`，may-throw 会静默吞成「不抛」。源码门禁钉住。
 */
describe("source gate — $call routing never peels throws via absOnly (FIX-RESIDUAL-4)", () => {
  it("production call.ts / calls.ts routing path does not call absOnly", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const execDir = join(here, "..", "exec");
    const targets = [join(execDir, "call.ts"), join(execDir, "calls.ts")];
    const offenders: string[] = [];
    for (const p of targets) {
      const text = readFileSync(p, "utf-8");
      // 排除 import/注释/JSDoc 里的提及；只要真实调用 `absOnly(`
      const withoutComments = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (/\babsOnly\s*\(/.test(withoutComments)) offenders.push(p);
    }
    expect(
      offenders,
      `absOnly() must not appear in $call routing (drops throws channel): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("production routing consumes AbsApplyResult via normalizeApplyReturn / routeApplyThrows", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const callSrc = readFileSync(join(here, "..", "exec", "call.ts"), "utf-8");
    // 结构钉：路由点必须经 normalizeApplyReturn 收成 AbsApplyResult，
    // 再经 routeApplyThrows 单点路由 throws 面（H1）。
    expect(callSrc).toMatch(/function normalizeApplyReturn\b/);
    expect(callSrc).toMatch(/export function routeApplyThrows\b/);
    expect(callSrc).toMatch(/routeApplyThrows\s*\(\s*full\.abs\s*,\s*full\.throws\s*\)/);
  });
});

/**
 * 架构债 A3：relation 面（无 apply）的 throws 通道。
 * 「宿主会抛、但声明侧没写 apply」的 env 声明此前恒记「不抛」（假绿）——
 * relationFn 现承载 throws（impl.relation.throws），$call 关系臂消费时经
 * routeApplyThrows 单点路由（与 apply 通道同一表示，不发明第二套）。
 */
describe("relationFn throws face (A3)", () => {
  it("declared throws → pushThrowExit into caller frame（旧实现恒「不抛」假绿）", () => {
    const throws = errorTypeAbs("TypeError");
    const f = relationFn([num()], str(), { throws });
    const r = runWithLoopExits(() => {
      const v = $call(f, [numLit(1)]);
      return { v, exits: takeThrowExits() };
    });
    // 返回面照常（关系 α 替换不被吞）
    expect(r.v.shape).toEqual({ k: "prim", type: "string" });
    expect(r.exits).toHaveLength(1);
    expect(r.exits[0]).toBe(throws);
  });

  it("no throws declared → bare relation apply（既有行为不变）", () => {
    const f = relationFn([num()], str());
    const r = runWithLoopExits(() => {
      const v = $call(f, [numLit(1)]);
      return { v, exits: takeThrowExits() };
    });
    expect(r.v.shape).toEqual({ k: "prim", type: "string" });
    expect(r.exits).toHaveLength(0);
  });

  it("always-throw relation（returnType=never + throws）→ NudoThrow from $call", () => {
    const throws = errorTypeAbs("RangeError");
    const f = relationFn([num()], neverAbs, { throws });
    let caught: unknown;
    try {
      $call(f, [numLit(1)]);
    } catch (e) {
      caught = e;
    }
    expect(isNudoThrow(caught)).toBe(true);
    expect((caught as NudoThrow).absValue).toBe(throws);
  });

  it("throws 只落 impl.relation.throws（承载位双检；缺省不写字段）", () => {
    const throws = errorTypeAbs("TypeError");
    const withThrows = relationFn([num()], str(), { throws });
    expect(getFnImpl(withThrows)!.relation!.throws).toBe(throws);
    const without = relationFn([num()], str());
    expect(getFnImpl(without)!.relation!.throws).toBeUndefined();
    // 不进 shape（format / leq 无 throws 消费面，避免 absKey 面漂移）
    expect("throws" in withThrows.shape).toBe(false);
  });

  it("gold：跨模块 import 的 relation 声明 ⇒ 调用方入口 throws 面非 never（改前恒不抛）", () => {
    // 模拟 env 声明桥（具名导入 → relationFn）：宿主会抛但声明侧无 apply
    const declared = relationFn([num()], num(), {
      params: ["x"],
      throws: errorTypeAbs("TypeError"),
    });
    const run = runTranspiled(
      `import { risky } from "./decl.js";\nexport function f(x) { return risky(x); }`,
      {
        mode: "analyze",
        modules: { "./decl.js": { named: { risky: declared }, evaluated: true } } as never,
      },
    );
    const res = callTranspiledExportFull(run, "f", [numLit(1)]);
    // 调用效果：入口 may-throw（joinThrowExits 收 pushThrowExit 的 TypeError 面）
    expect(res.throws.shape.k).not.toBe("never");
    expect(res.result.shape.k).not.toBe("never");
  });
});

/**
 * 架构债 A4：构造路径（$new / bind 产物 [[Construct]]）不丢 apply 的 throws 槽。
 * 旧实现 `isAbsApplyResult(x) ? x.abs : x` 手拆 ⇒ 构造器声明的 throws 只在
 * 调用面生效，`new X()` 面恒「不抛」（env-bug-64 的 2.4 曾钉住该假绿）。
 */
describe("$new routes apply throws channel (A4)", () => {
  const throws = errorTypeAbs("TypeError");
  const inst = objOf({ port: { value: numLit(8080) } });

  it("may-throw ctor apply → pushThrowExit + 实例面保留", () => {
    const ctor = absFunction(["x"], {
      apply: () => makeAbsApplyResult(inst, throws),
    }, { ctor: true });
    const r = runWithLoopExits(() => {
      const v = $new(ctor, [numLit(1)]);
      return { v, exits: takeThrowExits() };
    });
    // Bug 250：apply 返回 object-like ⇒ 用它
    expect(r.v).toBe(inst);
    expect(r.exits).toHaveLength(1);
    expect(r.exits[0]).toBe(throws);
  });

  it("always-throw ctor apply（abs=never）→ NudoThrow from $new（不再静默造实例）", () => {
    const ctor = absFunction(["x"], {
      apply: () => makeAbsApplyResult(neverAbs, throws),
    }, { ctor: true });
    let caught: unknown;
    runWithLoopExits(() => {
      try {
        $new(ctor, [numLit(1)]);
      } catch (e) {
        caught = e;
        return;
      }
      return;
    });
    expect(isNudoThrow(caught)).toBe(true);
    expect((caught as NudoThrow).absValue).toBe(throws);
  });

  it("裸 Abs apply ⇒ 不抛（既有构造行为不变）", () => {
    const ctor = absFunction(["x"], {
      apply: () => inst,
    }, { ctor: true });
    const r = runWithLoopExits(() => {
      const v = $new(ctor, [numLit(1)]);
      return { v, exits: takeThrowExits() };
    });
    expect(r.v).toBe(inst);
    expect(r.exits).toHaveLength(0);
  });

  it("bind 产物构造面同样路由目标 apply 的 throws（invoke.ts 解包点）", () => {
    const ctor = absFunction(["x"], {
      apply: () => makeAbsApplyResult(inst, throws),
    }, { ctor: true, name: "EnvCtor" });
    const bound = $invoke(ctor, "bind", []);
    const r = runWithLoopExits(() => {
      const v = $new(bound, [numLit(1)]);
      return { v, exits: takeThrowExits() };
    });
    expect(r.v).toBe(inst);
    expect(r.exits).toHaveLength(1);
    expect(r.exits[0]).toBe(throws);
  });
});

/**
 * A4 源码门禁：`isAbsApplyResult(x) ? x.abs : x` 式手拆是丢 throws 面的
 * 根因形态（架构债 A4 的两处解包点即此类）。构造/调用派发生产面禁止再现
 * 裸拆——必须经 routeApplyThrows 单点路由。
 */
describe("source gate — construct/invoke dispatch never bare-unpacks AbsApplyResult (A4)", () => {
  it("exec/class production sources route apply results via routeApplyThrows, not `.abs` peeling", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const classDir = join(here, "..", "exec", "class");
    const offenders: string[] = [];
    for (const f of ["construct.ts", "invoke.ts", "declare.ts", "invoke-arr.ts"]) {
      const p = join(classDir, f);
      const text = readFileSync(p, "utf-8");
      // 排除注释/JSDoc 里的提及；只盯真实三元解包 `? x.abs : x`
      const withoutComments = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (/\?\s*[A-Za-z_$][\w$]*\.abs\s*:/.test(withoutComments)) offenders.push(f);
    }
    expect(
      offenders,
      `bare-unpacked AbsApplyResult (.abs peeled, throws channel dropped): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
