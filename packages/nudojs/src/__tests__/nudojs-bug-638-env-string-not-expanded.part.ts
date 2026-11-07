/**
 * Bug 638（**反向守护钉** · 报告说法的假阳性）：`package.json#nudo.env` 写成
 * **字符串**时，`nudo check` **不得**把它展成逐字符的 env 名列表。
 *
 * 报告原始描述：`packages/nudojs/src/commands/check.ts` 把 `package.json#nudo.env`
 * 直接当数组展开 ⇒ `"node"` 被展成 `["n","o","d","e"]` ⇒ env 静默不生效 +
 * 假 `nudo:unknown-inference`。
 *
 * **实测（HEAD）：报告说的现象已不成立** ⇒ 本条是**假阳性**，只写守护钉、
 * **零实现改动**（在 HEAD 上必须通过）。
 *
 * HEAD 上的真实链路（两段守卫，缺一不可）：
 * 1. **配置层**（`packages/service/src/evaluator/config.ts` 的 `sanitizeProjectEnv`）：
 *    `nudo.env` 的值不是数组 ⇒ **整项丢弃**（回落空列表）+ 一条 stderr 提示
 *    （`has an invalid "nudo.env" value ("node"; expected an array of strings); ignoring it`）；
 * 2. **消费层**（`packages/nudojs/src/commands/check.ts` 的 `projectEnvShapeIssue` +
 *    `Array.isArray(rawProjectEnv) ? rawProjectEnv : []`）：形状问题在**报告面**
 *    可见（诊断码 `config-shape`，与 468/936 的 `nudo` 键形状诊断同口径），
 *    消费点另有显式守卫 ⇒ 旧实现的 `projectEnvNames is not iterable` 裸崩
 *    （五个 verb 全崩）也已消失。
 *
 * **为什么这条钉不是空转**（两头夹逼）：
 * - 若真被展成字符（`["n","o","d","e"]`），env 装载面会为**每个字符名**报一条
 *   `nudo:env-unresolved`（`unknown env name "n"` …，共 **4** 条）——
 *   本钉用「字符串 env ⇒ **0** 条」与「字符数组 env ⇒ 恰 **4** 条」夹逼，
 *   把「env 名列表**不是**逐字符」钉死；
 * - 用「`env: ["node"]` ⇒ `Buffer` 可用」与「`env: "node"` ⇒ `Buffer` **不可用**
 *   （列表被忽略，env 侧不生效）」夹逼，把「env 列表被忽略」钉死；
 * - env **无关**型代码在字符串 env 下**不得**产生 `nudo:unknown-inference`
 *   （被忽略的 env 不得制造假的推断失败告警）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 需要 env 全局（`Buffer`）的代码：env 生效与否在这里看得见 */
const SRC_ENV_DEPENDENT = `export function toBuf(s){ return Buffer.from(s); }
`;

/** 与 env 无关的代码：env 列表被忽略时**不得**制造假的 `nudo:unknown-inference` */
const SRC_ENV_INDEPENDENT = `export function answer() { return 42; }
`;

/** 造一个带 `nudo.env` 的临时项目（`envJson` 是 env 值的 **JSON 文本**） */
function makeProject(envJson: string, src: string): { cwd: string; pkg: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug-638-envstr-"));
  writeFileSync(join(cwd, "a.js"), src, "utf-8");
  writeFileSync(
    join(cwd, "package.json"),
    `{"name":"env-str-proj","version":"0.0.0","type":"module","nudo":{"env":${envJson}}}\n`,
    "utf-8",
  );
  return { cwd, pkg: join(cwd, "package.json") };
}

/** 出现次数（人类面里 `nudo:env-unresolved` 既有 issue 行也有 docs 行 ⇒ 按词计数） */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("Bug 638 — nudo.env 写成字符串：不展成逐字符 env 名列表（反向守护钉）", () => {
  it("字符串 env：不裸崩 + 人类面产出 config-shape 形状告警", () => {
    const { cwd, pkg } = makeProject('"node"', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd });
      // 不裸崩（旧实现：projectEnvNames is not iterable ⇒ 五个 verb 全崩）
      expect(r.stderr).not.toContain("is not iterable");
      expect(r.stderr).not.toContain("TypeError");
      expect(r.status).toBe(0);
      // 形状告警上屏（诊断码 config-shape，与 468/936 同口径）
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain('"nudo.env"');
      expect(r.stdout).toContain('("node"; expected an array of strings)');
      expect(r.stdout).toContain(pkg);
      // 配置面提示（stderr 一行）
      expect(r.stderr).toContain(
        'has an invalid "nudo.env" value ("node"; expected an array of strings); ignoring it',
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("字符串 env：机器面（--json）恰一条 config-shape 告警（warning），且零条 env-unresolved", () => {
    const { cwd } = makeProject('"node"', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js", "--json"], { cwd });
      expect(r.status).toBe(0);
      const j = JSON.parse(r.stdout) as {
        ok: boolean;
        issues: Array<{ severity: string; code: string; message: string }>;
      };
      const shape = j.issues.filter((i) => i.code === "config-shape");
      expect(shape).toHaveLength(1);
      expect(shape[0].severity).toBe("warning");
      expect(shape[0].message).toContain('"nudo.env"');
      expect(shape[0].message).toContain('"node"');
      // 展成字符的痕迹：一个都不许有
      expect(j.issues.filter((i) => i.code === "nudo:env-unresolved")).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("env 名列表不是逐字符：字符串 env ⇒ 0 条 env-unresolved；字符数组 env ⇒ 恰 4 条", () => {
    // 被钉住的行为：字符串 env **不**产生任何逐字符 env 名
    const str = makeProject('"node"', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd: str.cwd });
      expect(count(r.stdout, "unknown env name")).toBe(0);
      expect(count(r.stdout, "nudo:env-unresolved")).toBe(0);
    } finally {
      rmSync(str.cwd, { recursive: true, force: true });
    }
    // 对照：若真被展成字符（["n","o","d","e"]），env 装载面会逐个报 unknown env name
    // ⇒ 上面的断言是**活的**判别（不是恒真的空转）
    const chars = makeProject('["n","o","d","e"]', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd: chars.cwd });
      expect(count(r.stdout, "unknown env name")).toBe(4);
      expect(count(r.stdout, "nudo:env-unresolved")).toBeGreaterThanOrEqual(4);
      for (const ch of ["n", "o", "d", "e"]) {
        expect(r.stdout).toContain(`unknown env name "${ch}"`);
      }
    } finally {
      rmSync(chars.cwd, { recursive: true, force: true });
    }
  });

  it("env 列表被忽略：字符串 env ⇒ Buffer 不可用（env 侧不生效）；env:[\"node\"] ⇒ Buffer 可用", () => {
    const str = makeProject('"node"', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd: str.cwd });
      // env 侧不生效 ⇒ Buffer 全局不可得 ⇒ 返回值塌成 unknown
      expect(r.stdout).toContain("toBuf(s: any) => unknown");
      expect(r.stdout).not.toContain("toBuf(s: any) => Buffer");
      // 且这是**已知原因**（形状告警在场），不是无声的推断失败
      expect(r.stdout).toContain("config-shape");
    } finally {
      rmSync(str.cwd, { recursive: true, force: true });
    }
    // 对照：合法 env 数组 ⇒ env 生效（Buffer 可得），且无形状告警
    const arr = makeProject('["node"]', SRC_ENV_DEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd: arr.cwd });
      expect(r.stdout).toContain("toBuf(s: any) => Buffer");
      expect(r.stdout).not.toContain("config-shape");
      expect(r.stdout).not.toContain("nudo:unknown-inference");
    } finally {
      rmSync(arr.cwd, { recursive: true, force: true });
    }
  });

  it("env 无关型代码：被忽略的 env 不制造假的 nudo:unknown-inference", () => {
    const { cwd } = makeProject('"node"', SRC_ENV_INDEPENDENT);
    try {
      const r = runCli(["check", "a.js"], { cwd });
      expect(r.status).toBe(0);
      // 推断本身成功 ⇒ 不得有 unknown-inference
      expect(r.stdout).toContain("answer() => 42");
      expect(r.stdout).not.toContain("nudo:unknown-inference");
      // 但「env 列表被忽略」这件事仍然可见
      expect(r.stdout).toContain("config-shape");
      expect(count(r.stdout, "unknown env name")).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
