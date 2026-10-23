/**
 * Bug 1045 后续（S16）：sum 里的**构造器成员**（fn 形状）被误判「确定没有此方法」。
 *
 * 背景（族 36 / 片 S2 把 `@nudo:env` 多名合并改成**并集**引出的精度回退）：
 * 合并后 `Response` 是两个构造器声明的 **sum** ⇒ core 的 `$invoke` sum 臂用
 * `memberLikelyHasMethod` 过滤成员，而它**没有 fn 分支** ⇒ fn 成员一律落
 * 「确定没有此方法」⇒ 被跳过 ⇒ 合并 fn 全局的**静态成员调用**
 * （`Response.json(x)`）折 `unknown`（`mk(x: any) => unknown` + 一条
 * `nudo:unknown-inference` warning）。修前 `node, web` 顺序下 `mk` 是 web 的
 * Response 对象面 ⇒ 这是**精度回退**。
 *
 * 病灶：`packages/core/src/algebra/exec/class/invoke.ts` 的
 * `memberLikelyHasMethod` —— 旧判据只有 prim / brand / obj / arr / tuple / eff
 * 分支，fn 落尾部 `return false`。
 *
 * 修法：补 **fn 分支**——判据改为「fn 的**静态槽**（dual-facet：构造器的静态
 * 成员挂在 fn 的 `shape.slots` 上）里有没有这个名」：
 * - 静态槽里有 ⇒ 可派发；
 * - 静态槽**明确不含** ⇒ 确定没有（原生读 undefined ⇒ 调用 TypeError ⇒ 记
 *   may-throw + 跳过该成员——该分支不贡献值）；
 * - fn **没有静态面模型**（`shape.slots` 缺席）⇒ 判据不足 ⇒ **保守放行**
 *   （不可判不可抛：宁可多派发一次，不可凭空造 may-throw ⇒ 假红）。
 *
 * 断言面：
 * 1. fn⊕fn 上调用**两臂都有**的静态成员 ⇒ 值域是**两臂返回域之并**（不是 unknown）；
 * 2. fn⊕fn 上调用**只有一臂有**的静态成员 ⇒ 该臂派发；另一臂按原生记 may-throw
 *    （**不要**把两臂都当有）；
 * 3. 负控：fn 静态面模型为**空**（确实没有该静态成员）⇒ 仍判「确定没有」（记
 *    may-throw + 不贡献值）；
 * 4. 负控：fn **无**静态面模型 ⇒ 判据不足 ⇒ 保守放行（**不记** may-throw）；
 * 5. 负控：Function.prototype / Object.prototype 名（toString）⇒ 沿函数对象恒
 *    可得 ⇒ 不得判缺席（不记 may-throw）；
 * 6. 负控：prim / brand / obj / arr / tuple / eff 的既有 sum 派发行为**逐字不变**；
 * 7. 端到端：env 全局是 fn⊕fn sum 时，`Response.json(x)` 的签名**不是 unknown**。
 */
import { describe, expect, it } from "vitest";
import { absFunction } from "../abs-fn.ts";
import { litValue, numLit, strLit, type Abs } from "../abs.ts";
import { checkSource } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetCheckSourceMemo } from "../check-memo.ts";
import { joinAbs } from "../objects.ts";
import { pTrue } from "../pred.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  throwPayloadOf,
  type MayThrowEffect,
} from "../may-throw.ts";
import { $invoke } from "../exec/class/invoke.ts";

/** 造一个「构造器」fn Abs：静态成员挂在 shape.slots 上（dual-facet 事实源） */
function ctorFn(name: string, statics: Record<string, Abs>): Abs {
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(statics)) slots[k] = { value: v };
  return absFunction(["x"], { apply: () => strLit(name) }, { name, ctor: true, slots });
}

/** 静态成员（返回值域可辨：字符串 / 数字） */
const strMember = (v: string): Abs => absFunction(["body"], { apply: () => strLit(v) });
const numMember = (v: number): Abs => absFunction(["body"], { apply: () => numLit(v) });

/** 调一次 $invoke 并抓 may-throw 效果（与 eval-helpers.ts 的 effects 同机制） */
function invokeAndEffects(
  recv: Abs,
  method: string,
  args: Abs[] = [],
): { result?: Abs; thrown?: Abs; throws: MayThrowEffect[] } {
  const eff: MayThrowEffect[] = [];
  let result: Abs | undefined;
  let thrown: Abs | undefined;
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => eff.push(e));
    try {
      result = $invoke(recv, method, args);
    } catch (e) {
      thrown = throwPayloadOf(e);
    } finally {
      setMayThrowCollector(null);
    }
  });
  return { result, thrown, throws: eff };
}

/** sum 成员的字面量值（字符串化后排序——与成员顺序无关） */
function sumMemberLiterals(a: Abs): string[] {
  const s = a.shape;
  if (s.k !== "sum") return [];
  return s.members
    .map((m) => {
      const lv = litValue(m);
      return lv.ok ? JSON.stringify(lv.value) : "(non-lit)";
    })
    .sort();
}

describe("Bug 1045 后续（S16）: sum 里的 fn（构造器）成员的静态成员派发", () => {
  it("fn⊕fn：两臂都有的静态成员 ⇒ 值域是两臂返回域之并（不是 unknown）", () => {
    const a = ctorFn("CtorA", { json: strMember("A-json") });
    const b = ctorFn("CtorB", { json: numMember(42) });
    const { result, thrown, throws } = invokeAndEffects(joinAbs(a, b), "json");
    expect(thrown).toBeUndefined();
    expect(throws).toEqual([]); // 两臂都有 ⇒ 原生不抛
    expect(result?.shape.k).toBe("sum");
    expect(sumMemberLiterals(result!)).toEqual(['"A-json"', "42"]);
  });

  it("fn⊕fn：只有一臂有的静态成员 ⇒ 该臂派发 + 另一臂按原生记 may-throw", () => {
    const a = ctorFn("CtorA", { onlyA: strMember("A-only") });
    const b = ctorFn("CtorB", { json: numMember(42) });
    const { result, thrown, throws } = invokeAndEffects(joinAbs(a, b), "onlyA");
    expect(thrown).toBeUndefined();
    // 该臂派发 ⇒ 值域是它的返回域（不是 unknown）
    expect(litValue(result!)).toEqual({ ok: true, value: "A-only" });
    // 另一臂按原生记 may-throw（且**只**记缺该成员的那一臂）
    expect(throws.length).toBe(1);
    expect(throws[0]?.kind).toBe("TypeError");
    expect(throws[0]?.recv).toBe("CtorB");
    expect(throws[0]?.name).toBe("onlyA");
  });

  it("fn⊕fn：反向（只有 B 有）⇒ 同样只派发有的一臂", () => {
    const a = ctorFn("CtorA", { json: strMember("A-json") });
    const b = ctorFn("CtorB", { onlyB: numMember(7) });
    const { result, throws } = invokeAndEffects(joinAbs(a, b), "onlyB");
    expect(litValue(result!)).toEqual({ ok: true, value: 7 });
    expect(throws.length).toBe(1);
    expect(throws[0]?.recv).toBe("CtorA");
  });

  it("负控：fn 静态面模型为**空**（确实没有该静态成员）⇒ 仍判「确定没有」", () => {
    const bare = ctorFn("BareCtor", {}); // 静态面模型在场且为空
    const b = ctorFn("CtorB", { json: numMember(42) });
    const { result, throws } = invokeAndEffects(joinAbs(bare, b), "json");
    // 缺该成员的那一臂被跳过（不贡献值）+ 记 may-throw
    expect(throws.length).toBe(1);
    expect(throws[0]?.kind).toBe("TypeError");
    expect(throws[0]?.recv).toBe("BareCtor");
    expect(litValue(result!)).toEqual({ ok: true, value: 42 });
  });

  it("负控：fn **没有**静态面模型（判据不足）⇒ 保守放行（不记 may-throw）", () => {
    const noFace = absFunction(["x"], { apply: () => strLit("nf") }, { name: "NoFace", ctor: true });
    const b = ctorFn("CtorB", { json: numMember(42) });
    const { throws } = invokeAndEffects(joinAbs(noFace, b), "json");
    // 判不准 ≠ 确定没有 ⇒ 不得凭空造 may-throw
    expect(throws).toEqual([]);
  });

  it("负控：Function.prototype 名（toString）沿函数对象恒可得 ⇒ 不判缺席", () => {
    const a = ctorFn("CtorA", { json: strMember("A-json") });
    const b = ctorFn("CtorB", { json: numMember(42) });
    const { throws } = invokeAndEffects(joinAbs(a, b), "toString");
    expect(throws).toEqual([]);
  });

  it("负控：prim / brand / obj / arr / tuple / eff 的既有 sum 派发行为逐字不变", () => {
    // 成员必须**可区分**（同形 join 会并成单个 prim / obj ⇒ 走不到 sum 臂）
    const str2 = joinAbs(strLit("a"), strLit("b"));
    const num2 = joinAbs(numLit(1), numLit(2));
    expect(str2.shape.k).toBe("sum");
    expect(num2.shape.k).toBe("sum");
    // prim：表内方法照常派发（两臂都贡献值）
    const up = invokeAndEffects(str2, "toUpperCase");
    expect(up.throws).toEqual([]);
    expect(up.result?.shape.k).toBe("sum");
    expect(sumMemberLiterals(up.result!)).toEqual(['"A"', '"B"']);
    // prim：表外方法 ⇒ 每个成员确定没有 ⇒ 各记一条 may-throw + 跳过（值域塌 unknown）
    const bad = invokeAndEffects(str2, "toFixed");
    expect(bad.throws.length).toBe(2);
    expect(bad.throws.every((e) => e.kind === "TypeError" && e.recv === "string")).toBe(true);
    expect(bad.result?.shape.k).toBe("unknown");
    // number 的 toFixed 在表内 ⇒ 派发（两臂各贡献一个字符串）
    const tf = invokeAndEffects(num2, "toFixed", [numLit(1)]);
    expect(tf.throws).toEqual([]);
    expect(tf.result?.shape.k).toBe("sum");
    expect(sumMemberLiterals(tf.result!)).toEqual(['"1.0"', '"2.0"']);
    // obj：缺槽成员 ⇒ 原生 TypeError（硬抛，catch 可吸收）
    const objSum = joinAbs(
      { shape: { k: "obj", slots: { a: { value: numLit(1) } } }, conf: "exact" } as Abs,
      { shape: { k: "obj", slots: { b: { value: numLit(2) } } }, conf: "exact" } as Abs,
    );
    expect(objSum.shape.k).toBe("sum");
    const obj = invokeAndEffects(objSum, "nope");
    expect(obj.thrown?.shape).toMatchObject({ k: "brand", name: "TypeError" });
    // tuple：join 在 Array.prototype 面 ⇒ 派发
    const tupSum = joinAbs(
      { shape: { k: "tuple", elements: [numLit(1)] }, conf: "exact" } as Abs,
      { shape: { k: "tuple", elements: [strLit("x")] }, conf: "exact" } as Abs,
    );
    const tup = invokeAndEffects(tupSum, "join");
    expect(tup.throws).toEqual([]);
    expect(tup.result?.shape.k).toBe("sum");
    expect(sumMemberLiterals(tup.result!)).toEqual(['"1"', '"x"']);
    // eff（promise）：then 派发
    const effSum = joinAbs(
      { shape: { k: "eff", eff: "promise", inner: numLit(1) }, conf: "exact" } as Abs,
      { shape: { k: "eff", eff: "promise", inner: strLit("x") }, conf: "exact" } as Abs,
    );
    const eff = invokeAndEffects(effSum, "then");
    expect(eff.throws).toEqual([]);
    expect(eff.result?.shape.k).toBe("sum");
    expect(
      (eff.result!.shape as { members: Abs[] }).members.every((m) => m.shape.k === "eff"),
    ).toBe(true);
    // brand：内建 brand 表外名 ⇒ 原生 TypeError（硬抛）
    const brandSum = joinAbs(
      { shape: { k: "brand", name: "Map", shape: { shape: { k: "obj", slots: { a: { value: numLit(1) } } }, conf: "exact" } }, conf: "exact" } as Abs,
      { shape: { k: "brand", name: "Map", shape: { shape: { k: "obj", slots: { b: { value: numLit(2) } } }, conf: "exact" } }, conf: "exact" } as Abs,
    );
    const brand = invokeAndEffects(brandSum, "nope");
    expect(brand.thrown?.shape).toMatchObject({ k: "brand", name: "TypeError" });
  });

  it("端到端：env 全局是 fn⊕fn sum ⇒ Response.json(x) 的签名不是 unknown", () => {
    const a = ctorFn("Response", { json: strMember("A-json") });
    const b = ctorFn("Response", { json: numMember(42) });
    resetGeneralizeMemo();
    resetCheckSourceMemo();
    const r = checkSource("/t/s16-fn-sum.js", `export function mk(x) {\n  return Response.json(x);\n}\n`, pTrue, {
      inject: { envGlobals: { Response: joinAbs(a, b) } },
    });
    const sig = r.signatures.find((s) => s.name === "mk");
    expect(sig?.display ?? "(missing)").not.toContain("unknown");
    // 合并 fn 全局的静态成员调用不再触发 unknown-inference
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference").length).toBe(0);
  });
});
