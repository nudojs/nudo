/**
 * Bug 495 回归（LSP 面）：service 分析器会**消费** core 的 interface 诊断
 * 通道（把「侧车加载失败」转成 service 诊断），而 LSP 的两个分析入口
 * （analyzeFileAsync 先、checkSource 后）**共用同一个 collector scope**
 * ⇒ 顺序上「service 分析先跑」可能把 check 路径的 `nudo:interface-load`
 * 取走 ⇒ IDE 里少一条 error 级诊断。
 *
 * 结论（当前工作树）：**不复现**——core 的 checkSource 入口会
 * `resetSidecarLoadFailureCache()`，自己重新探测侧车并重新上报一份
 * interface-load error ⇒ 两条路径都拿得到（探针：tmp/probe/fix-r24-wcli/
 * chan-order-probe.ts，两个顺序下 checkSource 的 issues 都带
 * `nudo:interface-load`）。
 *
 * 本文件把该事实**钉住**：坏侧车 ⇒ IDE 里必须看得见 error 级
 * `nudo:interface-load`（分析器先跑的那条路径），且不得被降级成
 * 「无契约根」的误报。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateText, clearValidationState } from "../validation.ts";
import { makeValidateDeps } from "./helpers.ts";

const DIAG_INTERFACE_LOAD = "nudo:interface-load";

async function publish(filePath: string, source: string): Promise<any[]> {
  const sent: any[] = [];
  const deps = makeValidateDeps({
    onPublish: (params) => {
      sent.push(...params.diagnostics);
    },
  });
  await validateText(filePath, `file://${filePath}`, source, 1, deps);
  return sent;
}

describe("Bug 495 LSP：坏侧车的 interface-load error 不被分析器取走", () => {
  it("分析器先跑 ⇒ IDE 里仍有 error 级 nudo:interface-load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-495-"));
    try {
      const file = join(dir, "probe.js");
      const src = `export function f(x) { return x; }\n`;
      writeFileSync(file, src, "utf-8");
      // 坏侧车：exec 失败 ⇒ core 报 interface-load
      writeFileSync(join(dir, "probe.nudo.js"), `export const f = ;\n`, "utf-8");

      const sent = await publish(file, src);
      const loadDiags = sent.filter((d) => d.code === DIAG_INTERFACE_LOAD);
      expect(loadDiags.length).toBeGreaterThan(0);
      expect(loadDiags[0].severity).toBe(1); // DiagnosticSeverity.Error
      // 不得被降级成「无契约根」的误报（侧车在，只是加载失败）
      const entryOnly = sent.filter((d) => d.code === "nudo:interface-entry-only");
      expect(entryOnly).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearValidationState();
    }
  });

  it("负控制：好侧车 ⇒ 无 interface-load error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-495b-"));
    try {
      const file = join(dir, "probe.js");
      const src = `export function f(x) { return x; }\n`;
      writeFileSync(file, src, "utf-8");
      writeFileSync(
        join(dir, "probe.nudo.js"),
        `import { fn, number } from "@nudojs/core";\n\nexport const f = fn({ x: number() }, number());\n`,
        "utf-8",
      );

      const sent = await publish(file, src);
      expect(sent.filter((d) => d.code === DIAG_INTERFACE_LOAD)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearValidationState();
    }
  });
});
