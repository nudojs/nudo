/**
 * 族 29 · Bug 877：`node:path` 族的**实参类型从不被执法** ⇒
 * `path.join(123)` / `path.isAbsolute(123)` / `path.basename("/x/y.txt", 5)`
 * 这类原生**必抛 TypeError** 的调用被判「不抛」，还给出原生产不出的
 * **自信精确字面量**（`basename("/x/y.txt", 5)` → `"y.txt"`——坏实参被静默
 * 丢弃后走「无后缀」分支）。
 *
 * 修法：path 族实参执法闸——
 * - 实参**确定**非字符串 ⇒ **必抛** TypeError（原生必抛）；
 * - 实参**抽象**（unknown / any / 非 exact）⇒ **may-throw** TypeError；
 * - `undefined` 字面量：必填位 ⇒ 必抛；可选位（`basename(p, undefined)`）⇒
 *   视作未传（原生不抛）。
 *
 * 原生 oracle（Node v26）：见每个 case 的 `native` 回调（测试内直接对拍）。
 */
import { describe, it, expect } from "vitest";
import { formatShape, numLit, strLit, type Abs } from "@nudojs/core";
import nodePath from "node:path";
import { applyOut, brandName, callSite, envMember } from "./env-bug-s3-helpers.ts";

/** `undefined` 字面量（引擎里是 unknown shape + lit(undefined)）。 */
const UNDEF: Abs = {
  shape: { k: "unknown" },
  term: { op: "lit", value: undefined },
  conf: "exact",
};

/** apply 原始返回值的 abs 面（裸 Abs 或 AbsApplyResult 的 abs）。 */
function absFace(fn: Abs, args: Abs[]): Abs {
  const out = applyOut(fn, args) as Abs | { abs: Abs };
  if (out && typeof out === "object" && "abs" in (out as Record<string, unknown>)) {
    return (out as { abs: Abs }).abs;
  }
  return out as Abs;
}

/** apply 原始返回值的 throws 面。 */
function throwsFace(fn: Abs, args: Abs[]): Abs | undefined {
  const out = applyOut(fn, args) as { throws?: Abs };
  return out?.throws;
}

type Case = {
  name: string;
  member: string;
  args: Abs[];
  native: () => unknown;
};

const BAD: Case[] = [
  { name: "join(123)", member: "join", args: [numLit(123)], native: () => nodePath.join(123) },
  { name: "join('a', 1)", member: "join", args: [strLit("a"), numLit(1)], native: () => nodePath.join("a", 1) },
  { name: "basename('/x/y.txt', 5)", member: "basename", args: [strLit("/x/y.txt"), numLit(5)], native: () => nodePath.basename("/x/y.txt", 5) },
  { name: "dirname(123)", member: "dirname", args: [numLit(123)], native: () => nodePath.dirname(123) },
  { name: "extname(456)", member: "extname", args: [numLit(456)], native: () => nodePath.extname(456) },
  { name: "isAbsolute(123)", member: "isAbsolute", args: [numLit(123)], native: () => nodePath.isAbsolute(123) },
  { name: "relative('/a', 7)", member: "relative", args: [strLit("/a"), numLit(7)], native: () => nodePath.relative("/a", 7) },
  { name: "normalize(789)", member: "normalize", args: [numLit(789)], native: () => nodePath.normalize(789) },
  { name: "parse(123)", member: "parse", args: [numLit(123)], native: () => nodePath.parse(123) },
  { name: "resolve(789)", member: "resolve", args: [numLit(789)], native: () => nodePath.resolve(789) },
  { name: "format(123)", member: "format", args: [numLit(123)], native: () => nodePath.format(123) },
];

const GOOD: Case[] = [
  { name: "join('a','b')", member: "join", args: [strLit("a"), strLit("b")], native: () => nodePath.join("a", "b") },
  { name: "basename('/x/y.txt')", member: "basename", args: [strLit("/x/y.txt")], native: () => nodePath.basename("/x/y.txt") },
  { name: "basename('/x/y.txt', undefined)", member: "basename", args: [strLit("/x/y.txt"), UNDEF], native: () => nodePath.basename("/x/y.txt", undefined) },
  { name: "dirname('/x/y.txt')", member: "dirname", args: [strLit("/x/y.txt")], native: () => nodePath.dirname("/x/y.txt") },
  { name: "extname('/x/y.txt')", member: "extname", args: [strLit("/x/y.txt")], native: () => nodePath.extname("/x/y.txt") },
  { name: "isAbsolute('/x')", member: "isAbsolute", args: [strLit("/x")], native: () => nodePath.isAbsolute("/x") },
  { name: "relative('/a','/b')", member: "relative", args: [strLit("/a"), strLit("/b")], native: () => nodePath.relative("/a", "/b") },
  { name: "normalize('/x/./y')", member: "normalize", args: [strLit("/x/./y")], native: () => nodePath.normalize("/x/./y") },
  { name: "parse('/x/y.txt')", member: "parse", args: [strLit("/x/y.txt")], native: () => nodePath.parse("/x/y.txt") },
];

describe("Bug 877 · node:path 族实参类型执法", () => {
  it("1. 实参确定非字符串 ⇒ 必抛 TypeError（原生 oracle 同样必抛）", () => {
    for (const c of BAD) {
      // 原生 oracle：必抛 TypeError
      expect(() => c.native(), c.name).toThrow(TypeError);

      const site = callSite(envMember("node:path", c.member), c.args);
      // 必抛 ⇒ NudoThrow 冒泡（不是 may-throw）
      expect(site.threw, `${c.name} 应必抛`).toBeTruthy();
      expect(site.value, `${c.name} 不应有值面`).toBeUndefined();
    }
  });

  it("2. 必抛的 throws 面品牌是 TypeError、值面是 never", () => {
    for (const c of BAD) {
      const fn = envMember("node:path", c.member);
      expect(absFace(fn, c.args).shape.k, `${c.name} 的值面`).toBe("never");
      expect(brandName(throwsFace(fn, c.args)), `${c.name} 的 throws 品牌`).toBe("TypeError");
    }
  });

  it("3. 坏实参**不得**折出自信精确字面量（basename 旧面折 'y.txt'）", () => {
    const fn = envMember("node:path", "basename");
    const site = callSite(fn, [strLit("/x/y.txt"), numLit(5)]);
    // 旧面：值面 = "y.txt"（原生抛 TypeError，压根没有这个值）
    expect(site.value).toBeUndefined();
    expect(absFace(fn, [strLit("/x/y.txt"), numLit(5)]).shape.k).toBe("never");
  });

  it("4. 合法实参照旧折叠（不回归）", () => {
    for (const c of GOOD) {
      const native = c.native();
      const site = callSite(envMember("node:path", c.member), c.args);
      expect(site.threw, `${c.name} 不该抛`).toBeUndefined();
      expect(site.exits, `${c.name} 不该有 throw exit`).toHaveLength(0);
      if (typeof native === "string") {
        expect(formatShape(site.value!), `${c.name} 的值`).toBe(JSON.stringify(native));
      } else {
        // 对象类结果（parse）：只要有值面且不是 never
        expect(site.value, `${c.name} 应有值面`).toBeDefined();
        expect(site.value!.shape.k).not.toBe("never");
      }
    }
  });

  it("5. 抽象实参 ⇒ may-throw TypeError（不是必抛）", () => {
    const fn = envMember("node:path", "join");
    const out = absFace(fn, [{ shape: { k: "unknown" }, conf: "partial" } as Abs]);
    expect(out.shape.k, "抽象实参不应变成必抛").not.toBe("never");
    expect(brandName(throwsFace(fn, [{ shape: { k: "unknown" }, conf: "partial" } as Abs]))).toBe("TypeError");
  });

  it("6. posix / win32 平台路径对象同口径（原生 posix.join(123) 也必抛）", () => {
    expect(() => nodePath.posix.join(123)).toThrow(TypeError);
    const posix = envMember("node:path", "posix");
    expect(posix.shape.k).toBe("brand");
    const inner = (posix.shape as { shape: Abs }).shape;
    const join = (inner.shape as { slots: Record<string, { value: Abs }> }).slots["join"]!.value;
    const site = callSite(join, [numLit(123)]);
    expect(site.threw, "path.posix.join(123) 应必抛").toBeTruthy();
  });
});
