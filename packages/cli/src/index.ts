import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  T,
  typeValueToString,
  simplifyUnion,
  createEnvironment,
} from "@justscript/core";
import { parse, extractDirectives } from "@justscript/parser";
import { evaluateFunction } from "./evaluator.ts";

const program = new Command();

program
  .name("justscript")
  .description("JustScript type inference engine")
  .version("0.0.1");

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

    const globalEnv = createEnvironment();

    for (const fn of functions) {
      console.log(`=== ${fn.name} ===\n`);

      const caseResults: { name: string; args: string; result: string }[] = [];

      for (const directive of fn.directives) {
        const result = evaluateFunction(fn.node, directive.args, globalEnv);
        const argsStr = directive.args.map(typeValueToString).join(", ");
        const resultStr = typeValueToString(result);
        caseResults.push({
          name: directive.name,
          args: argsStr,
          result: resultStr,
        });
        console.log(`Case "${directive.name}": (${argsStr}) => ${resultStr}`);
      }

      if (caseResults.length > 1) {
        const allResults = functions
          .filter((f) => f.name === fn.name)
          .flatMap((f) =>
            f.directives.map((d) => evaluateFunction(fn.node, d.args, globalEnv)),
          );
        const combined = simplifyUnion(allResults);
        console.log(`\nCombined: ${typeValueToString(combined)}`);
      }

      console.log();
    }
  });

program.parse();
