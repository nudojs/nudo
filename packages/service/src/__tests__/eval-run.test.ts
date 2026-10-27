import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTranspiled, callTranspiledExport, callTranspiledExportFull, $lit, litValue, numLit } from "@nudojs/core";
import { tryEvalCall, tryEvalCallFull, analyzeFile } from "@nudojs/service";
import { formatShape } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";

function tmpPair(math: string, main: string) {
  const dir = tmpProject("nudo-eval-imp-");
  writeFileSync(join(dir, "math.js"), math, "utf-8");
  writeFileSync(join(dir, "main.js"), main, "utf-8");
  return { dir, mainPath: join(dir, "main.js"), main };
}

describe("evaluator imported functions", () => {
  it("runTranspiled + injected JS exports from dep", () => {
    const dep = runTranspiled(`export function double(x) { return x * 2; }`);
    const main = runTranspiled(
      `import { double } from "./math.js";
export function run(n) { return double(n); }`,
      { modules: { "./math.js": dep as never } },
    );
    const r = callTranspiledExport(main, "run", [$lit(21)]);
    expect(litValue(r)).toEqual({ ok: true, value: 42 });
  });

  it("tryEvalCall via module graph (Abs absFunction dep)", () => {
    const { main, mainPath } = tmpPair(
      `export function double(x) { return x * 2; }`,
      `import { double } from "./math.js";
export function run(n) { return double(n); }
`,
    );
    const r = tryEvalCall(main, mainPath, "run", [$lit(21)]);
    expect(r).toBeDefined();
    expect(litValue(r!)).toEqual({ ok: true, value: 42 });
  });

  it("analyzeFile case polish uses eval path for relative import", () => {
    const { dir, main, mainPath } = tmpPair(
      `export function triple(x) { return x * 3; }`,
      `import { triple } from "./b.js";
/**
 * @nudo:case "four" (4)
 */
export function run(n) { return triple(n); }
`.replace("./b.js", "./math.js"),
    );
    void dir;
    const result = analyzeFile(mainPath, main);
    const run = result.functions.find((f) => f.name === "run");
    expect(run).toBeDefined();
    const c = run!.cases.find((x) => x.name === "four");
    expect(c).toBeDefined();
    expect(formatShape(c!.abs)).toBe("12");
    // 求值引擎应挂上 intension
    expect(c!.intension?.abs ?? c!.intension?.display).toBeTruthy();
  });

  it("object slots holding functions become first-class Abs fns (no raw JS leak)", () => {
    // 回归：transpile 把函数表达式编译成真实 JS 函数；流进对象槽后
    // 下游 absToTypeValue 读 .shape 曾裸崩（Cannot read properties of undefined (reading 'k')）
    const dir = tmpProject("nudo-eval-fnslot-");
    const p = join(dir, "main.js");
    const src = `
function helper(a, b) { return a; }
export function make() {
  const f = (x) => x + 1;
  return { load: f, arrow: (y) => y, ref: helper };
}
`;
    writeFileSync(p, src, "utf-8");
    const r = tryEvalCall(src, p, "make", []);
    expect(r).toBeDefined();
    expect(r!.shape.k).toBe("obj");
    const slots = (r!.shape as { slots: Record<string, { value: { shape: { k: string; params?: string[] } } }> }).slots;
    expect(slots.load.value.shape.k).toBe("fn");
    expect(slots.arrow.value.shape.params).toEqual(["y"]);
    // 声明函数引用无参数名可恢复 → argN 回退（与 analyzer extractParamNames 口径一致）
    expect(slots.ref.value.shape.params).toEqual(["arg0", "arg1"]);
  });
});

describe("service analysis prefers source-local function over same-name re-export", () => {
  const MAIN = `function g() { return 2; }
export { g } from "./dd.js";
`;

  it("tryEvalCallFull resolves local g; export face/call stays the re-export", () => {
    const dir = tmpProject("nudo-eval-collision-", {
      "main.js": MAIN,
      "dd.js": `export const g = 1;\n`,
    });
    const mainPath = join(dir, "main.js");

    // 分析面：service 真实入口（tryEvalCall / derivation 共用 tryEvalCallFull
    // => preferLocal）读源码本地 g，而不是同名 re-export。
    const full = tryEvalCallFull(MAIN, mainPath, "g", []);
    expect(full).toBeDefined();
    expect(litValue(full!.result)).toEqual({ ok: true, value: 2 });

    // 导出面：run 表键只有 g（re-export 值 1）；默认调用走导出槽。
    const run = runTranspiled(MAIN, {
      mode: "exec",
      modules: { "./dd.js": { named: { g: numLit(1) }, evaluated: true } },
    });
    expect(Object.keys(run)).toEqual(["g"]);
    expect(litValue(callTranspiledExportFull(run, "g", []).result)).toEqual({
      ok: true,
      value: 1,
    });

    // 分析面 Symbol 仍存在且非枚举（preferLocal 依赖它；上面的 service
    // 入口结果 2 已实证它在真实链路上存活）。
    const analysisSym = Object.getOwnPropertySymbols(run).find(
      (s) => s === Symbol.for("nudo.analysis"),
    );
    expect(analysisSym).toBeDefined();
    expect(Object.getOwnPropertyDescriptor(run, analysisSym!)?.enumerable).toBe(false);
    expect(
      litValue(callTranspiledExportFull(run, "g", [], { preferLocal: true }).result),
    ).toEqual({ ok: true, value: 2 });
  });
});

describe("transpile import emission", () => {
  it("preserves relative import", async () => {
    const { transpile } = await import("@nudojs/core");
    const out = transpile(
      `import { double } from "./math.js";
export function run(n) { return double(n); }`,
    );
    expect(out).toContain('from "./math.js"');
    expect(out).toContain("double");
  });
});
