/**
 * 模块套件：service mock/directive/replace/skip 面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { parse, extractDirectivesQuiet, type DirectiveDiag } from "@nudojs/parser";
import { litValue, type AbsModuleExports, checkSource, formatShape, pTrue, type RunTranspiledOptions, $call, $lit, formatAbs, runTranspiled, callTranspiledExportFull, type NudoSig } from "@nudojs/core";
import { mockSeedsToAbsMocks, mockDirectivesToAbsSeeds, mockScopeOverridesOf, mockScopeSelected } from "../mock-abs.ts";
import { tryEvalCallFull, collectEvalReplacements } from "../eval-run.ts";
import { collectAbsBindingsFromGraph, evalAbsModuleGraph } from "../abs-modules-graph.ts";
import { analyzeFileAsync, analyzeFile } from "../analyzer.ts";
import { join } from "node:path";
import { applyMockModuleDirectivesFromSource } from "../mock-module.ts";
import { collectCheckSupplementIssues, directiveDiagIssues } from "../check-issues.ts";
import { tmpProject, writeTmpFile, withTmpProject, tmpProject as makeTmpProject } from "./tmp-project.ts";
import { l2Count } from "./check-helpers.ts";
import { analyzeFile as analyzeFile___nudojs_service } from "@nudojs/service";
import { generateDts } from "../emit/dts-generator.ts";
import { collectEvalReplacements as collectEvalReplacements_____eval_injection_ts, collectEvalReplacements as collectEvalReplacements_____eval_injection_ts_1, resolveEvalInjection } from "../eval-injection.ts";
import { readFileSync,  } from "node:fs";
import { collectSkipReturns } from "../skip-directives.ts";
import { pureFnNamesOfAst } from "../eval-pure.ts";
import { hasNudoDirectives, shouldAnalyzeFile } from "../analysis-scope.ts";
import { analysisConfig } from "../evaluator/config.ts";
import { defaultLoadModule } from "../load-module.ts";

// ---------------------------------------------------------------------------
// （service 侧）—— 宿主内建名的 mock 不再被 env 跳过表吞掉
// ---------------------------------------------------------------------------
describe("（service 侧）—— 宿主内建名的 mock 不再被 env 跳过表吞掉", () => {
/**
 * service 侧剩余半边：mock 与 env 必须**分表传**。
 *
 * 根因（core 侧已由片 C 修好，service 侧此前还差半边）：
 * - core 的注入面把 env 全局与 mock 分**两张表**过滤：「不遮蔽宿主内建」
 * 跳过表（ENV_SHADOW_SKIP）**只作用于 env 全局**，mock 键集不过滤
 * （mock 的值本身就是一个 Abs，没有宿主对象身份需要保全——遮蔽宿主全局
 * 正是 mock 的意图）。
 * - 但 service 侧两处把 mock **并进** `envGlobals` 一张表传给 core ⇒ core
 * 收到时**分不清哪些是 mock** ⇒ 名单内的 mock（`Math` / `JSON` / `Date` …）
 * 在注入前就被跳过表丢弃 ⇒ `@nudo:mock Math` 静默 no-op（跑的是宿主内建）。
 * - 合并点 ①：`eval-run.ts` 的 `tryRunEval`（调用值面 / case 求值通道）
 * - 合并点 ②：`abs-modules-graph.ts` 的 `collectAbsBindingsFromGraph`
 *
 * 修法：两处都**分表传**（`mocks` 走独立形参，`envGlobals` 只装 env 全局）。
 * **优先级不变**：core 的 `__nudoEnv` 读面 = `{ ...envGlobals, ...mocks }`
 * ⇒ 同名时 **mock 覆盖 env**（与此前「合并表里 mock 在后」逐字等价）。
 *
 * 钉：
 * - 宿主内建名的 mock 在**调用值面**生效（`tryEvalCallFull`，与 `nudo test`
 * 的 case 值同通道）；产品面（`analyzeFileAsync`）同值。
 * - 负控制：普通名 mock 逐字不变；mock 覆盖 env 的优先级不变；env 全局仍受
 * 跳过表约束（env 的 `Math` 不遮蔽宿主 `Math`）；无 mock 时宿主应答不变。
 * - 第二合并点：模块图绑定面（`collectAbsBindingsFromGraph`）同样尊重
 * 宿主内建名的 mock。
 */








/** mock 种子表（与生产管线同源：指令 → Abs 种子 → 注入表） */
function mocksOf(source: string, fromFile: string): Record<string, never> {
  const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile });
  return mockSeedsToAbsMocks(seeds) as Record<string, never>;
}

/**
 * 调用值面：求值引擎按 mock 表求值被调导出，返回字面量值。
 * 与 `nudo test` 的 case 值 / `nudo export` 的 dts 面同通道。
 */
function callValue(
  source: string,
  file: string,
  opts: { envNames?: string[] } = {},
): { value: unknown; isLiteral: boolean; display: string } {
  const mocks = mocksOf(source, file);
  const full = tryEvalCallFull(source, file, "run", [], {
    mocks: Object.keys(mocks).length ? (mocks as never) : undefined,
    envNames: opts.envNames,
  });
  expect(full, `调用值面未产出结果：${file}`).toBeDefined();
  const lit = litValue(full!.result);
  return {
    value: lit.ok ? lit.value : undefined,
    isLiteral: lit.ok,
    display: lit.ok ? String(lit.value) : "(non-literal)",
  };
}

const MOCK_NUMBER = `/**
 * @nudo:mock Number = stub().returns(42)
 */
export function run() {
  return Number("7");
}
`;

const MOCK_MATH = `/**
 * @nudo:mock Math = stub().returns(42)
 */
export function run() {
  return Math.floor(1.5);
}
`;

const MOCK_JSON = `/**
 * @nudo:mock JSON = stub().returns("MOCKED")
 */
export function run() {
  return JSON.stringify({ a: 1 });
}
`;

const MOCK_DATE = `/**
 * @nudo:mock Date = stub().returns("MOCKED")
 */
export function run() {
  return Date.now();
}
`;

/** 负控制：普通名 mock（不在跳过名单上）——改前就生效，改后必须逐字不变 */
const MOCK_PLAIN = `/**
 * @nudo:mock myFn = stub().returns("MOCKED")
 */
export function run() {
  return myFn();
}
`;

/** 负控制：env（node）与 mock **同名** ⇒ mock 必须赢（既有优先级语义） */
const MOCK_OVER_ENV = `/**
 * @nudo:mock process = stub().returns("MOCKED")
 */
export function run() {
  return process();
}
`;

/** 负控制：没有 mock ⇒ 宿主应答 */
const NO_MOCK = `export function run() {
  return Number("7");
}
`;

{
  const mocksOf = (source: string, fromFile: string) => mockSeedsToAbsMocks(mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile })) as Record<string, never>;
  const callValue = (source: string, file: string, envNames?: string[]) => {
    const mocks = mocksOf(source, file);
    const full = tryEvalCallFull(source, file, "run", [], { mocks: Object.keys(mocks).length ? (mocks as never) : undefined, envNames });
    expect(full).toBeDefined();
    const lit = litValue(full!.result);
    return { value: lit.ok ? lit.value : undefined, isLiteral: lit.ok };
  };
  const MOCK_NUMBER = '/**\n * @nudo:mock Number = stub().returns(42)\n */\nexport function run() {\n  return Number("7");\n}\n';
  const MOCK_MATH = '/**\n * @nudo:mock Math = stub().returns(42)\n */\nexport function run() {\n  return Math.floor(1.5);\n}\n';
  const MOCK_JSON = '/**\n * @nudo:mock JSON = stub().returns("MOCKED")\n */\nexport function run() {\n  return JSON.stringify({ a: 1 });\n}\n';
  const MOCK_DATE = '/**\n * @nudo:mock Date = stub().returns("MOCKED")\n */\nexport function run() {\n  return Date.now();\n}\n';
  const MOCK_PLAIN = '/**\n * @nudo:mock myFn = stub().returns("MOCKED")\n */\nexport function run() {\n  return myFn();\n}\n';
  const MOCK_OVER_ENV = '/**\n * @nudo:mock process = stub().returns("MOCKED")\n */\nexport function run() {\n  return process();\n}\n';
  const NO_MOCK = 'export function run() {\n  return Number("7");\n}\n';
  it("内建 mock 生效/产品面同值/负控；绑定图第二合并点同口径", async () => {
    expect(callValue(MOCK_NUMBER, "/tmp/b274-n.js").value).toBe(42);
    expect(callValue(MOCK_MATH, "/tmp/b274-m.js").value).not.toBe(1);
    expect(callValue(MOCK_JSON, "/tmp/b274-j.js").value).not.toBe('{"a":1}');
    expect(callValue(MOCK_DATE, "/tmp/b274-d.js").isLiteral).toBe(false);
    const res = await analyzeFileAsync("/tmp/b274-p.js", MOCK_NUMBER);
    expect(litValue(res.functions.find((f) => f.name === "run")!.combinedAbs!)).toEqual({ ok: true, value: 42 });
    expect(callValue(MOCK_PLAIN, "/tmp/b274-plain.js").value).toBe("MOCKED");
    expect(callValue(MOCK_OVER_ENV, "/tmp/b274-prio.js", ["node"]).value).toBe("MOCKED");
    expect(callValue(NO_MOCK, "/tmp/b274-skip.js", ["node"]).value).toBe(7);
    expect(callValue(NO_MOCK, "/tmp/b274-nomock.js").value).toBe(7);

    const src = '/**\n * @nudo:mock Number = stub().returns(42)\n */\nexport function run() {\n  return Number("7");\n}\nconst x = Number("7");\n';
    const file = "/tmp/b274-bind.js";
    const binds = collectAbsBindingsFromGraph(src, file, { seedVars: mocksOf(src, file) as never });
    expect(litValue(binds.get("x")!)).toEqual({ ok: true, value: 42 });
  });
}



});

// ---------------------------------------------------------------------------
// mock-module 点名缺失（fail-closed，不静默回落原模块）
// ---------------------------------------------------------------------------
describe("mock-module 点名缺失（fail-closed，不静默回落原模块）", () => {
/**
 * `@nudo:mock-module` 的**局部（点名）形态**：被**点名**但 mock 文件
 * **没有导出**的名字被 `pickNamed` **静默跳过** ⇒ `{ ...orig.named, ...overlay.named }`
 * 让**原模块的同名导出原封不动活下来** ⇒ 分析跑在「**一半 mock、一半原模块**」的
 * **混合程序**上；该分支**无条件 `applied = true`、零 error** ⇒ 违反本模块自陈的
 * fail-closed 不变式（"missing mock file / eval failure / empty binding → error,
 * not a silent drop"）。
 *
 * 修法（`packages/service/src/mock-module.ts`）：
 * - `pickNamed` 报出 **missing**（被点名但 mock 没有导出的名字）；
 * - `applyMockModuleDirectives` 的局部分支：missing 非空 ⇒ **走错误出口**
 * （`nudo:module-missing` / error，见 `check-issues.ts` 的既有 errors 通道）
 * ⇒ 该条指令**不生效**（`applied` 不置 true、原模块保持原样）。
 *
 * ⇒ 断言非永真：HEAD 上「点名缺失」既不报错也不 applied（见反向闸）。
 */







let dir: string;

beforeEach(() => {
  dir = tmpProject("nudo-bug-963-");
});

/** 原模块导出槽（哨兵值：与 mock 的值刻意不同 ⇒ 能看出「谁活下来了」）。 */
function origLit(v: string): AbsModuleExports["named"][string] {
  return { shape: { k: "str", v }, term: { op: "lit", value: v }, conf: "exact" } as never;
}

/** 原模块（被 mock 覆盖的那个说明符）的导出表。 */
function baseModules(): Record<string, AbsModuleExports> {
  return {
    "./dep.js": {
      named: {
        depFn: origLit("ORIGINAL-depFn"),
        otherFn: origLit("ORIGINAL-otherFn"),
      },
    },
  };
}

/** mock 文件（只导出 depFn）。 */
function writeMock(): void {
  writeTmpFile(dir, "mock.js", `export function depFn() { return "MOCK"; }\n`);
}

{
  let dir: string;
  beforeEach(() => { dir = tmpProject("nudo-bug-963-"); });
  const origLit = (v: string): AbsModuleExports["named"][string] => ({ shape: { k: "str", v }, term: { op: "lit", value: v }, conf: "exact" } as never);
  const baseModules = (): Record<string, AbsModuleExports> => ({ "./dep.js": { named: { depFn: origLit("ORIGINAL-depFn"), otherFn: origLit("ORIGINAL-otherFn") } } });
  const writeMock = () => { writeTmpFile(dir, "mock.js", 'export function depFn() { return "MOCK"; }\n'); };
  const SRC_MISSING = '/// @nudo:mock-module "./dep.js" { depFn, otherFn } from "./mock.js"\nimport { depFn, otherFn } from "./dep.js";\nexport function run() { return depFn() + "/" + otherFn(); }\n';
  it("点名缺失 fail-closed；提供者 overlay；未点名回落；多缺失/ default；check 面；全替换不受影响", () => {
    writeMock();
    const base = baseModules();
    const r = applyMockModuleDirectivesFromSource(SRC_MISSING, base, { fromFile: join(dir, "app.js") });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toContain('does not export "otherFn"');
    expect(r.errors[0]!.code).toBeUndefined();
    expect(r.errors[0]!.fromPath).toBe("./mock.js");
    expect(r.applied).toBe(false);
    expect(r.modules["./dep.js"]).toBe(base["./dep.js"]);
    expect(r.modules["./dep.js"]!.named.depFn).toBe(base["./dep.js"]!.named.depFn);
    expect(r.modules["./dep.js"]!.named.otherFn).toBe(base["./dep.js"]!.named.otherFn);

    const partial = applyMockModuleDirectivesFromSource('/// @nudo:mock-module "./dep.js" { depFn } from "./mock.js"\nimport { depFn, otherFn } from "./dep.js";\nexport function run() { return depFn() + "/" + otherFn(); }\n', base, { fromFile: join(dir, "app.js") });
    expect(partial.applied).toBe(true);
    expect(partial.errors).toHaveLength(0);
    expect(partial.modules["./dep.js"]!.named.depFn).not.toBe(base["./dep.js"]!.named.depFn);
    expect(partial.modules["./dep.js"]!.named.otherFn).toBe(base["./dep.js"]!.named.otherFn);

    const multi = applyMockModuleDirectivesFromSource('/// @nudo:mock-module "./dep.js" { depFn, otherFn, third } from "./mock.js"\nimport { depFn } from "./dep.js";\nexport function run() { return depFn(); }\n', base, { fromFile: join(dir, "app.js") });
    expect(multi.errors).toHaveLength(2);
    expect(multi.errors[0]!.message).toContain('does not export "otherFn"');
    expect(multi.errors[1]!.message).toContain('does not export "third"');
    expect(multi.applied).toBe(false);

    writeTmpFile(dir, "mock-empty.js", "const unused = 1;\nvoid unused;\n");
    const def = applyMockModuleDirectivesFromSource('/// @nudo:mock-module "./dep.js" { default } from "./mock-empty.js"\nimport { depFn } from "./dep.js";\nexport function run() { return depFn(); }\n', base, { fromFile: join(dir, "app.js") });
    expect(def.errors).toHaveLength(1);
    expect(def.errors[0]!.message).toContain('does not export "default"');
    expect(def.applied).toBe(false);

    writeTmpFile(dir, "dep.js", 'export function depFn() { return "REAL-dep"; }\nexport function otherFn() { return "ORIGINAL"; }\n');
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", SRC_MISSING);
    const issues = collectCheckSupplementIssues(file, SRC_MISSING).filter((i) => i.code === "nudo:module-missing");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain('does not export "otherFn"');

    const full = applyMockModuleDirectivesFromSource('/// @nudo:mock-module "./dep.js" from "./mock.js"\nimport { depFn } from "./dep.js";\nexport function run() { return depFn(); }\n', base, { fromFile: join(dir, "app.js") });
    expect(full.applied).toBe(true);
    expect(full.errors).toHaveLength(0);
    expect(Object.keys(full.modules["./dep.js"]!.named)).toEqual(["depFn"]);
  });
}
});

// ---------------------------------------------------------------------------
// @nudo:replace 命中的子表达式仍求值
// ---------------------------------------------------------------------------
describe("@nudo:replace 命中的子表达式仍求值", () => {
/**
 * / 回归（@nudo:replace / @nudo:as 指令面）。
 *
 * @nudo:replace 命中的子表达式**仍要求值**——副作用与 throws 域
 * 保留（L2 门禁不再假绿），只是**结果**被注入值取代。
 * 修复前：命中节点整段替换 → 原表达式从不求值 → 副作用归零、抛错域消失
 * （`JSON.parse(input)` 的 TypeError 被吞 → L2 假绿）。
 *
 * 指令作用范围按 **AST 节点身份**（源文本字符区间）判定，不是
 * 「同一行号窗口」——不再泄漏进嵌套语句 / 嵌套函数体 / 同行下一条语句
 * （文档承诺「only affects the immediately following statement」）。
 *
 * 负控制钉住：指令**仍**作用于它标注的那条语句/子表达式（不被本次修复
 * 波及）；未被标注的相邻子表达式照常求值。
 */






/** 收集指令 → 注入包 → checkSource（产品面同口径：collect → inject → 门禁） */
function check(src: string, file = "/t/replace-scope.js") {
  const reps = collectEvalReplacements(src);
  const inject: RunTranspiledOptions = {
    replacements: reps.values,
    replacementTargets: reps.targets,
    asOverrides: reps.asValues,
    asOverrideTargets: reps.asTargets,
  };
  return checkSource(file, src, pTrue, { inject });
}

/** checkSource 签名显示串 */
function sigOf(r: { signatures: { name: string; display: string }[] }, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

/** @nudo:case 见证值（确定性） */
function witness(src: string, file = "/t/replace-scope.js"): string {
  const r = analyzeFile(file, src);
  return formatShape(r.functions[0].cases[0].abs);
}

{
  const sigOf = (r: { signatures: { name: string; display: string }[] }, fn: string) => r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
  const witness = (src: string, file = "/t/replace-scope.js") => formatShape(analyzeFile(file, src).functions[0]!.cases[0]!.abs);
  it("throws/副作用保留；覆盖仍生效；相邻子表达式不受影响", () => {
    const withDirective = 'export function f(input) {\n  // @nudo:replace JSON.parse(input) number()\n  const v = JSON.parse(input);\n  return v;\n}\n';
    const control = 'export function f(input) {\n  const v = JSON.parse(input);\n  return v;\n}\n';
    expect(l2Count(check(withDirective), "f")).toBe(1);
    expect(l2Count(check(control), "f")).toBe(1);
    expect(sigOf(check(withDirective), "f")).toContain("number");

    const side = 'let counter = 0;\nfunction bump() { counter = counter + 1; return counter; }\n/** @nudo:case "c" () */\nexport function f() {\n  // @nudo:replace bump() number()\n  const x = bump();\n  return counter;\n}\n';
    const sideControl = 'let counter = 0;\nfunction bump() { counter = counter + 1; return counter; }\n/** @nudo:case "c" () */\nexport function f() {\n  const x = bump();\n  return counter;\n}\n';
    expect(witness(side)).toBe("1");
    expect(witness(sideControl)).toBe("1");

    const adjacent = '/**\n * @nudo:case "c" (5, 10)\n */\nexport function f(a, b) {\n  // @nudo:replace a lit(100)\n  const x = a + b;\n  return x;\n}\n';
    expect(witness(adjacent)).toBe("110");
  });
}

describe("@nudo:as / @nudo:replace 的作用范围按 AST 节点身份", () => {
  const sigOf = (r: { signatures: { name: string; display: string }[] }, fn: string) => r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
  const witness = (src: string) => formatShape(analyzeFile("/t/replace-scope.js", src).functions[0]!.cases[0]!.abs);
  it("as/replace 不泄漏进 if 块/嵌套函数/同行下一条；正例仍生效", () => {
    const withIf = 'export function f(cond) {\n  // @nudo:as number()\n  if (cond) {\n    const x = "str";\n    return x;\n  }\n  return 0;\n}\n';
    const controlIf = 'export function f(cond) {\n  if (cond) {\n    const x = "str";\n    return x;\n  }\n  return 0;\n}\n';
    expect(sigOf(check(withIf), "f")).toBe(sigOf(check(controlIf), "f"));
    expect(sigOf(check(withIf), "f")).toContain('"str"');

    const withNested = 'export function f(x) {\n  // @nudo:replace x number()\n  const g = function () {\n    return x;\n  };\n  return g();\n}\n';
    const controlNested = 'export function f(x) {\n  const g = function () {\n    return x;\n  };\n  return g();\n}\n';
    expect(sigOf(check(withNested), "f")).toBe(sigOf(check(controlNested), "f"));

    const sameLine = 'export function f(a) {\n  // @nudo:replace a number()\n  const x = a; const y = a;\n  return [x, y];\n}\n';
    const sameSig = sigOf(check(sameLine), "f");
    expect(sameSig).toContain("[number, any]");
    expect(sameSig).not.toContain("[number, number]");

    expect(witness('/**\n * @nudo:case "c" (5, 10)\n */\nexport function f(a, b) {\n  // @nudo:replace a lit(100)\n  const x = a + b;\n  return x;\n}\n')).toBe("110");
    expect(witness('/**\n * @nudo:case "c" ()\n */\nexport function f() {\n  // @nudo:as string()\n  const a = 1;\n  return a;\n}\n')).toBe("string");
  });
});
});

// ---------------------------------------------------------------------------
// skipped 导出不得从产物里消失
// ---------------------------------------------------------------------------
describe("skipped 导出不得从产物里消失", () => {
/**
 * `@nudo:skip`（未声明返回类型）让 export 面把**整条导出静默丢掉**
 * （`.d.ts` 里该函数不存在，exit 0 零警告），而 `nudo check`（core）为同一
 * 函数合成 `any` ⇒ 两面相反 + 消费端 `import` TS2305。
 *
 * 修法：`combinedAbs == null` 分支不再返回空行，投影成 `(...args: unknown[]): unknown`
 * （2026-11-06 TS 投影面归一；`nudo check` 展示面仍合成 nudo any）。
 */





  it("skip 未声明返回仍声明 unknown；普通函数不受影响", () => {
    const dts = generateDts(analyzeFile___nudojs_service("/test/bug079.js", '/**\n * @nudo:skip\n */\nexport function boom(a) {\n  return a;\n}\n'));
    expect(dts).toContain("export declare function boom(...args: unknown[]): unknown;");
    const plain = generateDts(analyzeFile___nudojs_service("/test/bug079b.js", "export function plain(a) {\n  return a + 1;\n}\nplain(1);\n"));
    expect(plain).toMatch(/export declare function plain\(/);
    expect(plain).not.toContain("export declare function plain(...args: unknown[]): unknown;");
  });

});

// ---------------------------------------------------------------------------
// 孤儿行内指令的诊断不被同文件其它指令抑制
// ---------------------------------------------------------------------------
describe("孤儿行内指令的诊断不被同文件其它指令抑制", () => {
/**
 * 行内指令「无处可施」的诊断被**同文件另一条生效指令**抑制 ⇒
 * 诊断覆盖度取决于无关代码。
 *
 * 根因：`packages/service/src/eval-injection.ts` 的 `collectInto` 只在
 * 「收集表**全空**」（`acc.targets.length === 0 && acc.asTargets.length === 0`）
 * 时才发那条 `nudo:directive-syntax`；只要文件里有任意一条生效的
 * `@nudo:as` / `@nudo:replace`，挂在非语句节点上的孤儿指令就**彻底静默**。
 *
 * 修法：按**指令粒度**上报——每处孤儿各一条（位置进身份），与收集表是否
 * 为空无关。
 *
 * 断言非永真：改前 `ORPHAN_PLUS_WORKING` 的孤儿诊断数为 **0**（`ORPHAN_ONLY`
 * 为 1）⇒ 同一份写错的指令只因文件里多了一条有效指令就隐身。
 */




/** 孤儿 `@nudo:as`：挂在对象属性（非语句节点）上 ⇒ 无处可施 */
const ORPHAN_ONLY = `export function f(x) {
  const obj = {
    // @nudo:as number()
    a: JSON.parse(x),
  };
  return obj;
}
`;

/** 同一份孤儿指令 + 一条**生效**的 `@nudo:as`（唯一变量） */
const ORPHAN_PLUS_WORKING = `export function f(x) {
  const obj = {
    // @nudo:as number()
    a: JSON.parse(x),
  };
  // @nudo:as string()
  const s = JSON.parse(x);
  return [obj, s];
}
`;

/** 两处孤儿（同一文案、不同位置）⇒ 各报一条（位置进身份） */
const TWO_ORPHANS = `export function f(x) {
  const obj = {
    // @nudo:as number()
    a: JSON.parse(x),
    // @nudo:as number()
    b: JSON.parse(x),
  };
  return obj;
}
`;

function orphanDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  collectEvalReplacements_____eval_injection_ts(src, { diags });
  return diags.filter(
    (d) =>
      d.code === "nudo:directive-syntax" &&
      d.message.includes("is not attached to a statement"),
  );
}

{
  const ORPHAN_ONLY = 'export function f(x) {\n  const obj = {\n    // @nudo:as number()\n    a: JSON.parse(x),\n  };\n  return obj;\n}\n';
  const ORPHAN_PLUS_WORKING = 'export function f(x) {\n  const obj = {\n    // @nudo:as number()\n    a: JSON.parse(x),\n  };\n  // @nudo:as string()\n  const s = JSON.parse(x);\n  return [obj, s];\n}\n';
  const TWO_ORPHANS = 'export function f(x) {\n  const obj = {\n    // @nudo:as number()\n    a: JSON.parse(x),\n    // @nudo:as number()\n    b: JSON.parse(x),\n  };\n  return obj;\n}\n';
  const orphanDiags = (src: string): DirectiveDiag[] => {
    const diags: DirectiveDiag[] = [];
    collectEvalReplacements_____eval_injection_ts(src, { diags });
    return diags.filter((d) => d.code === "nudo:directive-syntax" && d.message.includes("is not attached to a statement"));
  };
  it("单孤儿一条；孤儿+生效仍一条且文案不变；生效指令入表；两孤儿各一条", () => {
    expect(orphanDiags(ORPHAN_ONLY)).toHaveLength(1);
    expect(orphanDiags(ORPHAN_PLUS_WORKING)).toHaveLength(1);
    expect(orphanDiags(ORPHAN_PLUS_WORKING)[0]!.message).toBe("inline directive (@nudo:as / @nudo:replace) is not attached to a statement — it has no effect");
    expect(collectEvalReplacements_____eval_injection_ts(ORPHAN_PLUS_WORKING).asTargets).toHaveLength(1);
    expect(orphanDiags(TWO_ORPHANS)).toHaveLength(2);
  });
}
});

// ---------------------------------------------------------------------------
// @nudo:replace 目标文本在源码里不存在 ⇒ 显式诊断
// ---------------------------------------------------------------------------
describe("@nudo:replace 目标文本在源码里不存在 ⇒ 显式诊断", () => {
/**
 * / 指令的**语义前提被违反**时，引擎**静默失效、零诊断**
 * ⇒ 唯一的信号是**归因错误**的 `nudo:unknown-inference`（把「你的指令没生效」
 * 说成「推断精度不够」）⇒ 假红 / 假绿。
 *
 * ── （`@nudo:replace` 的目标文本在源码里不存在）────────────────────
 * 病灶：`packages/service/src/eval-injection.ts` 的**收集面**把「目标文本在
 * 本语句作用域内无对应节点」降级成一条**无作用域**登记项（`stmtStart/stmtEnd`
 * 缺省）⇒ 转译面（core 的 `matchReplacement`）恒跳过 ⇒ 声明的类型覆盖
 * **静默蒸发**、零诊断。
 * 改前：`a2-miss`（目标写错一个字母）与 `a3-nodirective`（根本没有这条指令）
 * 的诊断集**逐字相同**（都为空）⇒ 「写错目标」与「没写指令」**不可区分**。
 * 改后：收集面发一条**点名目标文本**的 `nudo:directive-syntax`（warning）⇒
 * ② 与 ③ 可区分；①（目标命中）**零**该诊断。
 *
 * ── （`@nudo:mock-module` 对同一模块重复声明）──────────────────────
 * 病灶：`packages/service/src/mock-module.ts` 的**叠加面**对同一 `d.source`
 * **逐条整块覆写**（后者胜出、无比较、无告警）⇒ 先声明者独有的导出名**静默
 * 消失** ⇒ 该导出名的调用点退化成 `unknown`（wrong-exact）。
 * 改后：重复声明 ⇒ 一条**点名两条来源**的 `nudo:mock-invalid`（warning）；
 * 导出表取**并集**（同名后者胜出）⇒ 先声明者的导出名**不再消失**。
 *
 * 断言非永真：改前 1062 的三种情况诊断集**全为空**；1063 的重复声明 `errors`
 * 为空、且先声明者的 `readFile` 从导出表里**消失**（只剩后声明者的名字）。
 */









// ── 夹具（三份只差「目标文本」/「有没有指令」）──────────────────────

/** ② 目标写错一个字母（源码里是 `JSON.parse(input)`）。 */
const REPLACE_MISS = `export function g(input) {
  // @nudo:replace JSON.parse(inpt) shape({ name: string() })
  const data = JSON.parse(input);
  return data;
}
`;

/** ① 目标写对（其余与 ② 逐字相同）。 */
const REPLACE_HIT = `export function g(input) {
  // @nudo:replace JSON.parse(input) shape({ name: string() })
  const data = JSON.parse(input);
  return data;
}
`;

/** ③ 根本没有 `@nudo:replace`（其余与 ② 逐字相同）。 */
const REPLACE_NONE = `export function g(input) {
  const data = JSON.parse(input);
  return data;
}
`;

/** 收集诊断（行内指令通道）。 */
function diagsOf(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  collectEvalReplacements(src, { diags });
  return diags;
}

/** 「@nudo:replace 目标未命中」这一类诊断（按码 + 文案筛）。 */
function replaceMissDiags(src: string): DirectiveDiag[] {
  return diagsOf(src).filter(
    (d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:replace"),
  );
}

{
  const REPLACE_MISS = 'export function g(input) {\n  // @nudo:replace JSON.parse(inpt) shape({ name: string() })\n  const data = JSON.parse(input);\n  return data;\n}\n';
  const REPLACE_HIT = 'export function g(input) {\n  // @nudo:replace JSON.parse(input) shape({ name: string() })\n  const data = JSON.parse(input);\n  return data;\n}\n';
  const REPLACE_NONE = 'export function g(input) {\n  const data = JSON.parse(input);\n  return data;\n}\n';
  const diagsOf = (src: string) => { const diags: DirectiveDiag[] = []; collectEvalReplacements(src, { diags }); return diags; };
  const replaceMissDiags = (src: string) => diagsOf(src).filter((d) => d.code === "nudo:directive-syntax" && d.message.includes("@nudo:replace"));
  it("写错目标点名诊断；写对零诊断且命中区间；无指令零诊断；门禁 warning", () => {
    const miss = replaceMissDiags(REPLACE_MISS);
    expect(miss).toHaveLength(1);
    expect(miss[0]!.message).toContain("JSON.parse(inpt)");
    expect(miss[0]!.message).toContain("no effect");
    expect(replaceMissDiags(REPLACE_HIT)).toEqual([]);
    const reps = collectEvalReplacements(REPLACE_HIT);
    expect(reps.targets).toHaveLength(1);
    expect(typeof reps.targets[0]!.stmtStart).toBe("number");
    expect(typeof reps.targets[0]!.stmtEnd).toBe("number");
    expect(replaceMissDiags(REPLACE_NONE)).toEqual([]);
    expect(diagsOf(REPLACE_NONE)).toEqual([]);
    const issues = directiveDiagIssues(diagsOf(REPLACE_MISS)).filter((i) => i.code === "nudo:directive-syntax");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.message).toContain("JSON.parse(inpt)");
  });
}

// ── 夹具 ───────────────────────────────────────────────────────────

let dir: string;

beforeEach(() => {
  dir = tmpProject("nudo-bug-1063-");
  writeTmpFile(dir, "mock-fs.js", `export const readFile = (p) => "mock1:" + p;\n`);
  writeTmpFile(dir, "mock-fs3.js", `export const writeFile = (p, d) => "w:" + p;\n`);
});

/** ② 同一模块声明两次（后者只导出 writeFile ⇒ readFile 会被前者顶掉）。 */
const DUP_SRC = `/// @nudo:mock-module "fs" from "./mock-fs.js"
/// @nudo:mock-module "fs" from "./mock-fs3.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

/** ① 单条声明（其余与 ② 逐字相同）。 */
const SINGLE_SRC = `/// @nudo:mock-module "fs" from "./mock-fs.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;

describe("@nudo:mock-module 对同一模块重复声明 ⇒ 显式诊断", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpProject("nudo-bug-1063-");
    writeTmpFile(dir, "mock-fs.js", 'export const readFile = (p) => "mock1:" + p;\n');
    writeTmpFile(dir, "mock-fs3.js", 'export const writeFile = (p, d) => "w:" + p;\n');
  });
  const DUP_SRC = '/// @nudo:mock-module "fs" from "./mock-fs.js"\n/// @nudo:mock-module "fs" from "./mock-fs3.js"\nimport { readFile } from "fs";\nexport function f() { return readFile("/x"); }\n';
  const SINGLE_SRC = '/// @nudo:mock-module "fs" from "./mock-fs.js"\nimport { readFile } from "fs";\nexport function f() { return readFile("/x"); }\n';
  it("重复点名两条来源且合并导出；单条零诊断；门禁 warning；局部形态并集", () => {
    const r = applyMockModuleDirectivesFromSource(DUP_SRC, {}, { fromFile: join(dir, "app.js") });
    const dups = r.errors.filter((e) => e.message.includes("Duplicate @nudo:mock-module"));
    expect(dups).toHaveLength(1);
    expect(dups[0]!.message).toContain("./mock-fs.js");
    expect(dups[0]!.message).toContain("./mock-fs3.js");
    expect(dups[0]!.message).toContain('"fs"');
    expect(dups[0]!.code).toBe("nudo:mock-invalid");
    const named = r.modules.fs!.named;
    expect(Object.keys(named).sort()).toEqual(["readFile", "writeFile"]);
    expect(formatAbs($call(named.readFile!, [$lit("/x")]))).toContain("mock1:/x");

    const single = applyMockModuleDirectivesFromSource(SINGLE_SRC, {}, { fromFile: join(dir, "app.js") });
    expect(single.errors).toEqual([]);
    expect(single.applied).toBe(true);

    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", DUP_SRC);
    const issues = collectCheckSupplementIssues(file, DUP_SRC).filter((i) => i.code === "nudo:mock-invalid");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.message).toContain("./mock-fs.js");
    expect(issues[0]!.message).toContain("./mock-fs3.js");

    const local = '/// @nudo:mock-module "fs" { readFile } from "./mock-fs.js"\n/// @nudo:mock-module "fs" { writeFile } from "./mock-fs3.js"\nimport { readFile } from "fs";\nexport function f() { return readFile("/x"); }\n';
    const lr = applyMockModuleDirectivesFromSource(local, {}, { fromFile: join(dir, "app.js") });
    expect(lr.errors.filter((e) => e.message.includes("Duplicate @nudo:mock-module"))).toHaveLength(1);
    expect(Object.keys(lr.modules.fs!.named).sort()).toEqual(["readFile", "writeFile"]);
  });
});
});

// ---------------------------------------------------------------------------
// dependency module's own @nudo:mock
// ---------------------------------------------------------------------------
describe("dependency module's own @nudo:mock", () => {
/**
 * 依赖模块自己的 `@nudo:mock` 完全不注入 ⇒ 同一个函数「作为目标」
 * 与「作为依赖」结论互斥。修复：abs-modules-graph 按声明函数作用域重求值
 * 依赖模块，只覆盖该函数导出（其它函数保留无 mock 基线）。
 */







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

{
  const FILES = {
    "dep.js": 'export function readFile(p) { return { path: p, size: 10 }; }\n',
    "p.js": 'import { readFile } from "./dep.js";\n/**\n * @nudo:mock readFile = (() => "mocked")\n */\nexport function useMock() { return readFile("x"); }\nexport function useReal() { return readFile("y"); }\n',
    "q.js": 'import { useMock, useReal } from "./p.js";\nexport function callMock() { return useMock(); }\nexport function callReal() { return useReal(); }\n',
  };
  it("只在声明函数生效；同函数作为依赖/目标一致", () => {
    withTmpProject("nudo-bug-180-", FILES, (dir) => {
      const qPath = join(dir, "q.js");
      const qSource = readFileSync(qPath, "utf-8");
      const graph = evalAbsModuleGraph(qSource, qPath);
      const run = runTranspiled(qSource, { mode: "analyze", modules: graph.modules });
      expect(litValue(callTranspiledExportFull(run, "callMock", []).result)).toEqual({ ok: true, value: "mocked" });
      const real = callTranspiledExportFull(run, "callReal", []).result;
      expect(real.shape.k).toBe("obj");
      expect(litValue(real).ok).toBe(false);

      const qGraph = evalAbsModuleGraph(qSource, qPath);
      const pExports = qGraph.modules["./p.js"]!;
      expect(litValue($call(pExports.named.useMock!, []))).toEqual({ ok: true, value: "mocked" });
      expect($call(pExports.named.useReal!, []).shape.k).toBe("obj");
    });
  });
}
});

// ---------------------------------------------------------------------------
// @nudo:replace 只认值位的表达式节点
// ---------------------------------------------------------------------------
describe("@nudo:replace 只认值位的表达式节点", () => {
/**
 * `@nudo:replace` 的目标文本命中**绑定位 / 对象属性键位**（非表达式位）
 * ⇒ 收集面算「命中」，转译面却只在**表达式发射入口**调用
 * `matchReplacement` ⇒ 指令**静默失效且零诊断**（引擎自己的「matched no
 * expression」告警被绕过）。
 *
 * 根因：`packages/service/src/eval-injection.ts` 的 `replaceCandidateRanges`
 * 遍历整棵子树，把任何归一化文本等于 target 的节点都收成候选——不区分节点
 * 所在的**槽位**（`VariableDeclarator.id` / `ObjectProperty.key` / 形参 /
 * 非计算成员名 都不是值位）。
 *
 * 修法：收集面加**值位 + 表达式节点**过滤（与转译面同口径）⇒ 非表达式位
 * 的命中不再算命中 ⇒ 落到「未命中」诊断（可见）。
 *
 * 断言非永真：改前 `DECL_ID` / `OBJ_KEY` 的指令诊断数为 **0**；改后各 1 条
 * `nudo:directive-syntax`，而表达式位对照组（`OBJ_VAL`）零诊断且替换生效。
 */





/** 目标 `x` 命中的是声明符的 **id**（绑定名） */
const DECL_ID = `// @nudo:replace x number()
const x = 5;
export function getDeclId() { return x; }
`;

/** 目标 `a` 命中的是对象属性的**键** */
const OBJ_KEY = `// @nudo:replace a number()
const o = { a: 1 };
export function getObjKey() { return o.a; }
`;

/** 对照组：目标 `1` 命中的是属性**值**（表达式位）⇒ 必须生效 */
const OBJ_VAL = `// @nudo:replace 1 number()
const o = { a: 1 };
export function getObjVal() { return o.a; }
`;

/** 对照组：目标全文没有 ⇒ 必须告警 */
const NO_MATCH = `// @nudo:replace zzz number()
const x = 5;
export function getNoMatch() { return x; }
`;

function directiveDiagsOf(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  collectEvalReplacements_____eval_injection_ts_1(src, { diags });
  return diags.filter((d) => d.code === "nudo:directive-syntax");
}

function signatureOf(src: string, name: string): string {
  const inject = resolveEvalInjection(src);
  const report = checkSource("/tmp/bug-184.js", src, undefined, {
    fromFile: "/tmp/bug-184.js",
    ...(inject ? { inject } : {}),
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  return sig!.display;
}

/** 未命中 ⇒ 收集面登记的是**无作用域**条目（无 stmtStart/stmtEnd） */
function registeredOffsets(src: string): Array<number | undefined> {
  return collectEvalReplacements_____eval_injection_ts_1(src).targets.map((t) => t.stmtStart);
}

{
  const DECL_ID = '// @nudo:replace x number()\nconst x = 5;\nexport function getDeclId() { return x; }\n';
  const OBJ_KEY = '// @nudo:replace a number()\nconst o = { a: 1 };\nexport function getObjKey() { return o.a; }\n';
  const OBJ_VAL = '// @nudo:replace 1 number()\nconst o = { a: 1 };\nexport function getObjVal() { return o.a; }\n';
  const NO_MATCH = '// @nudo:replace zzz number()\nconst x = 5;\nexport function getNoMatch() { return x; }\n';
  const directiveDiagsOf = (src: string) => { const diags: DirectiveDiag[] = []; collectEvalReplacements_____eval_injection_ts_1(src, { diags }); return diags.filter((d) => d.code === "nudo:directive-syntax"); };
  const signatureOf = (src: string, name: string): string => {
    const inject = resolveEvalInjection(src);
    const report = checkSource("/tmp/bug-184.js", src, undefined, { fromFile: "/tmp/bug-184.js", ...(inject ? { inject } : {}) });
    const sig = report.signatures.find((s) => s.name === name);
    expect(sig, name).toBeDefined();
    return sig!.display;
  };
  const registeredOffsets = (src: string) => collectEvalReplacements_____eval_injection_ts_1(src).targets.map((t) => t.stmtStart);
  it("绑定位/对象键位不算命中且诊断；属性值命中生效；未命中告警", () => {
    expect(registeredOffsets(DECL_ID)).toEqual([undefined]);
    const declDiags = directiveDiagsOf(DECL_ID);
    expect(declDiags).toHaveLength(1);
    expect(declDiags[0]!.message).toContain('@nudo:replace target "x"');
    expect(declDiags[0]!.message).toContain("matched no expression");
    expect(signatureOf(DECL_ID, "getDeclId")).toBe("5");

    expect(registeredOffsets(OBJ_KEY)).toEqual([undefined]);
    const keyDiags = directiveDiagsOf(OBJ_KEY);
    expect(keyDiags).toHaveLength(1);
    expect(keyDiags[0]!.message).toContain('@nudo:replace target "a"');

    expect(typeof registeredOffsets(OBJ_VAL)[0]).toBe("number");
    expect(directiveDiagsOf(OBJ_VAL)).toEqual([]);
    expect(signatureOf(OBJ_VAL, "getObjVal")).toBe("number");

    const noMatch = directiveDiagsOf(NO_MATCH);
    expect(noMatch).toHaveLength(1);
    expect(noMatch[0]!.message).toContain('@nudo:replace target "zzz"');
  });
}
});

// ---------------------------------------------------------------------------
// @nudo:skip 按「同名取词法最浅」绑定
// ---------------------------------------------------------------------------
describe("@nudo:skip 按「同名取词法最浅」绑定", () => {
/**
 * `@nudo:skip` 的**作用域绑定**按**函数名**做键 ⇒
 * ① 内层**同名**函数的 skip **顶掉**外层的声明（偷取）；
 * ② 外层**没有** skip 时内层的 skip **越界**作用到导出函数上（body 不再
 * 评估 ⇒ 导出签名的 **throws 标注被抹掉**）。
 *
 * 根因：`packages/parser/src/directives/fn-directives.ts` 的 `collectFnDirectives`
 * 只推 `{ node, name, directives }`——**把 core scope 自带的 `depth` 丢掉了**
 * ⇒ 消费面 `packages/service/src/skip-directives.ts` 的 `collectSkipReturns`
 * 只能 `Map.set(fn.name, …)` ⇒ 文档序后写者（内层）胜。
 *
 * 修法：depth 一路带下来 + 消费面「同名取**词法最浅**」（与 core
 * `findFnDirectiveScope` 同口径，`docs/design/directive-scope.md` 的
 * 「AST 最近 Function」）。
 *
 * 断言非永真：改前 C 组签名 `string`（外层声明的是 `number()`）、E 组
 * `string`（比 F 组少了 `throws TypeError`）；改后 C = D、E = F 逐字相同。
 */






/** 夹具：外层 skip? + 内层函数名 + 内层 skip?（严格单变量对照） */
const fixture = (outerSkip: boolean, innerName: string, innerSkip: boolean): string =>
  [
    ...(outerSkip ? ["/** @nudo:skip => number() */"] : []),
    "export function f(x) {",
    ...(innerSkip ? [`  /** @nudo:skip => string() */`] : []),
    `  function ${innerName}() { return "s"; }`,
    `  return ${innerName}() + x;`,
    "}",
    "",
  ].join("\n");

/** C：外层 number + 内层**同名** string（缺陷组） */
const C = fixture(true, "f", true);
/** D：外层 number + 内层**改名** string（对照组） */
const D = fixture(true, "g", true);
/** E：外层无 skip + 内层**同名** string（越界组） */
const E = fixture(false, "f", true);
/** F：外层无 skip + 内层无 skip（对照组） */
const F = fixture(false, "f", false);

function signatureOf(src: string, name: string): NudoSig {
  const report = checkSource("/tmp/bug-283.js", src, undefined, {
    fromFile: "/tmp/bug-283.js",
    skips: collectSkipReturns(src),
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  return sig!;
}


  it("同名取最浅；E 不越界；pure 同裁决", () => {
    expect(collectSkipReturns(C).get("f")).toBeDefined();
    expect(signatureOf(C, "f").display).toBe("number");
    expect(signatureOf(C, "f").display).toBe(signatureOf(D, "f").display);
    expect(collectSkipReturns(E).has("f")).toBe(false);
    expect(collectSkipReturns(F).has("f")).toBe(false);
    expect(signatureOf(E, "f").display).toBe(signatureOf(F, "f").display);
    expect(signatureOf(E, "f").throws).toBe(signatureOf(F, "f").throws);
    expect(signatureOf(E, "f").throws).toContain("TypeError");
    expect(signatureOf(D, "f").display).toBe("number");
    expect(pureFnNamesOfAst(parse("export function f(x) {\n  /** @nudo:pure */\n  function f() { return 1; }\n  return f() + x;\n}\n"))).toEqual([]);
    expect(pureFnNamesOfAst(parse("export function f(x) {\n  /** @nudo:pure */\n  function g() { return 1; }\n  return g() + x;\n}\n"))).toEqual(["g"]);
    expect(pureFnNamesOfAst(parse("/** @nudo:pure */\nexport function f() { return 1; }\n"))).toEqual(["f"]);
    expect(extractDirectivesQuiet(parse(C)).map((fn) => [fn.name, fn.depth])).toEqual([["f", 0], ["f", 1]]);
  });

});

// ---------------------------------------------------------------------------
// 指令收集覆盖面
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 同名 @nudo:mock 按函数作用域各生效
// ---------------------------------------------------------------------------
describe("同名 @nudo:mock 按函数作用域各生效", () => {
/**
 * 两个函数声明**同名** `@nudo:mock`：后者全文件胜出，
 * 先声明的函数被改写成**错误的类型**（并进入发布的 d.ts）。
 *
 * 修法（族 14 · 分片 I）：
 * - mock 种子表按**函数作用域**组织（`mock-abs.ts` 的 `scoped` + 覆盖表）
 * - 按**被求值的函数**取作用域覆盖（core `generalize.ts` 的按函数求值边界）
 *
 * 负控制（/ 口径修正）：未冲突的 mock **只在其声明函数内**
 * 生效，不再文件级可见——函数级指令不得泄漏到同文件其它函数。
 */






/** 两个函数各自声明同名 mock（先声明的在前） */
const TWO_MOCKS = `/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() {
  return getPort();
}

/**
 * @nudo:mock getPort = stub().returns("closed")
 */
export function readB() {
  return getPort();
}
`;

/** 声明顺序互换（胜出者不应随源序漂移） */
const TWO_MOCKS_REVERSED = `/**
 * @nudo:mock getPort = stub().returns("closed")
 */
export function readB() {
  return getPort();
}

/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() {
  return getPort();
}
`;

/** 负控制：只有一个 mock 名（无冲突）⇒ 只在声明函数内可见 */
const ONE_MOCK = `/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() {
  return getPort();
}

export function readB() {
  return getPort();
}
`;

function seedsOf(source: string, fromFile: string) {
  return mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile });
}

/** check 签名面（与 `nudo check` 同一管线：core checkSource + service 种子） */
function sigValue(source: string, fromFile: string, name: string): unknown {
  const seeds = seedsOf(source, fromFile);
  const mocks = mockSeedsToAbsMocks(seeds);
  const report = checkSource(fromFile, source, undefined, {
    inject: { mocks },
    fromFile,
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  const lit = litValue(sig!.abs);
  return lit.ok ? lit.value : sig!.display;
}

{
  const TWO_MOCKS = `/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() {
  return getPort();
}

/**
 * @nudo:mock getPort = stub().returns("closed")
 */
export function readB() {
  return getPort();
}
`;
  const TWO_MOCKS_REVERSED = `/**
 * @nudo:mock getPort = stub().returns("closed")
 */
export function readB() {
  return getPort();
}

/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() {
  return getPort();
}
`;
  const ONE_MOCK = `/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() {
  return getPort();
}

export function readB() {
  return getPort();
}
`;
  const seedsOf = (source: string, fromFile: string) => mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile });
  const sigValue = (source: string, fromFile: string, name: string): unknown => {
    const seeds = seedsOf(source, fromFile);
    const report = checkSource(fromFile, source, undefined, { inject: { mocks: mockSeedsToAbsMocks(seeds) }, fromFile });
    const sig = report.signatures.find((s) => s.name === name);
    expect(sig, name).toBeDefined();
    const lit = litValue(sig!.abs);
    return lit.ok ? lit.value : sig!.display;
  };
  it("各函数取各自 mock（顺序无关）；单 mock 不泄漏；产物面同值", async () => {
    expect(sigValue(TWO_MOCKS, "/tmp/b455-a.js", "readA")).toBe(8080);
    expect(sigValue(TWO_MOCKS, "/tmp/b455-b.js", "readB")).toBe("closed");
    expect(sigValue(TWO_MOCKS_REVERSED, "/tmp/b455-c.js", "readA")).toBe(8080);
    expect(sigValue(TWO_MOCKS_REVERSED, "/tmp/b455-d.js", "readB")).toBe("closed");
    const seeds = seedsOf(TWO_MOCKS, "/tmp/b455-e.js");
    expect(seeds.scoped?.map((s) => s.scope)).toEqual(["readA", "readB"]);
    const mocks = mockSeedsToAbsMocks(seeds);
    const overrides = mockScopeOverridesOf(mocks);
    expect(overrides && Object.keys(overrides).sort()).toEqual(["readA", "readB"]);
    const a = mockScopeSelected(mocks, "readA");
    const b = mockScopeSelected(mocks, "readB");
    expect(a.getPort).not.toBe(b.getPort);
    expect(a.getPort).not.toBe(mocks.getPort);

    expect(sigValue(ONE_MOCK, "/tmp/b455-f.js", "readA")).toBe(8080);
    expect(sigValue(ONE_MOCK, "/tmp/b455-g.js", "readB")).toBe("never throws ReferenceError");
    expect(mockScopeOverridesOf(mockSeedsToAbsMocks(seedsOf(ONE_MOCK, "/tmp/b455-h.js")))).toBeUndefined();

    const res = await analyzeFileAsync("/tmp/b455-product.js", TWO_MOCKS);
    const valueOf = (name: string): unknown => {
      const fn = res.functions.find((f) => f.name === name);
      expect(fn, name).toBeDefined();
      const lit = litValue(fn!.combinedAbs!);
      return lit.ok ? lit.value : undefined;
    };
    expect(valueOf("readA")).toBe(8080);
    expect(valueOf("readB")).toBe("closed");
  });
}

// / 旧负控断言「未冲突的 mock 文件级可见」正是那两条 bug
// 的假绿根因（同文件其它函数被 mock 掩盖真实 ReferenceError）。按
// `docs/design/directive-scope.md`，`@nudo:mock` 是**函数级**指令 ⇒ 只在
// 声明它的函数体内生效。

});

// ---------------------------------------------------------------------------
// mode=directives 的指令名单要全（assume/invariant/throws/budget）
// ---------------------------------------------------------------------------
describe("mode=directives 的指令名单要全（assume/invariant/throws/budget）", () => {
/**
 * 回归钉：只含 @nudo:assume / @nudo:invariant / @nudo:throws /
 * @nudo:budget 的文件，在 analysis.mode=directives 下必须**纳入分析面**。
 *
 * 改前：hasNudoDirectives 的名单漏掉这四个指令名 → 文件被判定为
 * 「非 nudo 文件」→ LSP 静默跳过（整份文件零诊断，假绿）。
 *
 * 负控制：无指令文件 / 指令只出现在字符串字面量里 → 仍不纳入；
 * 已在名单里的指令名不得被本次改动弄丢。
 */







const directivesCfg = analysisConfig({ analysis: { mode: "directives" } });

/** 本次补齐的四个指令名（改前缺席）。 */
const MISSING = ["assume", "invariant", "throws", "budget"] as const;
/** 改前已在名单里的指令名（负控制：不得回退）。 */
const PRESENT = [
  "case", "mock", "pure", "skip", "sample", "contract", "import",
  "env", "mock-module", "as", "replace",
] as const;

function sourceWith(name: string): string {
  return `/**\n * @nudo:${name} x\n */\nexport function f(x) {\n  return x;\n}\n`;
}

function tmpDirProject(): string {
  return makeTmpProject("nudo-scope-458-", {
    "package.json": JSON.stringify({ name: "fx", nudo: { analysis: { mode: "directives" } } }),
  });
}

{
  const directivesCfg = analysisConfig({ analysis: { mode: "directives" } });
  const MISSING = ["assume", "invariant", "throws", "budget"] as const;
  const PRESENT = ["case", "mock", "pure", "skip", "sample", "contract", "import", "env", "mock-module", "as", "replace"] as const;
  const sourceWith = (name: string) => `/**
 * @nudo:${name} x
 */
export function f(x) {
  return x;
}
`;
  const tmpDirProject = () => makeTmpProject("nudo-scope-458-", { "package.json": JSON.stringify({ name: "fx", nudo: { analysis: { mode: "directives" } } }) });
  it("新四指令识别并纳入；既有指令不回退；无指令/字符串假命中仍排除", () => {
    for (const name of MISSING) expect(hasNudoDirectives(sourceWith(name)), name).toBe(true);
    const dir = tmpDirProject();
    for (const name of MISSING) {
      expect(shouldAnalyzeFile(join(dir, "a.js"), sourceWith(name), directivesCfg), name).toBe(true);
    }
    for (const name of PRESENT) {
      expect(hasNudoDirectives(sourceWith(name)), name).toBe(true);
      expect(shouldAnalyzeFile(join(dir, "b.js"), sourceWith(name), directivesCfg), name).toBe(true);
    }
    for (const src of ["export function f() { return 1; }\n", 'const s = "@nudo:assume x";\n', "const t = `@nudo:throws`;\n"]) {
      expect(shouldAnalyzeFile(join(dir, "c.js"), src, directivesCfg), src).toBe(false);
    }
    expect(shouldAnalyzeFile(join(dir, "d.js"), "/// @nudo:env node\nexport function f() { return 1; }\n", directivesCfg)).toBe(true);
  });
}
});

// ---------------------------------------------------------------------------
// nudo:mock-invalid severity
// ---------------------------------------------------------------------------
describe("nudo:mock-invalid severity", () => {
/**
 * nudo:mock-invalid 的严重度。
 *
 * 文档口径（packages/website/docs/reference/diagnostics.md#nudo-mock-invalid、
 * packages/website/docs/guides/check.md「nudo:mock-invalid | engine | warning」）
 * 是 **warning**：@nudo:mock 表达式解析失败 ⇒ 指令被忽略，mock 不生效。
 *
 * 修复前：service 面的 mock 种子通道（mockDirectivesToAbsSeeds 的 fromErrors）
 * 把它报成 error，而同一文件里的静态校验通道（validateMockDirectives）报
 * warning——同一 code 两条通道两种严重度，且与文档相反。
 *
 * 本测试锁住：
 * ① mock 表达式解析失败 = warning（不再让 CI 门禁由红转绿地误报）
 * ② 两条 mock-invalid 通道严重度一致
 * ③ mock **文件**缺失/加载失败仍是 error（不引入假绿）
 */



const MOCK_EXPR = `// @nudo:mock fs = foo(1)
export function useFs() { return 1; }
`;

const MOCK_MISSING_FILE = `// @nudo:mock fs from "./definitely-missing-mock-file.js"
export function useFs() { return 1; }
`;


  it("表达式解析失败 = warning（两通道一致）；缺 mock 文件仍是 error", () => {
    const MOCK_EXPR = '// @nudo:mock fs = foo(1)\nexport function useFs() { return 1; }\n';
    const MOCK_MISSING_FILE = '// @nudo:mock fs from "./definitely-missing-mock-file.js"\nexport function useFs() { return 1; }\n';
    const r = analyzeFile("/t/b460/mock-expr.js", MOCK_EXPR);
    const diags = r.diagnostics.filter((d) => d.code === "nudo:mock-invalid");
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) expect(d.severity).toBe("warning");
    expect([...new Set(r.diagnostics.filter((d) => d.code === "nudo:mock-invalid").map((d) => d.severity))]).toEqual(["warning"]);
    const missing = analyzeFile("/t/b460/mock-missing.js", MOCK_MISSING_FILE);
    const errs = missing.diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((d) => d.code === "nudo:module-missing")).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// 内联 mock 的可构造性 facet
// ---------------------------------------------------------------------------
describe("内联 mock 的可构造性 facet", () => {
/**
 * **内联** `@nudo:mock` 丢掉「可构造性」facet ⇒ `new <mock>` 不再定抛
 * ⇒ try/catch 走错分支（原生 "caught"，引擎 "mocked"）+ 门禁假绿。
 * `from` 形态（mock 文件导出箭头）一直是对的 ⇒ 两条路径的 facet 供给不对称。
 *
 * 修法（族 14 · 分片 I）：内联 mock 按载荷形态补 `ctor` facet
 * （箭头/方法/generator/async function ⇒ 不可构造；function/class 表达式 ⇒ 可构造）。
 */








/** 内联箭头 mock：原生 `new` 定抛 TypeError ⇒ catch 分支 */
const INLINE_ARROW = `/**
 * @nudo:mock Greeter = () => ({ msg: "mocked" })
 */
export function greet() {
  try { return new Greeter().msg; } catch { return "caught"; }
}
`;

/** 内联 function 表达式 mock：原生可构造 ⇒ 不走 catch 分支 */
const INLINE_FN_EXPR = `/**
 * @nudo:mock Greeter = function () { this.msg = "mocked"; }
 */
export function greet() {
  try { return new Greeter().msg; } catch { return "caught"; }
}
`;

/** 负控制：同一段代码不加 mock（本地 const 箭头） */
const LOCAL_ARROW = `const Greeter = () => ({ msg: "mocked" });

export function greet() {
  try { return new Greeter().msg; } catch { return "caught"; }
}
`;

function seedsOf(source: string, fromFile: string) {
  return mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile });
}

function sigValue(source: string, fromFile: string, name: string): unknown {
  const mocks = mockSeedsToAbsMocks(seedsOf(source, fromFile));
  const report = checkSource(fromFile, source, undefined, {
    inject: { mocks },
    fromFile,
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  const lit = litValue(sig!.abs);
  return lit.ok ? lit.value : sig!.display;
}

{
  const INLINE_ARROW = '/**\n * @nudo:mock Greeter = () => ({ msg: "mocked" })\n */\nexport function greet() {\n  try { return new Greeter().msg; } catch { return "caught"; }\n}\n';
  const INLINE_FN_EXPR = '/**\n * @nudo:mock Greeter = function () { this.msg = "mocked"; }\n */\nexport function greet() {\n  try { return new Greeter().msg; } catch { return "caught"; }\n}\n';
  const LOCAL_ARROW = 'const Greeter = () => ({ msg: "mocked" });\n\nexport function greet() {\n  try { return new Greeter().msg; } catch { return "caught"; }\n}\n';
  const seedsOf = (source: string, fromFile: string) => mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile });
  const sigValue = (source: string, fromFile: string, name: string): unknown => {
    const mocks = mockSeedsToAbsMocks(seedsOf(source, fromFile));
    const report = checkSource(fromFile, source, undefined, { inject: { mocks }, fromFile });
    const sig = report.signatures.find((s) => s.name === name);
    expect(sig, name).toBeDefined();
    const lit = litValue(sig!.abs);
    return lit.ok ? lit.value : sig!.display;
  };
  it("箭头不可构造；function 表达式可构造；from/本地箭头仍是 caught", () => {
    expect(sigValue(INLINE_ARROW, "/tmp/b482-a.js", "greet")).toBe("caught");
    expect(seedsOf(INLINE_ARROW, "/tmp/b482-b.js").seedFns.Greeter?.ctor).toBe(false);
    expect(seedsOf(INLINE_FN_EXPR, "/tmp/b482-c.js").seedFns.Greeter?.ctor).toBe(true);
    expect(sigValue(INLINE_FN_EXPR, "/tmp/b482-d.js", "greet")).not.toBe("caught");
    expect(sigValue(LOCAL_ARROW, "/tmp/b482-e.js", "greet")).toBe("caught");

    const dir = makeTmpProject("nudo-b482-", { "mocks/greeter.js": 'export const Greeter = () => ({ msg: "mocked" });\n', "app.js": '/**\n * @nudo:mock Greeter from "./mocks/greeter.js"\n */\nexport function greet() {\n  try { return new Greeter().msg; } catch { return "caught"; }\n}\n' });
    const entry = join(dir, "app.js");
    const source = readFileSync(entry, "utf-8");
    const mocks = mockSeedsToAbsMocks(mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile: entry }));
    const report = checkSource(entry, source, undefined, { inject: { mocks }, fromFile: entry });
    const sig = report.signatures.find((s) => s.name === "greet");
    const lit = litValue(sig!.abs);
    expect(lit.ok ? lit.value : sig!.display).toBe("caught");
  });
}

});

// ---------------------------------------------------------------------------
// rejects 形态建模成 reject 的 promise（不是 never）
// ---------------------------------------------------------------------------
describe("rejects 形态建模成 reject 的 promise（不是 never）", () => {
/**
 * `@nudo:mock` 的 **`rejects`** 形态被建模成「返回 never」
 * ⇒ 返回契约**空洞成立**（`never ⊑ string()` ⇒ 假绿，零诊断）
 * + 签名/dts 写出 `never`（错误类型声明）。
 *
 * 修法（族 14 · 分片 I）：`rejects` 建模成「必定 reject 的 promise」
 * （与 `resolves` 分支同形：eff/promise），内层 never = 永不 fulfill。
 */









/** rejects 形态（返回必定 reject 的 promise） */
const REJECTS = `/**
 * @nudo:mock fetch = stub().rejects(new Error("x"))
 */
export function f() {
  return fetch("/x");
}
`;

/** 负控制：resolves 形态（同一契约下本就该 unproven） */
const RESOLVES = `/**
 * @nudo:mock fetch = stub().resolves(42)
 */
export function f() {
  return fetch("/x");
}
`;

/** 负控制：普通 returns 形态（同步返回值，不受本条影响） */
const RETURNS = `/**
 * @nudo:mock fetch = stub().returns(42)
 */
export function f() {
  return fetch("/x");
}
`;

function check(file: string, source: string, entry: string) {
  const mocks = mockSeedsToAbsMocks(
    mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile: entry }),
  );
  return checkSource(entry, source, undefined, {
    inject: { mocks },
    fromFile: entry,
    loadModule: defaultLoadModule,
  });
}

{
  const REJECTS = '/**\n * @nudo:mock fetch = stub().rejects(new Error("x"))\n */\nexport function f() {\n  return fetch("/x");\n}\n';
  const RESOLVES = '/**\n * @nudo:mock fetch = stub().resolves(42)\n */\nexport function f() {\n  return fetch("/x");\n}\n';
  const RETURNS = '/**\n * @nudo:mock fetch = stub().returns(42)\n */\nexport function f() {\n  return fetch("/x");\n}\n';
  const check = (file: string, source: string, entry: string) => {
    const mocks = mockSeedsToAbsMocks(mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile: entry }));
    return checkSource(entry, source, undefined, { inject: { mocks }, fromFile: entry, loadModule: defaultLoadModule });
  };
  it("rejects 是 promise 面不是 never；string() 契约报 unproven；resolves/returns 不变", () => {
    const rejects = check("/tmp/b488-a.js", REJECTS, "/tmp/b488-a.js");
    const rejectsSig = rejects.signatures.find((s) => s.name === "f")!;
    expect(rejectsSig.abs.shape.k).toBe("eff");
    expect((rejectsSig.abs.shape as { eff?: string }).eff).toBe("promise");
    expect(formatShape(rejectsSig.abs)).not.toBe("never");

    const dir = makeTmpProject("nudo-b488-", { "a.js": REJECTS, "a.nudo.js": 'import { fn, string } from "@nudojs/core";\nexport const f = fn({}, string());\n' });
    const entry = join(dir, "a.js");
    const source = readFileSync(entry, "utf-8");
    expect(check(entry, source, entry).issues.filter((i) => i.code === "nudo:unproven-return").length).toBeGreaterThanOrEqual(1);

    const resolves = check("/tmp/b488-b.js", RESOLVES, "/tmp/b488-b.js");
    const resolvesSig = resolves.signatures.find((s) => s.name === "f")!;
    expect(resolvesSig.abs.shape.k).toBe("eff");
    expect(formatShape(resolvesSig.abs)).toContain("42");
    const returns = check("/tmp/b488-c.js", RETURNS, "/tmp/b488-c.js");
    const returnsSig = returns.signatures.find((s) => s.name === "f")!;
    expect(returnsSig.abs.shape.k).toBe("prim");
    expect(formatShape(returnsSig.abs)).toContain("42");

    const dir2 = makeTmpProject("nudo-b488b-", { "b.js": RESOLVES, "b.nudo.js": 'import { fn, string } from "@nudojs/core";\nexport const f = fn({}, string());\n' });
    const entry2 = join(dir2, "b.js");
    const source2 = readFileSync(entry2, "utf-8");
    expect(check(entry2, source2, entry2).issues.filter((i) => i.code === "nudo:unproven-return").length).toBeGreaterThanOrEqual(1);
  });
}

});
