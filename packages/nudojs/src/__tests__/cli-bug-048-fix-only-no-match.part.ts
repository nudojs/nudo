/**
 * BUG-048 —— `nudo check --fix --only <码>` 匹配不到任何诊断时是**静默
 * no-op**：拼错的码与「这些诊断确实没有可自动应用的修复」输出完全一样。
 *
 * 现在两个面都可见：
 * - `--only` 的取值必须落在诊断码注册表（DIAG）内 ⇒ 拼错 ⇒ usage error + exit 1
 * - 合法码但本次目标没有该诊断 ⇒ 末尾明确报「matched no diagnostic」
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 未约束 entry ⇒ nudo:entry-may-throw（error）+ entry-only（info） */
const HELPER = `export function staticName(node) {
  return node.type;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug048-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b48", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "helper.js"), HELPER, "utf-8");
  return cwd;
}

describe("BUG-048 — --fix --only 无命中必须可见", () => {
  it("拼错的码 ⇒ usage error + exit 1（不再静默 no-op）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "helper.js", "--fix", "--only", "nudo:bogus-code"], {
        cwd,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("unknown diagnostic code(s): nudo:bogus-code");
      // 不能退化成「0 edit(s) planned」的静默形态
      expect(r.stdout).not.toContain("0 edit(s)");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("合法码但本次无该诊断 ⇒ 末尾报「matched no diagnostic」", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "helper.js", "--fix", "--only", "nudo:arg-count"], {
        cwd,
      });
      expect(r.stdout).toContain("--only nudo:arg-count matched no diagnostic");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
