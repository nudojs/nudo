/**
 * 模块套件：emit dts/声明槽位/可选性/迭代器投影面。
 */
import { describe, it, expect, afterAll } from "vitest";
import { localNamedExports, abs, boolLit, numLit, type Abs, obj, num, formatShape, str, objOf, checkSource, pTrue } from "@nudojs/core";
import { analyzeFile, type CaseResult } from "@nudojs/service";
import type { AnalysisResult, FunctionAnalysis } from "../../analyzer-types.ts";
import { dtsModuleSurface, projectFunctionDts, projectModuleDts, generateDts } from "../dts-generator.ts";
import { absToDtsTypeText as absToTSType } from "../dts-type.ts";
import { absToSchemaNode, absToSchemaSource, projectAbsToSchema, absToZodSchemaModule } from "../schema-generator.ts";
import { validateSchemaNode, absToStandardSchemaFunction, absToStandardSchemaModule, absToStandardSchema } from "../standard-schema.ts";
import { unifiedParamFace } from "nudojs/commands/export/contract-face.ts";
import { loadGeneratedModule } from "./fixtures.ts";
import { buildCaseDirective, insertGeneratedCaseDirectives } from "../case-emitter.ts";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tscNoEmit } from "./dts-tsc.ts";
import { tmpdir } from "node:os";
import { defaultLoadModule } from "../../load-module.ts";
import { formatContractSurfaceLine, contractSurface } from "../contract-surface.ts";

// ---------------------------------------------------------------------------
// dts 面的 default 导出名（四形态）
// ---------------------------------------------------------------------------
describe("dts 面的 default 导出名（四形态）", () => {
/**
 * `nudo export --format dts` 把**具名 default 导出**投影成**具名导出**
 * ⇒ 产物声明了**运行时不存在的导出**（编译通过、运行时 `undefined`）+ 默认导入
 * 直接 **TS2349**。
 *
 * 现状：**假阳性** —— 症状已被族 15（，commit `dde4b037`）修掉：
 * `service/src/emit/dts-generator.ts` 的 `projectFunctionDts` 显式按**模块面**
 * 取**导出名**（`export default function f(...)` 的导出名是 `default`，**不是**
 * `export declare function f`）。本钉把**四种 default 形态**的导出名钉死
 * （**不改实现**）。
 *
 * 落点说明：本钉写在 **service 的 dts 生成器单测**里（`packages/service/src/emit/
 * __tests__/`），**不写**在 `packages/nudojs/src/commands/export/**` 的命令测试里
 * （该目录族 17 在改）。导出面裁剪谓词与 CLI `export --format dts` 同口径：
 * `exportFacePredicate(localNamedExports(source))`（CLI 侧见
 * `packages/nudojs/src/commands/export/dts-face.ts`）。
 */






/** CLI export 面筛选（与 packages/nudojs/src/commands/export/dts-face.ts 同口径） */
function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

/** 模块面 dts 投影（CLI export --format dts 的产品面路径） */
function moduleDts(source: string, path = "/test/default-surface.js"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}


  it("形态①：export default function named ⇒ 导出名是 default（不是具名导出）；形态②：export default class K ⇒ 导出名是 default（类不被降成模块级函数）；形态③：匿名 default（export default function (x)）⇒ 导出名是 default；形态④：箭头 default（export default (x) => …）⇒ 导出名是 default；形态④′：const + expo", () => {
  {
    const dts = moduleDts(`export default function named(x) {
  return x + 1;
}
`);
    expect(dts).toContain("export default function named(");
    // 不得凭空虚构运行时不存在的具名导出（改前的症状）
    expect(dts).not.toContain("export declare function named");
    expect(dts).not.toMatch(/export\s*\{[^}]*\bnamed\b/);
  }
  {
    const dts = moduleDts(`export default class K {
  m(x) {
    return x + 1;
  }
}
`);
    expect(dts).toContain("export default class K {");
    expect(dts).not.toContain("export declare function K");
    expect(dts).not.toContain("K_m");
  }
  {
    const dts = moduleDts(`export default function (x) {
  return x + 1;
}
`);
    expect(dts).toMatch(/export default function \(x: (any|unknown)\): .*;/);
    expect(dts).not.toContain("export declare function");
  }
  {
    const dts = moduleDts(`export default (x) => x + 1;
`);
    expect(dts).toMatch(/export default function \(x: (any|unknown)\): .*;/);
    expect(dts).not.toContain("export declare function");
  }
  {
    const dts = moduleDts(`const arrow = (x) => x + 1;
export default arrow;
`);
    expect(dts).toContain("export default function arrow(");
    expect(dts).not.toContain("export declare function arrow");
  }
  {
    const surface = dtsModuleSurface(`export default function named(x) {
  return x + 1;
}
`);
    expect(surface.exportBindings.get("default")).toBe("named");
  }
  {
    expect(
      dtsModuleSurface(`export default function (x) {
  return x + 1;
}
`).exportBindings.get("default"),
    ).toBe("");
    expect(
      dtsModuleSurface(`export default (x) => x + 1;
`).exportBindings.get("default"),
    ).toBe("");
  }
  {
    const dts = moduleDts(`export function other(y) {
  return y + 1;
}
`);
    expect(dts).toContain("export declare function other(");
  }
  {
    const dts = moduleDts(`export default function named(x) {
  return x + 1;
}
function helper(x) {
  return x + 2;
}
`);
    expect(dts).not.toContain("helper");
  }
});







  // ── 负控制：本条修复不该波及的邻近形态 ──────────────────────────


});

// ---------------------------------------------------------------------------
// dts 面：静态与实例同名 ⇒ 类体里不重复声明成员
// ---------------------------------------------------------------------------
describe("dts 面：静态与实例同名 ⇒ 类体里不重复声明成员", () => {
/**
 * dts 面的**回归钉**（service 侧）。
 *
 * core 侧的类方法普查名不再让**静态方法与实例方法同名**时共用一个名字
 * （`scan-top-functions.ts` 的 `collectClassMethods`；service 侧
 * `analyzer-ast.ts` 同口径）⇒ `analysis.functions` 里不再有两条 `C.m` ⇒
 * dts 类体里也不该再出现**重复的实例成员声明**。
 *
 * dts 的正确形态（族 14/15 已把静态方法投影成 `static m(...)`）：
 * ```ts
 * export declare class C {
 * m(x: any): unknown; // 实例方法（普查面）
 * static m(x: unknown): unknown; // 静态方法（源码面 class surface）
 * }
 * ```
 * ⚠ 修名前多出来的那条 `m(x: any): unknown;`（静态方法被当成实例成员再投影一次）
 * 就是本钉要拦住的。
 */






/** CLI export 面筛选（与 packages/nudojs/src/commands/export.ts 同口径） */
function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name)) return true;
    if (name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    if (m && entryNames.has(m[1])) return true;
    return false;
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

/** 模块面 dts 投影（CLI export --format dts 的产品面路径） */
function moduleDts(source: string, path = "/test/b437.js"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}

const SAME_NAME = `export class C {
  m(x) {
    return "inst";
  }
  static m(y) {
    return "stat";
  }
}
`;


  it("普查面只有一条 C.m；dts 类体：实例方法一条 + 静态方法一条（无重复成员）；dts 产物里不出现模块级的 C_m 声明（类成员不是模块级导出）", () => {
  {
    const result = analyzeFile("/test/b437.js", SAME_NAME);
    const names = result.functions.map((f) => f.name);
    expect(names.filter((n) => n === "C.m").length).toBe(1);
  }
  {
    const dts = moduleDts(SAME_NAME);
    expect(dts).toContain("export declare class C {");
    // BUG-095 / 回归修正：static 方法返回类型不再借用同名**实例**方法的签名
    // （两者形参不同名 ⇒ 分析面那条 `C.m` 是实例位证据，不可复用）。
    // 这里改为观测静态方法自己的方法体（`return "stat"` ⇒ string）。
    expect(dts).toMatch(/static m\(y: unknown\): string;/);
    // 实例成员 `m(...)` 只出现一次（重复的那条是静态方法被当成实例成员再投影）。
    // 补齐类方法入口兜底后返回类型从 unknown 变精确值，故不钉返回类型。
    const instanceMembers = dts.match(/^\s*m\(x: (?:any|unknown)\): [^;]+;$/gm) ?? [];
    expect(instanceMembers.length).toBe(1);
  }
  {
    // 判别用例：实例 / 静态返回类型不同 ⇒ 静态位必须是 string（旧实现错成 number）
    const dts = moduleDts(`export class D {
  m(x) {
    return 1;
  }
  static m(y) {
    return "stat";
  }
}
`);
    expect(dts).toMatch(/static m\(y: unknown\): string;/);
    expect(dts).not.toMatch(/static m\(y: unknown\): number;/);
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { D } from "./mod.js";\nexport const s: string = D.m("x");\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    // 对象字面量里的方法 `return` 不是外层 static 方法的返回值（无外层 return
    // ⇒ 运行时是 undefined）；旧实现把它当成静态方法的返回 ⇒ 假精确 `string`。
    const dts = moduleDts(`export class E {
  m(x) {
    return 1;
  }
  static m(y) {
    const o = { f() { return "s"; } };
  }
}
`);
    expect(dts).toMatch(/static m\(y: unknown\): unknown;/);
    expect(dts).not.toMatch(/static m\(y: unknown\): string;/);
  }
  {
    const dts = moduleDts(SAME_NAME);
    expect(dts).not.toContain("export declare function C_m");
  }
});



});

// ---------------------------------------------------------------------------
// zod 必须真的校验 __proto__ 槽
// ---------------------------------------------------------------------------
describe("zod 必须真的校验 __proto__ 槽", () => {
/**
 * zod 产物面把 `__proto__` 槽发布成**必填字段**，但 **zod v4 在 shape
 * 阶段整条跳过该键**（`if (key === "__proto__") continue;`）⇒ 声明的字段**从不被
 * 校验** ⇒ 违约值被静默放行（假绿）+ 与 dts / guard / standard 四面矛盾 +
 * 零 dropped 台账。
 *
 * 修法：把 `__proto__` 槽剔出 `z.object` 的 shape，改用 `.superRefine()` 显式校验
 * **自有数据属性**（`Object.getOwnPropertyDescriptor`）——原型链上的同名 accessor
 * 不算在场（`JSON.parse('{"__proto__": …}')` 建的是自有数据属性）。
 * 不可表达这一损失必须进 `dropped`（有损投影必须可观测）。
 */





/** `{ __proto__: { z: 9 }, own: 2 }`（JSON.parse 口径：自有数据属性） */
const protoObj = (optionalProto = false): Abs => {
  // 对象字面量里的 `__proto__:` 会设**原型**而不是自有槽（同一个 JS 陷阱）⇒
  // 用 defineProperty 建自有槽，与 core 的 `Object.create(null)` 槽表口径一致。
  const slots: Record<string, { value: Abs; optional?: boolean }> = {
    own: { value: numLit(2) },
  };
  Object.defineProperty(slots, "__proto__", {
    value: {
      value: abs({ k: "obj", slots: { z: { value: numLit(9) } } }, undefined, undefined, "exact"),
      ...(optionalProto ? { optional: true } : {}),
    },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
};

/** JSON.parse 造出的「真值」：`__proto__` 是自有数据属性 */
const realValue = (): Record<string, unknown> => JSON.parse('{"__proto__": {"z": 9}, "own": 2}');
/** 违约形态 ①：缺 `__proto__` */
const missing = (): Record<string, unknown> => ({ own: 2 });
/** 违约形态 ②：`__proto__` 值错 */
const wrongValue = (): Record<string, unknown> => JSON.parse('{"__proto__": {"z": 1}, "own": 2}');


  it("shape 里不再出现 __proto__ 键（zod v4 会跳过它 ⇒ 声明了也不校验）；用 .superRefine 校验自有数据属性（缺键 ⇒ required）；值校验走内层 schema 的 safeParse（不是整条放行）；optional 槽：缺席不报错，但值错了仍报错；台账留痕：__proto__ 的降级进 dropped（不得静默假绿）；standard 面（同一份 Abs）要求自有 __proto__：真值过、缺键/错值不过；负控制：普通对象不受影响（", () => {
  {
    const source = absToSchemaSource(protoObj());
    expect(source).not.toContain('["__proto__"]:');
    expect(source).toContain("Object.getOwnPropertyDescriptor(value, \"__proto__\")");
  }
  {
    const source = absToSchemaSource(protoObj());
    expect(source).toContain(".superRefine(");
    expect(source).toContain('code: "custom"');
    expect(source).toContain('path: ["__proto__"]');
    expect(source).toContain('message: "required"');
  }
  {
    const source = absToSchemaSource(protoObj());
    expect(source).toContain(".safeParse(desc.value)");
    expect(source).toContain("if (!parsed.success) ctx.addIssue(");
  }
  {
    const source = absToSchemaSource(protoObj(true));
    expect(source).not.toContain('message: "required"');
    expect(source).toContain("if (!desc) return;");
    expect(source).toContain("if (!parsed.success) ctx.addIssue(");
  }
  {
    // 这条损失发生在**渲染层**（节点 → zod 源码）⇒ 台账从 `projectAbsToSchema` 取
    const { dropped } = projectAbsToSchema(protoObj());
    expect(dropped.join("\n")).toContain("__proto__");
    expect(dropped.join("\n")).toContain("superRefine");
  }
  {
    const { node } = absToSchemaNode(protoObj());
    expect(validateSchemaNode(node, realValue()).issues).toBeUndefined();
    expect(validateSchemaNode(node, missing()).issues?.length).toBeGreaterThan(0);
    expect(validateSchemaNode(node, wrongValue()).issues?.length).toBeGreaterThan(0);
  }
  {
    const plain = abs({ k: "obj", slots: { a: { value: boolLit(true) } } }, undefined, undefined, "exact");
    const source = absToSchemaSource(plain);
    expect(source).toBe("z.object({ a: z.literal(true) })");
    expect(source).not.toContain("superRefine");
  }
});







});

// ---------------------------------------------------------------------------
// TS 可选形参进三个产物面（可省性 ≡ 源码）
// ---------------------------------------------------------------------------
describe("TS 可选形参进三个产物面（可省性 ≡ 源码）", () => {
/**
 * TS **可选形参** `b?: T` 的 `?` 标记在 dts / zod / standard 三面
 * 全部丢失：`.d.ts` 把 `b` 印成必填（消费端 **TS2554**），运行时校验器对源码
 * 合法的 `f({ a: 1 })` 报 `required: b`（**假红**）。
 *
 * 根因：`?` 在 strip-types 阶段就被删（不进 JS 产物），而 `FormalParam` 的
 * `kind:"id"` 位硬写 `optional: false`；`tsOptionalParams`（core）早就有正确的
 * 源码文本判据却只被字面量实参扫描使用。
 *
 * 修法：`formalParamsFromNodes(params, source)` 把 `tsOptionalParams` 的结果并进
 * `FormalParam.optional`（与 JS 默认值同一条「可省」通道）⇒ dts 的 `?` /
 * standard 的 `required` 判定 / zod 的槽 `.optional()` 都从这一个数据源读。
 *
 * 本钉是差分口径：三面可省性 ≡ 源码（JS 默认值 ∪ TS `?`）。
 */









const SRC = `export function f(a: number, b?: string): string {
  return b ?? "";
}
export function g(a: number, b = 2): number {
  return a + b;
}
`;

const anyAbs: Abs = abs({ k: "any" }, undefined, undefined, "path");

function formalsOf(name: string): Array<[string, boolean | undefined]> {
  const result = analyzeFile("/test/optional-param.ts", SRC);
  const fn = result.functions.find((x) => x.name === name)!;
  return (fn.formals ?? []).map((f) => [f.kind, f.optional]);
}


  it("数据源：FormalParam.optional ≡ 源码（JS 默认值 ∪ TS `?`）；dts 面：可省位印 `?`（消费端 `f(1)` 不再 TS2554）；standard 面：`{ a }` 通过、缺 `a` 仍报 required；zod 面：可选槽渲染 `.optional()`（槽可选性由同一 FormalParam 驱动）；zod 面（入口角色表）：`unifiedParamFace` 把 `b?` 判为可省", async () => {
  {
    expect(formalsOf("f")).toEqual([
      ["id", false],
      ["id", true],
    ]);
    expect(formalsOf("g")).toEqual([
      ["id", false],
      ["default", true],
    ]);
  }
  {
    const result = analyzeFile("/test/optional-param.ts", SRC);
    const fn = result.functions.find((x) => x.name === "f")!;
    const lines = projectFunctionDts(fn, undefined, dtsModuleSurface(SRC)).lines.join("\n");
    expect(lines).toMatch(/b\?:/);
    expect(lines).not.toMatch(/b: string/);
  }
  {
    const result = analyzeFile("/test/optional-param.ts", SRC);
    const fn = result.functions.find((x) => x.name === "f")!;
    const { source } = absToStandardSchemaFunction({
      fn: "f",
      inputs: [
        { name: "a", abs: anyAbs },
        { name: "b", abs: anyAbs },
      ],
      formals: fn.formals,
    });
    const mod = await loadGeneratedModule(source);
    const input = mod.fInput!["~standard"];
    expect(input.validate({ a: 1 }).issues).toBeUndefined();
    expect(input.validate({ a: 1, b: "s" }).issues).toBeUndefined();
    const missing = input.validate({});
    expect(missing.issues?.[0]?.message).toBe("required");
  }
  {
    const slots = {
      a: { value: anyAbs },
      b: { value: anyAbs, optional: true },
    };
    const source = absToZodSchemaModule({ fInput: obj(slots) }).source;
    expect(source).toContain("b: z.unknown().optional()");
    expect(source).not.toContain("a: z.unknown().optional()");
  }
  {
    const fn = analyzeFile("/test/optional-param.ts", SRC).functions.find((x) => x.name === "f")!;
    // 唯一一条「一键实参」观测 ⇒ minArity = 1 ⇒ 下标 1 的可省性只能来自 TS `?`
    // （契约面缺席、FormalParam 之外没有别的信息源）。
    const witness: CaseResult = { name: "c", argAbs: [anyAbs], abs: anyAbs, throwsAbs: anyAbs };
    expect(unifiedParamFace(fn, undefined, [witness]).map((f) => [f.name, f.optional])).toEqual([
      ["a", false],
      ["b", true],
    ]);
    // 对照：无观测 ⇒ 既有的「按最少实参元数放宽」仍生效（不收紧）
    expect(unifiedParamFace(fn, undefined, []).map((f) => [f.name, f.optional])).toEqual([
      ["a", true],
      ["b", true],
    ]);
  }
});





});

// ---------------------------------------------------------------------------
// export namespace 进入导出面与 .d.ts
// ---------------------------------------------------------------------------
describe("export namespace 进入导出面与 .d.ts", () => {
/**
 * `export namespace NS { … }` 在导出面 / dts 产物**完全不可见**，
 * 而 nudo 自己的求值器把 namespace 物化成了运行时对象 ⇒ 引擎内部两套导出面
 * 互相矛盾 ⇒ 消费端 `import { NS }` 报 **TS2305**。
 *
 * 根因（两处平行缺口）：
 * - `packages/core/src/algebra/scan-named-exports.ts` 的 `ExportNamedDeclaration`
 * 声明分支只认 Function / Class / Variable ⇒ `TSModuleDeclaration` 落到
 * `continue` 被静默丢弃；
 * - `dts-generator.ts` 的模块面导出名表与声明发射同款缺口 ⇒ 即使导出面登记
 * 了，`.d.ts` 里也没有 `NS`。
 *
 * 本钉钉死三件事：导出面含 NS（及成员键）、dts 导出名表含 NS、`.d.ts` 里
 * 真的有 `export declare namespace NS { … }`（消费端 import 才不报 TS2305）。
 */





const SRC = `export namespace NS {
  export const x: number = 1;
  export function f(a: string): number {
    return a.length;
  }
  export interface Shape {
    a: number;
  }
  export namespace Inner {
    export const y = "s";
  }
}
export function unrelated(): number {
  return 1;
}
`;

function moduleDts(source: string, path = "/test/namespace.ts"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = result.functions.map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}


  it("导出面（check 入口表 / 侧车绑定 / dts 裁剪同源）含 NS 与其运行时成员键；dts 模块面登记 NS（导出名 → 本地绑定）；`.d.ts` 发射 `export declare namespace NS { … }`（消费端 import 不再 TS2305）", () => {
  {
    const names = localNamedExports(SRC);
    expect(names.has("NS")).toBe(true);
    // 成员契约键与 `Class.method` 同口径；interface 是纯类型 ⇒ 运行时不占键
    expect(names.has("NS.x")).toBe(true);
    expect(names.has("NS.f")).toBe(true);
    expect(names.has("NS.Inner")).toBe(true);
    expect(names.has("NS.Inner.y")).toBe(true);
    expect(names.has("NS.Shape")).toBe(false);
    // 负控制：普通导出面不受影响
    expect(names.has("unrelated")).toBe(true);
  }
  {
    const surface = dtsModuleSurface(SRC);
    expect(surface.exportBindings.get("NS")).toBe("NS");
    expect(surface.namespaces?.get("NS")?.members.length).toBeGreaterThan(0);
  }
  {
    const dts = moduleDts(SRC);
    expect(dts).toContain("export declare namespace NS {");
    // 成员：声明类型原样镜像（不是 any / unknown）
    expect(dts).toContain("export const x: number;");
    expect(dts).toContain("export function f(a: string): number;");
    expect(dts).toContain("export interface Shape {");
    // 嵌套 namespace 递归落地
    expect(dts).toContain("export namespace Inner {");
    // 负控制：普通函数仍在（namespace 分支不得吞掉其它导出声明）
    expect(dts).toMatch(/export declare function unrelated\(/);
  }
});



});

// ---------------------------------------------------------------------------
// 产物面不得发布 internal 槽
// ---------------------------------------------------------------------------
describe("产物面不得发布 internal 槽", () => {
/**
 * service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。
 *
 * 改前：
 * export declare function f(x: { a: number; "#priv": number; "@@iterator": number }): number;
 * ⇒ 形参位把内部槽当**用户可见字段**直出：`widenParamAbs` 造新槽时丢了
 * `internal` / `symbolKey` 标记 ⇒ 内部槽被"提权"成可见字段（`"#priv"` 是私有
 * 字段、`"@@iterator"` 是 **symbol 键**协议槽——按字符串键发布是错的）。
 * 私有字段还会进 `declare class` 的类体。
 *
 * 判据与 core 三面**同款**（`format.ts` 投影面 / `projection.ts` 约束面 /
 * `denote.ts` guard 面）：`Slot.internal` 为 true 且键**不是**规范数组下标 ⇒
 * 该槽对属性 introspection 不可见 ⇒ 不进产物面。规范数组下标槽是例外（族 01
 * 口径：生成器的数字下标槽承载元素域）。
 *
 * 覆盖面：dts（形参位 / 类字段）/ schema（单值 + zod 模块）/ standard 模块。
 */






/** 带 internal 槽（私有字段 / symbol 协议槽）的对象 */
const objWithInternal = abs(
  {
    k: "obj",
    slots: {
      a: { value: num() },
      "#priv": { value: num(), internal: true },
      "@@iterator": { value: num(), internal: true, symbolKey: true },
    },
  },
  undefined,
  undefined,
  "exact",
);

/** 只带普通槽的对象（负控制） */
const plainObj = abs(
  { k: "obj", slots: { a: { value: num() } } },
  undefined,
  undefined,
  "exact",
);

/** brand（类实例类型），实例形状里带一个 internal 私有字段 */
const brandWithPrivate = abs(
  {
    k: "brand",
    name: "Counter",
    shape: abs(
      {
        k: "obj",
        slots: {
          v: { value: num() },
          "#priv": { value: num(), internal: true },
        },
      },
      undefined,
      undefined,
      "exact",
    ),
  },
  undefined,
  undefined,
  "exact",
);

/** 假 fn（形参位 / 返回位给定） */
function fakeFn(name: string, argAbs: Abs, outAbs: Abs): unknown {
  return {
    name,
    cases: [{ name: "c", argAbs: [argAbs], args: [], abs: outAbs }],
  };
}

/** 模块面 dts（CLI export --format dts 的产品面路径） */
function moduleDts(source: string, fn: unknown): string {
  const surface = dtsModuleSurface(source);
  const typed = fn as Parameters<typeof projectFunctionDts>[0];
  const projection = projectFunctionDts(typed, undefined, surface);
  return projectModuleDts(surface, [{ fn: typed, projection }]).lines.join("\n");
}


  it("dts 形参位：内部槽不进结构字段（改前：\"#priv\" / \"@@iterator\" 直出）；dts 类字段：私有字段不进 declare class 类体；schema 单值面：内部槽不进 zod 对象；schema 模块面（zod）：内部槽不进产物；standard 模块面：内部槽不进产物；schema 形状兜底路径（open 对象）：内部槽不进产物；负控制：非 internal 槽逐字不变", () => {
  {
    const dts = moduleDts(
      `export function f(x) { return x; }\n`,
      fakeFn("f", objWithInternal, num()),
    );
    expect(dts).not.toContain("#priv");
    expect(dts).not.toContain("@@iterator");
    // 普通槽照旧
    expect(dts).toContain("a: number");
  }
  {
    const dts = moduleDts(
      `export class Counter {\n  constructor(v) { this.v = v; }\n}\nexport function make() { return 1; }\n`,
      fakeFn("make", num(), brandWithPrivate),
    );
    expect(dts).toContain("declare class Counter");
    expect(dts).not.toContain("#priv");
    // 字段类型取**构造器形参域**（`this.v = v`，v 无约束 ⇒ unknown）——这是
    // 的口径：单个构造点的 brand 观测（这里的 fake brand 说 number）
    // 不得把公开字段钉成比构造器签名更窄的类型。
    expect(dts).toContain("v: unknown");
  }
  {
    const source = absToSchemaSource(objWithInternal);
    expect(source).not.toContain("#priv");
    expect(source).not.toContain("@@iterator");
    expect(source).toContain("a:");
  }
  {
    const { source } = absToZodSchemaModule({ f: objWithInternal });
    expect(source).not.toContain("#priv");
    expect(source).not.toContain("@@iterator");
    expect(source).toContain("a:");
  }
  {
    const { source } = absToStandardSchemaModule({ f: objWithInternal });
    expect(source).not.toContain("#priv");
    expect(source).not.toContain("@@iterator");
    expect(source).toContain('"key":"a"');
  }
  {
    // open 对象 ⇒ 约束投影放弃 ⇒ 走 service 的形状兜底（`absToSchemaShape`，
    // 该路径原先不剔 internal 槽）；standard 面走的就是这条路径。
    const openObj = abs(
      {
        k: "obj",
        open: true,
        slots: {
          a: { value: num() },
          "#priv": { value: num(), internal: true },
          "@@iterator": { value: num(), internal: true, symbolKey: true },
        },
      },
      undefined,
      undefined,
      "exact",
    );
    const standard = absToStandardSchemaModule({ f: openObj });
    expect(standard.source).not.toContain("#priv");
    expect(standard.source).not.toContain("@@iterator");
    expect(standard.source).toContain('"key":"a"');
    const zod = absToZodSchemaModule({ f: openObj });
    expect(zod.source).not.toContain("#priv");
    expect(zod.source).not.toContain("@@iterator");
    expect(zod.source).toContain("a:");
  }
  {
    expect(absToTSType(plainObj)).toBe("{ a: number }");
    expect(absToSchemaSource(plainObj)).toContain("a:");
  }
});







});

// ---------------------------------------------------------------------------
// 固化的无断言见证不独占返回面
// ---------------------------------------------------------------------------
describe("固化的无断言见证不独占返回面", () => {
// emit--frozen-observation-type-face.part.ts —
// `nudo test --freeze` 固化的**无断言**见证**接管了整个函数的返回面**
// ⇒ zod / guard / dts 全变成「单次调用点字面量」，且与 `nudo check` 自相矛盾。
//
// 事实（探针 tmp/probe/fix-r25-s9/engine-511.ts 实测）：
// | 源 | combinedAbs（返回面） | cases |
// |-------------------------------------------|-----------------------|------------------------------|
// | 无指令（固化前） | `number \| string` | `entry@L1[expected=no]` |
// | 固化后（**无断言**观测见证 `call@…`） | **`3`**（单次调用点） | `call@…[expected=no]` |
// | 手写断言 `@nudo:case "t" (1,2) => 3` | `3`（合法） | `t[expected=yes]` |
//
// 根因（**已由主 agent 在分析器侧闭环**）：
// - `packages/service/src/analyzer-orchestrate-uncached.ts`
// 无断言的**点观测**见证（实参全是字面量）不再是域声明 ⇒ 该函数仍走
// entry@/call@ 合成（`SynthCandidate.domainOnly` 隔离其调用点证据），
// 返回面由**推断域**承担 ⇒ 见证不再独占返回面。
// - `packages/service/src/emit/domain-cases.ts`
// 产物面（dts / zod / standard / guard）的域证据只吃「合成证据 +
// **带断言**的声明」；无断言的 case 指令是见证、不是域声明。
// - `packages/nudojs/src/commands/export.ts`
// `fn.combinedAbs ?? caseResults[0]?.abs` 的兜底不再拿无断言的观测值当返回面。
//
// ⇒ 本文件从「缺口钉」转为主门禁（`it.fails` 旗标已摘）。
//
// emitter 侧（本分片可写）已保证的性质：固化的见证是**观测**（不带
// `=> expected`），与**断言**在指令文本上可区分 —— 下游据此过滤即可。





const PATH = "/test/bug-511-type-face.js";

/** 源里某个函数的返回面（combinedAbs 的可读形态） */
function faceOf(source: string): string {
  const result = analyzeFile(PATH, source, undefined, undefined, undefined, "all");
  const fn = result.functions.find((f) => f.name === "add");
  return fn?.combinedAbs ? formatShape(fn.combinedAbs) : "(none)";
}


  it("固化后的无断言观测见证不得独占返回面（返回面由推断域承担）；负控制：手写断言（=> 3）合法地定义返回面（修 511 不得动这一条）；负控制：无指令的函数返回面不受影响（entry@ 面）；emitter 侧：固化写出的见证是「观测」而非「断言」（指令里没有 => expected）；emitter 侧：固化产物可被 parser 读回，且不带期望值", async () => {
  {
      // 固化后的源码：一条**无断言**的观测见证
      const frozen = `/**
 * @nudo:case "call@F1usage.js:L2" (1, 2)
 */
export function add(a, b) { return a + b; }
`;
      // 期望：观测见证只是下界证据，返回面仍由函数自身（entry@ 面）承担 ⇒
      // 与固化前、与 `nudo check` 的签名一致。
      expect(faceOf(frozen)).toBe("number | string");
  }
  {
    const asserted = `/**
 * @nudo:case "t" (1, 2) => 3
 */
export function add(a, b) { return a + b; }
`;
    expect(faceOf(asserted)).toBe("3");
  }
  {
    const plain = `export function add(a, b) { return a + b; }
`;
    expect(faceOf(plain)).toBe("number | string");
  }
  {
    // 观测：只有实参，没有期望值
    expect(buildCaseDirective("call@F1usage.js:L2", [])).toBe(
      ' * @nudo:case "call@F1usage.js:L2" ()',
    );
    // 断言面由手写指令承担（`=> expected`）——与观测在文本上可区分
    expect(buildCaseDirective("call@F1usage.js:L2", [])).not.toContain("=>");
  }
  {
    const { parse, extractDirectives } = await import("@nudojs/parser");
    const source = `export function add(a, b) { return a + b; }
`;
    const analysis = analyzeFile(PATH, source, undefined, undefined, undefined, "all");
    const fn = analysis.functions.find((f) => f.name === "add")!;
    const frozen = insertGeneratedCaseDirectives(
      source,
      {
        ...analysis,
        functions: [
          {
            ...fn,
            entryOnly: false,
            cases: [
              {
                name: "call@F1usage.js:L2",
                argAbs: [],
                abs: fn.cases[0]?.abs ?? { shape: { k: "unknown" }, conf: "partial" },
                throwsAbs: { shape: { k: "never" }, conf: "exact" },
                source: "callsite" as const,
              },
            ],
          },
        ],
      },
    );
    expect(frozen.changed).toBe(true);
    const dirs = extractDirectives(parse(frozen.source))
      .find((f) => f.name === "add")!
      .directives.filter((d) => d.kind === "case");
    expect(dirs).toHaveLength(1);
    // 观测见证不带期望值 ⇒ 下游可据此把它与断言区分开
    expect(dirs[0]!.kind === "case" && dirs[0]!.expected).toBeUndefined();
  }
});





});

// ---------------------------------------------------------------------------
// dts 导出面（S1）
// ---------------------------------------------------------------------------
describe("dts 导出面（S1）", () => {
/**
 * dts 导出面 / 类投影 / 再导出面回归钉（族 15 · S1）。
 *
 * 覆盖 （default / CJS 绑定被整类丢弃）、515（导出名 ≠ 局部绑定名）、
 * 517（brand 引用的类从未声明 ⇒ TS2304）、518（类方法被投影成模块级
 * `C_m` 导出 ⇒ 凭空造导出）、550（类本身 / 构造器 / 静态方法不进 dts）、
 * 939（再导出面 `export * from` / `export {x} from` 整类丢弃）。
 *
 * 投影入口与 CLI `export --format dts` 同口径：模块面（dtsModuleSurface）
 * + 逐函数投影（projectFunctionDts）+ 模块合成（projectModuleDts）。
 */






/** CLI export 面筛选（与 packages/nudojs/src/commands/export.ts 同口径） */
function exportFaceFunctions(source: string, result: AnalysisResult): FunctionAnalysis[] {
  const entryNames = localNamedExports(source);
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name)) return true;
    if (name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(name);
    if (m && entryNames.has(m[1])) return true;
    return false;
  };
  return result.functions.filter((f) => f.cases.length > 0 && onExportFace(f.name));
}

/** 模块面 dts 投影（CLI export --format dts 的产品面路径） */
function moduleDts(source: string, path = "/test/surface.js"): string {
  const result = analyzeFile(path, source);
  const surface = dtsModuleSurface(source);
  const entries = exportFaceFunctions(source, result).map((fn) => ({
    fn,
    projection: projectFunctionDts(fn, undefined, surface),
  }));
  return projectModuleDts(surface, entries).lines.join("\n");
}


  it("default（匿名 / 箭头）导出进 dts；CJS 绑定（exports.compute）进 dts；const + export list 绑定进 dts；default 具名导出写成 export default function；别名导出按导出名声明（internal 不是导出名）；brand 引用的类被声明（不再 TS2304）；类方法不是模块级导出（没", () => {
  {
    const anon = moduleDts(`export default function (x) {
  return x + 1;
}
`);
    expect(anon).toMatch(/export default function \(x: (any|unknown)\): .*;/);
    const arrow = moduleDts(`export default (x) => x + 1;
`);
    expect(arrow).toMatch(/export default function \(x: (any|unknown)\): .*;/);
  }
  {
    const dts = moduleDts(`exports.compute = (a, b) => a + b;
`);
    expect(dts).toContain("export declare function compute(");
    expect(dts).not.toContain("No exported");
  }
  {
    const dts = moduleDts(`const greet = function () {
  return "hi";
};
export { greet };
`);
    expect(dts).toContain("export declare function greet(");
  }
  {
    const dts = moduleDts(`export default function addOne(x) {
  return x + 1;
}
`);
    expect(dts).toContain("export default function addOne(");
    expect(dts).not.toContain("export declare function addOne");
  }
  {
    const dts = moduleDts(`const internal = (x) => x + 1;
export { internal as publicName };
`);
    expect(dts).toContain("export { internal as publicName };");
    expect(dts).not.toContain("export declare function internal");
    expect(dts).not.toContain("export declare function publicName");
  }
  {
    const dts = moduleDts(`export class User {
  constructor(name) {
    this.name = name;
  }
}
export function makeUser(name) {
  return new User(name);
}
`);
    expect(dts).toContain("class User");
    expect(dts).toMatch(/makeUser\([^)]*\): User;/);
  }
  {
    const dts = moduleDts(`export class C {
  m(x) {
    return x + 1;
  }
}
`);
    expect(dts).not.toContain("C_m");
    expect(dts).not.toContain("export declare function C_m");
    // 补齐类方法入口兜底后返回类型从 unknown 变精确值，只钉形参与方法存在。
    expect(dts).toMatch(/m\(x: (any|unknown)\): [^;]+;/);
  }
  {
    const dts = moduleDts(`export class C {
  constructor(v) {
    this.v = v;
  }
  m(x) {
    return x + 1;
  }
  static s(x) {
    return x + 2;
  }
}
`);
    expect(dts).toContain("export declare class C {");
    // 类形参无类型证据 ⇒ TS 投影面为 `unknown`（nudo any ≈ TS unknown）；
    // nudo 展示面仍显示 any（AGENT.md：入口无约束形参），两者作用域不同。
    expect(dts).toContain("constructor(v: unknown);");
    // 同上：实例方法返回类型精度随分析面提升，不钉死 unknown。
    expect(dts).toMatch(/m\(x: (any|unknown)\): [^;]+;/);
    // BUG-095：static 返回类型随分析面精度提升（同上方实例位口径）
    expect(dts).toMatch(/static s\(x: (any|unknown)\): [^;]+;/);
  }
  {
    const dts = moduleDts(`export * from "./dep.js";
export { helper } from "./dep.js";
export function own(n) {
  return n * 3;
}
`);
    expect(dts).toContain(`export * from "./dep.js";`);
    expect(dts).toContain(`export { helper } from "./dep.js";`);
    expect(dts).toContain("export declare function own(");
  }
  {
    const surface = dtsModuleSurface(`const internal = (x) => x + 1;
export { internal as publicName };
export default function addOne(x) {
  return x + 1;
}
export function plain() {}
`);
    expect(surface.exportBindings.get("publicName")).toBe("internal");
    expect(surface.exportBindings.get("default")).toBe("addOne");
    expect(surface.exportBindings.get("plain")).toBe("plain");
  }
  {
    const surface = dtsModuleSurface(`export class C {
  constructor(v) {}
  m(x) {}
  static s(x) {}
}
`);
    const cls = surface.classes.get("C");
    expect(cls?.exportName).toBe("C");
    expect(cls?.ctorParams).toEqual(["v"]);
    expect(cls?.instanceMethods.map((m) => m.name)).toEqual(["m"]);
    expect(cls?.staticMethods.map((m) => m.name)).toEqual(["s"]);
  }
  {
    const def = moduleDts(`export default class D {
  m(x) {
    return x + 1;
  }
}
`);
    expect(def).toContain("export default class D {");
    const alias = moduleDts(`class A {
  m(x) {
    return x + 1;
  }
}
export { A as Public };
`);
    expect(alias).toContain("declare class A {");
    expect(alias).toContain("export { A as Public };");
    expect(alias).not.toContain("export declare function A");
  }
  {
    const dts = moduleDts(`export function public1(x) {
  return x + 1;
}
function helper(x) {
  return x + 2;
}
`);
    expect(dts).toContain("export declare function public1(");
    expect(dts).not.toContain("helper");
  }
  {
    const dts = moduleDts(`class Hidden {
  m(x) {
    return x + 1;
  }
}
export function plain(x) {
  return x + 2;
}
`);
    expect(dts).toContain("export declare function plain(");
    expect(dts).not.toContain("Hidden");
  }
  {
    const source = `export class C {
  m(x) {
    return x + 1;
  }
}
`;
    const result = analyzeFile("/test/no-surface.js", source);
    const fn = result.functions.find((f) => f.name === "C.m");
    expect(fn).toBeDefined();
    const proj = projectFunctionDts(fn!);
    expect(proj.lines.join("\n")).toMatch(/export declare function C_m\b/);
    expect(proj.lines.join("\n")).not.toMatch(/C\.m/);
  }
  {
    const fn = {
      name: "a-b",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
      paramNames: ["x"],
      cases: [
        {
          name: "entry@L1",
          argAbs: [],
          abs: { shape: { k: "prim", type: "number" } } as never,
          throwsAbs: { shape: { k: "never" } } as never,
        },
      ],
    } as unknown as Parameters<typeof projectFunctionDts>[0];
    const proj = projectFunctionDts(fn);
    expect(proj.lines.join("\n")).toMatch(/export declare function a_b\b/);
  }
});












  // ── 负控制：本条修复不该波及的邻近形态 ──────────────────────────




});

// ---------------------------------------------------------------------------
// —— dts 顶层形参可选性来自声明形参表
// ---------------------------------------------------------------------------
describe("—— dts 顶层形参可选性来自声明形参表", () => {
/**
 * / dts 顶层形参的**可选性**。
 *
 * 526：可选性取自「**观测到的调用元数**」而非**声明形参表** ⇒ 带**默认值**
 * 的形参在 `.d.ts` 里被渲染成**必填**（消费方 TS2554）。
 * 553：同一根因的另一形态——实现签名里的默认参数被当成必填 ⇒
 * `export declare function def(x: unknown): unknown;` ⇒ 消费方 `def()`
 * 报 TS2554 ⇒ 生成的 `.d.ts` **拒绝实现本身允许的调用**。
 *
 * 修法：可选性来源改为
 * ① 契约级（手写契约申报的调用域，权威；）→
 * ② 声明级（实现签名带默认值 ⇒ JS 语义可省略）→
 * ③ 观测级（最短观测调用省略了该位）。
 */








describe("— dts 顶层形参可选性来自声明形参表", () => {
  it("带默认值的形参渲染成可选（无调用证据时也是）；有调用证据时形参表不缩水（观测元数不再裁剪声明形参表）；默认值为 undefined 的形参同样可选；消费方按实现允许的零参调用不再吃 TS2554；负控制：无默认值的形参仍是必填（不假造可选性）", () => {
  {
    const source = `
export function optNoEvidence(a, b = 2) { return a + b; }
`;
    const dts = generateDts(analyzeFile("/test/s2-opt.js", source));
    // BUG-246：无注解默认值的形参类型取初始化式（number），不强制 any；
    // 本钉只关心可选性标记，类型词接受 any / unknown / number。
    expect(dts).toMatch(/export declare function optNoEvidence\(a: (unknown|any), b\?: (unknown|any|number)\)/);
  }
  {
    const source = `
export function optWithEvidence(a, b = 2) { return a + b; }
optWithEvidence(1);
`;
    const dts = generateDts(analyzeFile("/test/s2-opt2.js", source));
    expect(dts).toContain("export declare function optWithEvidence(a: number, b?: unknown)");
  }
  {
    const source = `
export function optUndefinedDefault(a, b = undefined) { return a; }
`;
    const dts = generateDts(analyzeFile("/test/s2-opt3.js", source));
    expect(dts).toMatch(/export declare function optUndefinedDefault\(a: (unknown|any), b\?: (unknown|any|undefined)\)/);
  }
  {
    const source = `
export function def(x = 1) { return x; }
`;
    const dts = generateDts(analyzeFile("/test/s2-def.js", source));
    // BUG-246：`x = 1` 的入口域 / 返回域取初始化式 number（TS 同口径）。
    expect(dts).toMatch(/export declare function def\(x\?: (unknown|any|number)\): (unknown|any|number);/);
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { def } from "./mod.js";\nexport const r = def();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const source = `
export function need(a, b) { return a + b; }
`;
    const dts = generateDts(analyzeFile("/test/s2-need.js", source));
    expect(dts).toMatch(/export declare function need\(a: (unknown|any), b: (unknown|any)\)/);
    expect(dts).not.toContain("b?:");
  }
});




});
});

// ---------------------------------------------------------------------------
// —— dts 槽位可选性
// ---------------------------------------------------------------------------
describe("—— dts 槽位可选性", () => {
/**
 * / dts 面的**对象槽可选性**渲染。
 *
 * 症状（旧口径 `k: T | undefined`）：
 * - TS 里 `{ id: number | undefined }` 是「**键必需**、值可为 undefined」；
 * 「键可省略」只有 `k?: T` 能表达 ⇒ 投影比契约 / zod / standard / check
 * 四个面都**严**（one-way 投影不得更严 ⇒ 方向反了）。
 * - 消费方按契约/zod 放行的值（缺可选键）在 `.d.ts` 下吃 TS2345 / TS2741。
 * - 同一份产物内部口径相反：顶层形参用 `?`，嵌套字段不用。
 *
 * 修法：`absToTSType` 的 obj 分支把 optional 槽渲染成 `k?: T`。
 */








const objOf = (slots: Record<string, { value: Abs; optional?: boolean }>): Abs =>
  abs({ k: "obj", slots }, undefined, undefined, "exact");

/** tsc --noEmit --strict 实测（产物面必须真能编译；本块沿用既有 skipLibCheck 口径） */
const tscNoEmitSkipLib = (files: Record<string, string>) =>
  tscNoEmit(files, { skipLibCheck: true });

describe("— dts 槽位可选性", () => {
  it("optional 槽渲染成 TS 可选属性 `k?: T`（不再是 `k: T | undefined`）；负控制：必填槽仍是必填（不误伤 `k: T`）；两层嵌套的 optional 槽同样带 `?`（任意深度成立）；消费方省略可选键不再吃 TS2345 / TS2741（改前：键被声明为必需）；负控制：必填键缺失仍报 TS2345（可选性投影不得放宽必填键）", () => {
  {
    const ts = absToTSType(objOf({ a: { value: num(), optional: true }, b: { value: str() } }));
    expect(ts).toBe("{ a?: number; b: string }");
    expect(ts).not.toContain("| undefined");
  }
  {
    const ts = absToTSType(objOf({ a: { value: num() } }));
    expect(ts).toBe("{ a: number }");
  }
  {
    const inner = objOf({ b: { value: num(), optional: true } });
    const ts = absToTSType(objOf({ a: { value: inner } }));
    expect(ts).toBe("{ a: { b?: number } }");
  }
  {
    const dts = "export declare function f(o: { id?: number }): number;\n";
    const check = tscNoEmitSkipLib({
      "mod.d.ts": dts,
      // 契约 / zod / standard / check 四个面都放行 `{ o: {} }`
      "use.ts": 'import { f } from "./mod.js";\nexport const r = f({});\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const dts = "export declare function f(o: { id: number }): number;\n";
    const check = tscNoEmitSkipLib({
      "mod.d.ts": dts,
      "use.ts": 'import { f } from "./mod.js";\nexport const r = f({});\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2345");
  }
});




});
});

// ---------------------------------------------------------------------------
// 必填槽存在性用 HasProperty 语义
// ---------------------------------------------------------------------------
describe("必填槽存在性用 HasProperty 语义", () => {
/**
 * standard 面「必填槽存在性」用**自有属性**判定（假红）。
 *
 * 修前：`Object.hasOwn(rec, key)` ⇒ 继承来的键被当成**缺键** ⇒ 运行时校验器
 * 比 zod 面与 dts 面（TS 结构类型）**都严** ⇒ 对类型系统接受的值报红。
 *
 * 修后：键存在性用 **HasProperty 语义**（原型链上的用户键算「在场」）**减去**
 * `Object.prototype` 的污染键（`toString` / `constructor` …）——与 zod 面 /
 * TS 结构类型同口径。
 *
 * 负控制：`Object.prototype` 的污染键仍算**缺键**（原型污染不是真实槽）；
 * 「缺键 ≠ 显式 undefined」（语义）不回归。
 */






/** `{ c: 1 }` 形状的对象 Abs（槽值 = 字面量 1：prim number shape + lit term）。 */
const shapeAbs = (): Abs =>
  abs(
    { k: "obj", slots: { c: { value: abs({ k: "prim", type: "number" }, { op: "lit", value: 1 }, undefined, "exact") } } },
    undefined,
    undefined,
    "exact",
  );


  it("库函数版：继承来的键算在场，真缺键报 required；生成产物版：与库函数版同口径；负控制：Object.prototype 污染键算缺键；显式 undefined 仍与缺键有别", async () => {
  {
    const { node } = absToSchemaNode(shapeAbs());
    expect(validateSchemaNode(node, { c: 1 }).issues).toBeUndefined();
    // 继承来的 c（无自有 c）⇒ 在场（zod 面与 TS 结构类型都接受）
    const inherited = validateSchemaNode(node, Object.create({ c: 1 }) as object);
    expect(inherited.issues).toBeUndefined();
    // 真缺键 ⇒ required
    const missing = validateSchemaNode(node, {});
    expect(missing.issues?.[0]?.message).toBe("required");
    expect(missing.issues?.[0]?.path).toEqual(["c"]);
  }
  {
    const { source } = absToStandardSchema(shapeAbs(), { name: "mk_x" });
    const mod = await loadGeneratedModule(source);
    expect(mod.mk_x!["~standard"].validate(Object.create({ c: 1 }) as object).issues).toBeUndefined();
    const missing = mod.mk_x!["~standard"].validate({});
    expect(missing.issues?.[0]?.message).toBe("required");
  }
  {
    // 槽名取 "toString"：原型污染键不算在场 ⇒ 报 required（不是「在场且值合法」）
    const polluted = abs(
      {
        k: "obj",
        slots: {
          toString: { value: abs({ k: "prim", type: "string" }, { op: "lit", value: "x" }, undefined, "exact") },
        },
      },
      undefined,
      undefined,
      "exact",
    );
    const { node } = absToSchemaNode(polluted);
    const r = validateSchemaNode(node, {});
    expect(r.issues?.[0]?.message).toBe("required");
    // 显式 undefined 在场 ⇒ 走节点裁决（lit "x" 不匹配 ⇒ 类型错，不是 required）
    const explicit = validateSchemaNode(node, { toString: undefined });
    expect(explicit.issues?.[0]?.message).not.toBe("required");
  }
});



});

// ---------------------------------------------------------------------------
// 生成器 / 迭代器形态投影
// ---------------------------------------------------------------------------
describe("生成器 / 迭代器形态投影", () => {
/**
 * dts 面把**生成器对象**的内部槽当**普通对象字段**直出。
 *
 * 改前：
 * export declare function gen(x: unknown):
 * { 0: unknown; next: () => unknown; return: () => unknown;
 * throw: () => unknown; constructor: GeneratorFunction; "@@iterator": () => unknown };
 * ⇒ 返回类型里**没有** `[Symbol.iterator]()` ⇒ 消费方 `for (const v of gen(1))`
 * 报 **TS2488**（生成的 `.d.ts` 拒绝实现本身允许的用法）。
 *
 * 修法：`obj` 臂先识别**迭代器 / 生成器形态**（有 `next` 槽）⇒ 映射成
 * `Generator<T>` / `AsyncGenerator<T>` / `IterableIterator<T>`（元素类型取
 * 数字下标元素槽）；内部槽（`internal`）不进结构字段（core 的 format 面
 * 同口径）；符号键槽不落成字符串键字段。
 */






const fnSlot = (): { value: Abs; internal?: boolean; symbolKey?: boolean } => ({
  value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
  internal: true,
});

/** 生成器对象形态（core 的 makeGenObject 口径：协议槽 + 数字下标元素槽） */
const generatorObj = (elements: Abs[], async = false): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        ...Object.fromEntries(elements.map((v, i) => [String(i), { value: v, internal: true }])),
        next: fnSlot(),
        return: fnSlot(),
        throw: fnSlot(),
        constructor: { value: abs({ k: "brand", name: "GeneratorFunction", shape: objOf({}) }, undefined, undefined, "path"), internal: true },
        ...(async
          ? {
              "@@asyncIterator": { ...fnSlot(), symbolKey: true },
              "@@toStringTag": { value: numLit(0), internal: true, symbolKey: true },
            }
          : { "@@iterator": { ...fnSlot(), symbolKey: true } }),
      },
    },
    undefined,
    undefined,
    "exact",
  );


  it("同步生成器 → Generator<T>（元素类型取数字下标元素槽）；异步生成器 → AsyncGenerator<T>；负控制：普通数据对象仍是结构体（不误判成迭代器）；内部槽不进结构字段（core format 面同口径：internal 槽不可见）；端到端：生成器函数的 dts 返回 Generator，for…of 消费方过 tsc；改前形态确实红（结构体 ⇒ TS2488）", () => {
  {
    expect(absToTSType(generatorObj([numLit(1)]))).toBe("Generator<number>");
  }
  {
    expect(absToTSType(generatorObj([numLit(1)], true))).toBe("AsyncGenerator<number>");
  }
  {
    const o = abs({ k: "obj", slots: { a: { value: numLit(1) } } }, undefined, undefined, "exact");
    expect(absToTSType(o)).toBe("{ a: 1 }");
  }
  {
    const o = abs(
      { k: "obj", slots: { a: { value: numLit(1) }, "#priv": { value: numLit(2), internal: true } } },
      undefined,
      undefined,
      "exact",
    );
    expect(absToTSType(o)).toBe("{ a: 1 }");
  }
  {
    const dts = generateDts(
      analyzeFile("/test/bug554.js", `export function* gen(x) {\n  yield x;\n}\n`),
    );
    expect(dts).toContain("Generator<");
    expect(dts).not.toContain("@@iterator");
    const consumer = `
import { gen } from "./lib.js";
export function useGen() {
  for (const v of gen(1)) {
    return v;
  }
  return null;
}
`;
    const check = tscNoEmit({ "lib.d.ts": dts, "use.ts": consumer });
    expect(check.ok, check.stderr).toBe(true);
  }
  {
    const before = `
export declare function gen(x: any): { 0: number; next: () => unknown; return: () => unknown; throw: () => unknown; constructor: GeneratorFunction; "@@iterator": () => unknown };
`;
    const consumer = `
import { gen } from "./lib.js";
export function useGen() {
  for (const v of gen(1)) {
    return v;
  }
  return null;
}
`;
    const check = tscNoEmit({ "lib.d.ts": before, "use.ts": consumer });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2488");
  }
});






});

// ---------------------------------------------------------------------------
// 契约面打印以声明形参表为骨架
// ---------------------------------------------------------------------------
describe("契约面打印以声明形参表为骨架", () => {
/**
 * 契约面打印面用**契约里的参数**冒充**函数的形参表**。
 *
 * 病灶：effective 档直接渲染 `eff.params`（**契约声明的参数**）⇒ 契约参数名
 * 冒充函数形参名（`fn({ zzz: … })` 印成 `(zzz: …)`），而 `nudo check` 的签名面
 * 印的是函数真实形参（`(x: any)`）⇒ 同一函数两套形参（跨 verb 自相矛盾）。
 *
 * 本测试钉住：
 * - 打印面的形参表 = **声明形参表**（与 `nudo check` 签名面同源）；
 * - 契约里绑不上的参数**另列一栏**并显式标注（不顶替形参名）；
 * - 负控制：契约参数与形参同名时行为不变（仍落在形参槽位上）。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-contract-559-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

const LIB_JS = `export function scale(x) {
  return x * 2;
}
`;

const MISMATCH_NUDO_JS = `
import { fn, number } from "@nudojs/core";
export const scale = fn({ zzz: number().gt(0) }, number());
`;

const MATCH_NUDO_JS = `
import { fn, number } from "@nudojs/core";
export const scale = fn({ x: number().gt(0) }, number());
`;

const EXTRA_NUDO_JS = `
import { fn, number, string } from "@nudojs/core";
export const scale = fn({ x: number().gt(0), y: string() }, number());
`;


  it("契约参数绑不上形参时：形参表照旧、契约参数另列并显式标注；跨 verb 一致：契约面的形参表与 nudo check 签名面同源；负控制：契约参数与形参同名时行为不变（落在形参槽位、无另列）；负控制：契约多出的参数同样另列，不顶替形参；负控制：无契约（implicit 档）行为不变", async () => {
  {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": MISMATCH_NUDO_JS });
    const file = join(root, "lib.js");
    const entries = await contractSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    expect(scale).toBeDefined();
    expect(scale!.source).toBe("handwritten");

    // 形参表 = 声明形参表（不是契约里的 zzz）
    expect(scale!.params).toEqual([{ name: "x", display: "any" }]);
    // 契约里绑不上的参数另列一栏
    expect(scale!.extraParams).toEqual([{ name: "zzz", display: "number().gt(0)" }]);

    const line = formatContractSurfaceLine(scale!);
    expect(line).toContain("(x: any)");
    expect(line).toContain("zzz: number().gt(0)");
    expect(line).toContain("(not a formal parameter)");
    // 旧病灶形态：契约参数名顶替形参名
    expect(line).not.toContain("(zzz:");
  }
  {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": MISMATCH_NUDO_JS });
    const file = join(root, "lib.js");
    const source = LIB_JS;

    const entries = await contractSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    const report = checkSource(file, source, pTrue, {
      loadModule: defaultLoadModule,
      fromFile: file,
    });
    const sig = report.signatures.find((s) => s.name === "scale");

    expect(sig).toBeDefined();
    expect(scale!.params.map((p) => p.name)).toEqual(sig!.params);
    // check 面把绑不上的契约参数报成 nudo:contract-param-mismatch
    expect(
      report.issues.some((i) => i.code === "nudo:contract-param-mismatch"),
    ).toBe(true);
  }
  {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": MATCH_NUDO_JS });
    const file = join(root, "lib.js");
    const entries = await contractSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    expect(scale!.params).toEqual([{ name: "x", display: "number().gt(0)" }]);
    expect(scale!.extraParams).toBeUndefined();
    expect(formatContractSurfaceLine(scale!)).not.toContain("not a formal parameter");
  }
  {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": EXTRA_NUDO_JS });
    const file = join(root, "lib.js");
    const entries = await contractSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    expect(scale!.params).toEqual([{ name: "x", display: "number().gt(0)" }]);
    expect(scale!.extraParams).toEqual([{ name: "y", display: "string()" }]);
  }
  {
    const root = makeFixture({ "lib.js": LIB_JS });
    const file = join(root, "lib.js");
    const entries = await contractSurface(file);
    const scale = entries.find((e) => e.fn === "scale");
    expect(scale!.source).toBe("implicit");
    expect(scale!.params[0]!.name).toBe("x");
    expect(scale!.extraParams).toBeUndefined();
  }
});





});

// ---------------------------------------------------------------------------
// fix-16：内建下标 / 迭代器 / Object 键家族的 dts + zod 投影
// BUG-289 / 341 / 357 / 362 / 364 / 365 的产物面钉。
// ---------------------------------------------------------------------------
describe("fix-16：内建 dts 投影（下标/迭代器/Object 键家族）", () => {
  const SRC = `
export function idx(xs: number[], i: number) { return xs[i]; }
export function idxStr(xs: string[], i: number) { return xs[i]; }
export function flatN(xs: number[][]) { return xs.flat(); }
export function flat2(xs: number[][][]) { return xs.flat(2); }
export function valOnly(xs: string[]) { return xs.values(); }
export function keyOnly(xs: string[]) { return xs.keys(); }
export function entOnly(xs: string[]) { return xs.entries(); }
export function paramVals(o: { a: number; b: string }) { return Object.values(o); }
export function paramEnt(o: { a: number; b: string }) { return Object.entries(o); }
export function fePairs(kv: [string, number][]): number { return Object.fromEntries(kv).a ?? 0; }
export function matchFull(s: string) { const m = s.match(/a(b)/); return m ? m[0].length : 0; }
export function matchGlobal(s: string) { const m = s.match(/a/g); return m ? m[0].length : 0; }
`;

  const analyzed = () => analyzeFile("/t/fix16.ts", SRC);
  const dts = () => generateDts(analyzed());
  const witness = (name: string, r = analyzed()) =>
    r.functions.find((f) => f.name === name)?.combinedAbs;

  it("BUG-362：arr 抽象下标读发布元素类型（tsc 默认 noUncheckedIndexedAccess=off）", () => {
    const t = dts();
    expect(t).toMatch(/function idx\(xs: number\[\], i: number\): number;/);
    expect(t).toMatch(/function idxStr\(xs: string\[\], i: number\): string;/);
    expect(t).not.toMatch(/function idx\(xs: number\[\], i: number\): number \| undefined;/);
  });

  it("BUG-357：flat 发布展开后的元素域（T[][] → T[]；显式深度同口径）", () => {
    const t = dts();
    expect(t).toMatch(/function flatN\(xs: number\[\]\[\]\): number\[\];/);
    expect(t).toMatch(/function flat2\(xs: number\[\]\[\]\[\]\): number\[\];/);
    expect(t).not.toMatch(/\(number\[\] \| number\)\[\]/);
  });

  it("BUG-364：三个数组迭代器发布元素类型（不再是 IterableIterator<unknown>）", () => {
    const t = dts();
    expect(t).toMatch(/function valOnly\(xs: string\[\]\): IterableIterator<string>;/);
    expect(t).toMatch(/function keyOnly\(xs: string\[\]\): IterableIterator<number>;/);
    expect(t).toMatch(/function entOnly\(xs: string\[\]\): IterableIterator<\[number, string\]>;/);
    expect(t).not.toContain("IterableIterator<unknown>");
  });

  it("BUG-365：Object.values/entries 对封闭注解对象发布槽值域（不是 unknown）", () => {
    const t = dts();
    expect(t).toMatch(/function paramVals\(o: \{ a: number; b: string \}\): \(number \| string\)\[\];/);
    expect(t).toMatch(/function paramEnt\(o: \{ a: number; b: string \}\): \[string, number \| string\]\[\];/);
    expect(t).not.toMatch(/function paramVals\([\s\S]*?\): unknown\[\];/);
    // zod 面同源（BUG-365 报告里的假绿：z.array(z.unknown())）
    const v = witness("paramVals");
    expect(v).toBeDefined();
    const zod = absToZodSchemaModule({ paramValsOutput: v! }).source;
    expect(zod).toMatch(/paramValsOutput = z\.array\(/);
    expect(zod).not.toContain("paramValsOutput = z.array(z.unknown())");
    expect(zod).toContain("z.number(");
  });

  it("BUG-289：fromEntries 的条目数组不再假 may-throw，返回位是声明值域", () => {
    const t = dts();
    expect(t).toMatch(/function fePairs\(kv: \[string, number\]\[\]\): number;/);
  });

  it("BUG-341：String.match 的抽象接收者发布 number（m[0] 恒 string）", () => {
    const t = dts();
    expect(t).toMatch(/function matchFull\(s: string\): number;/);
    expect(t).toMatch(/function matchGlobal\(s: string\): number;/);
  });
});
