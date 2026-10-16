import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { runTranspiled, callTranspiledExportFull, formatShape } from "@nudojs/core";
import { evalAbsModuleGraph, clearAbsModuleCache } from "../abs-modules-graph.ts";
import { tmpProject } from "./tmp-project.ts";

/**
 * Bug ②（ESM live binding）：import 绑定是间接引用，不是装载时刻快照。
 * 地面真值（真实 JS）：`export let count = 1; export function bump() { count = 2; }`
 * + `import { count, bump }; bump(); return count;` → 2。
 * 覆盖：named / namespace / export * 链 / re-export 别名 / 跨模块内部变异，
 * 以及写侧洞（对 import 绑定赋值 → TypeError，ESM "Assignment to constant
 * variable" 语义）与既有正确行为的回归锚（依赖顶层连续变异、default 匿名
 * 函数导入、变异前读取仍精确）。
 */

const UTIL = `export let count = 1;\nexport function bump() { count = 2; }\n`;
const COUNTER = `export let n = 1;\nexport function set(v) { n = v; }\n`;

function setup(files: Record<string, string>, entry: string, entrySrc: string) {
  const dir = tmpProject("nudo-live-bind-", { ...files, [entry]: entrySrc });
  const entryFile = join(dir, entry);
  const graph = evalAbsModuleGraph(entrySrc, entryFile, {});
  const run = runTranspiled(entrySrc, { mode: "analyze", modules: graph.modules });
  return { run, graph };
}

beforeEach(() => {
  clearAbsModuleCache();
});

describe("ESM live binding (Bug ②)", () => {
  it("named import reads dep's current value after mutation (real JS: 2)", () => {
    const { run } = setup(
      { "util2.js": UTIL },
      "entry.js",
      `import { count, bump } from "./util2.js";\nexport function f() { bump(); return count; }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "f", []).result)).toBe("2");
  });

  it("read before mutation stays exact 1 (no cross-read smear)", () => {
    const { run } = setup(
      { "util2.js": UTIL },
      "entry.js",
      `import { count, bump } from "./util2.js";\nexport function before() { return count; }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "before", []).result)).toBe("1");
  });

  it("namespace member read is live (U.bump(); U.count → 2)", () => {
    const { run } = setup(
      { "util2.js": UTIL },
      "entry.js",
      `import * as U from "./util2.js";\nexport function ns() { U.bump(); return U.count; }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "ns", []).result)).toBe("2");
  });

  it("captured namespace stays live (const N = U; U.bump(); N.count → 2)", () => {
    // 真实 ESM：namespace 对象成员读取恒 live（捕获同一对象不冻结成员）
    const { run } = setup(
      { "util2.js": UTIL },
      "entry.js",
      `import * as U from "./util2.js";\nexport function nsCapture() { const N = U; U.bump(); return N.count; }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "nsCapture", []).result)).toBe("2");
  });

  it("re-exported namespace (export * as) members stay live", () => {
    const { run } = setup(
      { "util2.js": UTIL, "midns.js": `export * as U from "./util2.js";\n` },
      "entry.js",
      `import * as M from "./midns.js";\nexport function nsStar() { M.U.bump(); return M.U.count; }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "nsStar", []).result)).toBe("2");
  });

  it("export * chain forwards live values (set(7) via mid → n === 7)", () => {
    const { run } = setup(
      { "util.js": COUNTER, "mid.js": `export * from "./util.js";\n` },
      "entry.js",
      `import { n, set } from "./mid.js";\nexport function star() { set(7); return n; }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "star", []).result)).toBe("7");
  });

  it("re-export alias stays live (set(7); num → 7)", () => {
    const { run } = setup(
      { "util.js": COUNTER, "mid2.js": `export { n as num, set } from "./util.js";\n` },
      "entry.js",
      `import { num, set } from "./mid2.js";\nexport function alias() { set(7); return num; }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "alias", []).result)).toBe("7");
  });

  it("chain: mid's own import binding refreshes after mid calls util mutator", () => {
    const { run } = setup(
      {
        "util.js": COUNTER,
        "mid3.js": `import { n, set } from "./util.js";\nexport function apply(v) { set(v); return n; }\n`,
      },
      "entry.js",
      `import { apply } from "./mid3.js";\nexport function chain() { return apply(9); }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "chain", []).result)).toBe("9");
  });

  it("assignment to import binding folds TypeError (ESM const binding)", () => {
    const { run } = setup(
      { "util2.js": UTIL },
      "entry.js",
      `import { count } from "./util2.js";\nexport function assign() { count = 5; }\n`,
    );
    const r = callTranspiledExportFull(run, "assign", []);
    expect(formatShape(r.throws)).toContain("TypeError");
  });

  it("for (let count of …) header shadows import name: assignment stays legal", () => {
    // 遮蔽回归锚：let 头绑定遮蔽 import 名（Bug ② const 面扣除），
    // 循环内赋值不得误折 TypeError
    const { run } = setup(
      { "util2.js": UTIL },
      "entry.js",
      `import { count, bump } from "./util2.js";\nexport function shadow() { let acc = 0; for (let count of [1, 2]) { count = count + 1; acc = acc + count; } return acc; }\n`,
    );
    // 真实 JS：iter1 count=1→2, acc=2；iter2 count=2→3, acc=5
    expect(formatShape(callTranspiledExportFull(run, "shadow", []).result)).toBe("5");
  });

  it("regression: dep top-level consecutive mutation still visible (k = 2)", () => {
    const { run } = setup(
      { "util3.js": `export let k = 1;\nk = 2;\n` },
      "entry.js",
      `import { k } from "./util3.js";\nexport function top() { return k; }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "top", []).result)).toBe("2");
  });

  it("regression: default anonymous function import still callable", () => {
    const { run } = setup(
      { "util4.js": `export default function (x) { return x + 1; }\n` },
      "entry.js",
      `import d from "./util4.js";\nexport function useDefault() { return d(41); }\n`,
    );
    expect(formatShape(callTranspiledExportFull(run, "useDefault", []).result)).toBe("42");
  });
});
