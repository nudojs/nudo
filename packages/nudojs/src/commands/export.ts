/**
 * nudo export — 投影：dts | guard | schema (dialect) | standard | all。
 * 从 index.ts 原样迁出；dts 面消费契约证据（sidecar / @nudo:contract /
 * @nudo:case），与 check 签名面同数据源。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, relative, join, basename, dirname } from "node:path";
import type { Command } from "commander";
import { reportPathErrors, resolveTargetsCollect, displayPathOf, type PathError } from "./shared.ts";
import {
  abs as makeAbs,
  effectiveInterface,
  constraintToEntryAbs,
  joinAbs,
  localNamedExports,
  obj,
  type Abs,
} from "@nudojs/core";
import { extractDirectives, parse } from "@nudojs/parser";
import {
  absToStandardSchemaFunction,
  absToZodSchemaModule,
  dtsModuleSurface,
  domainEvidenceCases,
  projectFunctionDts,
  projectModuleDts,
  type SchemaDialect,
  generateGuardFunctionFromAbs,
  type DtsContractFace,
  type DtsFunctionProjection,
} from "@nudojs/service/emit";
import {
  defaultLoadModule,
  analyzeFileAsync,
  findProjectConfig,
  interfaceConfig,
  mockDirectivesToAbsSeeds,
  mockSeedsToAbsMocks,
  tryEvalCall,
  type CaseResult,
  type FunctionAnalysis,
} from "@nudojs/service";
import {
  EXPORT_FORMATS,
  SCHEMA_DIALECTS,
  normalizeDialect,
  normalizeExportFormat,
  schemaDialectOf,
  schemaFileName,
  wantsSchema,
  wantsStandard,
  type ExportFormat,
} from "../export-format.ts";
import { DIAG } from "@nudojs/core/internal";

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
  const functions = result.functions.filter((f) => f.cases.length > 0);

  if (functions.length === 0) {
    console.log("No analyzed functions found.");
    return;
  }

  // 契约面与 check 签名面同数据源：effectiveInterface（sidecar ∪ inline
  // @nudo:contract），autoBind/projectDir 与 check / iface 面同口径——
  // 项目关 autoBind 时侧车不做 ambient 加载
  const proj = findProjectConfig(dirname(filePath));
  const autoBindCfg = interfaceConfig(proj?.config).autoBind;
  const effOpts = {
    loadModule: defaultLoadModule,
    fromFile: filePath,
    ...(autoBindCfg !== undefined ? { autoBind: autoBindCfg } : {}),
    ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
  };
  // 契约种子求值的 @nudo:mock 种子（与 analyzer 文件级种子同口径；env 面
  // 不在此装配——env 依赖体 fail-closed 落 unknown，不伪造精度）
  let evalMocks: Record<string, Abs> | undefined;
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectives(parse(source)), {
      fromFile: filePath,
      loadModule: defaultLoadModule,
    });
    const mocks = mockSeedsToAbsMocks(seeds);
    evalMocks = Object.keys(mocks).length > 0 ? mocks : undefined;
  } catch (err) {
    // mock 种子求值失败不得静默降级——导出面会无告警变 unknown；
    // 上屏（含原因）后仍降级 undefined（不炸导出）
    console.error(
      `warning: @nudo:mock seed evaluation failed for ${filePath}: ${(err as Error).message} — mocks not applied; contract faces may render unknown`,
    );
    evalMocks = undefined;
  }
  // dts 只发射导出面（export / export default / CJS exports —— 与 check
  // entry 表同源 localNamedExports；导出 class 的实例方法按 Class 前缀放行）
  const entryNames = localNamedExports(source);
  // 模块导出面（导出名 / 类 / 再导出）：dts 投影按**导出名**声明，类成员进
  // 类声明（一次一类），再导出面按原样复现（族 15 · S1）。
  const dtsSurface = dtsModuleSurface(source);
  /** dts 逐函数投影（模块面合成用：类声明一次一类 + 再导出 + brand 类） */
  const dtsEntries: Array<{
    fn: FunctionAnalysis;
    projection: DtsFunctionProjection;
    contract?: DtsContractFace;
  }> = [];
  const onExportFace = (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
  /**
   * 契约参数面：eff.params → entry Abs（无 eff / 无参数契约 = 空表）。
   *
   * `optional`：契约级**顶层形参可选性**（Bug 536）——`constraintToEntryAbs`
   * 对标量契约会**丢掉** `isOptional`（entry Abs 里没有该信息），故可选性必须
   * 由契约面显式带过来；缺省（undefined）= 契约未申报该位 ⇒ 按**必填**处理
   * （契约是用户申报的调用域，权威）。
   */
  const contractParamsOf = (
    eff: ReturnType<typeof effectiveInterface>,
  ): Array<{ name: string; abs: Abs; optional?: boolean }> =>
    eff
      ? eff.params.map((p) => ({
          name: p.param,
          abs: constraintToEntryAbs(p.constraint, p.param),
          optional: p.constraint.isOptional === true,
        }))
      : [];

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
    const paramExps: Array<{ name: string; abs: Abs; optional?: boolean }> = [];
    let outputAbs: Abs | undefined;
    if (eff) {
      for (const p of eff.params) {
        paramExps.push({
          name: p.param,
          abs: constraintToEntryAbs(p.constraint, p.param),
          // 契约级顶层形参可选性（Bug 536）：entry Abs 丢了 isOptional，
          // 只能由契约面显式带过来
          optional: p.constraint.isOptional === true,
        });
      }
      if (eff.returns) {
        outputAbs = constraintToEntryAbs(eff.returns.constraint, "return");
      }
    }
    if (paramExps.length === 0) {
      // 无显式参数契约：对**域证据** case 的同槽 argAbs 做 join（合成证据
      // call@/entry@ + 带断言的声明 case）。无断言的 case 指令是见证、不是域
      // 声明 ⇒ 不参与（Bug 511：freeze 写回的单点见证会把入参面收窄成该点的
      // 字面量）。
      const domainCases = domainEvidenceCases(caseResults);
      const arity = Math.max(0, ...domainCases.map((c) => c.argAbs.length));
      for (let i = 0; i < arity; i++) {
        const parts = domainCases.map((c) => c.argAbs[i]).filter((a): a is Abs => !!a);
        if (parts.length === 0) continue;
        const joined = parts.reduce((a, b) => joinAbs(a, b));
        paramExps.push({ name: fn.paramNames[i] ?? `arg${i}`, abs: joined });
      }
    }
    if (!outputAbs) {
      // 兜底只吃**带断言**的 case（`=> expected`）：无断言 case 是见证，不是
      // 域声明——拿它当返回面会把产物收窄成单个调用点的字面量（Bug 511）。
      const asserted = caseResults.filter((c) => c.expected !== undefined);
      outputAbs = fn.combinedAbs ?? asserted[0]?.abs;
    }

    if (wantsSchema(format)) {
      // 一个可 import 的 zod 模块：`<fn>Input`（参数对象）+ `<fn>Output`
      const inputSlots: Record<string, { value: Abs; optional?: boolean }> = {};
      for (const p of paramExps) {
        // 契约级顶层形参可选性（Bug 536）：可选位在 zod 面是 `.optional()`，
        // 缺省即必填（契约是用户申报的调用域，权威）
        inputSlots[p.name] = {
          value: p.abs,
          ...(p.optional === true ? { optional: true } : {}),
        };
      }
      schemaExports[`${baseName}Input`] = obj(inputSlots);
      if (outputAbs) {
        schemaExports[`${baseName}Output`] = outputAbs;
      }
    }

    if (wantsStandard(format)) {
      // 入参面口径与 zod 面对齐（Bug 539）：`<fn>Input` 校验**整个入参对象**；
      // 整参另出 `<fn>_<param>`；**解构形参的字段不提升为顶层整参校验器**
      // （字段级校验器与整参校验器同名同形、语义却不同，消费方必然误用）。
      const stdInputs = paramExps.map((p) => ({ name: p.name, abs: p.abs }));
      const stdReturns = eff?.returns
        ? constraintToEntryAbs(eff.returns.constraint, "return")
        : undefined;
      if (stdInputs.length > 0 || stdReturns !== undefined || outputAbs !== undefined) {
        const mod = absToStandardSchemaFunction({
          fn: baseName,
          inputs: stdInputs,
          formals: fn.formals,
          returns: stdReturns,
          output: outputAbs,
        });
        standardChunks.push(`\n// === ${baseName} Standard Schema ===\n${mod.source}`);
        for (const note of mod.dropped) {
          droppedNotes.push(`${baseName} ${note}`);
        }
      }
    }

    if (format === "guard" || format === "all") {
      const lines: string[] = [`\n// === ${baseName} Type Guards ===`];
      // 兜底只吃**带断言**的 case（同上：无断言 case 是见证，不是域声明 ——
      // Bug 511：guard 面收窄成 data === 3 会把合法调用判非法）
      const assertedCases = caseResults.filter((c) => c.expected !== undefined);
      const absForGuard = fn.combinedAbs ?? assertedCases[0]?.abs;
      if (absForGuard) {
        lines.push(generateGuardFunctionFromAbs(`is${baseName}Output`, absForGuard));
      }
      guardChunks.push(lines.join("\n"));
    }

    if (format === "dts" || format === "all") {
      // 只发射导出面：非 export 的顶层函数是模块内部实现，不进 .d.ts
      if (onExportFace(fn.name)) {
        // 契约面优先：手写契约参数/返回投影；无返回契约但有参数契约时用
        // 契约种子求值折返回（与 check 的 refine 种子同向：
        // u: { name: string } ⇒ u.name: string）
        const contractParams = contractParamsOf(eff);
        let contractReturn: Abs | undefined = eff?.returns
          ? constraintToEntryAbs(eff.returns.constraint, "return")
          : undefined;
        if (contractReturn === undefined && contractParams.length > 0) {
          const byName = new Map(contractParams.map((p) => [p.name, p.abs]));
          const seedArgs = fn.paramNames.map(
            (n) =>
              byName.get(n.startsWith("...") ? n.slice(3) : n) ??
              makeAbs({ k: "any" }, undefined, undefined, "path"),
          );
          // fail-closed：求值失败/不可求值 → undefined，返回位落 case 观察
          contractReturn =
            tryEvalCall(source, filePath, fn.name, seedArgs, evalMocks ? { mocks: evalMocks } : {}) ??
            undefined;
        }
        const contractFace: DtsContractFace | undefined =
          contractParams.length > 0 || contractReturn !== undefined
            ? {
                params: contractParams,
                ...(contractReturn !== undefined ? { return: contractReturn } : {}),
              }
            : undefined;
        const dts = projectFunctionDts(fn, contractFace, dtsSurface);
        // 函数声明行由**模块面**统一合成（类声明一次一类、再导出面）⇒ 这里
        // 只收集，不单独 push（否则同一条声明出两遍）。
        dtsEntries.push({
          fn,
          projection: dts,
          ...(contractFace !== undefined ? { contract: contractFace } : {}),
        });
        for (const p of dts.params) {
          if (p.type === "unknown") unevidencedParams.push(`${baseName}.${p.name}`);
        }
      }
    }
  }

  // 模块面合成：类声明（一次一类）+ 再导出面 + brand 类声明
  if (format === "dts" || format === "all") {
    const mod = projectModuleDts(dtsSurface, dtsEntries);
    if (mod.lines.length > 0) dtsChunks.push(mod.lines.join("\n"));
  }

  const stem = basename(filePath).replace(/\.[cm]?[jt]s$/, "");
  const schemaModule =
    Object.keys(schemaExports).length > 0
      ? absToZodSchemaModule(schemaExports)
      : undefined;

  // 无证据参数的 stderr 提示（docs/design/cli-semantics.md §2 的 unknown
  // 例外面）：指向三条补证据路径，stdout 投影面保持可钉住
  if ((format === "dts" || format === "all") && unevidencedParams.length > 0) {
    console.error(
      `note: ${unevidencedParams.join(", ")} rendered as unknown (no contract/case evidence) — add a sidecar contract (*.nudo.js), @nudo:contract, or @nudo:case / call-site evidence`,
    );
  }

  // dts 是模块面投影：函数存在但无导出声明面时如实说明（非错误，exit 0）
  if (format === "dts" && functions.length > 0 && dtsChunks.length === 0) {
    console.log(
      "No exported declarations found — dts projects the module surface (export / export default / CJS exports).",
    );
    return;
  }

  if (output) {
    // BUG-023：--out IO 失败转 nudo:path-io 面（路径相对
    // cwd 展示，errno 原文不进 CI 日志），与 check/test 的
    // 路径错误面同构（message + fix: 提示 + exit 1）。
    const outDir = resolve(output);
    const ioError = (op: string): PathError => ({
      path: outDir,
      code: DIAG.pathIo,
      message: `export --out ${op} failed: ${displayPathOf(outDir)}`,
      suggestion: `check --out <dir> is writable and the path is a directory, then re-run nudo export`,
    });
    try {
      mkdirSync(outDir, { recursive: true });
    } catch {
      reportPathErrors([ioError("mkdir")]);
      return;
    }
    const written: string[] = [];
    try {
      if (schemaModule) {
        const p = join(outDir, schemaFileName(stem, effectiveDialect));
        writeFileSync(p, schemaModule.source, "utf-8");
        written.push(p);
      }
      if (standardChunks.length > 0) {
        // 每函数一份模块（各自内联 __nudoCheck，避免合并文件时 helper 重复定义）
        for (const chunk of standardChunks) {
          const m = chunk.match(/\/\/ === (\S+) Standard Schema ===/);
          const fnStem = m?.[1] ?? stem;
          const p = join(outDir, `${fnStem}.nudo.standard.ts`);
          const header = `// @generated by nudo export --format standard — Standard Schema v1 (vendor: nudo)\n`;
          const body = chunk.startsWith("\n") ? chunk.slice(1) : chunk;
          writeFileSync(p, body.includes("@generated") ? body + "\n" : header + body + "\n", "utf-8");
          written.push(p);
        }
      }
      if (guardChunks.length > 0) {
        const p = join(outDir, `${stem}.nudo.guard.ts`);
        writeFileSync(p, guardChunks.join("\n") + "\n", "utf-8");
        written.push(p);
      }
      if (dtsChunks.length > 0) {
        const p = join(outDir, `${stem}.d.ts`);
        writeFileSync(p, dtsChunks.join("\n") + "\n", "utf-8");
        written.push(p);
      }
    } catch {
      reportPathErrors([ioError("write")]);
      return;
    }
    for (const p of written) {
      console.log(`wrote ${relative(process.cwd(), p)}`);
    }
    return;
  }

  const chunks: string[] = [];
  if (schemaModule) chunks.push(schemaModule.source);
  chunks.push(...standardChunks, ...guardChunks, ...dtsChunks);
  for (const chunk of chunks) {
    console.log(chunk);
  }
  if (droppedNotes.length > 0) {
    console.log(`\n// dropped preds (not projected into ${effectiveDialect}):`);
    for (const n of droppedNotes) console.log(`//   ${n}`);
  }
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
