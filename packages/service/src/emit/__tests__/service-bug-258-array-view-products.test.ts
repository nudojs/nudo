/**
 * BUG-258（产物面）—— **数组视图**（`Shape.view === "array"`，RegExpExecArray
 * 等）在四个产物面必须投影成**数组**，与具名 guard / standard 判据同口径。
 *
 * 修前：数组性只活在 Shape 之外的语义里 ⇒ 产物面一律按普通对象投影：
 * - dts：`{ 0: "abc"; 1: "b"; length: 2; index: 0; … }` ⇒ 消费方 `.map` /
 *   下标元组读全报 TS2339；
 * - guard：头部要求 `!Array.isArray(v)` ⇒ **拒绝**实现自己的返回值（假红）；
 * - standard：`expected object, got array` ⇒ 拒绝真实值；
 * - zod：`z.object({...})` 同口径 ⇒ 拒绝真实值。
 *
 * 修后判据（四面同源，单一事实源 = Shape facet）：
 * - dts → 下标槽成元组、`length` 由元组隐含、其余自有槽（index / input /
 *   groups）成交集里的对象部分；
 * - guard → `Array.isArray(v)`（槽判据不变：原生 exec 结果的槽全是自有属性）；
 * - standard → 库函数版与产物版都要求 `Array.isArray(value)`；
 * - zod → `z.tuple([...])`（`z.object` 换掉）。
 *
 * 原生锚定值由 node 实测：`/a(b)c/.exec("abc")` 的 0 / 1 / length / index /
 * input / groups 全是**自有**属性，`length` 非枚举。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import type { Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";
import { dtsModuleSurface, projectFunctionDts } from "../dts-generator.ts";
import { absToSchemaNode, absToZodSchemaModule } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

const SRC = `export function m() {
  return /a(b)c/.exec("abc");
}
`;

/** 被测函数（唯一的出口 = 数组视图） */
function viewAbs(): Abs {
  const fn = analyzeFile("/test/array-view.ts", SRC).functions.find((x) => x.name === "m")!;
  const a = fn.combinedAbs;
  if (a === undefined) throw new Error("combinedAbs missing");
  return a;
}

/** node 原生值（真数组 exotic，槽全是自有属性） */
const nativeValue = (): unknown => /a(b)c/.exec("abc");

/** 与原生值槽面**逐字同形**的普通对象（旧 obj 判据会放行它） */
const lookalikeObject = (): unknown => ({
  0: "abc",
  1: "b",
  length: 2,
  index: 0,
  input: "abc",
  groups: undefined,
});

describe("BUG-258 产物面：数组视图投影成数组（四面同判据）", () => {
  it('形状前提：combinedAbs 是 obj 形状 + view: "array"', () => {
    const a = viewAbs();
    expect(a.shape.k).toBe("obj");
    expect(a.shape.k === "obj" ? a.shape.view : undefined).toBe("array");
  });

  it("dts 面：元组 + 其余自有槽的交集（不再摊平成对象字面量类型）", () => {
    const fn = analyzeFile("/test/array-view.ts", SRC).functions.find((x) => x.name === "m")!;
    const lines = projectFunctionDts(fn, undefined, dtsModuleSurface(SRC)).lines.join("\n");
    // 元素槽 → 元组
    expect(lines).toContain('["abc", "b"]');
    // 其余自有槽 → 交集对象部分（length 由元组隐含，不重复写）
    expect(lines).toMatch(/& \{ index: 0; input: "abc"; groups: undefined \}/);
    // 修前形态（对象字面量类型）不得再出现
    expect(lines).not.toMatch(/\{ 0: "abc"; 1: "b"; length: 2/);
  });

  it("guard 面：真实数组放行、同形普通对象拒绝（头部判据是 Array.isArray）", () => {
    const expr = denoteGuard(viewAbs(), "value");
    expect(expr).toContain("Array.isArray(value)");
    expect(expr).not.toContain("!Array.isArray(value)");
    const guard = new Function("value", `return (${expr});`) as (v: unknown) => boolean;
    expect(guard(nativeValue())).toBe(true);
    expect(guard(lookalikeObject())).toBe(false);
    // 元素不对 ⇒ 拒绝（元组位判据仍在）
    expect(guard(["abc", "z"])).toBe(false);
    // 缺 index / input 等自有槽 ⇒ 拒绝（存在性子句仍在）
    expect(guard(["abc", "b"])).toBe(false);
  });

  it("standard 面（库函数 + 产物）：接受真实数组、拒绝同形对象 / 缺槽数组", async () => {
    const a = viewAbs();
    const ok = (v: unknown): boolean => validateSchemaNode(absToSchemaNode(a).node, v).issues === undefined;
    expect(ok(nativeValue())).toBe(true);
    expect(ok(lookalikeObject())).toBe(false);
    expect(ok(["abc", "b"])).toBe(false);

    const { source } = absToStandardSchema(a, { name: "m_out" });
    // facet 必须随节点序列化进产物（丢了它产物按普通对象判据拒绝真实数组）
    expect(source).toContain('"arrayView":true');
    const mod = await loadGeneratedModule(source);
    const product = (v: unknown): boolean =>
      mod.m_out!["~standard"].validate(v).issues === undefined;
    expect(product(nativeValue())).toBe(true);
    expect(product(lookalikeObject())).toBe(false);
  });

  it("zod 面：`z.tuple([...])`（`z.object` 会把真实数组判成违规）", () => {
    const { source, dropped } = absToZodSchemaModule({ mOutput: viewAbs() });
    expect(source).toContain('z.tuple([z.literal("abc"), z.literal("b")])');
    expect(source).not.toContain("z.object(");
    // 非下标槽不静默丢：进台账（z.tuple 不校验它们）
    expect(dropped.join("\n")).toContain("non-index slots not validated by z.tuple");
  });

  it("多见证 join：两条数组视图见证 ⇒ facet 仍在；混入普通对象 ⇒ facet 消失", () => {
    const multi = `/**
 * @nudo:case "one" ("abc")
 * @nudo:case "two" ("aXbc")
 */
export function m2(s) { return /a(b)c/.exec(s); }
`;
    const fn2 = analyzeFile("/test/array-view-multi.js", multi).functions.find((f) => f.name === "m2")!;
    const joined = fn2.combinedAbs!;
    expect(joined.shape.k).toBe("obj");
    expect(joined.shape.k === "obj" ? joined.shape.view : undefined).toBe("array");

    const mixed = `/**
 * @nudo:case "arr" ("abc")
 * @nudo:case "obj" ("")
 */
export function m3(s) { return s === "" ? { a: 1 } : /a(b)c/.exec(s); }
`;
    const fn3 = analyzeFile("/test/array-view-mixed.js", mixed).functions.find((f) => f.name === "m3")!;
    const mixedJoin = fn3.combinedAbs!;
    expect(mixedJoin.shape.k === "obj" ? mixedJoin.shape.view : undefined).not.toBe("array");
  });
});
