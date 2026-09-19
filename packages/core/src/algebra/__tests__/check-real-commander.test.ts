import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { checkSource } from "../index.ts";

/**
 * 真实包精度门禁：commander（devDep）上不得出现任何 error 级误报。
 * 包不存在时跳过（非 monorepo 环境）。
 *
 * commander 声明为本包的 devDependency（pnpm isolated layout 下它链接在
 * packages/core/node_modules，而不是仓库根的 node_modules——历史上按根路径
 * existsSync 探测会让门禁静默 skip）。用 createRequire 按 Node 解析规则
 * 定位。
 */

const require = createRequire(import.meta.url);

function resolveCommanderLib(): string | undefined {
  for (const attempt of [
    () => join(dirname(require.resolve("commander/package.json")), "lib"),
    () => {
      // 主入口可能在 lib/ 或 src/；向上找到含 package.json 的目录
      let p = require.resolve("commander");
      for (let i = 0; i < 4; i++) {
        const parent = dirname(p);
        if (existsSync(join(parent, "package.json"))) return join(parent, "lib");
        p = parent;
      }
      return undefined;
    },
  ]) {
    try {
      const lib = attempt();
      if (lib && existsSync(lib)) return lib;
    } catch {
      // next
    }
  }
  return undefined;
}

const ERROR_CODES = [
  "nudo:constraint-violated",
  "nudo:assign-mismatch",
  "nudo:arg-structure",
] as const;

describe("real package precision (commander)", () => {
  const commanderLib = resolveCommanderLib();
  const hasPkg = !!commanderLib;

  it.runIf(hasPkg)("no false-positive errors (constraint / assign / arg-structure)", () => {
    if (!commanderLib) return; // 已被 runIf 门禁；仅满足 TS 收窄
    const files = readdirSync(commanderLib).filter((f) => f.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    let scanned = 0;
    for (const f of files) {
      const source = readFileSync(join(commanderLib, f), "utf8");
      const r = checkSource(`commander/${f}`, source, undefined, { entryThrows: "off" });
      scanned++;
      for (const i of r.issues) {
        if (i.severity === "error" && (ERROR_CODES as readonly string[]).includes(i.code)) {
          violations.push(`commander/${f}:${i.line ?? "?"} [${i.code}] ${i.message}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(3);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
