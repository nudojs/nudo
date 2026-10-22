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
import { reportMockSeedFailure, reportUnevidencedParams } from "./export/diagnostics.ts";
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

  if (functions.length === 0) {
    console.log("No analyzed functions found.");
    return;
  }

  // 契约面与 check 签名面同数据源：effectiveInterface（sidecar ∪ inline
  // @nudo:contract），autoBind/projectDir 与 check / iface 面同口径——
  // 项目关 autoBind 时侧车不做 ambient 加载
  const effOpts = buildEffectiveInterfaceOptions(filePath);
  // 契约种子求值的 @nudo:mock 种子（与 analyzer 文件级种子同口径；env 面
  // 不在此装配——env 依赖体 fail-closed 落 unknown，不伪造精度）
  const mockResult = resolveEvalMocks(source, filePath);
  if (mockResult.warning !== undefined) {
    // mock 种子求值失败不得静默降级——导出面会无告警变 unknown；
    // 上屏（含原因）后仍降级 undefined（不炸导出）
    reportMockSeedFailure(filePath, mockResult.warning);
  }
  const evalMocks = mockResult.mocks;

  // dts 只发射导出面（export / export default / CJS exports —— 与 check
  // entry 表同源 localNamedExports；导出 class 的实例方法按 Class 前缀放行）
  const onExportFace = exportFacePredicate(dtsEntryNames(source));
  // 模块导出面（导出名 / 类 / 再导出）：dts 投影按**导出名**声明，类成员进
  // 类声明（一次一类），再导出面按原样复现（族 15 · S1）。
  const dtsSurface = dtsModuleSurfaceOf(source);
  /** dts 逐函数投影（模块面合成用：类声明一次一类 + 再导出 + brand 类） */
  const dtsEntries: DtsFaceEntry[] = [];

  const effectiveDialect = schemaDialectOf(format, dialect);
  const schemaExports: Record<string, Abs> = {};
  const standardChunks: string[] = [];
  const guardChunks: string[] = [];
  const dtsChunks: string[] = [];
  const droppedNotes: string[] = [];
  /** 无证据（无契约 / 无 case / 无调用点）而落 unknown 的参数位（stderr 提示用） */
  const unevidencedParams: string[] = [];

  for (const fn of functions) {
    const caseResults: CaseResult[] = fn.cases;
    const baseName = fn.name;

    // 运行时校验器应尽量反映**契约域**，而不是单次调用点字面量。
    const eff = effectiveInterface(source, baseName, effOpts);
    const paramExps = unifiedParamFace(fn, eff, caseResults);
    const outputAbs = unifiedReturnFace(fn, eff, caseResults);

    if (wantsSchema(format)) {
      // 一个可 import 的 zod 模块：`<fn>Input`（参数对象）+ `<fn>Output`
      for (const [name, abs] of zodFaceEntries(baseName, paramExps, outputAbs)) {
        schemaExports[name] = abs;
      }
    }

    if (wantsStandard(format)) {
      const chunk = standardFaceChunk(fn, baseName, paramExps, eff, outputAbs);
      if (chunk) {
        standardChunks.push(chunk.source);
        for (const note of chunk.dropped) {
          droppedNotes.push(note);
        }
      }
    }

    if (format === "guard" || format === "all") {
      guardChunks.push(guardFaceChunk(fn, baseName, caseResults));
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

  if (output) {
    const result2 = writeExportArtifacts(resolve(output), {
      stem,
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
    dialect: effectiveDialect,
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
