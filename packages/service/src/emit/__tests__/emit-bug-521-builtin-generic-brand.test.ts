/**
 * Bug 521 —— `.d.ts` 把**内建泛型 brand**（`Map` / `Set` / `WeakMap`）渲染成
 * **裸名**（缺类型实参）⇒ TS2314 ⇒ 产出的 `.d.ts` 编译不过。
 *
 * 改前：
 *   export declare function mkMap(): Map;      ← TS2314
 *   export declare function mkSet(): Set;      ← TS2314
 *   export declare function mkWeak(): WeakMap; ← TS2314
 *
 * 修法：brand 渲染补一张「内建泛型 → TS 类型串」表（实例形状不带 K/V 证据
 * ⇒ 实参落到最宽的合法值；`WeakMap` / `WeakSet` 的键位受 `WeakKey` 约束 ⇒
 * `object` 而非 `unknown`）。用户类 brand 走 `declare class` 路径（Bug 517）。
 */
import { describe, it, expect } from "vitest";
import { abs, objOf, type Abs } from "@nudojs/core";
import { absToTSType } from "../dts-generator.ts";
import { tscNoEmit } from "./dts-tsc.ts";

const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "path");

describe("Bug 521 —— 内建泛型 brand 补类型实参", () => {
  it("Map / Set / WeakMap / WeakSet 渲染成带实参的泛型", () => {
    expect(absToTSType(brandOf("Map"))).toBe("Map<unknown, unknown>");
    expect(absToTSType(brandOf("Set"))).toBe("Set<unknown>");
    expect(absToTSType(brandOf("WeakMap"))).toBe("WeakMap<object, unknown>");
    expect(absToTSType(brandOf("WeakSet"))).toBe("WeakSet<object>");
  });

  it("负控制：非泛型 brand（RegExp / Date）与用户类 brand 原样保留", () => {
    expect(absToTSType(brandOf("RegExp"))).toBe("RegExp");
    expect(absToTSType(brandOf("Date"))).toBe("Date");
    expect(absToTSType(brandOf("User"))).toBe("User");
  });

  it("负控制：非法 brand 名仍落 unknown（不泄漏任意标识符）", () => {
    expect(absToTSType(brandOf("not-a-name"))).toBe("unknown");
  });

  it("产物真的能过 tsc --noEmit --strict（改前 TS2314）", () => {
    const dts = `
export declare function mkMap(): Map<unknown, unknown>;
export declare function mkSet(): Set<unknown>;
export declare function mkWeak(): WeakMap<object, unknown>;
export declare function mkWeakSet(): WeakSet<object>;
export declare function mkRe(): RegExp;
`;
    const check = tscNoEmit({ "lib.d.ts": dts });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("改前形态确实红（裸 Map / Set / WeakMap ⇒ TS2314）", () => {
    const before = `
export declare function mkMap(): Map;
export declare function mkSet(): Set;
export declare function mkWeak(): WeakMap;
`;
    const check = tscNoEmit({ "before.d.ts": before });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2314");
  });
});
