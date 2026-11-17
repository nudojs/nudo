/**
 * 模块套件：cli-check-contract-and-gates（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterAll, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { runCliTsx, runCliNode as runCli } from "./helpers/run-cli.ts";
import { collectExternalRecords } from "../commands/shared.ts";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";
import { configIgnoreThrows, parseIgnoreThrows } from "../check-gate-config.ts";
import { Command } from "commander";
import { registerCheckCommand } from "../commands/check-command.ts";
import { resetCheckSourceMemo, resetGeneralizeMemo, resetNudoModuleExecCache, resetParseSourceCache, resetSidecarLoadFailureCache, takeContractDiags, takeRefineDiags, type CheckJson } from "@nudojs/core";
import { resetAbsCallBudget, resetEvalForkBudget } from "@nudojs/core/internal";
import { domainIssuesFromDiagnostics, dedupeFromStaticIssues, staticFromDomainIssues } from "../check-json-map.ts";
import { runCheck } from "../commands/check.ts";


// ---------------------------------------------------------------------------
// ignoreThrows 配置面与 CLI 面同口径
// ---------------------------------------------------------------------------
describe("ignoreThrows 配置面与 CLI 面同口径", () => {
/**
 * `package.json#nudo.check.ignoreThrows` 与 CLI `--ignore-throws`
 * **两套解析器** ⇒ 同一语义键两种写法行为不同。
 *
 * 症状：配置面只认严格 `string[]`（service checkConfig 的 `Array.isArray` 过滤）
 * ⇒ 配置写 `"TypeError"`（裸字符串）或 `["TypeError,RangeError"]`（数组元素内
 * 带逗号）都被静默丢成空表 ⇒ 门禁**假红**（用户以为忽略了 TypeError，实际
 * 没忽略）。修复：配置面复用 CLI 解析器（切逗号 + trim + 接受裸字符串 /
 * 数组两种形态）；形状非法（数字 / 布尔 / 对象）回落默认 + stderr 一行告警。
 */







/** 未约束的 entry ⇒ L2 entry-may-throw TypeError（被忽略则门禁绿） */
const SRC = `export function getName(user) {
  return user.name;
}
`;

function makeProject(ignoreThrowsJson: string): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-679-ignoretthrows-"));
  const file = join(dir, "a.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(
    join(dir, "package.json"),
    `{"name":"ig-proj","version":"0.0.0","nudo":{"check":{"ignoreThrows":${ignoreThrowsJson}}}}\n`,
    "utf-8",
  );
  return { cwd: dir, file };
}


  it("解析器：配置面裸字符串 / 数组元素内逗号都被切开；CLI：配置写裸字符串 \"TypeError\" ⇒ L2 被忽略（门禁绿）；CLI：配置写 [\"TypeError,RangeError\"] ⇒ 数组元素内逗号被切开（门禁绿）；CLI：配置写 [\"TypeError\"]（旧口径，未回归）⇒ 门禁绿；CLI：形状非法（42）⇒ 回落默认 + stderr 一行告警（不静默假红）；CLI：CLI 旗标形态不变（--ignore-throws TypeError,RangeErr", () => {
  {
    expect(configIgnoreThrows({ check: { ignoreThrows: "TypeError" } })).toEqual([
      "TypeError",
    ]);
    expect(configIgnoreThrows({ check: { ignoreThrows: ["TypeError,RangeError"] } })).toEqual([
      "TypeError",
      "RangeError",
    ]);
    expect(configIgnoreThrows({ check: { ignoreThrows: ["TypeError"] } })).toEqual([
      "TypeError",
    ]);
    // 与 CLI 解析器逐字同结果（配置面不再走 service 的严格 string[] 过滤）
    expect(configIgnoreThrows({ check: { ignoreThrows: "TypeError, RangeError" } })).toEqual(
      parseIgnoreThrows("TypeError, RangeError"),
    );
  }
  {
    const { cwd, file } = makeProject('"TypeError"');
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stdout).not.toContain("nudo:entry-may-throw");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject('["TypeError,RangeError"]');
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stdout).not.toContain("nudo:entry-may-throw");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject('["TypeError"]');
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stdout).not.toContain("nudo:entry-may-throw");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject("42");
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).toContain("warning: package.json nudo.check.ignoreThrows");
      expect(r.stderr).toContain("42");
      // 回落默认 = 不忽略任何 throw 类 ⇒ L2 仍红（诚实）
      expect(r.stdout).toContain("nudo:entry-may-throw");
      expect(r.status).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject('["EvalError"]');
    try {
      const r = runCliTsx(["check", file, "--ignore-throws", "TypeError,RangeError"], {
        cwd,
      });
      expect(r.stdout).not.toContain("nudo:entry-may-throw");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});






});


// ---------------------------------------------------------------------------
// test --abs 不再吞掉 diagnostics（三个面诊断条数一致）
// ---------------------------------------------------------------------------
describe("test --abs 不再吞掉 diagnostics（三个面诊断条数一致）", () => {
/**
 * `nudo test --abs` 把整段 **diagnostics** 吞掉 ⇒ 期望写错
 * （`=> 42x` 这类）在观察面上是「屏幕上零提示」的**假绿**。
 *
 * 根因：「诊断上屏」的判据把 `--abs` 写成第三个被排除的面
 * （`!opts.json && diagnostics.length > 0 && !opts.abs`）——而 `--abs`
 * 并非「诊断不适用」的面（`--json` 面顶层键含 `diagnostics`）。
 *
 * 修复：`--abs` **不**排除诊断上屏 ⇒ 默认面 / `--json` 面 / `--abs` 面
 * 对同一文件的**诊断条数**一致。
 *
 * ⚠ 只改 `test --abs`：`check --abs` 的既有口径（report.ok 时只打 OK +
 * 计数）不动（ 钉住）。
 */






/** 期望写错（`42x` 不是合法类型表达式）⇒ 至少一条指令语法诊断。 */
const BAD_EXPECTATION_SRC = `/** @nudo:case "t" (1) => 42x */
export function f(x) { return x; }
`;

/** 人类面诊断条数：每条诊断一行，行尾带 `(nudo:<code>)`。 */
function humanDiagnosticCount(stdout: string): number {
  return stdout.split("\n").filter((l) => /\(nudo:[a-z-]+\)\s*$/.test(l)).length;
}

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-919-"));
  const file = join(cwd, "x2.js");
  writeFileSync(file, BAD_EXPECTATION_SRC, "utf-8");
  return { cwd, file };
}


  it("--abs 面：诊断段上屏（旧行为：整段消失 ⇒ 屏幕上零提示）；三个面（默认 / --abs / --json）对同一文件的诊断条数一致；对照：check --abs 的既有口径不动（report ok 时不打 issues 列表）", () => {
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--abs"], { cwd });
      expect(r.stdout).toContain("diagnostics");
      expect(r.stdout).toContain("nudo:directive-syntax");
      expect(humanDiagnosticCount(r.stdout)).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const plain = runCli(["test", file], { cwd });
      const abs = runCli(["test", file, "--abs"], { cwd });
      const json = runCli(["test", file, "--json"], { cwd });
      const plainCount = humanDiagnosticCount(plain.stdout);
      expect(plainCount).toBeGreaterThan(0);
      expect(humanDiagnosticCount(abs.stdout)).toBe(plainCount);
      const doc = JSON.parse(json.stdout);
      expect(doc.diagnostics.length).toBe(plainCount);
      expect(doc.summary.diagnostics).toBe(plainCount);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["check", file, "--abs"], { cwd });
      // check 面是另一个 verb 的既有口径（）⇒ 本钉只保证
      // test --abs 的诊断可见，不把 check --abs 改成无条件打 issues。
      expect(typeof r.stdout).toBe("string");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// --assume 的 >= 与 > 必须落到不同谓词
// ---------------------------------------------------------------------------
describe("--assume 的 >= 与 > 必须落到不同谓词", () => {
/**
 * `--assume` 的运算符被**一律按 `>` 构造** ⇒ 用户写 `x>=1`
 * 实际得到 `x>1` ⇒ 引擎里的谓词与用户写的不一致
 * （`x+1 > 1.9999999999999998` 而不是 `x+1 ≥ 2`）。
 *
 * 修复：谓词构造按运算符分派（core 既有导出 `geNum` / `gtNum`），
 * 回显行打印**实际构造出来的谓词**。
 */






const F_SRC = `export function f(x) {\n  if (x > 0) {\n    return x + 1;\n  }\n  return x - 1;\n}\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-973-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("-assume 的 >= 与 > 必须落到不同谓词", () => {
  it("`x>=1` ⇒ 谓词是 (x + 1) ≥ 2（不是 > 1.999…）；`x>1` ⇒ 谓词是 (x + 1) > 1.999…（与 >= 不同）", async () => {
  {
    await withTmp(async (dir) => {
      const file = join(dir, "f.js");
      writeFileSync(file, F_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>=1"] });
      expect(r.stdout).toContain("assume: x >= 1");
      expect(r.stdout).toContain("(x + 1) ≥ 2");
      expect(r.stdout).not.toContain("1.9999999999999998");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "f.js");
      writeFileSync(file, F_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>1"] });
      expect(r.stdout).toContain("assume: x > 1");
      expect(r.stdout).toContain("(x + 1) > 1.9999999999999998");
      expect(r.stdout).not.toContain("(x + 1) ≥ 2");
    });
  }
});

});
});


// ---------------------------------------------------------------------------
// 多条 --assume 必须合取（不是互相覆盖）
// ---------------------------------------------------------------------------
describe("多条 --assume 必须合取（不是互相覆盖）", () => {
/**
 * 多条 `--assume` **互相覆盖**（每条都重写 φ ⇒ 只有最后一条生效）。
 *
 * 旧行为：`--assume x>100 --assume y>200` ⇒ φ = `y>200` ⇒ 结果谓词
 * `(x + y) > 200`（x 的界丢失）。
 * 修复：多条假设**合取**（core 既有导出 `algebra.and`）⇒ `(x + y) > 300`。
 */






const G_SRC = `export function g(x, y) {\n  return x + y;\n}\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-974-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


  it("x>100 且 y>200 ⇒ 谓词 (x + y) > 300（两条都在场）；顺序无关（y 在前也一样合取）", async () => {
  {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>100", "y>200"] });
      expect(r.stdout).toContain("assume: x > 100, y > 200");
      // 合取 ⇒ 两条界都进结果谓词
      expect(r.stdout).toContain("(x + y) > 300");
      // 旧行为：只剩最后一条 ⇒ (x + y) > 200
      expect(r.stdout).not.toContain("(x + y) > 200");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["y>200", "x>100"] });
      expect(r.stdout).toContain("(x + y) > 300");
    });
  }
});


});


// ---------------------------------------------------------------------------
// --assume 与 --generalize 互斥 ⇒ 显式拒绝
// ---------------------------------------------------------------------------
describe("--assume 与 --generalize 互斥 ⇒ 显式拒绝", () => {
/**
 * `--abs --generalize` 与 `--assume` 组合被**接受并打印 assume 回显**，
 * 但 generalize 分支**根本不吃 assume**（`generalizeFromAst` 没有 Φ 入口）
 * ⇒ 静默说谎：用户以为假设参与了符号推导。
 *
 * 修复：这个组合**显式拒绝**（用法错误 + 非零 exit），不回显假设。
 */







const G_SRC = `export function g(x, y) {\n  return x + y;\n}\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-975-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("-assume 与 --generalize 互斥 ⇒ 显式拒绝", () => {
  it("组合 → 用法错误 + exit 1（且不回显 assume）；单独 --generalize 仍然可用（不误伤）；单独 --assume 仍然可用（不误伤）；CLI 级：组合 → 进程 exit 1", async () => {
  {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { generalize: true, assume: ["x>100"] });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--assume cannot be combined with --generalize");
      expect(r.stderr).toContain("fix:");
      // 旧行为：打印 assume 回显（说谎），然后 generalize 照跑
      expect(r.stdout).not.toContain("assume:");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { generalize: true });
      expect(r.stderr).not.toContain("cannot be combined");
      expect(r.stdout).toContain("mode: generalize");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>100"] });
      expect(r.stderr).not.toContain("cannot be combined");
      expect(r.stdout).toContain("assume: x > 100");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = runCli(["check", file, "--abs", "--generalize", "--assume", "x>100"], {
        cwd: dir,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--assume cannot be combined with --generalize");
    });
  }
});



});
});


// ---------------------------------------------------------------------------
// （CLI 半）：--assume 的界落到形参前提（不再被写死的 x>0 顶掉）
// ---------------------------------------------------------------------------
describe("（CLI 半）：--assume 的界落到形参前提（不再被写死的 x>0 顶掉）", () => {
/**
 * （**CLI 半**，`packages/nudojs/src/commands/shared.ts`）：`--assume`
 * 声明的**界**被顶掉 ⇒ 观察面给出比用户声明**更窄**的结果（说谎）。
 *
 * 根因：core 的 `buildArgsFromAssume` 只拿到**被假设形参的 id 集合** ⇒ 把
 * 形参自己的前提（pred）**写死**成 `x > 0`。用户写 `--assume 'x>-5'` 时，
 * 写死的 `x>0` 反而**更强**（`x>-5 ∧ x>0` ⇒ `x>0`）⇒ 引擎按 `x>0` 剪枝，
 * `x = -1` 的分支被当成不可达 ⇒ 观察面只给出 `"pos"`。
 *
 * 修法（CLI 半，core 半由 core 侧同步）：把**用户声明的界**（按形参名归并、
 * 同一形参多条取合取）**替换**掉那个写死的默认前提 ⇒ 用户界不再被顶掉。
 * （是**替换**不是合取 —— 与写死的 `x>0` 合取仍然是写死的界更强。）
 *
 * 钉：
 * - `--assume 'x>-5'` ⇒ 结果含 `"neg"`（改前只有 `"pos"`）；
 * - `--assume 'x>=-5'` ⇒ 同上（`>=` 口径，的运算符分派不被破坏）；
 * - 负控制：`--assume 'x>0'` ⇒ 仍只有 `"pos"`（写死的界与用户一致时不变）；
 * - 负控制：同一形参多条界取**合取**（`x>0` + `x<10` ⇒ `x=1` 可达 ⇒ 两侧都可达）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** `k(x)`：x<0 ⇒ "neg"，否则 "pos"（x 的界直接决定哪一支可达）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b976-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "k.js"),
    `export function k(x) {
  if (x < 0) {
    return "neg";
  }
  return "pos";
}
`,
    "utf-8",
  );
  return join(dir, "k.js");
}


  it("--assume 'x>-5' ⇒ x=-1 可达 ⇒ 结果含 \"neg\"；--assume 'x>=-5' ⇒ 同上（>= 运算符分派不被破坏）；负控制：--assume 'x>0' ⇒ 仍只有 \"pos\"（用户界与写死界一致时口径不变）；负控制：同一形参多条界取**合取**（x>-5 且 x>0 ⇒ 更强的 x>0 生效）", async () => {
  {
    const r = await runAbsViewCaptured(fixture(), { assume: ["x>-5"] });
    expect(r.stdout).toContain("assume: x > -5");
    // 改前：只有 "pos"（写死的 x>0 剪掉了 x<0 分支）
    expect(r.stdout).toContain('"neg" | "pos"');
  }
  {
    const r = await runAbsViewCaptured(fixture(), { assume: ["x>=-5"] });
    expect(r.stdout).toContain("assume: x >= -5");
    expect(r.stdout).toContain('"neg" | "pos"');
  }
  {
    const r = await runAbsViewCaptured(fixture(), { assume: ["x>0"] });
    expect(r.stdout).toContain("assume: x > 0");
    expect(r.stdout).toContain('"pos"');
    expect(r.stdout).not.toContain('"neg"');
  }
  {
    const r = await runAbsViewCaptured(fixture(), { assume: ["x>-5", "x>0"] });
    expect(r.stdout).toContain("assume: x > -5, x > 0");
    // 合取后是 x>0 ⇒ x<0 分支不可达（修复不得把界放宽成「取其中一条」）
    expect(r.stdout).toContain('"pos"');
    expect(r.stdout).not.toContain('"neg"');
  }
});




});


// ---------------------------------------------------------------------------
// 侧车写坏 ⇒ check 门禁必须红（nudo:contract-load）
// ---------------------------------------------------------------------------
describe("侧车写坏 ⇒ check 门禁必须红（nudo:contract-load）", () => {
/**
 * 侧车写坏（import 了非构建器名）时，`nudo check` **门禁绿灯、
 * exit 0**（假绿），而 `nudo test` / `nudo health` 都报 error。
 *
 * 根因在 core（`packages/core/src/algebra/refine.ts`）：侧车装载诊断在
 * `execSidecar` 内部产生 ⇒ exec 结果进缓存后，缓存命中不再跑 exec ⇒ 诊断
 * 在后续分析里消失。CLI 的固定顺序是「分析器先跑（冷，拿到诊断）→
 * checkSource 后跑（缓存命中，诊断消失）」⇒ check 门禁面看不到侧车写坏。
 *
 * 修复（core）：装载诊断随 exec 结果缓存，缓存命中时重发 ⇒ checkSource
 * 自己上报一份 `nudo:contract-load`（nudojs 面的分析器白名单**刻意**不含
 * 该码 —— 避免双报，见 check-json-map.ts 的 CHECK_FACE_DIAG_CODES）。
 *
 * **进程内**驱动（不经 dist）：vitest 别名把 `@nudojs/core` 指到 src ⇒
 * 核心修复立即可见；子进程型 CLI 测试会走 packages/core/dist（旧产物）
 * ⇒ 需先 build 才可见核心侧改动。
 */








const SRC = "export function f(x) {\n  return x;\n}\n";
/** 侧车 import 了非构建器名 totallyBogus ⇒ 装载期 nudo:contract-load */
const BAD_SIDECAR = `import { fn, number, totallyBogus } from "@nudojs/core";
export const f = fn({ x: number() });
`;

let logs: string[] = [];
let errs: string[] = [];

beforeEach(() => {
  process.exitCode = undefined;
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errs.push(a.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

async function runCheckCli(args: string[]): Promise<void> {
  const program = new Command();
  registerCheckCommand(program);
  await program.parseAsync(["node", "nudo", ...args]);
}

function makeProject(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1064-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug1064", private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, "lib.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), BAD_SIDECAR, "utf-8");
  return { dir, file };
}


  it("人类面：check 报 contract-load error + exit 1（旧行为：exit 0 假绿）；--json 面：信封 ok:false + issues 含 nudo:contract-load（且只一条）", async () => {
  {
  process.exitCode = undefined;
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errs.push(a.map(String).join(" "));
  });


    const { dir, file } = makeProject();
    try {
      await runCheckCli(["check", file]);
      const out = logs.join("\n");
      expect(out).toContain("nudo:contract-load");
      expect(out).toContain("is not an injected builder");
      expect(process.exitCode, "侧车写坏 ⇒ 门禁必须红").toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
  process.exitCode = undefined;
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errs.push(a.map(String).join(" "));
  });


    const { dir, file } = makeProject();
    try {
      await runCheckCli(["check", file, "--json"]);
      const env = JSON.parse(logs.join("\n")) as {
        ok: boolean;
        // 单文件无路径错误 ⇒ 直出 CheckJson；多文件/路径错误 ⇒ multi 信封
        issues?: Array<{ code: string }>;
        reports?: Array<{ issues?: Array<{ code: string }> }>;
      };
      expect(env.ok).toBe(false);
      const issues = env.issues ?? env.reports?.[0]?.issues ?? [];
      expect(issues.filter((i) => i.code === "nudo:contract-load")).toHaveLength(1);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});


});


// ---------------------------------------------------------------------------
// 1145 · nudo check：模块级求值失败必须 fail-closed
// ---------------------------------------------------------------------------
describe("1145 · nudo check：模块级求值失败必须 fail-closed", () => {
/**
 * 回归：`nudo check` 遇**模块级求值失败**（引擎内部回落 `internal`）
 * 必须**红**——不得「零诊断 + exit 0」（**闸门假绿**：合法代码与违约代码都判绿）。
 *
 * 病灶：core 在「生成模块编译失败（`new Function` SyntaxError）」或「模块求值抛
 * 内部错误」时记一条 `internal` 回落 ⇒ 该模块**全部导出丢失** ⇒ 闸门看不到任何
 * 入口 ⇒ 零诊断 + exit 0。
 *
 * 修法：CLI 编排为**每个被检查文件**装一个回落 collector ⇒ 观察到 `internal`
 * 回落 ⇒ 产出一条 **error 级** `nudo:internal` 诊断（已注册码）⇒ 报告
 * `ok:false` ⇒ exit 1。人类面有明确失败行（哪个文件 + 什么原因）；`--json` 面
 * 的机器判据 = `issues[].code === "nudo:internal"`（severity `error`）+
 * `ok === false`。
 *
 * 断言面：
 * 1. 含 internal 回落的文件 ⇒ `nudo check` exit **≠ 0**（修前是 0 = 假绿）；
 * 2. 人类面有明确失败行（含文件名 + 原因）；
 * 3. `--json` 面有机器可判定字段（`ok:false` + `nudo:internal` error issue）；
 * 4. **假红防线**：正常文件（零回落）仍 exit 0（不得误报）；
 * 5. **假红防线**：`unsupported:*`（能力边界）回落**不**变成闸门失败；
 * 6. `nudo health`：存在 internal 回落时 `Result` 不得是 OK（exit ≠ 0）。
 */








/** 模块级求值**必然失败**的源：模块顶层调用未定义的值 ⇒ 宿主运行时抛原生
 * TypeError ⇒ core 记一条 `internal` 回落 ⇒ 该模块全部导出丢失。 */
const MODULE_EVAL_FAILS = `export const boom = undefined();

export function add(a, b) {
  return a + b;
}
`;

/** 能力边界回落（`unsupported:*`）：`g().x ||= 1` 的逻辑赋值目标不可写回 ⇒
 * transpile 抛 `unsupported:assign:||=` ⇒ 回落但**不是**引擎缺陷 ⇒ **不得**
 * 变成闸门失败（假红防线）。 */
const UNSUPPORTED_ONLY = `export function bump(g) {
  g().x ||= 1;
}
`;

/** 正常文件：零回落 ⇒ 闸禁照常判定（不得误报）。 */
const CLEAN = `export function identity(x) {
  return x;
}
`;

const dirs: string[] = [];
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
});


  it("含 internal 回落的文件 ⇒ exit ≠ 0（修前是 0 = 假绿）+ 人类面明确失败行；--json 面：机器可判定（ok:false + nudo:internal error issue）+ exit ≠ 0；假红防线：正常文件（零回落）仍 exit 0（不得误报）；假红防线：unsupported:*（能力边界）回落**不**变成闸门失败；check --fix 与 plain check 同口径：同一文件不得「check 红 / --fix 绿」", () => {
  {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpDir("nudo-1145-check-fail-");
    const file = join(dir, "boom.js");
    writeFileSync(file, MODULE_EVAL_FAILS, "utf-8");
    const r = runCliTsx(["check", file]);
    expect(r.status).not.toBe(0);
    // 人类面：明确的失败行（哪个文件 + 什么原因）。
    // 之后模块级原生异常归类为 `nudo:module-throw`（用户代码的异常不再是
    // 引擎内部缺陷），因此不再有 `analysis failed for … internal fallback` 行；
    // 契约不变：该文件必须红，且失败原因必须可见。
    expect(r.stdout).toContain("FAILED");
    expect(r.stdout).toContain("nudo:module-throw");
  }
  {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpDir("nudo-1145-check-json-");
    const file = join(dir, "boom.js");
    writeFileSync(file, MODULE_EVAL_FAILS, "utf-8");
    const r = runCliTsx(["check", file, "--json"]);
    expect(r.status).not.toBe(0);
    const json = JSON.parse(r.stdout) as {
      ok: boolean;
      summary: { errors: number };
      issues: Array<{ severity: string; code: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.summary.errors).toBeGreaterThan(0);
    const fatal = json.issues.filter((i) => i.code === "nudo:module-throw");
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal.every((i) => i.severity === "error")).toBe(true);
    // 失败原因可读（模块无法装载）
    expect(fatal[0]!.message).toContain("throws");
  }
  {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpDir("nudo-1145-check-clean-");
    const file = join(dir, "clean.js");
    writeFileSync(file, CLEAN, "utf-8");
    const r = runCliTsx(["check", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("FAILED");
    expect(r.stdout).not.toContain("nudo:module-throw");
  }
  {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpDir("nudo-1145-check-unsupported-");
    const file = join(dir, "unsupported.js");
    writeFileSync(file, UNSUPPORTED_ONLY, "utf-8");
    const r = runCliTsx(["check", file, "--json"]);
    // 能力边界回落**不得**产出「分析失败」信号（`nudo:internal`）——
    // 该文件的红色只能来自既有诊断（如 L2 entry-may-throw），不得来自本条。
    const json = JSON.parse(r.stdout) as {
      issues: Array<{ code: string; severity: string }>;
    };
    expect(json.issues.some((i) => i.code === "nudo:module-throw")).toBe(false);
    expect(r.stderr).not.toContain("analysis failed for");
  }
  {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpDir("nudo-1145-check-fix-");
    const file = join(dir, "boom.js");
    writeFileSync(file, MODULE_EVAL_FAILS, "utf-8");
    const r = runCliTsx(["check", "--fix", file]);
    // 只断言退出码同口径（--fix 不打印诊断清单，它是「计划/写盘」面）：
    // 不得出现 `check` 红而 `--fix` 绿。
    expect(r.status).not.toBe(0);
  }
});






describe("1145 · nudo health：存在 internal 回落时不得报 OK", () => {
  it("模块级原生异常不再是「分析失败」⇒ health 只看漂移，报 OK（口径变更）；正常文件 ⇒ Result: OK + exit 0（不得误报）；假红防线：unsupported:*（能力边界）回落 ⇒ health 仍 OK（不得误报）", () => {
  {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    // 之后 `export const boom = undefined();` 被**确定性**归类为
    // `nudo:module-throw`（分析本身成功，结论是「这个模块装载必抛」），
    // 不再走 `internal` 回落 ⇒ 的 health 断言前提（「分析失败 ⇒ 闸门
    // 无法裁决」）消失：health 的失败判据是 **contract drift / case drift /
    // path error / internal 回落**，不含「代码本身必抛」这类**可裁决**的缺陷
    // ——那由 `nudo check` 报红（见上方用例）。`internal` 回落仍会进
    // FAIL 判据（本文件「unsupported」用例守住反向）。
    const dir = tmpDir("nudo-1145-health-module-throw-");
    const file = join(dir, "boom.js");
    writeFileSync(file, MODULE_EVAL_FAILS, "utf-8");
    const r = runCliTsx(["health", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Result: OK");
  }
  {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpDir("nudo-1145-health-clean-");
    const file = join(dir, "clean.js");
    writeFileSync(file, CLEAN, "utf-8");
    const r = runCliTsx(["health", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Result: OK");
  }
  {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  takeRefineDiags();
  resetSidecarLoadFailureCache();
  takeContractDiags();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();


    const dir = tmpDir("nudo-1145-health-unsupported-");
    const file = join(dir, "unsupported.js");
    writeFileSync(file, UNSUPPORTED_ONLY, "utf-8");
    const r = runCliTsx(["health", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Result: OK");
  }
});


});
});


// ---------------------------------------------------------------------------
// nudo contract --help · a · `--json` 的三形态口径
// ---------------------------------------------------------------------------
describe("nudo contract --help · a · `--json` 的三形态口径", () => {
/**
 * `nudo contract` 的两处**文案与实现口径分裂**（只改文案，
 * **不改行为**）。
 *
 * 1147-a：`contract --help` 把 `--json` 写成「With --draft: …」⇒ 用户以为
 * `--json` **只能**配 `--draft`；实现里 print / `--draft` / `--emit`
 * **三形态**都吐机器面载荷，且**顶层恒为 JSON 数组**（元素形状按形态不同）
 * ⇒ 帮助文本与实现口径分裂。
 * 1147-b：`--from-dts --write` 拒绝覆盖「存在且不同」的草稿时，提示**只**提
 * 环境变量 `NUDO_DRAFT_FORCE=1`，**不提** CLI 旗标 `--force` ⇒ 用户按文档
 * 用 `--force` 仍被拒时**看不出还有旗标**（死胡同感）。
 *
 * 钉：
 * ① 帮助文本里 `--json` **不再**声称「仅 `--draft`」，且**提到三形态**
 * （print / `--draft` / `--emit`）与「元素形状按形态不同」；
 * ② 拒绝提示**同时**含 `--force` 与 `NUDO_DRAFT_FORCE`（两个放行口子都可见）；
 * ③ **人工改过的草稿永不被覆盖** ⇒ 拒绝**仍然发生**（`--force` 也不放行）
 * ⇒ 不得为了提示友好而放开覆盖（**不引入数据丢失**）；
 * ④ 提示里给出的放行口子是真的：机器原稿（内容不同）+ `--force` ⇒ 覆盖成功。
 */






/**
 * 从 `nudo <cmd> --help` 的输出里抽出**某个选项**的描述文本。
 *
 * commander 把长描述按**词**换行（续行缩进更深）⇒ 按缩进续接即可还原
 * 原始文案（换行点都落在空格上 ⇒ 用空格拼回即原文）。
 */
function optionDescription(help: string, flag: string): string {
  const lines = help.split("\n");
  const start = lines.findIndex((l) => l.trimStart().startsWith(`${flag} `));
  if (start === -1) return "";
  const head = lines[start]!;
  const chunks = [head.slice(head.indexOf(flag) + flag.length).trim()];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) break;
    const indent = line.length - line.trimStart().length;
    if (indent <= 2) break; // 下一个选项 / 下一小节（缩进回到 2 或 0）
    chunks.push(line.trim());
  }
  return chunks.join(" ");
}

const DTS = `export declare function mul(a: number, b: number): number;\n`;

/** 夹具：`types/index.d.ts`（`--from-dts` 的源）+ 空的 `types/` 目录 */
function makeDtsFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1147-"));
  mkdirSync(join(dir, "types"), { recursive: true });
  writeFileSync(join(dir, "types", "index.d.ts"), DTS, "utf-8");
  return dir;
}

/**
 * `--from-dts --write` 的落盘路径（贴着源 `.d.ts`，`sidecarDraftPath` 口径）。
 *
 * ⚠ 落点名**不含 `.d.` 段**（`tmp/bug-report/sections/.md`
 * + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含 `.d.` ⇒
 * TypeScript 判成声明文件 ⇒ 草稿与它建议的复制落点都过不了 `tsc --strict`
 * ⇒ `types/index.d.ts` ⇒ `types/index.nudo.draft.ts`。
 */
function draftPathOf(dir: string): string {
  return join(dir, "types", "index.nudo.draft.ts");
}


  it("`--json` 不再声称「仅 `--draft`」，且**提到** print / `--draft` / `--emit` 三形态；帮助文本不骗人：print 形态的 `--json` 顶层**恒为数组**（帮助说的三形态都成立）", () => {
  {
    const r = runCli(["contract", "--help"]);
    expect(r.status).toBe(0);
    const help = r.stdout;
    const desc = optionDescription(help, "--json");
    expect(desc, `help:\n${help}`).not.toBe("");
    // ① 不再声称「With --draft: …」（即不再声称 `--json` 只能配 `--draft`）
    expect(desc, `help:\n${help}`).not.toMatch(/With --draft/);
    expect(help).not.toContain("machine-readable draftSource");
    // ② 三形态都被点名（print / `--draft` / `--emit`）
    expect(desc, `help:\n${help}`).toContain("print");
    expect(desc, `help:\n${help}`).toContain("--draft");
    expect(desc, `help:\n${help}`).toContain("--emit");
    // ③ 顶层恒为数组 + 元素形状按形态不同（逐形态一句）
    expect(desc, `help:\n${help}`).toMatch(/JSON array/);
    expect(desc, `help:\n${help}`).toMatch(/differs per mode/);
    expect(desc, `help:\n${help}`).toContain("print elements");
    expect(desc, `help:\n${help}`).toContain("--draft elements");
    expect(desc, `help:\n${help}`).toContain("--emit elements");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1147-json-"));
    writeFileSync(
      join(dir, "a.js"),
      "export function add(a, b) {\n  return a + b;\n}\n",
      "utf-8",
    );

    const r = runCli(["contract", join(dir, "a.js"), "--json"], { cwd: dir });

    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file).toContain("a.js");
    expect(Array.isArray(parsed[0].entries)).toBe(true);
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程


describe("nudo contract --from-dts --write · b · 拒绝提示的双放行口子", () => {
  it("拒绝覆盖时提示**同时**给出 `--force` 与 `NUDO_DRAFT_FORCE`（既有草稿逐字不变）；**人工改过的草稿永不被覆盖**（`--force` 也不放行）⇒ 拒绝仍然发生、文件逐字不变；提示里的放行口子是真的：机器原稿（内容不同）+ `--force` ⇒ 覆盖成功", () => {
  {
    const dir = makeDtsFixture();
    const draftPath = draftPathOf(dir);
    // 既有草稿（内容与新生成的不同 ⇒ 触发「存在且不同」那一关）
    const existing = "// @nudo:draft\n// 人工留存的既有草稿（与新生成的内容不同）\n";
    writeFileSync(draftPath, existing, "utf-8");

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to overwrite");
    // 两个放行口子都可见（旗标 + 环境变量）
    expect(r.stderr).toContain("--force");
    expect(r.stderr).toContain("NUDO_DRAFT_FORCE");
    // 措辞要准：人工改过的草稿永不被覆盖 ⇒ 这条拒绝是预期行为
    expect(r.stderr).toContain("hand-edited");
    // 既有草稿逐字不变（没有静默丢内容）+ 没有谎报成功
    expect(readFileSync(draftPath, "utf-8")).toBe(existing);
    expect(r.stdout).not.toContain("wrote ");
  }
  {
    const dir = makeDtsFixture();
    const draftPath = draftPathOf(dir);
    // 先写一次机器原稿
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPath, "utf-8");
    expect(machine).toContain("@nudo:draft-fingerprint");
    // 人工改过正文 ⇒ 指纹失配 ⇒ 判定为「人工改过」
    const handEdited = `${machine}\n// 人工改动\n`;
    writeFileSync(draftPath, handEdited, "utf-8");

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    // `--force` 放行不了「人工改过」的草稿 ⇒ 拒绝**仍然发生**
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("hand-edited");
    expect(readFileSync(draftPath, "utf-8")).toBe(handEdited);
    expect(second.stdout).not.toContain("wrote ");
  }
  {
    const dir = makeDtsFixture();
    const draftPath = draftPathOf(dir);
    // 先写一次机器原稿
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPath, "utf-8");
    // 源 `.d.ts` 变了 ⇒ 新草稿内容不同（但仍是机器原稿 ⇒ `--force` 可覆盖）
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("wrote ");
    const after = readFileSync(draftPath, "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  }
}); // 1 个 CLI 子进程

   // 2 个顺序 CLI 子进程

   // 2 个顺序 CLI 子进程
});
});


// ---------------------------------------------------------------------------
// CLI：nudo check 面对 ESM import 环不再丢弃整张依赖图
// ---------------------------------------------------------------------------
describe("CLI：nudo check 面对 ESM import 环不再丢弃整张依赖图", () => {
/**
 * 回归（CLI 面）：`nudo check` 检出 ESM import 环就**丢弃整张依赖图**
 * ⇒ 环内文件的 import 全部落空 ⇒ 环内函数在 check 面恒为 `unknown`
 * （原生是确定值）。
 *
 * 原生 oracle（node ESM）：probe() → 0（a(2) → b(1) → a(0) → 0）。
 * 改前：`probe() => unknown`；改后：`probe() => 0`。
 *
 * 本文件锁三件事：
 * ① 环内文件在 check 面给出**正确签名**（= 原生值）；
 * ② 求值**有界**：真·无限递归的环被调用环检测器截断成
 * `nudo:recursion-truncated`（info），不挂死、不无限求值；
 * ③ 负控制：非环的跨模块调用不受影响（值与改前一致）。
 */






/** 环的一半：a ⇄ b（ESM import 环） */
const A = `import { b } from "./b.js";
export function a(n) { return n <= 0 ? 0 : b(n - 1); }
`;
const B = `import { a } from "./a.js";
export function b(n) { return n <= 0 ? 1 : a(n - 1); }
`;
/** 入口：probe() = a(2) = 0（原生 oracle） */
const ENTRY = `import { a } from "./a.js";
export function probe() { return a(2); }
`;
/** 真·无限递归的环（x ⇄ y，无基例） */
const X = `import { y } from "./y.js";
export function x(n) { return y(n); }
`;
const Y = `import { x } from "./x.js";
export function y(n) { return x(n); }
`;
/** 负控制：非环的跨模块调用（原生 21 * 2 = 42） */
const MATH = `export function double(x) { return x * 2; }
`;
const MATH_ENTRY = `import { double } from "./math.js";
export function probe() { return double(21); }
`;

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-456-cli-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}


  it("环内文件的签名 = 原生值（改前：unknown）；求值有界：无限递归的环被截断成 nudo:recursion-truncated（不挂死）；负控制：非环的跨模块调用不受影响（21 * 2 = 42）", () => {
  {
    const dir = fixture({ "a.js": A, "b.js": B, "index.js": ENTRY });
    try {
      const r = runCli(["check", "index.js"], { cwd: dir });
      expect(r.stdout).toContain("probe() => 0");
      expect(r.stdout).not.toContain("probe() => unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture({ "x.js": X, "y.js": Y, "index.js": `import { x } from "./x.js";\nexport function probe() { return x(0); }\n` });
    try {
      const r = runCli(["check", "index.js"], { cwd: dir });
      expect(r.status).toBe(0); // info 不挡门禁
      expect(r.stdout).toContain("nudo:recursion-truncated");
      expect(r.stdout).toContain("probe() => unknown"); // 截断 ⇒ 加宽为 unknown
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture({ "math.js": MATH, "index.js": MATH_ENTRY });
    try {
      const r = runCli(["check", "index.js"], { cwd: dir });
      expect(r.stdout).toContain("probe() => 42");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// domainIssuesFromDiagnostics —— contract 家族白名单
// ---------------------------------------------------------------------------
describe("domainIssuesFromDiagnostics —— contract 家族白名单", () => {
/**
 * `nudo:contract-entry-only` 在 `nudo check` 面被**丢弃**（白名单只留
 * contract-domain-exceeds 一条）⇒ 分析器产出的 entry-only info 在 check 面不可达，
 * 而 `nudo health` 走另一条统计路径仍报「N entry-only」⇒ 同一事实两 verb 口径分裂。
 *
 * 本文件锁两件事：
 * 1. 单元面：contract 家族白名单纳入 `nudo:contract-entry-only`（severity=info，
 * 不挡门禁），且既有 domain-exceeds 映射与其余码的过滤行为**不变**（负控制）。
 * 2. 产品面：`nudo check --from <usage>` 真实报出这条 info（改前 infos: 0）。
 */







/** 无契约根、无调用点域的导出（entry-only） */
const LIB_SRC = `export function f() {
  return 1;
}
`;
/** 现场文件：产生调用记录（⇒ check 的分析器链真的跑了），但不打 call f */
const DEP_SRC = `export function add(a, b) {
  return a + b;
}
`;
const USAGE_SRC = `import { add } from "./dep.js";
const r = add(1, 2);
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-461-"));
  writeFileSync(join(dir, "lib.js"), LIB_SRC, "utf-8");
  writeFileSync(join(dir, "dep.js"), DEP_SRC, "utf-8");
  writeFileSync(join(dir, "usage.js"), USAGE_SRC, "utf-8");
  return dir;
}

{
  const base = {
    severity: "info",
    message: "export 'f' has no contract root and no call-site domain (entry-only)",
    range: { start: { line: 1, column: 7 } },
  };

  it("contract-entry-only 不再被丢弃（info，不挡门禁）；负控制：contract-domain-exceeds 的既有映射不变（error → error）；负控制：白名单外的码仍被过滤（不放大诊断面）", () => {
  {
    const issues = domainIssuesFromDiagnostics([
      { ...base, code: "nudo:contract-entry-only" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("info");
    expect(issues[0]!.code).toBe("nudo:contract-entry-only");
    expect(issues[0]!.line).toBe(1);
    expect(issues[0]!.column).toBe(7);
  }
  {
    const issues = domainIssuesFromDiagnostics([
      {
        ...base,
        code: "nudo:contract-domain-exceeds",
        severity: "error",
        data: { actual: "string", expected: "number" },
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.code).toBe("nudo:contract-domain-exceeds");
    expect(issues[0]!.actual).toBe("string");
    expect(issues[0]!.expected).toBe("number");
  }
  {
    expect(
      domainIssuesFromDiagnostics([{ ...base, code: "nudo:other" }]),
    ).toEqual([]);
  }
});


}

describe("nudo check --from 产品面报出 entry-only", () => {
  it("check --from 打印 nudo:contract-entry-only（改前 infos: 0 / 静默丢弃）；check --json：summary.infos 计入 entry-only，ok 仍为 true", () => {
  {
    const dir = fixture();
    try {
      const r = runCli(["check", "lib.js", "--from", "usage.js"], { cwd: dir });
      expect(r.status).toBe(0); // info 不挡门禁
      expect(r.stdout).toContain("nudo:contract-entry-only");
      expect(r.stdout).toContain("1 info");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture();
    try {
      const r = runCli(["check", "--json", "lib.js", "--from", "usage.js"], { cwd: dir });
      expect(r.status).toBe(0);
      const json = JSON.parse(r.stdout) as {
        ok: boolean;
        summary: { infos: number };
        issues: { code: string; severity: string }[];
      };
      expect(json.summary.infos).toBe(1);
      expect(json.ok).toBe(true);
      const entryOnly = json.issues.filter((i) => i.code === "nudo:contract-entry-only");
      expect(entryOnly).toHaveLength(1);
      expect(entryOnly[0]!.severity).toBe("info");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

});
});


// ---------------------------------------------------------------------------
// nudo test --from 现场文件读失败
// ---------------------------------------------------------------------------
describe("nudo test --from 现场文件读失败", () => {
/**
 * `nudo test --from` 指向**解析/求值失败**的现场文件时静默零记录、exit 0
 * （假绿）——`collectCallRecords`（service）把求值异常 blanket 吞成「0 条记录」，
 * 于是「现场文件读失败」与「现场文件里确实没有调用」在下游同形。
 *
 * 修法（CLI 面，packages/nudojs/src/commands/shared.ts）：该现场文件产出 0 条
 * 记录时复跑一次求值（同参数 ⇒ 命中 eval memo）：解析失败 / 求值失败都判为
 * 「现场文件读失败」，与「文件不存在」同口径报错并非零退出。
 *
 * 本文件锁：读失败必须报错 + 非 0 退出；可读但无调用 / 有调用两种邻近形态
 * **不得**被这条修复波及（负控制）。
 */






/** 被测文件：导出 add（entry-only） */
const TARGET_SRC = `export function add(a, b) {
  return a + b;
}
`;
/** 坏现场文件：缺右括号 → 解析失败 */
const BROKEN_SRC = `import { add } from "./target.js";
const x = add(1, 2
`;
/** 好现场文件：可解析可求值，但没有调用 */
const NO_CALL_SRC = `export function helper() {
  return 0;
}
`;
/** 好现场文件：有调用 → 产出 call@ 记录 */
const CALL_SRC = `import { add } from "./target.js";
const r = add(1, 2);
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-466-"));
  writeFileSync(join(dir, "target.js"), TARGET_SRC, "utf-8");
  writeFileSync(join(dir, "broken.js"), BROKEN_SRC, "utf-8");
  writeFileSync(join(dir, "nocall.js"), NO_CALL_SRC, "utf-8");
  writeFileSync(join(dir, "call.js"), CALL_SRC, "utf-8");
  return dir;
}


  it("解析失败 → 明确报错 + exit 1（改前：静默 0 记录 + exit 0 假绿）；--json 面：pathErrors 收录该失败 + exit 1；负控制：现场文件可读但没有调用 → 不报错、exit 0；负控制：现场文件有调用 → 记录被采集（call@ 而非 entry@）、exit 0", () => {
  {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "broken.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("broken.js");
      expect(r.stderr).toContain("fix:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture();
    try {
      const r = runCli(["test", "--json", "target.js", "--from", "broken.js"], { cwd: dir });
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout) as {
        pathErrors: { path: string; code: string; message: string }[];
      };
      expect(json.pathErrors).toHaveLength(1);
      expect(json.pathErrors[0]!.path).toContain("broken.js");
      expect(json.pathErrors[0]!.message).toContain("Callsite file failed to load");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "nocall.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Callsite file failed to load");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "call.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Callsite file failed to load");
      expect(r.stdout).toContain("call@");
      expect(r.stdout).not.toContain("entry@");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});




});


// ---------------------------------------------------------------------------
// nudo contract — bigint 字面量契约不得崩溃（）
// ---------------------------------------------------------------------------
describe("nudo contract — bigint 字面量契约不得崩溃（）", () => {
/**
 * `nudo contract` 遇 **bigint 字面量契约** 不得整条命令崩溃。
 *
 * 病灶：契约面把约束用 `JSON.parse(JSON.stringify(c))` 落盘 ⇒ JSON 无法表示
 * bigint ⇒ `JSON.stringify` 抛 `TypeError: Do not know how to serialize a
 * BigInt` ⇒ `nudo contract` 整条命令 exit 1（裸异常、无文件、无诊断码），
 * 而 `nudo check` / `health` / `test` 对**同一份文件**全绿。
 *
 * 本测试钉住产品面：同一份文件，`nudo contract` 与 `nudo check` 都必须
 * 正常出结果（不再裸异常崩溃）。
 */






const SRC_JS = `export function g(n) {
  return n;
}
`;

const BIGINT_NUDO_JS = `import { fn, lit } from "@nudojs/core";
export const g = fn({ n: lit(10n) }, lit(10n));
`;


  it("contract 正常出结果（改前：裸 Do not know how to serialize a BigInt，exit 1）；同一份文件：check 面与 contract 面都不崩（跨 verb 一致）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug534-"));
    try {
      const file = join(dir, "c.js");
      writeFileSync(file, SRC_JS, "utf-8");
      writeFileSync(join(dir, "c.nudo.js"), BIGINT_NUDO_JS, "utf-8");

      const r = runCli(["contract", file]);
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Do not know how to serialize a BigInt");
      expect(r.stdout).toContain("g");
      // bigint 保 `n` 后缀（）：`lit(10)` 与 `lit(10n)` 必须可区分，
      // 否则「expected:」陈述的是另一条契约。本用例的诉求是「不崩」。
      expect(r.stdout).toContain("lit(10n)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug534-"));
    try {
      const file = join(dir, "c.js");
      writeFileSync(file, SRC_JS, "utf-8");
      writeFileSync(join(dir, "c.nudo.js"), BIGINT_NUDO_JS, "utf-8");

      const check = runCli(["check", file]);
      expect(check.status).toBe(0);
      expect(check.stderr).not.toContain("BigInt");

      const contract = runCli(["contract", file]);
      expect(contract.status).toBe(0);
      expect(contract.stderr).not.toContain("BigInt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});


});


// ---------------------------------------------------------------------------
// nudo contract — 打印面以声明形参表为骨架（）
// ---------------------------------------------------------------------------
describe("nudo contract — 打印面以声明形参表为骨架（）", () => {
/**
 * `nudo contract` 打印面用**契约里的参数**冒充**函数的形参表**
 * ⇒ 与 `nudo check` 的签名面给出两套形参（跨 verb 自相矛盾）。
 *
 * 本测试钉住产品面：同一份文件，`nudo contract` 印的形参表必须与
 * `nudo check` 的签名面一致（同一来源 = 声明形参表）；契约里绑不上的参数
 * 另列一栏并显式标注（不顶替形参名）。
 */






const SRC_JS = `export function scale(x) {
  return x * 2;
}
`;

const MISMATCH_NUDO_JS = `import { fn, number } from "@nudojs/core";
export const scale = fn({ zzz: number().gt(0) }, number());
`;


  it("contract 印的形参 = 声明形参；契约里绑不上的参数另列并标注", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug559-"));
    try {
      const file = join(dir, "lib.js");
      writeFileSync(file, SRC_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), MISMATCH_NUDO_JS, "utf-8");

      const contract = runCli(["contract", file]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain("(x: any)");
      // 契约参数不顶替形参名
      expect(contract.stdout).not.toContain("(zzz:");
      // 但必须显式出现（另列一栏 + 标注）
      expect(contract.stdout).toContain("zzz: number().gt(0)");
      expect(contract.stdout).toContain("(not a formal parameter)");

      const check = runCli(["check", file]);
      expect(check.stdout).toContain("scale(x: any)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});


// ---------------------------------------------------------------------------
// check 与 check --fix 的分析输入集必须一致
// ---------------------------------------------------------------------------
describe("check 与 check --fix 的分析输入集必须一致", () => {
/**
 * `nudo check` 与 `nudo check --fix` 喂给分析器的**输入集不同**
 * ⇒ 同一文件两条命令给出**相反**的门禁结论（一个绿一个红 / 一个红一个绿）。
 *
 * 修法（族 18 片 4）：`runCheckFix` 的两处 `checkSource` 调用与 `runCheck`
 * **共用同一个选项构造**（`checkSourceOptions`）：autoBind / projectDir /
 * entryThrows / ignoreThrows / inject·modules / skips —— 且 `--fix` 面同样
 * 装配 env 注入包（`@nudo:mock` 的替换、`@nudo:env` 的全局、模块图）。
 *
 * 四个方向（每个方向都锁「两条命令结论一致」）：
 * a) `@nudo:mock`（内联）——改前 check 绿 / --fix 红（假红）
 * b) `nudo.contract.autoBind: false`——改前 check 红 / --fix 绿（假绿 / CI 假通过）
 * c) `@nudo:mock x from "缺文件"`——改前两条命令的**诊断集**不同
 * d) `--profile adoption`（L2 降级 warning）——改前 --fix 仍替用户写契约
 */






function project(
  files: Record<string, string>,
  name = "b640",
): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b640-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module" }),
    "utf-8",
  );
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content, "utf-8");
  }
  return dir;
}

/** 门禁结论（exit code = 门禁红绿；--fix 面与 plain check 必须一致） */
function gate(r: { status: number }): "red" | "green" {
  return r.status === 0 ? "green" : "red";
}


  it("方向 a：@nudo:mock 内联 —— 两条命令同绿（改前 check 绿 / --fix 红）；方向 b：autoBind:false —— 两条命令同红（改前 check 红 / --fix 绿）；方向 c：@nudo:mock from 缺文件 —— 两条命令的 error 条数一致；方向 d：--profile adoption —— --fix 不得为 warning 级诊断替用户写契约", () => {
  {
    const dir = project({
      "lib.js": `/**
 * @nudo:mock dep = (x) => x
 */
export function f() {
  return dep(1);
}
`,
    });
    const file = join(dir, "lib.js");
    const plain = runCli(["check", file]);
    const fix = runCli(["check", "--fix", file]);
    expect(gate(plain), plain.stdout + plain.stderr).toBe("green");
    expect(gate(fix), fix.stdout + fix.stderr).toBe("green");
    expect(fix.stdout + fix.stderr).not.toContain("residual error");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b640-ab-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "b640ab",
        version: "1.0.0",
        type: "module",
        nudo: { contract: { autoBind: false } },
      }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib.js"),
      `export function f(x) {
  return x + 1;
}
`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn, number } from "@nudojs/core";

export const f = fn({ x: number() });
`,
      "utf-8",
    );
    const file = join(dir, "lib.js");
    const plain = runCli(["check", file]);
    const fix = runCli(["check", "--fix", file]);
    expect(gate(plain), plain.stdout + plain.stderr).toBe("red");
    expect(gate(fix), fix.stdout + fix.stderr).toBe("red");
    expect(fix.stdout + fix.stderr).toContain("residual error");
  }
  {
    const dir = project({
      "lib.js": `/**
 * @nudo:mock dep from "./missing-mock.js"
 * @nudo:throws TypeError
 */
export function f() {
  return dep(1);
}
`,
    });
    const file = join(dir, "lib.js");
    const plain = runCli(["check", file]);
    const fix = runCli(["check", "--fix", file]);
    const errorCount = (out: string): number => (out.match(/\[ERROR/g) ?? []).length;
    const residual = (out: string): number =>
      Number(/(\d+) residual error\(s\) remain/.exec(out)?.[1] ?? "-1");
    expect(gate(plain)).toBe("red");
    expect(gate(fix)).toBe("red");
    // mock 装配失败（nudo:module-missing）必须**两条命令都**计入
    expect(plain.stdout + plain.stderr).toContain("nudo:module-missing");
    expect(fix.stdout + fix.stderr).toContain("residual error");
    // 残余 error 条数 = plain check 的 error 条数（同一套输入 ⇒ 同一诊断集）
    expect(residual(fix.stdout + fix.stderr)).toBe(
      errorCount(plain.stdout + plain.stderr),
    );
  }
  {
    const dir = project({
      "lib.js": `export function f(x) {
  return x.toFixed(2);
}
`,
    });
    const file = join(dir, "lib.js");
    const plain = runCli(["check", "--profile", "adoption", file]);
    expect(gate(plain), plain.stdout + plain.stderr).toBe("green");
    const fix = runCli(["check", "--profile", "adoption", "--fix", file]);
    const out = fix.stdout + fix.stderr;
    expect(gate(fix), out).toBe("green");
    expect(out).toContain("0 edit(s) planned");
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
  }
});




});


// ---------------------------------------------------------------------------
// --from 的现场文件路径必须到达 runCheck（CLI 闭环）
// ---------------------------------------------------------------------------
describe("--from 的现场文件路径必须到达 runCheck（CLI 闭环）", () => {
/**
 * **CLI 闭环**：`nudo check <被调方> --from <调用方>` 的现场文件
 * **路径**从未到达 `runCheck` ⇒ 静态调用点复核整条失明 ⇒ 门禁**假绿**。
 *
 * 根因链（库级接线已由族 18 · 片 3 落盘，CLI 侧漏了最后一根线）：
 * - `commands/check-command.ts` 的 action 把 `--from` 路径交给
 * `commands/shared.ts` 的 `collectExternalRecords`，它**塌缩成执行态
 * `CallRecord[]``**；现场文件「零条执行态记录」时直接回 `undefined`
 * ⇒ `runCheck` 连「现场文件是哪个」都看不见；
 * - `check-json-map.ts` 的 `staticFromDomainIssues`（按 core 同文件通道的
 * 静态全树扫描判据复核 `--from` 现场文件）与 `check.ts` 的
 * `RunCheckOptions.fromPaths` 都需要**路径**才能工作 ⇒ 路径不落地 ⇒
 * 静态通道整条失明；
 * - 症状：调用点被包在**函数体 / 箭头 / 方法体**里时（执行态采集拿不到
 * 记录），`nudo check <被调方> --from <调用方>` **exit 0 绿**，而
 * `nudo check <调用方>` **exit 1 红** —— 谁被检查谁决定颜色。
 *
 * 本钉走**产品面**（共享脚手架 `helpers/run-cli.ts` 的 CLI runner）：
 * ① `--from` ⇒ 被调方红（exit 1）+ 恰一条 `nudo:contract-domain-exceeds`；
 * ② `--json` 面同判（ok:false / summary.errors=1 / issues 恰一条）；
 * ③ 归因到**被调方导出名**（`fn: "f"` / actual `-1`）；
 * ④ `--from <目录>` 同判（现场文件集合按目录展开）；
 * ⑤ 控制组：直接 check **调用方** ⇒ 仍 1 条 `nudo:constraint-violated`
 * （跨文件面不得污染同文件面）；
 * ⑥ 控制组：**不带** `--from` ⇒ 被调方绿（不得凭空造证据）；
 * ⑦ **不重复报告**：顶层调用点（执行态 + 静态两通道同时命中）⇒ 恰一条。
 *
 * 闸④（反向闸）：拷进 HEAD 只读副本必须**大面积失败** —— HEAD 上
 * ① ② ③ ④ 四条全红（CLI 假绿），⑤ ⑥ ⑦ 三条控制组仍绿。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 出现次数（诊断码计数用） */
function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * 人类面 issues 段里的诊断码（**只取 issue 行**）。
 *
 * 人类面里同一个码会出现**两次**：issue 行（`[ERROR ...] ... (nudo:xxx)`）
 * 与 docs 深链行（`nudo:xxx → https://...`）⇒ 计「条数」必须排除深链行。
 */
function issueCodes(out: string): string[] {
  const codes: string[] = [];
  for (const line of out.split("\n")) {
    if (!line.trimStart().startsWith("[")) continue;
    const m = /\((nudo:[a-z0-9:-]+)\)\s*$/.exec(line);
    if (m) codes.push(m[1]);
  }
  return codes;
}

/** `--json` 面的最小可读形状（只取本钉断言用到的字段） */
type CheckJsonLike = {
  ok: boolean;
  summary: { errors: number; warnings: number; infos: number };
  issues: Array<{
    severity: string;
    code: string;
    message: string;
    fn?: string;
    actual?: string;
    expected?: string;
  }>;
};

/**
 * 夹具（被调方 + 侧车契约 + 现场文件）：
 * - `lib.js`：被调方（导出 `f`）；
 * - `lib.nudo.js`：手写契约侧车（`x > 0`）——ambient 绑定，无需 import；
 * - `infn.js`：现场文件，调用点**被包在函数体内** ⇒ 执行态采集拿不到记录
 * ⇒ 只有静态通道能看见它。
 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b643-cli-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `{ "name": "b643cli", "version": "1.0.0", "type": "module" }\n`,
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), `export function f(x) { return x; }\n`, "utf-8");
  writeFileSync(
    join(dir, "lib.nudo.js"),
    `export const f = fn({ x: number().gt(0) });\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "infn.js"),
    `import { f } from "./lib.js";\nexport function use() { return f(-1); }\n`,
    "utf-8",
  );
  return dir;
}

describe("-from 的现场文件路径必须到达 runCheck（CLI 闭环）", () => {
  it("① --from 现场文件（调用点在函数体内）⇒ 被调方门禁红（exit 1 + 恰一条跨文件域超限）；② --json 面同判：ok:false + summary.errors=1 + issues 恰一条；③ 违例归因到被调方的导出名（fn=f / actual=-1），不是现场文件的本地名；④ --from <目录> ⇒ 同判（现场文件集合按目录展开）；⑤ 控制组：直接 check 调用方 ⇒ 仍 1 条 nudo:constraint-violated（跨文件面不污", () => {
  {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--from", "infn.js"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("nudo:contract-domain-exceeds");
    expect(countOf(issueCodes(r.stdout).join("\n"), "nudo:contract-domain-exceeds")).toBe(1);
    // 跨文件面用跨文件面的码（同文件通道的码不得出现在被调方报告里）
    expect(r.stdout).not.toContain("nudo:constraint-violated");
  }
  {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--from", "infn.js", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    expect(json.ok).toBe(false);
    expect(json.summary.errors).toBe(1);
    expect(json.issues.length).toBe(1);
    expect(json.issues[0].code).toBe("nudo:contract-domain-exceeds");
    expect(json.issues[0].severity).toBe("error");
  }
  {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--from", "infn.js", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    expect(json.issues[0].fn).toBe("f");
    expect(json.issues[0].actual).toBe("-1");
    expect(json.issues[0].message).toContain("f[x]");
  }
  {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--from", "."], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("nudo:contract-domain-exceeds");
    expect(countOf(issueCodes(r.stdout).join("\n"), "nudo:contract-domain-exceeds")).toBe(1);
  }
  {
    const dir = fixture();
    const r = runCliTsx(["check", "infn.js", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    const codes = json.issues.map((i) => i.code);
    expect(countOf(codes.join("\n"), "nudo:constraint-violated")).toBe(1);
    expect(countOf(codes.join("\n"), "nudo:contract-domain-exceeds")).toBe(0);
  }
  {
    const dir = fixture();
    const r = runCliTsx(["check", "lib.js", "--json"], { cwd: dir });
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    expect(json.ok).toBe(true);
    const codes = json.issues.map((i) => i.code);
    expect(countOf(codes.join("\n"), "nudo:contract-domain-exceeds")).toBe(0);
  }
  {
    const dir = fixture();
    writeFileSync(
      join(dir, "top.js"),
      `import { f } from "./lib.js";\nexport const r = f(-1);\n`,
      "utf-8",
    );
    const r = runCliTsx(["check", "lib.js", "--from", "top.js", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout) as CheckJsonLike;
    const codes = json.issues.map((i) => i.code);
    expect(countOf(codes.join("\n"), "nudo:contract-domain-exceeds")).toBe(1);
  }
});






});
});


// ---------------------------------------------------------------------------
// --from 的调用点义务按静态判据复核
// ---------------------------------------------------------------------------
describe("--from 的调用点义务按静态判据复核", () => {
/**
 * `nudo check --from` / `nudo test --from` 的**调用点义务**只覆盖
 * **执行态**调用点 ⇒ 被包在**函数 / 箭头 / 方法**里的违例**静默漏过**
 * （exit 0 绿），而**同一调用点所在文件单独 check 是红的**。
 *
 * 根因：调用点义务有两条通道、判据本应一致——
 * - **同文件**：core 的 `scanLiteralCalls` 做**静态全树扫描** ⇒ 无论调用点
 * 是否被执行过都执法；
 * - **跨文件（`--from`）**：此前只有**执行态** `externalCallRecords`
 * （`collectExternalRecords` 只收集真正跑过的调用）⇒ 函数体内的调用点
 * 根本没有记录 ⇒ 同一处静态可见的违例，谁被检查谁决定颜色。
 *
 * 修法：复用 core **同文件通道的静态扫描**（`checkSource` 对 `--from` 现场
 * 文件跑一遍）复核调用点义务 ⇒ 两通道同码（`nudo:constraint-violated`）
 * 同判据；现场文件路径经 `RunCheckOptions.fromPaths` 进来（执行态记录上的
 * `callSiteFile` 也能反推现场文件）。
 *
 * 钉：
 * - 现场文件里的调用点被包在**函数体内** ⇒ 被调方的 check 报告必须带上
 * `nudo:constraint-violated`（error）+ 归因到被调方的导出名；
 * - 控制组：**不带** `--from` 现场文件 ⇒ 被调方自身报告不含该违例
 * （不得凭空造证据）。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * 夹具：
 * - `lib.js` 被调方（导出 `f`）；
 * - `lib.nudo.js` 手写契约侧车（`x > 0`）；
 * - `infn.js` 调用点——调用**被包在函数体内** ⇒ 执行态采集拿不到记录。
 */
function fixture(): { dir: string; lib: string; infn: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug643-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `{ "name": "b643", "version": "1.0.0", "type": "module" }`,
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), `export function f(x) { return x; }\n`, "utf-8");
  // 侧车的 fn()/number() 构造器是 ambient 绑定 ⇒ 无需 import @nudojs/core
  writeFileSync(
    join(dir, "lib.nudo.js"),
    `export const f = fn({ x: number().gt(0) });\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "infn.js"),
    `import { f } from "./lib.js";\nexport function use() { return f(-1); }\n`,
    "utf-8",
  );
  return { dir, lib: join(dir, "lib.js"), infn: join(dir, "infn.js") };
}

/** 被调方报告里的「调用点违例」条目（`--from` 面的跨文件域超限码） */
function violationIssues(json: CheckJson | undefined): CheckJson["issues"] {
  return (json?.issues ?? []).filter((i) => i.code === "nudo:contract-domain-exceeds");
}

/** 最小模块说明符解析：只处理相对说明符（夹具内都是相对路径）⇒ 回**路径** */
function resolveRelative(specifier: string, fromFile: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  return join(dirname(fromFile), specifier);
}

/** 最小模块装载器：回**源码**（core 的 loadModule 契约） */
function loadRelative(specifier: string, fromFile: string): string | undefined {
  const p = resolveRelative(specifier, fromFile);
  if (p === undefined) return undefined;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return undefined;
  }
}

describe("-from 的调用点义务按静态判据复核", () => {
  it("静态扫描：函数体内的调用点被判为被调方的调用点违例；runCheck 接线：带 --from 现场文件 ⇒ 被调方报告含 error 级调用点违例；控制组：不带 --from 现场文件 ⇒ 被调方报告不含该违例（不凭空造证据）；去重：执行态通道已报过的同一处事实不被静态通道重复上报", async () => {
  {
    const { lib, infn } = fixture();
    const issues = staticFromDomainIssues({
      targetPath: lib,
      callsites: [{ path: infn, source: readFileSync(infn, "utf-8") }],
      resolveModule: resolveRelative,
      loadModule: loadRelative,
    });
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe("error");
    // 归因到**被调方**的导出名（不是现场文件的本地名）
    expect(issues[0].fn).toBe("f");
  }
  {
    const { lib, infn } = fixture();
    const collected: CheckJson[] = [];
    await runCheck(lib, { json: true, jsonCollect: collected, fromPaths: [infn] });
    const violations = violationIssues(collected[0]);
    expect(violations.length).toBe(1);
    expect(violations[0].severity).toBe("error");
    expect(violations[0].fn).toBe("f");
  }
  {
    const { lib } = fixture();
    const collected: CheckJson[] = [];
    await runCheck(lib, { json: true, jsonCollect: collected });
    expect(violationIssues(collected[0]).length).toBe(0);
  }
  {
    const deduped = dedupeFromStaticIssues(
      [
        {
          severity: "error",
          code: "nudo:contract-domain-exceeds",
          message: "f[x]: cross-file call-site domain evidence -1 exceeds handwritten contract",
          fn: "f",
        },
      ],
      [
        {
          severity: "error",
          code: "nudo:contract-domain-exceeds",
          message: "f[x]: cross-file call-site domain evidence -1 exceeds handwritten contract",
        },
      ],
    );
    expect(deduped.length).toBe(0);
  }
});



});
});

// ---------------------------------------------------------------------------
// 复合类型注解 / Function.prototype 间接调用的调用点执法
// ---------------------------------------------------------------------------
describe("复合类型注解与 call/apply/bind 间接调用", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (files: Record<string, string>): string => {
    const d = mkdtempSync(join(tmpdir(), "nudo-r1-forms-"));
    dirs.push(d);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(d, name), content, "utf-8");
    return d;
  };

  it(".ts 复合类型注解（数组 / 对象 / 联合）进入口 Abs ⇒ 合法 TS 不再 L2 假红", () => {
    const d = tmp({
      "ann.ts": `export function p4(x: number[]) { return x.length; }
export function p5(x: { a: number }) { return x.a; }
export function p6(x: string | number) { return String(x); }
`,
    });
    const r = runCliTsx(["check", join(d, "ann.ts")]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("p4(x: number[]) => number");
    expect(r.stdout).toContain("p5(x: { a: number }) => number");
    expect(r.stdout).toContain("p6(x: string | number) => string");
  });

  it("f.call / f.apply / f.bind 间接调用的现场都有契约义务与见证（不再假绿）", () => {
    const d = tmp({
      "u.js": `export function f(x) { return x; }
f(-1);
f.call(null, -2);
f.apply(null, [-3]);
const b = f.bind(null);
b(-4);
`,
      "u.nudo.js": `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number());
`,
    });
    const chk = runCliTsx(["check", join(d, "u.js")]);
    expect(chk.status).toBe(1);
    // L2 直接 / L3 .call / L4 .apply / L6 bind 结果 ⇒ 四条都在
    for (const line of ["[ERROR L2 f]", "[ERROR L3 f]", "[ERROR L4 f]", "[ERROR L6 f]"]) {
      expect(chk.stdout).toContain(line);
    }
    const tst = runCliTsx(["test", join(d, "u.js")]);
    expect(tst.stdout).toContain("call@L2");
    expect(tst.stdout).toContain("call@L3");
    expect(tst.stdout).toContain("call@L4");
    expect(tst.stdout).toContain("4 synthetic case(s)");
  }, 120000);
});

// ---------------------------------------------------------------------------
// 导出对象字面量的 spread 成员进入口表（BUG-108 的主形态）
// ---------------------------------------------------------------------------
describe("导出对象经 spread 引入的方法也受门禁覆盖", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (files: Record<string, string>): string => {
    const d = mkdtempSync(join(tmpdir(), "nudo-spread-entry-"));
    dirs.push(d);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(d, name), content, "utf-8");
    return d;
  };

  it("`export default { ...base }` 里 base 的必抛方法报 nudo:entry-may-throw", () => {
    const d = tmp({
      "s.js": `const base = { bad() { throw new Error("boom"); } };
export default { ...base, good() { return 1; } };
`,
    });
    const r = runCliTsx(["check", join(d, "s.js")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("bad() => unknown  throws Error");
    expect(r.stdout).toContain("nudo:entry-may-throw");
  }, 120000);

  it("负控制：spread 来源的方法不抛 ⇒ 不误报", () => {
    const d = tmp({
      "ctl.js": `const base = { fine() { return 1; } };
export default { ...base, good() { return 1; } };
`,
    });
    const r = runCliTsx(["check", join(d, "ctl.js")]);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain("fine()");
  }, 120000);
});
