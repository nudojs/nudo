/**
 * Bug 346 —— `@nudo:assume` 的前提槽按**形参名**作用域化。
 *
 * 旧行为：前提槽非 pTrue ⇒ **整体**关掉 callee 契约面的采用（#152 的
 * soundness 护栏）。一条与本次调用无关的惰性公理（如 `p <= q`，p/q 是调用方
 * 的局部量）会把调用方的返回类型退化成 `any`，并造出假红
 * （nudo:unproven-return / nudo:entry-may-throw）。
 *
 * 新行为：只有当**引理前提的自由变量里确实含该位被重锚成的 callee 形参名**
 * 时，才跳过这一位的采用；与调用无关的惰性引理不再整体关掉采用。
 * #152 的 soundness 护栏**保留**（引理名字与 callee 形参名撞名时仍跳过）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { sigOf } from "./nudo-constraints.ts";

const SIDE_X = `import { fn, number } from "@nudojs/core";
export const helper = fn({ x: number().ge(0) });
export const sim = fn({}, number().ge(0));
`;

/** callee 形参名 = d（与引理里的 d 撞名 ⇒ soundness 护栏必须生效） */
const SIDE_D = `import { fn, number } from "@nudojs/core";
export const helper = fn({ d: number().ge(0) });
export const sim = fn({}, number().ge(0));
`;

const SRC_CONTROL = `export function helper(x) { return x; }
export function sim(s) {
  const p = 1;
  const q = 2;
  const h = helper(s);
  return h;
}
`;

/** 惰性引理：p/q 是 sim 的局部量，与 callee 形参名 x 无交集 */
const SRC_LAZY = `export function helper(x) { return x; }
/**
 * @nudo:assume p <= q
 */
export function sim(s) {
  const p = 1;
  const q = 2;
  const h = helper(s);
  return h;
}
`;

/** 撞名引理：d 是 helper 的形参名，也是 sim 的形参 ⇒ 采用必须跳过 */
const SRC_COLLIDE = `export function helper(d) { return d; }
export function wild(w) { return w ** 2; }
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  const dd = helper(wild(undefined));
  return dd;
}
`;

function run(file: string, src: string, side: string) {
  return checkSource(file, src, pTrue, {
    loadModule: (spec: string): string | undefined =>
      spec.includes(".nudo.js") ? side : undefined,
    fromFile: file,
  });
}

describe("Bug 346 对照组：无 assume ⇒ 采用生效，返回面可证", () => {
  const r = run("/t/b346-a.js", SRC_CONTROL, SIDE_X);
  it("无 unproven-return，返回面是 number", () => {
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    expect(sigOf(r, "sim")).toContain("number");
  });
});

describe("Bug 346 惰性引理：与调用无关的前提不得关掉采用", () => {
  const r = run("/t/b346-b.js", SRC_LAZY, SIDE_X);
  it("不产生假红（unproven-return 不在）", () => {
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    expect(r.issues.some((i) => i.severity === "error")).toBe(false);
  });
  it("返回面仍是 number（旧行为退化成 any）", () => {
    expect(sigOf(r, "sim")).toContain("number");
    expect(sigOf(r, "sim")).not.toContain("any");
  });
});

describe("Bug 346 soundness：引理名字与 callee 形参名撞名 ⇒ 该位仍不采用", () => {
  const r = run("/t/b346-d.js", SRC_COLLIDE, SIDE_D);
  it("采用被跳过 ⇒ 返回面不可证（unproven-return 在）", () => {
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
  });
  it("不得出现靠引理折出的假证明（assume-relied 不在）", () => {
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
  });
});
