/**
 * BUG-140 回归（LSP 面）：CLI 的 `nudo:internal`（**分析失败 ⇒ 门禁无法裁决**）
 * 必须在 IDE 面同样可见。
 *
 * 病灶：CLI 的 check 编排在**包装层**（`packages/nudojs/src/commands/check.ts`）
 * 用 `setEvalFallbackCollector` 观测本文件的 `internal` 回落，据此产出 error 级
 * `nudo:internal` ⇒ exit 1；而 LSP 只把 `checkSource` **抛异常**当门禁失败，
 * 这条 `evalFailures` 通道**它根本不读** ⇒ 同一文件：**CI 红 / IDE 零诊断**
 * （编辑器里看起来干干净净，开发者看不出 CI 为什么红）。
 *
 * 修法（`packages/service/src/analyzer-orchestrate.ts`）：把「分析失败」提升为
 * **service 层**的诊断 —— `analyzeFile` 在本次分析窗口内观测 `internal` 回落
 * （core 的 `getEvalFallbackStats()`，与 collector 单槽无关 ⇒ 不抢占宿主
 * collector），有回落就在结果的 `diagnostics` 里追加一条 **error** 级
 * `nudo:internal` ⇒ LSP / agent 工具 / 插件 / CLI 的分析器通道**同源**。
 *
 * 负控制：正常文件不得出现 `nudo:internal`（不得把整条诊断面变成噪声）。
 *
 * **口径变更（BUG-073 之后）**：同一事实（模块级原生异常 ⇒ 模块无法装载）现在被
 * 归类为 **`nudo:module-throw`**（用户代码的异常不再是引擎内部缺陷），码不再是
 * `nudo:internal`。本用例断言随之改到新码，但**契约不变**：CLI 判红的文件，IDE
 * 面必须同样可见，且 severity 必须是 error、range 不得编造行号。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearValidationState,
  validateText,
  type LspDiagnostic,
  type ValidateTextDeps,
} from "../validation.ts";
import { DiagnosticSeverity } from "vscode-languageserver/node";

/** 模块求值失败（顶层读未定义全局）⇒ 门禁判红。 */
const BROKEN_SRC = `const x = undefinedGlobalAtTopLevel;
export function f() {
  return 1;
}
`;

const CLEAN_SRC = `export function g(x) {
  return x + 1;
}
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-bug-140-"));
  dirs.push(dir);
  return dir;
}

/** 走 `validateText` 的**真实发布面**（push 通道），收集发布的诊断。 */
async function published(dir: string, name: string, src: string): Promise<LspDiagnostic[]> {
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  clearValidationState();
  const sent: LspDiagnostic[] = [];
  const deps: ValidateTextDeps = {
    sendDiagnostics: (p) => {
      sent.push(...p.diagnostics);
    },
  };
  await validateText(file, `file://${file}`, src, 1, deps);
  return sent;
}

describe("BUG-140: 分析失败（门禁判红的文件）必须出现在 IDE 面", () => {
  it("模块求值失败 ⇒ 发布一条 error 级 nudo:module-throw（与 CLI exit ≠ 0 同结论）", async () => {
    const dir = project();
    const diags = await published(dir, "f.js", BROKEN_SRC);
    const fatal = diags.filter((d) => d.code === "nudo:module-throw");
    expect(fatal).toHaveLength(1);
    expect(fatal[0]!.severity).toBe(DiagnosticSeverity.Error);
    expect(String(fatal[0]!.message)).toContain("always throws ReferenceError");
    expect(String(fatal[0]!.message)).toContain("cannot be imported");
    // 无源位置：不得编造第 1 行（装载期失败定位不到某一行）
    expect(fatal[0]!.range.start.line).toBe(0);
  });

  it("负控制：正常文件不报 nudo:module-throw", async () => {
    const dir = project();
    const diags = await published(dir, "g.js", CLEAN_SRC);
    expect(diags.filter((d) => d.code === "nudo:module-throw")).toHaveLength(0);
  });
});
