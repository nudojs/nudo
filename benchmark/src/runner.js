/**
 * Benchmark Runner - Measures Nudo inference accuracy and speed
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { cases } from "./cases.js";

const NUDO_CLI = "packages/cli/src/index.ts";
const RESULTS_DIR = "./benchmark/results";

mkdirSync(RESULTS_DIR, { recursive: true });

/**
 * Run Nudo inference on a single case
 */
function runNudoInference(caseItem) {
  // Create a temporary file with the function and case directive
  const tempFile = `/tmp/nudo-bench-${caseItem.id}.js`;
  const caseArgs = caseItem.args.map(a => JSON.stringify(a)).join(", ");
  const source = `/**
 * @nudo:case "test" (${caseArgs})
 */
${caseItem.code}
`;

  writeFileSync(tempFile, source);

  const start = performance.now();
  try {
    const output = execSync(`pnpm run infer "${tempFile}"`, {
      encoding: "utf-8",
      timeout: 10000,
      cwd: process.cwd()
    });
    const duration = performance.now() - start;

    // Parse the output to extract the inferred type
    const match = output.match(/Case "test": \(([^)]*)\) => (.+)/);
    const inferredType = match ? match[2].trim() : "unknown";

    return {
      success: true,
      inferredType,
      duration,
      output: output.trim()
    };
  } catch (error) {
    return {
      success: false,
      inferredType: "error",
      duration: performance.now() - start,
      error: error.message
    };
  }
}

/**
 * Compare inferred type with expected runtime value
 */
function compareResults(inferredType, expected) {
  // For now, we'll do a simple string comparison
  // A more sophisticated comparison would parse the inferred type
  const expectedStr = typeof expected === "function" ? "function" :
    expected === undefined ? "undefined" :
    expected === null ? "null" :
    JSON.stringify(expected);

  // Simple match check
  if (inferredType === expectedStr) return "exact";
  if (inferredType === "unknown") return "unknown";
  if (inferredType === "error") return "error";

  // Check if it's a partial match (e.g., inferred array vs expected array)
  if (inferredType.includes("[") && Array.isArray(expected)) return "partial";
  if (inferredType.includes("{") && typeof expected === "object") return "partial";

  return "mismatch";
}

/**
 * Run the full benchmark
 */
async function runBenchmark() {
  console.log("Nudo Benchmark Suite");
  console.log("=".repeat(50));
  console.log(`Running ${cases.length} test cases...\n`);

  const results = [];
  let totalTime = 0;
  let exactMatches = 0;
  let partialMatches = 0;
  let unknownCount = 0;
  let errorCount = 0;

  for (const caseItem of cases) {
    process.stdout.write(`Testing ${caseItem.id}: ${caseItem.name}... `);

    const result = runNudoInference(caseItem);
    const comparison = compareResults(result.inferredType, caseItem.expected);

    totalTime += result.duration;

    switch (comparison) {
      case "exact": exactMatches++; break;
      case "partial": partialMatches++; break;
      case "unknown": unknownCount++; break;
      case "error": errorCount++; break;
    }

    const status = comparison === "exact" ? "✓" :
      comparison === "partial" ? "~" :
      comparison === "unknown" ? "?" : "✗";

    console.log(`${status} (${result.duration.toFixed(1)}ms) - ${result.inferredType}`);

    results.push({
      ...caseItem,
      inferredType: result.inferredType,
      comparison,
      duration: result.duration,
      output: result.output
    });
  }

  // Generate summary
  const summary = {
    timestamp: new Date().toISOString(),
    totalCases: cases.length,
    results: {
      exactMatches,
      partialMatches,
      unknownCount,
      errorCount
    },
    accuracy: {
      exact: (exactMatches / cases.length * 100).toFixed(1) + "%",
      partial: (partialMatches / cases.length * 100).toFixed(1) + "%",
      unknown: (unknownCount / cases.length * 100).toFixed(1) + "%",
      error: (errorCount / cases.length * 100).toFixed(1) + "%"
    },
    performance: {
      totalTimeMs: totalTime.toFixed(1),
      averageTimeMs: (totalTime / cases.length).toFixed(1),
      casesPerSecond: (cases.length / (totalTime / 1000)).toFixed(0)
    },
    byComplexity: {},
    byCategory: {}
  };

  // Calculate by complexity
  for (let i = 1; i <= 8; i++) {
    const complexityCases = results.filter(r => r.complexity === i);
    if (complexityCases.length > 0) {
      const exact = complexityCases.filter(r => r.comparison === "exact").length;
      summary.byComplexity[`level${i}`] = {
        total: complexityCases.length,
        exact,
        accuracy: (exact / complexityCases.length * 100).toFixed(1) + "%"
      };
    }
  }

  // Calculate by category
  const categories = [...new Set(results.map(r => r.category))];
  for (const cat of categories) {
    const catCases = results.filter(r => r.category === cat);
    const exact = catCases.filter(r => r.comparison === "exact").length;
    summary.byCategory[cat] = {
      total: catCases.length,
      exact,
      accuracy: (exact / catCases.length * 100).toFixed(1) + "%"
    };
  }

  // Save results
  const outputFile = `${RESULTS_DIR}/benchmark-${Date.now()}.json`;
  writeFileSync(outputFile, JSON.stringify({ summary, results }, null, 2));

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("BENCHMARK RESULTS");
  console.log("=".repeat(50));
  console.log(`Total cases: ${cases.length}`);
  console.log(`Exact matches: ${exactMatches} (${summary.accuracy.exact})`);
  console.log(`Partial matches: ${partialMatches} (${summary.accuracy.partial})`);
  console.log(`Unknown: ${unknownCount} (${summary.accuracy.unknown})`);
  console.log(`Errors: ${errorCount} (${summary.accuracy.error})`);
  console.log("\nPerformance:");
  console.log(`  Total time: ${summary.performance.totalTimeMs}ms`);
  console.log(`  Average: ${summary.performance.averageTimeMs}ms/case`);
  console.log(`  Throughput: ${summary.performance.casesPerSecond} cases/second`);
  console.log("\nBy complexity:");
  for (const [level, data] of Object.entries(summary.byComplexity)) {
    console.log(`  ${level}: ${data.exact}/${data.total} exact (${data.accuracy})`);
  }
  console.log("\nBy category:");
  for (const [cat, data] of Object.entries(summary.byCategory)) {
    console.log(`  ${cat}: ${data.exact}/${data.total} exact (${data.accuracy})`);
  }
  console.log(`\nResults saved to: ${outputFile}`);

  return summary;
}

runBenchmark().catch(console.error);
