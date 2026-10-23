/**
 * 族 29 · S0 机制层：`packages/env/src/abs-helpers.ts` 的 `envFn` throws 通道
 * + `enforceArgs` 实参类型执法。
 *
 * 旧实现 `catch { return returnType }` 把「原生必抛」抹成「不抛」（假绿）——
 * 这是族 29 里 877 / 879 / 880 / 881 / 883 / 885 六条的共同根因。
 * 新实现走 core 既有的 throws 通道（`makeAbsApplyResult`）：
 * - 裸 Abs / undefined ⇒ 不抛；
 * - `AbsApplyResult` ⇒ 原样透传；
 * - 原生异常 ⇒ may-throw（`opts.throws` 优先，否则按 `e.name` 推）。
 *
 * 断言双向：正向钉住期望行为；反向（把实现改回旧语义）本文件必须失败。
 */
import { describe, it, expect } from "vitest";
import {
  $call,
  getFnImpl,
  isAbsApplyResult,
  isNudoThrow,
  makeAbsApplyResult,
  numLit,
  runWithLoopExits,
  strLit,
  takeThrowExits,
  unknown as absUnknown,
  type Abs,
  type AbsApplyResult,
} from "@nudojs/core";
import { envFn, envFnVariadic, errBrand, prim, type EnvApplyImpl } from "../abs-helpers.ts";

/** apply 原始返回值（裸 Abs 或带 throws 通道的 AbsApplyResult） */
type ApplyOut = ReturnType<NonNullable<NonNullable<ReturnType<typeof getFnImpl>>["apply"]>>;

/** 取 apply 原始返回值 */
function applyOf(fn: Abs, args: Abs[]): ApplyOut {
  const impl = getFnImpl(fn);
  expect(impl?.apply, "envFn with apply must carry an impl").toBeTypeOf("function");
  return impl!.apply!(args);
}

/** brand 名（错误品牌 Abs 的品牌名，如 "TypeError"） */
function brandName(a: Abs): string | undefined {
  return a.shape.k === "brand" ? (a.shape as { name: string }).name : undefined;
}

/** 调用点的 throws 面（may-throw ⇒ exits 非空；always-throw ⇒ NudoThrow 冒泡） */
function callSite(fn: Abs, args: Abs[]): { value?: Abs; exits: Abs[]; threw?: unknown } {
  return runWithLoopExits(() => {
    try {
      const value = $call(fn, args);
      return { value, exits: takeThrowExits() };
    } catch (e) {
      return { exits: takeThrowExits(), threw: e };
    }
  });
}

describe("S0 机制层 · envFn throws 通道", () => {
  it("1. apply 抛原生 TypeError ⇒ 记 may-throw TypeError（旧实现是「不抛」）", () => {
    const fn = envFn([prim.str()], prim.str(), () => {
      throw new TypeError("boom");
    });
    const out = applyOf(fn, [strLit("x")]);
    expect(isAbsApplyResult(out)).toBe(true);
    const full = out as AbsApplyResult;
    // may-throw：结果面**不是** never（不是必抛）
    expect(full.abs.shape.k).not.toBe("never");
    // throws 面 = TypeError 品牌
    expect(brandName(full.throws)).toBe("TypeError");

    // 调用点：记一条 throw exit（may-throw），不抛 NudoThrow
    const site = callSite(fn, [strLit("x")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("TypeError");
  });

  it("2. apply 返回 makeAbsApplyResult ⇒ throws 面原样透传、abs 面不被吞", () => {
    const errAbs = errBrand("RangeError");
    const okAbs = numLit(42);
    const fn = envFn([], prim.num(), () => makeAbsApplyResult(okAbs, errAbs));
    const out = applyOf(fn, []);
    expect(isAbsApplyResult(out)).toBe(true);
    const full = out as AbsApplyResult;
    // abs 面不被吞（仍是声明方给的值）
    expect(full.abs).toBe(okAbs);
    // throws 面原样透传（同一对象）
    expect(full.throws).toBe(errAbs);

    // 调用点：记该 throws 面
    const site = callSite(fn, []);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(site.exits[0]).toBe(errAbs);
  });

  it("3. apply 正常返回裸 Abs ⇒ 仍然「不抛」（现有 env 声明行为不得回归）", () => {
    const fn = envFn([], prim.num(), () => numLit(7));
    const out = applyOf(fn, []);
    // 裸 Abs（无 throws 通道）
    expect(isAbsApplyResult(out)).toBe(false);
    expect((out as Abs).shape.k).toBe("prim");

    const site = callSite(fn, []);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
  });

  it("4. enforceArgs + 实参确定不符 ⇒ 必抛 TypeError（abs 面 = never）", () => {
    const fn = envFn([prim.str()], prim.str(), () => strLit("ok"), { enforceArgs: true });
    // 实参 number ≠ 形参 string ⇒ 确定不符
    const out = applyOf(fn, [numLit(1)]);
    expect(isAbsApplyResult(out)).toBe(true);
    const full = out as AbsApplyResult;
    expect(full.abs.shape.k).toBe("never");
    expect(full.throws.shape.k).not.toBe("never");
    expect(brandName(full.throws)).toBe("TypeError");

    // 调用点：必抛 ⇒ NudoThrow 冒泡（不是 may-throw）
    const site = callSite(fn, [numLit(1)]);
    expect(site.threw).toBeTruthy();
    expect(isNudoThrow(site.threw)).toBe(true);
  });

  it("5. enforceArgs + 实参抽象（unknown）⇒ may-throw（不是必抛）", () => {
    const fn = envFn([prim.str()], prim.str(), () => strLit("ok"), { enforceArgs: true });
    const out = applyOf(fn, [absUnknown]);
    expect(isAbsApplyResult(out)).toBe(true);
    const full = out as AbsApplyResult;
    // may-throw：结果面不是 never
    expect(full.abs.shape.k).not.toBe("never");
    expect(brandName(full.throws)).toBe("TypeError");

    const site = callSite(fn, [absUnknown]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("TypeError");
  });

  it("6. enforceArgs + 实参相符 ⇒ 正常返回，零抛", () => {
    const fn = envFn([prim.str()], prim.str(), () => strLit("ok"), { enforceArgs: true });
    const out = applyOf(fn, [strLit("x")]);
    // 裸 Abs（无 throws 面）
    expect(isAbsApplyResult(out)).toBe(false);
    expect((out as Abs).shape.k).toBe("prim");

    const site = callSite(fn, [strLit("x")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
  });

  it("7. opts.throws 显式声明 ⇒ 优先于异常名推断（DOMException-like 自定义 name）", () => {
    const declared = errBrand("TypeError");
    // 抛出的异常 name 是 DOMException 风格（"InvalidCharacterError"），不是标准 Error 名
    const throwing: EnvApplyImpl = () => {
      const e = new Error("bad");
      e.name = "InvalidCharacterError";
      throw e;
    };
    // (a) 显式声明 ⇒ 用声明的 throws 面
    const withDecl = envFn([], prim.str(), throwing, { throws: declared });
    const outDecl = applyOf(withDecl, []) as AbsApplyResult;
    expect(isAbsApplyResult(outDecl)).toBe(true);
    expect(outDecl.throws).toBe(declared);
    expect(brandName(outDecl.throws)).toBe("TypeError");

    // (b) 未声明 ⇒ 按 e.name 推断（"InvalidCharacterError"）
    const inferred = envFn([], prim.str(), throwing);
    const outInferred = applyOf(inferred, []) as AbsApplyResult;
    expect(isAbsApplyResult(outInferred)).toBe(true);
    expect(brandName(outInferred.throws)).toBe("InvalidCharacterError");
  });

  it("8. envFn 既有的 name / ctor / slots / params / conf 语义未回归", () => {
    // 关系面（无 apply）
    const rel = envFn([prim.num()], prim.num(), undefined, {
      name: "Foo",
      ctor: true,
      params: ["a"],
      conf: "path",
      slots: { bar: prim.bool() },
    });
    expect(rel.shape.k).toBe("fn");
    expect((rel.shape as { name?: string }).name).toBe("Foo");
    expect((rel.shape as { ctor?: boolean }).ctor).toBe(true);
    expect((rel.shape as { params: string[] }).params).toEqual(["a"]);
    expect(rel.conf).toBe("path");
    expect((rel.shape as { slots?: Record<string, { value: Abs }> }).slots?.bar).toBeTruthy();

    // apply 面
    const fn = envFn([prim.num()], prim.num(), () => numLit(1), {
      name: "Bar",
      ctor: true,
      params: ["a"],
      conf: "path",
      slots: { baz: prim.bool() },
    });
    expect(fn.shape.k).toBe("fn");
    expect((fn.shape as { name?: string }).name).toBe("Bar");
    expect((fn.shape as { ctor?: boolean }).ctor).toBe(true);
    expect((fn.shape as { params: string[] }).params).toEqual(["a"]);
    expect(fn.conf).toBe("path");
    expect((fn.shape as { slots?: Record<string, { value: Abs }> }).slots?.baz).toBeTruthy();
    // apply 面的参数/返回类型仍写入 shape（format / leq 读这里）
    expect((fn.shape as { paramTypes?: Abs[] }).paramTypes?.[0]?.shape.k).toBe("prim");
    expect((fn.shape as { returnType?: Abs }).returnType?.shape.k).toBe("prim");
  });
});

describe("S0 机制层 · envFnVariadic 透传 + errBrand", () => {
  it("9. envFnVariadic 透传 throws / enforceArgs（只查 required 段）", () => {
    // rest 段是 string；required 段是 number
    const fn = envFnVariadic(prim.str(), prim.str(), {
      required: [prim.num()],
      restName: "...rest",
      apply: () => strLit("joined"),
      throws: errBrand("TypeError"),
      enforceArgs: true,
    });
    expect(fn.shape.k).toBe("fn");
    expect((fn.shape as { params: string[] }).params).toEqual(["x0", "...rest"]);

    // (a) required 段确定不符 ⇒ 必抛
    const bad = applyOf(fn, [strLit("oops")]) as AbsApplyResult;
    expect(isAbsApplyResult(bad)).toBe(true);
    expect(bad.abs.shape.k).toBe("never");
    expect(brandName(bad.throws)).toBe("TypeError");

    // (b) required 段相符、rest 段不符 ⇒ **不**执法（变长参数只查 required 段）
    const restOnly = applyOf(fn, [numLit(1), numLit(2)]) as AbsApplyResult;
    expect(isAbsApplyResult(restOnly)).toBe(false);
    expect((restOnly as unknown as Abs).shape.k).toBe("prim");

    // (c) apply 抛异常 ⇒ 走声明的 throws 面
    const boom = envFnVariadic(prim.str(), prim.str(), {
      apply: () => {
        throw new RangeError("r");
      },
      throws: errBrand("TypeError"),
    });
    const out = applyOf(boom, []) as AbsApplyResult;
    expect(isAbsApplyResult(out)).toBe(true);
    expect(brandName(out.throws)).toBe("TypeError");
  });

  it("10. errBrand 产出错误品牌 Abs（与 core errorTypeAbs 同形）", () => {
    const e = errBrand("TypeError");
    expect(e.shape.k).toBe("brand");
    expect(brandName(e)).toBe("TypeError");
    expect(e.conf).toBe("exact");
  });
});
