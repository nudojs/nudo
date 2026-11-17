/**
 * `envFn` / `envFnVariadic` 的 throws 通道 + enforceArgs 执法：
 * 原生异常 ⇒ may-throw；AbsApplyResult 透传；裸 Abs ⇒ 不抛；
 * 实参确定不符 ⇒ 必抛；抽象 ⇒ may-throw；relation 面同样承载 throws。
 */
import { describe, it, expect } from "vitest";
import {
  $call, $new, getFnImpl, isAbsApplyResult, isNudoThrow, makeAbsApplyResult, numLit,
  runWithLoopExits, strLit, takeThrowExits, unknown as absUnknown, type Abs, type AbsApplyResult,
} from "@nudojs/core";
import { envFn, envFnVariadic, errBrand, prim, type EnvApplyImpl } from "../abs-helpers.ts";

type ApplyOut = ReturnType<NonNullable<NonNullable<ReturnType<typeof getFnImpl>>["apply"]>>;

function applyOf(fn: Abs, args: Abs[]): ApplyOut {
  const impl = getFnImpl(fn);
  expect(impl?.apply).toBeTypeOf("function");
  return impl!.apply!(args);
}

const brandName = (a: Abs): string | undefined => (a.shape.k === "brand" ? (a.shape as { name: string }).name : undefined);

function callSite(fn: Abs, args: Abs[]): { value?: Abs; exits: Abs[]; threw?: unknown } {
  return runWithLoopExits(() => {
    try {
      return { value: $call(fn, args), exits: takeThrowExits() };
    } catch (e) {
      return { exits: takeThrowExits(), threw: e };
    }
  });
}

describe("envFn apply throws 通道", () => {
  it("原生异常 ⇒ may-throw；AbsApplyResult 透传；裸 Abs ⇒ 不抛", () => {
    const throwing = envFn([prim.str()], prim.str(), () => { throw new TypeError("boom"); });
    const out = applyOf(throwing, [strLit("x")]) as AbsApplyResult;
    expect(isAbsApplyResult(out)).toBe(true);
    expect(out.abs.shape.k).not.toBe("never");
    expect(brandName(out.throws)).toBe("TypeError");
    const site = callSite(throwing, [strLit("x")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("TypeError");

    const errAbs = errBrand("RangeError");
    const okAbs = numLit(42);
    const passthrough = envFn([], prim.num(), () => makeAbsApplyResult(okAbs, errAbs));
    const full = applyOf(passthrough, []) as AbsApplyResult;
    expect(full.abs).toBe(okAbs);
    expect(full.throws).toBe(errAbs);
    expect(callSite(passthrough, []).exits[0]).toBe(errAbs);

    const bare = envFn([], prim.num(), () => numLit(7));
    const bareOut = applyOf(bare, []);
    expect(isAbsApplyResult(bareOut)).toBe(false);
    expect((bareOut as Abs).shape.k).toBe("prim");
    expect(callSite(bare, []).exits).toHaveLength(0);
  });

  it("enforceArgs：确定不符必抛；抽象实参 may-throw；相符零抛", () => {
    const fn = envFn([prim.str()], prim.str(), () => strLit("ok"), { enforceArgs: true });

    const bad = applyOf(fn, [numLit(1)]) as AbsApplyResult;
    expect(bad.abs.shape.k).toBe("never");
    expect(bad.throws.shape.k).not.toBe("never");
    expect(brandName(bad.throws)).toBe("TypeError");
    const badSite = callSite(fn, [numLit(1)]);
    expect(badSite.threw).toBeTruthy();
    expect(isNudoThrow(badSite.threw)).toBe(true);

    const unknownOut = applyOf(fn, [absUnknown]) as AbsApplyResult;
    expect(unknownOut.abs.shape.k).not.toBe("never");
    expect(brandName(unknownOut.throws)).toBe("TypeError");
    const unknownSite = callSite(fn, [absUnknown]);
    expect(unknownSite.threw).toBeUndefined();
    expect(unknownSite.exits).toHaveLength(1);

    const ok = applyOf(fn, [strLit("x")]);
    expect(isAbsApplyResult(ok)).toBe(false);
    expect(callSite(fn, [strLit("x")]).exits).toHaveLength(0);
  });

  it("opts.throws 优先于异常名推断", () => {
    const declared = errBrand("TypeError");
    const throwing: EnvApplyImpl = () => {
      const e = new Error("bad");
      e.name = "InvalidCharacterError";
      throw e;
    };
    const withDecl = applyOf(envFn([], prim.str(), throwing, { throws: declared }), []) as AbsApplyResult;
    expect(withDecl.throws).toBe(declared);
    expect(brandName(withDecl.throws)).toBe("TypeError");
    const inferred = applyOf(envFn([], prim.str(), throwing), []) as AbsApplyResult;
    expect(brandName(inferred.throws)).toBe("InvalidCharacterError");
  });

  it("name / ctor / slots / params / conf 在 relation 与 apply 两面都不回归", () => {
    const opts = { name: "Foo", ctor: true, params: ["a"], conf: "path" as const, slots: { bar: prim.bool() } };
    const rel = envFn([prim.num()], prim.num(), undefined, opts);
    const fn = envFn([prim.num()], prim.num(), () => numLit(1), { ...opts, name: "Bar", slots: { baz: prim.bool() } });
    for (const [node, name, slot] of [[rel, "Foo", "bar"], [fn, "Bar", "baz"]] as const) {
      const shape = node.shape as { name?: string; ctor?: boolean; params: string[]; slots?: Record<string, { value: Abs }> };
      expect(shape.name).toBe(name);
      expect(shape.ctor).toBe(true);
      expect(shape.params).toEqual(["a"]);
      expect(node.conf).toBe("path");
      expect(shape.slots?.[slot]).toBeTruthy();
    }
    const shape = fn.shape as { paramTypes?: Abs[]; returnType?: Abs };
    expect(shape.paramTypes?.[0]?.shape.k).toBe("prim");
    expect(shape.returnType?.shape.k).toBe("prim");
  });
});

describe("envFnVariadic / errBrand", () => {
  it("变长声明只执法 required 段；apply 抛出走声明 throws；errBrand 形态正确", () => {
    const fn = envFnVariadic(prim.str(), prim.str(), {
      required: [prim.num()], restName: "...rest", apply: () => strLit("joined"),
      throws: errBrand("TypeError"), enforceArgs: true,
    });
    expect((fn.shape as { params: string[] }).params).toEqual(["x0", "...rest"]);

    const bad = applyOf(fn, [strLit("oops")]) as AbsApplyResult;
    expect(bad.abs.shape.k).toBe("never");
    expect(brandName(bad.throws)).toBe("TypeError");

    const restOnly = applyOf(fn, [numLit(1), numLit(2)]);
    expect(isAbsApplyResult(restOnly)).toBe(false);
    expect((restOnly as unknown as Abs).shape.k).toBe("prim");

    const boom = envFnVariadic(prim.str(), prim.str(), {
      apply: () => { throw new RangeError("r"); }, throws: errBrand("TypeError"),
    });
    expect(brandName((applyOf(boom, []) as AbsApplyResult).throws)).toBe("TypeError");

    const e = errBrand("TypeError");
    expect(e.shape.k).toBe("brand");
    expect(brandName(e)).toBe("TypeError");
    expect(e.conf).toBe("exact");
  });
});

describe("relation 面 throws 通道", () => {
  it("声明 throws 记 may-throw；未声明零抛；variadic 同口径；ctor 的 new 面同径", () => {
    const declared = envFn([prim.str()], prim.str(), undefined, { throws: errBrand("URIError") });
    expect(getFnImpl(declared)?.apply).toBeUndefined();
    const site = callSite(declared, [strLit("x")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("URIError");
    expect(site.value!.shape).toEqual({ k: "prim", type: "string" });

    const plain = envFn([prim.str()], prim.str());
    expect(callSite(plain, [strLit("x")]).exits).toHaveLength(0);

    const variadic = envFnVariadic(prim.str(), prim.str(), { required: [prim.str()], restName: "...rest", throws: errBrand("TypeError") });
    expect(brandName(callSite(variadic, [strLit("a"), strLit("b")]).exits[0]!)).toBe("TypeError");

    const ctor = envFn([prim.str()], errBrand("URLLike"), undefined, { params: ["input"], ctor: true, throws: errBrand("TypeError") });
    const r = runWithLoopExits(() => {
      try {
        return { value: $new(ctor, [strLit("x")]), exits: takeThrowExits() };
      } catch (e) {
        return { exits: takeThrowExits(), threw: e };
      }
    });
    expect(r.threw).toBeUndefined();
    expect(r.exits).toHaveLength(1);
    expect(brandName(r.exits[0]!)).toBe("TypeError");
    expect(r.value!.shape.k).toBe("brand");
  });
});
