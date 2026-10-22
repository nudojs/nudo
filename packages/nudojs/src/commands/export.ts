/**
 * nudo export — 投影：dts | guard | schema (dialect) | standard | all。
 * 从 index.ts 原样迁出；dts 面消费契约证据（sidecar / @nudo:contract /
 * @nudo:case），与 check 签名面同数据源。
 *
 * 本文件是**薄调度器**：产物面的实现在 `./export/` 下按面切分
 * （selection / contract-face / zod-face / standard-face / guard-face /
 * dts-face / diagnostics / io / stdout）。
 */
import { readFileSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import type { Command } from "commander";
import { reportPathErrors, resolveTargetsCollect } from "./shared.ts";
import { effectiveInterface, type Abs } from "@nudojs/core";
import { analyzeFileAsync, type CaseResult, type FunctionAnalysis } from "@nudojs/service";
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
import {
  buildEffectiveInterfaceOptions,
  resolveEvalMocks,
  selectExportFunctions,
  selectPublicFunctions,
} from "./export/selection.ts";
import { unifiedParamFace, unifiedReturnFace } from "./export/contract-face.ts";
import { renderZodModule, zodFaceEntries } from "./export/zod-face.ts";
import { standardFaceChunk } from "./export/standard-face.ts";
import { guardFaceChunk } from "./export/guard-face.ts";
import {
  dtsEntryNames,
  dtsFaceEntry,
  dtsModuleChunk,
  dtsModuleSurfaceOf,
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
import { printExportStdout } from "./export/stdout.ts";

// ---------------------------------------------------------------------------
// export — 投影：dts | guard | schema (dialect) | standard | all
// ---------------------------------------------------------------------------

async function runExport(
  file: string,
  format: ExportFormat,
  output?: string,
  dialect?: SchemaDialect,
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  // case 档 "all"：@nudo:case 见证参与投影面（无指令文件不受影响——
  // call@/entry@ 合成与档位无关）
  const result = await analyzeFileAsync(filePath, source, undefined, undefined, undefined, "all");
  const functions: FunctionAnalysis[] = selectExportFunctions(result);

  // 契约面与 check 签名面同数据源：effectiveInterface（sidecar ∪ inline
  // @nudo:contract），autoBind/projectDir 与 check / iface 面同口径——
  // 项目关 autoBind 时侧车不做 ambient 加载
  const effOpts = buildEffectiveInterfaceOptions(filePath);

  // 导出面裁剪谓词（dts 只发射导出面：export / export default / CJS exports ——
  // 与 check entry 表同源 localNamedExports；导出 class 的实例方法按 Class
  // 前缀放行）。四个产物面**共用**这一道闸门（Bug 621）。
  const onExportFace = exportFacePredicate(dtsEntryNames(source));

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

  if (functions.length === 0) {
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
  // 类声明（一次一类），再导出面按原样复现（族 15 · S1）。
  const dtsSurface = dtsModuleSurfaceOf(source);
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
    const eff = effectiveInterface(source, baseName, effOpts);
    // 契约面上下文（契约域种子重算 / 违约复核需要源码与路径）
    const faceCtx = {
      source,
      filePath,
      ...(evalMocks ? { mocks: evalMocks } : {}),
    };
    const paramExps = unifiedParamFace(fn, eff, caseResults);
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
      const chunk = standardFaceChunk(fn, baseName, paramExps, eff, outputAbs, faceCtx);
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

  // 模块面合成：类声明（一次一类）+ 再导出面 + brand 类声明
  if (format === "dts" || format === "all") {
    const mod = dtsModuleChunk(dtsSurface, dtsEntries);
    if (mod !== undefined) dtsChunks.push(mod);
  }

  const stem = basename(filePath).replace(/\.[cm]?[jt]s$/, "");
  const schemaModule = renderZodModule(schemaExports);

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
  if (publicFunctions.length === 0 && functions.length > 0) {
    console.log(
      "No exported declarations found — export projects the module surface (export / export default / CJS exports).",
    );
    return;
  }

  if (output) {
    const result2 = writeExportArtifacts(resolve(output), {
      stem,
      // 模块标识 = 源文件路径（族 17 · Bug 609 / 622）：没有它，模块身份只能
      // 靠「stem + 导出签名」猜 ⇒ 同 stem **且**导出名集合也相同的两个模块
      // 会被判成同一模块（后者覆盖前者），且改名后重导会换唯一名、留下陈旧副本。
      moduleKey: filePath,
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
