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
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { denoteGuard, formatThrowsAbs } from "@nudojs/core/internal";
import { generateGuardFunctionFromAbs } from "../emit/guard-generator.ts";
import { emitContract } from "../emit/contract-emitter.ts";
import { draftContract } from "../emit/contract-draft.ts";
import { analyzeFile as analyzeFile_____analyzer_ts, analyzeFile as analyzeFile_____analyzer_ts_1, analyzeFile as analyzeFile_____analyzer_ts_2, analyzeFile as analyzeFile_____analyzer_ts_3, analyzeFile as analyzeFile_____analyzer_ts_4 } from "../analyzer.ts";
import { extractFormals, extractParamNames } from "../analyzer-ast.ts";
import type { FunctionAnalysis } from "../analyzer-types.ts";
import { isEnvTemplatePath } from "../env-path-deps.ts";
import { tmpProject } from "./tmp-project.ts";
import { loadGeneratedModule } from "../emit/__tests__/fixtures.ts";
import { loadEnvs, preloadPathEnvs, getPathEnvLoadErrors, clearPathEnvCaches } from "../evaluator/env-loader.ts";

// ---------------------------------------------------------------------------
// Bug 191 — dts 面：访问器占位槽不得渲染成 exact undefined
// ---------------------------------------------------------------------------
describe("[] Bug 191 — dts 面：访问器占位槽不得渲染成 exact undefined", () => {
/**
 * Bug 191 回归（**dts 投影面**）：对象字面量访问器（getter）的占位槽
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

describe("Bug 191 — dts 面：访问器占位槽不得渲染成 exact undefined", () => {
  it("getter 返数字：dts 取读域 number（原生读 1）", () => {
    expect(declOf(`export function g() { return { get ab() { return 1; } }; }`)).toContain(
      "{ ab: 1 }",
    );
  });

  it("getter 返字符串：dts 取读域（原生读 \"s\"）", () => {
    expect(
      declOf(`export function g() { return { get ab() { return "s"; } }; }`),
    ).toContain('{ ab: "s" }');
  });

  it("getter 以 this 为接收者读域（原生 this.n = 41）", () => {
    expect(
      declOf(`export function g() { return { n: 41, get q() { return this.n; } }; }`),
    ).toContain("{ n: 41; q: 41 }");
  });

  it("嵌套对象的 getter 槽同样按读域渲染", () => {
    expect(
      declOf(`export function g() { return { inner: { get ab() { return 2; } } }; }`),
    ).toContain("{ inner: { ab: 2 } }");
  });

  it("getter 抛（读域不可刻画）→ unknown，不得回落 definite undefined", () => {
    expect(
      declOf(`export function g() { return { get boom() { throw new Error("x"); } }; }`),
    ).toContain("{ boom: unknown }");
  });

  it("dts 不得出现 exact undefined 的访问器槽", () => {
    const dts = dtsOf(`export function g() { return { get ab() { return 1; } }; }`);
    expect(dts).not.toContain("ab: undefined");
  });
});

describe("Bug 191 dts 负控制：非 getter 槽不受影响", () => {
  it("普通数据属性仍渲染成它的值类型", () => {
    expect(declOf(`export function g() { return { plain: 5 }; }`)).toContain("{ plain: 5 }");
  });

  it("显式 undefined 数据属性仍渲染成 undefined", () => {
    expect(declOf(`export function g() { return { u: undefined }; }`)).toContain(
      "{ u: undefined }",
    );
  });

  it("仅 setter 的访问器：原生读值恒 undefined，占位槽本就正确", () => {
    expect(declOf(`export function g() { return { set ab(v) {} }; }`)).toContain(
      "{ ab: undefined }",
    );
  });

  it("空对象渲染成 Record<string, never>（不是 TS 的 {}，Bug 565）", () => {
    // TS 的 `{}` = 任意非 nullish 值（不是「空对象」）⇒ 属性读吃 TS2339 假红，
    // 且在联合类型里吸收 `{ a: number }`（契约义务被静默作废）
    expect(declOf(`export function g() { return {}; }`)).toContain(
      "Record<string, never>",
    );
  });
});
});

// ---------------------------------------------------------------------------
// Bug 233: zod brand 节点不得引用无运行时值的名字
// ---------------------------------------------------------------------------
describe("[] Bug 233: zod brand 节点不得引用无运行时值的名字", () => {
/**
 * Bug 233 —— `nudo export --format schema` 把**生成器的 `constructor` brand**
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

describe("Bug 233: zod brand 节点不得引用无运行时值的名字", () => {
  it("生成器的 constructor brand 不再渲染成 z.instanceof(GeneratorFunction)", () => {
    const { source, dropped } = absToZodSchemaModule({ genOutput: generatorOutputAbs() });
    expect(source).not.toMatch(/z\.instanceof\([^)]*GeneratorFunction/);
    // 族 02 / Bug 240（S21）：`constructor` 是 **internal 槽**（原生挂在原型上，
    // 不是自有属性）⇒ core 约束面（`absToConstraint`）与投影面（`format.ts`）
    // 同口径剔除 internal 槽 ⇒ 产物里**连这个字段都没有**。
    // Bug 233 的不变量（"产物永远可 import"）由此更强地满足：没有名字需要
    // 解析，也就没有 ReferenceError 可言（不是"降级成 z.unknown()"）。
    expect(source).not.toContain("constructor");
    expect(source).not.toContain("GeneratorFunction");
    // 无可降级的 brand 名字 ⇒ 台账里也不再出现 GeneratorFunction
    expect(dropped.some((d) => d.includes("GeneratorFunction"))).toBe(false);
  });

  it("生成的 zod 模块可以求值（改前：ReferenceError: GeneratorFunction is not defined）", () => {
    const { source } = absToZodSchemaModule({ genOutput: generatorOutputAbs() });
    const r = evaluateZodModule(source, ["genOutput"]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it("负控制：求值夹具确实能抓到 ReferenceError（改前形态会红）", () => {
    const broken = 'import { z } from "zod";\nexport const genOutput = z.object({ constructor: z.instanceof(GeneratorFunction) });\n';
    const r = evaluateZodModule(broken, ["genOutput"]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("GeneratorFunction is not defined");
  });

  it("非全局 brand 降级 z.unknown() 并记 dropped", () => {
    for (const name of ["GeneratorFunction", "AsyncGeneratorFunction", "Widget", "Object.prototype"]) {
      const p = projectAbsToSchema(brandOf(name));
      expect(p.source, name).toBe("z.unknown()");
      expect(p.dropped.some((d) => d.includes(name)), name).toBe(true);
    }
  });

  it("负控制：运行时全局构造器仍走 z.instanceof（不得过度降级）", () => {
    expect(absToSchemaSource(brandOf("Date"))).toBe("z.instanceof(Date)");
    expect(absToSchemaSource(brandOf("Map"))).toBe("z.instanceof(Map)");
    expect(absToSchemaSource(brandOf("RegExp"))).toBe("z.instanceof(RegExp)");
    // 非 brand 形态不受影响（number prim 的域渲染见 Bug 1001：含 NaN / ±Infinity）
    expect(absToSchemaSource(num())).toContain("z.number()");
  });

  it("产物里的 z.instanceof 实参都是运行时全局构造器", () => {
    const mod = absToZodSchemaModule({ genOutput: generatorOutputAbs(), d: brandOf("Date") });
    const names = [...mod.source.matchAll(/z\.instanceof\(([^)]*)\)/g)].map((m) => m[1]!);
    for (const name of names) {
      const v = (globalThis as Record<string, unknown>)[name];
      expect(typeof v, name).toBe("function");
    }
  });

  it("standard 面不受影响（brand 走 JSON 节点，不引用类名）", () => {
    const mod = absToStandardSchemaModule({ out: brandOf("GeneratorFunction") });
    expect(mod.source).not.toContain("z.instanceof");
    expect(mod.source).toContain('"~standard"');
  });
});
});

// ---------------------------------------------------------------------------
// BUG-025 — standard 方言的 promise 节点不再放行一切
// ---------------------------------------------------------------------------
describe("[] BUG-025 — standard 方言的 promise 节点不再放行一切", () => {
/**
 * BUG-025 —— `nudo export --format standard` 的 `promise` 分支**放行一切**
 * ⇒ 非 Promise 值被校验器接受，而同一份 Abs 的 zod 面（`z.promise`）与 guard
 * 面（`data instanceof Promise`）都拒绝 ⇒ 同一 Abs 在两个方言里给出相反裁决。
 *
 * 根因：`standard-schema.ts` 的 `case "promise": return;` 把「不展开 thenable」
 * 误实现成「不做任何检查」（库函数版与内联进产物的拷贝各一处）。
 *
 * 本钉：promise 节点必须判「是不是 Promise」（值域不展开，但类型判据在）。
 */




const promiseNode: SchemaNode = { k: "promise", inner: { k: "unknown" } };

describe("BUG-025 — standard 方言的 promise 节点不再放行一切", () => {
  it("非 Promise 值被拒绝（42 / 'str' / {}）", () => {
    for (const bad of [42, "str", {}, null, undefined]) {
      const r = validateSchemaNode(promiseNode, bad);
      expect("issues" in r).toBe(true);
      expect(r.issues?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("Promise 与 thenable 的判据与 zod 面同口径（真 Promise 放行）", () => {
    const r = validateSchemaNode(promiseNode, Promise.resolve(1));
    expect("issues" in r).toBe(false);
  });

  it("负控制：unknown 节点仍放行一切（不把 promise 的收窄扩散）", () => {
    const r = validateSchemaNode({ k: "unknown" }, 42);
    expect("issues" in r).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 027 · 契约的 union 字面量域必须在 dts 面保形
// ---------------------------------------------------------------------------
describe("[] Bug 027 · 契约的 union 字面量域必须在 dts 面保形", () => {
/**
 * Bug 027 —— `export --format dts` 把**非同 prim 的字面量 union** 拓宽成基类型
 * ⇒ 发布的 `.d.ts` 允许契约违约的调用（双门禁对撞）。
 *
 * 同一次运行、同一份契约三个面三种说法：
 *   check 签名   `pick(v: lit(1) | lit("x")) => number | string`
 *   dts（改前）  `pick(v: number | string): number | string`   ← **拓宽**
 *   zod          `z.union([z.literal(1), z.literal("x")])`      ← 保字面量
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

describe("Bug 027 · 契约的 union 字面量域必须在 dts 面保形", () => {
  it("非同 prim 字面量 union ⇒ `1 | \"x\"`（改前 `number | string`）", () => {
    const text = dtsOf(union(litC(1), litC("x")));
    expect(text).toContain(`export declare function pick(v: 1 | "x"): 1 | "x";`);
    // 拓宽的痕迹不得出现（形参位 / 返回位都不行）
    expect(text).not.toContain("number | string");
  });

  it("同 prim 字面量 union 仍保形（回归钉）", () => {
    const text = dtsOf(union(litC("a"), litC("b")));
    expect(text).toContain(`pick(v: "a" | "b"): "a" | "b"`);
  });

  it("含 nullish 字面量的混合 union 也保形（字面量在 term 里也要读）", () => {
    const text = dtsOf(union(litC(1), litC(null)));
    expect(text).toContain("pick(v: 1 | null)");
  });

  it("负控制：成员不是字面量域（union(number(), string())）仍按 widen 口径", () => {
    const text = dtsOf(union(number(), string()));
    expect(text).toContain("pick(v: number | string): number | string");
  });

  it("负控制：带界成员（union(number().gt(0), lit(0))）不整体当字面量域", () => {
    const text = dtsOf(union(number().gt(0), litC(0)));
    // 有界成员不可表达为有限字面量集 ⇒ 整条不保形（回落 widen）
    expect(text).toContain("pick(v: number): number");
  });
});
});

// ---------------------------------------------------------------------------
// BUG-032 —— bigint 字面量保基类型
// ---------------------------------------------------------------------------
describe("[] BUG-032 —— bigint 字面量保基类型", () => {
/**
 * BUG-032 —— export 的 zod / standard 两个方言把**已知的 bigint 字面量**
 * 整条降级成 `unknown`（连基类型都没保住）⇒ 校验器接受**任何**值；
 * 而 guard 面（`data === 10n`）与 dts 面（`bigint`）都保住了基类型
 * ⇒ 三面接受集不相交。
 *
 * 修法：观测路径上的 bigint 字面量保**基类型**（`z.bigint()` /
 * `{"k":"prim","type":"bigint"}`），字面量精度进 dropped 台账。
 */




const bigintLit = (v: bigint) => abs({ k: "prim", type: "bigint" }, { op: "lit", value: v }, undefined, "exact");

describe("BUG-032 —— bigint 字面量保基类型", () => {
  it("zod 方言：z.bigint()（不是 z.unknown()）", () => {
    const p = projectAbsToSchema(bigintLit(10n), { dialect: "zod" });
    expect(p.source).toBe("z.bigint()");
    // 字面量精度损失必须留痕
    expect(p.dropped.join("\n")).toContain("lit bigint not projected: 10");
  });

  it("schema 节点：prim bigint（standard 方言据此渲染 prim 校验）", () => {
    const { node } = absToSchemaNode(bigintLit(10n));
    expect(node).toEqual({ k: "prim", type: "bigint", refinements: [] });
  });
});
});

// ---------------------------------------------------------------------------
// BUG-080 残留 — @nudo:as 目标形态不支持 ⇒ 显式诊断（不许静默）
// ---------------------------------------------------------------------------
describe("[] BUG-080 残留 — @nudo:as 目标形态不支持 ⇒ 显式诊断（不许静默）", () => {
/**
 * BUG-080 残留（service 指令面）：`@nudo:as` 覆盖只施加在
 * **VariableDeclaration 的 init** 与 **ReturnStatement 的值**上（文档口径）
 * ⇒ 标注在**其它语句形态**（for 头 / for-init / if / 表达式语句 / 函数声明 …）
 * 上的 `@nudo:as` **无适用目标**。
 *
 * 改前：这类指令被**采集**（asTargets 非空）却**静默失效**——类型没变、
 * 零诊断（用户毫无痕迹的假绿）。
 *
 * 改后：按 BUG-080 的修复方向（不许静默）⇒ 目标形态不支持时发一条显式
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

describe("BUG-080 残留 — @nudo:as 目标形态不支持 ⇒ 显式诊断（不许静默）", () => {
  it("for 头（for-of 解构）：诊断一条，覆盖不生效", () => {
    const src = `export function f(xs) {
  // @nudo:as shape({ a: number() })
  for (const { a } of xs) { return a; }
  return 0;
}
`;
    const { reps, diags } = collect(src);
    const bad = diags.filter((d) => d.code === "nudo:directive-syntax");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.message).toContain("@nudo:as");
    // 不适用 ⇒ 不登记覆盖目标（覆盖值不会被注入）
    expect(reps.asTargets).toHaveLength(0);
  });

  it("表达式语句：诊断一条", () => {
    const src = `export function f(x) {
  // @nudo:as number()
  g(x);
  return 1;
}
`;
    const { diags } = collect(src);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(1);
  });

  it("函数声明：诊断一条", () => {
    const src = `// @nudo:as number()
export function f() { return 1; }
`;
    const { diags } = collect(src);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(1);
  });

  it("负控制：变量声明 / return / export 声明 ⇒ 零诊断，覆盖照常生效", () => {
    const varDecl = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const config = JSON.parse(content);
  return config;
}
`;
    const { reps, diags } = collect(varDecl);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(reps.asTargets).toHaveLength(1);
    expect(sigOf(check(varDecl), "f")).toContain("{ port: number, host: string }");

    const ret = `export function f(content) {
  // @nudo:as shape({ port: number() })
  return JSON.parse(content);
}
`;
    expect(collect(ret).diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(collect(ret).reps.asTargets).toHaveLength(1);

    const exp = `// @nudo:as number()
export const raw = 1;
`;
    expect(collect(exp).diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(collect(exp).reps.asTargets).toHaveLength(1);
  });

  it("负控制：解构声明上的 @nudo:as 仍生效（BUG-080 主修复不退化）", () => {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port, host } = JSON.parse(content);
  return { port, host };
}
`;
    const { reps, diags } = collect(src);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(reps.asTargets).toHaveLength(1);
    expect(sigOf(check(src), "f")).toContain("{ port: number, host: string }");
  });
});
});

// ---------------------------------------------------------------------------
// BUG-203 —— zod 长度界按 UTF-16 码元
// ---------------------------------------------------------------------------
describe("[] BUG-203 —— zod 长度界按 UTF-16 码元", () => {
/**
 * BUG-203 —— zod 面把 Abs 的长度界（**UTF-16 码元**）一对一映射成 zod v4 的
 * `.min()/.max()`（**Unicode 码点**）⇒ 含星平面字符时 zod 面与契约 / guard /
 * standard 三面裁决相反（min 假红 / max 假绿）⇒ 四面互斥。
 *
 * 修法：用 `refine` 显式按 UTF-16 长度判定，与 guard 面的 `data.length >= n`、
 * standard 面的 `strMin/strMax` 同口径。
 */



describe("BUG-203 —— zod 长度界按 UTF-16 码元", () => {
  it("strMin / strMax 用 refine 写 .length（不是 .min()/.max()）", () => {
    const min = schemaNodeToZod({
      k: "prim",
      type: "string",
      refinements: [{ kind: "strMin", n: 2 }],
    });
    expect(min).toBe("z.string().refine((s) => s.length >= 2)");
    expect(min).not.toContain(".min(2)");

    const max = schemaNodeToZod({
      k: "prim",
      type: "string",
      refinements: [{ kind: "strMax", n: 1 }],
    });
    expect(max).toBe("z.string().refine((s) => s.length <= 1)");
    expect(max).not.toContain(".max(1)");
  });

  it("对照：无长度界时仍是纯 z.string()", () => {
    expect(schemaNodeToZod({ k: "prim", type: "string", refinements: [] })).toBe("z.string()");
  });
});
});

// ---------------------------------------------------------------------------
// BUG-214 —— dts 不发布调用点观测的字面量
// ---------------------------------------------------------------------------
describe("[] BUG-214 —— dts 不发布调用点观测的字面量", () => {
/**
 * BUG-214 —— `export --format dts` 把**一次调用点观测到的字面量**当成函数的
 * TS 声明发布：返回位的**对象槽字面量不拓宽** ⇒ 消费端 `tsc --strict` 对
 * **合法代码**报 TS2367（把 `{ a: number }` 谎报成 `{ a: 1 }`）。
 *
 * 修法：纯 `call@` 观测（没有 `@nudo:case` 断言 / 入口泛化）的返回位，对象槽
 * 里的标量字面量剥到基类型。带断言的 case 与入口泛化维持「嵌套精度保留」。
 */




describe("BUG-214 —— dts 不发布调用点观测的字面量", () => {
  it("纯调用点观测：返回位对象槽字面量 → 基类型", () => {
    const dts = generateDts(
      analyzeFile(
        "/test/bug214.js",
        `export function mk(n) {\n  return { a: n, b: "s" };\n}\n\nmk(1);\n`,
      ),
    );
    // 观测点字面量不得直通进发布的**声明**（Case: 行是 JSDoc 见证，允许保留）
    const decl = dts.split("\n").find((l) => l.includes("export declare function mk")) ?? "";
    expect(decl).toBe("export declare function mk(n: number): { a: number; b: string };");
  });

  it("无调用点的入口泛化仍保留嵌套精度（对照组，Bug 565 口径）", () => {
    const dts = generateDts(
      analyzeFile("/test/bug214b.js", `export function one() {\n  return { a: 1 };\n}\n`),
    );
    expect(dts).toContain("{ a: 1 }");
  });
});
});

// ---------------------------------------------------------------------------
// BUG-250 — 内建 brand 的 guard 产物必须过 tsc --strict
// ---------------------------------------------------------------------------
describe("[] BUG-250 — 内建 brand 的 guard 产物必须过 tsc --strict", () => {
/**
 * BUG-250 —— guard 产物因 brand 的 `instanceof` **类型收窄**过不了
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

describe("BUG-250 — 内建 brand 的 guard 产物必须过 tsc --strict", () => {
  it("产物真跑 tsc --noEmit --strict（改前 TS7053 ×2）", () => {
    const source = generateGuardFunctionFromAbs("isbytesOutput", uint8Abs());
    // 身份子句会收窄 `data` ⇒ 声明必须是 `: any`（否则索引读报 TS7053）
    expect(source).toContain("const data: any = value as Record<string, any>;");
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug250-"));
    dirs.push(dir);
    const p = join(dir, "lib.nudo.guard.ts");
    writeFileSync(p, source + "\n", "utf-8");
    let failure = "";
    try {
      execFileSync(
        "pnpm",
        ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", p],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      failure = `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}`;
    }
    expect(failure).toBe("");
  });

  it("运行时语义不变：接受合法 Uint8Array，拒绝普通对象", () => {
    const check = new Function("data", `return ${denoteGuard(uint8Abs(), "data")};`) as (
      v: unknown,
    ) => boolean;
    expect(check(new Uint8Array([1, 2]))).toBe(true);
    expect(check({ 0: 1, 1: 2, length: 2 })).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// BUG-271 —— core import 不得豁免 builder 声明头
// ---------------------------------------------------------------------------
describe("[] BUG-271 —— core import 不得豁免 builder 声明头", () => {
/**
 * BUG-271 —— `.nudo.ts` 侧车里**已有**的 `import { lit } from "@nudojs/core";`
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

describe("BUG-271 —— core import 不得豁免 builder 声明头", () => {
  it("侧车已有 `import { lit }` ⇒ 仍补 litC 声明（别名，不撞名）", async () => {
    const file = join(dir, "lit.ts");
    writeFileSync(file, SRC);
    writeFileSync(join(dir, "lit.nudo.ts"), `import { fn, lit } from "@nudojs/core";\n`);

    const r = await emitContract(file, { mode: "update", all: true });
    expect(r.written).toContain("f");

    const after = readFileSync(join(dir, "lit.nudo.ts"), "utf-8");
    // 已有的 `import { lit }` 绑定的是 Term 构造器 ⇒ 声明头不得被它抑制
    expect(after).toContain(`typeof import("@nudojs/core").litC;`);
    // 撞名 ⇒ 起别名，且 DSL 的 lit( 调用改写到别名上
    const alias = /declare const (_nudo_lit\w*): typeof import\("@nudojs\/core"\)\.litC;/.exec(
      after,
    )?.[1];
    expect(alias).toBeDefined();
    expect(after).toContain(`${alias}(1)`);
    expect(after).not.toMatch(/(?<![A-Za-z0-9_$])lit\(1\)/);
  });

  it("对照组：侧车不含 `import { lit }` ⇒ 直接声明 `lit`（无需别名）", async () => {
    const file = join(dir, "lit2.ts");
    writeFileSync(file, SRC);
    writeFileSync(join(dir, "lit2.nudo.ts"), `// empty sidecar\n`);

    await emitContract(file, { mode: "update", all: true });
    const after = readFileSync(join(dir, "lit2.nudo.ts"), "utf-8");
    expect(after).toContain(`declare const lit: typeof import("@nudojs/core").litC;`);
    expect(after).toContain("lit(1)");
  });
});
});

// ---------------------------------------------------------------------------
// BUG-272 —— 草稿 builder import ⊆ 真正被调用的 builder
// ---------------------------------------------------------------------------
describe("[] BUG-272 —— 草稿 builder import ⊆ 真正被调用的 builder", () => {
/**
 * BUG-272 —— 草稿的 builder import 列表用**词边界**（`\bname\b`）扫 DSL ⇒
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

describe("BUG-272 —— 草稿 builder import ⊆ 真正被调用的 builder", () => {
  it("字段名叫 `lit` 不得把 `lit` 拖进 import（DSL 从未调用 lit(）", async () => {
    const file = join(dir, "lit.ts");
    writeFileSync(
      file,
      `export function f(o) {\n  return o.lit;\n}\nf({ lit: 1 });\n`,
    );
    const r = await draftContract(file);
    const line = importLine(r.draftSource);
    expect(line).toContain("fn");
    expect(line).toContain("shape");
    expect(line).toContain("number");
    expect(line).not.toMatch(/(?<![\w$])lit(?![A-Za-z0-9_$])/);
    // 草稿的 DSL 行里确实没有 lit( 调用（注释里的 /* observed: … */ 是见证，不算）
    const dsl = r.draftSource
      .split("\n")
      .filter((l) => /^export const f = /.test(l))
      .join("\n");
    expect(dsl).not.toMatch(/(?<![\w$])lit\s*\(/);
  });

  it("对照组：字段名改成 `lam` ⇒ 同一个 import 列表（唯一变量是字段名）", async () => {
    const file = join(dir, "lam.ts");
    writeFileSync(
      file,
      `export function f(o) {\n  return o.lam;\n}\nf({ lam: 1 });\n`,
    );
    const r = await draftContract(file);
    expect(importLine(r.draftSource)).not.toMatch(/(?<![\w$])lit(?![A-Za-z0-9_$])/);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 394（service 侧）— dts 面：数组解构的输入面是元组，不是对象
// ---------------------------------------------------------------------------
describe("[] Bug 394（service 侧）— dts 面：数组解构的输入面是元组，不是对象", () => {
/**
 * Bug 394（**service 侧**，dts 产物面）：**数组解构**形参的字段级侧车契约
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

describe("Bug 394（service 侧）— dts 面：数组解构的输入面是元组，不是对象", () => {
  it("部分覆盖（契约只写 a）⇒ 形参类型是元组（改前是 { a: number }）", () => {
    const decl = declOf(ARRAY_PATTERN, [{ name: "a", abs: num }]);
    expect(decl).toContain("[number, unknown]");
    expect(decl).not.toContain("{ a: number }");
  });

  it("全覆盖（契约写 a 与 b）⇒ 形参类型是元组、声明名是数组形态", () => {
    const decl = declOf(ARRAY_PATTERN, [
      { name: "a", abs: num },
      { name: "b", abs: str },
    ]);
    expect(decl).toContain("[number, string]");
    expect(decl).toContain("[ a, b ]");
    expect(decl).not.toContain("{ a: number }");
  });

  it("负控制：对象解构的字段级契约仍聚合成对象（既有口径不变）", () => {
    const decl = declOf(OBJECT_PATTERN, [{ name: "a", abs: num }]);
    expect(decl).toContain("{ a: number }");
  });

  it("负控制：无契约时仍是观测面（number[]），不被本次改动波及", () => {
    const decl = declOf(ARRAY_PATTERN);
    expect(decl).toContain("number[]");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 397（产物半）— 形参表过滤 `this` 接收者标注
// ---------------------------------------------------------------------------
describe("[] Bug 397（产物半）— 形参表过滤 `this` 接收者标注", () => {
/**
 * Bug 397（**产物半**，service 侧）：TS 的 `this: T` 是**接收者标注**，不是
 * 运行时形参 —— 形参表多一槽 ⇒ **四个产物面同时失真**：
 * dts 多一个形参（消费方吃 TS2554 假红）、zod 多一个字面量槽 `"this"`
 * （对每一个真实调用值报假红）、standard 多一个幽灵导出 `<fn>_this`。
 *
 * 根因分层：
 * - **模型层**（core `formalParamsFromNodes` 的 Identifier 分支）：已排除名字
 *   为 `this` 的形参；
 * - **产物半**（本文件钉的）：`packages/service/src/analyzer-ast.ts` 的
 *   `extractFormals` 是 service 侧**唯一的形参表入口**（dts / zod / standard /
 *   case 四个产物面都从它取形参）⇒ 这里必须**兜底**过滤 `this`，并在过滤后
 *   **重排 index**（index 是形参表内的位置 ⇒ 实参位靠它对齐）。
 *
 * 钉：
 * - `extractFormals` 不返回 `this` 形参、后续形参的 index 前移；
 * - dts 产物面没有 `this` 形参；
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

describe("Bug 397（产物半）— 形参表过滤 `this` 接收者标注", () => {
  it("extractFormals 不返回 `this` 形参", () => {
    const formals = extractFormals(firstFnNode(WITH_THIS));
    expect(formals.map((f) => (f.kind === "id" ? f.name : f.kind))).toEqual(["a"]);
  });

  it("过滤后 index 重排（`this` 不占实参位 ⇒ 后续形参前移）", () => {
    const formals = extractFormals(firstFnNode(WITH_THIS));
    expect(formals.map((f) => f.index)).toEqual([0]);
    expect(formals[0]!.kind === "id" && formals[0]!.name).toBe("a");
  });

  it("extractParamNames（产物面的槽名来源）不含 `this`", () => {
    expect(extractParamNames(firstFnNode(WITH_THIS))).toEqual(["a"]);
  });

  it("dts 产物面没有 `this` 形参（消费方不该吃 TS2554 假红）", () => {
    const dts = generateDts(analyzeFile_____analyzer_ts_1("/test/bug397-dts.ts", WITH_THIS));
    expect(dts).not.toContain("this:");
    expect(dts).toContain("export declare function withThis(a:");
  });

  it("负控制：没有 `this` 标注时形参表原样（index 连续、名字不变）", () => {
    const formals = extractFormals(
      firstFnNode(`export function plain(a: number, b: string): string {\n  return b;\n}\n`),
    );
    expect(formals.map((f) => f.index)).toEqual([0, 1]);
    expect(formals.map((f) => (f.kind === "id" ? f.name : f.kind))).toEqual(["a", "b"]);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 479（service 侧）— 推断面：entry@ 实参按 TS 声明类型
// ---------------------------------------------------------------------------
describe("[] Bug 479（service 侧）— 推断面：entry@ 实参按 TS 声明类型", () => {
/**
 * Bug 479（**service 侧**）回归钉：`.ts` 源的**形参类型注解**必须进
 * 推断面（entry@ 实参）与产物面（dts 形参类型）。
 *
 * 背景（`tmp/bugs/14-service-eval.md` Bug 479）：`.ts` 源里写好的
 * `a: string` 从未进入推断 —— 解析层把注解删了（core 侧已修：注解文本以
 * 旁路 `nudoTypeText` 留在 AST 上，经 `FormalParam.tsType` 带出），但
 * **service 侧还有两处没接线**（本文件钉的就是这两处）：
 *
 * 1. `analyzer-orchestrate-uncached-cases.ts` 的 entry@ 兜底评估：入口实参
 *    写死 `anyAbs` ⇒ `nudo test` 的 entry@ 实参显示 any，且合法 TypeScript
 *    拿到「参数无约束」的假红（`a.toUpperCase()` on any）。
 * 2. `emit/dts-generator.ts` 的声明位：形参类型从 case 观测值取，注解被丢掉
 *    ⇒ `.d.ts` 形参退化成 `unknown`（产物比它所生成的源更弱）。
 *
 * 口径（与既有约定对齐）：
 * - **推断面**：声明类型 → Abs 形状，只映射 JS 一等类型
 *   （string/number/boolean/bigint/symbol）；别名/泛型/对象类型**不映射**
 *   ⇒ 回落 any（不猜）。与 core `ts-type-shape.ts` 同表。
 * - **产物面声明位优先级**：手写契约（sidecar / @nudo:contract）>
 *   TS 声明注解 > case 观测值（既有口径「声明位取侧车契约」不被破坏；
 *   `Case:` 行仍是观测值）。
 * - **无注解 = 无变化**：`.js` 源 / 未标注形参 ⇒ 推断面仍 any、产物面仍走
 *   既有 case-widen。
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
    generateDts(analyzeFile_____analyzer_ts_2(file, source))
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

describe("Bug 479（service 侧）— 推断面：entry@ 实参按 TS 声明类型", () => {
  it("`.ts` 的 string 形参：entry@ 实参是 string（改前是 any）", () => {
    const result = analyzeFile_____analyzer_ts_2("/test/bug479-entry.ts", TS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("string");
  });

  it("`.ts` 的多个形参：各自按声明类型（number / number）", () => {
    const result = analyzeFile_____analyzer_ts_2(
      "/test/bug479-entry2.ts",
      `export function add(x: number, y: number): number {\n  return x + y;\n}\n`,
    );
    const fn = result.functions.find((f) => f.name === "add")!;
    expect(entryCase(fn).argAbs.map((a) => formatShape(a))).toEqual(["number", "number"]);
  });

  it("`.ts` 的 boolean 形参：entry@ 实参是 boolean", () => {
    const result = analyzeFile_____analyzer_ts_2(
      "/test/bug479-entry3.ts",
      `export function flag(b: boolean): boolean {\n  return !b;\n}\n`,
    );
    const fn = result.functions.find((f) => f.name === "flag")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("boolean");
  });

  it("合法 TypeScript 不再因「参数无约束」在 entry@ 抛 TypeError（改前抛）", () => {
    const result = analyzeFile_____analyzer_ts_2("/test/bug479-entry4.ts", TS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    expect(formatShape(entryCase(fn).throwsAbs)).toBe("never");
    // 推出来的返回值也跟着收窄（a 是 string ⇒ a.toUpperCase() 是 string）
    expect(formatShape(entryCase(fn).abs)).toBe("string");
  });

  it("不可映射的声明类型（string[]）：实参仍回落 any（不猜）", () => {
    const result = analyzeFile_____analyzer_ts_2(
      "/test/bug479-entry5.ts",
      `export function len(a: string[]): number {\n  return a.length;\n}\n`,
    );
    const fn = result.functions.find((f) => f.name === "len")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("any");
  });
});

describe("Bug 479（service 侧）— 产物面：dts 形参保留 TS 注解", () => {
  it("dts 形参保留 string 注解（改前是 unknown）", () => {
    expect(declOf(TS_UPPER)).toContain("export declare function upper(a: string)");
    expect(declOf(TS_UPPER)).not.toContain("a: unknown");
  });

  it("dts 形参保留不可映射的 string[] 注解（产物不得比源更弱）", () => {
    const decl = declOf(
      `export function len(a: string[]): number {\n  return a.length;\n}\n`,
    );
    expect(decl).toContain("export declare function len(a: string[])");
  });

  it("dts 多个形参各自保留注解", () => {
    const decl = declOf(
      `export function add(x: number, y: number): number {\n  return x + y;\n}\n`,
    );
    expect(decl).toContain("export declare function add(x: number, y: number)");
  });

  it("dts rest 形参保留数组注解（...rest: string[]）", () => {
    const decl = declOf(
      `export function sum(...rest: number[]): number {\n  return rest.length;\n}\n`,
    );
    expect(decl).toContain("...rest: number[]");
  });

  it("dts 的 JSDoc @param 与声明位一致（string，不是 unknown）", () => {
    const dts = generateDts(analyzeFile_____analyzer_ts_2("/test/bug479-jsdoc.ts", TS_UPPER));
    expect(dts).toContain("@param a - string");
    expect(dts).not.toContain("@param a - unknown");
  });
});

describe("Bug 479（service 侧）— 负控制：既有行为不得被波及", () => {
  it("同形 `.js` 源（无注解）：entry@ 实参仍是 any、仍抛 TypeError", () => {
    const result = analyzeFile_____analyzer_ts_2("/test/bug479-ctrl.js", JS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("any");
    expect(formatShape(entryCase(fn).throwsAbs)).toContain("TypeError");
  });

  it("同形 `.js` 源（无注解）：dts 形参是 unknown（TS 投影面归一）", () => {
    // Abs any（未约束）→ TS unknown（nudo any ≈ TS unknown；abs.md 只管展示面）
    expect(declOf(JS_UPPER, "/test/bug479-ctrl.js")).toContain(
      "export declare function upper(a: unknown)",
    );
  });

  it("`.ts` 源里未标注的形参：仍是 any（无注解 = 无约束）", () => {
    const result = analyzeFile_____analyzer_ts_2(
      "/test/bug479-ctrl2.ts",
      `export function plain(a): any {\n  return a;\n}\n`,
    );
    const fn = result.functions.find((f) => f.name === "plain")!;
    expect(formatShape(entryCase(fn).argAbs[0]!)).toBe("any");
  });

  it("手写契约仍优先于 TS 注解（既有口径「声明位取侧车契约」）", () => {
    const result = analyzeFile_____analyzer_ts_2("/test/bug479-contract.ts", TS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    const proj = projectFunctionDts(fn, { params: [{ name: "a", abs: numLit(1) }] });
    const decl = proj.lines.find((l) => l.startsWith("export declare function"))!;
    expect(decl).toContain("a: number");
    expect(decl).not.toContain("a: string");
  });

  it("无契约时 TS 注解生效（同一函数，去掉契约面后是 string）", () => {
    const result = analyzeFile_____analyzer_ts_2("/test/bug479-contract2.ts", TS_UPPER);
    const fn = result.functions.find((f) => f.name === "upper")!;
    const proj = projectFunctionDts(fn);
    const decl = proj.lines.find((l) => l.startsWith("export declare function"))!;
    expect(decl).toContain("a: string");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 494 — dts identifier is always a legal TS identifier
// ---------------------------------------------------------------------------
describe("[] Bug 494 — dts identifier is always a legal TS identifier", () => {
/**
 * Bug 494：dts 投影不得产出非法 TS 标识符。
 *
 * 带 @nudo: 指令的类方法此前走**指令路径**，丢掉了顶层函数普查的
 * noDeclaration 分类 ⇒ dts 投影把作用域名 "C.m" 直接当函数名，产出
 * `export declare function C.m(x: number): unknown;`——tsc 报 TS1005 语法错，
 * 生成的 .d.ts 不可用（zod / standard / guard 三个面都清洗成 C_m*）。
 *
 * 本测试锁住：
 *   ① 指令路径继承 noDeclaration 分类（与非指令路径同口径）
 *   ② dts 投影出的函数名恒为合法 TS 标识符（双保险：非法名一律清洗）
 */





const CLASS_METHOD_WITH_DIRECTIVE = `export class C {
  /**
   * @nudo:case "m1" (1) => 2
   */
  m(x) { return x + 1; }
}
`;

describe("Bug 494 — dts identifier is always a legal TS identifier", () => {
  it("directive path inherits the noDeclaration classification", () => {
    const r = analyzeFile_____analyzer_ts_3("/t/b494/class-method.js", CLASS_METHOD_WITH_DIRECTIVE);
    const fn = r.functions.find((f) => f.name === "C.m");
    expect(fn).toBeDefined();
    expect(fn!.noDeclaration).toBe(true);
  });

  it("dts projection never emits a dotted function name", () => {
    const r = analyzeFile_____analyzer_ts_3("/t/b494/class-method-dts.js", CLASS_METHOD_WITH_DIRECTIVE);
    const fn = r.functions.find((f) => f.name === "C.m")!;
    const proj = projectFunctionDts(fn);
    expect(proj.lines.length).toBeGreaterThan(0);
    const decl = proj.lines.find((l) => l.includes("export declare function"));
    expect(decl).toBeDefined();
    expect(decl).toMatch(/export declare function C_m\b/);
    expect(proj.lines.join("\n")).not.toMatch(/C\.m/);
  });

  it("defensive gate: an illegal name is cleaned even without the noDeclaration flag", () => {
    const fn: FunctionAnalysis = {
      name: "C.m",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
      paramNames: ["x"],
      cases: [
        {
          name: "entry@L2",
          argAbs: [],
          abs: { shape: { k: "prim", type: "number" } } as never,
          throwsAbs: { shape: { k: "never" } } as never,
        },
      ],
    };
    const proj = projectFunctionDts(fn);
    expect(proj.lines.length).toBeGreaterThan(0);
    const decl = proj.lines.find((l) => l.includes("export declare function"));
    expect(decl).toBeDefined();
    expect(decl).toMatch(/export declare function C_m\b/);
  });
});
});

// ---------------------------------------------------------------------------
// 族 54 · service 协议面
// ---------------------------------------------------------------------------
describe("[] 族 54 · service 协议面", () => {
/**
 * 族 54 · service **协议面**（3 条缺口）的钉。
 *
 * 第 1 条 —— env 模板族的扩展名表（`isEnvTemplatePath`）：
 *   env 模板族 = `.env.<ext>` / `mock-<name>.<ext>` / `<name>.mock.<ext>`，
 *   **三支同表**：`js / mjs / ts / cjs / cts / mts`（族 21 遗留 697：mock 两支
 *   曾只认 `js|mjs|ts` ⇒ `mock-foo.cjs` / `fs.mock.cts` 这类模板改动不进 watch
 *   门禁 ⇒ 不触发依赖源文件复分析）。
 *   mock 前缀支锚在 **basename** 起点（绝对路径的 `/` 或相对路径的起点）。
 *
 * 第 2 条 —— hover 的 throws 段（service 侧可观测面）：
 *   hover 只读 case 台账的 throws 证据（`AnalysisResult.functions[].cases[].throwsAbs`）
 *   ⇒ service 必须**产出**这份证据。两种状态下此前拿不到函数级 throws 域
 *   （check 签名行口径 = 入口求值的 hard throw ∪ soft may-throw）：
 *   ① **有调用点见证**：`settleEntryOnlyCandidates` 把 `entry@` 见证连同 throws
 *      证据一起撤掉、改由 `call@` 见证承担调用点域 ⇒ 证据随见证一起消失；
 *   ② **选中 case**：被选函数**不生成 `entry@` 见证**（域由选中的那条 case 声明）
 *      ⇒ 函数级 throws 域在 case 台账里无处安放。
 *   修复后：证据并进该函数**已有**的见证 ⇒ 见证数不变、推断域不变（产物面不动）。
 *
 * 第 3 条 —— `migrate verify` 库面整批 abort：**缺陷不在 service 包**。
 *   取证（见报告）：`migrateVerify`（`packages/nudojs/src/migrate.ts`）**已经**
 *   逐文件隔离（同目标内部分文件语法错 ⇒ 失败文件记 `analysis-error`、成功文件
 *   照常返回）；仍整批 abort 的是同族的 `migrateStrip`（696 的库面半边）。
 *   两处都在 nudojs 包 ⇒ 不在本片（service）范围，本钉不含该例。
 */







/** env 模板族的扩展名表（三支同表）。 */
const ENV_TEMPLATE_EXTS = ["js", "mjs", "ts", "cjs", "cts", "mts"] as const;

describe("族 54 · service 协议面", () => {
  describe("第 1 条 · env 模板族扩展名表", () => {
    it("mock-<name>.<ext> / <name>.mock.<ext> 对族内全部扩展名都判 true", () => {
      for (const ext of ENV_TEMPLATE_EXTS) {
        expect(isEnvTemplatePath(`/env/mock-fs.${ext}`), `mock-fs.${ext}`).toBe(true);
        expect(isEnvTemplatePath(`/env/fs.mock.${ext}`), `fs.mock.${ext}`).toBe(true);
      }
    });

    it(".env.<ext> 分支（族内另一支）判定的扩展名不变", () => {
      for (const ext of ENV_TEMPLATE_EXTS) {
        expect(isEnvTemplatePath(`/env/custom.env.${ext}`), `custom.env.${ext}`).toBe(true);
      }
    });

    it("mock 前缀支锚在 basename 起点（相对路径形态同样成立）", () => {
      expect(isEnvTemplatePath("mock-fs.js")).toBe(true);
      expect(isEnvTemplatePath("fs.mock.js")).toBe(true);
    });

    it("负控：非 env 模板路径逐字不变（仍为 false）", () => {
      for (const p of [
        "/env/lib.js",
        "/env/lib.ts",
        "/env/lib.mjs",
        "/env/mock-fs.json",
        "/env/fs.mock.json",
        "/env/custom.env.json",
        "/env/mock-fs.d.txt",
        "/env/mock-dir/lib.js",
        "/env/not-mock-fs.js",
        "/env/fs.mockish.js",
      ]) {
        expect(isEnvTemplatePath(p), p).toBe(false);
      }
    });
  });

  describe("第 2 条 · hover 的 throws 段（service 侧可观测面）", () => {
    /** 入口无约束参数 = any ⇒ `x.foo` 落 any 成员访问 ⇒ 函数级 throws 域 = TypeError */
    const MAY_THROW_SRC = `export function risky(x) {
  return x.foo;
}
`;

    it("有调用点见证：函数级 throws 证据落在**函数级承载位**（见证数与推断域不变）", () => {
      const dir = tmpProject("nudo-bug54-callsite-", {
        "main.js": `${MAY_THROW_SRC}export function run() {
  return risky({});
}
`,
      });
      const file = `${dir}/main.js`;
      const r = analyzeFile_____analyzer_ts_4(file, `${MAY_THROW_SRC}export function run() {
  return risky({});
}
`);
      const fn = r.functions.find((f) => f.name === "risky")!;
      // 调用点见证在场（entry@ 已被撤掉）
      expect(fn.cases.map((c) => c.name)).toEqual(["call@L5"]);
      // 函数级 throws 证据在**函数级承载位** ⇒ hover 的 throws 段有内容
      expect(fn.entryThrowsAbs).toBeDefined();
      expect(fn.entryThrowsAbs!.shape.k).not.toBe("never");
      expect(formatThrowsAbs(fn.entryThrowsAbs!)).toBe("TypeError");
      // **负控**：调用点见证自己的 throwsAbs **不得**被函数级域污染 ——
      // `risky({})` 这次调用**没抛**（`{}.foo` 是 undefined）⇒ 该见证自己的
      // throws 域仍是 never。并进去 ⇒ 草稿面（按「这次调用抛了吗」筛返回义务）
      // 丢返回义务 ⇒ **契约产物变弱**（假绿方向）。
      expect(fn.cases[0]!.throwsAbs.shape.k).toBe("never");
      // 推断域仍是**调用点域**（入口域不得渗进产物面）
      expect(formatShape(fn.combinedAbs!)).toBe("undefined");
    });

    it("有调用点见证（模块级调用点路径）：函数级承载位带函数级 throws 证据", () => {
      const src = `${MAY_THROW_SRC}risky({});
`;
      const dir = tmpProject("nudo-bug54-toplevel-", { "top.js": src });
      const file = `${dir}/top.js`;
      const r = analyzeFile_____analyzer_ts_4(file, src);
      const fn = r.functions.find((f) => f.name === "risky")!;
      // 这条路径从不产 entry@ 见证（调用点域直接接管）
      expect(fn.cases.map((c) => c.name)).toEqual(["call@L4"]);
      expect(fn.entryThrowsAbs).toBeDefined();
      expect(fn.entryThrowsAbs!.shape.k).not.toBe("never");
      expect(formatThrowsAbs(fn.entryThrowsAbs!)).toBe("TypeError");
      // **负控**：调用点见证自己的 throws 域不被污染（这次调用没抛）
      expect(fn.cases[0]!.throwsAbs.shape.k).toBe("never");
      // 推断域仍是**调用点域**（入口域不得渗进产物面）
      expect(formatShape(fn.combinedAbs!)).toBe("undefined");
    });

    it("选中 case：被选函数不产 entry@ 见证，函数级承载位带函数级 throws 证据", () => {
      const src = `/**
 * @nudo:case "c1" (1) => number()
 */
export function risky(x) {
  return x.foo;
}
`;
      const dir = tmpProject("nudo-bug54-selected-", { "sel.js": src });
      const file = `${dir}/sel.js`;
      const r = analyzeFile_____analyzer_ts_4(file, src, new Map([["risky", 0]]), undefined, undefined, "selected");
      const fn = r.functions.find((f) => f.name === "risky")!;
      // 选中态：只有选中的那条 case 见证（无 entry@）
      expect(fn.cases.map((c) => c.name)).toEqual(["c1"]);
      expect(fn.entryThrowsAbs).toBeDefined();
      expect(fn.entryThrowsAbs!.shape.k).not.toBe("never");
      expect(formatThrowsAbs(fn.entryThrowsAbs!)).toBe("TypeError");
      // 推断域仍是**case 声明的域**（入口域不得渗进产物面）
      expect(formatShape(fn.combinedAbs!)).toBe("undefined");
    });

    it("负控：无调用点见证时 entry@ 见证的 throws 证据与推断域不变", () => {
      const dir = tmpProject("nudo-bug54-entry-", { "entry.js": MAY_THROW_SRC });
      const file = `${dir}/entry.js`;
      const r = analyzeFile_____analyzer_ts_4(file, MAY_THROW_SRC);
      const fn = r.functions.find((f) => f.name === "risky")!;
      expect(fn.cases.map((c) => c.name)).toEqual(["entry@L1"]);
      expect(formatThrowsAbs(fn.cases[0]!.throwsAbs)).toBe("TypeError");
      expect(formatShape(fn.combinedAbs!)).toBe("any");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 608: guard 导出名必须模块内去重（清洗碰撞不再产生同名导出）
// ---------------------------------------------------------------------------
describe("[] Bug 608: guard 导出名必须模块内去重（清洗碰撞不再产生同名导出）", () => {
/**
 * Bug 608 —— **guard 面**的导出名只过字符清洗（`safeExportIdent(name)`）⇒
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

describe("Bug 608: guard 导出名必须模块内去重（清洗碰撞不再产生同名导出）", () => {
  it("同一个 used 集合 ⇒ 清洗后同名的两个守卫拿到不同导出名", () => {
    const used = new Set<string>();
    // 类方法 `A.b` 与顶层函数 `A_b` ⇒ 清洗后都是 `isA_bOutput`
    const a = generateGuardFunctionFromAbs("isA_bOutput", num(), used);
    const b = generateGuardFunctionFromAbs("isA_bOutput", num(), used);

    expect(exportedGuardNames(a)).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(b)).toEqual(["isA_bOutput_2"]);

    // 同一模块里两个守卫 ⇒ 导出名唯一（node / tsc 都不再报重复声明）
    const module = [a, b].join("\n");
    const names = exportedGuardNames(module);
    expect(names).toEqual(["isA_bOutput", "isA_bOutput_2"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("used 集合跨守卫共享 ⇒ 去重只影响同名者（不同名不受影响）", () => {
    const used = new Set<string>();
    const a = generateGuardFunctionFromAbs("isA_bOutput", num(), used);
    const b = generateGuardFunctionFromAbs("isOtherOutput", num(), used);
    const c = generateGuardFunctionFromAbs("isA_bOutput", num(), used);

    expect(exportedGuardNames(a)).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(b)).toEqual(["isOtherOutput"]);
    expect(exportedGuardNames(c)).toEqual(["isA_bOutput_2"]);
  });

  it("负控制：不传 used ⇒ 只清洗、不去重（旧调用方行为不变）", () => {
    const a = generateGuardFunctionFromAbs("isA_bOutput", num());
    const b = generateGuardFunctionFromAbs("isA_bOutput", num());
    expect(exportedGuardNames(a)).toEqual(["isA_bOutput"]);
    expect(exportedGuardNames(b)).toEqual(["isA_bOutput"]);
  });

  it("字符清洗仍然生效（A.b → isA_bOutput）", () => {
    const src = generateGuardFunctionFromAbs("isA.bOutput", num(), new Set<string>());
    expect(exportedGuardNames(src)).toEqual(["isA_bOutput"]);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 614: standard 返回面导出名恒为 <fn>Output（不随符号来源翻转）
// ---------------------------------------------------------------------------
describe("[] Bug 614: standard 返回面导出名恒为 <fn>Output（不随符号来源翻转）", () => {
/**
 * Bug 614 —— **standard 面**的返回面导出名与**符号来源耦合**：有契约返回叫
 * `<fn>Return`，走观测叫 `<fn>Output` ⇒ 同一函数在不同源码状态下拿到**不同
 * 名字** ⇒ 下游 `import { <fn>Output } from "*.nudo.standard"` 直接报错
 * （而同一次导出的 zod 面**恒叫** `<fn>Output` ⇒ 两面同物异名）。
 *
 * 修法（service 侧）：返回面的导出名**恒为 `<fn>Output`**（与 zod 面同名同义）
 * ——名字与来源**解耦**；内容仍按「契约返回优先，否则观测返回」取值。
 */





describe("Bug 614: standard 返回面导出名恒为 <fn>Output（不随符号来源翻转）", () => {
  it("契约返回 ⇒ 恒叫 <fn>Output（不再叫 <fn>Return）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      returns: num(),
    });
    expect(source).toContain("export const alphaOutput");
    expect(source).not.toContain("export const alphaReturn");

    const mod = await loadGeneratedModule(source);
    expect(mod.alphaOutput).toBeDefined();
  });

  it("观测返回 ⇒ 同样叫 <fn>Output（两面同名同义）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      output: num(),
    });
    expect(source).toContain("export const alphaOutput");
    expect(source).not.toContain("export const alphaReturn");

    const mod = await loadGeneratedModule(source);
    expect(mod.alphaOutput).toBeDefined();
  });

  it("同一函数的两种来源 ⇒ 导出名集合相同（名字与来源解耦）", () => {
    const fromContract = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      returns: num(),
    }).source;
    const fromObservation = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      output: num(),
    }).source;

    const names = (src: string): string[] =>
      [...src.matchAll(/export const (\w+)/g)].map((m) => m[1]!);
    expect(names(fromContract)).toEqual(names(fromObservation));
    expect(names(fromContract)).toEqual(["alpha_x", "alphaInput", "alphaOutput"]);
  });

  it("契约返回优先于观测返回（内容口径不变，只是名字恒定）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "alpha",
      inputs: [{ name: "x", abs: num() }],
      returns: num(),
      output: num(),
    });
    // 只有一个返回面导出（不因两条来源并存而多出同名声明）
    expect([...source.matchAll(/export const alphaOutput/g)].length).toBe(1);
    const mod = await loadGeneratedModule(source);
    expect(mod.alphaOutput!["~standard"].validate(1).issues).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// Bug 627: standard 顶层形参的可选性必须保真（接受 undefined）
// ---------------------------------------------------------------------------
describe("[] Bug 627: standard 顶层形参的可选性必须保真（接受 undefined）", () => {
/**
 * Bug 627 —— **standard 面**把契约「顶层形参的**可选性**」整条丢掉：顶层形参
 * 导出走的是**独立值节点**（不是对象槽）⇒ 结构上**无处挂 `optional`** ⇒
 * 发布的 `act_x` 校验器**运行时拒收**契约允许的 `undefined`
 * （契约 `number().optional()` ⇒ `act_x.validate(undefined)` 应通过）。
 *
 * 修法（service 侧）：
 * - `StandardSchemaFunctionSpec.inputs[].optional`（契约级可选性，同 dts 面
 *   `DtsContractFace.params[].optional` 口径）——`constraintToEntryAbs` 对标量
 *   契约丢掉 `isOptional`，故必须由契约面显式带过来；
 * - 声明级可选性（默认形参 `function f(a, b = 2)`）从 `spec.formals` 派生；
 * - 可选位的整参校验器 = `T | undefined`（与 zod 面 `.optional()` 同判据），
 *   `<fn>Input` 的对应槽位带 `optional`（键可缺席）。
 */





/** 声明级默认形参 `function f(a, b = 2)` 的形参表面。 */
const defaultFormals: FormalParam[] = [
  { kind: "id", name: "a", index: 0 },
  { kind: "default", name: "b", index: 1 },
];

describe("Bug 627: standard 顶层形参的可选性必须保真（接受 undefined）", () => {
  it("契约级可选位：整参校验器接受 undefined（契约 number().optional()）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "x", abs: num(), optional: true }],
      formals: [{ kind: "id", name: "x", index: 0 }],
      output: num(),
    });
    const mod = await loadGeneratedModule(source);
    const validate = mod.act_x!["~standard"].validate;
    // 契约允许 undefined ⇒ 接受
    expect(validate(undefined).issues).toBeUndefined();
    // 正常值仍接受 / 错误类型仍拒绝
    expect(validate(1).issues).toBeUndefined();
    expect(validate("hello").issues).toBeDefined();
  });

  it("契约级可选位：<fn>Input 的槽位可缺席（键可缺、显式 undefined 合法）", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "x", abs: num(), optional: true }],
      formals: [{ kind: "id", name: "x", index: 0 }],
      output: num(),
    });
    const mod = await loadGeneratedModule(source);
    const validate = mod.actInput!["~standard"].validate;
    expect(validate({}).issues).toBeUndefined();
    expect(validate({ x: undefined }).issues).toBeUndefined();
    expect(validate({ x: 1 }).issues).toBeUndefined();
    expect(validate({ x: "hello" }).issues).toBeDefined();
  });

  it("声明级可选位（默认形参）同样保真", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "f",
      inputs: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
      formals: defaultFormals,
      output: num(),
    });
    const mod = await loadGeneratedModule(source);
    expect(mod.f_b!["~standard"].validate(undefined).issues).toBeUndefined();
    expect(mod.f_a!["~standard"].validate(undefined).issues).toBeDefined();
  });

  it("负控制：未申报可选的位仍拒收 undefined", async () => {
    const { source } = absToStandardSchemaFunction({
      fn: "act",
      inputs: [{ name: "x", abs: num() }],
      formals: [{ kind: "id", name: "x", index: 0 }],
      output: num(),
    });
    const mod = await loadGeneratedModule(source);
    expect(mod.act_x!["~standard"].validate(undefined).issues).toBeDefined();
    const validate = mod.actInput!["~standard"].validate;
    expect(validate({}).issues).toBeDefined();
  });
});
});

// ---------------------------------------------------------------------------
// Bug 937 — defineEnv() 契约违约必须可见
// ---------------------------------------------------------------------------
describe("[] Bug 937 — defineEnv() 契约违约必须可见", () => {
/**
 * Bug 937 — path 型 env 文件违反 `defineEnv()` 契约（不导出 / 不是函数 /
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

describe("Bug 937 — defineEnv() 契约违约必须可见", () => {
  for (const v of VIOLATIONS) {
    it(`${v.name}：一条 nudo:env-unresolved 诊断且点名 env 文件`, async () => {
      const dir = tmpProject("nudo-bug-937-");
      const envFile = join(dir, "myenv.mjs");
      writeFileSync(envFile, v.src, "utf-8");

      await preloadPathEnvs(["./myenv.mjs"], dir);
      // 工厂调用不得把异常冒泡出去（求值侧兜底 catch 会静默吞掉）
      const loaded = loadEnvs(["./myenv.mjs"], createEnvironment(), dir);
      expect(Object.keys(loaded.globals)).toHaveLength(0);

      const errs = getPathEnvLoadErrors(dir);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.path).toBe(envFile);
      expect(errs[0]!.error).toContain(v.expect);
    });
  }

  it("结构违约（不导出 / 不是函数）在**装载期**即报（不待工厂调用）", async () => {
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
  });

  it("负控制：契约满足的 env 文件生效且零告警", async () => {
    const dir = tmpProject("nudo-bug-937-ok-");
    writeFileSync(
      join(dir, "myenv.mjs"),
      `import { numLit } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: numLit(42) } };
}
`,
      "utf-8",
    );
    await preloadPathEnvs(["./myenv.mjs"], dir);
    expect(getPathEnvLoadErrors(dir)).toHaveLength(0);
    const loaded = loadEnvs(["./myenv.mjs"], createEnvironment(), dir);
    expect(formatShape(loaded.globals.MAGIC!)).toBe("42");
  });

  it("负控制：语法错的 env 文件仍走既有措辞（不与契约诊断混口径）", async () => {
    const dir = tmpProject("nudo-bug-937-syntax-");
    writeFileSync(join(dir, "myenv.mjs"), "export function defineEnv( {\n", "utf-8");
    await preloadPathEnvs(["./myenv.mjs"], dir);
    const errs = getPathEnvLoadErrors(dir);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.error).not.toContain("must export a defineEnv()");
  });
});
});
