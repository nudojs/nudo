/**
 * BUG-055：`nudo test --freeze` 把**违反被调方契约**的见证写进被调方 ⇒
 * 绿色被调方被自己的 freeze 操作冻成红色（`nudo:case-inconsistency`，error 级）。
 *
 * 根因：固化只筛「可序列化」与「非手写」，**从不把候选见证与被调方的有效契约
 * 比对** ⇒ 调用方的违约被搬进被调方，随后由见证面（check-case-scan）对着
 * **被调方**判红。
 *
 * 契约：违反**被写方自己的手写契约**的候选见证**不写入**；归因留在调用现场
 * （`nudo:interface-domain-exceeds`）。不可判（非字面量实参 / 结构契约）⇒ 放行
 * ——「不写」= 丢证据，比「写错」更危险。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { abs as makeAbs, type Abs } from "@nudojs/core";
// 字面量助手单源：core/internal 的 absLit（与 case-emitter.test.ts 同源）
import { absLit } from "@nudojs/core/internal";

/** 无信息的实参 / 结果 Abs（`conf="partial"`，与 case-emitter.test.ts 同款） */
function unknownAbs(): Abs {
  return makeAbs({ k: "unknown" }, undefined, undefined, "partial");
}
import { defaultLoadModule } from "@nudojs/service";
import type { AnalysisResult, FunctionAnalysis } from "@nudojs/service";
import { insertGeneratedCaseDirectives } from "../case-emitter.ts";

const LIB = `/// @nudo:import { positive } from "./tmpl.nudo.js"
/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x * 2;
}
`;

/** 手搓 analysis（固化只消费 callsite case 的 argAbs / 名字 / 锚点） */
function analysisOf(
  name: string,
  line: number,
  paramNames: string[],
  cases: Array<{ name: string; args: Abs[] }>,
): AnalysisResult {
  const fn: FunctionAnalysis = {
    name,
    loc: { start: { line, column: 0 }, end: { line, column: 0 } },
    paramNames,
    cases: cases.map((c) => ({
      name: c.name,
      argAbs: c.args,
      abs: unknownAbs(),
      throwsAbs: unknownAbs(),
      source: "callsite",
    })),
  };
  return {
    functions: [fn],
    diagnostics: [],
    bindings: new Map(),
    nodeAbsMap: new Map(),
    caseHints: [],
  };
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-055-"));
  writeFileSync(join(dir, "tmpl.nudo.js"), "export const positive = number().gt(0);\n", "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BUG-055 — --freeze 不得把违反被调方契约的见证写进被调方", () => {
  it("违约见证（-1 ⊭ x > 0）不写入；合规见证照写；skip 记 contract-violation", () => {
    const out = insertGeneratedCaseDirectives(
      LIB,
      analysisOf("needsPositive", 5, ["x"], [
        { name: "call@usage.js:L2", args: [absLit(5)] },
        { name: "call@usage.js:L3", args: [absLit(-1)] },
      ]),
      { filePath: join(dir, "lib.js"), loadModule: defaultLoadModule },
    );
    expect(out.source).toContain('@nudo:case "call@usage.js:L2" (5)');
    // 旧行为：`@nudo:case "call@usage.js:L3" (-1)` 被写进来 ⇒ 随后 check 判红
    expect(out.source).not.toContain("call@usage.js:L3");
    expect(out.written).toEqual([{ fn: "needsPositive", cases: ["call@usage.js:L2"] }]);
    const skip = out.skipped.find((s) => s.reason === "contract-violation");
    expect(skip?.fn).toBe("needsPositive");
    expect(skip?.detail).toContain("call@usage.js:L3");
  });

  it("不可判 ⇒ 放行（非字面量实参不猜；不写 = 丢证据）", () => {
    const out = insertGeneratedCaseDirectives(
      LIB,
      analysisOf("needsPositive", 5, ["x"], [
        // 形状未知的实参（unknown 无 term）→ 无法证明违约
        { name: "call@usage.js:L9", args: [unknownAbs()] },
      ]),
      { filePath: join(dir, "lib.js"), loadModule: defaultLoadModule },
    );
    expect(out.skipped.some((s) => s.reason === "contract-violation")).toBe(false);
    expect(out.written.length).toBe(1);
  });

  it("无宿主接线（不给 filePath/loadModule）⇒ 契约不可读 ⇒ 契约闸不生效（行为与改前一致）", () => {
    const out = insertGeneratedCaseDirectives(
      LIB,
      analysisOf("needsPositive", 5, ["x"], [{ name: "call@usage.js:L3", args: [absLit(-1)] }]),
    );
    expect(out.source).toContain('@nudo:case "call@usage.js:L3" (-1)');
  });
});
