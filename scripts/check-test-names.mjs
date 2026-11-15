/**
 * 测试文件命名门禁：文件名描述模块/特性，缺陷编号只进 it 标题 / commit / changeset。
 * 规则见 CONTRIBUTING.md「回归测试：按模块/不变量归属」。
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const files = execFileSync("git", ["ls-files", "packages"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts|cts)$/.test(f))
  .filter((f) => f.includes("/__tests__/") || f.includes("/tests/"));

const bad = files.filter((f) => {
  const b = basename(f);
  return (
    /(?:^|[-_])bug[-_]?\d/i.test(b) ||
    /^bug-/i.test(b) ||
    /bug-report/i.test(b) ||
    b.includes("--")
  );
});

if (bad.length > 0) {
  console.error("test files must not be named after defect IDs or use '--':");
  for (const f of bad.slice(0, 50)) console.error("  " + f);
  console.error(`${bad.length} violation(s); see CONTRIBUTING.md`);
  process.exit(1);
}
console.log(`test-names: OK (${files.length} files)`);
