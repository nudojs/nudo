/**
 * nudo export — 投影：dts | guard | schema (dialect) | standard | all。
 * 从 index.ts 原样迁出；dts 面消费契约证据（sidecar / @nudo:contract /
 * @nudo:case），与 check 签名面同数据源。
 *
 * 本文件是**薄调度器**：产物面的实现在 `./export/` 下按面切分
 * （selection / contract-face / zod-face / standard-face / guard-face /
 * dts-face / diagnostics / io / stdout）。
 */
import { existsSync, readFileSync } from "node:fs";
import { parseJsonText } from "../read-json.ts";
import { resolve, basename, dirname, join, relative, sep } from "node:path";
import type { Command } from "commander";
import { reportPathErrors, resolveTargetsCollect } from "./shared.ts";
import {
  effectiveContract,
  abs as makeAbs,
  anyAbs,
  localNamedExports,
  type Abs,
  type FormalParam,
} from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { analyzeFileAsync, type CaseResult, type FunctionAnalysis } from "@nudojs/service";
import { dtsModuleSurface, isRuntimeGlobalCtorName } from "@nudojs/service/emit";
import {
  SCHEMA_DIALECTS,
  normalizeDialect,
  normalizeExportFormat,
  schemaDialectOf,
  wantsSchema,
  wantsStandard,
  type ExportFormat,
} from "../export-format.ts";
import type { SchemaDialect } from "@nudojs/service/emit";
import { DIAG } from "@nudojs/core/internal";
import {
  buildEffectiveContractOptions,
  resolveEvalMocks,
  selectExportFunctions,
  selectPublicFunctions,
} from "./export/selection.ts";
import { unifiedParamFace, unifiedReturnFace, type ParamFace } from "./export/contract-face.ts";
import { renderZodModule, zodFaceEntries } from "./export/zod-face.ts";
import { standardFaceChunk } from "./export/standard-face.ts";
import { guardFaceChunk } from "./export/guard-face.ts";
import {
  dtsFaceEntry,
  dtsModuleChunk,
  dtsUnevidencedParams,
  exportFacePredicate,
  type DtsFaceEntry,
} from "./export/dts-face.ts";
import {
  collectExportDiagnostics,
  reportExportDiagnostics,
  reportMockSeedFailure,
  reportUnevidencedParams,
} from "./export/diagnostics.ts";
import { writeExportArtifacts, writtenPathLines } from "./export/io.ts";
import { moduleIdOf } from "./export/module-id.ts";
import { printExportStdout } from "./export/stdout.ts";

// ---------------------------------------------------------------------------
// export — 投影：dts | guard | schema (dialect) | standard | all
// ---------------------------------------------------------------------------

/**
 * 一个声明形参在**统一参数面**里可能占用的槽名。
 *
 * 槽名与 `unifiedParamFace` 的产出同名：标识 / 默认 / 剩余参数位取形参名
 * （剩余参数另取带 `...` 的展示名）；解构位取**整参契约名**（占位名 / `_`）
 * 或**字段级**条目名（顶层绑定名 / 点路径首段）。
 */
function formalSlotNames(formal: FormalParam): Set<string> {
  switch (formal.kind) {
    case "id":
    case "default":
      return new Set([formal.name]);
    case "rest":
      return new Set([formal.name, formal.display]);
    case "pattern":
      return new Set([formal.placeholder, "_", ...formal.bound]);
  }
}

/**
 * Bug 394：数组解构形参的**输入面**必须是**数组 / 元组**形态。
 *
 * 侧车契约按**绑定名**声明（`fn({ a: number() })` 对 `[a, b]` 来说 `a` 是
 * **下标 0 的元素**，不是属性键）⇒ 统一参数面把它摊成对象槽
 * （`z.object({ a: … })`）⇒ 产物的输入面与真实形参形态**完全颠倒**：
 * 合法的数组调用被判红、非法的对象调用被放行。
 *
 * 修法（产物面兜底）：把该形参的**字段级**槽合成**一个元组槽**——元素位
 * 按**下标**寻址（`FormalParam.boundIndex`，core 形参表面模型的扩展）；
 * 未契约的元素位留 `any`（**无约束**，不是 `unknown`——unknown 表示引擎
 * 推导失败；契约没写的元素位是「没约束」⇒ any，与入口无约束参数同口径）；
 * 元组长度 = 模式的**位置数**（声明级 ⇒ 不被单次观测裁剪）。
 */
function arrayPatternTupleFace(
  formal: Extract<FormalParam, { kind: "pattern" }>,
  own: readonly ParamFace[],
): ParamFace | undefined {
  // 只处理**字段级**槽（名字是绑定名）；整参契约（占位名 / `_`）与无契约
  // 回落（观测面）都已经是**整个实参**形态 ⇒ 原样保留。
  // 整参契约与字段级契约**同时**存在时也保留原样（用户的整参申报优先）。
  const fieldLevel = own.filter(
    (e) => formal.bound.includes(e.name) && e.name !== formal.placeholder && e.name !== "_",
  );
  if (fieldLevel.length === 0) return undefined;
  const indexOf = (name: string): number =>
    formal.boundIndex?.[name] ?? formal.bound.indexOf(name);
  const lastIndex = formal.bound.reduce((acc, b) => Math.max(acc, indexOf(b)), -1);
  const elements: Abs[] = [];
  for (let i = 0; i <= lastIndex; i++) elements.push(anyAbs);
  for (const e of fieldLevel) {
    const idx = indexOf(e.name);
    if (idx < 0 || idx > lastIndex) continue;
    elements[idx] = e.abs;
  }
  return {
    name: formal.placeholder,
    abs: makeAbs({ k: "tuple", elements }, undefined, undefined, "exact"),
    optional: false,
  };
}

/**
 * Bug 394：把数组解构形参的字段级槽**合成元组槽**（见
 * {@link arrayPatternTupleFace}）。其余形参原样保留。
 */
function arrayPatternParamFaces(
  fn: FunctionAnalysis,
  paramExps: readonly ParamFace[],
): ParamFace[] {
  const formals = fn.formals ?? [];
  if (!formals.some((f) => f.kind === "pattern" && f.patternKind === "array")) {
    return [...paramExps];
  }
  const out: ParamFace[] = [];
  let pi = 0;
  for (const formal of formals) {
    // 统一参数面按形参顺序产出 ⇒ 逐形参认领属于自己的槽
    const names = formalSlotNames(formal);
    const own: ParamFace[] = [];
    while (pi < paramExps.length && names.has(paramExps[pi]!.name)) {
      own.push(paramExps[pi]!);
      pi++;
    }
    if (formal.kind === "pattern" && formal.patternKind === "array") {
      const tuple = arrayPatternTupleFace(formal, own);
      if (tuple) {
        out.push(tuple);
        continue;
      }
    }
    out.push(...own);
  }
  // 契约名与声明形参表对不上的孤儿槽（Bug 607：按契约原样保留）
  out.push(...paramExps.slice(pi));
  return out;
}

/**
 * BUG-051 续修：源码里**任意深度**的类名（声明 / 表达式，含赋给变量的
 * 类表达式）——保守集合，只用于「这个名字是否被本模块的类遮蔽」。
 *
 * 判据必须覆盖 `export default class Date` 与函数 / 块级 `class Date`：
 * `result.bindings` 只收**顶层语句**的绑定 ⇒ 这两种形态漏掉，而它们的实例
 * brand 名就是 `Date` ⇒ 产物仍发 `z.instanceof(Date)`（产物模块里恒解析为
 * 全局）⇒ 校验器拒收实现自己的返回值。类名是唯一需要的信息，AST 走一遍
 * 全部类节点即可；多收一个同名类只会让该 brand 降级为 unknown（放行 +
 * 留痕），不会假绿。
 */
function classNamesInSource(source: string): Set<string> {
  const out = new Set<string>();
  let ast: unknown;
  try {
    ast = parse(source);
  } catch {
    return out;
  }
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const rec = node as Record<string, unknown>;
    const type = rec.type;
    if (type === "ClassDeclaration" || type === "ClassExpression") {
      const id = rec.id as Record<string, unknown> | null | undefined;
      if (id && typeof id.name === "string") out.add(id.name);
    } else if (type === "VariableDeclarator") {
      // `const Date = class { … }`：类表达式自身无 id ⇒ 绑定名来自声明符
      const init = rec.init as Record<string, unknown> | undefined;
      if (init?.type === "ClassExpression") {
        const id = rec.id as Record<string, unknown> | undefined;
        if (id && typeof id.name === "string") out.add(id.name);
      }
    }
    for (const [key, value] of Object.entries(rec)) {
      // 位置 / 注释等元数据不是子节点（避免无谓遍历与自引用）
      if (
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "leadingComments" ||
        key === "trailingComments" ||
        key === "innerComments" ||
        key === "comments" ||
        key === "tokens"
      ) {
        continue;
      }
      if (value !== null && typeof value === "object") visit(value);
    }
  };
  visit(ast);
  return out;
}

async function runExport(
  file: string,
  format: ExportFormat,
  output?: string,
  dialect?: SchemaDialect,
): Promise<void> {
  const filePath = resolve(file);
  // BUG-091：读失败走路径错误通道（`nudo:path-io` + fix 行），不冒泡裸 errno。
  let source: string;
  try {
    source = readFileSync(filePath, "utf-8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    reportPathErrors([
      {
        path: filePath,
        code: DIAG.pathIo,
        message: `Cannot read ${filePath}: ${reason}`,
        suggestion:
          "check the path exists and is readable (file permissions / IO); fix the path or grant access, then re-run",
      },
    ]);
    process.exitCode = 1;
    return;
  }
  // case 档 "none"：与**门禁面**（check / health / migrate）同口径 —— 发布面
  // **不**消费 `@nudo:case`。文档明文（`docs/concepts/directives.md:44`）：
  // 「Cases are debug witnesses … not the contract product」。旧实现用 "all"
  // ⇒ 一条调试用的 `@nudo:case "dom" (number())` 就成了被**发布**出去的类型
  // （dts `f(x: number): number` / zod `z.number()` / guard `typeof data ===
  // "number"`），而实现允许 `f("s")` ⇒ 四个产物面一致地拒绝实现允许的调用，
  // 且与 `nudo check` 的签名相反（BUG-044）。
  //
  // call@ / entry@ 合成与档位无关 ⇒ 调用点观测与入口观测照旧参与投影面。
  const result = await analyzeFileAsync(filePath, source, undefined, undefined, undefined, "none");
  const functions: FunctionAnalysis[] = selectExportFunctions(result);

  // 契约面与 check 签名面同数据源：effectiveContract（sidecar ∪ inline
  // @nudo:contract），autoBind/projectDir 与 check / iface 面同口径——
  // 项目关 autoBind 时侧车不做 ambient 加载
  const effOpts = buildEffectiveContractOptions(filePath);

  // 导出面裁剪谓词（dts 只发射导出面：export / export default / CJS exports ——
  // 与 check entry 表同源 localNamedExports；导出 class 的实例方法按 Class
  // 前缀放行）。四个产物面**共用**这一道闸门（Bug 621）。
  const onExportFace = exportFacePredicate(localNamedExports(source));

  // 诊断面（Bug 610 / 607 / 625）：契约面装载失败 / 契约形参名与声明形参表
  // 不匹配 / 契约合取不可满足 ⇒ 产物面会发布一份与契约不符的投影 ⇒ 阻断级：
  // 真实诊断上屏（stderr）+ exit 1 + **不发布产物**。
  const diagnostics = collectExportDiagnostics({
    filePath,
    source,
    result,
    effOpts,
    onExportFace,
  });
  if (diagnostics.blocking) {
    reportExportDiagnostics(diagnostics);
    process.exitCode = 1;
    return;
  }

  // 模块面（导出名 / 类 / 再导出）：**早于**空函数早退组装 —— 纯 barrel
  // （`export { x } from "./y.js"`，本文件无函数）也要出模块面产物；早退在
  // 模块面组装之前 ⇒ 再导出被整个丢掉（BUG-033）。
  const dtsSurface = dtsModuleSurface(source);

  /**
   * BUG-051 续修：本模块里**遮蔽了同名全局构造器**的用户绑定（`class Date` /
   * `import { Date } from …` / 顶层 `const Map = …`）。
   *
   * brand 的 Abs 只有 `{name}`，不含值身份 ⇒ `class Date` 的实例与真内建
   * Date 实例在 Abs 上同形。zod / standard 两个产物面是**独立模块**（不 import
   * 源的任何绑定）⇒ 产物里的 `Date` 恒解析为全局 ⇒ `z.instanceof(Date)` 拒收
   * 函数自己的返回值（`expected Date, received Date`），而 dts 面（`declare
   * class Date`）判对。判据用**绑定表**（类 / 函数 / 顶层值 / import 本地名
   * 都在里面）而不是 `dtsSurface.imports`——后者按**导出名**建键
   * （`import { X as Y }` 记 "X"），拿不到本地绑定名。
   *
   * `result.bindings` 只含**顶层语句**的绑定 ⇒ `export default class Date`
   * 与函数 / 块级 `class Date` 漏掉（它们照样遮蔽同名全局，实例 brand 仍是
   * `Date`）⇒ 产物仍发 `z.instanceof(Date)`。补两道来源：模块类面（顶层类
   * 声明，含 default）与全深度类名 AST 扫描（保守；多判遮蔽只降精度，不会
   * 把真实全局实例错判成可投影）。
   */
  const shadowedGlobals = new Set<string>();
  const noteShadowedGlobal = (name: string): void => {
    if (isRuntimeGlobalCtorName(name)) shadowedGlobals.add(name);
  };
  for (const name of result.bindings.keys()) noteShadowedGlobal(name);
  for (const name of dtsSurface.classes.keys()) noteShadowedGlobal(name);
  for (const name of classNamesInSource(source)) noteShadowedGlobal(name);
  const brandScope = shadowedGlobals.size > 0 ? { shadowedGlobals } : undefined;

  // 空产物的唯一判据：**既无本地函数，也无模块面可发射内容**（BUG-033 的再导出 /
  // BUG-190 的模块级值导出；Bug 24：**类与 namespace 同样是模块面可发射内容**）。
  //
  // 只需一个 DTO 类（`export class User { constructor(…) { … } }`，没有方法）就
  // 没有任何函数级分析条目；`dtsSurface.classes` 却已收好整个声明面。纯
  // `export namespace NS { … }` 同理。旧判据把「模块面」窄化成再导出 + 值声明
  // 两类 ⇒ 这两类模块整份 .d.ts 早退、`--out` 连目录都不建、exit 0。
  const wantsDtsFace = format === "dts" || format === "all";
  const hasValueExport = [...dtsSurface.exportBindings.values()].some(
    (local) => local !== "" && dtsSurface.values.has(local),
  );
  const hasClassSurface = dtsSurface.classes.size > 0;
  const hasNamespaceSurface = (dtsSurface.namespaces?.size ?? 0) > 0;
  const hasTypeDeclarations = (dtsSurface.typeDeclarations?.length ?? 0) > 0;
  const hasModuleSurface =
    wantsDtsFace &&
    (dtsSurface.reexports.length > 0 ||
      hasValueExport ||
      hasClassSurface ||
      hasNamespaceSurface ||
      hasTypeDeclarations);
  if (functions.length === 0 && !hasModuleSurface) {
    console.log("No analyzed functions found.");
    return;
  }

  // 契约种子求值的 @nudo:mock 种子（与 analyzer 文件级种子同口径；env 面
  // 不在此装配——env 依赖体 fail-closed 落 unknown，不伪造精度）
  const mockResult = resolveEvalMocks(source, filePath);
  if (mockResult.warning !== undefined) {
    // mock 种子求值失败不得静默降级——导出面会无告警变 unknown；
    // 上屏（含原因）后仍降级 undefined（不炸导出）
    reportMockSeedFailure(filePath, mockResult.warning);
  }
  const evalMocks = mockResult.mocks;

  // 模块导出面（导出名 / 类 / 再导出）：dts 投影按**导出名**声明，类成员进
  // 类声明（一次一类），再导出面按原样复现（族 15 · S1）。`dtsSurface` 已在
  // 空函数早退之前组装（BUG-033：纯 barrel 也要出模块面产物）。
  /** dts 逐函数投影（模块面合成用：类声明一次一类 + 再导出 + brand 类） */
  const dtsEntries: DtsFaceEntry[] = [];

  const effectiveDialect = schemaDialectOf(format, dialect);
  // zod 导出表：**无原型** + **不折叠同名**（族 17 · Bug 623）——
  // 普通对象把同名条目后者覆盖前者（实测：同一个类里两个同名方法 ⇒ zod 产物
  // 只剩 1 个 `C_mInput`，另一个方法的证据凭空消失）⇒ 键侧先去重
  // （`C_mInput` / `C_mInput_2`），再交给 service 的 `zodExportIdent` 做
  // 标识符级去重（两层去重各司其职）。
  const schemaExports: Record<string, Abs> = Object.create(null) as Record<string, Abs>;
  /** zod 导出名占用表（键侧去重：同名条目各自成一条，不折叠）。 */
  const zodExportNames = new Set<string>();
  /** guard 标识符占用表（同一份产物 = 同一作用域 ⇒ 跨函数块共享）。 */
  const guardIdents = new Set<string>();
  const standardChunks: string[] = [];
  const guardChunks: string[] = [];
  const dtsChunks: string[] = [];
  const droppedNotes: string[] = [];
  /** 无证据（无契约 / 无 case / 无调用点）而落 unknown 的参数位（stderr 提示用） */
  const unevidencedParams: string[] = [];

  // 导出面过滤（**循环入口**，四个产物面共用一道闸门）：dts 面此前独有这道
  // 过滤，zod / standard / guard 三面不裁剪 ⇒ 同一次导出里「哪些函数算公开」
  // 有四套口径（内部实现照样产出运行时校验器，.d.ts 却静默缺席）——Bug 621。
  const publicFunctions = selectPublicFunctions(functions, onExportFace);

  for (const fn of publicFunctions) {
    const caseResults: CaseResult[] = fn.cases;
    const baseName = fn.name;

    // 运行时校验器应尽量反映**契约域**，而不是单次调用点字面量。
    const declared = effectiveContract(source, baseName, effOpts);
    // `@generated` 档 = emit 时刻的**事实快照**（docs/design/refine-derivation.md：
    // 不执法，只 drift）。公开产物面（zod / standard / guard / dts）把它当
    // 义务发布 ⇒ `fn({a: lit(1)}, lit(2))` 让产物只接受 `a: 1` / 返回 `2`，
    // 而实现允许任意值、`nudo check` 也只报 warning（nudo:contract-drift）
    // ⇒ 门禁与产物相反裁决，产物拒收实现自己的合法返回值。生成档不进公开
    // 面：回落分析面 Abs（真实可接受域的观测近似）。
    const eff = declared?.source === "generated" ? undefined : declared;
    // 契约面上下文（契约域种子重算 / 违约复核需要源码与路径）
    const faceCtx = {
      source,
      filePath,
      ...(evalMocks ? { mocks: evalMocks } : {}),
    };
    const paramExps = arrayPatternParamFaces(fn, unifiedParamFace(fn, eff, caseResults));
    const outputAbs = unifiedReturnFace(fn, eff, caseResults, faceCtx);

    if (wantsSchema(format)) {
      // 一个可 import 的 zod 模块：`<fn>Input`（参数对象）+ `<fn>Output`
      for (const [name, abs] of zodFaceEntries(baseName, paramExps, outputAbs)) {
        // 同名条目不折叠（Bug 623）：占用表命中 ⇒ 加 `_2` / `_3` … 后缀
        let key = name;
        for (let i = 2; zodExportNames.has(key); i++) {
          key = `${name}_${i}`;
        }
        zodExportNames.add(key);
        schemaExports[key] = abs;
      }
    }

    if (wantsStandard(format)) {
      const chunk = standardFaceChunk(fn, baseName, paramExps, eff, outputAbs, faceCtx, brandScope);
      if (chunk) {
        standardChunks.push(chunk.source);
        for (const note of chunk.dropped) {
          droppedNotes.push(note);
        }
      }
    }

    if (format === "guard" || format === "all") {
      // 守卫消费**统一返回面**（契约面优先，599 / 613）⇒ 与 zod / standard /
      // dts 三个面同一口径（出口域 = 契约申报的域，不再是单次调用点字面量）
      guardChunks.push(guardFaceChunk(baseName, outputAbs, guardIdents));
    }

    if (format === "dts" || format === "all") {
      // 只发射导出面：非 export 的顶层函数是模块内部实现，不进 .d.ts
      if (onExportFace(fn.name)) {
        const entry = dtsFaceEntry(
          fn,
          baseName,
          eff,
          source,
          filePath,
          evalMocks,
          dtsSurface,
        );
        // 函数声明行由**模块面**统一合成（类声明一次一类、再导出面）⇒ 这里
        // 只收集，不单独 push（否则同一条声明出两遍）。
        dtsEntries.push(entry);
        for (const p of dtsUnevidencedParams(entry, baseName)) {
          unevidencedParams.push(p);
        }
      }
    }
  }

  // 模块面合成：类声明（一次一类）+ 再导出面 + brand 类声明 + 模块级值声明
  // （BUG-190：`export const/let/var` / `enum` 的类型取自分析面绑定；
  //  BUG-151：`class C` 的实例 brand 取自同一张绑定表 ⇒ 类体字段可见）
  if (format === "dts" || format === "all") {
    const values = new Map<string, Abs>();
    for (const [name, info] of result.bindings) values.set(name, info.abs);
    const mod = dtsModuleChunk(dtsSurface, dtsEntries, { values });
    if (mod !== undefined) dtsChunks.push(mod);
  }

  const stem = basename(filePath).replace(/\.[cm]?[jt]s$/, "");
  const schemaModule = renderZodModule(schemaExports, brandScope);

  // 无证据参数的 stderr 提示（docs/design/cli-semantics.md §2 的 unknown
  // 例外面）：指向三条补证据路径，stdout 投影面保持可钉住
  if (format === "dts" || format === "all") {
    reportUnevidencedParams(unevidencedParams);
  }

  // dts 是模块面投影：函数存在但无导出声明面时如实说明（非错误，exit 0）
  if (format === "dts" && functions.length > 0 && dtsChunks.length === 0) {
    console.log(
      "No exported declarations found — dts projects the module surface (export / export default / CJS exports).",
    );
    return;
  }

  // 模块无公开面 ⇒ 四个产物面都无产物（Bug 621：四口径统一）——如实说明，
  // 不静默零产物。
  //
  // Bug 31：`publicFunctions` 只数**导出函数**，而模块面（`export const` / 再导出 /
  // 类 / namespace）在此之前已由 `:391` 的 `dtsModuleChunk` 组装进 `dtsChunks`。
  // 「私有 helper + `export const VERSION = 1`」因此命中过旧的第二道早退，把
  // 已组装好的 dts 产物整份丢掉 ⇒ 只因多了一个本来就不属于任何产物面的私有
  // 函数。判据必须看「是否真的零产物」：`dtsChunks` 非空 ⇒ 有模块面 ⇒ 不早退。
  if (publicFunctions.length === 0 && functions.length > 0 && dtsChunks.length === 0) {
    console.log(
      "No exported declarations found — export projects the module surface (export / export default / CJS exports).",
    );
    return;
  }

  if (output) {
    const result2 = writeExportArtifacts(resolve(output), {
      stem,
      // 模块标识 = **与绝对路径无关**的稳定 id（BUG-016）：绝对源路径会让
      // 「同一模块」的判定挂在本机 checkout 路径上 ⇒ 换目录重导多一份陈旧
      // 副本，且产物内嵌构建机路径（不可复现构建）。
      moduleKey: moduleIdOf(filePath, source),
      // BUG-232：**另一个**可选字段（模块身份仍与路径无关，BUG-016 不回归）——
      // 只用于 `--out` 落盘时重基 dts 产物里的相对说明符与声明扩展名（Bug 32）。
      sourcePath: filePath,
      // Bug 46：standard / all 面才回收上一轮的陈旧 `<fn>.nudo.standard.ts`。
      standardFace: format === "standard" || format === "all",
      dialect: effectiveDialect,
      ...(schemaModule !== undefined ? { schemaSource: schemaModule.source } : {}),
      standardChunks,
      guardChunks,
      dtsChunks,
    });
    if (!result2.ok) return;
    for (const line of writtenPathLines(result2.written)) {
      console.log(line);
    }
    return;
  }

  printExportStdout({
    ...(schemaModule !== undefined ? { schemaSource: schemaModule.source } : {}),
    standardChunks,
    guardChunks,
    dtsChunks,
    droppedNotes,
  });
}

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Project inferred types: dts | guard | schema | standard | all")
    .argument("<file>", "JavaScript/TypeScript file to analyze")
    .option(
      "--format <format>",
      "Output format: dts, guard, schema, standard, all",
      "dts",
    )
    .option("--dialect <dialect>", "Schema dialect (currently: zod). Applies to --format schema|all")
    .option("--out <dir>", "Write projection files to this directory (omit for stdout)")
    .action(
      async (
        file: string,
        options: { format: string; dialect?: string; out?: string },
      ) => {
        const format = normalizeExportFormat(options.format);
        if (!format) {
          console.error(
            `Unknown --format ${options.format}; expected dts | guard | schema | standard | all`,
          );
          process.exitCode = 1;
          return;
        }
        const dialect = normalizeDialect(options.dialect);
        if (options.dialect !== undefined && dialect === undefined) {
          console.error(`Unknown --dialect ${options.dialect}; expected ${SCHEMA_DIALECTS.join(" | ")}`);
          process.exitCode = 1;
          return;
        }
        if (dialect !== undefined && !wantsSchema(format)) {
          console.error(`--dialect is only valid with --format schema|all (got ${format})`);
          process.exitCode = 1;
          return;
        }
        // BUG-023：export 是唯一完全绕开 PathError 面的主命令——
        // 输入路径解析走 resolveTargetsCollect（不存在 / 空目录 /
        // 非目标文件 → nudo:path-* + fix: 提示 + exit 1），
        // 不再让 ENOENT 原文带绝对路径进 CI 日志。
        const { targets, errors } = resolveTargetsCollect(file);
        if (errors.length > 0) {
          reportPathErrors(errors);
          return;
        }
        // export 是单文件投影面——目录输入旧行为是
        // EISDIR 裸崩；显式 usage error 更稳（不静默
        // 挑第一个文件）
        if (targets.length !== 1) {
          console.error(
            `error: export takes exactly one analysis file (got ${targets.length} from ${file})`,
          );
          console.error("fix:  pass the single .js/.mjs/.ts file to project");
          process.exitCode = 1;
          return;
        }
        await runExport(targets[0]!, format, options.out, dialect);
      },
    );
}
