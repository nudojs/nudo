/**
 * Bug 556：`nudo check --fix` 的 **nullish quickfix** 吞掉侧车 `fn()` 的**第三
 * 实参 `{ throws }`** ⇒ 自动落盘后**删除用户的 throws 义务** ⇒ 门禁从
 * `constraint-violated` 变成**新的** `entry-may-throw` ⇒ 没修好还制造新错误。
 *
 * 根因：wrapReturnNullable 取「首个顶层逗号」与「`fn(...)` 收尾括号」之间的
 * **全部**文本当 return 位 ⇒ 第三个实参被一起卷进 `nullable(...)`。
 *
 * 本钉：
 *   ① 第三实参原样保留（只卷 return 位）
 *   ② 改写后门禁真的转绿（引擎复核：无 constraint-violated、无 entry-may-throw）
 *   ③ 证不出时降级 [review]（不自动落盘）
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { materializeAction, wrapReturnNullable } from "../quickfix-edits.ts";

const SRC = `export function sim(v) {
  if (v === 0) {
    throw new Error("boom");
  }
  return null;
}
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, number(), { throws: "Error" });
`;

/** 用引擎复核某份侧车文本下的门禁状态 */
function gate(sidecarText: string): string[] {
  const r = checkSource("/t/sim.js", SRC, pTrue, {
    loadModule: (spec: string) => (spec.includes("nudo") ? sidecarText : undefined),
    fromFile: "/t/sim.js",
  });
  return r.issues.map((i) => `${i.code} fn=${i.fn}`);
}

describe("Bug 556 — nullish quickfix 不得吞掉 fn() 的第三实参", () => {
  it("只卷 return 位：第三实参 { throws } 原样保留", () => {
    const next = wrapReturnNullable(SIDECAR, "sim");
    expect(next).toBeDefined();
    expect(next).toContain(
      `export const sim = fn({ v: number() }, nullable(number()), { throws: "Error" });`,
    );
    // 不得把第三实参卷进 nullable(...)
    expect(next).not.toContain("nullable(number(), { throws");
  });

  it("改写后门禁真的转绿（引擎复核：无残留诊断）", () => {
    const next = wrapReturnNullable(SIDECAR, "sim")!;
    expect(gate(next)).toEqual([]);
  });

  it("改前形态（第三实参被卷进 nullable）会造出新的 entry-may-throw —— 回归有效性自证", () => {
    const broken = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, nullable(number(), { throws: "Error" }));
`;
    expect(gate(broken)).toEqual(["nudo:entry-may-throw fn=sim"]);
    // 改前门禁是 constraint-violated
    expect(gate(SIDECAR)).toEqual(["nudo:constraint-violated fn=sim"]);
  });

  it("quickfix 物化：门禁转绿 ⇒ titleKind=fix（可自动落盘）", () => {
    const plan = materializeAction({
      code: "nudo:constraint-violated",
      fn: "sim",
      file: "/t/sim.js",
      source: SRC,
      sidecarPath: "/t/sim.nudo.js",
      sidecarText: SIDECAR,
      action: { kind: "relax", label: "x" },
      expected: "nullish return ⊭ number()",
      suggestion: "use nullable(number()) or union(..., lit(null)) to allow nullish returns",
    });
    expect(plan).toBeDefined();
    expect(plan!.titleKind).toBe("fix");
    expect(plan!.sidecar?.newText).toContain(`{ throws: "Error" }`);
  });

  it("证不出时降级 review（不自动落盘）", () => {
    // 侧车没有 throws 槽：卷 nullable 后 entry-may-throw 仍在 ⇒ 不能算修好
    const noThrows = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, number());
`;
    const plan = materializeAction({
      code: "nudo:constraint-violated",
      fn: "sim",
      file: "/t/sim.js",
      source: SRC,
      sidecarPath: "/t/sim.nudo.js",
      sidecarText: noThrows,
      action: { kind: "relax", label: "x" },
      expected: "nullish return ⊭ number()",
      suggestion: "use nullable(number()) or union(..., lit(null)) to allow nullish returns",
    });
    expect(plan).toBeDefined();
    expect(plan!.titleKind).toBe("review");
  });

  it("负控制：只有两个实参时照旧只卷 return 位", () => {
    const two = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, number());
`;
    expect(wrapReturnNullable(two, "sim")).toContain(
      `export const sim = fn({ v: number() }, nullable(number()));`,
    );
  });

  it("负控制：已包过 nullable 的 return 位不重复包（既有行为不变）", () => {
    const already = `import { fn, number } from "@nudojs/core";
export const sim = fn({ v: number() }, nullable(number()));
`;
    expect(wrapReturnNullable(already, "sim")).toBeUndefined();
  });
});
