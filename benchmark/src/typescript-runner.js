/**
 * TypeScript Benchmark Runner
 * Measures TypeScript compilation and type checking time
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { cases } from "./cases.js";

const RESULTS_DIR = "./benchmark/results";
mkdirSync(RESULTS_DIR, { recursive: true });

/**
 * Generate TypeScript version of a test case
 */
function generateTypeScript(caseItem) {
  // Convert JavaScript to TypeScript with type annotations
  let tsCode = caseItem.code;

  // Add parameter types based on the arguments
  const paramTypes = caseItem.args.map((arg, i) => {
    if (arg === null) return `arg${i}: null`;
    if (arg === undefined) return `arg${i}: undefined`;
    if (Array.isArray(arg)) {
      if (arg.length === 0) return `arg${i}: any[]`;
      const elemType = typeof arg[0];
      return `arg${i}: ${elemType}[]`;
    }
    return `arg${i}: ${typeof arg}`;
  }).join(", ");

  // Replace function signature
  tsCode = tsCode.replace(
    /function\s+(\w+)\(([^)]*)\)/,
    (match, name, params) => {
      if (params.trim() === "") return `function ${name}()`;
      return `function ${name}(${paramTypes})`;
    }
  );

  return tsCode;
}

/**
 * Run TypeScript type checking on a case
 */
function runTypeScriptCheck(caseItem) {
  const tsCode = generateTypeScript(caseItem);
  const tempFile = `/tmp/ts-bench-${caseItem.id}.ts`;

  writeFileSync(tempFile, tsCode);

  const start = performance.now();
  try {
    // Run tsc --noEmit to check types
    execSync(`npx tsc --noEmit --strict --target es2022 --moduleResolution bundler "${tempFile}"`, {
      encoding: "utf-8",
      timeout: 30000,
      cwd: process.cwd()
    });
    const duration = performance.now() - start;

    return {
      success: true,
      duration,
      typeAnnotations: paramTypes.length
    };
  } catch (error) {
    const duration = performance.now() - start;
    return {
      success: false,
      duration,
      error: error.message,
      typeAnnotations: paramTypes.length
    };
  }
}

/**
 * Run the TypeScript benchmark
 */
async function runTypeScriptBenchmark() {
  console.log("TypeScript Benchmark Suite");
  console.log("=".repeat(50));
  console.log(`Running ${cases.length} test cases...\n`);

  const results = [];
  let totalTime = 0;
  let successCount = 0;
  let errorCount = 0;
  let totalAnnotations = 0;

  for (const caseItem of cases) {
    process.stdout.write(`Testing ${caseItem.id}: ${caseItem.name}... `);

    const result = runTypeScriptCheck(caseItem);
    totalTime += result.duration;
    totalAnnotations += result.typeAnnotations;

    if (result.success) {
      successCount++;
      console.log(`✓ (${result.duration.toFixed(1)}ms, ${result.typeAnnotations} annotations)`);
    } else {
      errorCount++;
      console.log(`✗ (${result.duration.toFixed(1)}ms)`);
    }

    results.push({
      ...caseItem,
      ...result
    });
  }

  // Generate summary
  const summary = {
    timestamp: new Date().toISOString(),
    tool: "TypeScript",
    totalCases: cases.length,
    results: {
      success: successCount,
      errors: errorCount
    },
    performance: {
      totalTimeMs: totalTime.toFixed(1),
      averageTimeMs: (totalTime / cases.length).toFixed(1),
      casesPerSecond: (cases.length / (totalTime / 1000)).toFixed(0)
    },
    annotations: {
      total: totalAnnotations,
      average: (totalAnnotations / cases.length).toFixed(1)
    }
  };

  // Save results
  const outputFile = `${RESULTS_DIR}/typescript-benchmark-${Date.now()}.json`;
  writeFileSync(outputFile, JSON.stringify({ summary, results }, null, 2));

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("TYPESCRIPT BENCHMARK RESULTS");
  console.log("=".repeat(50));
  console.log(`Total cases: ${cases.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log("\nPerformance:");
  console.log(`  Total time: ${summary.performance.totalTimeMs}ms`);
  console.log(`  Average: ${summary.performance.averageTimeMs}ms/case`);
  console.log(`  Throughput: ${summary.performance.casesPerSecond} cases/second`);
  console.log("\nType annotations:");
  console.log(`  Total: ${totalAnnotations}`);
  console.log(`  Average: ${summary.annotations.average} per case`);
  console.log(`\nResults saved to: ${outputFile}`);

  return summary;
}

runTypeScriptBenchmark().catch(console.error);
