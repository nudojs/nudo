/**
 * nudo export — 投影：dts | guard | schema (dialect) | standard | all。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, join, basename } from "node:path";
import type { Command } from "commander";
import {
  effectiveInterface,
  constraintToEntryAbs,
  joinAbs,
  type Abs,
} from "@nudojs/core";
import {
  projectAbsToSchema,
  absToStandardSchemaModule,
  defaultLoadModule,
  type SchemaDialect,
  generateGuardFunctionFromAbs,
  generateFunctionDtsLines,
  analyzeFileAsync,
  type CaseResult,
} from "@nudojs/service";

// ---------------------------------------------------------------------------
// export — 投影：dts | guard | schema (dialect) | standard | all
// ---------------------------------------------------------------------------

type ExportFormat = "schema" | "standard" | "guard" | "dts" | "all";
const EXPORT_FORMATS: ExportFormat[] = ["schema", "standard", "guard", "dts", "all"];
const SCHEMA_DIALECTS: SchemaDialect[] = ["zod"];

function normalizeExportFormat(raw: string): ExportFormat | undefined {
  return EXPORT_FORMATS.includes(raw as ExportFormat) ? (raw as ExportFormat) : undefined;
}

function normalizeDialect(raw: string | undefined): SchemaDialect | undefined {
  if (raw === undefined) return undefined;
  return SCHEMA_DIALECTS.includes(raw as SchemaDialect) ? (raw as SchemaDialect) : undefined;
}

function wantsSchema(format: ExportFormat): boolean {
  return format === "schema" || format === "all";
}

function wantsStandard(format: ExportFormat): boolean {
  return format === "standard" || format === "all";
}

function schemaDialectOf(_format: ExportFormat, dialect: SchemaDialect | undefined): SchemaDialect {
  return dialect ?? "zod";
}

function schemaFileName(stem: string, dialect: SchemaDialect): string {
  return `${stem}.nudo.schema.${dialect}.ts`;
}

async function runExport(
  file: string,
  format: ExportFormat,
  output?: string,
  dialect?: SchemaDialect,
): Promise<void> {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  const result = await analyzeFileAsync(filePath, source, undefined, undefined, undefined, "none");
  const functions = result.functions.filter((f) => f.cases.length > 0);

  if (functions.length === 0) {
    console.log("No analyzed functions found.");
    return;
  }

  const effectiveDialect = schemaDialectOf(format, dialect);
  const schemaChunks: string[] = [];
  const standardChunks: string[] = [];
  const guardChunks: string[] = [];
  const dtsChunks: string[] = [];
  const droppedNotes: string[] = [];

  for (const fn of functions) {
    const caseResults: CaseResult[] = fn.cases;
    const baseName = fn.name;

    if (wantsSchema(format)) {
      const lines: string[] = [
        `\n// === ${baseName} Schema (${effectiveDialect}) ===`,
      ];
      for (const c of caseResults) {
        const inputParts: string[] = [];
        const outputProj = projectAbsToSchema(c.abs, { dialect: effectiveDialect });
        for (const [i, a] of c.argAbs.entries()) {
          const p = projectAbsToSchema(a, { dialect: effectiveDialect });
          inputParts.push(`arg${i}: ${p.source}`);
          for (const note of p.dropped) {
            droppedNotes.push(`${baseName} arg${i}: ${note}`);
          }
        }
        for (const note of outputProj.dropped) {
          droppedNotes.push(`${baseName} output: ${note}`);
        }
        const label = c.name.startsWith("call@") || c.name.startsWith("entry@")
          ? c.name
          : `debug "${c.name}"`;
        lines.push(`// ${label}:`);
        lines.push(`// Input: { ${inputParts.join(", ")} }`);
        lines.push(`// Output: ${outputProj.source}`);
      }
      schemaChunks.push(lines.join("\n"));
    }

    if (wantsStandard(format)) {
      // 运行时校验器应尽量反映**契约域**，而不是单次调用点字面量。
      const eff = effectiveInterface(source, baseName, {
        loadModule: defaultLoadModule,
        fromFile: filePath,
      });
      const exports: Record<string, Abs> = {};
      if (eff) {
        for (const p of eff.params) {
          exports[`${baseName}_${p.param}`] = constraintToEntryAbs(p.constraint, p.param);
        }
        if (eff.returns) {
          exports[`${baseName}Return`] = constraintToEntryAbs(eff.returns.constraint, "return");
        }
      }
      if (Object.keys(exports).length === 0) {
        // 无显式契约：输出用 combinedAbs；参数位对各 case 同槽 argAbs 做 join
        const outAbs = fn.combinedAbs ?? caseResults[0]?.abs;
        if (outAbs) exports[`${baseName}Output`] = outAbs;
        const arity = Math.max(0, ...caseResults.map((c) => c.argAbs.length));
        for (let i = 0; i < arity; i++) {
          const parts = caseResults.map((c) => c.argAbs[i]).filter((a): a is Abs => !!a);
          if (parts.length === 0) continue;
          const joined = parts.reduce((a, b) => joinAbs(a, b));
          const name = fn.paramNames[i] ?? `arg${i}`;
          exports[`${baseName}_${name}`] = joined;
        }
      } else if (!exports[`${baseName}Return`]) {
        // 仅有参数契约、无返回契约时，用观察 combined 作 Output
        const outAbs = fn.combinedAbs ?? caseResults[0]?.abs;
        if (outAbs) exports[`${baseName}Output`] = outAbs;
      }
      if (Object.keys(exports).length > 0) {
        const mod = absToStandardSchemaModule(exports);
        standardChunks.push(`\n// === ${baseName} Standard Schema ===\n${mod.source}`);
        for (const note of mod.dropped) {
          droppedNotes.push(`${baseName} ${note}`);
        }
      }
    }

    if (format === "guard" || format === "all") {
      const lines: string[] = [`\n// === ${baseName} Type Guards ===`];
      const absForGuard = fn.combinedAbs ?? caseResults[0]?.abs;
      if (absForGuard) {
        lines.push(generateGuardFunctionFromAbs(`is${baseName}Output`, absForGuard));
      }
      guardChunks.push(lines.join("\n"));
    }

    if (format === "dts" || format === "all") {
      dtsChunks.push(generateFunctionDtsLines(fn).join("\n"));
    }
  }

  const stem = basename(filePath).replace(/\.[cm]?[jt]s$/, "");
  if (output) {
    const outDir = resolve(output);
    mkdirSync(outDir, { recursive: true });
    const written: string[] = [];
    if (schemaChunks.length > 0) {
      const p = join(outDir, schemaFileName(stem, effectiveDialect));
      let body = schemaChunks.join("\n") + "\n";
      if (droppedNotes.length > 0 && !wantsStandard(format)) {
        body += `\n// dropped preds (not projected into ${effectiveDialect}):\n`;
        body += droppedNotes.map((n) => `//   ${n}`).join("\n") + "\n";
      }
      writeFileSync(p, body, "utf-8");
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
    for (const p of written) {
      console.log(`wrote ${relative(process.cwd(), p)}`);
    }
    return;
  }

  for (const chunk of [...schemaChunks, ...standardChunks, ...guardChunks, ...dtsChunks]) {
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
        await runExport(file, format, options.out, dialect);
      },
    );
}
