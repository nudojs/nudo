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
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

describe("（service 侧）—— 宿主内建名的 mock 不再被 env 跳过表吞掉", () => {
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
  it("宿主内建 mock 生效；产品面同值；负控制普通名/优先级/跳过表/无 mock", async () => {
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
  });

  it("第二合并点：collectAbsBindingsFromGraph 也尊重宿主内建 mock", () => {
    const src = '/**\n * @nudo:mock Number = stub().returns(42)\n */\nexport function run() {\n  return Number("7");\n}\nconst x = Number("7");\n';
    const file = "/tmp/b274-bind.js";
    const binds = collectAbsBindingsFromGraph(src, file, { seedVars: mocksOf(src, file) as never });
    expect(litValue(binds.get("x")!)).toEqual({ ok: true, value: 42 });
  });
});;

describe("（service 侧）负控制 —— 既有语义逐字不变", () => {
  it("普通名 mock 仍生效（改前就生效，不得回退）", () => {
    const got = callValue(MOCK_PLAIN, "/tmp/bug274-service-plain.js");
    expect(got.value).toBe("MOCKED");
  });

  it("mock 覆盖 env 的优先级不变（同名时 mock 赢）", () => {
    const got = callValue(MOCK_OVER_ENV, "/tmp/bug274-service-priority.js", {
      envNames: ["node"],
    });
    // env（node）里也有 `process`；mock 赢 ⇒ "MOCKED"（env 的 object 不可调用）
    expect(got.value).toBe("MOCKED");
  });

  it("env 全局仍受跳过表约束（env 的 Math 不遮蔽宿主 Math）", () => {
    const got = callValue(NO_MOCK, "/tmp/bug274-service-envskip.js", { envNames: ["node"] });
    expect(got.value).toBe(7);
  });

  it("没有 mock 时宿主应答不变", () => {
    const got = callValue(NO_MOCK, "/tmp/bug274-service-nomock.js");
    expect(got.value).toBe(7);
  });
});

describe("（service 侧）第二合并点 —— 模块图绑定面也分表传", () => {
  it("collectAbsBindingsFromGraph：宿主内建名的 mock 生效（顶层 const 求值面）", () => {
    const src = `/**
 * @nudo:mock Number = stub().returns(42)
 */
export function run() {
  return Number("7");
}
const x = Number("7");
`;
    const file = "/tmp/bug274-service-bindings.js";
    const mocks = mocksOf(src, file);
    const binds = collectAbsBindingsFromGraph(src, file, { seedVars: mocks as never });
    expect(binds.has("x")).toBe(true);
    const lit = litValue(binds.get("x")!);
    expect(lit.ok).toBe(true);
    // 宿主应答 = 7；mock 生效 ⇒ 42
    expect(lit.ok ? lit.value : undefined).toBe(42);
  });
});
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

describe("mock-module 点名缺失（fail-closed，不静默回落原模块）", () => {
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
});;
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

describe("@nudo:replace 命中的子表达式仍求值", () => {
  it("被替换调用的 throws 域保留（L2 门禁不再假绿）", () => {
    const withDirective = `export function f(input) {
  // @nudo:replace JSON.parse(input) number()
  const v = JSON.parse(input);
  return v;
}
`;
    const control = `export function f(input) {
  const v = JSON.parse(input);
  return v;
}
`;
    // 修复前：带指令 → 0（假绿，JSON.parse 的 TypeError 被吞）
    expect(l2Count(check(withDirective), "f")).toBe(1);
    // 对照：JSON.parse 本来就会抛 → 门禁红
    expect(l2Count(check(control), "f")).toBe(1);
    // 类型覆盖仍在（结果类型 = 断言类型）
    expect(sigOf(check(withDirective), "f")).toContain("number");
  });

  it("被替换调用的副作用保留（求值发生，结果取注入值）", () => {
    const withDirective = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
/** @nudo:case "c" () */
export function f() {
  // @nudo:replace bump() number()
  const x = bump();
  return counter;
}
`;
    const control = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
/** @nudo:case "c" () */
export function f() {
  const x = bump();
  return counter;
}
`;
    // 修复前：bump() 整段被替换 → 从不调用 → counter 停在 0
    expect(witness(withDirective)).toBe("1");
    expect(witness(control)).toBe("1");
  });

  it("负控制：未被标注的相邻子表达式照常求值", () => {
    const src = `/**
 * @nudo:case "c" (5, 10)
 */
export function f(a, b) {
  // @nudo:replace a lit(100)
  const x = a + b;
  return x;
}
`;
    // 只有 a 被替换（→ 100），b 照常求值（→ 10）
    expect(witness(src)).toBe("110");
  });
});

describe("@nudo:as / @nudo:replace 的作用范围按 AST 节点身份", () => {
  it("@nudo:as 挂在 if 上不泄漏进块内的 return", () => {
    const withDirective = `export function f(cond) {
  // @nudo:as number()
  if (cond) {
    const x = "str";
    return x;
  }
  return 0;
}
`;
    const control = `export function f(cond) {
  if (cond) {
    const x = "str";
    return x;
  }
  return 0;
}
`;
    // 修复前：块内的 return x 被替换 → 签名 number
    expect(sigOf(check(withDirective), "f")).toBe(sigOf(check(control), "f"));
    expect(sigOf(check(withDirective), "f")).toContain('"str"');
  });

  it("@nudo:replace 不泄漏进嵌套函数体", () => {
    const withDirective = `export function f(x) {
  // @nudo:replace x number()
  const g = function () {
    return x;
  };
  return g();
}
`;
    const control = `export function f(x) {
  const g = function () {
    return x;
  };
  return g();
}
`;
    // 修复前：嵌套函数体内的 return x 被替换 → 签名 number
    expect(sigOf(check(withDirective), "f")).toBe(sigOf(check(control), "f"));
  });

  it("@nudo:replace 只作用于被标注的那条语句（同行下一条不受影响）", () => {
    const withDirective = `export function f(a) {
  // @nudo:replace a number()
  const x = a; const y = a;
  return [x, y];
}
`;
    const control = `export function f(a) {
  const x = a; const y = a;
  return [x, y];
}
`;
    const sig = sigOf(check(withDirective), "f");
    // 修复前：[number, number]（两条语句都被改）
    expect(sig).toContain("[number, any]");
    expect(sig).not.toContain("[number, number]");
  });

  it("负控制：指令仍作用于它标注的那条语句", () => {
    const src = `/**
 * @nudo:case "c" (5, 10)
 */
export function f(a, b) {
  // @nudo:replace a lit(100)
  const x = a + b;
  return x;
}
`;
    expect(witness(src)).toBe("110");
  });

  it("负控制：@nudo:as 仍覆盖紧随语句的 init", () => {
    const src = `/**
 * @nudo:case "c" ()
 */
export function f() {
  // @nudo:as string()
  const a = 1;
  return a;
}
`;
    expect(witness(src)).toBe("string");
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




describe("skipped 导出不得从产物里消失", () => {
  it("skip 且未声明返回 ⇒ 仍然声明成 unknown（与 check 同源、TS 投影面归一）", () => {
    const dts = generateDts(
      analyzeFile___nudojs_service(
        "/test/bug079.js",
        `/**\n * @nudo:skip\n */\nexport function boom(a) {\n  return a;\n}\n`,
      ),
    );
    expect(dts).toContain("export declare function boom(...args: unknown[]): unknown;");
  });

  it("对照组：未 skip 的普通函数仍然走推断面（不受本修法影响）", () => {
    const dts = generateDts(
      analyzeFile___nudojs_service("/test/bug079b.js", `export function plain(a) {\n  return a + 1;\n}\nplain(1);\n`),
    );
    expect(dts).toMatch(/export declare function plain\(/);
    expect(dts).not.toContain("export declare function plain(...args: unknown[]): unknown;");
  });
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

describe("孤儿行内指令的诊断不被同文件其它指令抑制", () => {
  it("只有孤儿指令 ⇒ 有一条「无处可施」诊断（既有口径）", () => {
    expect(orphanDiags(ORPHAN_ONLY)).toHaveLength(1);
  });

  it("孤儿 + 一条生效的 @nudo:as ⇒ 孤儿诊断**仍然在场**（改前被抑制为 0）", () => {
    expect(orphanDiags(ORPHAN_PLUS_WORKING)).toHaveLength(1);
    // 同一条诊断的文案保持不变（既有消费面按文案筛）
    expect(orphanDiags(ORPHAN_PLUS_WORKING)[0]!.message).toBe(
      "inline directive (@nudo:as / @nudo:replace) is not attached to a statement — it has no effect",
    );
  });

  it("生效的那条 @nudo:as 照旧进入收集表（抑制解除没有副作用）", () => {
    expect(collectEvalReplacements_____eval_injection_ts(ORPHAN_PLUS_WORKING).asTargets).toHaveLength(1);
  });

  it("两处孤儿各报一条（改前合并成一条）", () => {
    expect(orphanDiags(TWO_ORPHANS)).toHaveLength(2);
  });
});
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

describe("@nudo:replace 目标文本在源码里不存在 ⇒ 显式诊断", () => {
  it("② 目标写错 ⇒ 有一条点名目标文本的诊断", () => {
    const diags = replaceMissDiags(REPLACE_MISS);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    // 诊断必须**点名目标文本** ⇒ 用户能看出是哪个字写错了
    expect(diags[0]!.message).toContain("JSON.parse(inpt)");
    expect(diags[0]!.message).toContain("no effect");
  });

  it("① 目标写对 ⇒ 零该诊断（且指令确实命中了节点）", () => {
    expect(replaceMissDiags(REPLACE_HIT)).toEqual([]);
    const reps = collectEvalReplacements(REPLACE_HIT);
    expect(reps.targets).toHaveLength(1);
    // 命中 ⇒ 登记了**节点身份**（字符区间）；未命中才会缺这两个字段
    expect(typeof reps.targets[0]!.stmtStart).toBe("number");
    expect(typeof reps.targets[0]!.stmtEnd).toBe("number");
  });

  it("③ 根本没有该指令 ⇒ 零该诊断（不许误报）", () => {
    expect(replaceMissDiags(REPLACE_NONE)).toEqual([]);
    expect(diagsOf(REPLACE_NONE)).toEqual([]);
  });

  it("② 与 ③ 可区分（改前两者的诊断集逐字相同）", () => {
    const miss = replaceMissDiags(REPLACE_MISS);
    const none = replaceMissDiags(REPLACE_NONE);
    expect(miss.length).toBeGreaterThan(none.length);
    expect(none).toHaveLength(0);
  });

  it("门禁面可见：warning 级（不挡 exit），且文案点名目标", () => {
    const issues = directiveDiagIssues(diagsOf(REPLACE_MISS));
    const hit = issues.filter((i) => i.code === "nudo:directive-syntax");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.severity).toBe("warning");
    expect(hit[0]!.message).toContain("JSON.parse(inpt)");
  });
});

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
  it("② 重复声明 ⇒ 有一条点名两条来源的诊断", () => {
    const r = applyMockModuleDirectivesFromSource(DUP_SRC, {}, {
      fromFile: join(dir, "app.js"),
    });
    const dups = r.errors.filter((e) => e.message.includes("Duplicate @nudo:mock-module"));
    expect(dups).toHaveLength(1);
    // 诊断必须点名**两条**指令的来源
    expect(dups[0]!.message).toContain("./mock-fs.js");
    expect(dups[0]!.message).toContain("./mock-fs3.js");
    expect(dups[0]!.message).toContain('"fs"');
    expect(dups[0]!.code).toBe("nudo:mock-invalid");
  });

  it("① 单条声明 ⇒ 零该诊断（不许误报）", () => {
    const r = applyMockModuleDirectivesFromSource(SINGLE_SRC, {}, {
      fromFile: join(dir, "app.js"),
    });
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(true);
  });

  it("② 重复后先声明者的导出名不得静默消失（不退化成 unknown）", () => {
    const r = applyMockModuleDirectivesFromSource(DUP_SRC, {}, {
      fromFile: join(dir, "app.js"),
    });
    const named = r.modules.fs!.named;
    // 改前：整块覆写 ⇒ readFile 从导出表里**消失**（调用点退化成 unknown）
    expect(Object.keys(named).sort()).toEqual(["readFile", "writeFile"]);
    // 且先声明者的导出**仍是精确值**（不是 unknown）
    const readFile = named.readFile!;
    expect(formatAbs($call(readFile, [$lit("/x")]))).toContain("mock1:/x");
  });

  it("门禁面可见：warning 级（不挡 exit）", () => {
    const file = join(dir, "app.js");
    writeTmpFile(dir, "app.js", DUP_SRC);
    const issues = collectCheckSupplementIssues(file, DUP_SRC);
    const dups = issues.filter((i) => i.code === "nudo:mock-invalid");
    expect(dups).toHaveLength(1);
    expect(dups[0]!.severity).toBe("warning");
    expect(dups[0]!.message).toContain("./mock-fs.js");
    expect(dups[0]!.message).toContain("./mock-fs3.js");
  });

  it("重复声明不影响单条声明的既有口径（局部形态：未点名的名字回落原模块）", () => {
    const src = `/// @nudo:mock-module "fs" { readFile } from "./mock-fs.js"
/// @nudo:mock-module "fs" { writeFile } from "./mock-fs3.js"
import { readFile } from "fs";
export function f() { return readFile("/x"); }
`;
    const r = applyMockModuleDirectivesFromSource(src, {}, {
      fromFile: join(dir, "app.js"),
    });
    // 重复声明被点名（同一 specifier 两条指令）
    expect(r.errors.filter((e) => e.message.includes("Duplicate @nudo:mock-module"))).toHaveLength(1);
    // 两条指令点名的名字**都在**（并集）⇒ 导出名不消失
    expect(Object.keys(r.modules.fs!.named).sort()).toEqual(["readFile", "writeFile"]);
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

describe("dependency module's own @nudo:mock", () => {
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

describe("@nudo:replace 只认值位的表达式节点", () => {
  it("目标命中声明符 id（绑定位）⇒ 不算命中 + 显式诊断", () => {
    expect(registeredOffsets(DECL_ID)).toEqual([undefined]);
    const diags = directiveDiagsOf(DECL_ID);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain('@nudo:replace target "x"');
    expect(diags[0]!.message).toContain("matched no expression");
    // 绑定位没有被替换（值仍是 5），且这条「没生效」是**可见**的
    expect(signatureOf(DECL_ID, "getDeclId")).toBe("5");
  });

  it("目标命中对象属性键位 ⇒ 不算命中 + 显式诊断", () => {
    expect(registeredOffsets(OBJ_KEY)).toEqual([undefined]);
    const diags = directiveDiagsOf(OBJ_KEY);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain('@nudo:replace target "a"');
  });

  it("对照组：目标命中属性值（表达式位）⇒ 命中有区间、零诊断、替换生效", () => {
    expect(typeof registeredOffsets(OBJ_VAL)[0]).toBe("number");
    expect(directiveDiagsOf(OBJ_VAL)).toEqual([]);
    expect(signatureOf(OBJ_VAL, "getObjVal")).toBe("number");
  });

  it("对照组：目标全文未命中 ⇒ 仍然是「matched no expression」告警", () => {
    const diags = directiveDiagsOf(NO_MATCH);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain('@nudo:replace target "zzz"');
  });
});
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

describe("@nudo:skip 按「同名取词法最浅」绑定", () => {
  it("C：内层同名函数的 skip 不再顶掉外层（C 的签名 == D 的签名）", () => {
    expect(collectSkipReturns(C).get("f")).toBeDefined();
    expect(signatureOf(C, "f").display).toBe(signatureOf(D, "f").display);
    expect(signatureOf(C, "f").display).toBe("number");
  });

  it("E：外层没有 skip ⇒ 内层同名 skip 不越界（该名不进 skip 表）", () => {
    expect(collectSkipReturns(E).has("f")).toBe(false);
    expect(collectSkipReturns(F).has("f")).toBe(false);
  });

  it("E 与 F 的签名逐字相同（导出函数的 throws 标注不再被抹掉）", () => {
    const e = signatureOf(E, "f");
    const f = signatureOf(F, "f");
    expect(e.display).toBe(f.display);
    expect(e.throws).toBe(f.throws);
    expect(e.throws).toContain("TypeError");
  });

  it("内层函数自己的 skip 仍按最浅同名者裁决（不同名时照常绑定）", () => {
    // D 组：内层改名 g ⇒ g 的 skip 绑定到 g，外层 f 仍是 number()
    expect(collectSkipReturns(D).get("f")).toBeDefined();
    expect(signatureOf(D, "f").display).toBe("number");
  });

  it("同族 @nudo:pure 用同一裁决（内层同名 pure 不标记外层）", () => {
    const src = [
      "export function f(x) {",
      "  /** @nudo:pure */",
      "  function f() { return 1; }",
      "  return f() + x;",
      "}",
      "",
    ].join("\n");
    expect(pureFnNamesOfAst(parse(src))).toEqual([]);
    const renamed = [
      "export function f(x) {",
      "  /** @nudo:pure */",
      "  function g() { return 1; }",
      "  return g() + x;",
      "}",
      "",
    ].join("\n");
    expect(pureFnNamesOfAst(parse(renamed))).toEqual(["g"]);
    // 顶层函数的 pure 不受影响
    expect(
      pureFnNamesOfAst(parse("/** @nudo:pure */\nexport function f() { return 1; }\n")),
    ).toEqual(["f"]);
    // 抽取面仍返回「带指令的函数」（depth 只是新增字段，不改变成员集）
    const fns = extractDirectivesQuiet(parse(C));
    expect(fns.map((fn) => [fn.name, fn.depth])).toEqual([
      ["f", 0],
      ["f", 1],
    ]);
  });
});
});

// ---------------------------------------------------------------------------
// 指令收集覆盖面
// ---------------------------------------------------------------------------
describe("指令收集覆盖面", () => {
/**
 * 行内指令（@nudo:as / @nudo:replace）收集器的**通用下钻**。
 *
 * 改前：收集器只下钻 4 类容器（Block / Function / Export / If）⇒ 写在
 * for / for-of / while / do-while / try / catch / finally / switch /
 * labeled / 箭头函数 / 类方法 里的指令被**静默丢弃**（零诊断、类型覆盖失效）。
 *
 * 原生真值：指令是注释，运行时**无任何效果**——@nudo:as 是**类型面**声明，
 * 落在哪条语句就覆盖那条语句的 init / return 值。故断言口径是
 * 「承载指令的那条语句的被覆盖值」。
 */






/** 指令所在容器 → 源码片段（其余部分逐字相同） */
const CONTAINERS: Array<[string, string]> = [
  ["fn-body", `export function f() {
  // @nudo:as number()
  const y = "hello";
  return y;
}`],
  ["for", `export function f() {
  for (let i = 0; i < 1; i++) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
  return 0;
}`],
  ["for-of", `export function f(xs) {
  for (const x of xs) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
  return 0;
}`],
  ["for-in", `export function f(o) {
  for (const k in o) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
  return 0;
}`],
  ["while", `export function f() {
  while (true) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
  ["do-while", `export function f() {
  do {
    // @nudo:as number()
    const y = "hello";
    return y;
  } while (false);
}`],
  ["try", `export function f() {
  try {
    // @nudo:as number()
    const y = "hello";
    return y;
  } catch (e) {
    return 0;
  }
}`],
  ["catch", `export function f() {
  try {
    throw new Error("x");
  } catch (e) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
  ["finally", `export function f() {
  try {
    return 1;
  } finally {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
  ["switch", `export function f(k) {
  switch (k) {
    case 1: {
      // @nudo:as number()
      const y = "hello";
      return y;
    }
    default:
      return 0;
  }
}`],
  ["labeled", `export function f() {
  lbl: {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
  ["arrow", `export const f = () => {
  // @nudo:as number()
  const y = "hello";
  return y;
};`],
  ["fn-expression", `export const f = function () {
  // @nudo:as number()
  const y = "hello";
  return y;
};`],
  ["class-method", `export class K {
  m() {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
];

/** 收集器层面：每个容器位置的指令都必须进注入表 */
describe("指令收集覆盖面", () => {
  for (const [name, body] of CONTAINERS) {
    it(`收集 ${name} 容器里的 @nudo:as`, () => {
      const src = `/// @nudo:env es\n\n${body}\n`;
      const reps = collectEvalReplacements(src);
      expect(reps.asTargets.length).toBe(1);
      expect(reps.asValues[Object.keys(reps.asValues)[0]]).toBeDefined();
    });
  }

  it("收集 for 循环体里的 @nudo:replace", () => {
    const src = `export function f() {
  for (let i = 0; i < 1; i++) {
    // @nudo:replace JSON.parse("{}") shape({ port: number() })
    const y = JSON.parse("{}");
    return y;
  }
  return 0;
}
`;
    const reps = collectEvalReplacements(src);
    expect(reps.targets.length).toBeGreaterThan(0);
  });
});

/** 产品面（分析器）层面：承载指令的那条语句被覆盖 */
describe("分析面上的覆盖效果", () => {
  // 类方法的入口用例在分析面恒为 unknown（与指令无关）——它只断言收集器层面
  for (const [name, body] of CONTAINERS.filter(([n]) => n !== "class-method")) {
    it(`${name} 里的 @nudo:as 覆盖承载语句的值`, () => {
      const src = `/// @nudo:env es\n\n${body}\n`;
      const result = analyzeFile("/test/bug454.js", src);
      expect(result.functions.length).toBe(1);
      expect(formatShape(result.functions[0].cases[0].abs)).toBe("number");
    });
  }
});

/** 负控制：不该被这条修复波及的邻近形态 */
describe("负控制", () => {
  it("无指令的语句不受同函数内其它指令影响", () => {
    const src = `/// @nudo:env es

export function f() {
  // @nudo:as number()
  const a = "x";
  const b = "y";
  return b;
}
`;
    const result = analyzeFile("/test/bug454-neg.js", src);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe('"y"');
  });

  it("指令挂在非语句节点上——不产生注入（无处可施），且发显式诊断", () => {
    // 对象属性不是语句：@nudo:as 没有可覆盖的语句
    const src = `export const o = {
  // @nudo:as number()
  a: 1,
};
`;
    const reps = collectEvalReplacements(src);
    expect(reps.asTargets.length).toBe(0);
    const diags: DirectiveDiag[] = [];
    collectEvalReplacements(src, { diags });
    expect(diags.map((d) => d.code)).toContain("nudo:directive-syntax");
  });

  it("无任何行内指令的源码不产生诊断", () => {
    const src = `export function f() {\n  return 1;\n}\n`;
    const diags: DirectiveDiag[] = [];
    const reps = collectEvalReplacements(src, { diags });
    expect(reps.asTargets.length).toBe(0);
    expect(reps.targets.length).toBe(0);
    expect(diags).toEqual([]);
  });
});
});

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

describe("同名 @nudo:mock 按函数作用域各生效", () => {
  it("先声明的函数不再被后声明的同名 mock 改写成错类型", () => {
    expect(sigValue(TWO_MOCKS, "/tmp/bug455-a.js", "readA")).toBe(8080);
    expect(sigValue(TWO_MOCKS, "/tmp/bug455-b.js", "readB")).toBe("closed");
  });

  it("声明顺序互换不改变各自的取值（不再纯源序 last-wins）", () => {
    expect(sigValue(TWO_MOCKS_REVERSED, "/tmp/bug455-c.js", "readA")).toBe(8080);
    expect(sigValue(TWO_MOCKS_REVERSED, "/tmp/bug455-d.js", "readB")).toBe("closed");
  });

  it("种子表保留每个作用域各自的那一份（scoped + 覆盖表）", () => {
    const seeds = seedsOf(TWO_MOCKS, "/tmp/bug455-e.js");
    expect(seeds.scoped?.map((s) => s.scope)).toEqual(["readA", "readB"]);
    const mocks = mockSeedsToAbsMocks(seeds);
    const overrides = mockScopeOverridesOf(mocks);
    expect(overrides && Object.keys(overrides).sort()).toEqual(["readA", "readB"]);
    // 作用域选择面：各自取各自的 mock（两个 mock 是不同的 Abs）
    const a = mockScopeSelected(mocks, "readA");
    const b = mockScopeSelected(mocks, "readB");
    expect(a.getPort).toBeDefined();
    expect(b.getPort).toBeDefined();
    expect(a.getPort).not.toBe(b.getPort);
    expect(a.getPort).not.toBe(mocks.getPort);
  });
});

// / 旧负控断言「未冲突的 mock 文件级可见」正是那两条 bug
// 的假绿根因（同文件其它函数被 mock 掩盖真实 ReferenceError）。按
// `docs/design/directive-scope.md`，`@nudo:mock` 是**函数级**指令 ⇒ 只在
// 声明它的函数体内生效。
describe("负控制 —— 未冲突的 mock 只在声明函数内生效", () => {
  it("声明函数取值一致；未声明函数看不到该 mock", () => {
    expect(sigValue(ONE_MOCK, "/tmp/bug455-f.js", "readA")).toBe(8080);
    expect(sigValue(ONE_MOCK, "/tmp/bug455-g.js", "readB")).toBe(
      "never throws ReferenceError",
    );
  });

  it("无冲突时不产生作用域覆盖表（不留冗余状态）", () => {
    const mocks = mockSeedsToAbsMocks(seedsOf(ONE_MOCK, "/tmp/bug455-h.js"));
    expect(mockScopeOverridesOf(mocks)).toBeUndefined();
  });
});

describe("产物面 —— service analyzer 逐函数求值按作用域取 mock", () => {
  it("readA / readB 各自取各自的 mock（接线前：先声明的也被后声明的改写）", async () => {
    // 产物面（`nudo export --format dts` / `nudo test` 的 case 值 / LSP hover）
    // 走 service analyzer 的**按函数求值**路径（tryEvalCallFull / tryEvalAbsFull），
    // 不经过 core 的 generalizeFromAst ⇒ 作用域选择必须在这两个入口接上。
    const res = await analyzeFileAsync("/tmp/bug455-product.js", TWO_MOCKS);
    const valueOf = (name: string): unknown => {
      const fn = res.functions.find((f) => f.name === name);
      expect(fn, `function ${name} missing`).toBeDefined();
      const lit = litValue(fn!.combinedAbs!);
      return lit.ok ? lit.value : undefined;
    };
    expect(valueOf("readA")).toBe(8080);
    expect(valueOf("readB")).toBe("closed");
  });
});
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

describe("mode=directives 的指令名单要全（assume/invariant/throws/budget）", () => {
  it("hasNudoDirectives 认得 assume/invariant/throws/budget", () => {
    for (const name of MISSING) {
      expect(hasNudoDirectives(sourceWith(name)), name).toBe(true);
    }
  });

  it("shouldAnalyzeFile 纳入只含这四个指令的文件（改前：整份文件被跳过 → 假绿）", () => {
    const dir = tmpDirProject();
    for (const name of MISSING) {
      const file = join(dir, `only-${name}.js`);
      const source = sourceWith(name);
      writeFileSync(file, source);
      expect(shouldAnalyzeFile(file, source), name).toBe(true);
    }
  });

  it("负控制：无指令 / 指令只在字符串里 → 仍不纳入", () => {
    const dir = tmpDirProject();
    const plain = join(dir, "plain.js");
    const plainSrc = "export function f(x) {\n  return x;\n}\n";
    writeFileSync(plain, plainSrc);
    expect(shouldAnalyzeFile(plain, plainSrc)).toBe(false);

    const strOnly = join(dir, "str-only.js");
    const strSrc = 'export const s = "@nudo:assume d <= max";\n';
    writeFileSync(strOnly, strSrc);
    expect(shouldAnalyzeFile(strOnly, strSrc)).toBe(false);
  });

  it("负控制：已在名单里的指令名不得回退", () => {
    for (const name of PRESENT) {
      expect(hasNudoDirectives(sourceWith(name)), name).toBe(true);
    }
  });

  it("文件级指令形态（/// @nudo:env）也纳入", () => {
    const dir = tmpDirProject();
    const file = join(dir, "env.js");
    const source = "/// @nudo:env node\nexport function f(x) {\n  return x;\n}\n";
    writeFileSync(file, source);
    mkdirSync(dir, { recursive: true });
    expect(shouldAnalyzeFile(file, source)).toBe(true);
  });
});
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

describe("nudo:mock-invalid severity", () => {
  it("mock expression parse failure is a warning, not an error", () => {
    const r = analyzeFile("/t/b460/mock-expr.js", MOCK_EXPR);
    const diags = r.diagnostics.filter((d) => d.code === "nudo:mock-invalid");
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.severity).toBe("warning");
    }
  });

  it("both mock-invalid channels (static validation + mock seed) agree", () => {
    const r = analyzeFile("/t/b460/mock-expr-agree.js", MOCK_EXPR);
    const sevs = new Set(
      r.diagnostics.filter((d) => d.code === "nudo:mock-invalid").map((d) => d.severity),
    );
    expect([...sevs]).toEqual(["warning"]);
  });

  it("missing mock file stays an error (no fake green)", () => {
    const r = analyzeFile("/t/b460/mock-missing.js", MOCK_MISSING_FILE);
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((d) => d.code === "nudo:module-missing")).toBe(true);
  });
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

describe("内联 mock 的可构造性 facet", () => {
  it("内联箭头 mock：new 定抛 ⇒ 走 catch 分支（原生 caught，修复前 mocked）", () => {
    expect(sigValue(INLINE_ARROW, "/tmp/bug482-a.js", "greet")).toBe("caught");
  });

  it("内联 mock 的种子带 ctor facet（箭头 ⇒ 不可构造）", () => {
    const seeds = seedsOf(INLINE_ARROW, "/tmp/bug482-b.js");
    expect(seeds.seedFns.Greeter?.ctor).toBe(false);
  });

  it("内联 function 表达式 mock：可构造（ctor:true），不走 catch 分支", () => {
    const seeds = seedsOf(INLINE_FN_EXPR, "/tmp/bug482-c.js");
    expect(seeds.seedFns.Greeter?.ctor).toBe(true);
    // 构造成功（不再定抛 TypeError）⇒ 结果不是 catch 分支的 "caught"
    const value = sigValue(INLINE_FN_EXPR, "/tmp/bug482-d.js", "greet");
    expect(value).not.toBe("caught");
  });
});

describe("负控制 —— from 形态与本地箭头不受影响", () => {
  it("from 形态（mock 文件导出箭头）仍是 caught", () => {
    const dir = makeTmpProject("nudo-bug482-", {
      "mocks/greeter.js": `export const Greeter = () => ({ msg: "mocked" });\n`,
      "app.js": `/**
 * @nudo:mock Greeter from "./mocks/greeter.js"
 */
export function greet() {
  try { return new Greeter().msg; } catch { return "caught"; }
}
`,
    });
    const entry = join(dir, "app.js");
    const source = readFileSync(entry, "utf-8");
    const mocks = mockSeedsToAbsMocks(
      mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile: entry }),
    );
    const report = checkSource(entry, source, undefined, {
      inject: { mocks },
      fromFile: entry,
    });
    const sig = report.signatures.find((s) => s.name === "greet");
    const lit = litValue(sig!.abs);
    expect(lit.ok ? lit.value : sig!.display).toBe("caught");
  });

  it("本地 const 箭头（不加 mock）仍是 caught", () => {
    expect(sigValue(LOCAL_ARROW, "/tmp/bug482-e.js", "greet")).toBe("caught");
  });
});
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

describe("rejects 形态建模成 reject 的 promise（不是 never）", () => {
  it("返回类型是 promise 面（eff/promise），不是 never", () => {
    const report = check("/tmp/bug488-a.js", REJECTS, "/tmp/bug488-a.js");
    const sig = report.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.abs.shape.k).toBe("eff");
    expect((sig!.abs.shape as { eff?: string }).eff).toBe("promise");
    expect(formatShape(sig!.abs)).not.toBe("never");
  });

  it("返回契约不再被 never 空洞满足（string() 判为不满足 ⇒ 报 unproven-return）", () => {
    const dir = makeTmpProject("nudo-bug488-", {
      "a.js": REJECTS,
      "a.nudo.js": `import { fn, string } from "@nudojs/core";\nexport const f = fn({}, string());\n`,
    });
    const entry = join(dir, "a.js");
    const source = readFileSync(entry, "utf-8");
    const report = check(entry, source, entry);
    const unproven = report.issues.filter((i) => i.code === "nudo:unproven-return");
    expect(unproven.length).toBeGreaterThanOrEqual(1);
  });
});

describe("负控制 —— resolves / returns 形态不受影响", () => {
  it("resolves 形态仍是 promise<42>", () => {
    const report = check("/tmp/bug488-b.js", RESOLVES, "/tmp/bug488-b.js");
    const sig = report.signatures.find((s) => s.name === "f");
    expect(sig!.abs.shape.k).toBe("eff");
    expect(formatShape(sig!.abs)).toContain("42");
  });

  it("returns 形态仍是同步值 42", () => {
    const report = check("/tmp/bug488-c.js", RETURNS, "/tmp/bug488-c.js");
    const sig = report.signatures.find((s) => s.name === "f");
    expect(sig!.abs.shape.k).toBe("prim");
    expect(formatShape(sig!.abs)).toContain("42");
  });

  it("resolves 形态在同契约下同样报 unproven-return（口径一致）", () => {
    const dir = makeTmpProject("nudo-bug488b-", {
      "b.js": RESOLVES,
      "b.nudo.js": `import { fn, string } from "@nudojs/core";\nexport const f = fn({}, string());\n`,
    });
    const entry = join(dir, "b.js");
    const source = readFileSync(entry, "utf-8");
    const report = check(entry, source, entry);
    expect(report.issues.filter((i) => i.code === "nudo:unproven-return").length).toBeGreaterThanOrEqual(1);
  });
});
});
