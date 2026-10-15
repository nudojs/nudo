/**
 * #176 skip×case 解耦：`@nudo:skip => <returns>` 只跳过**推断面**
 * （combinedAbs 用声明面，无 synth/entry@/hof），`@nudo:case` 照常求值断言
 * ——用户不再被迫在「声明返回面」与「运行时真值」之间二选一。
 *
 * 面语义不变量：case 是运行时见证，不参与面合成（combinedAbs / dts /
 * 侧车契约 / 草稿证据均保持声明面或无证据口径）。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile, clearEvalCache } from "@nudojs/service";
import { formatShape } from "@nudojs/core";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpProject } from "./tmp-project.ts";
import { generateDts } from "../emit/dts-generator.ts";
import { draftInterface } from "../emit/interface-draft.ts";
import { emitInterface } from "../emit/interface-emitter.ts";

/** tmp 项目内分析（package.json 隔离 findProjectConfig，邻例 eval-hosted-skip 同款） */
function analyzeTmp(src: string, caseMode?: "all" | "none") {
  const dir = tmpProject("nudo-skip-case-");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "skipcase", version: "1.0.0" }));
  const p = join(dir, "index.js");
  writeFileSync(p, src);
  clearEvalCache();
  return { result: analyzeFile(p, src, undefined, undefined, undefined, caseMode), path: p, src };
}

const SKIP_DECLARED = `/**
 * @nudo:skip => number().ge(0)
 * @nudo:case "two" (2) => number()
 * @nudo:case "three" (3)
 */
export function double(x) { return x * 2; }
`;

const NO_SKIP = `/**
 * @nudo:case "two" (2) => number()
 * @nudo:case "three" (3)
 */
export function double(x) { return x * 2; }
`;

describe("#176 skip×case 解耦", () => {
  it("skip => 声明面：case 照常求值，combinedAbs 恒为声明面", () => {
    const { result } = analyzeTmp(SKIP_DECLARED);
    const fn = result.functions.find((f) => f.name === "double")!;
    expect(fn).toBeDefined();

    // skip 面照旧：推断面跳过
    expect(fn.skipped).toBe(true);

    // case 求值发生：2 条 directive case 带精确运行时结果（4 / 6）
    expect(fn.cases).toHaveLength(2);
    expect(fn.cases.map((c) => c.name)).toEqual(["two", "three"]);
    expect(fn.cases.every((c) => c.source === "directive")).toBe(true);
    expect(formatShape(fn.cases[0]!.abs)).toBe("4");
    expect(formatShape(fn.cases[1]!.abs)).toBe("6");
    expect(fn.cases[0]!.expected).toBeDefined();
    expect(fn.cases[1]!.expected).toBeUndefined();

    // combinedAbs 来自声明面：prim number + ge(0) 谓词（case 折叠只会是 4|6 字面量联合）
    expect(fn.combinedAbs).toBeDefined();
    expect(fn.combinedAbs!.shape.k).toBe("prim");
    expect(formatShape(fn.combinedAbs!)).toBe("number");
    expect(fn.combinedAbs!.pred?.op).toBe("ge");
  });

  it("声明面优先于 case 结果（string 声明 × number 运行时不被覆盖）", () => {
    const { result } = analyzeTmp(`/**
 * @nudo:skip => string()
 * @nudo:case "two" (2)
 */
export function double(x) { return x * 2; }
`);
    const fn = result.functions.find((f) => f.name === "double")!;
    expect(fn.skipped).toBe(true);
    expect(fn.cases).toHaveLength(1);
    expect(formatShape(fn.cases[0]!.abs)).toBe("4");
    // 声明面胜出：若 case 结果回写，这里会是 number
    expect(formatShape(fn.combinedAbs!)).toBe("string");
  });

  it("对照组：无 skip 同函数行为不变（case 求值 + collapse 回写）", () => {
    const { result } = analyzeTmp(NO_SKIP);
    const fn = result.functions.find((f) => f.name === "double")!;
    expect(fn.skipped).toBeUndefined();
    expect(fn.cases).toHaveLength(2);
    expect(formatShape(fn.cases[0]!.abs)).toBe("4");
    expect(formatShape(fn.cases[1]!.abs)).toBe("6");
    // 非 skip：case 结果照旧合成 combinedAbs
    expect(formatShape(fn.combinedAbs!)).toBe("4 | 6");
  });

  it("裸 @nudo:skip + case：case 仍求值，无声明面则无 combinedAbs", () => {
    const { result } = analyzeTmp(`/**
 * @nudo:skip
 * @nudo:case "two" (2)
 */
export function double(x) { return x * 2; }
`);
    const fn = result.functions.find((f) => f.name === "double")!;
    expect(fn.skipped).toBe(true);
    expect(fn.cases).toHaveLength(1);
    expect(formatShape(fn.cases[0]!.abs)).toBe("4");
    expect(fn.combinedAbs).toBeUndefined();
  });

  it("caseMode none（check/IDE）：skip 函数不求值 case 也不合成 entry@（旧口径）", () => {
    const { result } = analyzeTmp(SKIP_DECLARED, "none");
    const fn = result.functions.find((f) => f.name === "double")!;
    expect(fn.skipped).toBe(true);
    expect(fn.cases).toHaveLength(0);
    expect(fn.cases.some((c) => c.name.startsWith("entry@"))).toBe(false);
    expect(formatShape(fn.combinedAbs!)).toBe("number");
  });

  it("skip 函数的 case 断言执法照常（期望不符 → nudo:case-expected）", () => {
    const { result } = analyzeTmp(`/**
 * @nudo:skip => number()
 * @nudo:case "wrong" (2) => string()
 */
export function double(x) { return x * 2; }
`);
    const fn = result.functions.find((f) => f.name === "double")!;
    expect(fn.skipped).toBe(true);
    expect(fn.cases).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.code === "nudo:case-expected")).toBe(true);
  });

  it("dts 面：skip+case 走声明面 rest-args 形态（对照组走 case 主签名）", () => {
    const skipDts = generateDts(analyzeTmp(SKIP_DECLARED).result);
    expect(skipDts).toContain("export declare function double(...args: unknown[]): number;");

    const ctrlDts = generateDts(analyzeTmp(NO_SKIP).result);
    expect(ctrlDts).toContain("export declare function double(x: number): number;");
    expect(ctrlDts).not.toContain("...args: unknown[]");
  });

  it("侧车契约：skip+case 不从见证合成（not-projectable，与对照组相反）", async () => {
    const skipCase = analyzeTmp(SKIP_DECLARED);
    const emit = await emitInterface(skipCase.path, {
      mode: "add",
      fnNames: ["double"],
      dryRun: true,
      source: skipCase.src,
    });
    expect(emit.written).toEqual([]);
    expect(emit.skipped).toContainEqual({ fn: "double", reason: "not-projectable" });

    const ctrl = analyzeTmp(NO_SKIP);
    const ctrlEmit = await emitInterface(ctrl.path, {
      mode: "add",
      fnNames: ["double"],
      dryRun: true,
      source: ctrl.src,
    });
    expect(ctrlEmit.written).toEqual(["double"]);
  });

  it("interface 草稿：skip+case 的 case 不作草稿证据（dsl 仍 fn({})）", async () => {
    const skipCase = analyzeTmp(SKIP_DECLARED);
    const draft = await draftInterface(skipCase.path, { source: skipCase.src });
    const entry = draft.entries.find((e) => e.fn === "double")!;
    expect(entry).toBeDefined();
    expect(entry.paramEvidence).toBe("none");
    expect(entry.dsl).toBe("fn({})");

    const ctrl = analyzeTmp(NO_SKIP);
    const ctrlDraft = await draftInterface(ctrl.path, { source: ctrl.src });
    const ctrlEntry = ctrlDraft.entries.find((e) => e.fn === "double")!;
    expect(ctrlEntry.paramEvidence).toBe("directive");
    expect(ctrlEntry.dsl).toContain("x: number");
  });
});
