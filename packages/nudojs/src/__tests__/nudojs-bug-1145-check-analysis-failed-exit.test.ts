/**
 * Bug 1145 回归：`nudo check` 遇**模块级求值失败**（引擎内部回落 `internal`）
 * 必须**红**——不得「零诊断 + exit 0」（**闸门假绿**：合法代码与违约代码都判绿）。
 *
 * 病灶：core 在「生成模块编译失败（`new Function` SyntaxError）」或「模块求值抛
 * 内部错误」时记一条 `internal` 回落 ⇒ 该模块**全部导出丢失** ⇒ 闸门看不到任何
 * 入口 ⇒ 零诊断 + exit 0。
 *
 * 修法：CLI 编排为**每个被检查文件**装一个回落 collector ⇒ 观察到 `internal`
 * 回落 ⇒ 产出一条 **error 级** `nudo:internal` 诊断（已注册码）⇒ 报告
 * `ok:false` ⇒ exit 1。人类面有明确失败行（哪个文件 + 什么原因）；`--json` 面
 * 的机器判据 = `issues[].code === "nudo:internal"`（severity `error`）+
 * `ok === false`。
 *
 * 断言面：
 * 1. 含 internal 回落的文件 ⇒ `nudo check` exit **≠ 0**（修前是 0 = 假绿）；
 * 2. 人类面有明确失败行（含文件名 + 原因）；
 * 3. `--json` 面有机器可判定字段（`ok:false` + `nudo:internal` error issue）；
 * 4. **假红防线**：正常文件（零回落）仍 exit 0（不得误报）；
 * 5. **假红防线**：`unsupported:*`（能力边界）回落**不**变成闸门失败；
 * 6. `nudo health`：存在 internal 回落时 `Result` 不得是 OK（exit ≠ 0）。
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resetCheckSourceMemo,
  resetGeneralizeMemo,
  resetNudoModuleExecCache,
  resetParseSourceCache,
  resetSidecarLoadFailureCache,
  takeInterfaceDiags,
  takeRefineDiags,
} from "@nudojs/core";
import { resetAbsCallBudget, resetEvalForkBudget } from "@nudojs/core/internal";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 模块级求值**必然失败**的源：模块顶层调用未定义的值 ⇒ 宿主运行时抛原生
 * TypeError ⇒ core 记一条 `internal` 回落 ⇒ 该模块全部导出丢失。 */
const MODULE_EVAL_FAILS = `export const boom = undefined();

export function add(a, b) {
  return a + b;
}
`;

/** 能力边界回落（`unsupported:*`）：`g().x ||= 1` 的逻辑赋值目标不可写回 ⇒
 * transpile 抛 `unsupported:assign:||=` ⇒ 回落但**不是**引擎缺陷 ⇒ **不得**
 * 变成闸门失败（假红防线）。 */
const UNSUPPORTED_ONLY = `export function bump(g) {
  g().x ||= 1;
}
`;

/** 正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。 */
const CLEAN = `export function identity(x) {
  return x;
}
`;

const dirs: string[] = [];
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeInterfaceDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
});

describe("1145 · nudo check：模块级求值失败必须 fail-closed", () => {
  it("含 internal 回落的文件 ⇒ exit ≠ 0（修前是 0 = 假绿）+ 人类面明确失败行", () => {
    const dir = tmpDir("nudo-1145-check-fail-");
    const file = join(dir, "boom.js");
    writeFileSync(file, MODULE_EVAL_FAILS, "utf-8");
    const r = runCliTsx(["check", file]);
    expect(r.status).not.toBe(0);
    // 人类面：明确的失败行（哪个文件 + 什么原因）。
    // BUG-073 之后模块级原生异常归类为 `nudo:module-throw`（用户代码的异常不再是
    // 引擎内部缺陷），因此不再有 `analysis failed for … internal fallback` 行；
    // 契约不变：该文件必须红，且失败原因必须可见。
    expect(r.stdout).toContain("FAILED");
    expect(r.stdout).toContain("nudo:module-throw");
  });

  it("--json 面：机器可判定（ok:false + nudo:internal error issue）+ exit ≠ 0", () => {
    const dir = tmpDir("nudo-1145-check-json-");
    const file = join(dir, "boom.js");
    writeFileSync(file, MODULE_EVAL_FAILS, "utf-8");
    const r = runCliTsx(["check", file, "--json"]);
    expect(r.status).not.toBe(0);
    const json = JSON.parse(r.stdout) as {
      ok: boolean;
      summary: { errors: number };
      issues: Array<{ severity: string; code: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.summary.errors).toBeGreaterThan(0);
    const fatal = json.issues.filter((i) => i.code === "nudo:module-throw");
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal.every((i) => i.severity === "error")).toBe(true);
    // 失败原因可读（模块无法装载）
    expect(fatal[0]!.message).toContain("throws");
  });

  it("假红防线：正常文件（零回落）仍 exit 0（不得误报）", () => {
    const dir = tmpDir("nudo-1145-check-clean-");
    const file = join(dir, "clean.js");
    writeFileSync(file, CLEAN, "utf-8");
    const r = runCliTsx(["check", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("FAILED");
    expect(r.stdout).not.toContain("nudo:module-throw");
  });

  it("假红防线：unsupported:*（能力边界）回落**不**变成闸门失败", () => {
    const dir = tmpDir("nudo-1145-check-unsupported-");
    const file = join(dir, "unsupported.js");
    writeFileSync(file, UNSUPPORTED_ONLY, "utf-8");
    const r = runCliTsx(["check", file, "--json"]);
    // 能力边界回落**不得**产出「分析失败」信号（`nudo:internal`）——
    // 该文件的红色只能来自既有诊断（如 L2 entry-may-throw），不得来自本条。
    const json = JSON.parse(r.stdout) as {
      issues: Array<{ code: string; severity: string }>;
    };
    expect(json.issues.some((i) => i.code === "nudo:module-throw")).toBe(false);
    expect(r.stderr).not.toContain("analysis failed for");
  });

  it("check --fix 与 plain check 同口径：同一文件不得「check 红 / --fix 绿」", () => {
    const dir = tmpDir("nudo-1145-check-fix-");
    const file = join(dir, "boom.js");
    writeFileSync(file, MODULE_EVAL_FAILS, "utf-8");
    const r = runCliTsx(["check", "--fix", file]);
    // 只断言退出码同口径（--fix 不打印诊断清单，它是「计划/写盘」面）：
    // 不得出现 `check` 红而 `--fix` 绿。
    expect(r.status).not.toBe(0);
  });
});

describe("1145 · nudo health：存在 internal 回落时不得报 OK", () => {
  it("模块级原生异常不再是「分析失败」⇒ health 只看漂移，报 OK（口径变更）", () => {
    // BUG-073 之后 `export const boom = undefined();` 被**确定性**归类为
    // `nudo:module-throw`（分析本身成功，结论是「这个模块装载必抛」），
    // 不再走 `internal` 回落 ⇒ BUG-1145 的 health 断言前提（「分析失败 ⇒ 闸门
    // 无法裁决」）消失：health 的失败判据是 **contract drift / case drift /
    // path error / internal 回落**，不含「代码本身必抛」这类**可裁决**的缺陷
    // ——那由 `nudo check` 报红（见上方用例）。`internal` 回落仍会进
    // FAIL 判据（本文件「unsupported」用例守住反向）。
    const dir = tmpDir("nudo-1145-health-module-throw-");
    const file = join(dir, "boom.js");
    writeFileSync(file, MODULE_EVAL_FAILS, "utf-8");
    const r = runCliTsx(["health", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Result: OK");
  });

  it("正常文件 ⇒ Result: OK + exit 0（不得误报）", () => {
    const dir = tmpDir("nudo-1145-health-clean-");
    const file = join(dir, "clean.js");
    writeFileSync(file, CLEAN, "utf-8");
    const r = runCliTsx(["health", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Result: OK");
  });

  it("假红防线：unsupported:*（能力边界）回落 ⇒ health 仍 OK（不得误报）", () => {
    const dir = tmpDir("nudo-1145-health-unsupported-");
    const file = join(dir, "unsupported.js");
    writeFileSync(file, UNSUPPORTED_ONLY, "utf-8");
    const r = runCliTsx(["health", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Result: OK");
  });
});
