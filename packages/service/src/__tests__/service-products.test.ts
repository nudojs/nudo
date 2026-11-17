/**
 * 模块套件：service dts/schema/guard/standard/zod 产品面。
 */
import { describe, it, expect, beforeEach, afterAll, afterEach } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { generateDts, projectFunctionDts } from "../emit/dts-generator.ts";
import { abs, objOf, num, type Abs, constraintToEntryAbs, litC, number, string, union, checkSource, pTrue, type RunTranspiledOptions, numLit, obj, parseSource, formatShape, type FormalParam, createEnvironment } from "@nudojs/core";
import { analyzeFile as analyzeFile_____index_ts, resetAllAnalysisCaches } from "../index.ts";
import { absToSchemaSource, absToZodSchemaModule, projectAbsToSchema, type SchemaNode, absToSchemaNode, schemaNodeToZod } from "../emit/schema-generator.ts";
import { absToStandardSchemaModule, validateSchemaNode, absToStandardSchemaFunction } from "../emit/standard-schema.ts";
import type { DirectiveDiag } from "@nudojs/parser";
import { collectEvalReplacements } from "../eval-run.ts";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tscNoEmitSingle } from "../emit/__tests__/dts-tsc.ts";
import { denoteGuard, formatThrowsAbs } from "@nudojs/core/internal";
import { generateGuardFunctionFromAbs } from "../emit/guard-generator.ts";
import { emitContract } from "../emit/contract-emitter.ts";
import { draftContract } from "../emit/contract-draft.ts";
import { analyzeFile as analyzeFile_____analyzer_ts, } from "../analyzer.ts";
import { extractFormals, extractParamNames } from "../analyzer-ast.ts";
import type { FunctionAnalysis } from "../analyzer-types.ts";
import { isEnvTemplatePath } from "../env-path-deps.ts";
import { tmpProject } from "./tmp-project.ts";
import { loadGeneratedModule } from "../emit/__tests__/fixtures.ts";
import { loadEnvs, preloadPathEnvs, getPathEnvLoadErrors, clearPathEnvCaches } from "../evaluator/env-loader.ts";

// ---------------------------------------------------------------------------
// dts 面：访问器占位槽不得渲染成 exact undefined
// ---------------------------------------------------------------------------
describe("dts 面：访问器占位槽不得渲染成 exact undefined", () => {
/**
 * 回归（**dts 投影面**）：对象字面量访问器（getter）的占位槽
 * 不得在 `.d.ts` 里被渲染成 exact `undefined`。
 *
 * 背景：访问器不住在 shape 槽里——transpile 只落一个 `$lit(void 0)` 占位槽
 * （保键存在性），真 getter 住 core 的 accessorTable 侧表。**读**通道
 * （$get）先查侧表 ⇒ `o.ab` 读得对；但 **dts 投影**直读占位槽 ⇒
 * `{ get ab() { return 1; } }` 的 dts 渲染成 `{ ab: undefined }`（自信的
 * 错值：比真值更窄且自相矛盾——消费方按此声明写代码拿到 undefined 类型，
 * 真值是 number）。
 *
 * 修法（service/emit/dts-generator.ts）：dts 投影按 getter **读域**渲染
 * （有 getter → 以对象为接收者求值；getter 抛 → unknown；无 getter → 槽值）。
 * 与 core 投影面（formatShape / denoteGuard / absToConstraint / 契约证明）
 * 同口径。
 *
 * 断言与 Node 真实执行结果对齐（原生读值见各用例注释）。
 */




/** 源码 → dts 文本 */
function dtsOf(source: string): string {
  return generateDts(analyzeFile("/test/bug191-dts.js", source));
}

/** dts 里该函数的声明行（`export declare function g(...): T;`） */
function declOf(source: string): string {
  const line = dtsOf(source)
    .split("\n")
    .find((l) => l.startsWith("export declare function"));
  return line ?? "";
}

{
  const declOf = (source: string): string => generateDts(analyzeFile("/test/dts.js", source)).split("\n").find((l) => l.startsWith("export declare function")) ?? "";
  it("getter 读域：数字/字符串/this/嵌套/抛 unknown；不出现 exact undefined", () => {
    expect(declOf('export function g() { return { get ab() { return 1; } }; }')).toContain("{ ab: 1 }");
    expect(declOf('export function g() { return { get ab() { return "s"; } }; }')).toContain('{ ab: "s" }');
    expect(declOf("export function g() { return { n: 41, get q() { return this.n; } }; }")).toContain("{ n: 41; q: 41 }");
    expect(declOf("export function g() { return { inner: { get ab() { return 2; } } }; }")).toContain("{ inner: { ab: 2 } }");
    expect(declOf('export function g() { return { get boom() { throw new Error("x"); } }; }')).toContain("{ boom: unknown }");
    expect(generateDts(analyzeFile("/test/dts.js", "export function g() { return { get ab() { return 1; } }; }"))).not.toContain("ab: undefined");
  });
}

describe("dts 负控制：非 getter 槽不受影响", () => {
  const declOf = (source: string): string => generateDts(analyzeFile("/test/dts.js", source)).split("\n").find((l) => l.startsWith("export declare function")) ?? "";
  it("数据属性 / 显式 undefined / setter-only / 空对象", () => {
    expect(declOf("export function g() { return { plain: 5 }; }")).toContain("{ plain: 5 }");
    expect(declOf("export function g() { return { u: undefined }; }")).toContain("{ u: undefined }");
    expect(declOf("export function g() { return { set ab(v) {} }; }")).toContain("{ ab: undefined }");
    expect(declOf("export function g() { return {}; }")).toContain("Record<string, never>");
  });
});
});

// ---------------------------------------------------------------------------
// zod brand 节点不得引用无运行时值的名字
// ---------------------------------------------------------------------------
describe("zod brand 节点不得引用无运行时值的名字", () => {
/**
 * `nudo export --format schema` 把**生成器的 `constructor` brand**
 * （`GeneratorFunction`）渲染成 `z.instanceof(GeneratorFunction)`：生成的 zod
 * 模块 **import 即崩**（`ReferenceError: GeneratorFunction is not defined`），
 * 整个产物作废（客户端 import 的第一行就崩，一个校验器都拿不到）。
 *
 * 根因（packages/service/src/emit/schema-generator.ts）：`case "brand"` 无条件把
 * brand **名字**当作用域内的运行时标识符插进生成源码——既不检查该名字是不是一个
 * 值，也不检查它在生成的模块里可见不可见（zod 产物只 import zod，模块里能解析的
 * 只有全局；`GeneratorFunction` 连全局都不是）。
 *
 * 修法：brand 名只有落在「运行时全局构造器」表里才允许进 `z.instanceof(...)`；
 * 其余（GeneratorFunction / AsyncGeneratorFunction / 用户类名 / `X.prototype` /
 * `Record<…>` …）降级 `z.unknown()` 并把损失记进 dropped 台账——**产物永远可 import**。
 */






// 用例级缓存隔离：整文件分析管线背后的会话级缓存
beforeEach(() => {
  resetAllAnalysisCaches();
});

const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "exact");

/** zod 桩：链式可调用（只为验证「模块求值期不炸」） */
function zodStub(): unknown {
  const stub: unknown = new Proxy(function () {} as unknown as object, {
    get: () => stub,
    apply: () => stub,
  });
  return stub;
}

/**
 * 把 zod 产物当模块求值一次（去 import / export 后 new Function 跑）。
 * 真 zod 也会在模块顶层求值 `z.instanceof(X)` 的实参 X —— X 不存在时同样抛。
 */
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

const GENERATOR_SRC = "export function* gen() {\n  yield 1;\n}\n";

function generatorOutputAbs(): Abs {
  const result = analyzeFile_____index_ts("/t/bug233-gen.js", GENERATOR_SRC);
  const fn = result.functions[0]!;
  const out = fn.combinedAbs ?? fn.cases[0]?.abs;
  if (!out) throw new Error("no output abs for generator fixture");
  return out;
}

{
  beforeEach(() => { resetAllAnalysisCaches(); });
  const brandOf = (name: string): Abs => abs({ k: "brand", name, shape: objOf({}) }, undefined, undefined, "exact");
  const zodStub = (): unknown => { const stub: unknown = new Proxy(function () {} as unknown as object, { get: () => stub, apply: () => stub }); return stub; };
  const evaluateZodModule = (source: string, exportNames: string[]): { ok: boolean; error?: string } => {
    const body = source.replace(/^import \{ z \} from "zod";$/m, "").replace(/^export const /gm, "const ") + `\nreturn { ${exportNames.join(", ")} };`;
    try { new Function("z", body)(zodStub()); return { ok: true }; } catch (err) { return { ok: false, error: (err as Error).message }; }
  };
  const generatorOutputAbs = (): Abs => {
    const result = analyzeFile("/t/bug233-gen.js", "export function* gen() {\n  yield 1;\n}\n");
    const fn = result.functions[0]!;
    const out = fn.combinedAbs ?? fn.cases[0]?.abs;
    if (!out) throw new Error("no output abs");
    return out;
  };
  it("生成器 brand 不引用 GeneratorFunction；模块可求值；非全局降级 unknown；全局仍 instanceof；standard 不受影响", () => {
    const mod = absToZodSchemaModule({ genOutput: generatorOutputAbs() });
    expect(mod.source).not.toMatch(/z\.instanceof\([^)]*GeneratorFunction/);
    expect(mod.source).not.toContain("constructor");
    expect(mod.source).not.toContain("GeneratorFunction");
    expect(mod.dropped.some((d) => d.includes("GeneratorFunction"))).toBe(false);
    expect(evaluateZodModule(mod.source, ["genOutput"]).ok).toBe(true);

    const broken = 'import { z } from "zod";\nexport const genOutput = z.object({ constructor: z.instanceof(GeneratorFunction) });\n';
    const brokenEval = evaluateZodModule(broken, ["genOutput"]);
    expect(brokenEval.ok).toBe(false);
    expect(brokenEval.error).toContain("GeneratorFunction is not defined");

    for (const name of ["GeneratorFunction", "AsyncGeneratorFunction", "Widget", "Object.prototype"]) {
      const p = projectAbsToSchema(brandOf(name));
      expect(p.source, name).toBe("z.unknown()");
      expect(p.dropped.some((d) => d.includes(name)), name).toBe(true);
    }
    expect(absToSchemaSource(brandOf("Date"))).toBe("z.instanceof(Date)");
    expect(absToSchemaSource(brandOf("Map"))).toBe("z.instanceof(Map)");
    expect(absToSchemaSource(brandOf("RegExp"))).toBe("z.instanceof(RegExp)");
    expect(absToSchemaSource(num())).toContain("z.number()");

    const full = absToZodSchemaModule({ genOutput: generatorOutputAbs(), d: brandOf("Date") });
    for (const m of full.source.matchAll(/z\.instanceof\(([^)]*)\)/g)) {
      expect(typeof (globalThis as Record<string, unknown>)[m[1]!], m[1]).toBe("function");
    }
    const standard = absToStandardSchemaModule({ out: brandOf("GeneratorFunction") });
    expect(standard.source).not.toContain("z.instanceof");
    expect(standard.source).toContain('"~standard"');
  });
}
});

// ---------------------------------------------------------------------------
// standard 方言的 promise 节点不再放行一切
// ---------------------------------------------------------------------------
describe("standard 方言的 promise 节点不再放行一切", () => {
/**
 * `nudo export --format standard` 的 `promise` 分支**放行一切**
 * ⇒ 非 Promise 值被校验器接受，而同一份 Abs 的 zod 面（`z.promise`）与 guard
 * 面（`data instanceof Promise`）都拒绝 ⇒ 同一 Abs 在两个方言里给出相反裁决。
 *
 * 根因：`standard-schema.ts` 的 `case "promise": return;` 把「不展开 thenable」
 * 误实现成「不做任何检查」（库函数版与内联进产物的拷贝各一处）。
 *
 * 本钉：promise 节点必须判「是不是 Promise」（值域不展开，但类型判据在）。
 */




const promiseNode: SchemaNode = { k: "promise", inner: { k: "unknown" } };

{
  const promiseNode: SchemaNode = { k: "promise", inner: { k: "unknown" } };
  it("非 Promise 拒绝；真 Promise 放行；unknown 仍放行一切", () => {
    for (const bad of [42, "str", {}, null, undefined]) {
      const r = validateSchemaNode(promiseNode, bad);
      expect("issues" in r).toBe(true);
      expect(r.issues?.length ?? 0).toBeGreaterThan(0);
    }
    expect("issues" in validateSchemaNode(promiseNode, Promise.resolve(1))).toBe(false);
    expect("issues" in validateSchemaNode({ k: "unknown" }, 42)).toBe(false);
  });
}
});

// ---------------------------------------------------------------------------
// 契约的 union 字面量域必须在 dts 面保形
// ---------------------------------------------------------------------------
describe("契约的 union 字面量域必须在 dts 面保形", () => {
/**
 * `export --format dts` 把**非同 prim 的字面量 union** 拓宽成基类型
 * ⇒ 发布的 `.d.ts` 允许契约违约的调用（双门禁对撞）。
 *
 * 同一次运行、同一份契约三个面三种说法：
 * check 签名 `pick(v: lit(1) | lit("x")) => number | string`
 * dts（改前） `pick(v: number | string): number | string` ← **拓宽**
 * zod `z.union([z.literal(1), z.literal("x")])` ← 保字面量
 *
 * 根因：`contractLiteralTSType` **只读顶层 pred**。同 prim 字面量 union 在 Abs
 * 面上被特化成「prim + or(eq…)」，字面量在顶层 pred 里 ⇒ 保形 ✓；而**非同
 * prim** 的 union 落成 **sum 形状** ⇒ 字面量挂在**各成员自己的** pred 上、顶层
 * pred 为空 ⇒ 取不到 ⇒ 落回 `absToTSType(widenTopLevelAbs(a))` ⇒ 拓宽成
 * `number | string` ⇒ 消费方 tsc 放行 `pick(99)`，运行时被 nudo 门禁判违约。
 *
 * 修法：与 zod 面**同源**——union 臂**逐成员**取字面量集后合并。
 */





/** `pick(v) { return v; }` 的 dts 行（契约面：形参 + 返回同一条约束） */
function dtsOf(c: ReturnType<typeof union>): string {
  const result = analyzeFile("/test/bug027.js", `export function pick(v) { return v; }\n`);
  const fn = result.functions.find((f) => f.name === "pick")!;
  return projectFunctionDts(fn, {
    params: [{ name: "v", abs: constraintToEntryAbs(c, "v") }],
    return: constraintToEntryAbs(c, "return"),
  }).lines.join("\n");
}

{
  const dtsOf = (c: ReturnType<typeof union>): string => {
    const result = analyzeFile("/test/bug027.js", "export function pick(v) { return v; }\n");
    const fn = result.functions.find((f) => f.name === "pick")!;
    return projectFunctionDts(fn, { params: [{ name: "v" as const, abs: constraintToEntryAbs(c, "v") }], return: constraintToEntryAbs(c, "return") }).lines.join("\n");
  };
  it("非同 prim 字面量 union / 同 prim / nullish 保形；非字面量与带界成员回落 widen", () => {
    const mixed = dtsOf(union(litC(1), litC("x")));
    expect(mixed).toContain('export declare function pick(v: 1 | "x"): 1 | "x";');
    expect(mixed).not.toContain("number | string");
    expect(dtsOf(union(litC("a"), litC("b")))).toContain('pick(v: "a" | "b"): "a" | "b"');
    expect(dtsOf(union(litC(1), litC(null)))).toContain("pick(v: 1 | null)");
    expect(dtsOf(union(number(), string()))).toContain("pick(v: number | string): number | string");
    expect(dtsOf(union(number().gt(0), litC(0)))).toContain("pick(v: number): number");
  });
}
});

// ---------------------------------------------------------------------------
// bigint 字面量保基类型
// ---------------------------------------------------------------------------
describe("bigint 字面量保基类型", () => {
/**
 * export 的 zod / standard 两个方言把**已知的 bigint 字面量**
 * 整条降级成 `unknown`（连基类型都没保住）⇒ 校验器接受**任何**值；
 * 而 guard 面（`data === 10n`）与 dts 面（`bigint`）都保住了基类型
 * ⇒ 三面接受集不相交。
 *
 * 修法：观测路径上的 bigint 字面量保**基类型**（`z.bigint()` /
 * `{"k":"prim","type":"bigint"}`），字面量精度进 dropped 台账。
 */




const bigintLit = (v: bigint) => abs({ k: "prim", type: "bigint" }, { op: "lit", value: v }, undefined, "exact");

{
  const bigintLit = (v: bigint) => abs({ k: "prim", type: "bigint" }, { op: "lit", value: v }, undefined, "exact");
  it("zod 方言保 z.bigint 并记 dropped；schema 节点 prim bigint", () => {
    const p = projectAbsToSchema(bigintLit(10n), { dialect: "zod" });
    expect(p.source).toBe("z.bigint()");
    expect(p.dropped.join("\n")).toContain("lit bigint not projected: 10");
    const { node } = absToSchemaNode(bigintLit(10n));
    expect(node).toEqual({ k: "prim", type: "bigint", refinements: [] });
  });
}
});

// ---------------------------------------------------------------------------
// 残留 — @nudo:as 目标形态不支持 ⇒ 显式诊断（不许静默）
// ---------------------------------------------------------------------------
describe("残留 — @nudo:as 目标形态不支持 ⇒ 显式诊断（不许静默）", () => {
/**
 * 残留（service 指令面）：`@nudo:as` 覆盖只施加在
 * **VariableDeclaration 的 init** 与 **ReturnStatement 的值**上（文档口径）
 * ⇒ 标注在**其它语句形态**（for 头 / for-init / if / 表达式语句 / 函数声明 …）
 * 上的 `@nudo:as` **无适用目标**。
 *
 * 改前：这类指令被**采集**（asTargets 非空）却**静默失效**——类型没变、
 * 零诊断（用户毫无痕迹的假绿）。
 *
 * 改后：按 的修复方向（不许静默）⇒ 目标形态不支持时发一条显式
 * `nudo:directive-syntax`（既有码，不另造新码；warning 级，不制造假红）。
 *
 * 负控制钉住：适用形态（变量声明 / return / export 声明）**零诊断**，且
 * 覆盖照常生效。
 */





/** 收集指令（带诊断通道） */
function collect(src: string): {
  reps: ReturnType<typeof collectEvalReplacements>;
  diags: DirectiveDiag[];
} {
  const diags: DirectiveDiag[] = [];
  const reps = collectEvalReplacements(src, { diags });
  return { reps, diags };
}

/** 收集 → 注入 → 门禁（产品面同口径） */
function check(src: string, file = "/t/as-shape.js") {
  const { reps } = collect(src);
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

{
  const collect = (src: string) => { const diags: DirectiveDiag[] = []; const reps = collectEvalReplacements(src, { diags }); return { reps, diags }; };
  const check = (src: string) => { const { reps } = collect(src); return checkSource("/t/as-shape.js", src, pTrue, { inject: { replacements: reps.values, replacementTargets: reps.targets, asOverrides: reps.asValues, asOverrideTargets: reps.asTargets } }); };
  const sigOf = (r: { signatures: { name: string; display: string }[] }, fn: string) => r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
  it("不支持形态诊断且不登记；变量/return/export/解构照常生效", () => {
    const bads = [
      `export function f(xs) {\n  // @nudo:as shape({ a: number() })\n  for (const { a } of xs) { return a; }\n  return 0;\n}\n`,
      `export function f(x) {\n  // @nudo:as number()\n  g(x);\n  return 1;\n}\n`,
      `// @nudo:as number()\nexport function f() { return 1; }\n`,
    ];
    for (const src of bads) {
      const { reps, diags } = collect(src);
      expect(diags.filter((d) => d.code === "nudo:directive-syntax"), src).toHaveLength(1);
      expect(reps.asTargets, src).toHaveLength(0);
    }
    const varDecl = `export function f(content) {\n  // @nudo:as shape({ port: number(), host: string() })\n  const config = JSON.parse(content);\n  return config;\n}\n`;
    expect(collect(varDecl).diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(collect(varDecl).reps.asTargets).toHaveLength(1);
    expect(sigOf(check(varDecl), "f")).toContain("{ port: number, host: string }");
    const ret = `export function f(content) {\n  // @nudo:as shape({ port: number() })\n  return JSON.parse(content);\n}\n`;
    expect(collect(ret).reps.asTargets).toHaveLength(1);
    const exp = `// @nudo:as number()\nexport const raw = 1;\n`;
    expect(collect(exp).reps.asTargets).toHaveLength(1);
    const destructure = `export function f(content) {\n  // @nudo:as shape({ port: number(), host: string() })\n  const { port, host } = JSON.parse(content);\n  return { port, host };\n}\n`;
    expect(collect(destructure).diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(sigOf(check(destructure), "f")).toContain("{ port: number, host: string }");
  });
}
});

// ---------------------------------------------------------------------------
// zod 长度界按 UTF-16 码元
// ---------------------------------------------------------------------------
describe("zod 长度界按 UTF-16 码元", () => {
/**
 * zod 面把 Abs 的长度界（**UTF-16 码元**）一对一映射成 zod v4 的
 * `.min()/.max()`（**Unicode 码点**）⇒ 含星平面字符时 zod 面与契约 / guard /
 * standard 三面裁决相反（min 假红 / max 假绿）⇒ 四面互斥。
 *
 * 修法：用 `refine` 显式按 UTF-16 长度判定，与 guard 面的 `data.length >= n`、
 * standard 面的 `strMin/strMax` 同口径。
 */




  it("strMin/strMax 用 refine；无界仍 z.string()", () => {
    const min = schemaNodeToZod({ k: "prim", type: "string", refinements: [{ kind: "strMin", n: 2 }] });
    expect(min).toBe("z.string().refine((s) => s.length >= 2)");
    expect(min).not.toContain(".min(2)");
    const max = schemaNodeToZod({ k: "prim", type: "string", refinements: [{ kind: "strMax", n: 1 }] });
    expect(max).toBe("z.string().refine((s) => s.length <= 1)");
    expect(max).not.toContain(".max(1)");
    expect(schemaNodeToZod({ k: "prim", type: "string", refinements: [] })).toBe("z.string()");
  });

});

// ---------------------------------------------------------------------------
// dts 不发布调用点观测的字面量
// ---------------------------------------------------------------------------
describe("dts 不发布调用点观测的字面量", () => {
/**
 * `export --format dts` 把**一次调用点观测到的字面量**当成函数的
 * TS 声明发布：返回位的**对象槽字面量不拓宽** ⇒ 消费端 `tsc --strict` 对
 * **合法代码**报 TS2367（把 `{ a: number }` 谎报成 `{ a: 1 }`）。
 *
 * 修法：纯 `call@` 观测（没有 `@nudo:case` 断言 / 入口泛化）的返回位，对象槽
 * 里的标量字面量剥到基类型。带断言的 case 与入口泛化维持「嵌套精度保留」。
 */





  it("纯调用点观测剥到基类型；无调用点入口泛化保留嵌套精度", () => {
    const dts = generateDts(analyzeFile("/test/bug214.js", 'export function mk(n) {\n  return { a: n, b: "s" };\n}\n\nmk(1);\n'));
    const decl = dts.split("\n").find((l) => l.includes("export declare function mk")) ?? "";
    expect(decl).toBe("export declare function mk(n: number): { a: number; b: string };");
    expect(generateDts(analyzeFile("/test/bug214b.js", "export function one() {\n  return { a: 1 };\n}\n"))).toContain("{ a: 1 }");
  });

});

// ---------------------------------------------------------------------------
// 内建 brand 的 guard 产物必须过 tsc --strict
// ---------------------------------------------------------------------------
describe("内建 brand 的 guard 产物必须过 tsc --strict", () => {
/**
 * guard 产物因 brand 的 `instanceof` **类型收窄**过不了
 * `tsc --noEmit --strict`（TS7053：`data["0"]` 在
 * `Uint8Array | Record<string, any>` 上不可索引）⇒ `nudo export` **exit 0、
 * 零警告**地发布不可编译的产物。
 *
 * 根因：`denote.ts` 的 brand 身份子句把 `data` 放进 `instanceof` 左操作数
 * ⇒ TS 收窄 `data`；`guard-generator.ts` 把它声明为 `Record<string, any>`。
 *
 * 本钉：内建 brand 返回形态的守卫产物必须过 `tsc --strict`，运行时语义不变。
 */









const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** `new Uint8Array([1, 2])` 的观测形态：brand + 数字下标槽 + length */
function uint8Abs(): Abs {
  return abs(
    {
      k: "brand",
      name: "Uint8Array",
      shape: obj({
        "0": { value: numLit(1) },
        "1": { value: numLit(2) },
        length: { value: numLit(2) },
      }),
    },
    undefined,
    undefined,
    "exact",
  );
}

{
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const uint8Abs = (): Abs => abs({ k: "brand", name: "Uint8Array", shape: obj({ "0": { value: numLit(1) }, "1": { value: numLit(2) }, length: { value: numLit(2) } }) }, undefined, undefined, "exact");
  it("guard 产物过 tsc --strict 且运行时语义不变", () => {
    const source = generateGuardFunctionFromAbs("isbytesOutput", uint8Abs());
    expect(source).toContain("const data: any = value as Record<string, any>;");
    const gate = tscNoEmitSingle(source, "lib.nudo.guard.ts");
    expect(gate.stderr).toBe("");
    const check = new Function("data", `return ${denoteGuard(uint8Abs(), "data")};`) as (v: unknown) => boolean;
    expect(check(new Uint8Array([1, 2]))).toBe(true);
    expect(check({ 0: 1, 1: 2, length: 2 })).toBe(false);
  });
}
});

// ---------------------------------------------------------------------------
// core import 不得豁免 builder 声明头
// ---------------------------------------------------------------------------
describe("core import 不得豁免 builder 声明头", () => {
/**
 * `.nudo.ts` 侧车里**已有**的 `import { lit } from "@nudojs/core";`
 * 被当成「builder 已就位」⇒ 抑制掉 `declare const lit: …litC;` 声明头 ⇒
 * 产物里的 `lit(1)` 绑定到 core 的 **Term 构造器**（约束构建器叫 `litC`）
 * ⇒ `tsc --strict` 报 TS2322 / TS2345，而 `nudo check` 对该侧车判 OK
 * （缺陷对 nudo 完全隐形）。
 *
 * 修法：「已 import」判据比对 **core 导出名**（`coreExportNameOf`），只承认
 * 绑定的就是那个约束构建器；`import { lit }` 不豁免 ⇒ 走别名 + 声明头。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-271-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// 带断言的 @nudo:case 是**域声明** ⇒ 字面量保留 ⇒ 生成段真的用到 `lit(`
const SRC = `/**
 * @nudo:case "c" (1) => 2
 */
export function f(x) {
  return x + 1;
}
`;

{
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "nudo-bug-271-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const SRC = `/**\n * @nudo:case "c" (1) => 2\n */\nexport function f(x) {\n  return x + 1;\n}\n`;
  it("已有 import { lit } 仍补 litC 声明（别名）；无该 import 时直接声明 lit", async () => {
    const file = join(dir, "lit.ts");
    writeFileSync(file, SRC);
    writeFileSync(join(dir, "lit.nudo.ts"), 'import { fn, lit } from "@nudojs/core";\n');
    const r = await emitContract(file, { mode: "update", all: true });
    expect(r.written).toContain("f");
    const after = readFileSync(join(dir, "lit.nudo.ts"), "utf-8");
    expect(after).toContain('typeof import("@nudojs/core").litC;');
    const alias = /declare const (_nudo_lit\w*): typeof import\("@nudojs\/core"\)\.litC;/.exec(after)?.[1];
    expect(alias).toBeDefined();
    expect(after).toContain(`${alias}(1)`);
    expect(after).not.toMatch(/(?<![A-Za-z0-9_$])lit\(1\)/);

    const file2 = join(dir, "lit2.ts");
    writeFileSync(file2, SRC);
    writeFileSync(join(dir, "lit2.nudo.ts"), "// empty sidecar\n");
    await emitContract(file2, { mode: "update", all: true });
    const after2 = readFileSync(join(dir, "lit2.nudo.ts"), "utf-8");
    expect(after2).toContain('declare const lit: typeof import("@nudojs/core").litC;');
    expect(after2).toContain("lit(1)");
  });
}
});

// ---------------------------------------------------------------------------
// 草稿 builder import ⊆ 真正被调用的 builder
// ---------------------------------------------------------------------------
describe("草稿 builder import ⊆ 真正被调用的 builder", () => {
/**
 * 草稿的 builder import 列表用**词边界**（`\bname\b`）扫 DSL ⇒
 * 仅仅因为观测对象的**字段名叫 `lit`** 就把 core 的 `lit`（**Term 构造器**，
 * 约束构建器叫 `litC`）拖进草稿 import ⇒ 与「只 import 草稿里实际用到的
 * builder」的自述直接相悖，且写出的绑定类型面是坏的。
 *
 * 修法：判据改为**调用位**（`name(`），名单取 core 的
 * `CONSTRAINT_BUILDER_NAMES`（单一真源）。
 */






let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-272-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function importLine(src: string): string {
  return /^import \{[^}]*\} from "@nudojs\/core";$/m.exec(src)?.[0] ?? "";
}

{
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "nudo-bug-272-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const importLine = (src: string) => /^import \{[^}]*\} from "@nudojs\/core";$/m.exec(src)?.[0] ?? "";
  it("字段名 lit/lam 都不会把 lit 拖进 import", async () => {
    for (const [name, field] of [["lit.ts", "lit"], ["lam.ts", "lam"]] as const) {
      const file = join(dir, name);
      writeFileSync(file, `export function f(o) {\n  return o.${field};\n}\nf({ ${field}: 1 });\n`);
      const r = await draftContract(file);
      const line = importLine(r.draftSource);
      expect(line, field).toContain("fn");
      expect(line, field).toContain("shape");
      expect(line, field).toContain("number");
      expect(line, field).not.toMatch(/(?<![\w$])lit(?![A-Za-z0-9_$])/);
      const dsl = r.draftSource.split("\n").filter((l) => /^export const f = /.test(l)).join("\n");
      expect(dsl, field).not.toMatch(/(?<![\w$])lit\s*\(/);
    }
  });
}
});

// ---------------------------------------------------------------------------
// （service 侧）— dts 面：数组解构的输入面是元组，不是对象
// ---------------------------------------------------------------------------
describe("（service 侧）— dts 面：数组解构的输入面是元组，不是对象", () => {
/**
 * （**service 侧**，dts 产物面）：**数组解构**形参的字段级侧车契约
 * 被聚合成**对象形状** ⇒ 产物的输入面与真实形参形态**完全颠倒**。
 *
 * 症状（改前）：`export function f7([a, b])` + 侧车契约 `fn({ a: number() })`
 * ⇒ dts 给出 `export declare function f7(_p0: { a: number }): number;`
 * —— 声明面说「参数是个**对象** `{ a }`」，而真实形参是个**数组**
 * ⇒ 消费方按 `{ a: number }` 写调用 ⇒ 与真实调用对不上。
 *
 * 根因：`packages/service/src/emit/dts-generator.ts` 的 `lookupContractSlot`
 * 把解构位的字段级契约条目一律聚合成 `{ k: "obj", slots }` ⇒ 数组解构
 * （契约按**元素下标**寻址）也被摊成对象。
 *
 * 修法：`DeclaredParam` 带上**模式种类**与**绑定名 → 下标**表；数组解构的
 * 字段级契约聚合成**元组**（元素位按下标寻址，未契约的位置留 `unknown`——
 * 无约束，不是 unknown），声明名渲染成**数组形态** `[ a, b ]`。
 *
 * 钉：
 * - 部分覆盖（契约只写 `a`）⇒ 形参类型是**元组**（不是对象）；
 * - 全覆盖（契约写 `a` 与 `b`）⇒ 形参类型是元组 + 声明名是 `[ a, b ]`；
 * - 负控制：**对象解构**的字段级契约仍聚合成**对象**（既有口径不变）。
 */






beforeEach(() => {
  resetAllAnalysisCaches();
});

const num = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");
const str = abs({ k: "prim", type: "string" }, undefined, undefined, "exact");

/** dts 声明行（形参类型）。 */
function declOf(source: string, contractParams?: { name: string; abs: unknown }[]): string {
  const result = analyzeFile_____analyzer_ts("/test/bug394.ts", source);
  const fn = result.functions.find((f) => f.name === "f7")!;
  const proj = projectFunctionDts(
    fn,
    contractParams ? { params: contractParams as never } : undefined,
  );
  return proj.lines.find((l) => l.startsWith("export declare function")) ?? "";
}

const ARRAY_PATTERN = `export function f7([a, b]) { return a; }
f7([1, 2]);
`;

const OBJECT_PATTERN = `export function f7({ a, b }) { return a; }
f7({ a: 1, b: 2 });
`;

{
  beforeEach(() => { resetAllAnalysisCaches(); });
  const num = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");
  const str = abs({ k: "prim", type: "string" }, undefined, undefined, "exact");
  const declOf = (source: string, contractParams?: { name: string; abs: unknown }[]): string => {
    const result = analyzeFile("/test/bug394.ts", source);
    const fn = result.functions.find((f) => f.name === "f7")!;
    const proj = projectFunctionDts(fn, contractParams ? { params: contractParams as never } : undefined);
    return proj.lines.find((l) => l.startsWith("export declare function")) ?? "";
  };
  const ARRAY_PATTERN = "export function f7([a, b]) { return a; }\nf7([1, 2]);\n";
  const OBJECT_PATTERN = "export function f7({ a, b }) { return a; }\nf7({ a: 1, b: 2 });\n";
  it("数组解构契约聚合成元组；对象解构仍是对象；无契约仍是观测面", () => {
    const partial = declOf(ARRAY_PATTERN, [{ name: "a", abs: num }]);
    expect(partial).toContain("[number, unknown]");
    expect(partial).not.toContain("{ a: number }");
    const full = declOf(ARRAY_PATTERN, [{ name: "a", abs: num }, { name: "b", abs: str }]);
    expect(full).toContain("[number, string]");
    expect(full).toContain("[ a, b ]");
    expect(declOf(OBJECT_PATTERN, [{ name: "a", abs: num }])).toContain("{ a: number }");
    expect(declOf(ARRAY_PATTERN)).toContain("number[]");
  });
}
});

// ---------------------------------------------------------------------------
// （产物半）— 形参表过滤 `this` 接收者标注
// ---------------------------------------------------------------------------
describe("（产物半）— 形参表过滤 `this` 接收者标注", () => {
/**
 * （**产物半**，service 侧）：TS 的 `this: T` 是**接收者标注**，不是
 * 运行时形参 —— 形参表多一槽 ⇒ **四个产物面同时失真**：
 * dts 多一个形参（消费方吃 TS2554 假红）、zod 多一个字面量槽 `"this"`
 * （对每一个真实调用值报假红）、standard 多一个幽灵导出 `<fn>_this`。
 *
 * 根因分层：
 * - **模型层**（core `formalParamsFromNodes` 的 Identifier 分支）：已排除名字
 * 为 `this` 的形参；
 * - **产物半**（本文件钉的）：`packages/service/src/analyzer-ast.ts` 的
 * `extractFormals` 是 service 侧**唯一的形参表入口**（dts / zod / standard /
 * case 四个产物面都从它取形参）⇒ 这里必须**兜底**过滤 `this`，并在过滤后
 * **重排 index**（index 是形参表内的位置 ⇒ 实参位靠它对齐）。
 *
 * 钉：
 * - `extractFormals` 不返回 `this` 形参、后续形参的 index 前移；
 * - dts 产物面保留 `this: T` 接收者子句（BUG-133；不是运行时形参）；
 * - 负控制：普通形参表不受影响（index 连续、`this` 之外的形参原样）。
 */







beforeEach(() => {
  resetAllAnalysisCaches();
});

/** 取源里第一个函数声明的节点。 */
function firstFnNode(source: string) {
  const file = parseSource(source);
  for (const stmt of file.program.body) {
    const node = stmt as { type: string; declaration?: { type: string } };
    if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "FunctionDeclaration") {
      return node.declaration as never;
    }
  }
  throw new Error("no function declaration found");
}

const WITH_THIS = `export function withThis(this: { x: number }, a: number): number {
  return a;
}
`;

{
  beforeEach(() => { resetAllAnalysisCaches(); });
  const firstFnNode = (source: string) => {
    const file = parseSource(source);
    for (const stmt of file.program.body) {
      const node = stmt as { type: string; declaration?: { type: string } };
      if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "FunctionDeclaration") return node.declaration as never;
    }
    throw new Error("no function declaration found");
  };
  const WITH_THIS = "export function withThis(this: { x: number }, a: number): number {\n  return a;\n}\n";
  it("extractFormals/ParamNames 不含 this 且 index 重排；dts 保留 this 接收者子句；普通表原样", () => {
    const formals = extractFormals(firstFnNode(WITH_THIS));
    expect(formals.map((f) => (f.kind === "id" ? f.name : f.kind))).toEqual(["a"]);
    expect(formals.map((f) => f.index)).toEqual([0]);
    expect(extractParamNames(firstFnNode(WITH_THIS))).toEqual(["a"]);
    const dts = generateDts(analyzeFile("/test/bug397-dts.ts", WITH_THIS));
    expect(dts).toContain("this: { x: number }");
    expect(dts).toContain("export declare function withThis(this: { x: number }, a:");
    const plain = extractFormals(firstFnNode("export function plain(a: number, b: string): string {\n  return b;\n}\n"));
    expect(plain.map((f) => f.index)).toEqual([0, 1]);
    expect(plain.map((f) => (f.kind === "id" ? f.name : f.kind))).toEqual(["a", "b"]);
  });
}
});

// ---------------------------------------------------------------------------
// （service 侧）— 推断面：entry@ 实参按 TS 声明类型
// ---------------------------------------------------------------------------
describe("（service 侧）— 推断面：entry@ 实参按 TS 声明类型", () => {
/**
 * （**service 侧**）回归钉：`.ts` 源的**形参类型注解**必须进
 * 推断面（entry@ 实参）与产物面（dts 形参类型）。
 *
 * 背景（`tmp/bugs/14-service-eval.md` ）：`.ts` 源里写好的
 * `a: string` 从未进入推断 —— 解析层把注解删了（core 侧已修：注解文本以
 * 旁路 `nudoTypeText` 留在 AST 上，经 `FormalParam.tsType` 带出），但
 * **service 侧还有两处没接线**（本文件钉的就是这两处）：
 *
 * 1. `analyzer-orchestrate-uncached-cases.ts` 的 entry@ 兜底评估：入口实参
 * 写死 `anyAbs` ⇒ `nudo test` 的 entry@ 实参显示 any，且合法 TypeScript
 * 拿到「参数无约束」的假红（`a.toUpperCase()` on any）。
 * 2. `emit/dts-generator.ts` 的声明位：形参类型从 case 观测值取，注解被丢掉
 * ⇒ `.d.ts` 形参退化成 `unknown`（产物比它所生成的源更弱）。
 *
 * 口径（与既有约定对齐）：
 * - **推断面**：声明类型 → Abs 形状，只映射 JS 一等类型
 * （string/number/boolean/bigint/symbol）；别名/泛型/对象类型**不映射**
 * ⇒ 回落 any（不猜）。与 core `ts-type-shape.ts` 同表。
 * - **产物面声明位优先级**：手写契约（sidecar / @nudo:contract）>
 * TS 声明注解 > case 观测值（既有口径「声明位取侧车契约」不被破坏；
 * `Case:` 行仍是观测值）。
 * - **无注解 = 无变化**：`.js` 源 / 未标注形参 ⇒ 推断面仍 any、产物面仍走
 * 既有 case-widen。
 */







beforeEach(() => {
  resetAllAnalysisCaches();
});

/** entry@ 兜底 case（合成路径的函数只有这一个见证） */
function entryCase(fn: FunctionAnalysis) {
  const c = fn.cases.find((x) => x.name.startsWith("entry@"));
  expect(c).toBeDefined();
  return c!;
}

/** dts 声明行 */
function declOf(source: string, file = "/test/bug479-service.ts"): string {
  return (
    generateDts(analyzeFile_____analyzer_ts(file, source))
      .split("\n")
      .find((l) => l.startsWith("export declare function")) ?? ""
  );
}

const TS_UPPER = `export function upper(a: string): string {
  return a.toUpperCase();
}
`;

const JS_UPPER = `export function upper(a) {
  return a.toUpperCase();
}
`;

{
  beforeEach(() => { resetAllAnalysisCaches(); });
  const entryCase = (fn: FunctionAnalysis) => { const c = fn.cases.find((x) => x.name.startsWith("entry@")); expect(c).toBeDefined(); return c!; };
  const declOf = (source: string, file = "/test/bug479-service.ts"): string => generateDts(analyzeFile(file, source)).split("\n").find((l) => l.startsWith("export declare function")) ?? "";
  const TS_UPPER = "export function upper(a: string): string {\n  return a.toUpperCase();\n}\n";
  const JS_UPPER = "export function upper(a) {\n  return a.toUpperCase();\n}\n";
  it("TS 注解映射 entry@ 实参；复合类型也进形状面（别名等仍回落 any）", () => {
    const upper = analyzeFile("/test/bug479-entry.ts", TS_UPPER).functions.find((f) => f.name === "upper")!;
    expect(formatShape(entryCase(upper).argAbs[0]!)).toBe("string");
    const add = analyzeFile("/test/bug479-entry2.ts", "export function add(x: number, y: number): number {\n  return x + y;\n}\n").functions.find((f) => f.name === "add")!;
    expect(entryCase(add).argAbs.map((a) => formatShape(a))).toEqual(["number", "number"]);
    const flag = analyzeFile("/test/bug479-entry3.ts", "export function flag(b: boolean): boolean {\n  return !b;\n}\n").functions.find((f) => f.name === "flag")!;
    expect(formatShape(entryCase(flag).argAbs[0]!)).toBe("boolean");
    expect(formatShape(entryCase(upper).throwsAbs)).toBe("never");
    expect(formatShape(entryCase(upper).abs)).toBe("string");
    const len = analyzeFile("/test/bug479-entry5.ts", "export function len(a: string[]): number {\n  return a.length;\n}\n").functions.find((f) => f.name === "len")!;
    // BUG-036：数组注解不再退 any（旧口径 `string[]` 不在 5 个 primitive 表里）
    expect(formatShape(entryCase(len).argAbs[0]!)).toBe("string[]");
    const alias = analyzeFile("/test/bug479-entry6.ts", "export function pick(a: Record<string, number>): number {\n  return a.x;\n}\n").functions.find((f) => f.name === "pick")!;
    expect(formatShape(entryCase(alias).argAbs[0]!)).toBe("any");
  });
}

describe("（service 侧）— 产物面：dts 形参保留 TS 注解", () => {
  beforeEach(() => { resetAllAnalysisCaches(); });
  const entryCase = (fn: FunctionAnalysis) => { const c = fn.cases.find((x) => x.name.startsWith("entry@")); expect(c).toBeDefined(); return c!; };
  const declOf = (source: string, file = "/test/bug479-service.ts"): string => generateDts(analyzeFile(file, source)).split("\n").find((l) => l.startsWith("export declare function")) ?? "";
  const TS_UPPER = "export function upper(a: string): string {\n  return a.toUpperCase();\n}\n";
  const JS_UPPER = "export function upper(a) {\n  return a.toUpperCase();\n}\n";
  it("string / string[] / 多形参 / rest / JSDoc 注解保留", () => {
    expect(declOf(TS_UPPER)).toContain("export declare function upper(a: string)");
    expect(declOf(TS_UPPER)).not.toContain("a: unknown");
    expect(declOf("export function len(a: string[]): number {\n  return a.length;\n}\n")).toContain("export declare function len(a: string[])");
    expect(declOf("export function add(x: number, y: number): number {\n  return x + y;\n}\n")).toContain("export declare function add(x: number, y: number)");
    expect(declOf("export function sum(...rest: number[]): number {\n  return rest.length;\n}\n")).toContain("...rest: number[]");
    const dts = generateDts(analyzeFile("/test/bug479-jsdoc.ts", TS_UPPER));
    expect(dts).toContain("@param a - string");
    expect(dts).not.toContain("@param a - unknown");
  });
});

describe("（service 侧）— 负控制：既有行为不得被波及", () => {
  beforeEach(() => { resetAllAnalysisCaches(); });
  const entryCase = (fn: FunctionAnalysis) => { const c = fn.cases.find((x) => x.name.startsWith("entry@")); expect(c).toBeDefined(); return c!; };
  const declOf = (source: string, file = "/test/bug479-service.ts"): string => generateDts(analyzeFile(file, source)).split("\n").find((l) => l.startsWith("export declare function")) ?? "";
  const TS_UPPER = "export function upper(a: string): string {\n  return a.toUpperCase();\n}\n";
  const JS_UPPER = "export function upper(a) {\n  return a.toUpperCase();\n}\n";
  it("js 无注解仍 any；dts unknown；ts 未标注仍 any；契约优先于注解；无契约注解生效", () => {
    const js = analyzeFile("/test/bug479-ctrl.js", JS_UPPER).functions.find((f) => f.name === "upper")!;
    expect(formatShape(entryCase(js).argAbs[0]!)).toBe("any");
    expect(formatShape(entryCase(js).throwsAbs)).toContain("TypeError");
    expect(declOf(JS_UPPER, "/test/bug479-ctrl.js")).toContain("export declare function upper(a: unknown)");
    const plain = analyzeFile("/test/bug479-ctrl2.ts", "export function plain(a): any {\n  return a;\n}\n").functions.find((f) => f.name === "plain")!;
    expect(formatShape(entryCase(plain).argAbs[0]!)).toBe("any");
    const fn = analyzeFile("/test/bug479-contract.ts", TS_UPPER).functions.find((f) => f.name === "upper")!;
    const withContract = projectFunctionDts(fn, { params: [{ name: "a", abs: numLit(1) }] }).lines.find((l) => l.startsWith("export declare function"))!;
    expect(withContract).toContain("a: number");
    expect(withContract).not.toContain("a: string");
    const noContract = projectFunctionDts(fn).lines.find((l) => l.startsWith("export declare function"))!;
    expect(noContract).toContain("a: string");
  });
});
});

// ---------------------------------------------------------------------------
// dts identifier is always a legal TS identifier
// ---------------------------------------------------------------------------
describe("dts identifier is always a legal TS identifier", () => {
/**
 * dts 投影不得产出非法 TS 标识符。
 *
 * 带 @nudo: 指令的类方法此前走**指令路径**，丢掉了顶层函数普查的
 * noDeclaration 分类 ⇒ dts 投影把作用域名 "C.m" 直接当函数名，产出
 * `export declare function C.m(x: number): unknown;`——tsc 报 TS1005 语法错，
 * 生成的 .d.ts 不可用（zod / standard / guard 三个面都清洗成 C_m*）。
 *
 * 本测试锁住：
 * ① 指令路径继承 noDeclaration 分类（与非指令路径同口径）
 * ② dts 投影出的函数名恒为合法 TS 标识符（双保险：非法名一律清洗）
 */





const CLASS_METHOD_WITH_DIRECTIVE = `export class C {
  /**
   * @nudo:case "m1" (1) => 2
   */
  m(x) { return x + 1; }
}
`;

{
  const CLASS_METHOD_WITH_DIRECTIVE = `export class C {\n  /**\n   * @nudo:case "m1" (1) => 2\n   */\n  m(x) { return x + 1; }\n}\n`;
  it("指令路径继承 noDeclaration；dts 清洗点号；防御门同样清洗", () => {
    const r = analyzeFile("/t/b494/class-method.js", CLASS_METHOD_WITH_DIRECTIVE);
    const fn = r.functions.find((f) => f.name === "C.m")!;
    expect(fn).toBeDefined();
    expect(fn.noDeclaration).toBe(true);
    const proj = projectFunctionDts(fn);
    const decl = proj.lines.find((l) => l.includes("export declare function"))!;
    expect(decl).toMatch(/export declare function C_m\b/);
    expect(proj.lines.join("\n")).not.toMatch(/C\.m/);
    const illegal: FunctionAnalysis = { name: "C.m", loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } }, paramNames: ["x"], cases: [{ name: "entry@L2", argAbs: [], abs: { shape: { k: "prim", type: "number" } } as never, throwsAbs: { shape: { k: "never" } } as never }] };
    const defensive = projectFunctionDts(illegal).lines.find((l) => l.includes("export declare function"))!;
    expect(defensive).toMatch(/export declare function C_m\b/);
  });
}
});

// ---------------------------------------------------------------------------
// 族 54 · service 协议面
// ---------------------------------------------------------------------------
describe("service 协议面", () => {
/**
 * 族 54 · service **协议面**（3 条缺口）的钉。
 *
 * 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）：
 * env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`，
 * **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支
 * 曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch
 * 门禁 ⇒ 不触发依赖源文件复分析）。
 * mock 前缀支锚在 **basename** 起点（绝对路径的 `/` 或相对路径的起点）。
 *
 * 第 2 条 —— hover 的 throws 段（service 侧可观测面）：
 * hover 只读 case 台账的 throws 证据（`AnalysisResult.functions[].cases[].throwsAbs`）
 * ⇒ service 必须**产出**这份证据。两种状态下此前拿不到函数级 throws 域
 * （check 签名行口径 = 入口求值的 hard throw ∪ soft may-throw）：
 * ① **有调用点见证**：`settleEntryOnlyCandidates` 把 `entry@` 见证连同 throws
 * 证据一起撤掉、改由 `call@` 见证承担调用点域 ⇒ 证据随见证一起消失；
 * ② **选中 case**：被选函数**不生成 `entry@` 见证**（域由选中的那条 case 声明）
 * ⇒ 函数级 throws 域在 case 台账里无处安放。
 * 修复后：证据并进该函数**已有**的见证 ⇒ 见证数不变、推断域不变（产物面不动）。
 *
 * 第 3 条 —— `migrate verify` 库面整批 abort：**缺陷不在 service 包**。
 * 取证（见报告）：`migrateVerify`（`packages/nudojs/src/migrate.ts`）**已经**
 * 逐文件隔离（同目标内部分文件语法错 ⇒ 失败文件记 `analysis-error`、成功文件
 * 照常返回）；仍整批 abort 的是同族的 `migrateStrip`（696 的库面半边）。
 * 两处都在 nudojs 包 ⇒ 不在本片（service）范围，本钉不含该例。
 */







/** env 模板族的扩展名表（三支同表）。 */
const ENV_TEMPLATE_EXTS = ["js", "mjs", "ts", "cjs", "cts", "mts"] as const;

{
  const ENV_TEMPLATE_EXTS = ["js", "mjs", "ts", "cjs", "cts", "mts"] as const;
  it("env 模板族扩展名：三支同表、basename 锚定、非模板负控", () => {
    for (const ext of ENV_TEMPLATE_EXTS) {
      expect(isEnvTemplatePath(`/env/mock-fs.${ext}`), ext).toBe(true);
      expect(isEnvTemplatePath(`/env/fs.mock.${ext}`), ext).toBe(true);
      expect(isEnvTemplatePath(`/env/custom.env.${ext}`), ext).toBe(true);
    }
    expect(isEnvTemplatePath("mock-fs.js")).toBe(true);
    expect(isEnvTemplatePath("fs.mock.js")).toBe(true);
    for (const p of ["/env/lib.js","/env/lib.ts","/env/lib.mjs","/env/mock-fs.json","/env/fs.mock.json","/env/custom.env.json","/env/mock-fs.d.txt","/env/mock-dir/lib.js","/env/not-mock-fs.js","/env/fs.mockish.js"]) {
      expect(isEnvTemplatePath(p), p).toBe(false);
    }
  });

  it("函数级 throws 证据：调用点/模块级/选中 case 都有，entry@ 负控不变", () => {
    const MAY_THROW_SRC = "export function risky(x) {\n  return x.foo;\n}\n";
    const callsiteSrc = `${MAY_THROW_SRC}export function run() {\n  return risky({});\n}\n`;
  {
      const dir = tmpProject("nudo-bug54-callsite-", { "main.js": callsiteSrc });
      const r = analyzeFile(`${dir}/main.js`, callsiteSrc);
      const fn = r.functions.find((f) => f.name === "risky")!;
      expect(fn.cases.map((c) => c.name)).toEqual(["call@L5"]);
      expect(fn.entryThrowsAbs).toBeDefined();
      expect(fn.entryThrowsAbs!.shape.k).not.toBe("never");
      expect(formatThrowsAbs(fn.entryThrowsAbs!)).toBe("TypeError");
      expect(fn.cases[0]!.throwsAbs.shape.k).toBe("never");
      expect(formatShape(fn.combinedAbs!)).toBe("undefined");
  }
  {
      const src = `${MAY_THROW_SRC}risky({});\n`;
      const dir = tmpProject("nudo-bug54-toplevel-", { "top.js": src });
      const r = analyzeFile(`${dir}/top.js`, src);
      const fn = r.functions.find((f) => f.name === "risky")!;
      expect(fn.cases.map((c) => c.name)).toEqual(["call@L4"]);
      expect(formatThrowsAbs(fn.entryThrowsAbs!)).toBe("TypeError");
      expect(fn.cases[0]!.throwsAbs.shape.k).toBe("never");
      expect(formatShape(fn.combinedAbs!)).toBe("undefined");
  }
  {
      const src = '/**\n * @nudo:case "c1" (1) => number()\n */\nexport function risky(x) {\n  return x.foo;\n}\n';
      const dir = tmpProject("nudo-bug54-selected-", { "sel.js": src });
      const r = analyzeFile(`${dir}/sel.js`, src, new Map([["risky", 0]]), undefined, undefined, "selected");
      const fn = r.functions.find((f) => f.name === "risky")!;
      expect(fn.cases.map((c) => c.name)).toEqual(["c1"]);
      expect(formatThrowsAbs(fn.entryThrowsAbs!)).toBe("TypeError");
      expect(formatShape(fn.combinedAbs!)).toBe("undefined");
  }
  {
      const dir = tmpProject("nudo-bug54-entry-", { "entry.js": MAY_THROW_SRC });
      const r = analyzeFile(`${dir}/entry.js`, MAY_THROW_SRC);
      const fn = r.functions.find((f) => f.name === "risky")!;
      expect(fn.cases.map((c) => c.name)).toEqual(["entry@L1"]);
      expect(formatThrowsAbs(fn.cases[0]!.throwsAbs)).toBe("TypeError");
      expect(formatShape(fn.combinedAbs!)).toBe("any");
  }
  });
}
});

// ---------------------------------------------------------------------------
// guard 导出名必须模块内去重（清洗碰撞不再产生同名导出）
// ---------------------------------------------------------------------------
describe("guard 导出名必须模块内去重（清洗碰撞不再产生同名导出）", () => {
/**
 * **guard 面**的导出名只过字符清洗（`safeExportIdent(name)`）⇒
 * **没有模块内去重集合** ⇒ 两个不同的源函数清洗后同名
 * （类方法 `A.b` 与顶层函数 `A_b` ⇒ 两个 `export function isA_bOutput`）
 * ⇒ 产物在 node 下 `SyntaxError: Identifier 'isA_bOutput' has already been
 * declared`、在 tsc 下 `TS2323` / `TS2393`。
 *
 * 修法（service 侧）：`generateGuardFunctionFromAbs(name, abs, used?)` 接受
 * **模块级去重集合**（与 zod 面 `safeExportIdent(name, used)` 同一套口径：
 * `isA_bOutput` / `isA_bOutput_2`）⇒ 调用方**按模块**传同一个集合即可消歧。
 *
 * 负控制：不传 `used` 时行为与旧版一致（只清洗、不去重）——旧调用方零影响。
 */




/** 产物里的 `export function <name>` 名字（按出现顺序）。 */
function exportedGuardNames(source: string): string[] {
  return [...source.matchAll(/export function (\w+)\(/g)].map((m) => m[1]!);
}

{
  const exportedGuardNames = (source: string): string[] => [...source.matchAll(/export function (\w+)\(/g)].map((m) => m[1]!);
  it("同 used 集合去重；不同名不受影响；不传 used 只清洗；字符清洗生效", () => {
    const used = new Set<string>();
    const a = generateGuardFunctionFromAbs("isA_bOutput", num(), used);
    const b = generateGuardFunctionFromAbs("isA_bOutput", num(), used);
    expect(exportedGuardNames(a)).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(b)).toEqual(["isA_bOutput_2"]);
    const names = exportedGuardNames([a, b].join("\n"));
    expect(new Set(names).size).toBe(names.length);

    const used2 = new Set<string>();
    const c = generateGuardFunctionFromAbs("isA_bOutput", num(), used2);
    const d = generateGuardFunctionFromAbs("isOtherOutput", num(), used2);
    const e = generateGuardFunctionFromAbs("isA_bOutput", num(), used2);
    expect(exportedGuardNames(c)).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(d)).toEqual(["isOtherOutput"]);
    expect(exportedGuardNames(e)).toEqual(["isA_bOutput_2"]);

    expect(exportedGuardNames(generateGuardFunctionFromAbs("isA_bOutput", num()))).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(generateGuardFunctionFromAbs("isA_bOutput", num()))).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(generateGuardFunctionFromAbs("isA.bOutput", num(), new Set<string>()))).toEqual(["isA_bOutput"]);
  });
}
});

// ---------------------------------------------------------------------------
// standard 返回面导出名恒为 <fn>Output（不随符号来源翻转）
// ---------------------------------------------------------------------------
describe("standard 返回面导出名恒为 <fn>Output（不随符号来源翻转）", () => {
/**
 * **standard 面**的返回面导出名与**符号来源耦合**：有契约返回叫
 * `<fn>Return`，走观测叫 `<fn>Output` ⇒ 同一函数在不同源码状态下拿到**不同
 * 名字** ⇒ 下游 `import { <fn>Output } from "*.nudo.standard"` 直接报错
 * （而同一次导出的 zod 面**恒叫** `<fn>Output` ⇒ 两面同物异名）。
 *
 * 修法（service 侧）：返回面的导出名**恒为 `<fn>Output`**（与 zod 面同名同义）
 * ——名字与来源**解耦**；内容仍按「契约返回优先，否则观测返回」取值。
 */





{
  const names = (src: string) => [...src.matchAll(/export const (\w+)/g)].map((m) => m[1]!);
  it("契约/观测/并存都恒为 <fn>Output；导出名集合相同；契约优先", async () => {
    const fromContract = absToStandardSchemaFunction({ fn: "alpha", inputs: [{ name: "x", abs: num() }], returns: num() });
    expect(fromContract.source).toContain("export const alphaOutput");
    expect(fromContract.source).not.toContain("export const alphaReturn");
    const contractMod = await loadGeneratedModule(fromContract.source);
    expect(contractMod.alphaOutput).toBeDefined();

    const fromObservation = absToStandardSchemaFunction({ fn: "alpha", inputs: [{ name: "x", abs: num() }], output: num() });
    expect(fromObservation.source).toContain("export const alphaOutput");
    expect(names(fromContract.source)).toEqual(names(fromObservation.source));
    expect(names(fromContract.source)).toEqual(["alpha_x", "alphaInput", "alphaOutput"]);

    const both = absToStandardSchemaFunction({ fn: "alpha", inputs: [{ name: "x", abs: num() }], returns: num(), output: num() });
    expect([...both.source.matchAll(/export const alphaOutput/g)].length).toBe(1);
    const bothMod = await loadGeneratedModule(both.source);
    expect(bothMod.alphaOutput!["~standard"].validate(1).issues).toBeUndefined();
  });
}
});

// ---------------------------------------------------------------------------
// standard 顶层形参的可选性必须保真（接受 undefined）
// ---------------------------------------------------------------------------
describe("standard 顶层形参的可选性必须保真（接受 undefined）", () => {
/**
 * **standard 面**把契约「顶层形参的**可选性**」整条丢掉：顶层形参
 * 导出走的是**独立值节点**（不是对象槽）⇒ 结构上**无处挂 `optional`** ⇒
 * 发布的 `act_x` 校验器**运行时拒收**契约允许的 `undefined`
 * （契约 `number().optional()` ⇒ `act_x.validate(undefined)` 应通过）。
 *
 * 修法（service 侧）：
 * - `StandardSchemaFunctionSpec.inputs[].optional`（契约级可选性，同 dts 面
 * `DtsContractFace.params[].optional` 口径）——`constraintToEntryAbs` 对标量
 * 契约丢掉 `isOptional`，故必须由契约面显式带过来；
 * - 声明级可选性（默认形参 `function f(a, b = 2)`）从 `spec.formals` 派生；
 * - 可选位的整参校验器 = `T | undefined`（与 zod 面 `.optional()` 同判据），
 * `<fn>Input` 的对应槽位带 `optional`（键可缺席）。
 */





/** 声明级默认形参 `function f(a, b = 2)` 的形参表面。 */
const defaultFormals: FormalParam[] = [
  { kind: "id", name: "a", index: 0 },
  { kind: "default", name: "b", index: 1 },
];

{
  const defaultFormals: FormalParam[] = [{ kind: "id", name: "a", index: 0 }, { kind: "default", name: "b", index: 1 }];
  it("契约/声明级可选接受 undefined；Input 槽可缺席；未申报可选拒收", async () => {
    const optional = absToStandardSchemaFunction({ fn: "act", inputs: [{ name: "x", abs: num(), optional: true }], formals: [{ kind: "id", name: "x", index: 0 }], output: num() });
    const mod = await loadGeneratedModule(optional.source);
    expect(mod.act_x!["~standard"].validate(undefined).issues).toBeUndefined();
    expect(mod.act_x!["~standard"].validate(1).issues).toBeUndefined();
    expect(mod.act_x!["~standard"].validate("hello").issues).toBeDefined();
    expect(mod.actInput!["~standard"].validate({}).issues).toBeUndefined();
    expect(mod.actInput!["~standard"].validate({ x: undefined }).issues).toBeUndefined();
    expect(mod.actInput!["~standard"].validate({ x: "hello" }).issues).toBeDefined();

    const declared = absToStandardSchemaFunction({ fn: "f", inputs: [{ name: "a", abs: num() }, { name: "b", abs: num() }], formals: defaultFormals, output: num() });
    const dmod = await loadGeneratedModule(declared.source);
    expect(dmod.f_b!["~standard"].validate(undefined).issues).toBeUndefined();
    expect(dmod.f_a!["~standard"].validate(undefined).issues).toBeDefined();

    const required = absToStandardSchemaFunction({ fn: "act", inputs: [{ name: "x", abs: num() }], formals: [{ kind: "id", name: "x", index: 0 }], output: num() });
    const rmod = await loadGeneratedModule(required.source);
    expect(rmod.act_x!["~standard"].validate(undefined).issues).toBeDefined();
    expect(rmod.actInput!["~standard"].validate({}).issues).toBeDefined();
  });
}
});

// ---------------------------------------------------------------------------
// defineEnv() 契约违约必须可见
// ---------------------------------------------------------------------------
describe("defineEnv() 契约违约必须可见", () => {
/**
 * path 型 env 文件违反 `defineEnv()` 契约（不导出 / 不是函数 /
 * 抛异常 / 返回非 {globals}）⇒ **零 env 诊断** ⇒ env 静默失效 ⇒ 用户代码被
 * 判「必然抛 ReferenceError」（假红），而同目录里**语法错**的 env 文件
 * 反而有 nudo:env-unresolved 警告（口径分裂）。
 *
 * 契约：四种违约形态各给一条明确诊断（复用 nudo:env-unresolved 通道），
 * 诊断必须点名 env 文件；契约满足时不得有该告警（负控制）。
 */







beforeEach(() => {
  clearPathEnvCaches();
});

/** 违约形态 → 期望诊断片段 */
const VIOLATIONS: Array<{ name: string; src: string; expect: string }> = [
  {
    name: "不导出 defineEnv",
    src: "export const notDefine = 1;\n",
    expect: "must export a defineEnv() function",
  },
  {
    name: "defineEnv 不是函数",
    src: "export const defineEnv = 42;\n",
    expect: "must export a defineEnv() function",
  },
  {
    name: "defineEnv 抛异常",
    src: 'export function defineEnv() { throw new Error("boom"); }\n',
    expect: "defineEnv() threw: boom",
  },
  {
    name: "返回 null",
    src: "export function defineEnv() { return null; }\n",
    expect: "must return { globals }",
  },
  {
    name: "返回 7",
    src: "export function defineEnv() { return 7; }\n",
    expect: "must return { globals }",
  },
  {
    name: "返回 {}（无 globals）",
    src: "export function defineEnv() { return {}; }\n",
    expect: "must return { globals }",
  },
];

{
  beforeEach(() => { clearPathEnvCaches(); });
  const VIOLATIONS = [
    { name: "不导出 defineEnv", src: "export const notDefine = 1;\n", expect: "must export a defineEnv() function" },
    { name: "defineEnv 不是函数", src: "export const defineEnv = 42;\n", expect: "must export a defineEnv() function" },
    { name: "defineEnv 抛异常", src: 'export function defineEnv() { throw new Error("boom"); }\n', expect: "defineEnv() threw: boom" },
    { name: "返回 null", src: "export function defineEnv() { return null; }\n", expect: "must return { globals }" },
    { name: "返回 7", src: "export function defineEnv() { return 7; }\n", expect: "must return { globals }" },
    { name: "返回 {}（无 globals）", src: "export function defineEnv() { return {}; }\n", expect: "must return { globals }" },
  ];
  it("六种违约各一条诊断点名 env 文件；结构违约装载期即报；契约满足/语法错负控", async () => {
    for (const v of VIOLATIONS) {
      const dir = tmpProject("nudo-bug-937-");
      const envFile = join(dir, "myenv.mjs");
      writeFileSync(envFile, v.src, "utf-8");
      await preloadPathEnvs(["./myenv.mjs"], dir);
      const loaded = loadEnvs(["./myenv.mjs"], createEnvironment(), dir);
      expect(Object.keys(loaded.globals), v.name).toHaveLength(0);
      const errs = getPathEnvLoadErrors(dir);
      expect(errs, v.name).toHaveLength(1);
      expect(errs[0]!.path, v.name).toBe(envFile);
      expect(errs[0]!.error, v.name).toContain(v.expect);
    }
    for (const src of ["export const notDefine = 1;\n", "export const defineEnv = 42;\n"]) {
      const dir = tmpProject("nudo-bug-937-struct-");
      const envFile = join(dir, "myenv.mjs");
      writeFileSync(envFile, src, "utf-8");
      await preloadPathEnvs(["./myenv.mjs"], dir);
      const errs = getPathEnvLoadErrors(dir);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.path).toBe(envFile);
      expect(errs[0]!.error).toContain("must export a defineEnv() function");
    }
  {
      const dir = tmpProject("nudo-bug-937-ok-");
      writeFileSync(join(dir, "myenv.mjs"), 'import { numLit } from "@nudojs/core";\nexport function defineEnv() {\n  return { globals: { MAGIC: numLit(42) } };\n}\n', "utf-8");
      await preloadPathEnvs(["./myenv.mjs"], dir);
      expect(getPathEnvLoadErrors(dir)).toHaveLength(0);
      const loaded = loadEnvs(["./myenv.mjs"], createEnvironment(), dir);
      expect(formatShape(loaded.globals.MAGIC!)).toBe("42");
  }
  {
      const dir = tmpProject("nudo-bug-937-syntax-");
      writeFileSync(join(dir, "myenv.mjs"), "export function defineEnv( {\n", "utf-8");
      await preloadPathEnvs(["./myenv.mjs"], dir);
      const errs = getPathEnvLoadErrors(dir);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.error).not.toContain("must export a defineEnv()");
  }
  });
}
});
