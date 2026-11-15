/**
 * Bug 646（**反向守护钉** · 报告说法的假阳性）：`nudo check` 遇**模块环**时
 * **不得**把整张依赖图丢弃。
 *
 * 报告原始描述：`packages/nudojs/src/commands/check.ts` 有
 * `const hasCycle = graph.issues.some(i => i.kind === "cycle")` ⇒ 有环时
 * `mergedMods` 被整个换成 `envMods` 或空 ⇒ 跨模块值塌成 `unknown` ⇒
 * L1 契约门禁**假绿**。
 *
 * **实测（HEAD）：报告说的现象已不成立** ⇒ 本条是**假阳性**，只写守护钉、
 * **零实现改动**（在 HEAD 上必须通过）。
 *
 * HEAD 上的真实链路：
 * - `packages/nudojs/src/commands/check.ts` 的 `buildCheckInjection` 注释明写
 *   「Bug 456：**不再**因为检出环就丢弃整张依赖图」——环内求值**有界**
 *   （装载层：环内已部分求值的导出；求值层：调用/分支预算硬闸），
 *   无需「整图丢弃」这种有损降级；
 * - 环本身仍由诊断面报告（`nudo:module-cycle` warning）——**不靠丢图来「避免」环**。
 *
 * **为什么这条钉不是空转**：
 * - 门禁结果必须**逐字一致**：有环 / 无环两夹具的 `nudo check` exit code 与
 *   诊断文本相同 ⇒ 环没有改变分析结果；
 * - 一致结果里**仍有** `nudo:constraint-violated`（actual `5` ⊭ `> 999`）
 *   ⇒ 跨模块的值**没有**塌成 `unknown`（塌成 unknown 时门禁会**假绿**，
 *   exit code 变 0、约束违规消失 ⇒ 本钉必红）；
 * - 夹具**非空转**：有环夹具真被检出环（`nudo test` 面的 `nudo:module-cycle`），
 *   无环夹具没有 ⇒ 两夹具的差别只在「有没有环」。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 入口：跨模块取 `outer()` 的值 */
const MAIN_JS = `import { outer } from "./a.js";
export function run() { return outer(); }
`;

/** 侧车契约：`run()` 的返回值必须 > 999（实际是 5 ⇒ 必须判违约） */
const MAIN_NUDO_JS = `import { fn, number } from "@nudojs/core";
export const run = fn({}, number().gt(999));
`;

/** 有环：a.js ⇄ b.js（a imports b，b imports a） */
const CYCLE_MODULES: Record<string, string> = {
  "a.js": `import { helper } from "./b.js";
export function outer() { return 5; }
`,
  "b.js": `import { outer } from "./a.js";
export function helper() { return outer(); }
`,
};

/** 无环：a.js → b.js → c.js（同一形状，去掉环） */
const ACYCLIC_MODULES: Record<string, string> = {
  "a.js": `import { helper } from "./b.js";
export function outer() { return 5; }
`,
  "b.js": `import { outer } from "./c.js";
export function helper() { return outer(); }
`,
  "c.js": `export function outer() { return 5; }
`,
};

/** 造一个临时项目（入口 + 侧车 + 依赖模块） */
function makeProject(modules: Record<string, string>, name: string): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug-646-cycle-"));
  for (const [file, body] of Object.entries(modules)) {
    writeFileSync(join(cwd, file), body, "utf-8");
  }
  writeFileSync(join(cwd, "main.js"), MAIN_JS, "utf-8");
  writeFileSync(join(cwd, "main.nudo.js"), MAIN_NUDO_JS, "utf-8");
  writeFileSync(
    join(cwd, "package.json"),
    `{"name":"${name}","version":"0.0.0","type":"module"}\n`,
    "utf-8",
  );
  return cwd;
}

/**
 * 归一化 `nudo check` 人类面输出，供「有环 / 无环」两夹具**逐字**对比。
 *
 * 归一化三处**与分析结果无关**的差异：
 * 1. 夹具目录路径（两个夹具在不同目录）；
 * 2. 模块图**形状**诊断（`nudo:module-cycle` / `nudo:module-depth`）及其 docs 行
 *    —— 环本身被诊断面报告是**期望**行为（模块装载问题族上屏），
 *    但它**不得**改变分析结果（签名 + L2 门禁判定）；
 * 3. 汇总行里的 warning 计数（形状诊断是 warning，会把计数带高）。
 */
function normalizeGateOutput(out: string, dir: string): string {
  return out
    .split(dir)
    .join("<DIR>")
    .split("\n")
    .filter((line) => !line.includes("nudo:module-cycle") && !line.includes("nudo:module-depth"))
    .join("\n")
    .replace(/\d+ warning/g, "N warning");
}

describe("Bug 646 — 模块环不再丢弃整张依赖图（反向守护钉）", () => {
  it("有环 / 无环：nudo check 的 exit code 逐字一致（门禁同判）", () => {
    const cyc = makeProject(CYCLE_MODULES, "b646-with");
    const acyc = makeProject(ACYCLIC_MODULES, "b646-without");
    try {
      const a = runCli(["check", "main.js"], { cwd: cyc });
      const b = runCli(["check", "main.js"], { cwd: acyc });
      // 契约被违反 ⇒ 两边都必须红
      expect(a.status).toBe(1);
      expect(b.status).toBe(1);
      // 环**不得**改变门禁判定
      expect(a.status).toBe(b.status);
      // 两边都不得有噪声（stderr 空）
      expect(a.stderr).toBe("");
      expect(b.stderr).toBe("");
    } finally {
      rmSync(cyc, { recursive: true, force: true });
      rmSync(acyc, { recursive: true, force: true });
    }
  });

  it("有环 / 无环：nudo check 的诊断文本逐字一致（归一化模块图形状诊断后）", () => {
    const cyc = makeProject(CYCLE_MODULES, "b646-with");
    const acyc = makeProject(ACYCLIC_MODULES, "b646-without");
    try {
      const a = runCli(["check", "main.js"], { cwd: cyc });
      const b = runCli(["check", "main.js"], { cwd: acyc });
      expect(normalizeGateOutput(a.stdout, cyc)).toBe(normalizeGateOutput(b.stdout, acyc));
    } finally {
      rmSync(cyc, { recursive: true, force: true });
      rmSync(acyc, { recursive: true, force: true });
    }
  });

  it("一致结果里仍有 constraint-violated（跨模块的值没有塌成 unknown）", () => {
    const cyc = makeProject(CYCLE_MODULES, "b646-with");
    const acyc = makeProject(ACYCLIC_MODULES, "b646-without");
    try {
      for (const cwd of [cyc, acyc]) {
        const r = runCli(["check", "main.js"], { cwd });
        // 跨模块的值仍是确定值 5（塌成 unknown 时这里是 unknown）
        expect(r.stdout).toContain("run() => 5");
        expect(r.stdout).not.toMatch(/run\(\) => unknown/);
        // L2 门禁真的判了违约（假绿 = 这条消失）
        expect(r.stdout).toContain("nudo:constraint-violated");
        expect(r.stdout).toContain("actual:   5  #exact");
        expect(r.stdout).toContain("expected: return > 999");
      }
    } finally {
      rmSync(cyc, { recursive: true, force: true });
      rmSync(acyc, { recursive: true, force: true });
    }
  });

  it("夹具非空转：有环夹具真被检出环（nudo test 面），无环夹具没有", () => {
    const cyc = makeProject(CYCLE_MODULES, "b646-with");
    const acyc = makeProject(ACYCLIC_MODULES, "b646-without");
    try {
      const a = runCli(["test", "main.js"], { cwd: cyc });
      const b = runCli(["test", "main.js"], { cwd: acyc });
      // 环被检出（诊断面报告环，但不因此丢图）
      expect(a.stdout).toContain("nudo:module-cycle");
      expect(a.stdout).toContain("Circular module load");
      expect(b.stdout).not.toContain("nudo:module-cycle");
      // 两边的跨模块值都求出来了（环内绑定解析到「已部分求值的类型」）
      expect(a.stdout).toContain("entry@");
      expect(a.stdout).toContain("() => 5");
      expect(b.stdout).toContain("entry@");
      expect(b.stdout).toContain("() => 5");
    } finally {
      rmSync(cyc, { recursive: true, force: true });
      rmSync(acyc, { recursive: true, force: true });
    }
  });
});
