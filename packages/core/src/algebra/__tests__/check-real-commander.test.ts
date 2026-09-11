import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSource } from "../index.ts";

/**
 * 真实包精度门禁：commander（devDep）上不得出现 constraint-violated 误报。
 * 包不存在时跳过（非 monorepo 环境）。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const commanderLib = join(root, "node_modules/commander/lib");

describe("real package precision (commander)", () => {
  const hasPkg = existsSync(commanderLib);

  it.runIf(hasPkg)("no false-positive constraint violations", () => {
    const files = readdirSync(commanderLib).filter((f) => f.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    let scanned = 0;
    for (const f of files) {
      const source = readFileSync(join(commanderLib, f), "utf8");
      const r = checkSource(`commander/${f}`, source);
      scanned++;
      for (const i of r.issues) {
        if (i.code === "nudo:constraint-violated") {
          violations.push(`commander/${f}:${i.line ?? "?"} ${i.message}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(3);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
