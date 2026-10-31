/**
 * BUG-090 —— LSP 面在**模块环**上丢弃整张依赖图 ⇒ CLI `nudo check` 报的
 * `nudo:recursion-truncated` 在 IDE **永不出现**（verbose 档也一样）。
 *
 * 症状（tmp/repro/bug-090/，a.js ↔ b.js 互相 import，package.json 开
 * `nudo.analysis.diagnostics: "verbose"`）：CLI `check --json` 的 issue 码集合为
 * `{nudo:opaque-result, nudo:recursion-truncated, nudo:module-cycle}`，
 * 而 LSP 的 push / pull 两个通道都只有
 * `{nudo:opaque-result, nudo:module-cycle}` —— 少的那条恰是「该结果被递归截断
 * 放宽」的唯一归因 ⇒ IDE 用户无法判断要不要补 case/预算。
 *
 * 根因：`validation.ts` 的 `evalAnalysisModules` 检出环就 `return undefined`
 * （整图丢弃），而 CLI 早已废弃该分支（Bug 456：环由引擎有界处理，求值层由
 * call-budget 截断并归因）。图被丢 ⇒ 环内 import 全部落空 ⇒ 截断归因诊断消失。
 *
 * 修法：环时**不再丢图**（`graph.modules` 非空即返回），环本身仍由
 * `nudo:module-cycle` 报告。
 *
 * 钉：verbose 档下 **pull** 通道（`textDocument/diagnostic`）对 a.js 的 code 集合
 * 含 `nudo:recursion-truncated` / `nudo:module-cycle` / `nudo:opaque-result`
 * （CLI 面同款集合），**push** 通道（didOpen → `publishDiagnostics`）同码集。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection, withLspServer } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

const A = `import { b } from "./b.js";

export function a() {
  return b();
}
`;

const B = `import { a } from "./a.js";

export function b() {
  return a();
}
`;

/** 打开 verbose 档（info 级诊断必须上屏，否则「缺码」会与档位过滤混淆）。 */
const PKG = JSON.stringify({
  name: "p",
  nudo: { analysis: { diagnostics: "verbose" } },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("BUG-090 — 模块环不再丢图 ⇒ 截断归因诊断上屏", () => {
  it("pull 通道对 a.js 报告 nudo:recursion-truncated + nudo:module-cycle", async () => {
    await withLspServer(
      { "a.js": A, "b.js": B, "package.json": PKG },
      async (ctx) => {
        // 环图装载 + 有界求值 + 多轮 validate 都需要时间
        await sleep(1200);
        const res: any = await ctx.req("textDocument/diagnostic")({
          textDocument: { uri: ctx.uri("a.js") },
        });
        const items: any[] = res?.items ?? [];
        const codes = items.map((d) => d.code);

        expect(codes, `pull 诊断码：${JSON.stringify(codes)}`).toContain(
          "nudo:recursion-truncated",
        );
        // 环本身仍如实报告（修复不是靠「不报环」换来的）
        expect(codes, `pull 诊断码：${JSON.stringify(codes)}`).toContain(
          "nudo:module-cycle",
        );
        // verbose 档下 CLI 同一文件的第三条码也必须在屏（档位未失效）
        expect(codes, `pull 诊断码：${JSON.stringify(codes)}`).toContain(
          "nudo:opaque-result",
        );
      },
      "nudo-bug090-",
    );
  }, 60_000);

  it("push 通道（didOpen → publishDiagnostics）与 pull 同码集", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug090-push-"));
    try {
      writeFileSync(join(dir, "package.json"), PKG, "utf-8");
      writeFileSync(join(dir, "a.js"), A, "utf-8");
      writeFileSync(join(dir, "b.js"), B, "utf-8");
      const uri = `file://${join(dir, "a.js")}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      for (const [name, text] of [
        ["a.js", A],
        ["b.js", B],
      ] as const) {
        mock.notifications.get("textDocument/didOpen")!({
          textDocument: {
            uri: `file://${join(dir, name)}`,
            languageId: "javascript",
            version: 1,
            text,
          },
        });
      }
      await sleep(1200);
      const codes = mock.sentDiagnostics
        .filter((p: any) => p.uri === uri)
        .flatMap((p: any) => p.diagnostics)
        .map((d: any) => d.code);
      expect(codes, `push 诊断码：${JSON.stringify(codes)}`).toContain(
        "nudo:recursion-truncated",
      );
      expect(codes, `push 诊断码：${JSON.stringify(codes)}`).toContain(
        "nudo:module-cycle",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
