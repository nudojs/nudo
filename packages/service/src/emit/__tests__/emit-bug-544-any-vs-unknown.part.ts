/**
 * Bug 544 —— Abs 的 **`any`（未受约束）** 与 **`unknown`（推导失败）**
 * 在 **nudo 内部**是两个不同的产品概念（`abs.md` 的 display 规则约束的是
 * **nudo 展示 / CLI 面**，那里不得合并）。
 *
 * 但 **TS 投影面**是另一回事：nudo 的 `any` 是「无约束并集 / 任意值」，语义
 * 更接近 TS 的 `unknown`（top，消费方须先收窄），而不是 TS 的 `any`（关闭
 * 类型检查的逃生舱）。2026-11-06 产品裁定据此把
 * `dts-generator.ts::absToTSTypeB` 的 `case "any"` 从 `return "any"` 改为
 * `return "unknown"` ⇒ 与 zod / standard / guard 三面运行时校验器同口径
 * （三面早就把 any / unknown 同映为 `z.unknown()` / `unknown`）。
 *
 * 旧版 BUG-544 把 `abs.md:100` 的 display 规则**误引到 .d.ts 产物面**，并把
 * `id(1).toFixed()` 的 TS2571 定性为「假红」；按本裁定性为**正确的类型安全
 * 提示**（引擎确实不知道返回值是什么，消费方理应先收窄）。
 *
 * 本文件钉住新口径：① TS 投影面合并；② nudo 展示面仍区分；③ 产物过
 * strict tsc；④ 未收窄的 unknown 使用确实被 TS 拦下。
 */
import { describe, it, expect } from "vitest";
import { anyAbs, formatAbs, type Abs } from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "@nudojs/service";
import { tscNoEmit } from "./dts-tsc.ts";

const unknownAbs = (): Abs =>
  ({ shape: { k: "unknown" }, term: undefined, pred: undefined, conf: "partial" }) as Abs;

describe("Bug 544 —— Abs 域区分保留、TS 投影面归一为 unknown", () => {
  it("TS 投影面：Abs any 与 Abs unknown 都渲染成 TS unknown", () => {
    expect(absToTSType(anyAbs)).toBe("unknown");
    expect(absToTSType(unknownAbs())).toBe("unknown");
  });

  it("nudo 展示面仍区分 any / unknown（abs.md display 规则作用域不变）", () => {
    expect(formatAbs(anyAbs)).toContain("any");
    expect(formatAbs(anyAbs)).not.toContain("unknown");
    expect(formatAbs(unknownAbs())).toContain("unknown");
    expect(formatAbs(unknownAbs())).not.toContain("any");
  });

  it("未受约束的入口形参在 .d.ts 里渲染成 unknown（与三面校验器同口径）", () => {
    const dts = generateDts(
      analyzeFile("/test/bug544.js", `export function id(x) {\n  return x;\n}\n`),
    );
    expect(dts).toContain("export declare function id(x: unknown): unknown;");
    expect(dts).not.toContain(": any");
  });

  it("Case 见证行按观测值渲染，且产物不出现 TS any", () => {
    const dts = generateDts(
      analyzeFile("/test/bug544b.js", `export function id(x) {\n  return x;\n}\nid(1);\n`),
    );
    expect(dts).toContain("Case:");
    expect(dts).toContain("(1)");
    expect(dts).not.toContain(": any");
    expect(dts).not.toContain("(any)");
  });

  it("产物真的能过 tsc --noEmit --strict（unknown 经收窄后可用）", () => {
    const dts = `
export declare function id(x: unknown): unknown;
`;
    const consumer = `
import { id } from "./lib.js";
const v = id(1);
export const r = typeof v === "number" ? v.toFixed() : "n/a";
export const s = v;
`;
    const check = tscNoEmit({ "lib.d.ts": dts, "use.ts": consumer });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("未收窄的 unknown 返回值被 TS2571 拦下（正确的类型安全提示，非假红）", () => {
    const dts = `
export declare function id(x: unknown): unknown;
`;
    const consumer = `
import { id } from "./lib.js";
export const r = id(1).toFixed();
`;
    const check = tscNoEmit({ "lib.d.ts": dts, "use.ts": consumer });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2571");
  });
});
