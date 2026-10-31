/**
 * BUG-170 回归：`--from` 的调用点见证不得被**两条合成路径各合成一次**。
 *
 * 改前「已固化 directive 见证 + 主候选循环的 callsite 见证」会产出同名两条
 * ⇒ 台账里 `call@` 出现两次、人类面打印两遍、`summary.cases` 重复计数。
 */
import { describe, it, expect } from "vitest";
import { afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-170-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "lib.js":
      '/**\n * @nudo:case "call@usage.js:L2" (1)\n */\nexport function id(x) {\n  return x;\n}\n',
    "usage.js": 'import { id } from "./lib.js";\nid(1);\n',
    "usage2.js": 'import { id } from "./lib.js";\nid(3);\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf-8");
  }
  return dir;
}

describe("BUG-170 — 调用点见证不重复合成", () => {
  it("已固化见证 + 另一现场 ⇒ 同名 case 只出现一次，summary.cases == 不同见证数", () => {
    const dir = project();
    const out = runCliTsx([
      "test",
      join(dir, "lib.js"),
      "--json",
      "--from",
      join(dir, "usage.js"),
      "--from",
      join(dir, "usage2.js"),
    ]);
    const json = JSON.parse(out.stdout) as {
      summary?: { cases?: number };
      functions?: Array<{ cases?: Array<{ name: string }> }>;
      cases?: Array<{ name: string }>;
    };
    const names =
      json.functions?.flatMap((f) => (f.cases ?? []).map((c) => c.name)) ??
      (json.cases ?? []).map((c) => c.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    if (json.summary?.cases !== undefined) {
      expect(json.summary.cases).toBe(names.length);
    }
  });
});
