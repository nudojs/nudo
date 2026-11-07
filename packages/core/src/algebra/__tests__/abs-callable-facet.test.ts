/**
 * A2+A8 · `callable` 槽位启用的回归钉。
 *
 * 台账复测订正：运行时「类值不带 new 被调 → TypeError」已由 Bug 272 闭合
 * （`core-bug-272-class-no-new.test.ts`）。**本槽位补的是承载位**：旧判据
 * 靠 `class-mark.ts` 的 WeakMap 对象身份 + `_rest` 单形参启发式，跨
 * `snapshotAbs` / `substAbs` / 重铸后静默漏判；`facets.callable = false`
 * 随 Abs 值搬运 ⇒ 重建后仍是权威判据。
 *
 * ⚠️ 语义边界：`callable` 判的是「无 new 的 [[Call]] 是否成功」，**不是**
 * 规范 `IsCallable`（class constructor 的 IsCallable 为 true，调用时才抛）。
 * `exec/call.ts::callableFacetOf`（Proxy [[Call]] 判定）因此不读此槽位。
 *
 * 类名全部唯一：类注册表按名进程级驻留，同名会跨用例污染。
 */
import { describe, it, expect } from "vitest";
import { litValue, type Abs } from "../abs.ts";
import { snapshotAbs, substAbs } from "../hof.ts";
import { $call } from "../exec/call.ts";
import { isNudoThrow, NudoThrow } from "../diagnostics/nudo-throw.ts";
import { classNameOfValue } from "../class-mark.ts";
import { call, throwsError } from "./eval-helpers.ts";

/** 从求值结果取出类值 Abs 本身（不再调它）。 */
function classValueOf(className: string, kind: "decl" | "expr-empty" | "expr-body"): Abs {
  const decl = `export function f() { class ${className} {}; return ${className}; }`;
  const exprEmpty = `export function f() { const ${className} = class {}; return ${className}; }`;
  const exprBody = `export function f() { const ${className} = class { m() { return 1; } }; return ${className}; }`;
  const src = kind === "decl" ? decl : kind === "expr-empty" ? exprEmpty : exprBody;
  return call(src, "f").result as Abs;
}

/** 捕获 $call 抛出的 NudoThrow（不抛则返回 undefined）。 */
function caughtThrow(fn: Abs): NudoThrow | undefined {
  try {
    $call(fn, []);
    return undefined;
  } catch (e) {
    return isNudoThrow(e) ? e : undefined;
  }
}

describe("A2+A8 · callable 生产点", () => {
  it("class 声明值携带 callable:false（brand + ctor facet 路径）", () => {
    const cls = classValueOf("CallableDeclA", "decl");
    expect(cls.shape.k).toBe("brand");
    expect(cls.facets?.callable).toBe(false);
    expect(classNameOfValue(cls as object)).toBe("CallableDeclA");
  });

  it("空类体类表达式携带 callable:false（$classExpr fn 快路径）", () => {
    const cls = classValueOf("CallableExprB", "expr-empty");
    expect(cls.shape.k).toBe("fn");
    expect(cls.facets?.callable).toBe(false);
  });

  it("非空类体类表达式携带 callable:false（$class 路径）", () => {
    const cls = classValueOf("CallableExprC", "expr-body");
    expect(cls.facets?.callable).toBe(false);
  });

  it("负控：普通函数不携带 callable 槽位", () => {
    const fn = call(`export function f() { return function plain() { return 3; }; }`, "f")
      .result as Abs;
    expect(fn.shape.k).toBe("fn");
    expect(fn.facets?.callable).toBeUndefined();
    expect(litValue($call(fn, []))).toEqual({ ok: true, value: 3 });
  });
});

describe("A2+A8 · callable 随重建点搬运 ⇒ 快照后仍定抛", () => {
  it("snapshotAbs / substAbs 保留槽位，且 class-mark 侧表确实丢失", () => {
    const cls = classValueOf("CallableSnapD", "decl");
    const snap = snapshotAbs(cls);
    expect(snap.facets?.callable).toBe(false);
    expect(substAbs(cls, new Map()).facets?.callable).toBe(false);
    expect(classNameOfValue(snap as object)).toBeUndefined();
  });

  it("槽位价值：快照后的类值裸调用仍定抛 TypeError", () => {
    const snap = snapshotAbs(classValueOf("CallableSnapE", "decl"));
    const err = caughtThrow(snap);
    expect(err).toBeInstanceOf(NudoThrow);
    expect(throwsError(err!.absValue, "TypeError")).toBe(true);
  });

  it("对照：抹掉槽位的快照（= 旧表示的重建产物）不再被判为类值", () => {
    const snap = snapshotAbs(classValueOf("CallableSnapF", "decl"));
    delete snap.facets;
    // 旧判据需要 class-mark，快照对象没有 ⇒ 不命中 isClassValueCallee。
    // 这里只钉「不是确定抛」，不承诺具体回落值（见 call.ts 可调用判定表）。
    expect(caughtThrow(snap)).toBeUndefined();
  });

  it("fn 快路径的快照同样靠槽位判定（无 ctor+_rest 之外的身份标记）", () => {
    const snap = snapshotAbs(classValueOf("CallableSnapG", "expr-empty"));
    expect(snap.facets?.callable).toBe(false);
    const err = caughtThrow(snap);
    expect(err).toBeInstanceOf(NudoThrow);
    expect(throwsError(err!.absValue, "TypeError")).toBe(true);
  });
});

describe("A2+A8 · 不退化既有语义", () => {
  it("Bug 272 源码路径：A() 仍定抛 TypeError", () => {
    const r = call(
      `class CallableEndToEndH {}
export function f() { return CallableEndToEndH(); }`,
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("Bug 272 控制组：new A() / 普通函数调用正常", () => {
    expect(
      litValue(
        call(
          `class CallableControlI { constructor() { this.x = 4; } }
export function f() { return (new CallableControlI()).x; }`,
          "f",
        ).result,
      ),
    ).toEqual({ ok: true, value: 4 });
  });

  it("callableFacetOf 不读槽位：Proxy 包类值仍装 [[Call]] ⇒ 调用定抛", () => {
    const r = call(
      `class CallableProxyJ {}
export function f() { const P = new Proxy(CallableProxyJ, {}); return P(); }`,
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});
