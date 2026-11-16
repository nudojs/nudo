/**
 * 模块套件：service analysis/callsite/entry/diagnostics 面。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { analyzeFile, collectCallRecords, analyzeFileAsync as analyzeFileAsync_____analyzer_ts } from "../analyzer.ts";
import { litValue, numLit, type Abs, formatShape, resetCheckSourceMemo, resetGeneralizeMemo, resetNudoModuleExecCache, resetParseSourceCache, abs, strLit } from "@nudojs/core";
import { withTmpProject, writeTmpFile, tmpProject, writeTmpFiles, tmpProject as makeTmpProject } from "./tmp-project.ts";
import { synthesizeExternalFunctions, dedupeCallRecords } from "../analyzer-diagnose.ts";
import { MAX_RECORD_TYPE_NODES, neverAbs, type CallRecord } from "../evaluator/call-record.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitContract } from "../emit/contract-emitter.ts";
import { resetAbsCallBudget } from "@nudojs/core/internal";
import { analyzeFileAsync } from "@nudojs/service";
import { clearEvalCache } from "../eval-run.ts";
import { clearAbsModuleCache } from "../abs-modules-graph.ts";
import { disambiguateCallsiteNames, callsiteCaseName, caseExpectedSatisfied } from "../analyzer-orchestrate-uncached-cases.ts";
import { collectCallRecords as collectCallRecords_____analyzer_orchestrate_calls_ts, collectCallRecords as collectCallRecords_____analyzer_orchestrate_calls_ts_1, collectCallRecords as collectCallRecords_____analyzer_orchestrate_calls_ts_2 } from "../analyzer-orchestrate-calls.ts";
import { injectBindings, typeExprToDirective } from "../what-if.ts";
import type { Diagnostic } from "../analyzer-types.ts";
import { collectCheckSupplementIssues } from "../check-issues.ts";
import { collectParamBodyReadTypes } from "../emit/body-read-types.ts";
import { parseCaseArgExpr } from "@nudojs/parser";
import { insertGeneratedCaseDirectives } from "../emit/case-emitter.ts";
import { checkConfig, findProjectConfig, evictProjectConfigMemo, currentBForkBudgetLimit, applyBForkBudgetFromConfig } from "../evaluator/config.ts";
import { shouldAnalyzeFile } from "../analysis-scope.ts";
import { getSessionCacheLimits, resetSessionCacheLimitState } from "../session-cache-limits.ts";
import { entryVariantIssueForFile } from "../entry-variants.ts";
import { buildTestReport } from "../test-report.ts";

// ---------------------------------------------------------------------------
// 命名空间成员调用的调用点可归因（domain-exceeds 不再静默）
// ---------------------------------------------------------------------------
describe("命名空间成员调用的调用点可归因（domain-exceeds 不再静默）", () => {
/**
 * `--from` 注入的调用点记录在**命名空间成员调用**上无法归因 ⇒
 * `nudo:contract-domain-exceeds`（**error 级** L1 门禁）静默不报 ⇒ 假绿。
 *
 * 根因（analyzer-abs-eval.ts 的调用记录归因）：
 * - eval 侧对命名空间成员调用（`ns.helper(...)`）只记**成员名**（`helper`），
 * 不带接收者 ⇒ 归因侧的点号拆分**永远走不到** ⇒ `targetModule` /
 * `targetExport` 为空 ⇒ 匹配侧（`matchingExternal` 要求可归因到本文件）
 * 整条丢弃 ⇒ 越界调用点证据消失 ⇒ 门禁绿灯。
 * - CJS `const ns = require("./m.js")` 的 import 表条目登记成
 * `exportName: "default"` ⇒ 基名匹配（`exportName === "*"`）永远走不到。
 *
 * 修复后的契约（主 agent 裁决，D/E 共同遵守）：
 * - **命名空间成员调用**的记录名 = `<接收者绑定名>.<成员名>`（与类成员调用
 * `Brand.method` 同形；不带 `ns.` 前缀——接收者的名字是用户的**本地绑定名**）。
 * - **普通调用**（本地函数 / 具名导入 / 宿主全局）**保持现状**：只记函数名。
 * - 归因侧按**最后一个点**拆分：base = 接收者绑定名（查 import 表）·
 * member = 导出名。
 * - CJS `require` 的命名空间导入项：`exportName` 必须是 `"*"`。
 *
 * 钉：
 * - ESM `import * as` 与 CJS `require` 两种形态都要归因到**被调模块**。
 * - 记录名带接收者限定（`dep.g`），targetExport 是**成员名**（`g`）。
 * - 负控制：具名导入的记录名**不加前缀**（`g`）——既有快照面最小改动。
 * - 产品面：注入后 `nudo:contract-domain-exceeds` 必须是 **error**。
 */






const DOMAIN = "nudo:contract-domain-exceeds";

/** 被调模块：g 的契约是 x > 0（越界调用 -1 ⇒ 门禁必须报） */
const DEP = `export const g = (x) => x;
`;
const DEP_SIDE = `export const g = fn({ x: number().gt(0) }, number());
`;

describe("命名空间成员调用的调用点可归因（domain-exceeds 不再静默）", () => {
  const DOMAIN = "nudo:contract-domain-exceeds";
  const DEP = "export const g = (x) => x;\n";
  const DEP_SIDE = "export const g = fn({ x: number().gt(0) }, number());\n";
  it("ESM/CJS 命名空间带接收者限定并可归因；具名/对象方法无前缀；产品面 error", () => {
    withTmpProject("nudo-b286a-", (dir) => {
      const depPath = writeTmpFile(dir, "dep.js", DEP);
      const use = writeTmpFile(dir, "use.js", 'import * as dep from "./dep.js";\ndep.g(-1);\n');
      const rec = collectCallRecords(use, readFileSync(use, "utf-8")).find((r) => r.fnName === "dep.g");
      expect(rec).toBeDefined();
      expect(rec!.targetModule).toBe(depPath);
      expect(rec!.targetExport).toBe("g");
      expect(litValue(rec!.argAbs[0]!)).toEqual({ ok: true, value: -1 });
    });
    withTmpProject("nudo-b286b-", (dir) => {
      const depPath = writeTmpFile(dir, "dep.js", DEP);
      const use = writeTmpFile(dir, "use.js", 'const dep = require("./dep.js");\ndep.g(-1);\n');
      const rec = collectCallRecords(use, readFileSync(use, "utf-8")).find((r) => r.fnName === "dep.g");
      expect(rec).toBeDefined();
      expect(rec!.targetModule).toBe(depPath);
      expect(rec!.targetExport).toBe("g");
    });
    withTmpProject("nudo-b286c-", (dir) => {
      const depPath = writeTmpFile(dir, "dep.js", DEP);
      const use = writeTmpFile(dir, "use.js", 'import { g } from "./dep.js";\ng(-1);\n');
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "g");
      expect(rec).toBeDefined();
      expect(records.some((r) => r.fnName.includes("."))).toBe(false);
      expect(rec!.targetModule).toBe(depPath);
      expect(rec!.targetExport).toBe("g");
    });
    withTmpProject("nudo-b286d-", (dir) => {
      const use = writeTmpFile(dir, "use.js", "const o = { helper: (x) => x };\no.helper(-1);\n");
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      expect(records.some((r) => r.fnName === "helper")).toBe(true);
      expect(records.some((r) => r.fnName.includes("."))).toBe(false);
    });
    for (const src of ['import * as dep from "./dep.js";\ndep.g(-1);\n', 'const dep = require("./dep.js");\ndep.g(-1);\n']) {
      withTmpProject("nudo-b286e-", (dir) => {
        const depPath = writeTmpFile(dir, "dep.js", DEP);
        writeTmpFile(dir, "dep.nudo.js", DEP_SIDE);
        const use = writeTmpFile(dir, "use.js", src);
        const records = collectCallRecords(use, readFileSync(use, "utf-8"));
        const result = analyzeFile(depPath, readFileSync(depPath, "utf-8"), undefined, records);
        const issues = result.diagnostics.filter((d) => d.code === DOMAIN);
        expect(issues).toHaveLength(1);
        expect(issues[0]!.severity).toBe("error");
      });
    }
  });
});
;
});

// ---------------------------------------------------------------------------
// 超限调用记录不得让分析器崩溃
// ---------------------------------------------------------------------------
describe("超限调用记录不得让分析器崩溃", () => {
/**
 * 回归：跨模块调用记录全部**超限被丢**时，合成路径不得解引用空数组。
 *
 * 改前 `synthesizeExternalFunctions` 直接读 `deduped[0].callLoc` /
 * `deduped[0].resultAbs` ⇒ TypeError 抛出分析器（`nudo check` 吞掉异常后
 * 静默假绿，`nudo test` / `export` 直接崩溃）。
 */





/** > MAX_RECORD_TYPE_NODES 个形状节点的对象 Abs。 */
function oversizedObjAbs(): Abs {
  const slots: Record<string, { value: Abs }> = {};
  for (let i = 0; i < MAX_RECORD_TYPE_NODES + 500; i++) slots[`k${i}`] = { value: numLit(i) };
  return { shape: { k: "obj", slots }, conf: "exact" } as Abs;
}

function record(over: Partial<CallRecord>): CallRecord {
  return {
    fnName: "pick",
    argAbs: [numLit(1)],
    resultAbs: numLit(1),
    throwsAbs: neverAbs,
    callLoc: { line: 3, column: 0 },
    targetModule: "/proj/lib.js",
    targetExport: "pick",
    ...over,
  };
}

describe("超限调用记录不得让分析器崩溃", () => {
  const oversizedObjAbs = (): Abs => {
    const slots: Record<string, { value: Abs }> = {};
    for (let i = 0; i < MAX_RECORD_TYPE_NODES + 500; i++) slots[`k${i}`] = { value: numLit(i) };
    return { shape: { k: "obj", slots }, conf: "exact" } as Abs;
  };
  const record = (over: Partial<CallRecord>): CallRecord => ({
    fnName: "pick",
    argAbs: [numLit(1)],
    resultAbs: numLit(1),
    throwsAbs: neverAbs,
    callLoc: { line: 3, column: 0 },
    targetModule: "/proj/lib.js",
    targetExport: "pick",
    ...over,
  });
  it("全部超限整组跳过；正常记录照常合成", () => {
    expect(synthesizeExternalFunctions([record({ argAbs: [oversizedObjAbs()] }), record({ argAbs: [oversizedObjAbs()] })], "/proj/main.js")).toEqual([]);
    const out = synthesizeExternalFunctions([record({})], "/proj/main.js");
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("pick");
    expect(out[0]!.loc.start.line).toBe(3);
    expect(out[0]!.combinedAbs).toBeDefined();
  });
});
;
});

// ---------------------------------------------------------------------------
// 点观测不得成为契约域
// ---------------------------------------------------------------------------
describe("点观测不得成为契约域", () => {
/**
 * `nudo contract --emit` 把**一次点观测**（实参全是字面量）直接
 * 提升成契约 ⇒ `fn({ a: lit(1), b: lit(2) }, lit(3))` ⇒ 导出的 dts / zod /
 * guard 三面塌缩成那个单点字面量（`add(5, 6)` 被自己的产物判非法），且与
 * `nudo check` 的签名面（`number × number → number`）结论相反。
 *
 * 修法：观测 Abs 进投影器之前把**字面量 / 收窄谓词**剥到基类型；带断言的
 * `@nudo:case`（域声明）保持字面量。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-021-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("点观测不得成为契约域", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "nudo-b021-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  it("调用点字面量投影基类型；带断言 case 保留字面量", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function add(a, b) {\n  return a + b;\n}\nexport function caller() {\n  return add(1, 2);\n}\n");
    const r = await emitContract(file, { mode: "update", all: true });
    expect(r.written).toContain("add");
    const sidecar = readFileSync(join(dir, "lib.nudo.js"), "utf-8");
    expect(sidecar).toContain("export const add = fn({ a: number(), b: number() }, number());");
    expect(sidecar).not.toContain("lit(1)");
    expect(sidecar).not.toContain("lit(3)");

    const subFile = join(dir, "sub.js");
    writeFileSync(subFile, '/**\n * @nudo:case "c" (1, 2) => 3\n */\nexport function sub(a, b) {\n  return a - b;\n}\n');
    await emitContract(subFile, { mode: "update", all: true });
    const subSidecar = readFileSync(join(dir, "sub.nudo.js"), "utf-8");
    expect(subSidecar).toContain("export const sub = fn({ a: lit(1), b: lit(2) }, lit(-1));");
  });
});
;
});

// ---------------------------------------------------------------------------
// 调用点域与声明顺序无关
// ---------------------------------------------------------------------------
describe("调用点域与声明顺序无关", () => {
/**
 * 回归：被调方的**调用点域**不得被「首次 settle」截断。
 *
 * 症状（修前）：同一组函数，只改**声明顺序**就得到不同的调用点域 ——
 * 被调方先定义时只留下第一个调用方的调用点（`callee(2)` / `callee(3)` 被
 * 静默丢弃），于是 `nudo test` 少报见证、`nudo contract --emit` 写出偏窄的
 * 契约（合法调用被判违约），`nudo contract --draft` 沿「官方推荐路径」直接
 * 产出假红。
 *
 * 根因：`settleEntryOnlyCandidates()` 在**首次命中证据**时就把候选移出注册表
 * ⇒ 域 = 「第一次结算时已知的记录前缀」，与文件里的声明顺序强相关。被调方
 * 先被处理（还没有调用点证据）⇒ 回落 entry@；随后每个调用方处理完才补进
 * 记录，但注册表里已经没有该候选了。
 *
 * 修法：候选**保留**在注册表里，每轮结算用**当前全部**记录重合成（新增记录
 * 才重算），直到分析结束。
 *
 * 断言面（顺序无关性 = 语义等价代码应得等价结论）：
 * 1. 两种声明顺序下被调方的调用点见证数、实参域、结果域**完全一致**；
 * 2. `combinedAbs`（导出面 / dts / 契约用到的推断域）一致；
 * 3. `nudo:contract-entry-only` 不再误报被调方（它已有了调用点域）。
 */










beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  clearEvalCache();
  clearAbsModuleCache();
});

/** 被调方**先**定义（修前：域被截断成 1 条） */
const CALLEE_FIRST = `export function callee(a) {
  return a + 1;
}
export function caller1() {
  return callee(1);
}
export function caller2() {
  return callee(2);
}
export function caller3() {
  return callee(3);
}
`;

/** 同一组函数，被调方**后**定义（修前的正确形态，作为对照） */
const CALLEE_LAST = `export function caller1() {
  return callee(1);
}
export function caller2() {
  return callee(2);
}
export function caller3() {
  return callee(3);
}
export function callee(a) {
  return a + 1;
}
`;

async function analyze(source: string) {
  const dir = tmpProject("nudo-b022-");
  const file = join(dir, "m.js");
  writeFileSync(file, source, "utf-8");
  return analyzeFileAsync(file, source, undefined, undefined, undefined, "all");
}

/** 调用点见证的（实参域, 结果域）集合——见证名带行号，顺序无关比较用值 */
function callsiteDomain(
  result: Awaited<ReturnType<typeof analyze>>,
  fnName: string,
): { args: string[]; rets: string[] } {
  const fn = result.functions.find((f) => f.name === fnName);
  expect(fn, `${fnName} 必须被分析到`).toBeDefined();
  const calls = fn!.cases.filter((c) => c.source === "callsite");
  return {
    args: calls.map((c) => c.argAbs.map((a) => formatShape(a)).join(",")).sort(),
    rets: calls.map((c) => formatShape(c.abs)).sort(),
  };
}

describe("调用点域与声明顺序无关", () => {
  const CALLEE_FIRST = "export function callee(a) {\n  return a + 1;\n}\nexport function caller1() {\n  return callee(1);\n}\nexport function caller2() {\n  return callee(2);\n}\nexport function caller3() {\n  return callee(3);\n}\n";
  const CALLEE_LAST = "export function caller1() {\n  return callee(1);\n}\nexport function caller2() {\n  return callee(2);\n}\nexport function caller3() {\n  return callee(3);\n}\nexport function callee(a) {\n  return a + 1;\n}\n";
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetParseSourceCache();
    resetAbsCallBudget();
    clearEvalCache();
    clearAbsModuleCache();
  });
  const analyze = async (source: string) => {
    const dir = tmpProject("nudo-b022-");
    const file = join(dir, "m.js");
    writeFileSync(file, source, "utf-8");
    return analyzeFileAsync(file, source, undefined, undefined, undefined, "all");
  };
  const callsiteDomain = (result: Awaited<ReturnType<typeof analyze>>, fnName: string) => {
    const fn = result.functions.find((f) => f.name === fnName)!;
    expect(fn).toBeDefined();
    const calls = fn.cases.filter((c) => c.source === "callsite");
    return { args: calls.map((c) => c.argAbs.map((a) => formatShape(a)).join(",")).sort(), rets: calls.map((c) => formatShape(c.abs)).sort() };
  };
  it("先定义不截断；顺序无关 combined 一致；有调用点不再误报 entry-only", async () => {
    const first = await analyze(CALLEE_FIRST);
    const { args, rets } = callsiteDomain(first, "callee");
    expect(args).toEqual(["1", "2", "3"]);
    expect(rets).toEqual(["2", "3", "4"]);

    const last = await analyze(CALLEE_LAST);
    expect(callsiteDomain(first, "callee")).toEqual(callsiteDomain(last, "callee"));
    const combined = (r: Awaited<ReturnType<typeof analyze>>) => formatShape(r.functions.find((f) => f.name === "callee")!.combinedAbs!);
    expect(combined(first)).toBe(combined(last));
    expect(combined(first)).toBe("2 | 3 | 4");

    expect(first.diagnostics.filter((d) => d.code === "nudo:contract-entry-only" && d.message.includes("'callee'"))).toEqual([]);
    expect(first.diagnostics.filter((d) => d.code === "nudo:contract-entry-only" && d.message.includes("'caller1'"))).toHaveLength(1);
  });
});
;
});

// ---------------------------------------------------------------------------
// 同行多调用点的见证名唯一
// ---------------------------------------------------------------------------
describe("同行多调用点的见证名唯一", () => {
/**
 * 回归：「见证名 = 调用点身份」必须在**同一行多个调用点**时仍成立。
 *
 * 改前本地调用点只有行号维度 ⇒ 同一行两个调用点都叫 `call@L6` ⇒ 一个现场的
 * 见证凭空消失（声明了其中一个后另一个的观测真值被吞）。
 */





const FILE = "/proj/usage.js";

function rec(line: number, column: number, arg: number): CallRecord {
  return {
    fnName: "add",
    argAbs: [numLit(arg)],
    resultAbs: numLit(arg + 1),
    throwsAbs: neverAbs,
    callLoc: { line, column },
  };
}

describe("同行多调用点的见证名唯一", () => {
  const FILE = "/proj/usage.js";
  const rec = (line: number, column: number, arg: number): CallRecord => ({
    fnName: "add",
    argAbs: [numLit(arg)],
    resultAbs: numLit(arg + 1),
    throwsAbs: neverAbs,
    callLoc: { line, column },
  });
  it("同行两调用点加列维度；唯一调用点格式不变；列缺失退回序号", () => {
    const names = disambiguateCallsiteNames([rec(6, 0, 1), rec(6, 9, 3)], FILE, 1);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toBe("call@L6C0");
    expect(names[1]).toBe("call@L6C9");
    expect(disambiguateCallsiteNames([rec(6, 0, 1)], FILE, 1)).toEqual(["call@L6"]);
    expect(callsiteCaseName(rec(6, 0, 1), FILE, 1)).toBe("call@L6");
    const r1 = { ...rec(6, 0, 1), callLoc: undefined } as CallRecord;
    const r2 = { ...rec(6, 0, 2), callLoc: undefined } as CallRecord;
    expect(new Set(disambiguateCallsiteNames([r1, r2], FILE, 6)).size).toBe(2);
  });
});
;
});

// ---------------------------------------------------------------------------
// 调用现场文件按 AST 核对，不用行数猜
// ---------------------------------------------------------------------------
describe("调用现场文件按 AST 核对，不用行数猜", () => {
/**
 * 回归：调用记录的「调用现场文件」不得用**行数上界**猜。
 *
 * 改前 `rec.callLoc.line > lineCount` 是唯一判据：依赖模块里的调用
 * （`dep.js` 第 2 行）在「行号 ≤ 现场文件行数」时被误贴成现场文件 ⇒
 * 见证名 `call@usage.js:L2` 指向现场文件里根本不是该调用的行（甚至注释行），
 * 并与现场文件自己的调用**撞名**。
 *
 * 现判据：本文件在该位置确实有**调用表达式**（AST 核对）才贴；核不上就不贴。
 */





function project(collide: boolean): { dir: string; usage: string } {
  const dep = 'import { greet } from "./lib.js";\nexport const r = greet("from-dep");\n';
  // collide：现场文件第 2 行**恰好也是**调用（与 dep 同号不同列）
  const usage = collide
    ? 'import { greet } from "./lib.js";\nconst a = greet("from-usage");\nimport { r } from "./dep.js";\nexport const o = a;\nexport const p = r;\n'
    : 'import { greet } from "./lib.js";\n// line 2 is a COMMENT, definitely not a call\nimport { r } from "./dep.js";\nconst a = greet("from-usage");\nexport const o = a;\nexport const p = r;\n';
  const dir = tmpProject(collide ? "nudo-089-collide-" : "nudo-089-", {
    "lib.js": "export function greet(name) { return \"hi \" + name; }\n",
    "dep.js": dep,
    "usage.js": usage,
  });
  return { dir, usage };
}

describe("调用现场文件按 AST 核对，不用行数猜", () => {
  const project = (collide: boolean) => {
    const dep = 'import { greet } from "./lib.js";\nexport const r = greet("from-dep");\n';
    const usage = collide
      ? 'import { greet } from "./lib.js";\nconst a = greet("from-usage");\nimport { r } from "./dep.js";\nexport const o = a;\nexport const p = r;\n'
      : 'import { greet } from "./lib.js";\n// line 2 is a COMMENT, definitely not a call\nimport { r } from "./dep.js";\nconst a = greet("from-usage");\nexport const o = a;\nexport const p = r;\n';
    const dir = tmpProject(collide ? "nudo-089-collide-" : "nudo-089-", {
      "lib.js": 'export function greet(name) { return "hi " + name; }\n',
      "dep.js": dep,
      "usage.js": usage,
    });
    return { dir, usage };
  };
  it("依赖调用不贴现场文件；同号不同列保留现场调用", () => {
    const plain = project(false);
    const records = collectCallRecords_____analyzer_orchestrate_calls_ts(join(plain.dir, "usage.js"), plain.usage);
    const depRecord = records.find((r) => r.argAbs.length > 0 && r.callLoc?.line === 2);
    expect(depRecord).toBeDefined();
    expect(depRecord!.callSiteFile).toBeUndefined();

    const collide = project(true);
    const collision = collectCallRecords_____analyzer_orchestrate_calls_ts(join(collide.dir, "usage.js"), collide.usage);
    const local = collision.filter((r) => r.callSiteFile !== undefined);
    expect(local).toHaveLength(1);
    expect(local[0]!.callLoc!.line).toBe(2);
    expect(collision.filter((r) => r.callSiteFile === undefined).length).toBeGreaterThanOrEqual(1);
  });
});
;
});

// ---------------------------------------------------------------------------
// 循环迭代截断 → analysis 诊断（test 面）
// ---------------------------------------------------------------------------
describe("循环迭代截断 → analysis 诊断（test 面）", () => {
/**
 * （loop 面）回归：循环迭代预算截断必须在 **test 面**报**专用码**。
 *
 * 症状（修前）：`nudo check` 对「退出条件恒具体为真」的循环报
 * `nudo:loop-truncated`，而 `nudo test` 只把放宽后的结果（如 `-1024`）
 * 当正常观测打印、零诊断；即使把循环标签按调用截断映射，也会被
 * `label.startsWith("#")` 的兜底静默吞掉（`#loop-iterations` 带 `#` 前缀）。
 *
 * 归因口径（与 core `checkSource` 同）：循环预算**不是**递归、**不是**调用
 * 预算 —— `@nudo:budget calls=/depth=` 抬不动，suggestion 不得指向它。
 *
 * 断言面：
 * 1. 恒具体真的循环 ⇒ 恰好一条 `nudo:loop-truncated`（info），锚在文件起点
 * （事件不绑函数——collector 只给 `#loop-iterations` 标签，check 面对同一
 * 事件同样不给位置）；
 * 2. 措辞与 check 面同款（iteration budget），且**不**冒充递归截断；
 * 3. 同一次分析内多次求值不重复出诊断；
 * 4. 无循环截断的文件零误报。
 */










/** 出口条件恒具体为真（`i` 单调下行、从不可能 ≥ n）⇒ 抽象展开到上限 */
const INFINITE_LOOP = `export function infiniteDec(n) {
  let i = 0;
  while (i < n) { i = i - 1; }
  return i;
}
infiniteDec(5);
`;

/** 无循环 ⇒ 不得出现任何截断诊断 */
const PLAIN = `export function add(a, b) {
  return a + b;
}
`;

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  clearEvalCache();
  clearAbsModuleCache();
});

describe("循环迭代截断 → analysis 诊断（test 面）", () => {
  const INFINITE_LOOP = `export function infiniteDec(n) {
  let i = 0;
  while (i < n) { i = i - 1; }
  return i;
}
infiniteDec(5);
`;
  const PLAIN = "export function add(a, b) {\n  return a + b;\n}\n";
  beforeEach(() => {
    resetCheckSourceMemo(); resetGeneralizeMemo(); resetNudoModuleExecCache(); resetParseSourceCache(); resetAbsCallBudget(); clearEvalCache(); clearAbsModuleCache();
  });
  it("恒真循环一条 info 锚文件起点；措辞 iteration budget；无截断零误报", async () => {
    const dir = tmpProject("nudo-b099-loop-");
    const file = join(dir, "loop.js");
    writeFileSync(file, INFINITE_LOOP);
    const result = await analyzeFileAsync(file, INFINITE_LOOP);
    const loops = result.diagnostics.filter((d) => d.code === "nudo:loop-truncated");
    expect(loops).toHaveLength(1);
    const d = loops[0]!;
    expect(d.severity).toBe("info");
    expect(d.range.start.line).toBe(1);
    expect(d.range.start.column).toBe(0);
    expect(d.message).toContain("iteration budget");
    expect(d.message).not.toContain("Recursive evaluation");
    expect(d.suggestions?.join(" ")).not.toContain("@nudo:budget");
    expect(result.diagnostics.some((x) => x.code === "nudo:recursion-truncated")).toBe(false);
    expect(result.diagnostics.some((x) => x.code === "nudo:fork-truncated")).toBe(false);

    const cleanDir = tmpProject("nudo-b099-loop-clean-");
    const cleanFile = join(cleanDir, "plain.js");
    writeFileSync(cleanFile, PLAIN);
    const clean = await analyzeFileAsync(cleanFile, PLAIN);
    expect(clean.diagnostics.map((x) => x.code)).not.toContain("nudo:loop-truncated");
    expect(clean.diagnostics.map((x) => x.code)).not.toContain("nudo:recursion-truncated");
  });
});
;
});

// ---------------------------------------------------------------------------
// 截断观测 → analysis 诊断（test 面）
// ---------------------------------------------------------------------------
describe("截断观测 → analysis 诊断（test 面）", () => {
/**
 * 回归：引擎「放弃求值」必须在 **test 面可观测**。
 *
 * 症状（修前）：同一份递归源码，`nudo check` / `nudo health` 都报「求值被
 * 截断」，而 `nudo test`（人类面 + `--json`）**零诊断** —— 把放宽后的类型
 * （`0 | number | string`）当一次正常观测打印，断言段还报「0 failed」全绿。
 * 三个面对同一件事给出互斥结论；`nudo test --freeze` 还会把「引擎放弃」
 * 永久固化成 `@nudo:case` 事实。
 *
 * 根因：截断观测在 service 侧只被收进一个局部集合就地丢弃（从未映射成
 * 诊断），而 `nudo:recursion-truncated` 全仓唯一产地是 core 的 `checkSource`；
 * `nudo test` 从不调用它。文档承诺（website/docs/guides/performance.md）：
 * 「truncation never degrades results silently」。
 *
 * 修法：analysis 作用域安装截断 collector（`eval-run` 的嵌套 collector 改为
 * **链式转发**，否则单槽 collector 会把分析层的观察面静默掐断），结束时把
 * 事件映射成与 check 面**同码 / 同级 / 同措辞**的诊断。
 *
 * 断言面：
 * 1. 递归截断产出 `nudo:recursion-truncated`（severity info），锚在被求值
 * 函数声明处（1 基行号）；
 * 2. 归因措辞与 core check 一致（cycle ⇒ 明说抬预算无效）；
 * 3. 同一事件多次求值不重复出诊断（Map 按 label 去重）；
 * 4. 无截断的文件零误报（collector 是全局单槽，装错就全仓噪声）。
 */










/** 自递归：抽象实参 `n - 1` 仍落在 `number` ⇒ 同指纹已在栈上（cycle 归因） */
const SELF_RECURSION = `export function loop(n) {
  if (n <= 0) return 0;
  return loop(n - 1) + 1;
}
`;

/** 无递归、无预算压力 ⇒ 不得出现任何截断诊断 */
const PLAIN = `export function add(a, b) {
  return a + b;
}
`;

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  clearEvalCache();
  clearAbsModuleCache();
});

describe("截断观测 → analysis 诊断（test 面）", () => {
  const SELF_RECURSION = "export function loop(n) {\n  if (n <= 0) return 0;\n  return loop(n - 1) + 1;\n}\n";
  const PLAIN = "export function add(a, b) {\n  return a + b;\n}\n";
  beforeEach(() => {
    resetCheckSourceMemo(); resetGeneralizeMemo(); resetNudoModuleExecCache(); resetParseSourceCache(); resetAbsCallBudget(); clearEvalCache(); clearAbsModuleCache();
  });
  it("自递归一条 info 锚函数声明；cycle 措辞；无截断零误报", async () => {
    const dir = tmpProject("nudo-b099-");
    const file = join(dir, "self.js");
    writeFileSync(file, SELF_RECURSION);
    const result = await analyzeFileAsync(file, SELF_RECURSION);
    const trunc = result.diagnostics.filter((d) => d.code === "nudo:recursion-truncated");
    expect(trunc).toHaveLength(1);
    const d = trunc[0]!;
    expect(d.severity).toBe("info");
    expect(d.range.start.line).toBe(1);
    expect(d.range.start.column).toBe(7);
    expect(d.message).toContain("Recursive evaluation of 'loop'");
    expect(d.message).toContain("(cycle — budget cannot lift this)");
    expect(d.suggestions?.join(" ")).toContain("raising @nudo:budget will not change this");
    expect(result.diagnostics.some((x) => x.code === "nudo:fork-truncated")).toBe(false);

    const cleanDir = tmpProject("nudo-b099-clean-");
    const cleanFile = join(cleanDir, "plain.js");
    writeFileSync(cleanFile, PLAIN);
    const clean = await analyzeFileAsync(cleanFile, PLAIN);
    expect(clean.diagnostics.map((x) => x.code)).not.toContain("nudo:recursion-truncated");
    expect(clean.diagnostics.map((x) => x.code)).not.toContain("nudo:fork-truncated");
  });
});
;
});

// ---------------------------------------------------------------------------
// 声明锚点不被行尾注释劫持
// ---------------------------------------------------------------------------
describe("声明锚点不被行尾注释劫持", () => {
/**
 * 回归：`injectBindings` 的**声明锚点**必须绑到「声明语句自身」，
 * 不能被上一条语句的**行尾注释**劫持。
 *
 * 病灶（Babel 注释挂载事实）：`const a = 1; // 说明` 的行尾注释**同时**被挂成
 * 下一条声明的 `leadingComments[0]` ⇒ 旧口径
 * `stmt.leadingComments?.[0]?.loc?.start.line` 把 `const b = 2;` 的锚点判成
 * **第 1 行** ⇒ 假设落到**另一个变量**（`alpha`）上，而回显仍说
 * 「Bindings applied: beta: string」⇒ 工具回答的是另一个问题（假成功）。
 *
 * 修法（packages/service/src/what-if.ts）：锚点改用语句自身所在行
 * （`stmt.loc.start.line`），注入点再按「前置注释块整块上移」处理。
 *
 * 负控制：行尾注释**不是**指令时不得被当成行内指令；未声明的名字仍进
 * `unapplied`。
 */



/** 注入的 `// @nudo:as` 所在行号（0 基） */
function asLineIndex(source: string): number {
  const idx = source.split("\n").findIndex((l) => l.includes("@nudo:as"));
  if (idx < 0) throw new Error("no @nudo:as injected");
  return idx;
}

describe("声明锚点不被行尾注释劫持", () => {
  const asLineIndex = (source: string): number => {
    const idx = source.split("\n").findIndex((l) => l.includes("@nudo:as"));
    if (idx < 0) throw new Error("no @nudo:as injected");
    return idx;
  };
  const SRC = ["const alpha = 1; // alpha is the first", "const beta = 2;", "const gamma = 3;", "export const va = alpha;", "export const vb = beta;", "export const vg = gamma;", ""].join("\n");
  it("假设落在被点名声明自己的行；行尾注释不消费；未声明进 unapplied", () => {
    const beta = injectBindings(SRC, [{ name: "beta", type: "string" }]);
    expect(beta.unapplied).toEqual([]);
    expect(beta.applied).toEqual(["beta: string"]);
    const at = asLineIndex(beta.source);
    expect(beta.source.split("\n")[at + 1]).toContain("const beta = 2;");
    expect(beta.source.split("\n")[at + 1]).not.toContain("const alpha");

    const gamma = injectBindings(SRC, [{ name: "gamma", type: "string" }]);
    const gat = asLineIndex(gamma.source);
    expect(gamma.source.split("\n")[gat + 1]).toContain("const gamma = 3;");
    expect(gamma.source.split("\n")[gat]).not.toContain("const alpha");

    const none = injectBindings(SRC, [{ name: "nope", type: "string" }]);
    expect(none.applied).toEqual([]);
    expect(none.unapplied).toEqual(["nope"]);
  });
});
;

describe("同一行多条声明——各落各的（行号口径会撞车）", () => {
  const SAME_LINE = "const delta = 10; const epsilon = 20;\nexport const ve = epsilon;\n";
  it("点名声明落在自己前面；两条都 applied", () => {
    const one = injectBindings(SAME_LINE, [{ name: "epsilon", type: "string" }]);
    expect(one.unapplied).toEqual([]);
    expect(one.applied).toEqual(["epsilon: string"]);
    const at = one.source.indexOf("// @nudo:as");
    expect(one.source.slice(at)).toContain("const epsilon = 20;");
    const before = one.source.slice(0, at);
    expect(before).toContain("const delta = 10;");
    expect(before).not.toContain("@nudo:as");

    const both = injectBindings(SAME_LINE, [{ name: "delta", type: "number" }, { name: "epsilon", type: "string" }]);
    expect(both.unapplied).toEqual([]);
    expect(both.applied).toEqual(["delta: number", "epsilon: string"]);
  });
});
;
});

// ---------------------------------------------------------------------------
// 码归因 — 重复声明的诊断码是 nudo:mock-invalid（不是 nudo:module-missing）
// ---------------------------------------------------------------------------
describe("码归因 — 重复声明的诊断码是 nudo:mock-invalid（不是 nudo:module-missing）", () => {
/**
 * —— 指令诊断的**码归因**与**文案贯通**（族 47 · 片 S13）。
 *
 * 背景：片 S6 修好了两条指令的**本体**（`@nudo:replace` 目标未命中 ⇒ 显式诊断；
 * `@nudo:mock-module` 重复声明 ⇒ 显式诊断 + 导出名并集），但**码**在
 * `nudo test` / `health` 面上**丢了**：`analyzer-orchestrate-uncached-modules.ts`
 * 把 `composed.mockErrors`（**只有 message**）映射成固定码 `nudo:module-missing`
 * ⇒ 「重复声明」被说成「模块缺失」（归因错误：码与文案不自洽）。
 *
 * 本钉锁四件事：
 * 1. **码归因**：分析器面（= `nudo test` / `health` 面的诊断源）上，重复声明的
 * 码是 `nudo:mock-invalid`（**不是** `nudo:module-missing`），文案自明
 * （点名重复声明 + 两条 fromPath）。
 * 2. **既有码不被误改**：「mock 文件缺失」仍然是 `nudo:module-missing`（error）
 * ⇒ 不许把别的错误也改成 mock-invalid。
 * 3. **suggestion 文案**：重复声明 ⇒ 提示「只保留一条声明」；导出名缺失 ⇒ 点名
 * 那个缺失的导出（原先两族都落到通用句 ⇒ 提示与事实不符）。
 * 4. **body-read**：`param.trimLeft()` ⇒ `param: string()`（与 `trimStart` 同口径）；
 * `param.includes(...)` **仍推不出**（该表刻意排除 Array 同名方法 ⇒ 负控）。
 */








// ── 夹具 ─────────────────────────────────────────────────────────────────────

let dir: string;

beforeEach(() => {
  dir = tmpProject("nudo-bug-1062-1063-attr-");
  writeTmpFile(dir, "mock-fs.js", `export const readFile = (p) => "mock1:" + p;\n`);
  writeTmpFile(dir, "mock-fs3.js", `export const writeFile = (p, d) => "w:" + p;\n`);
});

/** ② 同一模块声明两次（重复声明族）。 */
const DUP_SRC = `/// @nudo:mock-module "fs" from "./mock-fs.js"
/// @nudo:mock-module "fs" from "./mock-fs3.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** ① 单条声明（零重复诊断的负控）。 */
const SINGLE_SRC = `/// @nudo:mock-module "fs" from "./mock-fs.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** ③ mock 文件缺失（既有码 `nudo:module-missing` 不得被误改）。 */
const MISSING_FILE_SRC = `/// @nudo:mock-module "fs" from "./no-such-mock.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** ④ mock 文件在、但没导出被点名的那个名字（点名缺失族）。 */
const MISSING_EXPORT_SRC = `/// @nudo:mock-module "fs" { readFile, writeFile } from "./mock-fs.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** 分析器诊断里「重复声明」那一条（按文案筛，不依赖码 ⇒ 改码不会让它消失）。 */
function dupDiags(diags: Diagnostic[]): Diagnostic[] {
  return diags.filter((d) => d.message.includes("Duplicate @nudo:mock-module"));
}

// ── 1. 码归因（分析器面 = `nudo test` / `health` 面的诊断源）───────────────────

describe("码归因 — 重复声明/文件缺失/导出缺失的码与级别", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpProject("nudo-b1062-attr-");
    writeTmpFile(dir, "mock-fs.js", 'export const readFile = (p) => "mock1:" + p;\n');
    writeTmpFile(dir, "mock-fs3.js", 'export const writeFile = (p, d) => "w:" + p;\n');
  });
  const DUP_SRC = '/// @nudo:mock-module "fs" from "./mock-fs.js"\n/// @nudo:mock-module "fs" from "./mock-fs3.js"\nimport { readFile } from "fs";\nexport function f() { return readFile("/x"); }\n';
  const SINGLE_SRC = '/// @nudo:mock-module "fs" from "./mock-fs.js"\nimport { readFile } from "fs";\nexport function f() { return readFile("/x"); }\n';
  const MISSING_FILE_SRC = '/// @nudo:mock-module "fs" from "./no-such-mock.js"\nimport { readFile } from "fs";\nexport function f() { return readFile("/x"); }\n';
  const MISSING_EXPORT_SRC = '/// @nudo:mock-module "fs" { readFile, writeFile } from "./mock-fs.js"\nimport { readFile } from "fs";\nexport function f() { return readFile("/x"); }\n';
  const dupDiags = (diags: Diagnostic[]) => diags.filter((d) => d.message.includes("Duplicate @nudo:mock-module"));
  it("重复声明 mock-invalid warning 且不冒充 module-missing；单条零误报", async () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", DUP_SRC);
    const r = await analyzeFileAsync_____analyzer_ts(file, DUP_SRC);
    const dups = dupDiags(r.diagnostics);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.code).toBe("nudo:mock-invalid");
    expect(dups[0]!.severity).toBe("warning");
    expect(dups[0]!.message).toContain("./mock-fs.js");
    expect(dups[0]!.message).toContain("./mock-fs3.js");
    expect(dups[0]!.message).toContain('"fs"');
    expect(r.diagnostics.filter((d) => d.code === "nudo:module-missing" && d.message.includes("Duplicate @nudo:mock-module"))).toEqual([]);

    writeTmpFile(dir, "app.js", SINGLE_SRC);
    const single = await analyzeFileAsync_____analyzer_ts(file, SINGLE_SRC);
    expect(dupDiags(single.diagnostics)).toEqual([]);
  });
  it("文件缺失 module-missing error（分析与门禁面同口径）且不被改成 mock-invalid", async () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", MISSING_FILE_SRC);
    const r = await analyzeFileAsync_____analyzer_ts(file, MISSING_FILE_SRC);
    const missing = r.diagnostics.filter((d) => d.code === "nudo:module-missing");
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]!.severity).toBe("error");
    expect(r.diagnostics.filter((d) => d.code === "nudo:mock-invalid")).toEqual([]);

    const issues = collectCheckSupplementIssues(file, MISSING_FILE_SRC);
    const gate = issues.filter((i) => i.code === "nudo:module-missing");
    expect(gate.length).toBeGreaterThan(0);
    expect(gate[0]!.severity).toBe("error");
  });
  it("suggestion 按种类：重复/导出缺失/文件缺失", () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", DUP_SRC);
    const dup = collectCheckSupplementIssues(file, DUP_SRC).filter((i) => i.code === "nudo:mock-invalid");
    expect(dup).toHaveLength(1);
    const s = dup[0]!.suggestion ?? "";
    expect(s.toLowerCase()).toContain("duplicate");
    expect(s.toLowerCase()).toContain("keep only one");
    expect(s).not.toContain("@nudo:mock expression");

    writeTmpFile(dir, "app.js", MISSING_EXPORT_SRC);
    const exp = collectCheckSupplementIssues(file, MISSING_EXPORT_SRC).filter((i) => i.code === "nudo:module-missing");
    expect(exp).toHaveLength(1);
    expect(exp[0]!.message).toContain('does not export "writeFile"');
    expect(exp[0]!.suggestion ?? "").toContain("writeFile");
    expect(exp[0]!.suggestion ?? "").not.toContain("Create the mock file");

    writeTmpFile(dir, "app.js", MISSING_FILE_SRC);
    const miss = collectCheckSupplementIssues(file, MISSING_FILE_SRC).filter((i) => i.code === "nudo:module-missing");
    expect(miss.length).toBeGreaterThan(0);
    expect(miss[0]!.suggestion).toContain("Create the mock file or fix the path");
  });
});
;

// ── 2. 既有码不被误改 ────────────────────────────────────────────────────────

;

// ── 3. suggestion 文案（按错误种类分族）──────────────────────────────────────

;

// ── 4. body-read：trimLeft / trimRight 与 trimStart 同口径 ───────────────────

describe("body-read — trimLeft / trimRight 是 string 证据（与 trimStart 同口径）", () => {
  const fieldType = (src: string, fn: string) => collectParamBodyReadTypes(src).get(fn)?.get("o")?.find((f) => f.field === "label")?.type;
  it("trimLeft/trimRight ⇒ label: string()；includes 推不出（负控）", () => {
    expect(fieldType("\nexport function f(o) {\n  return o.label.trimLeft();\n}\n", "f")).toBe("string()");
    expect(fieldType("\nexport function g(o) {\n  return o.label.trimRight();\n}\n", "g")).toBe("string()");
    expect(fieldType("\nexport function h(o) {\n  return o.label.includes(\"x\");\n}\n", "h")).not.toBe("string()");
  });
});
;
});

// ---------------------------------------------------------------------------
// 去重键含调用点身份
// ---------------------------------------------------------------------------
describe("去重键含调用点身份", () => {
/**
 * 回归：调用记录去重必须按**调用点身份**，不能按「形态」——
 * 两个不同现场的调用只要实参/结果/throws 形状相同就会被判成同一条
 * ⇒ 后到现场的见证被吞，`--from` 顺序决定谁活下来。
 */





function rec(line: number, column: number): CallRecord {
  return {
    fnName: "id",
    argAbs: [numLit(1)],
    resultAbs: numLit(1),
    throwsAbs: neverAbs,
    callLoc: { line, column },
  };
}

describe("去重键含调用点身份", () => {
  const rec = (line: number, column: number): CallRecord => ({
    fnName: "id",
    argAbs: [numLit(1)],
    resultAbs: numLit(1),
    throwsAbs: neverAbs,
    callLoc: { line, column },
  });
  it("不同调用点两条见证（顺序无关，同行不同列也算）；同点重复采集去重为一条", () => {
    expect(dedupeCallRecords([rec(2, 0), rec(5, 0)])).toHaveLength(2);
    expect(dedupeCallRecords([rec(5, 0), rec(2, 0)])).toHaveLength(2);
    expect(dedupeCallRecords([rec(2, 0), rec(2, 8)])).toHaveLength(2);
    expect(dedupeCallRecords([rec(2, 0), rec(2, 0)])).toHaveLength(1);
  });
});
;
});

// ---------------------------------------------------------------------------
// 期望里的对象槽字面量按值执法（不再恒 [ok]）
// ---------------------------------------------------------------------------
describe("期望里的对象槽字面量按值执法（不再恒 [ok]）", () => {
/**
 * `@nudo:case` 期望里的**对象槽字面量**永不被执法 ⇒ 假绿。
 *
 * 根因（core `packages/core/src/algebra/leq.ts:223-234`）：`leqAbs` 的
 * 「同 prim 字面量视为可赋」捷径在**对象槽**位上连字面量相等性都不比 ——
 * `shape({ a: lit(2) })` 与实际 `{ a: 1 }` 判「满足」⇒ case 期望恒 `[ok]`、
 * `nudo:case-expected` 零诊断。而同一份契约在手写侧车面走**逐字段约束树**
 * 能抓到 ⇒ 两面自相矛盾。
 *
 * 修法（**消费侧**，core 那一行不许改 —— gold 的 `assign-compatible` /
 * `wider` 依赖该口径）：`caseExpectedSatisfied` 补一道「期望槽里的字面量
 * 按值比较」，**只**作用于期望判定，`leqAbs` 的既有语义一字不动。
 *
 * 钉：
 * - 对象槽字面量不符 ⇒ 报 `nudo:case-expected`（改前恒 0 条）；
 * - 嵌套对象槽字面量不符 ⇒ 同样报（改前恒 0 条）；
 * - 负控制：期望槽是**类型**（`number()`）⇒ 口径不变（不报）；
 * - 负控制：顶层字面量 / 数组元素字面量 ⇒ 口径不变（本来就报）。
 */








/** 找出 nudo:case-expected 诊断（期望不满足）。 */
function caseExpectedIssues(result: { diagnostics: readonly { code?: string }[] }): number {
  return result.diagnostics.filter((d) => d.code === "nudo:case-expected").length;
}

/** 跑一个 `@nudo:case` 文件，返回 case-expected 诊断条数。 */
function caseExpectedCount(src: string): number {
  return withTmpProject("nudo-b396-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    const result = analyzeFile(file, readFileSync(file, "utf-8"));
    return caseExpectedIssues(result);
  });
}

describe("期望里的对象槽字面量按值执法（不再恒 [ok]）", () => {
  const caseExpectedIssues = (result: { diagnostics: readonly { code?: string }[] }): number => result.diagnostics.filter((d) => d.code === "nudo:case-expected").length;
  const caseExpectedCount = (src: string): number => withTmpProject("nudo-b396-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    return caseExpectedIssues(analyzeFile(file, readFileSync(file, "utf-8")));
  });
  it("对象/嵌套/字符串槽不符报；类型槽、顶层字面量、数组元素口径不变", () => {
    expect(caseExpectedCount('/**\n * @nudo:case "t" ({ a: 1 }) => shape({ a: lit(2) })\n */\nexport function f(x) { return x; }\n')).toBe(1);
    expect(caseExpectedCount('/**\n * @nudo:case "t" ({ a: "x" }) => shape({ a: lit("y") })\n */\nexport function f(x) { return x; }\n')).toBe(1);
    expect(caseExpectedCount('/**\n * @nudo:case "t" ({ a: { b: 1 } }) => shape({ a: shape({ b: lit(2) }) })\n */\nexport function f(x) { return x; }\n')).toBe(1);
    expect(caseExpectedCount('/**\n * @nudo:case "t" ({ a: 1 }) => shape({ a: number() })\n */\nexport function f(x) { return x; }\n')).toBe(0);
    expect(caseExpectedCount('/**\n * @nudo:case "t" (1) => 2\n */\nexport function f(x) { return x; }\n')).toBe(1);
    expect(caseExpectedCount('/**\n * @nudo:case "t" (["x"]) => array(lit("y"))\n */\nexport function f(x) { return x; }\n')).toBe(1);
  });
});
;

describe("caseExpectedSatisfied 的严格变体（消费侧单测）", () => {
  const objA1 = abs({ k: "obj", slots: { a: { value: numLit(1) } } }, undefined, undefined, "exact");
  const objX = abs({ k: "obj", slots: { a: { value: strLit("x") } } }, undefined, undefined, "exact");
  const nested = abs({ k: "obj", slots: { a: { value: abs({ k: "obj", slots: { b: { value: numLit(1) } } }, undefined, undefined, "exact") } } }, undefined, undefined, "exact");
  it("槽字面量不符不满足；相符满足；类型槽满足", () => {
    expect(caseExpectedSatisfied(objA1, parseCaseArgExpr("shape({ a: lit(2) })", 0))).toBe(false);
    expect(caseExpectedSatisfied(objX, parseCaseArgExpr("shape({ a: lit('y') })", 0))).toBe(false);
    expect(caseExpectedSatisfied(nested, parseCaseArgExpr("shape({ a: shape({ b: lit(2) }) })", 0))).toBe(false);
    expect(caseExpectedSatisfied(objA1, parseCaseArgExpr("shape({ a: lit(1) })", 0))).toBe(true);
    expect(caseExpectedSatisfied(objA1, parseCaseArgExpr("shape({ a: number() })", 0))).toBe(true);
  });
});
;
});

// ---------------------------------------------------------------------------
// 具名类导入的调用点归因（--from 不再丢弃）
// ---------------------------------------------------------------------------
describe("具名类导入的调用点归因（--from 不再丢弃）", () => {
/**
 * `nudo test --from` 静默丢弃类方法调用点（`import { C }` 形态）。
 *
 * 根因（analyzer-abs-eval.ts 的调用记录归因）：点号被调名（`Svc.run`）只认
 * **命名空间导入**（`exportName === "*"`）；具名类导入（`import { Svc }`）
 * 拿不到 targetModule → 归因闸门（匹配阶段）整条丢弃 → 回落 entry@、
 * exit 0（假绿）。
 *
 * 钉：
 * - 具名导入 / 别名导入（`import { Svc as S }`）都要归因到**类所在模块**，
 * 并在 `--from` 注入后合成 `call@` case（实参 1 → 返回 2）。
 * - 负控制：命名空间导入形态不受影响；别的模块的调用点不得被挂到本文件。
 *
 * 类名逐用例唯一（引擎 classRegistry 按类名全局驻留——同名类跨 run 共享
 * 原型对象，会让后续用例的求值整体崩）。
 */






const OTHER = `export function helper(x) { return x * 3; }
`;

/** 字面量值面（litValue 的 ok 判别式收窄；非字面量 → undefined） */
function litOf(a: Abs): unknown {
  const lv = litValue(a);
  return lv.ok ? lv.value : undefined;
}

describe("具名类导入的调用点归因（--from 不再丢弃）", () => {
  const litOf = (a: Abs): unknown => {
    const lv = litValue(a);
    return lv.ok ? lv.value : undefined;
  };
  it("具名/别名导入归因类模块并合成 call@；命名空间形态按成员名；他模块调用不挂本文件", () => {
    withTmpProject("nudo-b464-", (dir) => {
      const t9 = writeTmpFile(dir, "t9.js", "export class Svc464a { run(x) { return x + 1; } }\n");
      const use = writeTmpFile(dir, "use.js", 'import { Svc464a } from "./t9.js";\nconst s = new Svc464a();\nconst v = s.run(1);\n');
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "Svc464a.run")!;
      expect(rec.targetModule).toBe(t9);
      expect(litOf(rec.argAbs[0]!)).toBe(1);
      expect(litOf(rec.resultAbs)).toBe(2);
      const result = analyzeFile(t9, readFileSync(t9, "utf-8"), undefined, records);
      const fn = result.functions.find((f) => f.name === "Svc464a.run")!;
      const call = fn.cases.find((c) => c.source === "callsite")!;
      expect(litOf(call.abs)).toBe(2);
      expect(fn.cases.some((c) => c.name.startsWith("entry@"))).toBe(false);
    });
    withTmpProject("nudo-b464b-", (dir) => {
      const t9 = writeTmpFile(dir, "t9.js", "export class Svc464b { run(x) { return x + 1; } }\n");
      const use = writeTmpFile(dir, "use.js", 'import { Svc464b as S } from "./t9.js";\nconst s = new S();\nconst v = s.run(2);\n');
      const rec = collectCallRecords(use, readFileSync(use, "utf-8")).find((r) => r.fnName === "Svc464b.run")!;
      expect(rec.targetModule).toBe(t9);
      expect(litOf(rec.resultAbs)).toBe(3);
    });
    withTmpProject("nudo-b464c-", (dir) => {
      const t9 = writeTmpFile(dir, "t9.js", "export class Svc464c { run(x) { return x + 1; } }\n");
      const use = writeTmpFile(dir, "use.js", 'import * as Svc464c from "./t9.js";\nconst s = new Svc464c.Svc464c();\nconst v = s.run(1);\n');
      const rec = collectCallRecords(use, readFileSync(use, "utf-8")).find((r) => r.fnName === "Svc464c.run")!;
      expect(rec.targetModule).toBe(t9);
      expect(rec.targetExport).toBe("run");
    });
    withTmpProject("nudo-b464d-", (dir) => {
      const t9 = writeTmpFile(dir, "t9.js", "export class Svc464d { run(x) { return x + 1; } }\n");
      const other = writeTmpFile(dir, "other.js", "export function helper(x) { return x * 3; }\n");
      const use = writeTmpFile(dir, "use.js", 'import { Svc464d } from "./t9.js";\nimport { helper } from "./other.js";\nconst s = new Svc464d();\ns.run(1);\nhelper(4);\n');
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const helperRec = records.find((r) => r.fnName === "helper")!;
      expect(helperRec.targetModule).toBe(other);
      const fn = analyzeFile(t9, readFileSync(t9, "utf-8"), undefined, records).functions.find((f) => f.name === "Svc464d.run")!;
      expect(fn.cases.filter((c) => c.source === "callsite")).toHaveLength(1);
      expect(litOf(fn.cases[0]!.abs)).toBe(2);
    });
  });
});
;
});

// ---------------------------------------------------------------------------
// call@ 见证名带来源限定；二次 freeze 不丢新见证
// ---------------------------------------------------------------------------
describe("call@ 见证名带来源限定；二次 freeze 不丢新见证", () => {
/**
 * 固化下来的 case 名 `call@L<行号>` 取的是**使用现场文件**的行号
 * ⇒ 同名碰撞 + 指向无关行 + 二次 freeze 静默丢弃新见证。
 *
 * 根因：
 * - 合成 case 名直接取记录里的行号（使用现场文件的行）⇒ 两个现场文件在
 * 同一行调用同一函数 → 同名 `call@L2`；行号在被分析文件里无意义。
 * - `insertGeneratedCaseDirectives` 的 `already-generated` 判定以「该函数已有
 * case 指令」为条件 ⇒ 函数级的已有见证吞掉其它调用点的新见证。
 *
 * 修法（命名规则，service 侧统一口径）：
 * - 调用点在本文件内 → `call@L<行号>`（行号在被分析文件里可核对；与既有
 * 已固化名字兼容，不引起 freeze 抖动）。
 * - 调用点在别的文件（`--from` 现场）→ `call@<现场文件相对路径>:L<行号>`
 * （名字自带来源限定 ⇒ 不撞名；行号落在具名文件里可核对）。
 * - emitter 的 `already-generated` 判定改为**按见证身份（名字）逐条**比对：
 * 同名不重复写，新调用点照写。
 *
 * 钉：两个现场文件同行的调用 → 见证名不同；本地调用点 → 名字不变（兼容）；
 * 二次 freeze：新见证能追加（emitter 层）；负控制：本地见证名保持 `call@L<n>`。
 */







const LIB = `export function add(a, b) { return a + b; }
`;
const SITE_A = `import { add } from "./lib.js";
const x = add(1, 2);
`;
const SITE_B = `import { add } from "./lib.js";
const y = add(3, 4);
`;

function callNames(result: ReturnType<typeof analyzeFile>, name: string): string[] {
  const fn = result.functions.find((f) => f.name === name);
  return (fn?.cases ?? []).map((c) => c.name);
}

describe("call@ 见证名带来源限定；二次 freeze 不丢新见证", () => {
  const LIB = "export function add(a, b) { return a + b; }\n";
  const SITE_A = 'import { add } from "./lib.js";\nconst x = add(1, 2);\n';
  const SITE_B = 'import { add } from "./lib.js";\nconst y = add(3, 4);\n';
  const callNames = (result: ReturnType<typeof analyzeFile>, name: string): string[] => (result.functions.find((f) => f.name === name)?.cases ?? []).map((c) => c.name);
  it("外部同名行加来源文件；本地保持 call@L<n>；emitter 逐条比对；二次 freeze 追加新见证", () => {
    withTmpProject("nudo-b465-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      const a = writeTmpFile(dir, "a.js", SITE_A);
      const b = writeTmpFile(dir, "b.js", SITE_B);
      const external = [...collectCallRecords_____analyzer_orchestrate_calls_ts_1(a, readFileSync(a, "utf-8")), ...collectCallRecords_____analyzer_orchestrate_calls_ts_1(b, readFileSync(b, "utf-8"))];
      const names = callNames(analyzeFile(lib, readFileSync(lib, "utf-8"), undefined, external), "add").filter((n) => n.startsWith("call@"));
      expect(names.length).toBe(2);
      expect(new Set(names).size).toBe(2);
      expect(names.every((n) => n.includes("a.js:L2") || n.includes("b.js:L2"))).toBe(true);
    });
    withTmpProject("nudo-b465b-", (dir) => {
      const file = writeTmpFile(dir, "local.js", "export function add(a, b) { return a + b; }\nconst z = add(7, 8);\n");
      expect(callNames(analyzeFile(file, readFileSync(file, "utf-8")), "add").filter((n) => n.startsWith("call@"))).toEqual(["call@L2"]);
    });
    withTmpProject("nudo-b465c-", (dir) => {
      const src = "export function add(a, b) { return a + b; }\nconst z = add(7, 8);\n";
      const file = writeTmpFile(dir, "lib.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const fn = result.functions.find((f) => f.name === "add")!;
      const base = fn.cases.find((c) => c.source === "callsite")!;
      const analysis = { ...result, functions: [{ ...fn, cases: [{ ...base, name: "call@a.js:L2" }, { ...base, name: "call@b.js:L2" }] }] };
      const out = insertGeneratedCaseDirectives('/**\n * @nudo:case "call@a.js:L2" (7, 8)\n */\nexport function add(a, b) { return a + b; }\nconst z = add(7, 8);\n', analysis);
      expect(out.source).toContain('"call@b.js:L2"');
      expect(out.source.match(/call@a\.js:L2/g)?.length).toBe(1);
      expect(out.written.map((w) => w.fn)).toEqual(["add"]);
    });
    withTmpProject("nudo-b465d-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", '/**\n * @nudo:case "call@a.js:L2" (1, 2)\n */\nexport function add(a, b) { return a + b; }\n');
      const a = writeTmpFile(dir, "a.js", SITE_A);
      const b = writeTmpFile(dir, "b.js", SITE_B);
      const external = [...collectCallRecords_____analyzer_orchestrate_calls_ts_1(a, readFileSync(a, "utf-8")), ...collectCallRecords_____analyzer_orchestrate_calls_ts_1(b, readFileSync(b, "utf-8"))];
      expect(callNames(analyzeFile(lib, readFileSync(lib, "utf-8"), undefined, external), "add")).toContain("call@b.js:L2");
    });
  });
});
;
});

// ---------------------------------------------------------------------------
// 非法 entryThrows 的告警文案必须与生效档位一致
// ---------------------------------------------------------------------------
describe("非法 entryThrows 的告警文案必须与生效档位一致", () => {
/**
 * `nudo.check.entryThrows` 非法值 + 合法 `profile` 时：
 * stderr 告警写死「using error」，门禁实际用 **warning**（自相矛盾）。
 *
 * 根因（config.ts checkConfig）：告警文案是常量字符串，而生效值随后被
 * profile 预设覆盖 ⇒ 文案与生效档位互相矛盾。
 *
 * 修法：先算出最终生效档位，再按**生效值**拼告警文案
 * （config.md「L2 entryThrows resolution order」：非法值不是合法显式值 →
 * 落到 config profile 预设）。
 *
 * ⚠ **本文件里每个用例必须用**互不相同**的非法值**：告警走 `warnOnce`
 * （**一进程一次**，key = `check.entryThrows:<原始值>`）⇒ 同值只提示一次。
 * 原先三个用例共用 `"bogus"` ⇒ 第一个用例（adoption）把告警吃掉，
 * 后两个拿到空串 ⇒ **用例顺序依赖**，在 HEAD 上长期红。
 * 改成互不相同的非法值后，每个用例各自触发一次告警 ⇒ 与用例顺序无关。
 */



/** 捕获 stderr 写入（同 config-check-profile.test.ts 的手法） */
function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

describe("非法 entryThrows 的告警文案必须与生效档位一致", () => {
  const captureStderr = (fn: () => void): string => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try { fn(); } finally { process.stderr.write = orig; }
    return writes.join("");
  };
  it("strict/无 profile 非法值文案 error；合法值与 profile 预设不告警", () => {
    for (const cfg of [{ check: { entryThrows: "bogus-strict", profile: "strict" } }, { check: { entryThrows: "bogus-default" } }] as never[]) {
      let eff: string | undefined;
      const out = captureStderr(() => { eff = checkConfig(cfg).entryThrows; });
      expect(eff).toBe("error");
      expect(out).toContain("using error");
    }
    let eff: string | undefined;
    const out = captureStderr(() => { eff = checkConfig({ check: { entryThrows: "warning", profile: "strict" } }).entryThrows; });
    expect(eff).toBe("warning");
    expect(out).toBe("");

    let noOut = "";
    noOut += captureStderr(() => { expect(checkConfig({}).entryThrows).toBe("error"); });
    noOut += captureStderr(() => { expect(checkConfig({ check: {} }).entryThrows).toBe("error"); });
    noOut += captureStderr(() => { expect(checkConfig(null).entryThrows).toBe("error"); });
    noOut += captureStderr(() => { expect(checkConfig({ check: { profile: "adoption" } }).entryThrows).toBe("warning"); });
    noOut += captureStderr(() => { expect(checkConfig({ check: { profile: "strict" } }).entryThrows).toBe("error"); });
    expect(noOut).toBe("");
  });
});
;
});

// ---------------------------------------------------------------------------
// 带谓词的期望（number().gt(0)）按值判定，不再恒假红
// ---------------------------------------------------------------------------
describe("带谓词的期望（number().gt(0)）按值判定，不再恒假红", () => {
/**
 * `@nudo:case "t" (…) => number().gt(0)` 这类**带谓词**的期望
 * 恒判失败（假红）。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts）：期望侧用 `leqAbs` 判定，
 * 而 `leqAbs` 只做结构/蕴含判定（源无 pred ⇒ 目标有 pred ⇒ 不蕴含），
 * 不做**值级**判定 ⇒ `number().gt(0)` 与任何实数都不蕴含。
 *
 * 修法：期望判定补值级语义（core 的字面量域隶属判定 literalMeetsConstraint，
 * 约束锚点重锚到 SELF）；实际值已满足谓词时把谓词从「可比较期望」里摘掉，
 * 使下游（nudo test 报告面）的 `leqAbs` 判定同口径。
 *
 * 钉：满足谓词 → 不报 nudo:case-expected；违反谓词 → 仍报（负控制）；
 * 无谓词的期望（`number()`）→ 口径不变（负控制）。
 */





/** 找出 nudo:case-expected 诊断（期望不满足）。 */
function caseExpectedIssues(result: { diagnostics: readonly { code?: string }[] }): number {
  return result.diagnostics.filter((d) => d.code === "nudo:case-expected").length;
}

describe("带谓词的期望（number().gt(0)）按值判定，不再恒假红", () => {
  const caseExpectedIssues = (result: { diagnostics: readonly { code?: string }[] }): number => result.diagnostics.filter((d) => d.code === "nudo:case-expected").length;
  const analyzeSrc = (dir: string, src: string) => {
    const file = writeTmpFile(dir, "f.js", src);
    return analyzeFile(file, readFileSync(file, "utf-8"));
  };
  it("满足谓词无诊断；违反谓词/类型不符仍报；无谓词口径不变", () => {
    withTmpProject("nudo-b471-", (dir) => {
      const ok = analyzeSrc(dir, '/**\n * @nudo:case "t" (1) => number().gt(0)\n */\nexport function f(x) { return x + 1; }\n');
      const c = ok.functions.find((f) => f.name === "f")!.cases.find((x) => x.name === "t")!;
      expect(c.abs.shape.k).toBe("prim");
      expect(caseExpectedIssues(ok)).toBe(0);
    });
    withTmpProject("nudo-b471b-", (dir) => {
      expect(caseExpectedIssues(analyzeSrc(dir, '/**\n * @nudo:case "t" (1) => number().gt(5)\n */\nexport function f(x) { return x + 1; }\n'))).toBe(1);
    });
    withTmpProject("nudo-b471c-", (dir) => {
      expect(caseExpectedIssues(analyzeSrc(dir, '/**\n * @nudo:case "t" (1) => number()\n */\nexport function f(x) { return x + 1; }\n'))).toBe(0);
    });
    withTmpProject("nudo-b471d-", (dir) => {
      expect(caseExpectedIssues(analyzeSrc(dir, '/**\n * @nudo:case "t" (1) => string()\n */\nexport function f(x) { return x + 1; }\n'))).toBe(1);
    });
  });
});
;
});

// ---------------------------------------------------------------------------
// 合成入口用例的模块实例隔离
// ---------------------------------------------------------------------------
describe("合成入口用例的模块实例隔离", () => {
/**
 * 合成入口用例（entry@）之间的**模块级状态串味**。
 *
 * 改前：`tryRunEval` 的 memo 按「文件 × mode」命中时直接返回缓存里的
 * `out`，而 `out.exports` 是**活模块实例**（导出函数的闭包捕获着模块级
 * `let` 绑定）⇒ 后一个合成用例看到前一个用例改写过的模块级状态。
 *
 * 原生真值：每个合成用例 = 一次**独立**的外部调用（各自进程 / 各自模块
 * 实例）⇒ 模块级计数器每次都从初值起算：
 * `let n = 0; function inc(){ n = n + 1; return n; }`
 * `export function a(){ inc(); return n; }` → 1（不是 2）
 */




function caseShapes(source: string): Record<string, string> {
  const result = analyzeFile("/test/bug472.js", source);
  const out: Record<string, string> = {};
  for (const fn of result.functions) {
    const c = fn.cases[0];
    if (c) out[fn.name] = formatShape(c.abs);
  }
  return out;
}

describe("合成入口用例的模块实例隔离", () => {
  const caseShapes = (source: string): Record<string, string> => {
    const result = analyzeFile("/test/b472.js", source);
    const out: Record<string, string> = {};
    for (const fn of result.functions) {
      const c = fn.cases[0];
      if (c) out[fn.name] = formatShape(c.abs);
    }
    return out;
  };
  it("模块级状态每入口独立；声明式 case / 无状态 / 未改写负控", () => {
    const shapes = caseShapes("let n = 0;\nfunction inc() { n = n + 1; return n; }\nexport function f() { return n; }\n");
    expect(shapes.inc).toBe("1");
    expect(shapes.f).toBe("0");

    const multi = caseShapes("let n = 0;\nfunction inc() { n = n + 1; return n; }\nexport function a() { inc(); return n; }\nexport function b() { inc(); return n; }\nexport function c() { inc(); return n; }\n");
    expect(multi.a).toBe("1");
    expect(multi.b).toBe("1");
    expect(multi.c).toBe("1");

    expect(caseShapes('/**\n * @nudo:case "t" (1)\n */\nexport function add(x) { return x + 1; }\n').add).toBe("2");
    expect(caseShapes('export function g() { return "ok"; }\n').g).toBe('"ok"');
    expect(caseShapes("let n = 7;\nexport function read() { return n; }\n").read).toBe("7");
  });
});
;

/** 负控制：不该被这条修复波及的邻近形态 */
;
});

// ---------------------------------------------------------------------------
// nudo.analysis.include 的字面量要能命中（路径形态，非子串）
// ---------------------------------------------------------------------------
describe("nudo.analysis.include 的字面量要能命中（路径形态，非子串）", () => {
/**
 * 回归钉：`nudo.analysis.include` 的白名单判定。
 *
 * 改前：include 走 matchesEmitAllowlist —— 无通配符的字面量被编译成锚定
 * 全等正则 `^literal$`（相对项目根），`include: ["src"]` 对 `src/a.js`
 * **永不命中** → 整张白名单静默作废（该文件整份不被分析，假绿）。
 *
 * 本次定的语义（写在 analysis-scope.includeHit 的注释里）：
 * - 字面量 = **路径形态**（这个文件 / 这个目录），不是子串搜索：
 * `src` 命中 `src/**`，不命中 `src-other/c.js`。
 * - 通配符 = 锚定 glob（`**` 跨段、`*`/`?` 不跨 `/`），与 exclude 同编译器。
 *
 * 负控制：exclude 的字面量**子串**语义不得被本次改动波及；include 为空
 * 时不过滤。
 */






function project(include: string[] | undefined, exclude?: string[]): string {
  const analysis: Record<string, unknown> = { mode: "all" };
  if (include) analysis.include = include;
  if (exclude) analysis.exclude = exclude;
  return makeTmpProject("nudo-scope-480-", {
    "package.json": JSON.stringify({ name: "fx", nudo: { analysis } }),
  });
}

function fileIn(dir: string, rel: string): string {
  const file = join(dir, ...rel.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "export function f(x) {\n  return x;\n}\n");
  return file;
}

const SRC = "export function f(x) {\n  return x;\n}\n";

describe("nudo.analysis.include 的字面量要能命中（路径形态，非子串）", () => {
  const project = (include: string[] | undefined, exclude?: string[]): string => {
    const analysis: Record<string, unknown> = { mode: "all" };
    if (include) analysis.include = include;
    if (exclude) analysis.exclude = exclude;
    return makeTmpProject("nudo-scope-480-", { "package.json": JSON.stringify({ name: "fx", nudo: { analysis } }) });
  };
  const fileIn = (dir: string, rel: string): string => {
    const file = join(dir, ...rel.split("/"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "export function f(x) {\n  return x;\n}\n");
    return file;
  };
  const SRC = "export function f(x) {\n  return x;\n}\n";
  const hit = (include: string[] | undefined, rel: string, want: boolean, exclude?: string[]) => {
    const dir = project(include, exclude);
    expect(shouldAnalyzeFile(fileIn(dir, rel), SRC), `${JSON.stringify(include ?? null)} ${rel}`).toBe(want);
  };
  it("目录/文件/glob/多条/空/排除的命中矩阵", () => {
    hit(["src"], "src/a.js", true);
    hit(["src"], "src/nested/b.js", true);
    hit(["src"], "src-other/c.js", false);
    hit(["src"], "lib/d.js", false);
    hit(["src/a.js"], "src/a.js", true);
    hit(["src/a.js"], "src/b.js", false);
    hit(["src/**"], "src/nested/b.js", true);
    hit(["src/**"], "lib/d.js", false);
    hit(["src/*.js"], "src/a.js", true);
    hit(["src/*.js"], "src/nested/b.js", false);
    hit(["**/*.js"], "lib/d.js", true);
    hit(["lib", "src/a.js"], "lib/d.js", true);
    hit(["lib", "src/a.js"], "src/a.js", true);
    hit(["lib", "src/a.js"], "src/b.js", false);
    hit(undefined, "lib/d.js", true);
    hit(undefined, "src/vendored/lib.js", false, ["src/vendored"]);
    hit(undefined, "src/lib.js", true, ["src/vendored"]);
  });
});
;
});

// ---------------------------------------------------------------------------
// 项目级预算/上限必须随每次解析重写（顺序无关）
// ---------------------------------------------------------------------------
describe("项目级预算/上限必须随每次解析重写（顺序无关）", () => {
/**
 * `nudo.analysis.maxForks`（与 `nudo.sessionCache.*`）是**进程级
 * 单槽**，且只在 findProjectConfig 的 **memo-miss** 路径写一次 ⇒
 * 「哪个项目最后被**首次**查找」决定全局值 ⇒ 同一项目同一配置在不同目标
 * 顺序下结论不同（fork 截断诊断时有时无，类型静默变宽）。
 *
 * 根因：按项目目录解析的配置写进进程级单例（core 的 fork 预算单例 /
 * session-cache-limits 的 fromProject 单槽），而写入只发生在 memo-miss 路径。
 *
 * 修法：memo **命中**路径同样重写这两个进程级槽（每次解析到项目配置都以
 * 本次解析结果为准 ⇒ 「最后一次查找 = 本次使用」自洽）。
 */







function project(prefix: string, nudo: unknown): string {
  const root = tmpProject(prefix, { "package.json": JSON.stringify({ name: "p", nudo }) });
  return root;
}

describe("项目级预算/上限必须随每次解析重写（顺序无关）", () => {
  const project = (prefix: string, nudo: unknown): string => tmpProject(prefix, { "package.json": JSON.stringify({ name: "p", nudo }) });
  beforeEach(() => {
    evictProjectConfigMemo();
    resetSessionCacheLimitState();
  });
  afterEach(() => {
    applyBForkBudgetFromConfig(null, {});
    resetSessionCacheLimitState();
  });
  it("A→B→A 预算与会话 LRU 回到 A；无 nudo 回落默认；重复稳定；env 压过配置", () => {
    const a = project("nudo-b481-a-", { analysis: { maxForks: 11 } });
    const b = project("nudo-b481-b-", { analysis: { maxForks: 22 } });
    findProjectConfig(a);
    expect(currentBForkBudgetLimit()).toBe(11);
    findProjectConfig(b);
    expect(currentBForkBudgetLimit()).toBe(22);
    findProjectConfig(a);
    expect(currentBForkBudgetLimit()).toBe(11);
    findProjectConfig(b);
    expect(currentBForkBudgetLimit()).toBe(22);

    const sa = project("nudo-b481-sa-", { sessionCache: { maxFiles: 7 } });
    const sb = project("nudo-b481-sb-", { sessionCache: { maxFiles: 9 } });
    findProjectConfig(sa);
    expect(getSessionCacheLimits({}).maxFiles).toBe(7);
    findProjectConfig(sb);
    expect(getSessionCacheLimits({}).maxFiles).toBe(9);
    findProjectConfig(sa);
    expect(getSessionCacheLimits({}).maxFiles).toBe(7);

    const plain = tmpProject("nudo-b481-nb-", { "package.json": JSON.stringify({ name: "plain" }) });
    findProjectConfig(a);
    findProjectConfig(plain);
    expect(currentBForkBudgetLimit()).not.toBe(11);

    const stable = project("nudo-b481-stable-", { analysis: { maxForks: 33 } });
    findProjectConfig(stable);
    expect(currentBForkBudgetLimit()).toBe(33);
    findProjectConfig(stable);
    expect(currentBForkBudgetLimit()).toBe(33);
    findProjectConfig(join(stable, "src"));
    expect(currentBForkBudgetLimit()).toBe(33);

    const envProject = project("nudo-b481-env-", { analysis: { maxForks: 11 } });
    const saved = process.env.NUDO_MAX_FORKS;
    process.env.NUDO_MAX_FORKS = "77";
    try {
      findProjectConfig(envProject);
      expect(currentBForkBudgetLimit()).toBe(77);
    } finally {
      if (saved === undefined) delete process.env.NUDO_MAX_FORKS;
      else process.env.NUDO_MAX_FORKS = saved;
    }
  });
});
;
});

// ---------------------------------------------------------------------------
// 类方法上的 @nudo:case 见证被求值（不再恒 unknown）
// ---------------------------------------------------------------------------
describe("类方法上的 @nudo:case 见证被求值（不再恒 unknown）", () => {
/**
 * **类方法**上的 `@nudo:case` 见证从不被求值 → 结果恒 `unknown`
 * → 任何期望都必假红（顶层函数同款 case 却通过）。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts）：见证求值把 `fn.name` 当
 * **源码里的被调表达式**传给 `tryEvalCallFull`；类方法的名字是点号形式
 * （`C.m`）⇒ 源里不存在名为 `C.m` 的可调用表达式 ⇒ 求值失败 ⇒ 回落
 * unknown 兜底。
 *
 * 修法：点号名只作展示名；见证调用改走「类 Abs → $new → 原型方法槽
 * $invoke」链（静态方法走类 Abs 的静态槽）。
 *
 * 钉：类方法见证求值出确切值；顶层函数同款 case 口径不变（负控制）；
 * 类方法仍不可判时如实回落 unknown（负控制：方法体依赖未定义全局）。
 */





describe("类方法上的 @nudo:case 见证被求值（不再恒 unknown）", () => {
  const litVal = (absVal: Abs) => { const t = absVal.term; return t?.op === "lit" ? t.value : undefined; };
  const caseOf = (dir: string, file: string, src: string, fnName: string) => {
    const f = writeTmpFile(dir, file, src);
    return analyzeFile(f, readFileSync(f, "utf-8")).functions.find((x) => x.name === fnName)!.cases.find((x) => x.name === "k")!;
  };
  it("实例方法求值确切值；顶层函数口径不变；不可判如实 unknown", () => {
    withTmpProject("nudo-b485-", (dir) => {
      expect(litVal(caseOf(dir, "d.js", 'export class C {\n  /**\n   * @nudo:case "k" (1) => 1\n   */\n  m(x) { return 1; }\n}\n', "C.m").abs)).toBe(1);
    });
    withTmpProject("nudo-b485b-", (dir) => {
      expect(litVal(caseOf(dir, "d.js", 'export class C {\n  /**\n   * @nudo:case "k" (1) => 2\n   */\n  m(x) { return x + 1; }\n}\n', "C.m").abs)).toBe(2);
    });
    withTmpProject("nudo-b485c-", (dir) => {
      expect(litVal(caseOf(dir, "e.js", '/**\n * @nudo:case "k" (1) => 1\n */\nexport function f(x) { return 1; }\n', "f").abs)).toBe(1);
    });
    withTmpProject("nudo-b485d-", (dir) => {
      expect(caseOf(dir, "d.js", 'export class C {\n  /**\n   * @nudo:case "k" (1) => 1\n   */\n  m(x) { return globalThis.__nudo_missing__.x; }\n}\n', "C.m").abs.shape.k).toBe("unknown");
    });
  });
});
;
});

// ---------------------------------------------------------------------------
// call@ 见证值 = 调用现场观测值（不被目标语境重求值覆盖）
// ---------------------------------------------------------------------------
describe("call@ 见证值 = 调用现场观测值（不被目标语境重求值覆盖）", () => {
/**
 * 合成 `call@` 见证的**返回值**被「目标语境重求值」覆盖 ⇒ 报告出
 * 的调用点真值与实际调用结果矛盾（错误的确切值）。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts）：`caseAbs` 已经是闸门后的
 * 值（重求值只在「更有信息量」时替换观测值），但随后 `attachAbsToIntension`
 * 挂的是**重求值原值** ⇒ 无条件覆盖 ⇒ 观测值（调用现场语境下的真值）
 * 被目标语境（被分析文件语境）的值顶掉。
 *
 * 修法：挂闸门后的 `caseAbs`。
 *
 * 钉：模块状态不同的两次调用 ⇒ 见证值等于**现场观测值**（不是目标语境重算值）；
 * 无状态差异时口径不变（负控制）。
 */






describe("call@ 见证值 = 调用现场观测值（不被目标语境重求值覆盖）", () => {
  const litVal = (absVal: Abs) => { const t = absVal.term; return t?.op === "lit" ? t.value : undefined; };
  it("模块状态不同见证值 = 现场 5/6；无状态差异值不变 3", () => {
    withTmpProject("nudo-b486-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", "let counter = 0;\nexport function addTo(k) { counter += k; return counter; }\n");
      const usage = writeTmpFile(dir, "usage.js", 'import { addTo } from "./lib.js";\naddTo(5);\naddTo(1);\n');
      const external = collectCallRecords_____analyzer_orchestrate_calls_ts_2(usage, readFileSync(usage, "utf-8"));
      const fn = analyzeFile(lib, readFileSync(lib, "utf-8"), undefined, external).functions.find((f) => f.name === "addTo")!;
      const values = fn.cases.filter((c) => c.name.startsWith("call@")).map((c) => litVal(c.abs)).sort((a, b) => Number(a) - Number(b));
      expect(values).toEqual([5, 6]);
    });
    withTmpProject("nudo-b486b-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", "export function add(a, b) { return a + b; }\n");
      const usage = writeTmpFile(dir, "usage.js", 'import { add } from "./lib.js";\nconst x = add(1, 2);\n');
      const external = collectCallRecords_____analyzer_orchestrate_calls_ts_2(usage, readFileSync(usage, "utf-8"));
      const call = analyzeFile(lib, readFileSync(lib, "utf-8"), undefined, external).functions.find((f) => f.name === "add")!.cases.find((c) => c.name.startsWith("call@"))!;
      expect(litVal(call.abs)).toBe(3);
    });
  });
});
;
});

// ---------------------------------------------------------------------------
// 再导出链归因（barrel 不再吞掉跨文件调用点证据）
// ---------------------------------------------------------------------------
describe("再导出链归因（barrel 不再吞掉跨文件调用点证据）", () => {
/**
 * `export *` barrel 吞掉 `--from` 采集到的跨文件调用点证据 ⇒
 * `nudo:contract-domain-exceeds`（error 级 L1 门禁）静默不报（假绿）。
 *
 * 根因（analyzer-abs-eval.ts 的调用记录归因）：targetModule 填的是**调用方
 * import 的那个模块**——barrel 场景下那是中间 barrel，不是定义文件；归因
 * 判据要求 targetModule 逐字等于被检查文件 ⇒ barrel 转出的记录永远配不上
 * 定义文件 ⇒ 越界证据蒸发。
 *
 * 修法：归因沿**再导出链**解引用到真正定义该绑定的模块（`export * from` /
 * `export { x } from` / `import + export { x }`）。
 *
 * 钉：barrel 形态与直接 import 形态**报同一门禁**；负控制：别处的记录不得
 * 在本文件报门禁；解析不出定义位点时回落 import 目标（不猜、不崩）。
 */






/** 字面量值面（litValue 的 ok 判别式收窄；非字面量 → undefined） */
function litOf(a: Abs): unknown {
  const lv = litValue(a);
  return lv.ok ? lv.value : undefined;
}

const DOMAIN = "nudo:contract-domain-exceeds";

const LIB = `export function area(x) {
  return x;
}
`;
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const area = fn({ x: number().gt(0) });
`;

describe("再导出链归因（barrel 不再吞掉跨文件调用点证据）", () => {
  const litOf = (a: Abs): unknown => { const lv = litValue(a); return lv.ok ? lv.value : undefined; };
  const DOMAIN = "nudo:contract-domain-exceeds";
  const LIB = "export function area(x) {\n  return x;\n}\n";
  const SIDECAR = 'import { fn, number } from "@nudojs/core";\nexport const area = fn({ x: number().gt(0) });\n';
  it("barrel 归因定义文件并照报门禁；改名跟导出名；直接 import 照报；他处不污染；未导出回落", () => {
    withTmpProject("nudo-b491-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      writeTmpFile(dir, "lib.nudo.js", SIDECAR);
      writeTmpFile(dir, "barrel.js", 'export * from "./lib.js";\n');
      const use = writeTmpFile(dir, "use-barrel.js", 'import { area } from "./barrel.js";\narea(-1);\n');
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "area")!;
      expect(rec.targetModule).toBe(lib);
      expect(litOf(rec.argAbs[0]!)).toBe(-1);
      const issues = analyzeFile(lib, LIB, undefined, records).diagnostics.filter((d) => d.code === DOMAIN);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("error");
      expect((issues[0]!.data as { actual?: string }).actual).toBe("-1");
    });
    withTmpProject("nudo-b491b-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      writeTmpFile(dir, "lib.nudo.js", SIDECAR);
      writeTmpFile(dir, "barrel.js", 'export { area as area2 } from "./lib.js";\n');
      const use = writeTmpFile(dir, "use-barrel.js", 'import { area2 } from "./barrel.js";\narea2(-1);\n');
      const rec = collectCallRecords(use, readFileSync(use, "utf-8")).find((r) => r.fnName === "area2")!;
      expect(rec.targetModule).toBe(lib);
      expect(rec.targetExport).toBe("area");
      const issues = analyzeFile(lib, LIB, undefined, [rec]).diagnostics.filter((d) => d.code === DOMAIN);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("error");
    });
    withTmpProject("nudo-b491c-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      writeTmpFile(dir, "lib.nudo.js", SIDECAR);
      const use = writeTmpFile(dir, "use-direct.js", 'import { area } from "./lib.js";\narea(-1);\n');
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      expect(records.find((r) => r.fnName === "area")!.targetModule).toBe(lib);
      expect(analyzeFile(lib, LIB, undefined, records).diagnostics.filter((d) => d.code === DOMAIN)).toHaveLength(1);
    });
    withTmpProject("nudo-b491d-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", LIB);
      writeTmpFile(dir, "lib.nudo.js", SIDECAR);
      const other = writeTmpFile(dir, "other.js", "export function other(x) { return x; }\n");
      const result = analyzeFile(lib, LIB, undefined, [{
        fnName: "other",
        argAbs: [{ shape: { k: "prim", type: "number" }, term: { op: "lit", value: -1 }, conf: "exact" }],
        resultAbs: { shape: { k: "prim", type: "number" }, conf: "exact" },
        throwsAbs: { shape: { k: "never" }, conf: "exact" },
        targetModule: other,
        targetExport: "other",
      }]);
      expect(result.diagnostics.filter((d) => d.code === DOMAIN)).toHaveLength(0);
    });
    withTmpProject("nudo-b491e-", (dir) => {
      const barrel = writeTmpFile(dir, "barrel.js", "export const other = 1;\n");
      const use = writeTmpFile(dir, "use.js", 'import { area } from "./barrel.js";\narea(-1);\n');
      const rec = collectCallRecords(use, readFileSync(use, "utf-8")).find((r) => r.fnName === "area")!;
      expect(rec.targetModule).toBe(barrel);
      expect(rec.targetExport).toBe("area");
    });
  });
});
;
});

// ---------------------------------------------------------------------------
// dual-entry issue anchor is a legal, real position
// ---------------------------------------------------------------------------
describe("dual-entry issue anchor is a legal, real position", () => {
/**
 * nudo:dual-entry 的位置硬编码 line: 0 / column: 0。
 *
 * 后果（产品面）：
 * - `nudo check --json` → `"line": 0`
 * - `nudo check --gitlab` → `"lines": {"begin": 0}`（GitLab 要求 ≥ 1）
 * - `nudo check --gha` → 注解 `line=0`（GHA 要求 ≥ 1）
 * - 人面 → `[INFO L0]`
 *
 * 修法（service 侧）：dual-entry 是**包级事实**，观察单位是「这个入口文件整体」，
 * 锚点落在被分析入口文件的**首行**（1 基行号 / 0 基列号，与 CheckIssue 的 Babel
 * 口径一致）。下游 `i.line ?? 1` 的文件级兜底同口径，不需再换算。
 *
 * 负控制：单入口包 / 非入口文件仍然零 issue（位置修复不得放宽触发面）。
 */






const DUAL = {
  name: "dual-anchor",
  exports: {
    ".": {
      browser: "./browser.js",
      node: "./node.js",
      default: "./node.js",
    },
  },
};
const SRC = `export function id(x) { return x; }\n`;

describe("dual-entry issue anchor is a legal, real position", () => {
  it("anchors the dual-entry issue on line 1 (not the line-0 placeholder)", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify(DUAL),
      "browser.js": SRC,
      "node.js": SRC,
    });
    const issue = entryVariantIssueForFile(join(dir, "browser.js"));
    expect(issue).not.toBeNull();
    expect(issue!.line).toBe(1);
    expect(issue!.line).toBeGreaterThanOrEqual(1);
    expect(issue!.column).toBeGreaterThanOrEqual(0);
    expect(issue!.code).toBe("nudo:dual-entry");
  });

  it("anchors the node face on line 1 too (both variants)", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify(DUAL),
      "browser.js": SRC,
      "node.js": SRC,
    });
    const issue = entryVariantIssueForFile(join(dir, "node.js"));
    expect(issue).not.toBeNull();
    expect(issue!.line).toBe(1);
    expect(issue!.message).toContain("node");
  });

  it("keeps the legacy browser-field package shape anchored", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify({
        name: "legacy-anchor",
        main: "./node.js",
        browser: "./browser.js",
      }),
      "browser.js": SRC,
      "node.js": SRC,
    });
    const issue = entryVariantIssueForFile(join(dir, "browser.js"));
    expect(issue).not.toBeNull();
    expect(issue!.line).toBe(1);
  });

  it("negative control: single-entry package still yields no issue at all", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify({ name: "single-anchor", main: "./index.js" }),
      "index.js": SRC,
    });
    expect(entryVariantIssueForFile(join(dir, "index.js"))).toBeNull();
  });

  it("negative control: non-entry helper inside a dual package yields no issue", () => {
    const dir = tmpProject("nudo-bug492-", {
      "package.json": JSON.stringify(DUAL),
      "browser.js": SRC,
      "node.js": SRC,
      "lib/helper.js": SRC,
    });
    expect(entryVariantIssueForFile(join(dir, "lib", "helper.js"))).toBeNull();
  });
});

describe("eval 通道（analyzer 诊断面）也必须是合法行号", () => {
  it("analyzeFile 的 dual-entry 诊断落在第 1 行（不是 line 0 占位）", () => {
    const dir = tmpProject("nudo-bug492-eval-", {
      "package.json": JSON.stringify(DUAL),
      "browser.js": SRC,
      "node.js": SRC,
    });
    const r = analyzeFile(join(dir, "browser.js"), SRC);
    const d = r.diagnostics.find((x) => x.code === "nudo:dual-entry");
    expect(d).toBeDefined();
    expect(d!.range.start.line).toBeGreaterThanOrEqual(1);
    expect(d!.range.start.line).toBe(1);
    expect(d!.range.start.column).toBeGreaterThanOrEqual(0);
  });
});
});

// ---------------------------------------------------------------------------
// intension.display 与求值面同源（跨模块不再退化成 unknown）
// ---------------------------------------------------------------------------
describe("intension.display 与求值面同源（跨模块不再退化成 unknown）", () => {
/**
 * `nudo test --json` 的 `intension.display` 在跨模块调用上退化成
 * `() => unknown`，与同一份 JSON 里的 `result` / `resultAbs` / `intension.abs`
 * 自相矛盾，且与 `nudo check` 的签名相反。
 *
 * 根因（analyzer-abs-eval.ts 的 tryAttachIntension）：`display` 走**符号面**
 * （generalizeFromAst → formatPoly），`abs` 走**求值面**；跨模块时被调方是
 * import 进来的绑定，符号面解析不出 ⇒ display 退成 `() => unknown`，而求值
 * 面有确切的 7。`unknown` 在本产品是保留词（= 推断失败）⇒ 两个面相反。
 *
 * 修法：符号面退化成 bare unknown 时**不写** display，改由求值面结果合成
 * （与 abs 同源）——`unknown` 只在真的推断失败时出现。
 *
 * 钉：跨模块 display 与求值面一致；同模块（符号面有效）display 不变；
 * 负控制：真推断失败时 display 仍如实说 unknown。
 */





const LIB = `export function inner() { return 7; }
`;
const USE = `import { inner } from "./lib.js";

export function run() { return inner(); }
`;
const SAME = `function inner2() { return 7; }
export function run2() { return inner2(); }
`;

describe("intension.display 与求值面同源（跨模块不再退化成 unknown）", () => {
  it("跨模块：display 由求值面合成，与 resultAbs / nudo check 签名一致", () =>
    withTmpProject("nudo-b496-", (dir) => {
      writeTmpFile(dir, "lib.js", LIB);
      const use = writeTmpFile(dir, "use.js", USE);

      const result = analyzeFile(use, readFileSync(use, "utf-8"));
      const fn = result.functions.find((f) => f.name === "run");
      expect(fn).toBeDefined();
      const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
      expect(entry).toBeDefined();
      // 求值面：确切的 7
      expect(entry!.intension?.abs).toContain("7");
      expect(entry!.intension?.absMultiline).toContain("7");
      // 人读摘要：不得宣称推断失败
      expect(entry!.intension?.display).not.toContain("unknown");
      expect(entry!.intension?.display).toContain("7");
      // 与 nudo check 的签名同口径（run() => 7）
      expect(entry!.intension?.display).toBe("run: () => 7");
    }));

  it("负控制：同模块（符号面有效）display 保持符号面形态", () =>
    withTmpProject("nudo-b496b-", (dir) => {
      const same = writeTmpFile(dir, "same.js", SAME);
      const result = analyzeFile(same, readFileSync(same, "utf-8"));
      const fn = result.functions.find((f) => f.name === "inner2");
      const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
      expect(entry!.intension?.display).toBe("inner2: () => 7");
    }));

  it("负控制：真推断失败时 display 仍如实说 unknown（与 payload 一致）", () =>
    withTmpProject("nudo-b496c-", (dir) => {
      const src = `export function f() { return globalThis.__nudo_missing__.x; }
`;
      const file = writeTmpFile(dir, "fail.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const fn = result.functions.find((f) => f.name === "f");
      const entry = fn!.cases.find((c) => c.name.startsWith("entry@"));
      expect(entry).toBeDefined();
      expect(entry!.intension?.abs).toContain("unknown");
      expect(entry!.intension?.display).toContain("unknown");
    }));

  it("不变量：任何 case 的 display 不得与同一条 payload 的 abs 矛盾", () =>
    withTmpProject("nudo-b496d-", (dir) => {
      writeTmpFile(dir, "lib.js", LIB);
      const use = writeTmpFile(dir, "use.js", USE);
      const result = analyzeFile(use, readFileSync(use, "utf-8"));
      for (const fn of result.functions) {
        for (const c of fn.cases) {
          const abs = c.intension?.abs ?? "";
          const display = c.intension?.display ?? "";
          if (abs.includes("unknown") || abs === "") continue;
          expect(display, `${fn.name}/${c.name}`).not.toContain("unknown");
        }
      }
    }));
});
});

// ---------------------------------------------------------------------------
// what-if type expression fidelity
// ---------------------------------------------------------------------------
describe("what-if type expression fidelity", () => {
/**
 * what-if 把**认不出**的类型表达式静默洗成 `any()`，却仍报
 * 「Bindings applied: <用户原文>」——报告与实际注入不符。
 *
 * 原生 oracle（tmp/probe/fix-r24-m/engine497-grammar.ts）：
 * `@nudo:as` 的类型文法（`parseCaseArgExpr`）里 `any()` / `unknown` / `any` /
 * 裸名字**全是同一个 Abs** `{k:"unknown"}` ⇒ 洗成 `any()` 既不改变推断结果，
 * 又把「表达不了」藏了起来（`any()` 命中 `isExplicitUnknownExpr` ⇒ 指令文法
 * 连 `nudo:directive-syntax` 都不发）。
 *
 * 修法（service 侧 what-if）：
 * - 认不出的名字（`Date` / `notatype`）与 TS 类型引用（`T.*`）不再洗成 `any()`，
 * 而是按文档契约（agent.md「any other name becomes `unknown`」）落到
 * `unknown`——`@nudo:as unknown` 是合法载荷。
 * - `applied` 回显如实反映**实际注入**：降级时明说降到了 `unknown`。
 *
 * 负控制：可表达的表达式（原始类型 / 联合 / 构建器 / 结构字面量）行为不变，
 * 回显仍是用户原文（与已发布文档 agent.md 的示例一致）。
 */



const SRC = `const x = 1;\nconst y = x + 1;\n`;

describe("what-if type expression fidelity", () => {
  it("does not launder an unrecognized name into any()", () => {
    expect(typeExprToDirective("Date")).not.toBe("any()");
    expect(typeExprToDirective("Date")).toBe("unknown");
    expect(typeExprToDirective("notatype")).toBe("unknown");
  });

  it("does not launder a TS type reference (T.*) into any()", () => {
    expect(typeExprToDirective("T.object({ port: T.number })")).not.toBe("any()");
    expect(typeExprToDirective("T.object({ port: T.number })")).toBe("unknown");
  });

  it("echoes the actual injection instead of the user text when degraded", () => {
    const { source, applied, unapplied } = injectBindings(SRC, [
      { name: "x", type: "Date" },
    ]);
    // 注入的是 unknown（不是 any()，也不是用户原文 Date）
    expect(source).toContain("// @nudo:as unknown");
    expect(source).not.toContain("@nudo:as any()");
    // 回显不再声称「按 Date 应用」
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain("unknown");
    expect(applied[0]).toContain("Date");
    expect(applied[0]).toContain("not expressible");
    expect(applied[0]).not.toBe("x: Date");
    expect(unapplied).toEqual([]);
  });

  it("degrades a union with one unrecognized member as a whole", () => {
    const { source, applied } = injectBindings(SRC, [
      { name: "x", type: "number|Date" },
    ]);
    // union(number(), unknown) 不是合法的约束构建器实参 → 整条降级
    expect(source).toContain("// @nudo:as unknown");
    expect(source).not.toContain("union(");
    expect(applied[0]).toContain("not expressible");
  });

  it("negative control: expressible expressions keep their mapping and echo", () => {
    expect(typeExprToDirective("number")).toBe("number()");
    expect(typeExprToDirective("string")).toBe("string()");
    expect(typeExprToDirective("number|string")).toBe("union(number(), string())");
    expect(typeExprToDirective("shape({ port: number() })")).toBe(
      "shape({ port: number() })",
    );
    expect(typeExprToDirective("{ port: number() }")).toBe("{ port: number() }");
    const { source, applied, unapplied } = injectBindings(SRC, [
      { name: "x", type: "number" },
    ]);
    expect(source).toContain("// @nudo:as number()");
    expect(applied).toEqual(["x: number"]);
    expect(unapplied).toEqual([]);
  });

  it("negative control: explicit unknown / any stay expressible (no degradation note)", () => {
    const { source, applied } = injectBindings(SRC, [{ name: "x", type: "unknown" }]);
    expect(source).toContain("// @nudo:as any()");
    expect(applied).toEqual(["x: unknown"]);
    const anyRes = injectBindings(SRC, [{ name: "x", type: "any" }]);
    expect(anyRes.source).toContain("// @nudo:as any()");
    expect(anyRes.applied).toEqual(["x: any"]);
  });

  it("negative control: bindings with no top-level declaration stay unapplied", () => {
    const { applied, unapplied } = injectBindings(`export function f() { return 1; }\n`, [
      { name: "nope", type: "number" },
    ]);
    expect(applied).toEqual([]);
    expect(unapplied).toEqual(["nope"]);
  });
});
});

// ---------------------------------------------------------------------------
// 导出函数体内的调用点 → 合成 call@ 见证
// ---------------------------------------------------------------------------
describe("导出函数体内的调用点 → 合成 call@ 见证", () => {
/**
 * 调用点位于**导出函数体内**时，Nudo 从不合成 `call@` case ⇒ 回落
 * 成 `entry@` ⇒ 该函数的调用点域完全丢失（误报 entry-only）。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts / analyzer-orchestrate-uncached.ts）：
 * `call@` 合成只消费**外部传入**的 records；函数体求值期间发生的调用不落
 * 共享 callRecords ⇒ 被调方永远只有 `entry@`。
 *
 * 修法：入口求值（entry@ 兜底）时开启调用点采集，把函数体内的调用并入共享
 * callRecords；被调方若已先回落 entry@，则在证据出现后撤掉 entry@、改合成
 * call@ 见证（调用点域恢复 ⇒ 不再误报 entry-only）。
 *
 * 钉：函数体内的调用点 → 被调方有 call@ 见证（改前只有 entry@）；顶层调用点
 * 口径不变（负控制）；非导出函数口径不变（负控制）。
 */





function casesOf(result: ReturnType<typeof analyzeFile>, name: string): string[] {
  const fn = result.functions.find((f) => f.name === name);
  return (fn?.cases ?? []).map((c) => c.name);
}

describe("导出函数体内的调用点 → 合成 call@ 见证", () => {
  it("函数体内调用：被调方有 call@ 见证（改前只有 entry@）", () =>
    withTmpProject("nudo-b503-", (dir) => {
      const src = `export function add(a, b) {
  return a + b;
}
export function run() {
  return add(1, 2);
}
`;
      const file = writeTmpFile(dir, "B.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const names = casesOf(result, "add");
      expect(names.some((n) => n.startsWith("call@"))).toBe(true);
      expect(names.some((n) => n.startsWith("entry@"))).toBe(false);
      // 调用点域恢复 ⇒ 被调方不再误报 entry-only（调用方 run 仍无调用点域，仍报）
      const entryOnlyMsgs = result.diagnostics
        .filter((d) => d.code === "nudo:contract-entry-only")
        .map((d) => d.message);
      expect(entryOnlyMsgs.some((m) => m.includes("export 'add'"))).toBe(false);
    }));

  it("负控制：顶层调用点口径不变（call@ 见证仍在）", () =>
    withTmpProject("nudo-b503b-", (dir) => {
      const src = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
export function get() {
  return x;
}
`;
      const file = writeTmpFile(dir, "A.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const names = casesOf(result, "add");
      expect(names.some((n) => n.startsWith("call@"))).toBe(true);
      expect(names.some((n) => n.startsWith("entry@"))).toBe(false);
    }));

  it("负控制：非导出函数口径不变（保留 entry@ 见证）", () =>
    withTmpProject("nudo-b503c-", (dir) => {
      const src = `function inner2() { return 7; }
export function run2() { return inner2(); }
`;
      const file = writeTmpFile(dir, "same.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      const names = casesOf(result, "inner2");
      expect(names.some((n) => n.startsWith("entry@"))).toBe(true);
    }));
});
});

// ---------------------------------------------------------------------------
// entryThrows 非法值告警进程内去重
// ---------------------------------------------------------------------------
describe("entryThrows 非法值告警进程内去重", () => {
/**
 * 回归：`nudo.check.entryThrows` 的非法值告警必须**进程内去重**
 * （与同族 `nudo.check.profile` 的 `warnedGateConfig` 去重口径一致）。
 *
 * 病灶：`checkConfig()` 此前对非法 `entryThrows` 走**裸** `process.stderr.write`
 * ⇒ 批量检查（每个目标文件调一次 `checkConfig`）时同一 typo **每文件刷一行**
 * （N 个文件 N 行噪声）；而同一层配置的 `profile` typo 只报 1 行 ⇒ 两套口径。
 *
 * 修法（packages/service/src/evaluator/config.ts）：改走同文件的 `warnOnce`
 * （进程内按 key 去重）。
 *
 * 负控制：**不同**非法值各报一次（去重键含值，不是一刀切只报一行）。
 */



/** 抓取本次调用期间写进 stderr 的文本 */
function captureStderr(fn: () => void): string[] {
  const writes: string[] = [];
  const original = process.stderr.write;
  const stub = (chunk: unknown): boolean => {
    writes.push(String(chunk));
    return true;
  };
  process.stderr.write = stub as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return writes;
}

/**
 * 故意传入**类型上非法**的 `entryThrows` 值。
 *
 * `NudoConfig["check"]["entryThrows"]` 的静态类型是 `"error" | "warning" | "off"`，
 * 而运行时**必须**容错（`checkConfig` 对非法值告警并回落可用档位）⇒
 * 这里用一次**测试专用**的类型断言表达「我要喂一个类型之外的字面量」，
 * **断言语义不变**：被测的仍是运行时行为，不是类型。
 */
function illegalEntryThrows(value: string): "error" | "warning" | "off" {
  return value as "error" | "warning" | "off";
}

describe("entryThrows 非法值告警进程内去重", () => {
  const captureStderr = (fn: () => void): string[] => {
    const writes: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try { fn(); } finally { process.stderr.write = original; }
    return writes;
  };
  const illegal = (value: string) => value as "error" | "warning" | "off";
  it("同值只告警一次；不同值各一次；合法值不告警；非法值回落可用档", () => {
    const same = captureStderr(() => {
      checkConfig({ check: { entryThrows: illegal("bogus-639-same") } });
      checkConfig({ check: { entryThrows: illegal("bogus-639-same") } });
      checkConfig({ check: { entryThrows: illegal("bogus-639-same") } });
    });
    expect(same.length).toBe(1);
    expect(same[0]).toContain("nudo.check.entryThrows");
    expect(same[0]).toContain("bogus-639-same");

    const diff = captureStderr(() => {
      checkConfig({ check: { entryThrows: illegal("bogus-639-a") } });
      checkConfig({ check: { entryThrows: illegal("bogus-639-b") } });
    });
    expect(diff.length).toBe(2);
    expect(diff[0]).toContain("bogus-639-a");
    expect(diff[1]).toContain("bogus-639-b");

    const legal = captureStderr(() => {
      checkConfig({ check: { entryThrows: "warning" } });
      checkConfig({ check: { entryThrows: "off" } });
      checkConfig({ check: { entryThrows: "error" } });
    });
    expect(legal.length).toBe(0);
    expect(["error", "warning", "off"]).toContain(checkConfig({ check: { entryThrows: illegal("bogus-639-fallback") } }).entryThrows);
  });
});
;
});

// ---------------------------------------------------------------------------
// case 级 nudo:may-throw 认「已声明的有意抛」（与 check 面同口径）
// ---------------------------------------------------------------------------
describe("case 级 nudo:may-throw 认「已声明的有意抛」（与 check 面同口径）", () => {
/**
 * case 级 `nudo:may-throw` **不认「已声明的有意抛」** ⇒ 两个 verb
 * 对同一份文件给出**相反裁决**。
 *
 * 复现：源码里声明了有意抛（`@nudo:case "t" (1) !! throws TypeError` 或
 * `@nudo:throws TypeError`，或侧车 `fn(…, { throws: "TypeError" })`）⇒
 * - `nudo check` 面：L2 entry 面按「已申报」豁免 ⇒ **OK / 0 error**；
 * - `nudo test` 面：case 级 `nudo:may-throw` 只认「抛了就是问题」⇒ **照报**
 * 未处理的抛 ⇒ 同一文件两个 verb 裁决相反。
 *
 * 修法（`packages/service/src/analyzer-orchestrate-uncached-cases.ts`）：
 * case 级 `nudo:may-throw` 发射**前**先取该函数的**已声明抛**，口径与 check 面
 * （`packages/core/src/algebra/check.ts` 的 entry 面 / L2 面 →
 * `extractDeclaredThrows` → `filterGateThrows`）**同口径** ⇒ 已声明 ⇒ 不发 warning。
 *
 * 钉：
 * - `!! throws TypeError` ⇒ 无 `nudo:may-throw`（改前有）；
 * - `@nudo:throws TypeError` ⇒ 无 `nudo:may-throw`（改前有）；
 * - 侧车 `fn(…, { throws: "TypeError" })` ⇒ 无 `nudo:may-throw`（改前有）；
 * - 负控制：未申报 ⇒ **有** `nudo:may-throw`（口径不变）；
 * - 负控制：申报的 kind 不覆盖实测 kind（申报 RangeError / 实测 TypeError）
 * ⇒ **有** `nudo:may-throw`（口径不变）；
 * - 负控制：申报 `Error`（Error 族）覆盖实测 `TypeError` ⇒ 无 `nudo:may-throw`
 * （族覆盖口径与 check 面一致）；
 * - 负控制：坏侧车（加载失败）⇒ `nudo:contract-load` 仍报（memo 化不得吞掉
 * core 的「同 (路径, 原因) 只报一次」去重项）。
 */





type Diag = { code?: string; message?: string };

/** 跑一个文件（可带侧车），返回诊断列表。 */
function analyzeDiags(files: Record<string, string>): readonly Diag[] {
  return withTmpProject("nudo-b921-", (dir) => {
    const file = writeTmpFile(dir, "f.js", files["f.js"]!);
    for (const [rel, content] of Object.entries(files)) {
      if (rel === "f.js") continue;
      writeTmpFile(dir, rel, content);
    }
    return analyzeFile(file, readFileSync(file, "utf-8")).diagnostics;
  });
}

/** `nudo:may-throw` 诊断条数（case 级「未处理的抛」）。 */
function mayThrowCount(files: Record<string, string>): number {
  return analyzeDiags(files).filter((d) => d.code === "nudo:may-throw").length;
}

const THROWING_CASE = `/**
 * @nudo:case "t" (1)
 */
export function f(x) { throw new TypeError("x"); }
`;

const CASE_THROWS_DECL = `/**
 * @nudo:case "t" (1) !! throws TypeError
 */
export function f(x) { throw new TypeError("x"); }
`;

const FN_THROWS_DECL = `/**
 * @nudo:throws TypeError
 * @nudo:case "t" (1)
 */
export function f(x) { throw new TypeError("x"); }
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number() }, number(), { throws: "TypeError" });
`;

describe("case 级 nudo:may-throw 认「已声明的有意抛」（与 check 面同口径）", () => {
  type Diag = { code?: string; message?: string };
  const analyzeDiags = (files: Record<string, string>): readonly Diag[] => withTmpProject("nudo-b921-", (dir) => {
    const file = writeTmpFile(dir, "f.js", files["f.js"]!);
    for (const [rel, content] of Object.entries(files)) if (rel !== "f.js") writeTmpFile(dir, rel, content);
    return analyzeFile(file, readFileSync(file, "utf-8")).diagnostics;
  });
  const mayThrowCount = (files: Record<string, string>) => analyzeDiags(files).filter((d) => d.code === "nudo:may-throw").length;
  const THROWING_CASE = '/**\n * @nudo:case "t" (1)\n */\nexport function f(x) { throw new TypeError("x"); }\n';
  const CASE_THROWS_DECL = '/**\n * @nudo:case "t" (1) !! throws TypeError\n */\nexport function f(x) { throw new TypeError("x"); }\n';
  const FN_THROWS_DECL = '/**\n * @nudo:throws TypeError\n * @nudo:case "t" (1)\n */\nexport function f(x) { throw new TypeError("x"); }\n';
  const SIDECAR = 'import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number() }, number(), { throws: "TypeError" });\n';
  it("case/函数/侧车申报豁免；未申报与 kind 不覆盖仍报；Error 族覆盖不报；坏侧车 contract-load", () => {
    expect(mayThrowCount({ "f.js": CASE_THROWS_DECL })).toBe(0);
    expect(mayThrowCount({ "f.js": FN_THROWS_DECL })).toBe(0);
    expect(mayThrowCount({ "f.js": THROWING_CASE, "f.nudo.js": SIDECAR })).toBe(0);
    expect(mayThrowCount({ "f.js": THROWING_CASE })).toBe(1);
    expect(mayThrowCount({ "f.js": '/**\n * @nudo:throws RangeError\n * @nudo:case "t" (1)\n */\nexport function f(x) { throw new TypeError("x"); }\n' })).toBe(1);
    expect(mayThrowCount({ "f.js": '/**\n * @nudo:throws Error\n * @nudo:case "t" (1)\n */\nexport function f(x) { throw new TypeError("x"); }\n' })).toBe(0);
    const bad = analyzeDiags({ "f.js": THROWING_CASE, "f.nudo.js": 'import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number(\n' });
    expect(bad.filter((d) => d.code === "nudo:contract-load").length).toBeGreaterThan(0);
  });
});
;
});

// ---------------------------------------------------------------------------
// 分析面：推导失败 ⇒ nudo:opaque-result（INFO），不发 nudo:case-expected
// ---------------------------------------------------------------------------
describe("分析面：推导失败 ⇒ nudo:opaque-result（INFO），不发 nudo:case-expected", () => {
/**
 * （**分析面**）：第三态只活在报告面 ⇒ 同一输出里两条消息口径不一致。
 *
 * 报告面（`packages/nudojs/src/run-test.ts` 与 `packages/service/src/test-report.ts`）
 * 已把「引擎**未能推断**实测值」（实测 Abs 是 `unknown` / `conf === "opaque"`）
 * 记为 **unchecked**（无法判定、不置红、exit 0），
 * 但**分析面**的 `nudo:case-expected` 发射点
 * （`packages/service/src/analyzer-orchestrate-uncached-cases.ts`）
 * 仍用**二值**判定结果直接决定**诊断的严重度**
 * ⇒ 改后人类面 / `--json` 仍可见 `[error] … (nudo:case-expected)`，
 * 而断言面已是「unchecked + exit 0」⇒ **退出码与断言汇总正确、诊断文案却仍说「类型不匹配」**。
 *
 * 修法：发射点先判「推导失败」⇒ 记 **INFO** 的 `nudo:opaque-result`
 * （与 check 面把同一事实判成 INFO、exit 0 **同严重度、同码**），
 * **不发** `nudo:case-expected` error；「推导成功 + 期望不符」的真失败分支**逐字不动**。
 *
 * 钉：
 * - 推导失败 + 期望 `number()` ⇒ **没有** `nudo:case-expected`；
 * 有且仅有 `nudo:opaque-result`，且 **severity = "info"**；
 * - 推导失败 + 期望 `any()` ⇒ 同上（**不被放宽的期望空洞通过**）；
 * - 负控制：推导成功 + 期望不符 ⇒ 仍是 `nudo:case-expected` **error**；
 * - 负控制：推导成功 + 期望相符 ⇒ 两者都**不**产出。
 */





/** 引擎**推不出来**的函数体（`(x.get)().a ||= 2` 不被求值器支持 ⇒ 实测 unknown）。 */
const OPAQUE_BODY = `export function f(o) {
  const x = { a: 1 };
  (x.get)().a ||= 2;
  return x.a;
}
`;

/** 推导成功（负控制）：实测是 `x + 1`，期望 `string()` ⇒ 真失败。 */
const INFERRED_BODY = `export function g(x) { return x + 1; }
`;

type Diag = { code: string; severity: string; message: string };

/** 分析一个带声明期望的 case 文件，返回全部诊断。 */
function diagsOf(src: string): Diag[] {
  return withTmpProject("nudo-b950-an-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    const result = analyzeFile(file, readFileSync(file, "utf-8"));
    return result.diagnostics.map((d) => ({
      code: d.code ?? "",
      severity: d.severity,
      message: d.message,
    }));
  });
}

describe("分析面：推导失败 ⇒ nudo:opaque-result（INFO），不发 nudo:case-expected", () => {
  const OPAQUE_BODY = "export function f(o) {\n  const x = { a: 1 };\n  (x.get)().a ||= 2;\n  return x.a;\n}\n";
  const INFERRED_BODY = "export function g(x) { return x + 1; }\n";
  type Diag = { code: string; severity: string; message: string };
  const diagsOf = (src: string): Diag[] => withTmpProject("nudo-b950-an-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    const result = analyzeFile(file, readFileSync(file, "utf-8"));
    return result.diagnostics.map((d) => ({ code: d.code ?? "", severity: d.severity, message: d.message }));
  });
  it("推导失败只发 opaque info；成功不符报 case-expected；成功相符都不发", () => {
    for (const expected of ["number()", "any()"]) {
      const diags = diagsOf(`/**\n * @nudo:case "w" (1) => ${expected}\n */\n${OPAQUE_BODY}`);
      expect(diags.filter((d) => d.code === "nudo:case-expected"), expected).toHaveLength(0);
      const opaque = diags.filter((d) => d.code === "nudo:opaque-result");
      expect(opaque, expected).toHaveLength(1);
      expect(opaque[0]!.severity, expected).toBe("info");
      expect(opaque[0]!.message, expected).toContain("could not infer the actual value");
      expect(opaque[0]!.message, expected).not.toContain("does not match the expected type");
    }
    const failed = diagsOf(`/**\n * @nudo:case "w" (1) => string()\n */\n${INFERRED_BODY}`);
    const bad = failed.filter((d) => d.code === "nudo:case-expected");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("error");
    expect(bad[0]!.message).toContain("does not match the expected type");
    expect(failed.filter((d) => d.code === "nudo:opaque-result")).toHaveLength(0);
    const ok = diagsOf(`/**\n * @nudo:case "w" (1) => number()\n */\n${INFERRED_BODY}`);
    expect(ok.filter((d) => d.code === "nudo:case-expected")).toHaveLength(0);
    expect(ok.filter((d) => d.code === "nudo:opaque-result")).toHaveLength(0);
  });
});
;
});

// ---------------------------------------------------------------------------
// service 报告面（agent testTool）的第三态：推导失败 ⇒ unchecked
// ---------------------------------------------------------------------------
describe("service 报告面（agent testTool）的第三态：推导失败 ⇒ unchecked", () => {
/**
 * 断言判定**没有「推导失败」第三态**（LSP agent `testTool` 的报告面）。
 *
 * 本模块（`packages/service/src/test-report.ts`）是 CLI `nudo test` 报告面的
 * **平行副本**（LSP agent 工具面 `packages/lsp/src/agent-tools.ts` 的
 * `testTool` 调它）⇒ 第三态必须**两处同改**，否则 CLI 与 agent 工具面口径分叉。
 *
 * 根因：断言判定是**二值**的——实测侧 `unknown`（**引擎没推出来**）被压成
 * 「断言不符」（假红），而 `any()` 期望又借 core `leqAbs` 的「目标放宽 ⇒ 通过」
 * 捷径**空洞通过**（假绿）⇒ 同一事实两种期望都不可用；且与 check 面把同一
 * 状态判成 INFO（`nudo:opaque-result`、exit 0）**严重度相反**。
 *
 * 修法：报告面引入**第三态**——实测侧是 `unknown` / `conf === "opaque"`
 * （推导失败）⇒ 记 **unchecked（无法判定）**：`failed` 不计它、`passed` 不计它、
 * `unchecked` 计它；outcome 带 `uncheckedReason: "inference-failed"` 供消费方
 * 区分「无法判定」与「没写期望」。
 *
 * 钉（service 报告面）：
 * - 推导失败 + 期望 `number()` ⇒ unchecked（**不是** failed）+ reason；
 * - 推导失败 + 期望 `any()` ⇒ 同样 unchecked（**不是** passed）；
 * - 负控制：推导成功 + 期望不符 ⇒ 仍是 failed；
 * - 负控制：声明了但**没写**期望 ⇒ 既有 `no-expectation` 口径不变；
 * - 负控制：抛错（实测 `never`）⇒ 仍是 failed（**不是**「推导失败」——
 * `never` 是底元素，的判定层已把它拦成「不满足」）。
 */






/** 引擎**推不出来**的函数体（`(x.get)().a ||= 2` 不被求值器支持 ⇒ 实测 unknown）。 */
const OPAQUE_BODY = `export function f(o) {
  const x = { a: 1 };
  (x.get)().a ||= 2;
  return x.a;
}
`;

type Report = ReturnType<typeof buildTestReport>;

/** 跑一个带声明期望的 case 文件，返回报告面结果。 */
function reportOf(src: string): Report {
  return withTmpProject("nudo-b950-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    return buildTestReport(file, analyzeFile(file, readFileSync(file, "utf-8")));
  });
}

describe("service 报告面（agent testTool）的第三态：推导失败 ⇒ unchecked", () => {
  const OPAQUE_BODY = "export function f(o) {\n  const x = { a: 1 };\n  (x.get)().a ||= 2;\n  return x.a;\n}\n";
  const reportOf = (src: string) => withTmpProject("nudo-b950-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    return buildTestReport(file, analyzeFile(file, readFileSync(file, "utf-8")));
  });
  it("推导失败 number/any 都 unchecked；成功不符 failed；无期望 no-expectation；never failed", () => {
    for (const expected of ["number()", "any()"]) {
      const report = reportOf(`/**\n * @nudo:case "c" (1) => ${expected}\n */\n${OPAQUE_BODY}`);
      expect(report.failed, expected).toBe(0);
      expect(report.passed, expected).toBe(0);
      expect(report.unchecked, expected).toBe(1);
      const o = report.outcomes.find((x) => x.caseName === "c")!;
      expect(o.unchecked, expected).toBe(true);
      expect(o.uncheckedReason, expected).toBe("inference-failed");
      expect(o.ok, expected).toBe(false);
      expect(o.actual, expected).toBe("unknown");
    }
    const failed = reportOf('/**\n * @nudo:case "wrong" (1) => string()\n */\nexport function g(x) { return x + 1; }\n');
    expect(failed.failed).toBe(1);
    expect(failed.unchecked).toBe(0);
    expect(failed.outcomes.find((x) => x.caseName === "wrong")!.unchecked).toBe(false);
    const noExpect = reportOf('/**\n * @nudo:case "free" (1)\n */\nexport function g(x) { return x + 1; }\n');
    expect(noExpect.unchecked).toBe(1);
    expect(noExpect.outcomes.find((x) => x.caseName === "free")!.uncheckedReason).toBe("no-expectation");
    const thrown = reportOf('/**\n * @nudo:case "t" (1) => 42\n */\nexport function g(x) { throw new Error("boom"); }\n');
    expect(thrown.failed).toBe(1);
    expect(thrown.unchecked).toBe(0);
  });
});
;
});
