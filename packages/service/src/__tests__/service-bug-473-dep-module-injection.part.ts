/**
 * Bug 473 —— 依赖模块里的行内指令（@nudo:as / @nudo:replace）注入。
 *
 * 注入表此前**只对 root source** 采集（tryRunEval 的
 * `collectEvalReplacements(source)`）；依赖模块走 abs-modules-graph 的另一条
 * 转译入口（`tryRunTranspiled`），**完全不传**注入表 ⇒ 同一个文件「作为根」
 * 与「作为依赖」给出**不同类型**。
 *
 * 本分片交付：eval-run 侧抽出 `resolveEvalInjection(source)`（依赖模块转译
 * 入口按其源码取注入表的唯一入口）+ 根侧注入回归钉。
 *
 * ⚠️ 依赖侧的接线点在 `packages/service/src/abs-modules-graph.ts`
 * （**C 分片文件 —— 本分片只读 + 越界上报**）：依赖求值与
 * `collectAbsBindingsFromGraph` 两处 `tryRunTranspiled` 都要带上
 * `...resolveEvalInjection(source)`。该接线已由接线 worker 落地
 * （收集器下沉到叶子模块 `eval-injection.ts`，两侧同源）⇒ 下面最后一条
 * 用例已摘掉 `it.fails` 旗标。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { collectEvalReplacements, resolveEvalInjection } from "../eval-run.ts";
import { tmpProject } from "./tmp-project.ts";

const DEP_JS = `// @nudo:as shape({ port: number() })
const cfg = JSON.parse("{}");
export function getCfg() { return cfg; }
`;

describe("Bug 473 — 注入表解析入口", () => {
  it("带指令的源码解析出注入包（as 目标 + 覆盖值）", () => {
    const inj = resolveEvalInjection(DEP_JS);
    expect(inj).toBeDefined();
    expect(inj?.asOverrideTargets?.length).toBe(1);
    expect(inj?.asOverrides).toBeDefined();
  });

  it("无指令的源码不产生注入包", () => {
    expect(resolveEvalInjection("export function f() { return 1; }\n")).toBeUndefined();
  });

  it("注入包与收集器同源（目标区间一致）", () => {
    const reps = collectEvalReplacements(DEP_JS);
    const inj = resolveEvalInjection(DEP_JS);
    expect(inj?.asOverrideTargets).toEqual(reps.asTargets);
  });
});

describe("Bug 473 — 根侧注入不受影响", () => {
  it("作为根分析时，@nudo:as 覆盖承载语句的值", () => {
    const dir = tmpProject("nudo-bug473-root-");
    const source = `/// @nudo:env es

export function f() {
  // @nudo:as number()
  const y = "hello";
  return y;
}
`;
    const result = analyzeFile(join(dir, "root.js"), source);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe("number");
  });
});

describe("Bug 473 — 依赖侧注入（接线后转绿）", () => {
  it("依赖模块里的 @nudo:as 生效（依赖侧接线后转绿）", () => {
    const dir = tmpProject("nudo-bug473-dep-", {
      "dep.js": DEP_JS,
      "main.js": `import { getCfg } from "./dep.js";
export function call() { return getCfg(); }
`,
    });
    const result = analyzeFile(join(dir, "main.js"), `import { getCfg } from "./dep.js";
export function call() { return getCfg(); }
`);
    const fn = result.functions.find((f) => f.name === "call");
    // 期望：{ port: number }（依赖模块的指令生效）
    expect(formatShape(fn?.cases[0].abs as never)).toBe("{ port: number }");
  });
});
