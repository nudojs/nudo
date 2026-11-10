/**
 * ABS-06：生成内建一致性矩阵报告（生成物；不手改数字）。
 *
 * 用法：node --import tsx scripts/builtins-consistency-report.ts [--check]
 *   --check：报告与磁盘不一致 ⇒ exit 1（CI freshness 门可用）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderMatrixReport,
  runMatrix,
} from "../packages/core/src/algebra/__tests__/builtins-consistency-matrix.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "docs/reports/builtins-consistency.md");
const result = runMatrix();
const text = renderMatrixReport(result);
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(out, "utf-8");
  } catch {
    /* missing ⇒ mismatch */
  }
  if (current !== text) {
    console.error(
      `builtins-consistency report is stale: regenerate with node --import tsx scripts/builtins-consistency-report.ts`,
    );
    process.exit(1);
  }
  console.log("builtins-consistency report is current");
} else {
  writeFileSync(out, text, "utf-8");
  console.log(
    `wrote ${out} — modeled=${result.counts.modeled} unknown=${result.counts.unknown} wrong-exact=${result.counts["wrong-exact"]} total=${result.total}`,
  );
}
