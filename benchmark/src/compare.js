/**
 * Benchmark Comparison - Nudo vs TypeScript
 * Runs both benchmarks and generates a comparison report
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync } from "fs";

const RESULTS_DIR = "./benchmark/results";

/**
 * Get the latest benchmark result file
 */
function getLatestResult(prefix) {
  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  return JSON.parse(readFileSync(`${RESULTS_DIR}/${files[0]}`, "utf-8"));
}

/**
 * Run comparison
 */
async function runComparison() {
  console.log("Running Nudo benchmark...");
  execSync("node benchmark/src/runner.js", { stdio: "inherit" });

  console.log("\nRunning TypeScript benchmark...");
  execSync("node benchmark/src/typescript-runner.js", { stdio: "inherit" });

  // Load results
  const nudoResult = getLatestResult("benchmark-");
  const tsResult = getLatestResult("typescript-benchmark-");

  if (!nudoResult || !tsResult) {
    console.error("Could not find benchmark results");
    process.exit(1);
  }

  // Generate comparison report
  const comparison = {
    timestamp: new Date().toISOString(),
    nudo: {
      accuracy: nudoResult.summary.accuracy,
      performance: nudoResult.summary.performance,
      byComplexity: nudoResult.summary.byComplexity,
      byCategory: nudoResult.summary.byCategory
    },
    typescript: {
      successRate: `${(tsResult.summary.results.success / tsResult.summary.totalCases * 100).toFixed(1)}%`,
      performance: tsResult.summary.performance,
      annotations: tsResult.summary.annotations
    },
    comparison: {
      accuracyVsSuccess: `Nudo: ${nudoResult.summary.accuracy.exact} exact vs TS: ${tsResult.summary.results.success}/${tsResult.summary.totalCases} success`,
      speedup: `${(parseFloat(tsResult.summary.performance.averageTimeMs) / parseFloat(nudoResult.summary.performance.averageTimeMs)).toFixed(1)}x faster`,
      annotationSavings: `${tsResult.summary.annotations.total} annotations saved`
    }
  };

  // Save comparison
  const outputFile = `${RESULTS_DIR}/comparison-${Date.now()}.json`;
  writeFileSync(outputFile, JSON.stringify(comparison, null, 2));

  // Print comparison
  console.log("\n" + "=".repeat(60));
  console.log("BENCHMARK COMPARISON: Nudo vs TypeScript");
  console.log("=".repeat(60));

  console.log("\n📊 Accuracy:");
  console.log(`  Nudo: ${nudoResult.summary.accuracy.exact} exact matches`);
  console.log(`  TypeScript: ${comparison.typescript.successRate} success rate`);

  console.log("\n⚡ Performance:");
  console.log(`  Nudo: ${nudoResult.summary.performance.averageTimeMs}ms/case`);
  console.log(`  TypeScript: ${tsResult.summary.performance.averageTimeMs}ms/case`);
  console.log(`  Speedup: ${comparison.comparison.speedup}`);

  console.log("\n📝 Annotations:");
  console.log(`  Nudo: 0 annotations`);
  console.log(`  TypeScript: ${tsResult.summary.annotations.total} annotations`);
  console.log(`  Savings: ${comparison.comparison.annotationSavings}`);

  console.log("\n📈 By Complexity (Nudo):");
  for (const [level, data] of Object.entries(nudoResult.summary.byComplexity)) {
    console.log(`  ${level}: ${data.exact}/${data.total} exact (${data.accuracy})`);
  }

  console.log("\n📂 By Category (Nudo):");
  for (const [cat, data] of Object.entries(nudoResult.summary.byCategory)) {
    console.log(`  ${cat}: ${data.exact}/${data.total} exact (${data.accuracy})`);
  }

  console.log(`\n💾 Comparison saved to: ${outputFile}`);
}

runComparison().catch(console.error);
