/**
 * 导出调用骨架统一（runExportCallGuarded）行为表。
 *
 * JS 函数导出与一等 fn Abs 导出共用同一调用/退出/异常路由后，每个出口的
 * 可观察面必须与旧两份骨架一致。本表按导出形态逐出口锁定：
 * - 正常返回（含宿主裸值 → Abs 收形）；
 * - NudoReturn 早退；NudoThrow 载荷；
 * - 原生 ReferenceError（JS 导出：「原生必抛」never；Abs fn：$call 内引擎
 *   回落面 unknown + noteEvalFallback——既有差异，骨架原样保留）；
 * - 原生 TypeError（fail-closed unknown + 回落计数）；
 * - 回落**标签**分两维（BUG-073）：用户代码（编译体）求值时逃逸的原生异常
 *   ⇒ `module-throw`（程序自身抛，不是引擎缺陷）；宿主实现的 apply 钩子抛
 *   ⇒ `internal`（引擎看不见其源码，DEC-006 canary）；
 * - 兄弟 exit 通道（pushThrowExit / pushLoopExit）与正常出口 join；
 * - 非 fn 导出目标（primitive / 缺失 / Abs 非 fn）不变。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import {
  callTranspiledExportFull,
  getEvalFallbackStats,
  type TranspiledCallResult,
} from "../run.ts";
import { absFunction } from "../../abs-fn.ts";
import { numLit, litValue, type Abs } from "../../abs.ts";
import {
  NudoReturn,
  NudoThrow,
  pushLoopExit,
  pushThrowExit,
  takeLoopExits,
  takeThrowExits,
} from "../runtime.ts";
import { errorTypeAbs } from "../may-throw.ts";

function bodyOf(src: string) {
  const ast = parse(`function f(x) { ${src} }`, { sourceType: "module" });
  const decl = ast.program.body[0];
  if (decl?.type !== "FunctionDeclaration") throw new Error("bad fixture");
  return decl.body;
}

function fnAbs(src: string): Abs {
  return absFunction(["x"], { body: bodyOf(src) });
}

type ResultFace =
  | { k: "prim"; lit?: unknown }
  | { k: "never" }
  | { k: "unknown" }
  | { k: "fn" };

type ThrowsFace = { k: "never" } | { k: "brand"; name: string };

function expectResultFace(r: TranspiledCallResult, face: ResultFace): void {
  expect(r.result.shape.k).toBe(face.k);
  if ("lit" in face && face.lit !== undefined) {
    expect(litValue(r.result)).toEqual({ ok: true, value: face.lit });
  }
}

function expectThrowsFace(r: TranspiledCallResult, face: ThrowsFace): void {
  expect(r.throws.shape.k).toBe(face.k);
  if (face.k === "brand") {
    expect(r.throws.shape.k).toBe("brand");
    expect((r.throws.shape as { name?: string }).name).toBe(face.name);
  }
}

type RawCase = {
  label: string;
  invoke: () => unknown;
  result: ResultFace;
  throws: ThrowsFace;
  /** noteEvalFallback 的 internal 增量 */
  fallback: number;
};

const rawCases: RawCase[] = [
  {
    label: "normal return（Abs 值）",
    invoke: () => numLit(3),
    result: { k: "prim", lit: 3 },
    throws: { k: "never" },
    fallback: 0,
  },
  {
    label: "normal return（宿主裸值经 asAbsVal 收形）",
    invoke: () => "hi",
    result: { k: "prim", lit: "hi" },
    throws: { k: "never" },
    fallback: 0,
  },
  {
    label: "normal return（宿主函数经 asAbsVal 门面）",
    invoke: () => function h() { return 1; },
    result: { k: "fn" },
    throws: { k: "never" },
    fallback: 0,
  },
  {
    label: "NudoReturn 早退 → 返回值（与 exits join）",
    invoke: () => {
      throw new NudoReturn(numLit(9));
    },
    result: { k: "prim", lit: 9 },
    throws: { k: "never" },
    fallback: 0,
  },
  {
    label: "NudoThrow → result never + throws 载荷",
    invoke: () => {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    },
    result: { k: "never" },
    throws: { k: "brand", name: "TypeError" },
    fallback: 0,
  },
  {
    label: "原生 ReferenceError → never + throws ReferenceError",
    invoke: () => {
      throw new ReferenceError("tdz");
    },
    result: { k: "never" },
    throws: { k: "brand", name: "ReferenceError" },
    fallback: 0,
  },
  {
    label: "原生 TypeError → fail-closed unknown + internal 回落",
    invoke: () => {
      throw new TypeError("boom");
    },
    result: { k: "unknown" },
    throws: { k: "brand", name: "TypeError" },
    fallback: 1,
  },
  {
    label: "兄弟 throw exit 在正常出口 join 进 throws",
    invoke: () => {
      pushThrowExit(errorTypeAbs("RangeError"));
      return numLit(2);
    },
    result: { k: "prim", lit: 2 },
    throws: { k: "brand", name: "RangeError" },
    fallback: 0,
  },
  {
    label: "loop exit 在正常出口 join 进 result",
    invoke: () => {
      pushLoopExit(numLit(2));
      return numLit(2);
    },
    result: { k: "prim", lit: 2 },
    throws: { k: "never" },
    fallback: 0,
  },
];

type AbsCase = {
  label: string;
  make: () => Abs;
  args: Abs[];
  result: ResultFace;
  throws: ThrowsFace;
  /** noteEvalFallback 的 **internal** 增量（引擎/宿主边界自身违约） */
  fallback: number;
  /**
   * noteEvalFallback 的 **module-throw** 增量（程序自身抛）。
   *
   * BUG-073：用户代码（编译体）求值时逃逸的原生异常 ⇒ 标签 `module-throw`
   * （不是引擎缺陷）⇒ 不再计 internal；宿主实现的 apply 钩子抛 ⇒ 引擎看不见
   * 其源码 ⇒ 仍计 internal（DEC-006 canary）。
   */
  moduleThrowFallback?: number;
  /** 正常出口的 returnType 观测回填（refineFnReturnType） */
  returnType: "refined" | "unset";
};

const absCases: AbsCase[] = [
  {
    label: "正常返回（编译体）→ result 与 returnType 槽回填",
    make: () => fnAbs("return x + 1;"),
    args: [numLit(5)],
    result: { k: "prim", lit: 6 },
    throws: { k: "never" },
    fallback: 0,
    returnType: "refined",
  },
  {
    label: "正常返回（apply 钩子）→ result 与 returnType 槽回填",
    make: () => absFunction(["x"], { apply: () => numLit(4) }),
    args: [numLit(5)],
    result: { k: "prim", lit: 4 },
    throws: { k: "never" },
    fallback: 0,
    returnType: "refined",
  },
  {
    label: "NudoReturn 早退 → 返回值 + returnType 槽回填",
    make: () =>
      absFunction(["x"], {
        apply: () => {
          throw new NudoReturn(numLit(9));
        },
      }),
    args: [numLit(5)],
    result: { k: "prim", lit: 9 },
    throws: { k: "never" },
    fallback: 0,
    returnType: "refined",
  },
  {
    label: "NudoThrow → result never + throws 载荷（不回填 returnType）",
    make: () =>
      absFunction(["x"], {
        apply: () => {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        },
      }),
    args: [numLit(5)],
    result: { k: "never" },
    throws: { k: "brand", name: "TypeError" },
    fallback: 0,
    returnType: "unset",
  },
  {
    label: "原生 ReferenceError（编译体自由名）→ 引擎回落 unknown + throws",
    make: () => fnAbs("return x + k;"),
    args: [numLit(5)],
    result: { k: "unknown" },
    throws: { k: "brand", name: "ReferenceError" },
    // **重钉（BUG-073 §修复方向：「宿主原生异常…归 module-throw（程序自身抛）」
    // ⇒ 用户代码侧的「原生异常归类」以该节为准）**：编译体（用户代码）里的自由名
    // ⇒ ReferenceError 是**用户代码自身抛**（拼错的标识符）⇒ 标签
    // `module-throw`，不再是引擎缺陷 ⇒ internal 增量 0、module-throw 增量 1。
    // （回落面本身不变：结果面 unknown + throws ReferenceError，仍 fail-closed。）
    fallback: 0,
    moduleThrowFallback: 1,
    returnType: "unset",
  },
  {
    label: "原生 TypeError → fail-closed unknown + internal 回落",
    make: () =>
      absFunction(["x"], {
        apply: () => {
          throw new TypeError("boom");
        },
      }),
    args: [numLit(5)],
    result: { k: "unknown" },
    throws: { k: "brand", name: "TypeError" },
    // 宿主实现的 apply 钩子 ⇒ 引擎看不见其源码 ⇒ 仍记 internal（DEC-006
    // canary；BUG-073 的 module-throw 只归用户代码求值时的原生异常）。
    fallback: 1,
    returnType: "unset",
  },
  {
    label: "兄弟 throw exit 在正常出口 join 进 throws",
    make: () =>
      absFunction(["x"], {
        apply: () => {
          pushThrowExit(errorTypeAbs("RangeError"));
          return numLit(2);
        },
      }),
    args: [numLit(5)],
    result: { k: "prim", lit: 2 },
    throws: { k: "brand", name: "RangeError" },
    fallback: 0,
    returnType: "refined",
  },
  {
    label: "loop exit 在正常出口 join 进 result",
    make: () =>
      absFunction(["x"], {
        apply: () => {
          pushLoopExit(numLit(2));
          return numLit(2);
        },
      }),
    args: [numLit(5)],
    result: { k: "prim", lit: 2 },
    throws: { k: "never" },
    fallback: 0,
    returnType: "refined",
  },
];

describe("runExportCallGuarded — raw JS function export", () => {
  for (const c of rawCases) {
    it(c.label, () => {
      const before = getEvalFallbackStats().internal;
      const r = callTranspiledExportFull({ f: c.invoke } as never, "f", []);
      expect(getEvalFallbackStats().internal - before).toBe(c.fallback);
      expectResultFace(r, c.result);
      expectThrowsFace(r, c.throws);
    });
  }

  it("loop/throw exit 通道按调用作用域隔离", () => {
    const r = callTranspiledExportFull(
      {
        f: () => {
          pushLoopExit(numLit(1));
          pushThrowExit(errorTypeAbs("RangeError"));
          return numLit(1);
        },
      } as never,
      "f",
      [],
    );
    expect(r.result.shape.k).toBe("prim");
    expectThrowsFace(r, { k: "brand", name: "RangeError" });
    expect(takeLoopExits()).toEqual([]);
    expect(takeThrowExits()).toEqual([]);
  });
});

describe("runExportCallGuarded — Abs fn export", () => {
  for (const c of absCases) {
    it(c.label, () => {
      const fn = c.make();
      const before = getEvalFallbackStats();
      const r = callTranspiledExportFull({ f: fn }, "f", c.args);
      const after = getEvalFallbackStats();
      // 回落面分两维断言（BUG-073）：internal = 引擎/宿主边界自身违约；
      // module-throw = 程序自身抛（用户代码求值时逃逸的原生异常）。
      expect(after.internal - before.internal).toBe(c.fallback);
      expect(after.moduleThrow - before.moduleThrow).toBe(c.moduleThrowFallback ?? 0);
      expectResultFace(r, c.result);
      expectThrowsFace(r, c.throws);

      const returnType = (fn.shape as { returnType?: Abs }).returnType;
      if (c.returnType === "unset") {
        expect(returnType).toBeUndefined();
      } else {
        expect(returnType).toBeDefined();
        if ("lit" in c.result && c.result.lit !== undefined) {
          expect(litValue(returnType!)).toEqual({ ok: true, value: c.result.lit });
        }
      }
    });
  }

  it("loop/throw exit 通道按调用作用域隔离", () => {
    const fn = absFunction(["x"], {
      apply: () => {
        pushLoopExit(numLit(1));
        pushThrowExit(errorTypeAbs("RangeError"));
        return numLit(1);
      },
    });
    const r = callTranspiledExportFull({ f: fn }, "f", [numLit(1)]);
    expect(r.result.shape.k).toBe("prim");
    expectThrowsFace(r, { k: "brand", name: "RangeError" });
    expect(takeLoopExits()).toEqual([]);
    expect(takeThrowExits()).toEqual([]);
  });
});

describe("非 fn 导出目标不变", () => {
  it("primitive 导出目标 → unknown / throws never", () => {
    const before = getEvalFallbackStats().internal;
    const r = callTranspiledExportFull({ x: 1 } as never, "x", []);
    expect(getEvalFallbackStats().internal - before).toBe(0);
    expect(r.result.shape.k).toBe("unknown");
    expect(r.throws.shape.k).toBe("never");
  });

  it("缺失导出目标 → unknown / throws never", () => {
    const r = callTranspiledExportFull({ x: 1 } as never, "missing", []);
    expect(r.result.shape.k).toBe("unknown");
    expect(r.throws.shape.k).toBe("never");
  });

  it("Abs 非 fn 导出目标原样透出（对象身份不变）", () => {
    const value = numLit(7);
    const r = callTranspiledExportFull({ x: value }, "x", []);
    expect(r.result).toBe(value);
    expect(r.throws.shape.k).toBe("never");
  });
});
