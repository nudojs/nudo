/**
 * Bug 22：`nudo:unknown-inference` 不得对**精确 undefined 返回**误报。
 *
 * undefAbs 是 unknown 形状 + lit(undefined) term——带 lit term 即有值证据，
 * 不是引擎债。`return undefined` / `void 0` / 缺省 return / 箭头空体 /
 * 可选链命中 nullish 都落此面。与 check-assign / diagnostics / promise /
 * class 四处 `!term` 同口径。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

function warnFns(src: string): string[] {
  const r = checkSource("/t/undef.js", src, pTrue, {});
  return r.issues
    .filter((i) => i.code === "nudo:unknown-inference")
    .map((i) => i.fn ?? "");
}

describe("exact undefined return is not unknown-inference (Bug 22)", () => {
  it("explicit `return undefined` / `void 0` 不报，签名显示 undefined", () => {
    const r = checkSource(
      "/t/undef.js",
      `export function f() { return undefined; }
export function g() { return void 0; }`,
      pTrue,
      {},
    );
    expect(warnFns(`export function f() { return undefined; }`)).toEqual([]);
    expect(warnFns(`export function g() { return void 0; }`)).toEqual([]);
    const sf = r.signatures.find((s) => s.name === "f");
    expect(sf!.display).toContain("undefined");
  });

  it("missing return / 箭头空体 不报", () => {
    expect(warnFns(`export function n() { const o = 1; }`)).toEqual([]);
    expect(warnFns(`export const arrow = () => {};`)).toEqual([]);
  });

  it("可选链命中 nullish → 精确 undefined，不报", () => {
    expect(warnFns(`export function g() { const o = {}; return o?.a; }`)).toEqual([]);
    expect(
      warnFns(`export function h() { const o = { a: null }; return o.a?.b; }`),
    ).toEqual([]);
  });

  it("try/catch 与分支合并的 undefined 臂不报", () => {
    expect(
      warnFns(`export function t1() { try { return undefined; } catch { return null; } }`),
    ).toEqual([]);
    expect(warnFns(`export function t3(c) { return c ? undefined : void 0; }`)).toEqual([]);
  });

  it("控制：any 返回（无约束）不报（既有行为）", () => {
    expect(warnFns(`export function k(x) { return x; }`)).toEqual([]);
  });
});
