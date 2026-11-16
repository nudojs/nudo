/**
 * 模块套件：service 其余 core/eval 产品语义。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { type Abs, checkSource, resetCheckSourceMemo, resetGeneralizeMemo, resetNudoModuleExecCache, resetParseSourceCache, resetSidecarLoadFailureCache, takeContractDiags, takeRefineDiags, numLit, runTranspiled, formatShape, pTrue } from "@nudojs/core";
import { analyzeFile, resetAllAnalysisCaches } from "../index.ts";
import { generateDts, dtsModuleSurface, projectFunctionDts, projectModuleDts } from "../emit/dts-generator.ts";
import { absToZodSchemaModule } from "../emit/schema-generator.ts";
import { analyzeFile as analyzeFile___nudojs_service, analyzeFile as analyzeFile___nudojs_service_1 } from "@nudojs/service";
import { type DirectiveDiag, parse, parseCaseArgExpr } from "@nudojs/parser";
import { collectEvalReplacements, resolveEvalInjection } from "../eval-injection.ts";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitDerivedFromRoot } from "../emit/contract-derivation-emit.ts";
import { emitContract } from "../emit/contract-emitter.ts";
import { resetAbsCallBudget, resetEvalForkBudget, listTopFunctions } from "@nudojs/core/internal";
import { analyzeFileWithEvalFailures } from "../analyzer-orchestrate.ts";
import { tmpProject, withTmpProject, writeTmpFile, tmpProject as makeTmpProject } from "./tmp-project.ts";
import { collectTopLevelFunctions } from "../analyzer-ast.ts";
import { analyzeFile as analyzeFile_____analyzer_ts, analyzeFile as analyzeFile_____analyzer_ts_1, analyzeFile as analyzeFile_____analyzer_ts_2, analyzeFile as analyzeFile_____analyzer_ts_3, analyzeFile as analyzeFile_____analyzer_ts_4, analyzeFile as analyzeFile_____analyzer_ts_5, analyzeFile as analyzeFile_____analyzer_ts_6, analyzeFile as analyzeFile_____analyzer_ts_7 } from "../analyzer.ts";
import { buildTestReport } from "../test-report.ts";
import { inferenceFailed, caseExpectedSatisfied, formatExpected } from "../analyzer-orchestrate-uncached-cases.ts";
import { neverAbs } from "../evaluator/call-record.ts";
import { evalAbsModuleGraph, clearAbsModuleCache, evalExportsToModuleExports } from "../abs-modules-graph.ts";
import { resolveExportSite } from "../analyzer-abs-eval.ts";
import { collectEvalReplacements as collectEvalReplacements_____eval_run_ts, resolveEvalInjection as resolveEvalInjection_____eval_run_ts } from "../eval-run.ts";
import { l2Count } from "./check-helpers.ts";
import { loadModuleOutcome, guardedLoadModule, ModuleReadError } from "../load-module.ts";
import { collectEvalDiagnostics } from "../eval-diagnostics.ts";

// ---------------------------------------------------------------------------
// 产物面不得出现内部伪名 brand（Intl 未建模子构造器）
// ---------------------------------------------------------------------------
describe("产物面不得出现内部伪名 brand（Intl 未建模子构造器）", () => {
/**
 * 产物面回归：`new Intl.Collator('en')` 等**未建模子构造器**返回内部
 * 伪名 brand（`__nudoFnParentN`），该伪名泄漏进产品面产物 ⇒
 * - dts 产物：`export declare function f(): __nudoFnParent1;` —— 伪名是**合法
 * JS 标识符**却从未声明 ⇒ 消费方 tsc 报 **TS2304**；
 * - schema 产物：`z.instanceof(__nudoFnParent1)` —— 生成模块**import 即崩**
 * （ReferenceError），整个产物作废。
 *
 * 本文件钉住**产物面**：产物里不得出现内部伪名，也不得引用未声明的绑定；
 * zod 产物必须可求值（import 即用）。
 */






beforeEach(() => {
  resetAllAnalysisCaches();
});

const SRC = `export function newCollator() {\n  return new Intl.Collator('en');\n}\n`;

/** 内部伪名（实现细节，不得出现在任何产物面上） */
function isInternalPseudoName(name: string): boolean {
  return /^__nudoFnParent\d*$/.test(name);
}

function newCollatorOutputAbs(): Abs {
  const result = analyzeFile("/t/bug242-intl.js", SRC);
  const fn = result.functions[0]!;
  const out = fn.combinedAbs ?? fn.cases[0]?.abs;
  if (!out) throw new Error("no output abs for Intl fixture");
  return out;
}

/** zod 桩：链式可调用（只为验证「模块求值期不炸」） */
function zodStub(): unknown {
  const stub: unknown = new Proxy(function () {} as unknown as object, {
    get: () => stub,
    apply: () => stub,
  });
  return stub;
}

/** 把 zod 产物当模块求值一次（去 import / export 后 new Function 跑） */
function evaluateZodModule(source: string, exportNames: string[]): { ok: boolean; error?: string } {
  const body =
    source
      .replace(/^import \{ z \} from "zod";$/m, "")
      .replace(/^export const /gm, "const ") + `\nreturn { ${exportNames.join(", ")} };`;
  try {
    new Function("z", body)(zodStub());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

describe("产物面不得出现内部伪名 brand（Intl 未建模子构造器）", () => {
  it("引擎侧：实例 brand 名不是内部伪名；dts 产物：不得出现内部伪名（改前：TS2304——伪名从未声明）；schema 产物：不得 z.instanceof(内部伪名)（改前：import 即 ReferenceError）；schema 产物可求值（import 即用——改前 ReferenceError）；负控制：产物里的 z.instanceof 实参都是运行时全局构造器", () => {
(() => {
  resetAllAnalysisCaches();


    const out = newCollatorOutputAbs();
    const name = out.shape.k === "brand" ? (out.shape.name ?? "") : "";
    expect(isInternalPseudoName(name)).toBe(false);
  })();
(() => {
  resetAllAnalysisCaches();


    const dts = generateDts(analyzeFile("/t/bug242-intl.js", SRC));
    expect(dts).not.toMatch(/__nudoFnParent/);
    // 消费方 tsc 不得见到未声明的类型名
    expect(dts).not.toMatch(/:\s*__nudo/);
  })();
(() => {
  resetAllAnalysisCaches();


    const { source } = absToZodSchemaModule({ newCollatorOutput: newCollatorOutputAbs() });
    expect(source).not.toMatch(/__nudoFnParent/);
    expect(source).not.toMatch(/z\.instanceof\(\s*__nudo/);
  })();
(() => {
  resetAllAnalysisCaches();


    const { source } = absToZodSchemaModule({ newCollatorOutput: newCollatorOutputAbs() });
    const r = evaluateZodModule(source, ["newCollatorOutput"]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
  })();
(() => {
  resetAllAnalysisCaches();


    const { source } = absToZodSchemaModule({ newCollatorOutput: newCollatorOutputAbs() });
    const names = [...source.matchAll(/z\.instanceof\(([^)]*)\)/g)].map((m) => m[1]!);
    for (const name of names) {
      const v = (globalThis as Record<string, unknown>)[name];
      expect(typeof v, name).toBe("function");
    }
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 类形参归一为 TS unknown（TS 投影面）
// ---------------------------------------------------------------------------
describe("类形参归一为 TS unknown（TS 投影面）", () => {
/**
 * `export --format dts` 的类成员投影。
 *
 * 三个丢信息点（`dtsClassDeclaration`）：① 构造器 / 静态方法形参无类型
 * 证据；② 静态方法返回硬编码 `unknown`；③ 实例方法返回只吃
 * case/combinedAbs 证据（分析面对类成员给的就是 `unknown`）。
 *
 * 历史：曾把 ① 从硬编码 `unknown` 改成 `any`，理由是
 * `CLAUDE.md` 的展示面分面约定（无约束 ⇒ any）。2026-11-06 产品裁定
 * 「nudo any ≈ TS unknown」明确该规则只管 **nudo 展示 / CLI 面**；
 * **TS 投影面**把无约束 any 映成 TS `unknown`（top）⇒ ① 回到 `unknown`，
 * 但理由不是「推断失败」，而是「TS 侧的 top」。`nudo check` 的签名面
 * （`Widget(w: any, h: any)`）仍按展示面规则打印 any，两者作用域不同。
 *
 * ③ 的证据通道在 analyzer 侧（类成员的 `combinedAbs` 恒为 `unknown`，
 * `generalizeFromAst` 对 `Widget.area` 返回 undefined）⇒ 已上报为遗留项。
 */




const SRC = `export class Widget {\n  constructor(w, h) {\n    this.w = w;\n    this.h = h;\n  }\n  area() {\n    return this.w * this.h;\n  }\n}\n`;

function classDts(): string {
  const result = analyzeFile___nudojs_service("/test/bug003.js", SRC);
  const surface = dtsModuleSurface(SRC);
  const mod = projectModuleDts(
    surface,
    result.functions.map((fn) => ({ fn, projection: projectFunctionDts(fn, undefined, surface) })),
  );
  return mod.lines.join("\n");
}

describe("类形参归一为 TS unknown（TS 投影面）", () => {
  it("构造器形参 = unknown（nudo 展示面仍为 any，两个作用域不同）", () => {
    const dts = classDts();
    expect(dts).toContain("constructor(w: unknown, h: unknown);");
    expect(dts).not.toContain("constructor(w: any");
  });
});
});

// ---------------------------------------------------------------------------
// @nudo:replace 挂在裸块语句上必须生效
// ---------------------------------------------------------------------------
describe("@nudo:replace 挂在裸块语句上必须生效", () => {
/**
 * `@nudo:replace` 的「紧随语句」是**裸块语句** `{ … }` 时，收集面
 * 的**作用域边界**守卫把 walk 的**根节点**也挡住了 ⇒ 候选区间恒空 ⇒
 * 替换**永不生效**，而诊断还谎称「该指令所标注语句的作用域内没有匹配表达式」
 * ——匹配目标就在它所标注的那个块里。
 *
 * 根因：`packages/service/src/eval-injection.ts` 的 `replaceCandidateRanges`
 * 对 walk 的根也判 `SCOPE_BOUNDARY_TYPES`（含 `BlockStatement`）⇒ 第一步即
 * 返回。边界守卫的意图只是「不下钻**嵌套**作用域」。
 *
 * 断言非永真：改前 `blockTarget` 的签名是 `number | string` 且带一条
 * 「matched no expression」警告；改后是 `number` 且零该警告。
 */





/** 指令挂在**裸块语句**上（块内用的就是目标 `a`） */
const BLOCK_TARGET = `export function blockTarget(a) {
  // @nudo:replace a number()
  {
    const x = a + 1;
    return x;
  }
}
`;

/** 对照组：指令挂在普通语句（`const`）上——改前改后都生效 */
const CONST_TARGET = `export function plainTarget(a) {
  // @nudo:replace a number()
  const x = a + 1;
  return x;
}
`;

/** 目标**只**落在嵌套语句块里（真·边界挡住） */
const NESTED_BLOCK_TARGET = `export function nested(a) {
  // @nudo:replace b number()
  {
    const x = 1;
    {
      const b = 2;
      return b + x;
    }
  }
  return a;
}
`;

function diagsOf(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  collectEvalReplacements(src, { diags });
  return diags.filter((d) => d.code === "nudo:directive-syntax");
}

/** 与 `nudo check` 同一注入管线：收集面 → transpile 注入包 → checkSource */
function signatureOf(src: string, name: string): { display: string; throws?: string } {
  const inject = resolveEvalInjection(src);
  const report = checkSource("/tmp/bug-013.js", src, undefined, {
    fromFile: "/tmp/bug-013.js",
    ...(inject ? { inject } : {}),
  });
  const sig = report.signatures.find((s) => s.name === name);
  expect(sig, `signature ${name} missing`).toBeDefined();
  return { display: sig!.display, throws: sig!.throws };
}

describe("@nudo:replace 挂在裸块语句上必须生效", () => {
  it("裸块语句上的指令登记了**节点身份**区间（改前恒空）；裸块语句 与 普通语句 的签名逐字相同（替换真的生效）；裸块语句命中 ⇒ 零「未命中」诊断（不许谎报作用域内没有该表达式）；目标确实只在**嵌套**块里 ⇒ 诊断明说「被嵌套作用域挡住」而不是「没有该表达式」", () => {
(() => {

    const reps = collectEvalReplacements(BLOCK_TARGET);
    expect(reps.targets).toHaveLength(1);
    expect(typeof reps.targets[0]!.stmtStart).toBe("number");
    expect(typeof reps.targets[0]!.stmtEnd).toBe("number");
  })();
(() => {

    expect(signatureOf(BLOCK_TARGET, "blockTarget").display).toBe("number");
    expect(signatureOf(BLOCK_TARGET, "blockTarget").display).toBe(
      signatureOf(CONST_TARGET, "plainTarget").display,
    );
  })();
(() => {

    expect(diagsOf(BLOCK_TARGET)).toEqual([]);
  })();
(() => {

    const diags = diagsOf(NESTED_BLOCK_TARGET);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("@nudo:replace target \"b\"");
    expect(diags[0]!.message).toContain("nested scope");
    expect(diags[0]!.message).not.toContain("matched no expression");
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 溯源标签与 cwd 无关
// ---------------------------------------------------------------------------
describe("溯源标签与 cwd 无关", () => {
/**
 * 派生段的溯源标签 `// derived-from: <root>:<fn>` 用 **cwd 相对**
 * 路径 ⇒ 同一个 root 在不同 cwd 下重算得到两种拼写；合并逻辑又取**并集**
 * ⇒ 同一个 root 在一行里出现两次，且**永久留存**（再跑也不清理）。
 *
 * 修法：① 标签改成 **cwd 无关**的包根相对路径（无 package.json ⇒ basename）；
 * ② 合并/相等判定按**身份**（路径取 basename）比较 ⇒ 历史拼写归一，不再并集。
 */






let dir: string;
let prevCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-041-"));
  prevCwd = process.cwd();
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
});

function fixture(): { root: string; pkgDir: string } {
  mkdirSync(join(dir, "pkg"), { recursive: true });
  writeFileSync(join(dir, "package.json"), `{"name":"f","type":"module"}\n`, "utf-8");
  writeFileSync(
    join(dir, "pkg/helper.js"),
    `export function helper(a) {\n  return a + 1;\n}\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "pkg/lib.js"),
    `import { helper } from "./helper.js";\nexport function add2(a) {\n  return helper(a);\n}\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "pkg/lib.nudo.js"),
    `import { fn, number } from "@nudojs/core";\nexport const add2 = fn({ a: number() }, number());\n`,
    "utf-8",
  );
  return { root: join(dir, "pkg/lib.js"), pkgDir: join(dir, "pkg") };
}

function labels(): string[] {
  const text = readFileSync(join(dir, "pkg/helper.nudo.js"), "utf-8");
  const m = /^\s*\/\/\s*derived-from:\s*(.+)$/m.exec(text);
  return (m?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

describe("溯源标签与 cwd 无关", () => {
  it("两个不同 cwd 各跑一次 ⇒ 标签逐字相同且只有一条；历史 cwd 相对拼写 + 新拼写 ⇒ 归一成一条（不再并集）", () => {
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-041-"));
  prevCwd = process.cwd();


    const { root, pkgDir } = fixture();

    process.chdir(dir);
    emitDerivedFromRoot(root, { mode: "update" });
    const first = labels();
    expect(first).toHaveLength(1);

    process.chdir(pkgDir);
    emitDerivedFromRoot(root, { mode: "update" });
    const second = labels();
    expect(second).toEqual(first);
    expect(second).toHaveLength(1);
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-041-"));
  prevCwd = process.cwd();


    const { root } = fixture();
    // 预置一段用旧拼写（cwd 相对）的派生段
    writeFileSync(
      join(dir, "pkg/helper.nudo.js"),
      [
        "// @generated by nudo — do not edit; regenerate with `nudo contract --emit`",
        "// source: helper.js:helper",
        "// derived-from: ../../" + "pkg/lib.js:add2",
        "export const helper = fn({ a: number() }, number().shift(1));",
        "",
      ].join("\n"),
      "utf-8",
    );

    process.chdir(dir);
    emitDerivedFromRoot(root, { mode: "update" });
    expect(labels()).toHaveLength(1);
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// 侧车解析失败必须点名侧车
// ---------------------------------------------------------------------------
describe("侧车解析失败必须点名侧车", () => {
/**
 * 侧车不可解析时诊断点名**源文件**而不是侧车。
 *
 * `collectGeneratedSections` 抛的是无路径的 `"sidecar is not parseable"`
 * （注释说「由调用方补充路径上下文」，但调用方直接让异常冒泡）⇒ 紧随其后的
 * 带路径分支（`tables === undefined`）**永远走不到** ⇒ 带路径的错误分支是
 * 死代码，用户拿到的报错指向被分析的**源文件**。
 *
 * 修法：调用方补上侧车路径再重抛。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-043-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("侧车解析失败必须点名侧车", () => {
  it("错误消息含侧车文件名（不是源文件名）", async () => {
    writeFileSync(join(dir, "lib.js"), `export function f(a) {\n  return a + 1;\n}\nf(1);\n`, "utf-8");
    // 语法的确崩：`const x = ;`
    writeFileSync(join(dir, "lib.nudo.js"), `export const x = ;\n`, "utf-8");

    await expect(emitContract(join(dir, "lib.js"), { mode: "update", all: true })).rejects.toThrow(
      /lib\.nudo\.js.*not parseable/,
    );
  });
});
});

// ---------------------------------------------------------------------------
// 解构形参的默认值 ⇒ 可省
// ---------------------------------------------------------------------------
describe("解构形参的默认值 ⇒ 可省", () => {
/**
 * 「解构 + 默认值」的形参被**必填化** ⇒ 产出的 `.d.ts` 让 TS 报
 * **TS2554**（合法调用 `f()` 被拒）。
 *
 * 根因：`declaredParams` 的 `case "pattern"` 硬编码 `hasDefault: false`，
 * 而解析器已经如实给出 `FormalParam.optional`（`{ a } = {}` ⇒ true）。
 * 修法：读该标记；解构位**未绑定展开**（渲染名是求值占位 `_p0`）时可省性
 * 可以表达 ⇒ `f(_p0?: any)`。
 */




describe("解构形参的默认值 ⇒ 可省", () => {
  it("`{ x = 1, y = x + 1 } = {}` ⇒ 形参可省（不是必填）；对照组：无默认值的解构形参仍必填", () => {
(() => {

    const dts = generateDts(
      analyzeFile___nudojs_service_1("/test/bug107.js", `export function f({ x = 1, y = x + 1 } = {}) { return y; }\n`),
    );
    expect(dts).toMatch(/export declare function f\(_p0\?: /);
  })();
(() => {

    const dts = generateDts(
      analyzeFile___nudojs_service_1("/test/bug107b.js", `export function g({ x = 1 } = undefined) { return x; }\n`),
    );
    // `= undefined` 也是默认值形态 ⇒ 可省
    expect(dts).toMatch(/export declare function g\(_p0\?: /);

    const required = generateDts(
      analyzeFile___nudojs_service_1("/test/bug107c.js", `export function r({ x }) { return x; }\n`),
    );
    expect(required).toMatch(/export declare function r\(_p0: /);
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// 1145 · service 观测面：模块级求值失败按文件可见
// ---------------------------------------------------------------------------
describe("1145 · service 观测面：模块级求值失败按文件可见", () => {
/**
 * 回归：**模块级求值失败**（闸门无法裁决该文件的回落）必须被**按文件**
 * 观测到——否则闸门看不到任何入口 ⇒ 零诊断 + exit 0（**假绿**：合法代码与
 * 违约代码都判绿）。
 *
 * 病灶：core 的回落计数是**进程级**的（`getEvalFallbackStats()`）⇒ 无法定位
 * 到文件 ⇒ 分析编排层没有「本文件求值失败」的信号 ⇒ 门禁无从 fail-closed。
 *
 * 修法（service 观测面）：`analyzeFileWithEvalFailures` 为**每个文件**装一个
 * 回落 collector，把该文件分析期间的回落按文件收集起来。
 *
 * **标签 ≠ 可见性**（之后的两维口径）：core 的回落事件带两个维度——
 * 标签 `reason`（谁的责任：`unsupported:*` 能力边界 / `module-throw` 程序
 * 自身抛 / `internal` 引擎缺陷）与可见性 `gateFatal`（闸门能不能裁决该文件）。
 * 失败信号按**可见性**收（`internal` 恒进；`module-throw` 仅装载期逃逸进；
 * `unsupported:*` 不进）。
 *
 * 断言面：
 * 1. 模块级求值失败（装载期逃逸）⇒ 观测面**看见**该文件的回落
 * （reason=module-throw，file=被分析文件）——这是闸门 fail-closed 的
 * 信号源（**标签**随 改为 module-throw：**可见性**不变）；
 * 2. **假红防线**：`unsupported:*`（能力边界）回落 **不**进失败信号；
 * 3. **假红防线**：**建模内抛**（NudoThrow ⇒ 引擎知道程序在抛 ⇒ 归
 * `nudo:module-throw` 通道）**不**进失败信号；
 * 4. 干净文件 ⇒ 零回落（不得凭空造失败）。
 */






/**
 * 模块级求值**必然失败**的源：模块顶层调用未定义的值 ⇒ 宿主运行时抛原生
 * TypeError ⇒ core 记一条 `internal` 回落 ⇒ 该模块全部导出丢失。
 * （不依赖任何具体 bug 编号：只依赖「模块顶层求值抛错 ⇒ internal 回落」这条
 * 引擎契约。）
 */
const MODULE_EVAL_FAILS = `export const boom = undefined();

export function add(a, b) {
  return a + b;
}
`;

/** 能力边界回落（`unsupported:*`）：TS namespace 不 lowering ⇒ 回落但**不是**引擎缺陷。 */
const UNSUPPORTED_ONLY = `export namespace N {
  export const a = 1;
}

export function add(a, b) {
  return a + b;
}
`;

/** 程序自身抛（`module-throw`）：catch 可吸收 ⇒ 既有口径**不是**闸门失败。 */
const MODULE_THROWS = `export const boom = null.missing;

export function add(a, b) {
  return a + b;
}
`;

/** 干净文件：零回落。 */
const CLEAN = `export function add(a, b) {
  return a + b;
}
`;

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
});

describe("1145 · service 观测面：模块级求值失败按文件可见", () => {
  it("模块级求值失败 ⇒ 观测面看见该文件的 module-throw 回落（装载期逃逸）；假红防线：unsupported:* 回落**不**进失败信号；假红防线：module-throw（程序自身抛）**不**进失败信号；干净文件 ⇒ 零回落（不得凭空造失败）", () => {
(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpProject("nudo-1145-fail-");
    const file = `${dir}/boom.js`;
    const { evalFailures } = analyzeFileWithEvalFailures(file, MODULE_EVAL_FAILS);
    expect(evalFailures.length).toBeGreaterThan(0);
    // **重钉（§修复方向：用户代码抛出的原生异常归 `module-throw`，
    // 不再算引擎缺陷；§修复方向：「模块未分析 ⇒ 不得给绿灯」）**：
    // 模块体里的原生异常（这里 `undefined()` ⇒ TypeError）是**用户代码自身
    // 抛**，标签由 `internal` 改为 `module-throw`（不是引擎缺陷 ⇒ 不该报
    // 「engine bug」）。
    // **可见性不变**（1145 / 的契约）：装载期逃逸 ⇒ 该模块装载失败
    // （导出全丢）⇒ 闸门无法裁决该文件 ⇒ 仍进失败信号（fail-closed）。
    expect(evalFailures.every((f) => f.reason === "module-throw")).toBe(true);
    // 失败信号必须**能定位到文件**
    expect(evalFailures.every((f) => f.file === file)).toBe(true);
    expect(evalFailures[0]!.message.length).toBeGreaterThan(0);
  })();
(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpProject("nudo-1145-unsupported-");
    const file = `${dir}/unsupported.ts`;
    const { evalFailures } = analyzeFileWithEvalFailures(file, UNSUPPORTED_ONLY);
    expect(evalFailures).toEqual([]);
  })();
(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpProject("nudo-1145-throw-");
    const file = `${dir}/throw.js`;
    const { evalFailures } = analyzeFileWithEvalFailures(file, MODULE_THROWS);
    expect(evalFailures).toEqual([]);
  })();
(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpProject("nudo-1145-clean-");
    const file = `${dir}/clean.js`;
    const { analysis, evalFailures } = analyzeFileWithEvalFailures(file, CLEAN);
    expect(evalFailures).toEqual([]);
    expect(analysis.functions.map((f) => f.name)).toContain("add");
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 静态字段不是方法
// ---------------------------------------------------------------------------
describe("静态字段不是方法", () => {
/**
 * 回归：**类的静态字段**不得被当成方法收进函数表。
 *
 * 改前 kind 过滤写成 `m.kind !== undefined && m.kind !== "method"`，而 Babel 的
 * 类字段节点是 `ClassProperty`（**没有** `kind` 字段）⇒ 过滤放行 ⇒ `K.s`
 * 成为一个「函数」⇒ dts 面渲染成实例方法、check 面对不上、运行时不符。
 */






const SRC = `export class K {
  static s = 1;
  static m() { return 2; }
  instance() { return 3; }
}
`;

describe("静态字段不是方法", () => {
  it("静态方法进函数表，静态字段不进", () => {
    const names = withTmpProject("nudo-139-", (dir) => {
      const file = writeTmpFile(dir, "k.js", SRC);
      return collectTopLevelFunctions(parse(readFileSync(file, "utf-8"))).map((f) => f.name);
    });
    expect(names).toContain("K.m");
    expect(names).toContain("K.instance");
    expect(names).not.toContain("K.s");
  });
});
});

// ---------------------------------------------------------------------------
// 匿名 default class 可见
// ---------------------------------------------------------------------------
describe("匿名 default class 可见", () => {
/**
 * 回归：**匿名** `export default class { … }` 必须进导出表。
 *
 * 改前两个分支都落空（无 id ⇒ 不是 `ClassDeclaration && defaultClassName`；
 * `asIdentifier(d)` 也不是 Identifier）⇒ `continue` 彻底丢掉 ⇒ 四面全盲、
 * 零产物（消费端 TS2307）。
 */






const SRC = `export default class {
  run(x) { return x + 1; }
}
`;

describe("匿名 default class 可见", () => {
  it("成员按导出槽名 `default` 登记（不再被整体丢弃）；对照组：具名 default class 仍按本地名登记（口径不变）", () => {
(() => {

    const names = withTmpProject("nudo-152-", (dir) => {
      const file = writeTmpFile(dir, "anon.js", SRC);
      return collectTopLevelFunctions(parse(readFileSync(file, "utf-8"))).map((f) => f.name);
    });
    expect(names).toContain("default.run");
  })();
(() => {

    const names = withTmpProject("nudo-152-named-", (dir) => {
      const file = writeTmpFile(dir, "named.js", `export default class Foo {\n  run() { return 1; }\n}\n`);
      return collectTopLevelFunctions(parse(readFileSync(file, "utf-8"))).map((f) => f.name);
    });
    expect(names).toContain("Foo.run");
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// 精确 null 字面量不判「推不出来」
// ---------------------------------------------------------------------------
describe("精确 null 字面量不判「推不出来」", () => {
/**
 * 回归：精确推出的 `null` / `undefined` 字面量**不是**「引擎推不出」。
 *
 * 改前第三态判据只看 `shape.k === "unknown"`，而 `null` / `undefined` 字面量的
 * Abs 正是 `shape.k === "unknown"` + `term = lit(null|undefined)` +
 * `conf === "exact"` ⇒ 精确值被误判成推导失败，与 `--json` 面（`conf=exact`）
 * 和 check 签名面（`=> null`）三面互斥。
 */







type Report = ReturnType<typeof buildTestReport>;

function reportOf(src: string): Report {
  return withTmpProject("nudo-b205-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    return buildTestReport(file, analyzeFile_____analyzer_ts(file, readFileSync(file, "utf-8"))!);
  });
}

const NULL_CASE = `/**
 * @nudo:case "null" () => lit(null)
 */
export function f() {
  return null;
}
`;

/** 求值器不支持的表达式 ⇒ 实测 Abs 是真 unknown（对照组）。 */
const UNKNOWN_CASE = `/**
 * @nudo:case "u" () => number()
 */
export function g(o) {
  const x = { a: 1 };
  (x.get)().a ||= 2;
  return x.a;
}
`;

describe("精确 null 字面量不判「推不出来」", () => {
  it("`=> lit(null)` 的精确结果被判定（不是 unchecked）；判据本体的对照组：真 unknown ⇒ 仍是推导失败；inferenceFailed：lit null/undefined ⇒ false；无 term 的 unknown ⇒ true", () => {
(() => {

    const r = reportOf(NULL_CASE);
    const o = r.outcomes.find((x) => x.caseName === "null")!;
    expect(o.unchecked).toBe(false);
    expect(o.ok).toBe(true);
    expect(o.actual).toBe("null");
  })();
(() => {

    const r = reportOf(UNKNOWN_CASE);
    const o = r.outcomes.find((x) => x.caseName === "u")!;
    expect(o.unchecked).toBe(true);
    expect(o.uncheckedReason).toBe("inference-failed");
  })();
(() => {

    expect(inferenceFailed({ shape: { k: "unknown" }, term: { op: "lit", value: null }, conf: "exact" } as never)).toBe(false);
    expect(inferenceFailed({ shape: { k: "unknown" }, term: { op: "lit", value: undefined }, conf: "exact" } as never)).toBe(false);
    expect(inferenceFailed({ shape: { k: "unknown" }, conf: "exact" } as never)).toBe(true);
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// never 期望 vs never 实测
// ---------------------------------------------------------------------------
describe("never 期望 vs never 实测", () => {
/**
 * 回归：实测 `never` 配期望 `never` 时 `never ⊑ never` 成立 ⇒
 * 断言必须可判 **ok**。
 *
 * 改前守卫无条件拒绝（`if (actual.shape.k === "never") return false;`）⇒ 报告
 * 印出两个相同的 `never` 却判 `[FAIL]`，诊断文案写成
 * 「expected never, got never」——报告 / 诊断 / 判定三者自相矛盾。
 *
 * ⚠ 不得回归：实测 never + 期望**不是** never ⇒ 仍不得判 ok。
 */









const THROWING = `/**
 * @nudo:case "never" () => never
 */
export function boom() {
  throw new Error("x");
}
`;

describe("never 期望 vs never 实测", () => {
  it("判定层：never 配 never ⇒ 满足（Bug 649 不回归：配 number() ⇒ 不满足）；分析面：抛错函数 + `=> never` ⇒ 不再发 nudo:case-expected（报告与判定不再自相矛盾）；分析面对照组：抛错函数 + `=> number()` ⇒ 仍报 nudo:case-expected（Bug 649 不回归）", () => {
(() => {

    expect(caseExpectedSatisfied(neverAbs, parseCaseArgExpr("never"))).toBe(true);
    expect(caseExpectedSatisfied(neverAbs, parseCaseArgExpr("number()"))).toBe(false);
    expect(caseExpectedSatisfied(numLit(1), neverAbs)).toBe(false);
  })();
(() => {

    const diags = withTmpProject("nudo-b206-", (dir) => {
      const file = writeTmpFile(dir, "f.js", THROWING);
      return analyzeFile_____analyzer_ts_1(file, readFileSync(file, "utf-8"))!.diagnostics;
    });
    expect(diags.filter((d) => d.code === "nudo:case-expected")).toHaveLength(0);
  })();
(() => {

    const src = THROWING.replace("=> never", "=> number()");
    const diags = withTmpProject("nudo-b206-neg-", (dir) => {
      const file = writeTmpFile(dir, "f.js", src);
      return analyzeFile_____analyzer_ts_1(file, readFileSync(file, "utf-8"))!.diagnostics;
    });
    expect(diags.filter((d) => d.code === "nudo:case-expected")).toHaveLength(1);
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 嵌套槽谓词执法 + 渲染
// ---------------------------------------------------------------------------
describe("嵌套槽谓词执法 + 渲染", () => {
/**
 * 回归：**嵌套**值级谓词（`shape({ n: number().gt(0) })`）必须与
 * 顶层写法（`number().gt(0)`）**同结论、同可读性**。
 *
 * 改前：顶层谓词才走值级判定与渲染 ⇒ 同一谓词放槽里既不执法（`[FAIL]`）
 * 也不显示（报告只印 `{ n: number }`），报告看上去 expected/actual 一致却判红。
 */




const nestedExpected = () => parseCaseArgExpr("shape({ n: number().gt(0) })");
const topExpected = () => parseCaseArgExpr("number().gt(0)");

describe("嵌套槽谓词执法 + 渲染", () => {
  it("槽谓词满足 ⇒ 判 ok（与顶层写法一致）；槽谓词不满足 ⇒ 判不满足（与顶层写法一致）；期望文本递归渲染槽谓词（不再是 `{ n: number }`）；无槽谓词时渲染逐字不变（不引入噪音）", () => {
(() => {

    expect(caseExpectedSatisfied(parseCaseArgExpr("{ n: 3 }"), nestedExpected())).toBe(true);
    expect(caseExpectedSatisfied(parseCaseArgExpr("3"), topExpected())).toBe(true);
  })();
(() => {

    expect(caseExpectedSatisfied(parseCaseArgExpr("{ n: -1 }"), nestedExpected())).toBe(false);
    expect(caseExpectedSatisfied(parseCaseArgExpr("-1"), topExpected())).toBe(false);
  })();
(() => {

    const text = formatExpected(nestedExpected());
    expect(text).toContain("n: number");
    expect(text).toContain("> 0");
  })();
(() => {

    expect(formatExpected(parseCaseArgExpr("shape({ n: number() })"))).toBe("{ n: number }");
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 派生分支的 .nudo.ts 必须带 builder 声明头
// ---------------------------------------------------------------------------
describe("派生分支的 .nudo.ts 必须带 builder 声明头", () => {
/**
 * `nudo contract --emit` 的**派生分支**写 `.nudo.ts` 侧车时
 * **不补 builder 类型声明** ⇒ 产物里 `fn` 是未声明标识符 ⇒ `tsc` **TS2304**；
 * 而主分支（`contract-emitter.ts`）的 `.nudo.ts` 有 `declare const fn: …`
 * ⇒ 同一命令、同一个侧车扩展名，两个分支两个结论。
 *
 * 修法：派生分支写盘前按主分支**同款算法**（`CONSTRAINT_BUILDER_NAMES` +
 * `coreExportNameOf`）补声明头；`.js` 侧车不加（裸注入已够）。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-266-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("派生分支的 .nudo.ts 必须带 builder 声明头", () => {
  it("下游是 .ts ⇒ 派生产物补 `declare const fn: …`；对照组：.js 侧车不加 declare（裸注入已够）", () => {
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-266-"));


    writeFileSync(
      join(dir, "add.ts"),
      `export function add2(x) {\n  return x + 2;\n}\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib.js"),
      `import { add2 } from "./add.ts";\n\nexport function add4(x) {\n  return add2(x + 1) + 1;\n}\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "std.nudo.js"),
      `import { number } from "@nudojs/core";\nexport const positive = number().ge(0);\nexport const positive4 = number().ge(4);\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn } from "@nudojs/core";\nimport { positive, positive4 } from "./std.nudo.js";\n\nexport const add4 = fn({ x: positive }, positive4);\n`,
      "utf-8",
    );

    const r = emitDerivedFromRoot(join(dir, "lib.js"), {
      mode: "update",
      fnNames: ["add2"],
    });
    expect(r.hasRoot).toBe(true);

    const sidecar = join(dir, "add.nudo.ts");
    const after = readFileSync(sidecar, "utf-8");
    // 产物会被 tsc 编译 ⇒ builder 标识符必须已声明（否则 TS2304）
    expect(after).toContain(`declare const fn: typeof import("@nudojs/core").fn;`);
    expect(after).toContain("export const add2 = fn(");
  })();
(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-266-"));


    writeFileSync(join(dir, "add2.js"), `export function add2b(x) {\n  return x + 2;\n}\n`, "utf-8");
    writeFileSync(
      join(dir, "lib2.js"),
      `import { add2b } from "./add2.js";\n\nexport function add4b(x) {\n  return add2b(x + 1) + 1;\n}\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "std2.nudo.js"),
      `import { number } from "@nudojs/core";\nexport const positive = number().ge(0);\nexport const positive4 = number().ge(4);\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib2.nudo.js"),
      `import { fn } from "@nudojs/core";\nimport { positive, positive4 } from "./std2.nudo.js";\n\nexport const add4b = fn({ x: positive }, positive4);\n`,
      "utf-8",
    );

    const r = emitDerivedFromRoot(join(dir, "lib2.js"), { mode: "update", fnNames: ["add2b"] });
    expect(r.hasRoot).toBe(true);
    const after = readFileSync(join(dir, "add2.nudo.js"), "utf-8");
    expect(after).not.toContain("declare const");
    expect(after).toContain("export const add2b = fn(");
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// export * 同名冲突是歧义导出（不可用）
// ---------------------------------------------------------------------------
describe("export * 同名冲突是歧义导出（不可用）", () => {
/**
 * 回归：相对 `export *` 的**同名冲突**是 ESM 的**歧义导出**——按规范
 * 该名**不导出**，宿主的导入方在链接期
 * `SyntaxError: contains conflicting star exports for name 'x'`。
 *
 * 改前引擎按源序后者覆盖 ⇒ 门禁判绿并印出宿主**不可能产出**的确定字面量，
 * 且只换两行 `export *` 顺序结论就翻转。
 */






function setup(cBody: string, files: Record<string, string> = {}) {
  const entry = 'import { x } from "./c.mjs";\nexport function use() { return x; }\n';
  const dir = tmpProject("nudo-269-", {
    "a.mjs": "export const x = 1;\n",
    "b.mjs": "export const x = 2;\n",
    "c.mjs": cBody,
    "d.mjs": entry,
    ...files,
  });
  const entryFile = join(dir, "d.mjs");
  const graph = evalAbsModuleGraph(entry, entryFile, {});
  return { dir, graph };
}

const issuesOf = (g: ReturnType<typeof setup>["graph"]) =>
  g.issues.filter((i) => i.kind === "missing-export").map((i) => i.label);

beforeEach(() => {
  clearAbsModuleCache();
});

describe("export * 同名冲突是歧义导出（不可用）", () => {
  it("两个星号导出同名 ⇒ 该名不导出（导入方报缺名），顺序无关；对照组：本地导出遮蔽星号导出 ⇒ x 存在且值取自本地（不是歧义）；定义位点解析同口径：歧义名解析不出（不得给一个确定定义模块）；定义位点对照：非歧义星号导出照常解析到定义模块", () => {
(() => {
  clearAbsModuleCache();


    for (const cBody of [
      'export * from "./a.mjs";\nexport * from "./b.mjs";\n',
      'export * from "./b.mjs";\nexport * from "./a.mjs";\n',
    ]) {
      const { graph } = setup(cBody);
      const c = graph.modules["./c.mjs"];
      expect(c).toBeDefined();
      expect(Object.hasOwn(c!.named, "x")).toBe(false);
      expect(issuesOf(graph)).toContain("./c.mjs#x");
    }
  })();
(() => {
  clearAbsModuleCache();


    const { graph } = setup(
      'export * from "./a.mjs";\nexport * from "./b.mjs";\nexport const x = 3;\n',
    );
    const c = graph.modules["./c.mjs"];
    expect(Object.hasOwn(c!.named, "x")).toBe(true);
    expect(issuesOf(graph)).not.toContain("./c.mjs#x");
  })();
(() => {
  clearAbsModuleCache();


    const dir = setup('export * from "./a.mjs";\nexport * from "./b.mjs";\n').dir;
    expect(resolveExportSite(join(dir, "c.mjs"), "x")).toBeUndefined();
  })();
(() => {
  clearAbsModuleCache();


    const dir = setup('export * from "./a.mjs";\n').dir;
    expect(resolveExportSite(join(dir, "c.mjs"), "x")?.modulePath).toBe(join(dir, "a.mjs"));
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 跨模块 fn 形参面（声明形参，非假名）
// ---------------------------------------------------------------------------
describe("跨模块 fn 形参面（声明形参，非假名）", () => {
/**
 * ：跨模块导出的 fn 形参面——
 * - 463：`export function` 的形参名显示成合成假名 `arg0/arg1`（源码里没有的名字）；
 * - 483：带默认值 / rest 的形参**个数**被吞（用运行期 `Function.length` 当声明形参数）；
 * - 484：带默认值的形参名整个丢失（`b = 2` 的真名 b 不认 → 显示 arg1）。
 *
 * 原生 oracle：声明形参是源码里的名字与个数（`export function f(a, b = 2)` 声明 2 个形参，
 * a / b；`function.length` 按规范不计带默认值 / rest 的形参 ⇒ 不能当声明形参数用）。
 */







const SRC = `export function expDefault(a, b = 2) { return a + b; }
export function expPlain(a, b) { return a + b; }
export function restExp(a, ...more) { return a; }
export function expNamed(alpha, beta) { return alpha + beta; }
function plainDefault(a, b = 2) { return a + b; }
export const arrowDefault = (a, b = 2) => a + b;
export { plainDefault as aliasedDefault };
`;

/** 导出名 → 声明形参名（经模块图桥接的 fn Abs） */
function paramsOf(src: string, dir: string): Map<string, string[]> {
  const file = join(dir, "main.js");
  clearAbsModuleCache();
  const graph = evalAbsModuleGraph(src, file);
  const run = runTranspiled(src, { mode: "analyze", modules: graph.modules as never });
  const exports = evalExportsToModuleExports(run, parse(src), "test");
  const out = new Map<string, string[]>();
  for (const [name, v] of Object.entries(exports.named)) {
    const shape = v.shape as { k?: string; params?: string[] };
    if (shape.k === "fn") out.set(name, shape.params ?? []);
  }
  return out;
}

describe("跨模块 fn 形参面（声明形参，非假名）", () => {
  it("export function 的形参用源码真名（改前：arg0/arg1）；带默认值的形参：名字与个数都在（改前：arg0 一个 / arg1 假名）；rest 形参计入声明形参数并保留 ... 形态（改前：只剩 1 个）；负控制：箭头 const 导出的形参面不变", () => {
(() => {

    const dir = makeTmpProject("nudo-b463-", { "main.js": SRC });
    const params = paramsOf(SRC, dir);
    expect(params.get("expPlain")).toEqual(["a", "b"]);
    expect(params.get("expNamed")).toEqual(["alpha", "beta"]);
  })();
(() => {

    const dir = makeTmpProject("nudo-b463-", { "main.js": SRC });
    const params = paramsOf(SRC, dir);
    expect(params.get("expDefault")).toEqual(["a", "b"]);
    // plainDefault 是私有本地绑定（仅经别名 aliasedDefault 导出）——不得
    // 作为独立导出名出现；别名槽仍保留声明形参真名。
    expect(params.get("plainDefault")).toBeUndefined();
    expect(params.get("aliasedDefault")).toEqual(["a", "b"]);
  })();
(() => {

    const dir = makeTmpProject("nudo-b463-", { "main.js": SRC });
    const params = paramsOf(SRC, dir);
    expect(params.get("restExp")).toEqual(["a", "...more"]);
  })();
(() => {

    const dir = makeTmpProject("nudo-b463-", { "main.js": SRC });
    const params = paramsOf(SRC, dir);
    expect(params.get("arrowDefault")).toEqual(["a", "b"]);
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// export const/let/var f = fn 进普查
// ---------------------------------------------------------------------------
describe("export const/let/var f = fn 进普查", () => {
/**
 * 回归钉 —— service 面**顶层函数普查**
 * （`collectTopLevelFunctions`）的导出形态覆盖 + 入口求值的**导出槽**解析。
 *
 * 三条同源：service 面的普查比 core 面（`listTopFunctions`）窄 ⇒
 * `nudo check` 看得见的函数，`nudo test` / `export` / `contract` / `health`
 * 看不见（或看不见返回值）——两个面互相矛盾。
 *
 * 469：`export const f = fn` —— ExportNamedDeclaration 分支只收
 * FunctionDeclaration，不收 VariableDeclaration 的声明符 ⇒ 普查 0 项。
 * 489：`export default function f` —— 普查按**局部名** f 登记，但模块的
 * 导出键是 `default`（f 只是模块内局部名）⇒ 入口求值按导出表键查表
 * 落空 ⇒ 签名退 `unknown`。
 * 995：`module.exports = { f: fn }` —— 普查不下钻对象字面量 ⇒ 成员函数
 * 不可见。
 *
 * 原生 oracle（node）：
 * export const f = () => 1 → 具名导入后 f() === 1
 * export default function f() → 默认导入后 f() === 1
 * module.exports = { f: fn } → require(...).f() === 1
 */








beforeEach(() => {
  resetAllAnalysisCaches();
});

/** 普查名（service 面） */
const censusNames = (source: string): string[] =>
  collectTopLevelFunctions(parse(source)).map((r) => r.name);

/** 普查名 + 导出槽（assignedName；无则空串） */
const censusSlots = (source: string): string[] =>
  collectTopLevelFunctions(parse(source)).map((r) => `${r.name}@${r.assignedName ?? ""}`);

/** 分析面（test / export / contract 共用）里的函数名 */
const analysisNames = (source: string, file = "/test/census.js"): string[] =>
  analyzeFile_____analyzer_ts_2(file, source).functions.map((f) => f.name);

describe("export const/let/var f = fn 进普查", () => {
  it("export const 箭头 / 函数表达式都进普查（普查名 = 导出槽名）；多声明符逐个收（不只首个）；非函数初始化不进普查；分析面看得见该函数，且入口求值拿到返回值", () => {
(() => {
  resetAllAnalysisCaches();


    expect(censusNames("export const f = () => 1;")).toEqual(["f"]);
    expect(censusNames("export const f = function () { return 1; };")).toEqual(["f"]);
    expect(censusNames("export let f = () => 1;")).toEqual(["f"]);
    expect(censusNames("export var f = () => 1;")).toEqual(["f"]);
  })();
(() => {
  resetAllAnalysisCaches();


    expect(censusNames("export const a = () => 1, b = () => 2;")).toEqual(["a", "b"]);
  })();
(() => {
  resetAllAnalysisCaches();


    expect(censusNames("export const x = 1;")).toEqual([]);
  })();
(() => {
  resetAllAnalysisCaches();


    const source = "export const slugify = (s) => String(s).toLowerCase();";
    const result = analyzeFile_____analyzer_ts_2("/test/bug469.js", source);
    expect(result.functions.map((f) => f.name)).toEqual(["slugify"]);
    const entry = result.functions[0]!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    // 原生：slugify("AbC") === "abc"
    expect(formatShape(entry!.abs)).toBe("string");
  })();
});;

  ;

  ;

  ;
});

describe("具名 default 导出按 default 槽回退求值", () => {
  it("普查名 = 局部名，导出槽 = default；入口求值回退到 default 槽 ⇒ 返回值不再是 unknown；匿名 default 导出形态不变（普查名 = default）", () => {
(() => {
  resetAllAnalysisCaches();


    expect(censusSlots("export default function f() { return 1; }")).toEqual(["f@default"]);
  })();
(() => {
  resetAllAnalysisCaches();


    const source = "export default function f() { return 1; }";
    const result = analyzeFile_____analyzer_ts_2("/test/bug489.js", source);
    expect(result.functions.map((f) => f.name)).toEqual(["f"]);
    const entry = result.functions[0]!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    // 原生：默认导入后 f() === 1（退 unknown 即查表落空）
    expect(formatShape(entry!.abs)).toBe("1");
  })();
(() => {
  resetAllAnalysisCaches();


    expect(censusNames("export default function () { return 1; }")).toEqual(["default"]);
    expect(censusNames("export default () => 1;")).toEqual(["default"]);
  })();
});;

  ;

  ;
});

describe("module.exports = { f: fn } 的成员函数进普查", () => {
  it("对象字面量的成员函数逐个收（key 名 = 导出槽名）；对象方法简写（ObjectMethod）进普查；导出槽名优先于命名函数表达式的自有 id（Bug 997，与 core listTopFunctions 同口径）；getter / setter 不是可调用入口，不进普查；非函数成员不进普查；分析面看得见该函数", () => {
(() => {
  resetAllAnalysisCaches();


    expect(censusNames("module.exports = { greet: function () { return 1; } };")).toEqual(["greet"]);
    expect(censusNames("module.exports = { greet: () => 1 };")).toEqual(["greet"]);
    expect(censusNames("module.exports = { greet: async function () { return 1; } };")).toEqual(["greet"]);
  })();
(() => {
  resetAllAnalysisCaches();


    expect(censusNames("module.exports = { greet() { return 1; } };")).toEqual(["greet"]);
  })();
(() => {
  resetAllAnalysisCaches();


    // 普查名取**导出槽名**（greet）——内层函数 id（named）不是导出槽名，
    // 取它会让侧车契约整个不绑定 + 签名表里导出符号消失。
    expect(censusNames("module.exports = { greet: function named() { return 1; } };")).toEqual([
      "greet",
    ]);
    // 回退名（entry@ 求值用）仍是内层函数 id
    expect(censusSlots("module.exports = { greet: function named() { return 1; } };")).toEqual([
      "greet@named",
    ]);
  })();
(() => {
  resetAllAnalysisCaches();


    expect(censusNames("module.exports = { get g() { return 1; } };")).toEqual([]);
    expect(censusNames("module.exports = { set s(v) {} };")).toEqual([]);
  })();
(() => {
  resetAllAnalysisCaches();


    expect(censusNames("module.exports = { x: 1 };")).toEqual([]);
  })();
(() => {
  resetAllAnalysisCaches();


    const source = 'module.exports = { greet: function (name) { return "hi " + name; } };';
    const result = analyzeFile_____analyzer_ts_2("/test/bug995.js", source);
    expect(result.functions.map((f) => f.name)).toEqual(["greet"]);
  })();
});;

  ;

  ;

  ;

  ;

  ;
});

describe("普查口径与 core listTopFunctions 对齐（check 面不与 service 面打架）", () => {
  const fixtures: Record<string, string> = {
    "fn 声明": "function f() { return 1; }",
    "const 箭头": "const f = () => 1;",
    "具名导出": "export function f() { return 1; }",
    "导出 const 箭头": "export const f = () => 1;",
    "导出 const 函数表达式": "export const f = function () { return 1; };",
    "导出 let": "export let f = () => 1;",
    "导出 var": "export var f = () => 1;",
    "导出多声明符": "export const a = () => 1, b = () => 2;",
    "具名 default": "export default function f() { return 1; }",
    "匿名 default": "export default function () { return 1; }",
    "default 箭头": "export default () => 1;",
    "CJS exports.f": "exports.f = function () { return 1; };",
    "CJS module.exports.f": "module.exports.f = function () { return 1; };",
    "CJS 对象字面量": "module.exports = { f: function () { return 1; } };",
    "CJS 对象字面量（具名函数表达式）": "module.exports = { f: function named() { return 1; } };",
    "CJS 对象字面量（箭头）": "module.exports = { f: () => 1 };",
    "CJS 对象方法": "module.exports = { f() { return 1; } };",
    "导出 class": "export class C { m() { return 1; } }",
    "default class": "export default class C { m() { return 1; } }",
  };

  for (const [label, source] of Object.entries(fixtures)) {
    it(`${label}：两面普查名一致`, () => {
      expect(censusNames(source).sort()).toEqual([...listTopFunctions(source)].sort());
    });
  }

  it("getter 形态：两面都不收（Bug 996 已收口）；匿名 module.exports = fn：两面都按 default 登记（Bug 6 后 core 侧不再漏）", () => {
(() => {
  resetAllAnalysisCaches();


    // core scan-top-functions.ts 的 ObjectMethod 分支已按 kind 过滤
    // （getter/setter 不是可调用入口）⇒ 两面口径一致（无差异）。
    expect(listTopFunctions("module.exports = { get g() { return 1; } };")).toEqual([]);
    expect(censusNames("module.exports = { get g() { return 1; } };")).toEqual([]);
  })();
(() => {
  resetAllAnalysisCaches();


    // CJS 默认导出形态（`module.exports = fn`）此前不在 L2 入口表 ⇒
    // 假绿。修复后 core 普查面与 service 面同口径登记 `default`。
    expect(censusNames("module.exports = function () { return 1; };")).toEqual(["default"]);
    expect(listTopFunctions("module.exports = function () { return 1; };")).toEqual(["default"]);
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// 注入表解析入口
// ---------------------------------------------------------------------------
describe("注入表解析入口", () => {
/**
 * 依赖模块里的行内指令（@nudo:as / @nudo:replace）注入。
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







const DEP_JS = `// @nudo:as shape({ port: number() })
const cfg = JSON.parse("{}");
export function getCfg() { return cfg; }
`;

describe("注入表解析入口", () => {
  it("带指令的源码解析出注入包（as 目标 + 覆盖值）；无指令的源码不产生注入包；注入包与收集器同源（目标区间一致）", () => {
(() => {

    const inj = resolveEvalInjection_____eval_run_ts(DEP_JS);
    expect(inj).toBeDefined();
    expect(inj?.asOverrideTargets?.length).toBe(1);
    expect(inj?.asOverrides).toBeDefined();
  })();
(() => {

    expect(resolveEvalInjection_____eval_run_ts("export function f() { return 1; }\n")).toBeUndefined();
  })();
(() => {

    const reps = collectEvalReplacements_____eval_run_ts(DEP_JS);
    const inj = resolveEvalInjection_____eval_run_ts(DEP_JS);
    expect(inj?.asOverrideTargets).toEqual(reps.asTargets);
  })();
});;

  ;

  ;
});

describe("根侧注入不受影响", () => {
  it("作为根分析时，@nudo:as 覆盖承载语句的值", () => {
    const dir = tmpProject("nudo-bug473-root-");
    const source = `/// @nudo:env es

export function f() {
  // @nudo:as number()
  const y = "hello";
  return y;
}
`;
    const result = analyzeFile_____analyzer_ts_3(join(dir, "root.js"), source);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe("number");
  });
});

describe("依赖侧注入（接线后转绿）", () => {
  it("依赖模块里的 @nudo:as 生效（依赖侧接线后转绿）", () => {
    const dir = tmpProject("nudo-bug473-dep-", {
      "dep.js": DEP_JS,
      "main.js": `import { getCfg } from "./dep.js";
export function call() { return getCfg(); }
`,
    });
    const result = analyzeFile_____analyzer_ts_3(join(dir, "main.js"), `import { getCfg } from "./dep.js";
export function call() { return getCfg(); }
`);
    const fn = result.functions.find((f) => f.name === "call");
    // 期望：{ port: number }（依赖模块的指令生效）
    expect(formatShape(fn?.cases[0].abs as never)).toBe("{ port: number }");
  });
});
});

// ---------------------------------------------------------------------------
// 跨模块活绑定（依赖内部变异对导入方可见）
// ---------------------------------------------------------------------------
describe("跨模块活绑定（依赖内部变异对导入方可见）", () => {
/**
 * 跨模块**活绑定**在 service 合并面被快照化。
 *
 * 改前：`mergeHarvestUnderEnv` 用对象展开搬运导出表（`{ ...exports.named }`）
 * ⇒ **求值**了依赖模块导出槽上的活 getter ⇒ 冻结成快照 ⇒ 依赖模块的内部
 * 变异对导入方不可见。
 *
 * 原生真值（真实 JS）：
 * m.js: `export let val = 0; export function setStr() { val = "hello"; }`
 * entry: `import { val, setStr } from "./m.js";
 * export function get() { setStr(); return val; }` → "hello"
 * 引擎改前给 0（快照）⇒ 类型面与原生不一致。
 */






const M_JS = `export let val = 0;
export function setStr() { val = "hello"; }
`;

function entryShape(files: Record<string, string>, entry: string): string {
  const dir = tmpProject("nudo-bug476-", files);
  const result = analyzeFile_____analyzer_ts_4(join(dir, entry), files[entry]);
  const fn = result.functions.find((f) => f.name === "get");
  return fn ? formatShape(fn.cases[0].abs) : "<no-fn>";
}

describe("跨模块活绑定（依赖内部变异对导入方可见）", () => {
  it("依赖模块内部改写导出值后，导入方读到当前值；变异前的读取仍是精确初值（不被前一次调用的残留污染）", () => {
(() => {

    const shape = entryShape(
      { "m.js": M_JS, "entry.js": `import { val, setStr } from "./m.js";
export function get() { setStr(); return val; }
` },
      "entry.js",
    );
    // 改前：0（合并面把活 getter 求值成了快照）
    expect(shape).toBe('"hello"');
  })();
(() => {

    const shape = entryShape(
      { "m.js": M_JS, "entry.js": `import { val } from "./m.js";
export function get() { return val; }
` },
      "entry.js",
    );
    expect(shape).toBe("0");
  })();
});;

  ;
});

/** 负控制：不该被这条修复波及的邻近形态 */
describe("负控制", () => {
  it("依赖未改写导出值时，导入方读到初值；同文件内的模块级状态读写不受影响", () => {
(() => {

    const shape = entryShape(
      { "m.js": M_JS, "entry.js": `import { val, setStr } from "./m.js";
export function get() { return val; }
` },
      "entry.js",
    );
    expect(shape).toBe("0");
  })();
(() => {

    const dir = tmpProject("nudo-bug476-neg-");
    const source = `let n = 0;
export function bump() { n = n + 1; return n; }
export function read() { return n; }
`;
    const result = analyzeFile_____analyzer_ts_4(join(dir, "same.js"), source);
    const bump = result.functions.find((f) => f.name === "bump");
    const read = result.functions.find((f) => f.name === "read");
    expect(bump ? formatShape(bump.cases[0].abs) : "").toBe("1");
    expect(read ? formatShape(read.cases[0].abs) : "").toBe("0");
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// .ts 形参类型注解进入推断（缺口已闭合）
// ---------------------------------------------------------------------------
describe(".ts 形参类型注解进入推断（缺口已闭合）", () => {
/**
 * `.ts` 源的**形参类型注解**从未进入推断（回归钉 + 缺口论证）。
 *
 * 报告定位（`tmp/bugs/14-service-eval.md` ）：「`analyzer-ast.ts:45-64`
 * 的 `extractParamNames` **只取形参名**，**完全丢弃 TypeScript 类型注解**」。
 *
 * ── 根因更正（本轮实测，报告的文件定位有误）────────────────────────────
 * **不是** service 侧「只取名字」，而是**解析层就把注解删掉了**：
 * - Babel（`@babel/parser` + TypeScript 插件）**确实**解析出注解——
 * `parseSource(src, { keepTs: true })` 的 AST 上有
 * `param.typeAnnotation` / `fn.returnType`（探针：
 * `tmp/probe/fix-r24-e/b479-parse.ts`）；
 * - 但**分析面走的默认路径会剥除**：`packages/core/src/algebra/parse-source.ts:42`
 * → `stripTypes(ast)` → `packages/core/src/strip-types.ts:173,175`
 * **delete 掉 `typeAnnotation` / `returnType`**。
 * ⇒ service（`packages/service/src/analyzer-orchestrate-uncached.ts:132`
 * `parse(source)`）与 core check 面拿到的 AST **本来就没有注解**——
 * `extractParamNames` 即便想读也读不到。
 *
 * ── 修法边界（**已闭合**，2026-10-21 接线片）──────────────────────────────
 * 注解要进推断，至少要动四处：
 * 1. `packages/core/src/algebra/parse-source.ts` / `strip-types.ts`
 * —— 分析面保留**类型注解文本**（旁路 `nudoTypeText` / `nudoReturnTypeText`）
 * ✅ 已由 core 侧完成；
 * 2. `packages/service/src/analyzer-orchestrate-uncached-cases.ts`
 * —— 入口实参按声明类型构造 Abs ✅ **本接线片完成**
 * （`tsAnnotationArgAbs(f.tsType)`；不可映射的类型仍回落 any）；
 * 3. `packages/service/src/emit/dts-generator.ts` —— dts 面优先用注解
 * ✅ **本接线片完成**（声明位优先级：手写契约 > TS 注解 > case 观测值）；
 * 4. `packages/core/src/algebra/generalize.ts`（check 面的入口形参类型）
 * ✅ 已由 core 侧完成（`absShapeForTsTypeText`）。
 *
 * 本文件的三条 todo 已随缺口闭合转为**实断言**；负控制（`.js` 同形源行为
 * 不变）保留。**更完整的回归钉**（entry@ 实参 / dts 形参 / 契约优先级）见
 * `service--ts-annotation-entry-and-dts.part.ts`。
 */







beforeEach(() => {
  resetAllAnalysisCaches();
});

const TS_SOURCE = `export function upper(a: string): string {
  return a.toUpperCase();
}
`;

const JS_SOURCE = `export function upper(a) {
  return a.toUpperCase();
}
`;

describe(".ts 形参类型注解进入推断（缺口已闭合）", () => {
  it("原生：upper(a: string) 的 a 按 string 推断（形参注解进入推断）；原生：.ts 的合法代码不再触发 nudo:entry-may-throw 假红（a 是 string，toUpperCase 不会抛）；原生：dts 面保留源里的类型注解（export declare function upper(a: string)）；负控制：.ts 源仍被正常分析（函数可见、body 仍求值）；负控制：同形 .js 源的形参仍是无约束 any（无注解可读，行为不", () => {
(() => {
  resetAllAnalysisCaches();


    const result = analyzeFile_____analyzer_ts_5("/test/bug479.ts", TS_SOURCE);
    const entry = result.functions[0]!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
    expect(formatShape(entry!.argAbs[0]!)).toBe("string");
  })();
(() => {
  resetAllAnalysisCaches();


    const report = checkSource("/test/bug479.ts", TS_SOURCE, pTrue, {});
    expect(l2Count(report, "upper")).toBe(0);
  })();
(() => {
  resetAllAnalysisCaches();


    const dts = generateDts(analyzeFile_____analyzer_ts_5("/test/bug479.ts", TS_SOURCE));
    expect(dts).toContain("export declare function upper(a: string)");
  })();
(() => {
  resetAllAnalysisCaches();


    const result = analyzeFile_____analyzer_ts_5("/test/bug479.ts", TS_SOURCE);
    expect(result.functions.map((f) => f.name)).toEqual(["upper"]);
    const entry = result.functions[0]!.cases.find((c) => c.name.startsWith("entry@"));
    expect(entry).toBeDefined();
  })();
(() => {
  resetAllAnalysisCaches();


    const result = analyzeFile_____analyzer_ts_5("/test/bug479.js", JS_SOURCE);
    const entry = result.functions.find((f) => f.name === "upper")?.cases.find((c) =>
      c.name.startsWith("entry@"),
    );
    expect(entry).toBeDefined();
    expect(formatShape(entry!.argAbs[0]!)).toBe("any");
  })();
(() => {
  resetAllAnalysisCaches();


    const result = analyzeFile_____analyzer_ts_5("/test/bug479-throws.js", JS_SOURCE);
    const entry = result.functions.find((f) => f.name === "upper")?.cases.find((c) =>
      c.name.startsWith("entry@"),
    );
    expect(entry).toBeDefined();
    expect(formatShape(entry!.throwsAbs)).toContain("TypeError");
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 侧车加载失败 ≠ 没有契约根
// ---------------------------------------------------------------------------
describe("侧车加载失败 ≠ 没有契约根", () => {
/**
 * 侧车（`*.nudo.js`）**加载失败**被误报成「没有契约根」
 * （`nudo:contract-entry-only`）⇒ 事实陈述错误 + 修复建议误导。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts）：用 `effectiveContract(...)`
 * 的返回值是否存在来判定「有没有契约根」——它对「根本没有侧车」与「侧车存在
 * 但加载失败」返回**同一个 undefined**，两者不可区分 ⇒ 必然发「没有契约根」。
 *
 * 修法：把 core 侧 nudo:contract-load 通道的新诊断取进本文件的诊断通道
 * （error），并以「本文件侧车加载失败」粘滞标记抑制那条误导 info。
 *
 * 钉：坏侧车 → 有 nudo:contract-load（error）且**无** nudo:contract-entry-only；
 * 无侧车 → 仍有 nudo:contract-entry-only（负控制）；好侧车 → 两者都无（负控制）。
 */





function codes(result: { diagnostics: readonly { code?: string }[] }): (string | undefined)[] {
  return result.diagnostics.map((d) => d.code);
}

describe("侧车加载失败 ≠ 没有契约根", () => {
  it("坏侧车：报 nudo:contract-load（error），不发 nudo:contract-entry-only；负控制：没有侧车 → 仍报 nudo:contract-entry-only（口径不变）；负控制：好侧车 → 两者都无", () => {
(() => {
return (withTmpProject("nudo-b495-", (dir) => {
      const src = `export function add(a, b) { return a + b; }\n`;
      const file = writeTmpFile(dir, "calc.js", src);
      writeTmpFile(
        dir,
        "calc.nudo.js",
        `import { fn, number } from "@nudojs/core";
export const add = fn({ a: number(
`,
      );
      const result = analyzeFile_____analyzer_ts_6(file, readFileSync(file, "utf-8"));
      expect(codes(result)).toContain("nudo:contract-load");
      expect(codes(result)).not.toContain("nudo:contract-entry-only");
    }));})();
(() => {
return (withTmpProject("nudo-b495b-", (dir) => {
      const src = `export function add(a, b) { return a + b; }\n`;
      const file = writeTmpFile(dir, "calc.js", src);
      const result = analyzeFile_____analyzer_ts_6(file, readFileSync(file, "utf-8"));
      expect(codes(result)).toContain("nudo:contract-entry-only");
      expect(codes(result)).not.toContain("nudo:contract-load");
    }));})();
(() => {
return (withTmpProject("nudo-b495c-", (dir) => {
      const src = `export function add(a, b) { return a + b; }\n`;
      const file = writeTmpFile(dir, "calc.js", src);
      writeTmpFile(
        dir,
        "calc.nudo.js",
        `import { fn, number } from "@nudojs/core";
export const add = fn({ a: number(), b: number() });
`,
      );
      const result = analyzeFile_____analyzer_ts_6(file, readFileSync(file, "utf-8"));
      expect(codes(result)).not.toContain("nudo:contract-entry-only");
      expect(codes(result)).not.toContain("nudo:contract-load");
    }));})();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 不可读依赖：missing 与 unreadable 必须分开
// ---------------------------------------------------------------------------
describe("不可读依赖：missing 与 unreadable 必须分开", () => {
/**
 * 回归：**依赖模块不可读（EACCES）**不得被折叠成「文件不存在」。
 *
 * 本分片在 service 侧提供两件东西（根因行的其余消费点在 core / nudojs 侧，
 * 见交付报告的「越界」段）：
 * - `loadModuleOutcome`：三态结果（ok / missing / unreadable）——模块图侧
 * 据此把「不可读」报成不可读，而不是「Module file not found」。
 * - `guardedLoadModule`：宿主 loader 的容错包装——读失败退化为「该依赖不可用」
 * + 一次性可见告警，**不得让异常穿透到 CLI 顶层**（整轮分析被带走）。
 */







/** root 对 chmod 000 免疫，真实 EACCES 用例无法生效 */
const isRoot = process.geteuid?.() === 0;

describe("不可读依赖：missing 与 unreadable 必须分开", () => {
  it("不存在的依赖 → missing（不是 unreadable）；可读依赖 → ok（路径 + 内容）；guardedLoadModule：loader 抛错 → undefined + 一次性可见告警（不穿透）；负控制：ENOENT 与正常返回不受 guarded 包装影响", () => {
(() => {

    const dir = tmpProject("nudo-499-missing-");
    const from = join(dir, "main.js");
    writeFileSync(from, "", "utf-8");
    expect(loadModuleOutcome("./nope.js", from).kind).toBe("missing");
  })();
(() => {

    const dir = tmpProject("nudo-499-ok-");
    const from = join(dir, "main.js");
    writeFileSync(from, "", "utf-8");
    writeFileSync(join(dir, "dep.js"), "export const x = 1;\n", "utf-8");
    const r = loadModuleOutcome("./dep.js", from);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.content).toContain("export const x");
  })();
(() => {

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dep = "/nudo-499-guarded/dep.js";
    const failures: { path: string; code: string }[] = [];
    const guarded = guardedLoadModule(
      () => {
        throw new ModuleReadError(
          dep,
          Object.assign(new Error(`EACCES: permission denied, open '${dep}'`), { code: "EACCES" }),
        );
      },
      (f) => failures.push({ path: f.path, code: f.code }),
    );
    try {
      expect(guarded("./dep.js", "/nudo-499-guarded/main.js")).toBeUndefined();
      expect(guarded("./dep.js", "/nudo-499-guarded/main.js")).toBeUndefined();
      // 同一路径只告警一次（防刷屏），但失败回调每次都到（供诊断聚合）
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(String(errSpy.mock.calls[0]?.[0])).toContain("EACCES");
      expect(failures.length).toBe(2);
      expect(failures[0]?.path).toBe(dep);
      expect(failures[0]?.code).toBe("EACCES");
    } finally {
      vi.restoreAllMocks();
    }
  })();
(() => {

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const guardedMissing = guardedLoadModule(() => {
        throw new ModuleReadError(
          "/nudo-499-guarded/gone.js",
          Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
        );
      });
      expect(guardedMissing("./gone.js", "/t/main.js")).toBeUndefined();
      const guardedOk = guardedLoadModule(() => "export const x = 1;");
      expect(guardedOk("./dep.js", "/t/main.js")).toBe("export const x = 1;");
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  })();
});;

  ;

  it.runIf(!isRoot)("存在但不可读 → unreadable（带 errno 与路径），不得报成 missing", () => {
    const dir = tmpProject("nudo-499-eacces-");
    const from = join(dir, "main.js");
    const dep = join(dir, "dep.js");
    writeFileSync(from, "", "utf-8");
    writeFileSync(dep, "export const x = 1;\n", "utf-8");
    chmodSync(dep, 0o000);
    try {
      const r = loadModuleOutcome("./dep.js", from);
      expect(r.kind).toBe("unreadable");
      if (r.kind === "unreadable") {
        expect(r.code).toBe("EACCES");
        expect(r.path).toBe(dep);
        expect(r.message).toContain("permission denied");
      }
    } finally {
      chmodSync(dep, 0o644);
    }
  });

  ;

  ;

  it.runIf(!isRoot)("模块图侧：不可读依赖报 unreadable（不得折叠成 missing）", () => {
    // abs-modules-graph 的 readFirstRel 与 loadModuleOutcome 同口径（三态）：
    // 依赖文件在但读不了 ⇒ issue kind = "unreadable"（诊断码
    // nudo:module-unreadable），不是 "missing"（那会说「文件不存在」）。
    const dir = tmpProject("nudo-499-graph-eacces-");
    const from = join(dir, "main.js");
    const dep = join(dir, "dep.js");
    const src = `import { x } from "./dep.js";\nexport const y = x;\n`;
    writeFileSync(from, src, "utf-8");
    writeFileSync(dep, "export const x = 1;\n", "utf-8");
    chmodSync(dep, 0o000);
    try {
      clearAbsModuleCache();
      const graph = evalAbsModuleGraph(src, from);
      const kinds = graph.issues.map((i) => i.kind);
      expect(kinds).toContain("unreadable");
      expect(kinds).not.toContain("missing");
    } finally {
      chmodSync(dep, 0o644);
    }
  });
});
});

// ---------------------------------------------------------------------------
// import/export alias and label are name positions
// ---------------------------------------------------------------------------
describe("import/export alias and label are name positions", () => {
/**
 * nudo:builtin-unknown 把「导入/导出的别名」与「标签名」当成
 * 「未被覆盖的内建 API」误报。
 *
 * 原生 oracle（tmp/probe/fix-r24-m/native504.mjs / native504b.mjs）：
 * - `import { alpha as betaAlias }` → 正常执行，无 ReferenceError
 * - `export { y as renamed }` → 正常执行（导出名不是模块作用域绑定，但也不
 * 是自由全局引用）
 * - `outer:` / `break outer` → 正常执行（标签是独立命名空间）
 *
 * 修法（service 侧 eval-diagnostics）：这些位置是**名字位**不是**引用位**——
 * imported / exported / label 与既有的 key / property / local / id 同归名字位。
 *
 * 负控制：真正的自由全局仍要报；`export * as ns` 的**体内引用**仍要报，
 * 且锚点落在真正的引用位（原生下 ns 不是模块作用域绑定 ⇒ ReferenceError）。
 */



const names = (src: string): string[] =>
  collectEvalDiagnostics(src).builtinUnknown.map((b) => b.name);

describe("import/export alias and label are name positions", () => {
  it("does not flag an import alias source name (imported)；does not flag an export alias name (exported)；does not flag a label name (labeled / break / continue)；does not flag a namespace-import binding local name；negative control: a real free glo", () => {
(() => {

    const src = `
import { alpha as betaAlias, default as def } from "./m.js";
export function f() {
  return betaAlias + def;
}
`;
    expect(names(src)).not.toContain("alpha");
    expect(names(src)).not.toContain("default");
    expect(names(src)).toEqual([]);
  })();
(() => {

    const src = `
import { y } from "./m.js";
export { y as renamed };
export function f() {
  return y;
}
`;
    expect(names(src)).not.toContain("renamed");
    expect(names(src)).toEqual([]);
  })();
(() => {

    const src = `
export function f() {
  outer: for (let i = 0; i < 3; i++) {
    if (i === 1) continue outer;
    break outer;
  }
  return 1;
}
`;
    expect(names(src)).not.toContain("outer");
    expect(names(src)).toEqual([]);
  })();
(() => {

    const src = `
import * as helpers from "./m.js";
export function f() {
  return helpers.greet();
}
`;
    expect(names(src)).toEqual([]);
  })();
(() => {

    const src = `
export function f() {
  return someUndeclaredGlobal;
}
`;
    expect(names(src)).toContain("someUndeclaredGlobal");
  })();
(() => {

    // 原生：`export * as ns from` 不创建模块作用域绑定 → 体内引用 ns 是自由全局
    const src = `
export * as ns from "./m.js";
export function f() {
  return ns.alpha;
}
`;
    const hits = collectEvalDiagnostics(src).builtinUnknown.filter((b) => b.name === "ns");
    expect(hits).toHaveLength(1);
    // 锚点落在真正的引用位（第 4 行 `return ns.alpha`），不是名字位（第 2 行）
    expect(hits[0]!.range.start.line).toBe(4);
  })();
(() => {

    // 原生：`renamed` 不是模块作用域绑定 → 体内引用是自由全局
    const src = `
import { y } from "./m.js";
export { y as renamed };
export function f() {
  return renamed;
}
`;
    const hits = collectEvalDiagnostics(src).builtinUnknown.filter((b) => b.name === "renamed");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.range.start.line).toBe(5);
  })();
(() => {

    const src = `
export function f(o) {
  const a = {[missing]: 1};
  const b = o[alsoMissing];
  return a + b;
}
`;
    const got = names(src);
    expect(got).toContain("missing");
    expect(got).toContain("alsoMissing");
  })();
(() => {

    const src = `
export function f(o) {
  const a = {key: 1};
  const {key} = a;
  return a.key + o.name + key;
}
`;
    expect(names(src)).toEqual([]);
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 实测 never（抛错）的 case 带声明期望 ⇒ 不得判 ok
// ---------------------------------------------------------------------------
describe("实测 never（抛错）的 case 带声明期望 ⇒ 不得判 ok", () => {
/**
 * 抛错函数的 `@nudo:case` **声明期望恒通过**（假绿）。
 *
 * 根因（`packages/service/src/analyzer-orchestrate-uncached-cases.ts` 的
 * `caseExpectedSatisfied`）：实测 Abs 是 `never`（函数抛了 ⇒ 没有返回值），
 * 而 `never` 是类型格的**底元素**（`never ⊑ 任何类型` 恒真）⇒ 结构面判定
 * （`leqAbs`）必然通过 ⇒ 带 `=> expected` 的 case **恒判 ok** ⇒
 * `nudo test` 报「✓ 1 passed」，`nudo:case-expected` 零诊断。
 *
 * 修法：判定层加**前置条件**——实测是 `never` ⇒ **不得判 ok**。
 * 一处修覆盖三个面（service 侧 `nudo:case-expected` 发射点 /
 * `packages/nudojs/src/run-test.ts` 的报告面 / `packages/service/src/test-report.ts`）。
 *
 * ⚠ **展示层不变**：`comparableExpected` 在「不满足」时**原样**返回 expected
 * ⇒ 期望的展示形态（`number (> 0)` 这类谓词期望）**不许**跟着变形
 * （本钉同时钉住这一面）。
 *
 * 钉：
 * - 抛错 + 声明期望 ⇒ 报 `nudo:case-expected`（改前恒 0 条）；
 * - 抛错 + **谓词**期望 ⇒ 报，且诊断文案保留谓词展示形态（`number (> 0)`）；
 * - 负控制：不抛错 + 期望满足 ⇒ 0 条（口径不变）；
 * - 负控制：不抛错 + 期望不满足 ⇒ 1 条（口径不变）；
 * - 负控制：抛错 + **无**期望 ⇒ 0 条（unchecked 口径不变）；
 * - 消费侧单测：`caseExpectedSatisfied(never, expected)` ⇒ 不满足。
 */








type Diag = { code?: string; message?: string };

/** 跑一个 `@nudo:case` 文件，返回分析结果。 */
function analyzeSrc(src: string): {
  diagnostics: readonly Diag[];
  functions: readonly {
    name: string;
    cases: readonly { name: string; abs: { shape: { k: string } }; expected?: unknown }[];
  }[];
} {
  return withTmpProject("nudo-b649-", (dir) => {
    const file = writeTmpFile(dir, "f.js", src);
    return analyzeFile_____analyzer_ts_7(file, readFileSync(file, "utf-8"));
  });
}

/** `nudo:case-expected` 诊断条数（期望不满足）。 */
function caseExpectedCount(src: string): number {
  return analyzeSrc(src).diagnostics.filter((d) => d.code === "nudo:case-expected").length;
}

/** `nudo:case-expected` 诊断文案。 */
function caseExpectedMessage(src: string): string {
  const d = analyzeSrc(src).diagnostics.find((x) => x.code === "nudo:case-expected");
  return d?.message ?? "";
}

describe("实测 never（抛错）的 case 带声明期望 ⇒ 不得判 ok", () => {
  it("抛错 + 声明期望（=> 42）⇒ 报 nudo:case-expected（改前恒 0 条）；抛错 + 声明期望 ⇒ 诊断文案如实报出「实测 never」；展示层不变：抛错 + 谓词期望 ⇒ 期望展示形态仍是「number (> 0)」；负控制：不抛错 + 期望满足 ⇒ 0 条 nudo:case-expected；负控制：不抛错 + 期望不满足 ⇒ 1 条 nudo:case-expected（口径不变）；负控制：抛错 + 无期望 ⇒ 0 条 nudo:case-expe", () => {
(() => {

    const src = `/**
 * @nudo:case "t" (1) => 42
 */
export function f(x) { throw new Error("boom"); }
`;
    expect(caseExpectedCount(src)).toBe(1);
  })();
(() => {

    const src = `/**
 * @nudo:case "t" (1) => 42
 */
export function f(x) { throw new Error("boom"); }
`;
    const msg = caseExpectedMessage(src);
    expect(msg).toContain("expected 42");
    expect(msg).toContain("got never");
  })();
(() => {

    const src = `/**
 * @nudo:case "t" (1) => number().gt(0)
 */
export function f(x) { throw new Error("boom"); }
`;
    // 诊断文案（formatExpected 口径）保留谓词形态
    expect(caseExpectedMessage(src)).toContain("expected number (> 0)");
    // 台账里的 expected 形态（comparableExpected 在「不满足」时原样返回）
    const result = analyzeSrc(src);
    const fn = result.functions.find((f) => f.name === "f")!;
    const c = fn.cases.find((x) => x.name === "t")!;
    expect(c.abs.shape.k).toBe("never");
    expect(c.expected).toBeDefined();
    expect(formatExpected(c.expected as never)).toBe("number (> 0)");
  })();
(() => {

    const src = `/**
 * @nudo:case "t" (1) => 2
 */
export function f(x) { return x + 1; }
`;
    expect(caseExpectedCount(src)).toBe(0);
  })();
(() => {

    const src = `/**
 * @nudo:case "t" (1) => 42
 */
export function f(x) { return x; }
`;
    expect(caseExpectedCount(src)).toBe(1);
  })();
(() => {

    const src = `/**
 * @nudo:case "t" (1)
 */
export function f(x) { throw new Error("boom"); }
`;
    expect(caseExpectedCount(src)).toBe(0);
  })();
});;

  ;

  ;

  ;

  ;

  ;
});

describe("caseExpectedSatisfied 的 never 前置条件（消费侧单测）", () => {
  const one = numLit(1);

  it("实测 never ⇒ 不满足（底元素恒真被拦住）；负控制：实测 1、期望 1 ⇒ 满足（口径不变）；负控制：实测 1、期望 2 ⇒ 不满足（口径不变）", () => {
(() => {

    expect(caseExpectedSatisfied(neverAbs, numLit(42))).toBe(false);
  })();
(() => {

    expect(caseExpectedSatisfied(one, numLit(1))).toBe(true);
  })();
(() => {

    expect(caseExpectedSatisfied(one, numLit(2))).toBe(false);
  })();
});;

  ;

  ;
});
});
