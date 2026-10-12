/**
 * env brand 的迭代消费分类（issue #147）。
 *
 * 背景：@nudojs/env 的 fs.readdirSync 返回 brand "Array<string | Dirent>"
 * （内层 arr）。iterabilityKind 此前把一切 brand 落到 "may"，for-of / spread
 * 恒记 `iteration over possibly non-iterable value`（npm-safe 的
 * collectPackFiles / packTarball / publishPackage 的 entry-may-throw 全部
 * 溯源于此）；Array.isArray 守卫无济于事（守卫剥的是 brand，但分类器不剥）。
 *
 * 修复口径：brand 只是名义标签，结构面在内层——内层 total（arr / tuple /
 * 字符串 prim / 带 @@iterator 的 obj）→ total；其余保持 may，且绝不下
 * definite 结论（TypedArray / Buffer 内层空 obj，原型链 @@iterator 不在
 * 内层建模——内层「确定非可迭代」不能外推到 brand 值域）。
 *
 * 元素域同口径 delegation（elemsOf / $concat sideEl）：for-of 循环变量 /
 * spread 元素取内层 arr 元素，不再折 unknown。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, abs, type Abs } from "@nudojs/core";
import { sigOf } from "./nudo-constraints.ts";

const strPrim: Abs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
const numPrim: Abs = abs({ k: "prim", type: "number" }, undefined, undefined, "path");

/** env/harvest 形态的 Array<T> brand：brand 包装 arr（readdirSync 返回型） */
const brandArr: Abs = abs(
  { k: "brand", name: "Array<string>", shape: abs({ k: "arr", element: strPrim }, undefined, undefined, "exact") },
  undefined,
  undefined,
  "exact",
);
/** 内层闭 obj 无 @@iterator 的 brand（Buffer/Dirent 形）——迭代性仍 may */
const brandClosedObj: Abs = abs(
  { k: "brand", name: "Buffer", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
  undefined,
  undefined,
  "exact",
);
/** 内层 number prim 的 brand：内层 definite 非可迭代，brand 面必须仍 may */
const brandNum: Abs = abs(
  { k: "brand", name: "Foo", shape: numPrim },
  undefined,
  undefined,
  "exact",
);
/** 内层 tuple 的 brand：spread 应保持 tuple 精确展开（元素域与长度） */
const brandTuple: Abs = abs(
  {
    k: "brand",
    name: "Array<string>",
    shape: abs(
      { k: "tuple", elements: [strPrim, strPrim] },
      undefined,
      undefined,
      "exact",
    ),
  },
  undefined,
  undefined,
  "exact",
);

const SRC = `
export function firstEntry() {
  for (const f of list) return f;
}
export function spreadCopy() {
  return [...list];
}
export function sumLen() {
  let n = 0;
  for (const f of list) n += f.length;
  return n;
}
export function concatBrandTuple() {
  return ["x", ...pair];
}
`;

function check(envGlobals: Record<string, Abs>) {
  return checkSource("/t/brand-iterability-147.js", SRC, pTrue, {
    inject: { envGlobals },
  });
}

function iterabilityWarnings(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter(
    (i) =>
      i.code === "nudo:entry-may-throw" &&
      (!fn || i.fn === fn) &&
      `${i.message} ${i.suggestion ?? ""}`.includes("possibly non-iterable"),
  ).length;
}

describe("brand 迭代消费（issue #147）", () => {
  it("Array<T> brand 的 for-of / spread 不记 possibly non-iterable", () => {
    const r = check({ list: brandArr });
    expect(iterabilityWarnings(r)).toBe(0);
  });

  it("元素域 = 内层 arr 元素（不折 unknown）", () => {
    const r = check({ list: brandArr });
    expect(sigOf(r, "firstEntry")).toContain("string");
    expect(sigOf(r, "firstEntry")).not.toContain("unknown");
    expect(sigOf(r, "spreadCopy")).toContain("string");
    expect(sigOf(r, "spreadCopy")).not.toContain("unknown");
    // 循环变量成员读级联：f.length 在 string 元素上是 number
    expect(sigOf(r, "sumLen")).toContain("number");
    expect(sigOf(r, "sumLen")).not.toContain("unknown");
  });

  it("内层闭 obj（无 @@iterator）的 brand 仍记 may（不误升 total）", () => {
    const r = check({ list: brandClosedObj });
    expect(iterabilityWarnings(r)).toBeGreaterThan(0);
  });

  it("内层 definite 非可迭代（number prim）的 brand 保持 may，不硬抛 TypeError", () => {
    const r = check({ list: brandNum });
    // may 路径：软记录 possibly non-iterable；definite 路径会是 hard
    // NudoThrow（cause 为 throw TypeError，非 possibly non-iterable）
    expect(iterabilityWarnings(r)).toBeGreaterThan(0);
  });

  it("内层 tuple 的 brand：spread 保持 tuple 形状（不折 arr）", () => {
    const r = check({ pair: brandTuple });
    expect(iterabilityWarnings(r)).toBe(0);
    const sig = sigOf(r, "concatBrandTuple");
    // tuple 形状：元素在括号内逗号分隔；arr 形状会显示 "string[]"
    expect(sig).toContain("[");
    expect(sig).not.toContain("[]");
  });
});
