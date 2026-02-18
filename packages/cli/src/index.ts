import { readFileSync, existsSync, watch, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative, extname, join } from "node:path";
import { Command } from "commander";
import {
  T,
  typeValueToString,
  simplifyUnion,
  createEnvironment,
  isSubtypeOf,
} from "@justscript/core";
import type { TypeValue } from "@justscript/core";
import { parse, extractDirectives, parseTypeValueExpr } from "@justscript/parser";
import { evaluateFunction, evaluateFunctionFull, evaluateProgram, setModuleResolver, setCurrentFileDir, resetMemo } from "./evaluator.ts";

const program = new Command();

program
  .name("justscript")
  .description("JustScript type inference engine")
  .version("0.0.1");

function applyMocks(
  directives: ReturnType<typeof extractDirectives>[number]["directives"],
  env: ReturnType<typeof createEnvironment>,
  filePath: string,
): void {
  for (const d of directives) {
    if (d.kind !== "mock") continue;
    if (d.expression) {
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

function resolveModule(source: string, fromDir: string): { ast: ReturnType<typeof parse>; filePath: string } | null {
  const extensions = [".js", ".just.js", ".ts", ".mjs"];
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
  const ast = parse(source);
  const functions = extractDirectives(ast);

  if (functions.length === 0) {
    console.log("No functions with @just:case directives found.");
    return;
  }

  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  const dtsLines: string[] = [];

  for (const fn of functions) {
    const loc = fn.node.loc;
    const locStr = loc ? `${relative(process.cwd(), filePath)}:${loc.start.line}:${loc.start.column}` : relative(process.cwd(), filePath);
    const header = options.showLoc ? `=== ${fn.name} (${locStr}) ===` : `=== ${fn.name} ===`;
    console.log(`${header}\n`);

    applyMocks(fn.directives, globalEnv, filePath);

    const isPure = fn.directives.some((d) => d.kind === "pure");
    const skipDirective = fn.directives.find((d) => d.kind === "skip");
    const returnsDirective = fn.directives.find((d) => d.kind === "returns");

    if (skipDirective && skipDirective.kind === "skip") {
      if (skipDirective.returns) {
        console.log(`Skipped (declared): ${typeValueToString(skipDirective.returns)}`);
        if (options.dts) {
          dtsLines.push(`export declare function ${fn.name}(...args: unknown[]): ${typeValueToTSType(skipDirective.returns)};`);
        }
      } else {
        console.log("Skipped (no return type declared)");
      }
      console.log();
      continue;
    }

    if (isPure) {
      const fnVal = globalEnv.has(fn.name) ? globalEnv.lookup(fn.name) : null;
      if (fnVal && fnVal.kind === "function") {
        (fnVal as any)._memoize = fn.name;
      }
    }

    const caseDirectives = fn.directives.filter((d) => d.kind === "case");
    const caseResults: { name: string; args: TypeValue[]; argsStr: string; result: string; resultTV: TypeValue; throws?: string }[] = [];

    for (const directive of caseDirectives) {
      const fullResult = evaluateFunctionFull(fn.node, directive.args, globalEnv);
      const argsStr = directive.args.map(typeValueToString).join(", ");
      const resultStr = typeValueToString(fullResult.value);
      const throwsStr = fullResult.throws.kind !== "never" ? typeValueToString(fullResult.throws) : undefined;
      caseResults.push({
        name: directive.name,
        args: directive.args,
        argsStr,
        result: resultStr,
        resultTV: fullResult.value,
        throws: throwsStr,
      });
      let line = `Case "${directive.name}": (${argsStr}) => ${resultStr}`;
      if (throwsStr) line += ` throws ${throwsStr}`;
      console.log(line);
    }

    if (caseResults.length > 1) {
      const allResults = caseDirectives.map((d) =>
        evaluateFunctionFull(fn.node, d.args, globalEnv),
      );
      const combined = simplifyUnion(allResults.map((r) => r.value));
      console.log(`\nCombined: ${typeValueToString(combined)}`);
    }

    if (returnsDirective && returnsDirective.kind === "returns") {
      for (const directive of caseDirectives) {
        const result = evaluateFunction(fn.node, directive.args, globalEnv);
        const matches = isSubtypeOf(result, returnsDirective.expected);
        if (!matches) {
          console.log(`\n⚠ @just:returns assertion failed for case "${directive.name}": expected ${typeValueToString(returnsDirective.expected)}, got ${typeValueToString(result)}`);
        }
      }
    }

    if (options.dts) {
      if (caseResults.length === 1) {
        const c = caseResults[0];
        const params = c.args.map((a, i) => `arg${i}: ${typeValueToTSType(a)}`).join(", ");
        dtsLines.push(`export declare function ${fn.name}(${params}): ${typeValueToTSType(c.resultTV)};`);
      } else {
        for (const c of caseResults) {
          const params = c.args.map((a, i) => `arg${i}: ${typeValueToTSType(a)}`).join(", ");
          dtsLines.push(`export declare function ${fn.name}(${params}): ${typeValueToTSType(c.resultTV)};`);
        }
      }
    }

    console.log();
  }

  if (options.dts && dtsLines.length > 0) {
    const dtsPath = filePath.replace(/\.(just\.)?js$/, ".d.ts");
    const dtsContent = dtsLines.join("\n") + "\n";
    writeFileSync(dtsPath, dtsContent, "utf-8");
    console.log(`Generated: ${relative(process.cwd(), dtsPath)}`);
  }

  setModuleResolver(null);
}

program
  .command("infer")
  .description("Infer types from a .just.js file")
  .argument("<file>", "Path to the .just.js file")
  .option("--dts", "Generate .d.ts file")
  .option("--loc", "Show source locations in output")
  .action((file: string, opts: { dts?: boolean; loc?: boolean }) => {
    runInfer(file, { dts: opts.dts, showLoc: opts.loc });
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
      return collectJustFiles(resolved);
    };

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
      console.log(`[${new Date().toLocaleTimeString()}] Watching for changes...`);
    };

    runAll();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watchTarget = isDir ? resolved : dirname(resolved);

    watch(watchTarget, { recursive: isDir }, (_event, filename) => {
      if (!filename) return;
      const fullPath = isDir ? join(watchTarget, filename) : resolved;
      if (!fullPath.endsWith(".just.js") && !fullPath.endsWith(".js")) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runAll, 200);
    });
  });

function collectJustFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      results.push(...collectJustFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".just.js")) {
      results.push(fullPath);
    }
  }
  return results;
}

program.parse();
