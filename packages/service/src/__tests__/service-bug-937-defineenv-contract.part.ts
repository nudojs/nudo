/**
 * Bug 937 — path 型 env 文件违反 `defineEnv()` 契约（不导出 / 不是函数 /
 * 抛异常 / 返回非 {globals}）⇒ **零 env 诊断** ⇒ env 静默失效 ⇒ 用户代码被
 * 判「必然抛 ReferenceError」（假红），而同目录里**语法错**的 env 文件
 * 反而有 nudo:env-unresolved 警告（口径分裂）。
 *
 * 契约：四种违约形态各给一条明确诊断（复用 nudo:env-unresolved 通道），
 * 诊断必须点名 env 文件；契约满足时不得有该告警（负控制）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEnvironment, formatShape } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";
import {
  loadEnvs,
  preloadPathEnvs,
  getPathEnvLoadErrors,
  clearPathEnvCaches,
} from "../evaluator/env-loader.ts";

beforeEach(() => {
  clearPathEnvCaches();
});

/** 违约形态 → 期望诊断片段 */
const VIOLATIONS: Array<{ name: string; src: string; expect: string }> = [
  {
    name: "不导出 defineEnv",
    src: "export const notDefine = 1;\n",
    expect: "must export a defineEnv() function",
  },
  {
    name: "defineEnv 不是函数",
    src: "export const defineEnv = 42;\n",
    expect: "must export a defineEnv() function",
  },
  {
    name: "defineEnv 抛异常",
    src: 'export function defineEnv() { throw new Error("boom"); }\n',
    expect: "defineEnv() threw: boom",
  },
  {
    name: "返回 null",
    src: "export function defineEnv() { return null; }\n",
    expect: "must return { globals }",
  },
  {
    name: "返回 7",
    src: "export function defineEnv() { return 7; }\n",
    expect: "must return { globals }",
  },
  {
    name: "返回 {}（无 globals）",
    src: "export function defineEnv() { return {}; }\n",
    expect: "must return { globals }",
  },
];

describe("Bug 937 — defineEnv() 契约违约必须可见", () => {
  for (const v of VIOLATIONS) {
    it(`${v.name}：一条 nudo:env-unresolved 诊断且点名 env 文件`, async () => {
      const dir = tmpProject("nudo-bug-937-");
      const envFile = join(dir, "myenv.mjs");
      writeFileSync(envFile, v.src, "utf-8");

      await preloadPathEnvs(["./myenv.mjs"], dir);
      // 工厂调用不得把异常冒泡出去（求值侧兜底 catch 会静默吞掉）
      const loaded = loadEnvs(["./myenv.mjs"], createEnvironment(), dir);
      expect(Object.keys(loaded.globals)).toHaveLength(0);

      const errs = getPathEnvLoadErrors(dir);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.path).toBe(envFile);
      expect(errs[0]!.error).toContain(v.expect);
    });
  }

  it("结构违约（不导出 / 不是函数）在**装载期**即报（不待工厂调用）", async () => {
    for (const src of ["export const notDefine = 1;\n", "export const defineEnv = 42;\n"]) {
      const dir = tmpProject("nudo-bug-937-struct-");
      const envFile = join(dir, "myenv.mjs");
      writeFileSync(envFile, src, "utf-8");
      await preloadPathEnvs(["./myenv.mjs"], dir);
      const errs = getPathEnvLoadErrors(dir);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.path).toBe(envFile);
      expect(errs[0]!.error).toContain("must export a defineEnv() function");
    }
  });

  it("负控制：契约满足的 env 文件生效且零告警", async () => {
    const dir = tmpProject("nudo-bug-937-ok-");
    writeFileSync(
      join(dir, "myenv.mjs"),
      `import { numLit } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: numLit(42) } };
}
`,
      "utf-8",
    );
    await preloadPathEnvs(["./myenv.mjs"], dir);
    expect(getPathEnvLoadErrors(dir)).toHaveLength(0);
    const loaded = loadEnvs(["./myenv.mjs"], createEnvironment(), dir);
    expect(formatShape(loaded.globals.MAGIC!)).toBe("42");
  });

  it("负控制：语法错的 env 文件仍走既有措辞（不与契约诊断混口径）", async () => {
    const dir = tmpProject("nudo-bug-937-syntax-");
    writeFileSync(join(dir, "myenv.mjs"), "export function defineEnv( {\n", "utf-8");
    await preloadPathEnvs(["./myenv.mjs"], dir);
    const errs = getPathEnvLoadErrors(dir);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.error).not.toContain("must export a defineEnv()");
  });
});
