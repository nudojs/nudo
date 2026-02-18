import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
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

program
  .command("infer")
  .description("Infer types from a .just.js file")
  .argument("<file>", "Path to the .just.js file")
  .action((file: string) => {
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

    for (const fn of functions) {
      console.log(`=== ${fn.name} ===\n`);

      applyMocks(fn.directives, globalEnv, filePath);

      const isPure = fn.directives.some((d) => d.kind === "pure");
      const skipDirective = fn.directives.find((d) => d.kind === "skip");
      const returnsDirective = fn.directives.find((d) => d.kind === "returns");

      if (skipDirective && skipDirective.kind === "skip") {
        if (skipDirective.returns) {
          console.log(`Skipped (declared): ${typeValueToString(skipDirective.returns)}`);
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
      const caseResults: { name: string; args: string; result: string; throws?: string }[] = [];

      for (const directive of caseDirectives) {
        const fullResult = evaluateFunctionFull(fn.node, directive.args, globalEnv);
        const argsStr = directive.args.map(typeValueToString).join(", ");
        const resultStr = typeValueToString(fullResult.value);
        const throwsStr = fullResult.throws.kind !== "never" ? typeValueToString(fullResult.throws) : undefined;
        caseResults.push({
          name: directive.name,
          args: argsStr,
          result: resultStr,
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

      console.log();
    }

    setModuleResolver(null);
  });

program.parse();
