/**
 * validateText 文档 version 门回归（BUG-021 / S5-003）。
 * 回归背景：stillCurrent 只比 validateGeneration——didChange 不 bump
 * generation，慢分析（await 期间）文档已更新时，旧结果会发布到
 * 新 buffer（squiggle 错位 / 幽灵报错）。修复：generation 之外
 * 再比打开文档的当前 version；发布带启动时 version（LSP 3.15
 * PublishDiagnosticsParams.version，宿主客户端据此丢弃陈旧发布）。
 */
import { describe, it, expect } from "vitest";
import { validateText, type ValidateTextDeps } from "../validation.ts";
import { clearValidationState } from "../validation.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC_V1 = `export function f(x) {
  return x;
}
`;
const SRC_V2 = `export function f(x) {
  return x.toFixed(2);
}
`;

describe("validateText 文档 version 门（BUG-021）", () => {
  it("superseded 文档版本的慢分析不发布陈旧诊断", async () => {
    clearValidationState();
    const dir = mkdtempSync(join(tmpdir(), "nudo-vgate-"));
    try {
      const filePath = join(dir, "a.js");
      // 带相对导入：分析中段会经 deps.loadModule 取依赖（E5 路径）——
      // 用它做「慢分析进行中」的接缝，无需 mock 实现
      const SRC_V1 = `import { g } from "./b.js";\nexport function f(x) {\n  return g(x);\n}\n`;
      const SRC_V2 = `import { g } from "./b.js";\nexport function f(x) {\n  return g(x).toFixed(2);\n}\n`;
      writeFileSync(filePath, SRC_V1);
      writeFileSync(join(dir, "b.js"), `export function g(x) { return x; }\n`);
      const uri = "file://" + filePath;

      // 文档跟踪器：version 可变（模拟宿主 didChange 实时更新）
      const doc = { uri, version: 1, getText: () => SRC_V1 };
      const sent: Array<{ uri: string; version?: number; n: number }> = [];
      const deps: ValidateTextDeps = {
        sendDiagnostics: (p) =>
          sent.push({ uri: p.uri, version: p.version, n: p.diagnostics.length }),
        getOpenDocumentByPath: () => doc,
        loadModule: (spec) => {
          if (spec.endsWith("b.js")) {
            // 分析中段：文档推进到 v2（didChange 先更新跟踪器，
            // 防抖排队的新 validate 尚未启动）
            doc.version = 2;
            doc.getText = () => SRC_V2;
          }
          return `export function g(x) { return x; }`;
        },
      };

      await validateText(filePath, uri, SRC_V1, 1, deps);

      // v1 的慢分析被 v2 取代（generation 未变但文档 version 已变）
      // → 不得发布任何陈旧诊断
      expect(sent).toEqual([]);

      // 对照：以当前 v2 文本/版本重验 → 正常发布（证明上一轮
      // 的沉默是 version 门拦截，而非分析失败/异常路径）
      await validateText(filePath, uri, SRC_V2, 2, deps);
      expect(sent.length).toBe(1);
      expect(sent[0]!.version).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("未变更文档的分析正常发布且带启动时 version", async () => {
    clearValidationState();
    const dir = mkdtempSync(join(tmpdir(), "nudo-vgate2-"));
    try {
      const filePath = join(dir, "a.js");
      writeFileSync(filePath, SRC_V1);
      const uri = "file://" + filePath;
      const doc = { uri, version: 1, getText: () => SRC_V1 };
      const sent: Array<{ uri: string; version?: number }> = [];
      const deps: ValidateTextDeps = {
        sendDiagnostics: (p) => sent.push({ uri: p.uri, version: p.version }),
        getOpenDocumentByPath: () => doc,
      };
      await validateText(filePath, uri, SRC_V1, 1, deps);
      expect(sent.length).toBe(1);
      expect(sent[0]!.version).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("无文档跟踪的宿主回落 generation-only 口径（照常发布）", async () => {
    clearValidationState();
    const dir = mkdtempSync(join(tmpdir(), "nudo-vgate3-"));
    try {
      const filePath = join(dir, "a.js");
      writeFileSync(filePath, SRC_V1);
      const uri = "file://" + filePath;
      const sent: Array<{ uri: string; version?: number }> = [];
      const deps: ValidateTextDeps = {
        sendDiagnostics: (p) => sent.push({ uri: p.uri, version: p.version }),
        // 宿主不提供文档跟踪 → 不加 version 门
      };
      await validateText(filePath, uri, SRC_V1, 1, deps);
      expect(sent.length).toBe(1);
      expect(sent[0]!.version).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
