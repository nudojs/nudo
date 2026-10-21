/**
 * Bug 544 —— dts 把 Abs 的 **`any`（未受约束）** 与 **`unknown`（推断失败）**
 * 合并渲染成 TS 的 `unknown` ⇒ 违反 `abs.md:100`（「unconstrained entry
 * parameters display as `any`, never as `unknown`」）⇒ TS 消费方吃 TS2571
 * 假红；而 zod / standard / guard 三面都宽松 ⇒ dts 是唯一的严格面。
 *
 * 改前：`export declare function id(x: unknown): unknown;`
 * 改后：`export declare function id(x: any): any;`（与 `nudo check` 的
 * `id(x: any) => any` 同口径）
 */
import { describe, it, expect } from "vitest";
import { anyAbs, type Abs } from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "@nudojs/service";
import { tscNoEmit } from "./dts-tsc.ts";

const unknownAbs = (): Abs =>
  ({ shape: { k: "unknown" }, term: undefined, pred: undefined, conf: "partial" }) as Abs;

describe("Bug 544 —— Abs any（未约束）≠ Abs unknown（推断失败）", () => {
  it("Abs any → TS any；Abs unknown → TS unknown（两个形状种类分面）", () => {
    expect(absToTSType(anyAbs)).toBe("any");
    expect(absToTSType(unknownAbs())).toBe("unknown");
  });

  it("未受约束的入口形参渲染成 any（与 nudo check 签名同口径）", () => {
    const dts = generateDts(
      analyzeFile("/test/bug544.js", `export function id(x) {\n  return x;\n}\n`),
    );
    expect(dts).toContain("export declare function id(x: any): any;");
    expect(dts).not.toContain("unknown");
  });

  it("Case: 见证行同样按 any 渲染（与 nudo test 面同口径，不跨面自相矛盾）", () => {
    const dts = generateDts(
      analyzeFile("/test/bug544b.js", `export function id(x) {\n  return x;\n}\nid(1);\n`),
    );
    expect(dts).toContain("Case:");
    expect(dts).not.toContain("(unknown)");
  });

  it("产物真的能过 tsc --noEmit --strict，且消费方不再吃 TS2571", () => {
    const dts = `
export declare function id(x: any): any;
`;
    const consumer = `
import { id } from "./lib.js";
export const r = id(1).toFixed();
export const s = id(1) + 1;
`;
    const check = tscNoEmit({ "lib.d.ts": dts, "use.ts": consumer });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("改前形态确实红（unknown ⇒ TS2571）", () => {
    const before = `
export declare function id(x: unknown): unknown;
`;
    const consumer = `
import { id } from "./lib.js";
export const r = id(1).toFixed();
`;
    const check = tscNoEmit({ "lib.d.ts": before, "use.ts": consumer });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2571");
  });
});
