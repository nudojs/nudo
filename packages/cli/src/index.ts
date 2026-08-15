import { readFileSync, existsSync, watch, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { Command } from "commander";
import {
  T,
  typeValueToString,
  createEnvironment,
  isTemplate,
  getTemplateParts,
  mockHelperToTypeValue,
} from "@nudojs/core";
import type { TypeValue } from "@nudojs/core";
import { parse, extractDirectives, parseTypeValueExpr } from "@nudojs/parser";
import { evaluateFunctionFull, evaluateProgram, setModuleResolver, setCurrentFileDir, resetMemo } from "./evaluator.ts";
import {
  typeValueToZodSchema,
  generateGuardFunction,
  analyzeFile,
  buildModuleGraph,
  computeDirtySet,
  topoSortDirty,
} from "@nudojs/service";
import { resolveNpmNudo } from "./resolve-npm.ts";

const program = new Command();

program
  .name("nudo")
  .description("Nudo type inference engine")
  .version("0.0.1");

function applyMocks(
  directives: ReturnType<typeof extractDirectives>[number]["directives"],
  env: ReturnType<typeof createEnvironment>,
  filePath: string,
): void {
  for (const d of directives) {
    if (d.kind !== "mock") continue;
    if (d.arrowFn) {
      // Create a function TypeValue from the parsed arrow function
      const fnType = T.fn(d.arrowFn.params, d.arrowFn.body, env);
      (fnType as any)._paramPatterns = d.arrowFn.paramPatterns;
      env.bind(d.name, fnType);
    } else if (d.nudoMock) {
      // Handle Nudo mock helpers (stub, spy, mock)
      const typeVal = mockHelperToTypeValue(d.nudoMock, env);
      env.bind(d.name, typeVal);
    } else if (d.sinonExpr) {
      // Handle sinon expressions
      const sinonType = createSinonTypeValue(d.sinonExpr);
      env.bind(d.name, sinonType);
    } else if (d.expression) {
      env.bind(d.name, parseTypeValueExpr(d.expression));
    } else if (d.fromPath) {
      const mockPath = resolve(dirname(filePath), d.fromPath);
      const mockSource = readFileSync(mockPath, "utf-8");
      const mockAst = parse(mockSource);
      const mockEnv = createEnvironment();
      evaluateProgram(mockAst, mockEnv);
      const mockVal = mockEnv.lookup(d.name);
      env.bind(d.name, mockVal);
    }
  }
}

function createSinonTypeValue(sinonExpr: { type: string; returnValue?: TypeValue; resolvedValue?: TypeValue; rejectedValue?: TypeValue }): TypeValue {
  const body = { type: "BlockStatement", body: [] } as any;
  const fn = T.fn(["...args"], body, createEnvironment());

  if (sinonExpr.returnValue) {
    (fn as any)._directReturn = sinonExpr.returnValue;
  } else if (sinonExpr.resolvedValue) {
    (fn as any)._directReturn = T.promise(sinonExpr.resolvedValue);
  } else if (sinonExpr.rejectedValue) {
    (fn as any)._directReturn = T.never;
  } else {
    (fn as any)._directReturn = T.unknown;
  }

  return fn;
}

function resolveModule(source: string, fromDir: string): { ast: ReturnType<typeof parse>; filePath: string } | null {
  const extensions = [".js", ".ts", ".mjs"];

  const nudoPath = resolveNpmNudo(source, fromDir);
  if (nudoPath) {
    const src = readFileSync(nudoPath, "utf-8");
    return { ast: parse(src), filePath: nudoPath };
  }

  const basePath = resolve(fromDir, source);

  for (const ext of ["", ...extensions]) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) {
      const src = readFileSync(candidate, "utf-8");
      return { ast: parse(src), filePath: candidate };
    }
  }
  return null;
}

function typeValueToTSType(tv: TypeValue): string {
  switch (tv.kind) {
    case "literal": {
      const v = tv.value;
      if (v === null) return "null";
      if (v === undefined) return "undefined";
      if (typeof v === "string") return JSON.stringify(v);
      return String(v);
    }
    case "primitive":
      return tv.type;
    case "refined": {
      if (isTemplate(tv)) {
        const parts = getTemplateParts(tv)!;
        const inner = parts
          .map((p) => (p.kind === "literal" && typeof p.value === "string" ? p.value : `\${${typeValueToTSType(p)}}`))
          .join("");
        return `\`${inner}\``;
      }
      return typeValueToTSType(tv.base);
    }
    case "object": {
      const entries = Object.entries(tv.properties);
      if (entries.length === 0) return "{}";
      const inner = entries.map(([k, v]) => `${k}: ${typeValueToTSType(v)}`).join("; ");
      return `{ ${inner} }`;
    }
    case "array": {
      const el = typeValueToTSType(tv.element);
      return tv.element.kind === "union" ? `(${el})[]` : `${el}[]`;
    }
    case "tuple":
      return `[${tv.elements.map(typeValueToTSType).join(", ")}]`;
    case "function":
      return `(${tv.params.map((p) => `${p}: unknown`).join(", ")}) => unknown`;
    case "promise":
      return `Promise<${typeValueToTSType(tv.value)}>`;
    case "instance":
      return tv.className;
    case "union":
      return tv.members.map(typeValueToTSType).join(" | ");
    case "never":
      return "never";
    case "unknown":
      return "unknown";
  }
}

function runInfer(file: string, options: { dts?: boolean; showLoc?: boolean } = {}): void {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  const result = analyzeFile(filePath, source);

  if (result.functions.length === 0) {
    console.log("No functions with @nudo:case directives found.");
    return;
  }

  const dtsLines: string[] = [];

  for (const fn of result.functions) {
    const loc = fn.loc;
    const locStr = `${relative(process.cwd(), filePath)}:${loc.start.line}:${loc.start.column}`;
    const header = options.showLoc ? `=== ${fn.name} (${locStr}) ===` : `=== ${fn.name} ===`;
    console.log(`${header}\n`);

    if (fn.skipped) {
      if (fn.combined) {
        console.log(`Skipped (declared): ${typeValueToString(fn.combined)}`);
        if (options.dts) {
          dtsLines.push(`export declare function ${fn.name}(...args: unknown[]): ${typeValueToTSType(fn.combined)};`);
        }
      } else {
        console.log("Skipped (no return type declared)");
      }
      console.log();
      continue;
    }

    for (const c of fn.cases) {
      const argsStr = c.args.map(typeValueToString).join(", ");
      let line = `Case "${c.name}": (${argsStr}) => ${typeValueToString(c.result)}`;
      if (c.throws.kind !== "never") line += ` throws ${typeValueToString(c.throws)}`;
      console.log(line);
    }

    if (fn.entryOnly) {
      console.log("# no call sites found; parameters default to unknown");
    }

    if (fn.cases.length > 1 && fn.combined) {
      console.log(`\nCombined: ${typeValueToString(fn.combined)}`);
    }

    if (fn.assertionErrors && fn.assertionErrors.length > 0) {
      for (const err of fn.assertionErrors) {
        console.log(`\n⚠ ${err}`);
      }
    }

    if (options.dts) {
      for (const c of fn.cases) {
        const params = c.args.map((a, i) => `arg${i}: ${typeValueToTSType(a)}`).join(", ");
        dtsLines.push(`export declare function ${fn.name}(${params}): ${typeValueToTSType(c.result)};`);
      }
    }

    console.log();
  }

  if (options.dts && dtsLines.length > 0) {
    const dtsPath = filePath.replace(/\.js$/, ".d.ts");
    const dtsContent = dtsLines.join("\n") + "\n";
    writeFileSync(dtsPath, dtsContent, "utf-8");
    console.log(`Generated: ${relative(process.cwd(), dtsPath)}`);
  }

  if (result.diagnostics.length > 0) {
    console.log("Diagnostics:\n");
    for (const d of result.diagnostics) {
      const loc = `${relative(process.cwd(), filePath)}:${d.range.start.line}:${d.range.start.column}`;
      console.log(`  [${d.severity}] ${loc} ${d.message}${d.code ? ` (${d.code})` : ""}`);
      if (d.origin) {
        console.log(`    → value originates at ${d.origin.line}:${d.origin.column}`);
      }
    }
    console.log();
  }
}

function runInferJson(file: string): void {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  const result = analyzeFile(filePath, source);

  const jsonOutput = {
    functions: result.functions.map((f) => ({
      name: f.name,
      loc: f.loc,
      cases: f.cases.map((c) => ({
        name: c.name,
        args: c.args.map(typeValueToString),
        result: typeValueToString(c.result),
        throws: c.throws.kind !== "never" ? typeValueToString(c.throws) : null,
        source: c.source ?? null,
      })),
      entryOnly: f.entryOnly ?? false,
      assertionErrors: f.assertionErrors,
    })),
    diagnostics: result.diagnostics.map((d) => ({
      range: d.range,
      severity: d.severity,
      message: d.message,
      code: d.code,
      suggestions: d.suggestions,
      tags: d.tags,
      origin: d.origin,
    })),
  };

  console.log(JSON.stringify(jsonOutput, null, 2));
}

program
  .command("infer")
  .description("Infer types from a JS file — functions with @nudo:case directives use them; all other functions are inferred from call sites (whole-program analysis)")
  .argument("<file>", "Path to the JS file")
  .option("--dts", "Generate .d.ts file")
  .option("--loc", "Show source locations in output")
  .option("--json", "Output as JSON")
  .action((file: string, opts: { dts?: boolean; loc?: boolean; json?: boolean }) => {
    if (opts.json) {
      runInferJson(file);
    } else {
      runInfer(file, { dts: opts.dts, showLoc: opts.loc });
    }
  });

function runCheck(file: string): void {
  const filePath = resolve(file);
  const source = readFileSync(filePath, "utf-8");
  const result = analyzeFile(filePath, source);

  if (result.diagnostics.length === 0) {
    console.log("No issues found.");
    return;
  }

  for (const d of result.diagnostics) {
    const loc = `${relative(process.cwd(), filePath)}:${d.range.start.line}:${d.range.start.column}`;
    console.log(`[${d.severity}] ${loc} ${d.message}${d.code ? ` (${d.code})` : ""}`);
    if (d.origin) {
      console.log(`    → value originates at ${d.origin.line}:${d.origin.column}`);
    }
  }

  if (result.diagnostics.some((d) => d.severity === "error")) {
    process.exitCode = 1;
  }
}

program
  .command("check")
  .description("Check a JS file for type errors — exits with code 1 when errors are found")
  .argument("<file>", "Path to the JS file")
  .action((file: string) => {
    runCheck(file);
  });

program
  .command("watch")
  .description("Watch file(s) for changes and re-run inference")
  .argument("<path>", "File or directory to watch")
  .option("--dts", "Generate .d.ts files on each change")
  .action((watchPath: string, opts: { dts?: boolean }) => {
    const resolved = resolve(watchPath);
    const isDir = existsSync(resolved) && statSync(resolved).isDirectory();

    const getFiles = (): string[] => {
      if (!isDir) return [resolved];
      return collectNudoFiles(resolved);
    };

    let graph = buildModuleGraph(getFiles());

    const runAll = () => {
      console.clear();
      console.log(`[${new Date().toLocaleTimeString()}] Analyzing...\n`);
      for (const f of getFiles()) {
        try {
          runInfer(f, { dts: opts.dts, showLoc: true });
        } catch (err) {
          console.error(`Error analyzing ${relative(process.cwd(), f)}:`, (err as Error).message);
        }
      }
      graph = buildModuleGraph(getFiles());
      console.log(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
    };

    const runIncremental = (changedFiles: string[]) => {
      const files = getFiles();
      const tracked = new Set(files);

      // 合并多文件变更的脏集（union）：每个变更文件的脏集 = 自身 + 传递依赖方
      const dirtyUnion = new Set<string>();
      for (const cf of changedFiles) {
        for (const d of computeDirtySet(graph.dependents, cf)) dirtyUnion.add(d);
      }
      const dirty = [...dirtyUnion].filter((f) => tracked.has(f));
      if (dirty.length === 0) return;

      // 依赖先析：moduleCache 中未重析依赖的类型可被复用
      const ordered = topoSortDirty(graph.imports, dirty);

      console.clear();
      console.log(`[${new Date().toLocaleTimeString()}] Analyzing (incremental)...\n`);
      const t0 = performance.now();
      // 缓存失效：callMemo 按名键陈旧 + moduleCache 嵌入旧类型
      resetMemo();
      for (const f of ordered) {
        try {
          runInfer(f, { dts: opts.dts, showLoc: true });
        } catch (err) {
          console.error(`Error analyzing ${relative(process.cwd(), f)}:`, (err as Error).message);
        }
      }
      const elapsed = Math.round(performance.now() - t0);
      console.log(`Incremental: re-analyzed ${ordered.length}, skipped ${files.length - ordered.length} (${elapsed}ms)`);
      console.log(`[${new Date().toLocaleTimeString()}] Watching for changes...`);

      // 重建全图：文件数少时开销可忽略，选简单路线
      graph = buildModuleGraph(getFiles());
    };

    runAll();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watchTarget = isDir ? resolved : dirname(resolved);

    const pendingChanged = new Set<string>();

    watch(watchTarget, { recursive: isDir }, (_event, filename) => {
      if (!filename) return;
      const fullPath = isDir ? join(watchTarget, filename) : resolved;
      if (!fullPath.endsWith(".js")) return;
      if (!existsSync(fullPath)) return; // deleted

      pendingChanged.add(fullPath);

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const changedFiles = [...pendingChanged];
        pendingChanged.clear();
        runIncremental(changedFiles);
      }, 200);
    });
  });

function collectNudoFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectNudoFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      // 全程序推断：无指令的纯 JS 文件也能推导类型，无需 @nudo: 过滤
      results.push(fullPath);
    }
  }
  return results;
}

program
  .command("generate")
  .description("Generate runtime validators from inferred types")
  .argument("<file>", "JavaScript file to analyze")
  .option("--format <format>", "Output format: zod, guard, dts, all", "all")
  .option("--output <dir>", "Output directory", ".")
  .action((file: string, options: { format: string; output: string }) => {
    const filePath = resolve(file);
    const source = readFileSync(filePath, "utf-8");
    const ast = parse(source);
    const functions = extractDirectives(ast);

    if (functions.length === 0) {
      console.log("No functions with @nudo:case directives found.");
      return;
    }

    resetMemo();
    setModuleResolver(resolveModule);
    setCurrentFileDir(dirname(filePath));

    const globalEnv = createEnvironment();
    evaluateProgram(ast, globalEnv);

    for (const fn of functions) {
      applyMocks(fn.directives, globalEnv, filePath);

      const caseDirectives = fn.directives.filter((d) => d.kind === "case");
      if (caseDirectives.length === 0) continue;

      const caseResults = caseDirectives.map((directive) => {
        const fullResult = evaluateFunctionFull(fn.node, directive.args, globalEnv);
        return {
          name: directive.name,
          args: directive.args,
          result: fullResult.value,
        };
      });

      const baseName = fn.name;

      if (options.format === "zod" || options.format === "all") {
        console.log(`\n// === ${baseName} Zod Schemas ===`);
        for (const c of caseResults) {
          const inputSchemas = c.args.map((a, i) => `arg${i}: ${typeValueToZodSchema(a)}`).join(", ");
          const outputSchema = typeValueToZodSchema(c.result);
          console.log(`// Case "${c.name}":`);
          console.log(`// Input: { ${inputSchemas} }`);
          console.log(`// Output: ${outputSchema}`);
        }
      }

      if (options.format === "guard" || options.format === "all") {
        console.log(`\n// === ${baseName} Type Guards ===`);
        for (const c of caseResults) {
          const guard = generateGuardFunction(`is${baseName}${c.name.charAt(0).toUpperCase() + c.name.slice(1)}Output`, c.result);
          console.log(guard);
        }
      }

      if (options.format === "dts" || options.format === "all") {
        console.log(`\n// === ${baseName} TypeScript Declarations ===`);
        for (const c of caseResults) {
          const params = c.args.map((a, i) => `arg${i}: ${typeValueToTSType(a)}`).join(", ");
          const ret = typeValueToTSType(c.result);
          console.log(`export declare function ${baseName}(${params}): ${ret};`);
        }
      }
    }

    setModuleResolver(null);
  });

program.parse();
