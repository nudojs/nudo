/**
 * Bug 1023 —— 跨模块桥接路径与同文件路径**同口径**：契约形参名对不上形参表
 * ⇒ 报 nudo:interface-param-mismatch，不再静默丢参数面。
 *
 * 旧行为：跨模块时契约形参名对不上（`fn({ k: … })` vs `function scale(factor)`）
 * ⇒ 该形参的**义务在调用方蒸发**（调用点假绿：负参调用不报违例）。
 * 同文件路径本就报 mismatch（check.ts 的 C4.5 口径）⇒ 两套口径分叉。
 *
 * 新行为：跨模块路径复用同一段计算（unmatchedContractParams）+ 同一文案
 * （paramMismatchIssue）⇒ 两边都报。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  pTrue,
  runTranspiled,
  callTranspiledExportApply,
  absFunction,
} from "@nudojs/core";

const LIB = `export function scale(factor) { return factor * 2; }`;

/** 契约形参名 k ≠ 形参表 factor ⇒ mismatch */
const SIDE_MISMATCH = `import { fn, number } from "@nudojs/core";
export const scale = fn({ k: number().gt(0) }, number());
`;

/** 契约形参名 factor = 形参表 ✔ 对照组 */
const SIDE_OK = `import { fn, number } from "@nudojs/core";
export const scale = fn({ factor: number().gt(0) }, number());
`;

const CALLER = `import { scale } from "./scale.js";
export const r = scale(-1);
`;

function run(side: string) {
  const run_ = runTranspiled(LIB, { mode: "analyze" });
  const named: Record<string, unknown> = {
    scale: absFunction(["factor"], {
      apply: callTranspiledExportApply(run_, "scale"),
      kind: "eval-export",
      fingerprint: "eval:b1023#scale",
    }),
  };
  return checkSource("/t/b1023.js", CALLER, pTrue, {
    loadModule: (spec: string): string | undefined => {
      if (spec.includes("scale.nudo.js")) return side;
      if (spec.includes("scale.js")) return LIB;
      return undefined;
    },
    fromFile: "/t/b1023.js",
    modules: { "./scale.js": { named, evaluated: true } } as never,
  });
}

describe("Bug 1023 跨模块：契约形参名对不上 ⇒ 报 param-mismatch", () => {
  const r = run(SIDE_MISMATCH);
  it("调用方看到 nudo:interface-param-mismatch（旧行为：零诊断）", () => {
    const m = r.issues.filter((i) => i.code === "nudo:interface-param-mismatch");
    expect(m).toHaveLength(1);
    expect(m[0]!.fn).toBe("scale");
    expect(m[0]!.severity).toBe("error");
    expect(m[0]!.actual).toBe("k");
    expect(r.ok).toBe(false);
  });
});

describe("Bug 1023 跨模块对照组：契约形参名对得上 ⇒ 不报 mismatch", () => {
  const r = run(SIDE_OK);
  it("无 param-mismatch", () => {
    expect(
      r.issues.some((i) => i.code === "nudo:interface-param-mismatch"),
    ).toBe(false);
  });
  it("调用点的负参违例照旧执法（跨模块 L1 扫描）", () => {
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated"),
    ).toBe(true);
  });
});

describe("Bug 1023 跨模块负控：解构点路径契约名（card.grade）不是 mismatch", () => {
  const LIB_DOT = `export function grade({ card: { grade } }) { return grade; }`;
  const SIDE_DOT = `import { fn, number } from "@nudojs/core";
export const grade = fn({ "card.grade": number().gt(0) }, number());
`;
  const caller = `import { grade } from "./grade.js";
export const r = grade({ card: { grade: -1 } });
`;
  const run_ = runTranspiled(LIB_DOT, { mode: "analyze" });
  const named: Record<string, unknown> = {
    grade: absFunction(["card"], {
      apply: callTranspiledExportApply(run_, "grade"),
      kind: "eval-export",
      fingerprint: "eval:b1023#grade",
    }),
  };
  const r = checkSource("/t/b1023-dot.js", caller, pTrue, {
    loadModule: (spec: string): string | undefined => {
      if (spec.includes("grade.nudo.js")) return SIDE_DOT;
      if (spec.includes("grade.js")) return LIB_DOT;
      return undefined;
    },
    fromFile: "/t/b1023-dot.js",
    modules: { "./grade.js": { named, evaluated: true } } as never,
  });
  it("不报 param-mismatch（点路径名在契约面内）", () => {
    expect(
      r.issues.some((i) => i.code === "nudo:interface-param-mismatch"),
    ).toBe(false);
  });
  it("点路径实参义务照旧执法", () => {
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated"),
    ).toBe(true);
  });
});
