/**
 * Bug 456：ESM import 环（a ⇄ b）——环内第一次调用恒定值、同一导出按调用次序不再漂移。
 *
 * 原生 oracle（node ESM）：probe(2) → 0（a(2) → b(1) → a(0) → 0），连续三次都是 0。
 * 改前：环内先求值的一侧（b）绑定到 unknown（a 尚未求值）⇒ 第一次调用得 unknown，
 * 第二次起才正确（同一导出按调用次序给出不同结果）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { evalAbsModuleGraph, clearAbsModuleCache } from "../abs-modules-graph.ts";
import { runTranspiled, callTranspiledExportFull, numLit, type Abs } from "@nudojs/core";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

const A = `import { b } from "./b.js";
export function a(n) { return n <= 0 ? 0 : b(n - 1); }
`;
const B = `import { a } from "./a.js";
export function b(n) { return n <= 0 ? 1 : a(n - 1); }
`;
const ENTRY = `import { a } from "./a.js";
export function probe() { return a(2); }
`;

function tmpProject(files: Record<string, string>): string {
  return makeTmpProject("nudo-b456-", files);
}

/** 入口导出连调三次的返回值（原生 oracle：0 / 0 / 0） */
function callProbeThrice(dir: string): Abs[] {
  const file = join(dir, "index.js");
  const graph = evalAbsModuleGraph(ENTRY, file);
  const run = runTranspiled(ENTRY, { mode: "analyze", modules: graph.modules as never });
  return [0, 1, 2].map(() => callTranspiledExportFull(run, "probe", []).result);
}

describe("Bug 456 ESM import 环：环内调用恒定值", () => {
  it("环内第一次调用即得正确值（改前：unknown）", () => {
    const dir = tmpProject({ "a.js": A, "b.js": B, "index.js": ENTRY });
    clearAbsModuleCache();
    const results = callProbeThrice(dir);
    // 第一次调用就必须是 0（原生 oracle），不是 unknown
    expect(results[0]!.shape.k).not.toBe("unknown");
    expect(results[0]!.term).toEqual({ op: "lit", value: 0 });
  });

  it("同一导出按调用次序不再漂移（改前：unknown / 0 / 0）", () => {
    const dir = tmpProject({ "a.js": A, "b.js": B, "index.js": ENTRY });
    clearAbsModuleCache();
    const results = callProbeThrice(dir);
    for (const r of results) {
      expect(r.shape.k).not.toBe("unknown");
      expect(r.term).toEqual({ op: "lit", value: 0 });
    }
  });

  it("环仍被报为装载问题（诊断面不变）", () => {
    const dir = tmpProject({ "a.js": A, "b.js": B, "index.js": ENTRY });
    clearAbsModuleCache();
    const graph = evalAbsModuleGraph(ENTRY, join(dir, "index.js"));
    expect(graph.issues.some((i) => i.kind === "cycle")).toBe(true);
  });

  it("负控制：非环的跨模块调用不受影响（值与改前一致）", () => {
    const dir = tmpProject({
      "math.js": `export function double(x) { return x * 2; }\n`,
      "index.js": `import { double } from "./math.js";
export function probe() { return double(21); }
`,
    });
    clearAbsModuleCache();
    const src = `import { double } from "./math.js";
export function probe() { return double(21); }
`;
    const file = join(dir, "index.js");
    const graph = evalAbsModuleGraph(src, file);
    const run = runTranspiled(src, { mode: "analyze", modules: graph.modules as never });
    const r = callTranspiledExportFull(run, "probe", []);
    expect(r.result.term).toEqual({ op: "lit", value: 42 });
  });

  it("负控制：环内显式实参调用同样恒定（a(2) 直调）", () => {
    const dir = tmpProject({ "a.js": A, "b.js": B, "index.js": ENTRY });
    clearAbsModuleCache();
    const file = join(dir, "index.js");
    const graph = evalAbsModuleGraph(ENTRY, file);
    const run = runTranspiled(ENTRY, { mode: "analyze", modules: graph.modules as never });
    const r = callTranspiledExportFull(run, "probe", [numLit(2)]);
    expect(r.result.term).toEqual({ op: "lit", value: 0 });
  });
});
