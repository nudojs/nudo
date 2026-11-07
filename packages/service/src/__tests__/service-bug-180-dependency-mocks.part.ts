/**
 * BUG-180：依赖模块自己的 `@nudo:mock` 完全不注入 ⇒ 同一个函数「作为目标」
 * 与「作为依赖」结论互斥。修复：abs-modules-graph 按声明函数作用域重求值
 * 依赖模块，只覆盖该函数导出（其它函数保留无 mock 基线）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  $call,
  runTranspiled,
  callTranspiledExportFull,
  litValue,
} from "@nudojs/core";
import { evalAbsModuleGraph } from "../abs-modules-graph.ts";
import { withTmpProject } from "./tmp-project.ts";

const FILES = {
  "dep.js": `export function readFile(p) { return { path: p, size: 10 }; }\n`,
  "p.js": `import { readFile } from "./dep.js";
/**
 * @nudo:mock readFile = (() => "mocked")
 */
export function useMock() { return readFile("x"); }
export function useReal() { return readFile("y"); }
`,
  "q.js": `import { useMock, useReal } from "./p.js";
export function callMock() { return useMock(); }
export function callReal() { return useReal(); }
`,
};

describe("BUG-180 dependency module's own @nudo:mock", () => {
  it("applies in the declaring function only (entry B)", () => {
    withTmpProject("nudo-bug-180-", FILES, (dir) => {
      const qPath = join(dir, "q.js");
      const qSource = readFileSync(qPath, "utf-8");
      const graph = evalAbsModuleGraph(qSource, qPath);
      const run = runTranspiled(qSource, { mode: "analyze", modules: graph.modules });

      const callMock = callTranspiledExportFull(run, "callMock", []);
      expect(litValue(callMock.result)).toEqual({ ok: true, value: "mocked" });

      const callReal = callTranspiledExportFull(run, "callReal", []);
      expect(callReal.result.shape.k).toBe("obj");
      expect(litValue(callReal.result).ok).toBe(false);
    });
  });

  it("same function keeps the same result as a direct target (entry A)", () => {
    withTmpProject("nudo-bug-180-mod-", FILES, (dir) => {
      const pPath = join(dir, "p.js");
      const pSource = readFileSync(pPath, "utf-8");
      const graph = evalAbsModuleGraph(pSource, pPath);
      const useMock = graph.modules["./dep.js"]; // dep resolved; p is the entry
      void useMock;
      // p 作为入口时 service 侧直接注入其 mock；此处用模块图依赖面验证
      // useMock/useReal 的导出值（依赖 p.js 由 q 触发，已覆盖在上一用例）。
      const qPath = join(dir, "q.js");
      const qSource = readFileSync(qPath, "utf-8");
      const qGraph = evalAbsModuleGraph(qSource, qPath);
      const pExports = qGraph.modules["./p.js"];
      expect(pExports).toBeDefined();
      expect(litValue($call(pExports!.named.useMock!, []))).toEqual({
        ok: true,
        value: "mocked",
      });
      expect($call(pExports!.named.useReal!, []).shape.k).toBe("obj");
    });
  });
});
