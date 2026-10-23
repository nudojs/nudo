/**
 * Bug 369 回归钉（LSP 面）—— 返回契约类诊断不带 `line` / `column` ⇒ LSP 把诊断
 * 画在**第 1 行第 0 列**（`range {0,0}-{0,1}`），而函数其实在第 10 行。
 *
 * 修法（族 07 片 S4）：core 的 `checkReturnConstraint` 在 issue 构造处补上
 * **被违约函数的声明位置** ⇒ LSP 侧（`checkIssueToLspDiagnostic` → 
 * `lspDiagnosticRange`）自然换算到真实行（1 基 → 0 基）。
 *
 * 钉：`nudo:constraint-violated` 的 LSP range 必须落在第 10 行
 * （0 基 line 9），不得是 0。
 */
import { describe, it, expect } from "vitest";
import { checkToLspDiagnostics } from "../validation.ts";

/** 前 9 行是注释 ⇒ 函数声明落在第 10 行 */
const SRC = `// line 1
// line 2
// line 3
// line 4
// line 5
// line 6
// line 7
// line 8
// line 9
export function deep(x) {
  return x - 1;
}
`;

/** 侧车：`deep` 的返回契约 `number().gt(0)`（`x - 1` 违例） */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const deep = fn({ x: number().gt(0) }, number().gt(0));
`;

const loadModule = (spec: string): string | undefined =>
  spec.endsWith(".nudo.js") ? SIDECAR : undefined;

describe("Bug 369 — LSP 面：返回契约违例画在真实行（不得是第 1 行）", () => {
  it("nudo:constraint-violated 的 range 落在函数声明行", () => {
    const diags = checkToLspDiagnostics("/t/bug369.js", SRC, loadModule);
    const d = diags.find((x) => x.code === "nudo:constraint-violated");
    expect(d).toBeDefined();
    // LSP Position.line 是 0 基 ⇒ 源码第 10 行 ⇒ 0 基 line 9
    expect(d!.range.start.line).toBe(9);
    expect(d!.range.start.character).toBe(7);
    expect(d!.range.start.line).not.toBe(0);
  });
});
