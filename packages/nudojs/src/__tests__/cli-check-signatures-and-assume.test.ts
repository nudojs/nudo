/**
 * 模块套件：cli-check-signatures-and-assume（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { runCliTsx, repoRoot, runCliNode as runCli } from "./helpers/run-cli.ts";
import { spawnSync } from "node:child_process";
import { collectExternalRecords } from "../commands/shared.ts";
import { PathError } from "@nudojs/service";
import { tmpProject } from "./helpers/tmp-project.ts";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";
import { type CheckJson } from "@nudojs/core";
import { runCheck } from "../commands/check.ts";


// ---------------------------------------------------------------------------
// [merged] case-witness-not-published
// ---------------------------------------------------------------------------
describe("case-witness-not-published", () => {
// MERGED (topic-related bug pins): case-witness-not-published + export-case-not-contract
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






{
/**
 * `nudo export` 把 `@nudo:case` 的**调试见证**发布成类型 ⇒ 四个
 * 产物面一致地拒绝**实现允许**的调用，且与 `nudo check` 的签名相反。
 *
 * 症状：`/** @nudo:case "dom" (number()) *\/ export function f(x) { return x + 1; }`
 * ⇒ dts `f(x: number): number`、zod `z.number()`、guard `typeof data === "number"`
 * 全被那条调试见证污染；而 `nudo check` 的签名是 `f(x: any) => number | string`
 * （门禁面以 caseMode "none" 调分析器，**永不**产出指令见证）。
 *
 * 修法：export 面与门禁面同口径（caseMode "none"）—— 发布面**不**消费
 * `@nudo:case`（文档：Cases are debug witnesses … not the contract product）。
 *
 * 钉：有 / 无那条调试见证时，dts 与 zod 两个面的投影**逐字相同**，且与
 * `nudo check` 的签名同口径。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const BODY = "export function f(x) {\n  return x + 1;\n}\n";
const PLAIN = BODY;
const WITH_WITNESS = `/**\n * @nudo:case "dom" (number())\n */\n${BODY}`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b044-"));
  dirs.push(dir);
  writeFileSync(join(dir, "plain.js"), PLAIN, "utf-8");
  writeFileSync(join(dir, "lib.js"), WITH_WITNESS, "utf-8");
  return dir;
}

/** 声明的形参类型（`export declare function f(<这里>): …`）。 */
function dtsParamType(stdout: string): string {
  const m = /^export declare function f\(([^)]*)\)/m.exec(stdout);
  expect(m).not.toBeNull();
  return m![1]!;
}

describe("`@nudo:case` 调试见证不进发布面", () => {
  it("dts 面：有调试见证与无证据的投影相同（形参是 unknown，不是 number）；zod / guard 面：放宽到 unknown（不再按那一次调试调用收窄）；与 nudo check 的签名同口径（发布面 = 门禁面）", () => {
  {
    const dir = fixture();
    const plain = runCliTsx(["export", join(dir, "plain.js"), "--format", "dts"]);
    const withCase = runCliTsx(["export", join(dir, "lib.js"), "--format", "dts"]);
    expect(plain.status).toBe(0);
    expect(withCase.status).toBe(0);

    expect(dtsParamType(withCase.stdout)).toBe(dtsParamType(plain.stdout));
    expect(dtsParamType(withCase.stdout)).toContain("unknown");
    expect(dtsParamType(withCase.stdout)).not.toContain("number");
  }
  {
    const dir = fixture();
    const plain = runCliTsx(["export", join(dir, "plain.js"), "--format", "all"]);
    const withCase = runCliTsx(["export", join(dir, "lib.js"), "--format", "all"]);
    expect(withCase.status).toBe(0);

    expect(withCase.stdout).toContain("export const fInput = z.object({ x: z.unknown() })");
    expect(withCase.stdout).not.toContain("x: z.number()");
    // 与无证据的同形源一致
    expect(withCase.stdout).toContain("export const fInput = z.object({ x: z.unknown() })");
    expect(plain.stdout).toContain("export const fInput = z.object({ x: z.unknown() })");
  }
  {
    const dir = fixture();
    const check = runCliTsx(["check", join(dir, "lib.js")]);
    const dts = runCliTsx(["export", join(dir, "lib.js"), "--format", "dts"]);
    expect(dts.status).toBe(0);
    // check 签名行：f(x: any) => number | string
    expect(check.stdout).toContain("f(x: any)");
    expect(dtsParamType(dts.stdout)).toContain("unknown");
    expect(dts.stdout).toContain("number | string");
  }
});


});
}

describe("export-case-not-contract", () => {
/**
 * `nudo export` / `nudo contract` 把 `@nudo:case` 的**域形状实参**
 * 发布成类型 ⇒ 发布的 d.ts / schema / guard / 打印面是错的。
 *
 * `@nudo:case` 是**调试见证**（docs/concepts/directives.md:44），不是契约；
 * 门禁面（check / health / mutate）用 `caseMode "none"`，发布面与打印面必须
 * **同口径**。此前 export 与 contract-surface 用 `"all"`
 * ⇒ 同一个函数，仅仅多一条 `@nudo:case "dom" (number())` 就把
 * `f(x: any) => number | string` 变成 `f(x: number) => number`。
 */






/** 有 `@nudo:case` 的模块：`number()` 是**见证实参**，不是入参契约。 */
const WITH_CASE = `/**
 * @nudo:case "dom" (number())
 */
export function f(x) {
  return x + 1;
}
`;

/** 对照组：同函数、删掉那条 case。 */
const PLAIN = `export function f(x) {
  return x + 1;
}
`;

function project(): { dir: string; withCase: string; plain: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug44-"));
  const withCase = join(dir, "lib.js");
  const plain = join(dir, "plain.js");
  writeFileSync(withCase, WITH_CASE);
  writeFileSync(plain, PLAIN);
  return { dir, withCase, plain };
}

/** dts 面里 f 的签名行 */
function dtsSig(stdout: string): string {
  return stdout
    .split("\n")
    .find((l) => /function f\(/.test(l))!
    .trim();
}

describe("调试见证不得进入发布/打印面", () => {
  it("dts：有 case 与无 case 逐字相同（均门禁口径 x: unknown）；schema：入参是宽松域（z.unknown），不是 case 的 z.number；guard：入参接受 string（实现允许 f(\"s\")）；`nudo contract` 打印面与 check 同口径（x: any）", () => {
  {
    const { dir, withCase, plain } = project();
    try {
      const a = dtsSig(runCliTsx(["export", withCase, "--format", "dts"]).stdout);
      const b = dtsSig(runCliTsx(["export", plain, "--format", "dts"]).stdout);
      expect(a).toBe("export declare function f(x: unknown): number | string;");
      expect(a).toBe(b);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const { dir, withCase } = project();
    try {
      const out = runCliTsx(["export", withCase, "--format", "schema"]).stdout;
      const inputLine = out.split("\n").find((l) => l.includes("fInput"))!;
      expect(inputLine).toContain("z.unknown()");
      expect(inputLine).not.toContain("z.number()");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const { dir, withCase } = project();
    try {
      const out = runCliTsx(["export", withCase, "--format", "guard"]).stdout;
      expect(out).toContain(`typeof data === "string"`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const { dir, withCase, plain } = project();
    try {
      const sigOf = (out: string): string =>
        out.split("\n").find((l) => /^\s+f\s+\[/.test(l))!.trim();
      const a = sigOf(runCliTsx(["contract", withCase]).stdout);
      const b = sigOf(runCliTsx(["contract", plain]).stdout);
      expect(a).toContain("(x: any)");
      expect(a).not.toContain("(x: number)");
      expect(a).toBe(b);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});



});
});
});


// ---------------------------------------------------------------------------
// check 签名 = 一次正常求值
// ---------------------------------------------------------------------------
describe("check 签名 = 一次正常求值", () => {
/**
 * 回归：`nudo check` 的签名必须是**一次正常求值**的结果。
 *
 * 症状（报告时的形态）：check 通道先跑分析器再跑 core 闸门，两轮共享同一份
 * 模块实例 ⇒ 模块级可变状态被双写，闸门打印的签名取自脏状态：
 * - `let c = 0; export function bump(){ c += 1; return c }` → `bump() => 2`
 * （原生唯一可能值是 1；`nudo test` / `nudo export` 都给 1）
 * - `once()`（第一次调用必抛）→ `1 throws Error`（应为 `never throws Error`，
 * 发布的 d.ts 也是 `never`）⇒ 门禁面与发布面互相矛盾
 * - 该签名是 `nudo:contract-drift` 的输入 ⇒ 生成段（干净值）与今日域
 * （脏值）永不收敛：emit 说「无变化」、check 说「漂移」、health 判 FAIL
 * 且提示的重跑无效（CI 卡死，无自愈路径）。
 *
 * 当前树已修好（分析器轮与闸门轮不再共享实例）；本测试钉住**值级结论**防回归：
 * 1. 计数器工厂：check 与 test 两面都给 1（跨动词一致）；
 * 2. 一次性抛：check 给 `never` + `throws Error`（与 d.ts 一致）；
 * 3. 漂移收敛：手写 `lit(1)` 生成段 ⇒ check **不报** `nudo:contract-drift`
 * 且签名 = 1（脏值会让它与生成段打架）。
 *
 * 注：每个用例用**独立**的 `NUDO_CACHE_DIR`——check 有磁盘缓存，复用会让
 * 「值是从缓存来的」与「值是真算出来的」不可区分。
 */






/** 模块级计数器（无顶层调用）⇒ 原生唯一可能值 1 */
const COUNTER = `let c = 0;

export function bump() {
  c += 1;
  return c;
}
`;

/** 一次性标志 ⇒ 第一次调用必抛（返回面恒 never） */
const ONCE = `let first = true;
export function once() {
  if (first) {
    first = false;
    throw new Error("boom");
  }
  return 1;
}
`;

/** 一次性标志的**有返回值**版本：第一次 1、之后 2（漂移敏感） */
const ONCE_VALUE = `let first = true;
export function once() {
  if (first) {
    first = false;
    return 1;
  }
  return 2;
}
`;

function project(files: Record<string, string>): { cwd: string; cache: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug056-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return { cwd: dir, cache: join(dir, ".nudo-cache") };
}


  it("计数器工厂：check 与 test 都给 1；一次性抛：check 给 never（与 d.ts 一致），不是 1；手写 lit(1) 生成段 ⇒ 不报 contract-drift（脏值会与生成段打架）", () => {
  {
    const { cwd, cache } = project({ "lib.js": COUNTER });
    const env = { NUDO_CACHE_DIR: cache };
    const check = runCliTsx(["check", "lib.js"], { cwd, env });
    expect(check.stdout).toContain("bump() => 1");
    expect(check.stdout).not.toContain("bump() => 2");
    // 跨动词一致：test 面（分析器单轮）同样是 1
    const test = runCliTsx(["test", "lib.js"], { cwd, env });
    expect(test.stdout).toMatch(/entry@L\d+\s+\(\) => 1/);
  }
  {
    const { cwd, cache } = project({ "once.js": ONCE });
    const r = runCliTsx(["check", "once.js"], { cwd, env: { NUDO_CACHE_DIR: cache } });
    expect(r.stdout).toContain("once() => never");
    expect(r.stdout).toContain("throws Error");
    expect(r.stdout).not.toContain("once() => 1");
  }
  {
    const { cwd, cache } = project({
      "once.js": ONCE_VALUE,
      "once.nudo.js": `import { fn, lit } from "@nudojs/core";
export const once = fn({  }, lit(1));
`,
    });
    const r = runCliTsx(["check", "once.js"], { cwd, env: { NUDO_CACHE_DIR: cache } });
    expect(r.stdout).toContain("once() => 1");
    expect(r.stdout).not.toContain("nudo:contract-drift");
    expect(r.status).toBe(0);
  }
});



});


// ---------------------------------------------------------------------------
// --abs --quiet 必须兑现 --quiet
// ---------------------------------------------------------------------------
describe("--abs --quiet 必须兑现 --quiet", () => {
/**
 * `nudo check --abs --quiet` **完全忽略** `--quiet`：clean 文件
 * 打 3 行而非 1 行摘要，失败文件仍打印 `signatures` 段。
 *
 * 根因：渲染分支里 `opts.abs` 排在 `opts.quiet` **之前**，且 abs 分支自己打
 * 完整 report + 3 行 OK 块、完全不 consult quiet。现在 `--quiet` 优先
 * （压 signatures / 代数面，只留摘要），`--abs --verbose` 也不再被吞。
 */






/** 零 issue 的干净文件（无导出 ⇒ 无签名、无 entry-only info ⇒ 一行摘要） */
const CLEAN = `const answer = 42;
export {};
`;
const BAD = `export function staticName(node) {
  return node.type;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug066-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b66", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "ok.js"), CLEAN, "utf-8");
  writeFileSync(join(cwd, "bad.js"), BAD, "utf-8");
  return cwd;
}

describe("-abs --quiet 必须兑现 --quiet", () => {
  it("clean 文件 ⇒ 恰好一行摘要（旧实现 3 行 OK 块 + 代数面）；失败文件 ⇒ 不打 signatures 段（与单独 --quiet 同形）", () => {
  {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "ok.js", "--abs", "--quiet"], { cwd });
      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("OK");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const cwd = makeProject();
    try {
      const absQuiet = runCliTsx(["check", "bad.js", "--abs", "--quiet"], { cwd });
      const quiet = runCliTsx(["check", "bad.js", "--quiet"], { cwd });
      expect(absQuiet.status).toBe(1);
      expect(absQuiet.stdout).not.toContain("signatures");
      expect(quiet.stdout).not.toContain("signatures");
      // 诊断仍上屏（--quiet 只压签名，不吞错误）
      expect(absQuiet.stdout).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

});
});


// ---------------------------------------------------------------------------
// @nudo:assume 前提在 --abs 观察面可见（与 --json 同源）
// ---------------------------------------------------------------------------
describe("@nudo:assume 前提在 --abs 观察面可见（与 --json 同源）", () => {
/**
 * 回归：`check --abs` 必须与 `check --json` 的 `abs` **同源** ——
 * 源码级 `@nudo:assume d <= max` 的用户引理不得在观察面丢掉。
 *
 * 症状（修前）：同一份源码，`check --json` 的 `abs` 是
 * `number = /(d, max) where /(d, max) ≤ 1 #path`（有 pred），而 `check --abs`
 * 打印 `number / term: /(d, max) / conf: path`（**无 pred**）；把 `@nudo:assume`
 * 那行删掉两面又逐字一致 ⇒ 差异精确来自这条指令，不是观察面固有的精度差。
 *
 * 根因：门禁（core `checkSource`）在目标函数入口用 `withAssumePremises` 种
 * **前提槽**（issue #152 引理；不随调用链继承），而 `runAbsView` 只种 CLI
 * `--assume` 的 **phi**（路径条件），从不看源码指令 ⇒ 同一命令两个面互斥。
 *
 * 断言面：
 * 1. 带 `@nudo:assume`：`--abs` 面出现与 `--json` 面**同一句** pred
 * （`/(d, max) ≤ 1`）；
 * 2. 对照组（删掉 assume 行）：两面都不出现该 pred（差异确实由指令引起）；
 * 3. `nudo test --abs` 走同一 `runAbsView` ⇒ 同样可见（第三处观察面）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 侧车契约：分母恒正（div 关系折叠的 posDen 前提） */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const ratio = fn({ d: number(), max: number().gt(0) }, number());
`;

function fixture(assumeLine: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b085-"));
  dirs.push(dir);
  writeFileSync(join(dir, "ratio.js"), `/**\n * ${assumeLine}\n */\nexport function ratio(d, max) {\n  return d / max;\n}\n`, "utf-8");
  writeFileSync(join(dir, "ratio.nudo.js"), SIDECAR, "utf-8");
  return join(dir, "ratio.js");
}

/** 每次调用独立的缓存目录：`nudo check` 有落盘缓存，串用会掩盖回归 */
function cacheDir(): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b085-cache-"));
  dirs.push(dir);
  return { NUDO_CACHE_DIR: dir };
}

/** `--abs` 观察面里 pred 行的规范文本（`pred: /(d, max) ≤ 1`） */
const PRED_LINE = "pred: /(d, max) ≤ 1";


  it("带 assume：--abs 与 --json 的 abs 面出现同一句 pred；对照组（无 assume 行）：两面都不出现该 pred；`nudo test --abs` 走同一观察面 ⇒ 前提同样可见", () => {
  {
    const file = fixture("@nudo:assume d <= max");

    const abs = runCliTsx(["check", "--abs", file], { env: cacheDir() });
    expect(abs.status).toBe(0);
    expect(abs.stdout).toContain(PRED_LINE);

    const json = runCliTsx(["check", "--json", file], { env: cacheDir() });
    expect(json.status).toBe(0);
    // 机器面同一事实（单行 `formatAbs`：`where /(d, max) ≤ 1`）
    expect(json.stdout).toContain("where /(d, max) ≤ 1");
  }
  {
    const file = fixture("ratio: d / max");

    const abs = runCliTsx(["check", "--abs", file], { env: cacheDir() });
    expect(abs.status).toBe(0);
    // 观察面仍在算（term 可见），只是没有前提可折 ⇒ 无 pred
    expect(abs.stdout).toContain("term: /(d, max)");
    expect(abs.stdout).not.toContain(PRED_LINE);

    const json = runCliTsx(["check", "--json", file], { env: cacheDir() });
    expect(json.status).toBe(0);
    expect(json.stdout).not.toContain("where /(d, max) ≤ 1");
  }
  {
    const file = fixture("@nudo:assume d <= max");
    const r = runCliTsx(["test", "--abs", file], { env: cacheDir() });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(PRED_LINE);
  }
});



});


// ---------------------------------------------------------------------------
// shape-union 返回契约不塌缩
// ---------------------------------------------------------------------------
describe("shape-union 返回契约不塌缩", () => {
/**
 * 返回契约若是「**shape 的 union**」，zod / standard / guard **三个
 * 运行时面全部塌缩**为「接受一切」⇒ 契约违约值被放行（假绿），而 dts / check
 * 仍保留 union ⇒ 四面互斥。
 *
 * 根因：`constraintDisproved` 的 `constraint.fields` 分支缺 `sum` 判定（与
 * `constraint.prim` 分支的处理**不对称**）⇒ identity 函数把 union 原样返回时
 * 逐个 shape 成员一律被判「已证否」⇒ 契约返回 Abs 被丢弃 ⇒ 回落 any。
 *
 * 钉：
 * - 三个运行时面都保留 union（不再 `z.unknown()` / `{"k":"unknown"}` /
 * `return true`）；
 * - 运行时（Standard Schema 真跑）：契约违约值被**拒绝**，契约允许的值被接受；
 * - 与 dts 面同口径。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function G(x) {\n  return x;\n}\n";

const SIDECAR = [
  'import { fn, union, shape, lit, number, string } from "@nudojs/core";',
  "export const G = fn(",
  '  { x: union(shape({ kind: lit("a"), n: number() }), shape({ kind: lit("b"), s: string() })) },',
  '  union(shape({ kind: lit("a"), n: number() }), shape({ kind: lit("b"), s: string() })),',
  ");",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b121-"));
  dirs.push(dir);
  writeFileSync(join(dir, "G.js"), SRC, "utf-8");
  writeFileSync(join(dir, "G.nudo.js"), SIDECAR, "utf-8");
  return dir;
}


  it("zod / standard / guard 三面都保留 union（同一 zod 文件内 Input 与 Output 同口径）；运行时：standard 面拒绝契约违约值、接受契约允许值", () => {
  {
    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "G.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // zod 返回面不再是 z.unknown()
    expect(r.stdout).toMatch(/export const GOutput = z\.union\(\[/);
    expect(r.stdout).not.toMatch(/export const GOutput = z\.unknown\(\)/);
    // standard 节点是 union（不是 {"k":"unknown"}）
    expect(r.stdout).toContain('"k":"union","members"');
    // guard 不是恒真
    expect(r.stdout).not.toMatch(/export function isGOutput\(value: unknown\): boolean \{\s*const data = value as unknown;\s*return true;/);
    // dts 面保留 union（四面同口径）
    expect(r.stdout).toContain("kind: string; n: number } | { kind: string; s: string }");
  }
  {
    const dir = fixture();
    const out = join(dir, "out");
    expect(runCliTsx(["export", join(dir, "G.js"), "--format", "standard", "--out", out]).status).toBe(0);
    const name = readdirSync(out).find((f) => f.endsWith(".nudo.standard.ts"));
    expect(name).toBeDefined();
    const artifact = readFileSync(join(out, name!), "utf-8");

    // artifact 里有类型标注 ⇒ 先剥类型再求值（node 的 strip-types）
    writeFileSync(join(dir, "artifact.mts"), artifact, "utf-8");
    const probe = join(dir, "probe.mjs");
    writeFileSync(
      probe,
      [
        `const m = await import(${JSON.stringify(join(dir, "artifact.mts"))});`,
        'const v = m.GOutput["~standard"];',
        'const bad = { kind: "z", q: 1 };',
        'const good = { kind: "a", n: 1 };',
        'console.log("bad", "issues" in v.validate(bad));',
        'console.log("good", "issues" in v.validate(good));',
        "",
      ].join("\n"),
      "utf-8",
    );
    const run = spawnSync(process.execPath, ["--experimental-strip-types", probe], { encoding: "utf8" });
    expect(`${run.stdout}${run.stderr}`).toContain("bad true");
    expect(`${run.stdout}${run.stderr}`).toContain("good false");
  }
});


});


// ---------------------------------------------------------------------------
// 空目录现场
// ---------------------------------------------------------------------------
describe("空目录现场", () => {
/**
 * 回归：`--from <空目录>` 必须报路径错误（`nudo:path-empty-dir`），
 * 不能静默通过。
 *
 * 改前空目录展开成 `[]` ⇒ 循环体一次都不执行 ⇒ 既不产生 PathError 也不产生
 * 调用记录 ⇒ 上层回落 `entry@` + exit 0（假绿）。「0 条记录」的三种情形
 * （文件缺失 / 读失败 / 无调用点）此前只区分了前两种。
 */








  it("空目录 ⇒ path-empty-dir 进 sink，且不返回记录；对照组：非空目录现场照常采集（无路径错误）", () => {
  {
    const dir = tmpProject("nudo-129-", { "lib.js": "export function f() { return 1; }\n" });
    const empty = join(dir, "empty");
    mkdirSync(empty);
    const sink: PathError[] = [];
    const records = collectExternalRecords([empty], sink);
    expect(records).toBeUndefined();
    expect(sink.map((e) => e.code)).toContain("nudo:path-empty-dir");
  }
  {
    const dir = tmpProject("nudo-129-ok-", {
      "site.js": 'import { f } from "./lib.js";\nexport const v = f(1);\n',
      "lib.js": "export function f(a) { return a + 1; }\n",
    });
    const sink: PathError[] = [];
    const records = collectExternalRecords([dir], sink);
    expect(sink).toEqual([]);
    expect(records?.length ?? 0).toBeGreaterThan(0);
  }
});


});


// ---------------------------------------------------------------------------
// 调用点见证不重复合成
// ---------------------------------------------------------------------------
describe("调用点见证不重复合成", () => {
/**
 * 回归：`--from` 的调用点见证不得被**两条合成路径各合成一次**。
 *
 * 改前「已固化 directive 见证 + 主候选循环的 callsite 见证」会产出同名两条
 * ⇒ 台账里 `call@` 出现两次、人类面打印两遍、`summary.cases` 重复计数。
 */







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


// ---------------------------------------------------------------------------
// 文件级硬错误进 CI 注解通道
// ---------------------------------------------------------------------------
describe("文件级硬错误进 CI 注解通道", () => {
/**
 * 文件级**硬错误**（语法错 / 路径不存在）在两个 **CI 注解通道**上
 * 完全静默：`--gitlab` 的 stdout 塌成 0 字节（消费方 `JSON.parse` 直接抛）、
 * `--gha` 产出 0 条 `::error`；三个机器面对同一失败文件给出 1 / 0 / 0。
 *
 * 现在硬错误也进注解通道：`--gitlab` 的 stdout **恰好一份**可解析数组
 * （含该文件的条目），`--gha` 至少一条 `::error`。
 */






type Row = {
  check_name: string;
  description: string;
  location: { path: string; lines: { begin: number } };
};

/** `.js` 里的 TS-only 语法 ⇒ 语法错通道 */
const BAD = `export function bad(x) {
  return x as number;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug284-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b284", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "bad.js"), BAD, "utf-8");
  return cwd;
}

const annCount = (r: { stdout: string; stderr: string }): number =>
  `${r.stdout}${r.stderr}`.split("::error").length - 1;


  it("--gitlab 语法错文件 ⇒ stdout 是**可解析数组**且含该文件的条目；--gitlab 路径不存在 ⇒ stdout 仍是可解析数组（不是 0 字节）；--gha 语法错文件 ⇒ 至少一条 ::error 注解；批量（坏 + 绿）⇒ 一份数组里同时有语法错行与绿文件无关行（不丢坏文件）", () => {
  {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gitlab", "bad.js"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout.trimStart().startsWith("[")).toBe(true);
      const rows = JSON.parse(r.stdout) as Row[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.some((x) => x.check_name === "syntax-error")).toBe(true);
      expect(rows[0]?.location?.path).toContain("bad.js");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gitlab", "nope.js"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout.trimStart().startsWith("[")).toBe(true);
      const rows = JSON.parse(r.stdout) as Row[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.location?.path).toContain("nope.js");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gha", "bad.js"], { cwd });
      expect(r.status).toBe(1);
      expect(annCount(r)).toBeGreaterThanOrEqual(1);
      expect(`${r.stdout}${r.stderr}`).toContain("::error file=");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const cwd = makeProject();
    try {
      writeFileSync(join(cwd, "ok.js"), "export function ok() {\n  return 1;\n}\n", "utf-8");
      const r = runCliTsx(["check", "--gitlab", "bad.js", "ok.js"], { cwd });
      expect(r.status).toBe(1);
      const rows = JSON.parse(r.stdout) as Row[];
      expect(rows.some((x) => x.check_name === "syntax-error")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});




});


// ---------------------------------------------------------------------------
// `nudo check --json` 载荷不得含内部 id 且与参数位置无关
// ---------------------------------------------------------------------------
describe("`nudo check --json` 载荷不得含内部 id 且与参数位置无关", () => {
/**
 * `nudo check --json` 把**引擎内部 term id**（`len#N` 一族）渲进
 * 机器可读的签名字段 ⇒ 且编号随**同一次调用内的文件顺序**漂移 ⇒
 * **单个文件的 JSON 载荷是它在参数列表中位置的函数**，不是文件内容的函数
 * （机器消费方拿到的不是可比对的内容）；**同一条命令的人类面**还给出另一个
 * 字符串（`f() => number` vs `number = len#0 where len#0 ≥ 0 #path`）。
 *
 * 本钉钉住 CLI 全链三件事：
 * ① 载荷三字段（display / detail / abs）不得含引擎内部 id；
 * ② **同内容不同参数位置 ⇒ 载荷逐字相同**（换序也不变）；
 * ③ 机器面 `display` 与人类面 `signatures` 行**同源**（口径一致）。
 *
 * 磁盘缓存**必须关**（本仓根 package.json 无 `nudo.cache`、夹具在 tmp 目录 ⇒
 * 默认关）：开着缓存时第二轮直接回放第一轮的载荷 ⇒ ② 会在 HEAD 上假绿。
 *
 * ⚠ **cwd 必须是仓库根**（`runCliTsx` 的默认）：tsx 按 **cwd 的 tsconfig**
 * 解析 `@nudojs/*` ⇒ 仓库根的 `tsconfig.json` 有 `paths` ⇒ 走 **src**；
 * 换到夹具目录（无 tsconfig）就会落到 `packages/core/dist/` 的**旧产物**，
 * 测的就不是本次改动的代码。
 */






/** 抽象长度：引擎为「未知长度」铸一个**进程级计数器** var（`len#N`） */
const SRC = `export function f() {
  const a = [1, 2, 3];
  a.length = 5000;
  return a.length;
}
`;

type Sig = { display: string; detail: string; abs: string };

function setup(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-413-"));
  for (const name of ["a.js", "b.js", "c.js"]) {
    writeFileSync(join(dir, name), SRC, "utf8");
  }
  return dir;
}

function runCheck(dir: string, files: string[], args: string[] = []) {
  const paths = files.map((f) => join(dir, f));
  // cwd 保持仓库根（tsx 的 tsconfig paths ⇒ @nudojs/* 走 src）
  return runCliTsx(["check", ...paths, ...args]);
}

/** 单文件（裸 CheckJson）/ 多文件（multi 信封）两种形态 → 按文件名归一 */
function byFile(stdout: string): Record<string, Sig[]> {
  const parsed = JSON.parse(stdout) as {
    kind?: string;
    file?: string;
    signatures?: Sig[];
    reports?: Array<{ file: string; signatures: Sig[] }>;
  };
  const reports = parsed.kind === "multi" ? parsed.reports! : [parsed as never];
  const out: Record<string, Sig[]> = {};
  for (const r of reports) out[basename(r.file)] = r.signatures!;
  return out;
}


  it("三个同内容文件的载荷逐字相同（换序也不变）；载荷三字段不含内部 id；机器面 display 与人类面 signatures 行同源；--verbose 人类面不得含内部 id", () => {
  {
    const dir = setup();
    const r1 = runCheck(dir, ["a.js", "b.js", "c.js"], ["--json"]);
    const r2 = runCheck(dir, ["c.js", "b.js", "a.js"], ["--json"]);
    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);
    const p1 = byFile(r1.stdout);
    const p2 = byFile(r2.stdout);
    expect(Object.keys(p1).sort()).toEqual(["a.js", "b.js", "c.js"]);
    expect(p1["a.js"]).toEqual(p2["a.js"]);
    expect(p1["b.js"]).toEqual(p2["b.js"]);
    expect(p1["c.js"]).toEqual(p2["c.js"]);
  }
  {
    const dir = setup();
    const r = runCheck(dir, ["a.js"], ["--json"]);
    expect(r.stdout).not.toContain("len#");
    const sig = byFile(r.stdout)["a.js"]![0]!;
    expect(sig.display).not.toMatch(/#\d+/);
    expect(sig.detail).not.toMatch(/#\d+/);
    expect(sig.abs).not.toMatch(/#\d+/);
  }
  {
    const dir = setup();
    const human = runCheck(dir, ["a.js"]);
    const machine = runCheck(dir, ["a.js"], ["--json"]);
    const sig = byFile(machine.stdout)["a.js"]![0]!;
    expect(human.stdout).toContain(`  f() => ${sig.display}`);
  }
  {
    const dir = setup();
    const r = runCheck(dir, ["a.js"], ["--verbose"]);
    expect(r.stdout).not.toContain("len#");
  }
});




});


// ---------------------------------------------------------------------------
// export — 部分契约的形参合流（族 17 · S1 · ）
// ---------------------------------------------------------------------------
describe("export — 部分契约的形参合流（族 17 · S1 · ）", () => {
/**
 * **部分契约**（契约只覆盖部分形参）时，未被契约覆盖的形参位在
 * 产物面里被**静默丢掉**：契约面与观测面二选一，不是合流。
 *
 * 症状（改前）：`@nudo:contract n pos` 只声明了 `n`，函数签名是 `f(n, other)`
 * ⇒ zod 面产出 `z.object({ n: z.number().gt(0) })` —— `other` 位**消失**；
 * 同一函数的 dts 面却是 `f(n: number, other: number)` ⇒ 两个产物面自相矛盾。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一参数面在有契约时**直接
 * 返回契约参数表**（`contractParams`），观测面完全不参与 ⇒ 未覆盖的形参位无来源。
 *
 * 修法（族 17 · S1）：契约面与观测面**按形参合流**——契约覆盖的位取契约 Abs，
 * 未覆盖的位取声明形参表 + 观测证据（**不丢位**）。
 *
 * 夹具注：侧车里的约束写成 `NudoConstraint` 的**纯数据形态**（不引
 * `@nudojs/core` 的 builder DSL）⇒ 夹具目录不需要 tsconfig paths 也能加载。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-605-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 侧车约束：number 的纯数据形态 */
const NUM = `export const num = { __nudoConstraint: true, prim: "number", preds: [] };\n`;


  it("zod 入参面：契约覆盖的位 + 未覆盖的形参位都在（不丢位）；dts 面与 zod 面同口径：未覆盖的形参位在 dts 里也在", () => {
  {
    const dir = fixture({
      "c605.nudo.js": NUM,
      "partial605.js": [
        `/// @nudo:import { num } from "./c605.nudo.js"`,
        `/** @nudo:contract n num */`,
        `export function f(n, other) { return n + other; }`,
        `f(1, 2);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "partial605.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    // 契约覆盖的位：契约 Abs
    expect(r.stdout).toContain("n: z.number()");
    // 未被契约覆盖的形参位：**不丢**（改前整个 `other` 位消失）
    expect(r.stdout).toContain("other:");
  }
  {
    const dir = fixture({
      "c605b.nudo.js": NUM,
      "partial605b.js": [
        `/// @nudo:import { num } from "./c605b.nudo.js"`,
        `/** @nudo:contract n num */`,
        `export function f(n, other) { return n + other; }`,
        `f(1, 2);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "partial605b.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(n: number, other: number)");
  }
});


});


// ---------------------------------------------------------------------------
// export — skip 函数的多条见证不进 Output 面（重钉 · 原 ）
// ---------------------------------------------------------------------------
describe("export — skip 函数的多条见证不进 Output 面（重钉 · 原 ）", () => {
/**
 * `@nudo:skip` + 多条 case 见证时，**Output 面（返回面）不产出**：
 * 兜底只取「第 0 条断言见证」，而无断言的 case 是见证不是断言 ⇒ 兜底落空。
 *
 * 症状（改前）：两条 `@nudo:case` 见证（返回 4 / 6）的 skip 函数，zod 面只有
 * `<fn>Input`、**没有** `<fn>Output`；standard 面同样没有 Output；而**参数面**
 * 却 join 了全部见证（`z.union([z.literal(2), z.literal(3)])`）⇒ 同一函数两套口径。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一返回面兜底取
 * `fn.combinedAbs ?? asserted[0]?.abs`（**只**取第 0 条带断言的 case），而参数
 * 面走的是 `domainEvidenceCases`（join 全部域证据）。
 *
 * 修法（族 17 · S1）：返回面兜底改为 join **全部域证据见证**（与参数面同口径）。
 *
 * ⚠ **口径变更后的重钉**（本文件现行断言）：`@nudo:case` 是**调试见证**，
 * 不是契约产品（`docs/concepts/directives.md`：Cases are debug witnesses … not
 * the contract product）⇒ `nudo export` 以 `caseMode: "none"` 调分析器，
 * **发布面不消费 `@nudo:case`**。因此：
 * - 见证**不再**进 `<fn>Output` 面（也不进 `<fn>Input` 面）；
 * - 只带 `@nudo:case`、无契约的 skip 函数 ⇒ 发布面**没有** Output 校验器
 * （域证据为空 ⇒ 返回面无种子），这正是 的口径，不是 的缺陷；
 * - 见证返回值（4 / 6）**不**泄漏进产物。
 *
 * 仍钉住（与本次口径无关的真实行为）：函数**仍出现在产物**里（Input 面照常
 * 产出）、命令 exit 0。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-619-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const SKIP_CASES = [
  `/**`,
  ` * @nudo:skip`,
  ` * @nudo:case "four" (2)`,
  ` * @nudo:case "six" (3)`,
  ` */`,
  `export function twice(data) { return data * 2; }`,
  ``,
].join("\n");


  it("zod 面：见证不进 Output 面，也不泄漏见证返回值；standard 面：同样没有 Output 校验器", () => {
  {
    const dir = fixture({ "skip619.js": SKIP_CASES });
    const r = runCliTsx(["export", join(dir, "skip619.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    // 函数仍出现在产物里（Input 面照常产出）——与见证口径无关的真实行为
    expect(r.stdout).toContain("twiceInput");
    // 见证是调试见证，不进发布面 ⇒ 只带 `@nudo:case` 的 skip 函数
    // 没有 Output 校验器（域证据为空 ⇒ 返回面无种子）
    expect(r.stdout).not.toContain("twiceOutput");
    // 见证返回值（4 / 6）不泄漏进产物
    expect(r.stdout).not.toContain("z.literal(4)");
    expect(r.stdout).not.toContain("z.literal(6)");
  }
  {
    const dir = fixture({ "skip619b.js": SKIP_CASES });
    const r = runCliTsx(["export", join(dir, "skip619b.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    // 函数仍出现在产物里（Input 面照常产出）
    expect(r.stdout).toContain("twiceInput");
    // 见证不进发布面 ⇒ 没有 Output 校验器
    expect(r.stdout).not.toContain("twiceOutput");
  }
});


});


// ---------------------------------------------------------------------------
// export — 点路径契约键的嵌套投影（族 17 · S1 · ）
// ---------------------------------------------------------------------------
describe("export — 点路径契约键的嵌套投影（族 17 · S1 · ）", () => {
/**
 * **点路径**契约键（`"card.grade"`）在产物面里被当成字面量顶层
 * 属性名，约束也被当成**整个形参**的约束。
 *
 * 症状（改前）：侧车 `fn({ "card.grade": string() }, string())` 声明了解构形参
 * `{ card: { grade } }` 的内层字段约束 ⇒ zod 面产出
 * `z.object({ "card.grade": z.string() })`
 * —— 点号键成了对象属性名（调用面里根本没有这个属性），而 dts 面是
 * `nested({ card }: { card: { grade: string } })` ⇒ 两个产物面自相矛盾。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一参数面直接拿契约参数名
 * （`card.grade`）当槽位键、拿约束 Abs 当**整参**的槽值，没有按定位结果展开
 * 点路径。
 *
 * 修法（族 17 · S1）：契约参数按**声明形参表**定位（`locateContractParam`），
 * 点路径 ⇒ 槽位键取路径**首段**（`card`）、槽值是**嵌套 obj**（`{ grade: … }`）。
 *
 * runner 注：侧车要用 `@nudojs/core` 的 builder DSL（点路径键由 `fn()` 归一化）
 * ⇒ 子进程 cwd 下需要 tsconfig.json paths（绝对路径指向仓内 src），与
 * `export-dts-evidence.test.ts` 同口径。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 子进程 tsx 用 tsconfig：@nudojs/* → 仓内 src（vitest 别名的子进程面） */
const SRC_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      paths: {
        "@nudojs/core": [`${repoRoot}packages/core/src`],
        "@nudojs/core/exec": [`${repoRoot}packages/core/src/algebra/exec/index.ts`],
        "@nudojs/core/internal": [`${repoRoot}packages/core/src/internal.ts`],
        "@nudojs/parser": [`${repoRoot}packages/parser/src`],
        "@nudojs/service": [`${repoRoot}packages/service/src`],
        "@nudojs/service/emit": [`${repoRoot}packages/service/src/emit/index.ts`],
        "@nudojs/service/evaluator": [`${repoRoot}packages/service/src/evaluator/evaluator-api.ts`],
        "@nudojs/env/es": [`${repoRoot}packages/env/src/es.ts`],
        "@nudojs/env/web": [`${repoRoot}packages/env/src/web.ts`],
        "@nudojs/env/node": [`${repoRoot}packages/env/src/node.ts`],
        "@nudojs/harvester": [`${repoRoot}packages/harvester/src`],
      },
    },
  },
  null,
  2,
)}\n`;

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-620-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const SOURCE = [
  `export function nested({ card: { grade } }) { return grade + "#"; }`,
  `nested({ card: { grade: "A" } });`,
  ``,
].join("\n");

const SIDECAR = [
  `import { fn, string } from "@nudojs/core";`,
  `export const nested = fn({ "card.grade": string() }, string());`,
  ``,
].join("\n");


  it("zod 入参面：点路径 ⇒ 嵌套 obj（不是字面量点号键）；dts 面保持嵌套形状（两面的节点形状一致）", () => {
  {
    const dir = fixture({ "dotpath620.js": SOURCE, "dotpath620.nudo.js": SIDECAR });
    const r = runCliTsx(["export", join(dir, "dotpath620.js"), "--format", "schema"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("card: z.object({ grade: z.string() })");
    expect(r.stdout).not.toContain('"card.grade"');
  }
  {
    const dir = fixture({ "dotpath620b.js": SOURCE, "dotpath620b.nudo.js": SIDECAR });
    const r = runCliTsx(["export", join(dir, "dotpath620b.js"), "--format", "dts"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "export declare function nested({ card }: { card: { grade: string } }): string;",
    );
  }
});


});


// ---------------------------------------------------------------------------
// 声明式 @nudo:case 不得因名字前缀被丢出断言面
// ---------------------------------------------------------------------------
describe("声明式 @nudo:case 不得因名字前缀被丢出断言面", () => {
/**
 * `nudo test` 的 synthetic 判据必须按 **case 来源**（`c.source`），
 * 不得按 **名字前缀**（`call@` / `entry@`）。
 *
 * 报告原文（`tmp/bugs/19-nudojs-test.md` §）：synthetic 判定用
 * `name.startsWith("call@") || name.startsWith("entry@")` ⇒ 用户**手写**的
 * 声明式见证 `@nudo:case "call@L42" (2) => 5`（实得 4）被降级成合成 case ⇒
 * 失败的声明断言被**整条丢出断言面** ⇒ 报告面「0 failed」、**exit 0**，而
 * 诊断面同时报 `nudo:case-expected` error ⇒ 报告自相矛盾。
 *
 * 该根因**已修**（族 14/15 收口提交 `dde4b037`）：判据改成**来源**判据
 * `c.source !== "directive"`（CLI 面 `packages/nudojs/src/run-test.ts`，
 * 平行副本 `packages/service/src/test-report.ts` 同改）。
 * ⇒ 本文件是**反向守护钉**：钉住「已修」的行为，防止判据被改回**名字前缀**。
 *
 * 断言口径：只钉**语义** —— 声明式 case 出现在断言面（期望不符 ⇒ 计入失败
 * 且 exit ≠ 0；期望相符 ⇒ 计入通过）、与普通名字的见证**同构**；
 * **不钉汇总行的字面量**（汇总行会随断言分类演进而变 ⇒ 与同族其它片不打架）。
 */






/**
 * 声明式见证：名字落在合成 case 名字空间（`call@` / `entry@`），但它是
 * **写在源码里**的 `@nudo:case` 指令 ⇒ 已声明 ⇒ 必须进断言面。
 */
function declaredCase(name: string, expected: string): string {
  return `/** @nudo:case "${name}" (2) => ${expected} */\nexport function double(x) { return x * 2; }\n`;
}

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b651-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


  it("call@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1；entry@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1；--freeze 写回形态的名字（call@<file>:<line>）：仍是声明式见证 ⇒ 计入失败 + exit 1；普通名字的声明式见证：与前缀变体同构（同样计入失败 + exit 1）；call@ 前缀的声明式见证：期望相符 ⇒ 计入通过、exit 0（不是 unchecked / synthetic）", async () => {
  {
    await withTmp(async (dir) => {
      const file = join(dir, "callnamed.js");
      writeFileSync(file, declaredCase("call@L42", "5"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      // 旧行为：被当成 synthetic ⇒ 无 [FAIL] 行、exit 0（报告自相矛盾）
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("call@L42");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "entrynamed.js");
      writeFileSync(file, declaredCase("entry@L42", "5"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("entry@L42");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "frozen.js");
      writeFileSync(file, declaredCase("call@frozen.js:1", "5"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("call@frozen.js:1");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "mycase.js");
      writeFileSync(file, declaredCase("myCase", "5"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("myCase");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "callnamed-ok.js");
      writeFileSync(file, declaredCase("call@L42", "4"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("[FAIL]");
      // 通过的行（不是 [unchecked] 行）⇒ 该 case 计入断言面且被判定通过
      expect(r.stdout).toContain("[ok]");
      expect(r.stdout).toContain("call@L42");
    });
  }
});





});


// ---------------------------------------------------------------------------
// test --abs 与非 --abs 共用同一套「无函数」结论
// ---------------------------------------------------------------------------
describe("test --abs 与非 --abs 共用同一套「无函数」结论", () => {
/**
 * `nudo test --abs` 在**一个函数都没有**的文件上 exit 1 + 打
 * 「Function not found」；同一命令**不带** `--abs` 却 exit 0 ⇒ 同一输入、
 * 同一份报告，仅因多一个旗标就换了退出码，且两条文案互相打架。
 *
 * 根因：`--abs` 分支借道 `runAbsView`，后者把「文件没有函数」当**用法
 * 错误**（exit 1 + 专属文案）——那是 `check --abs` 的既有语义（
 * 钉住的期望行为）⇒ 修法只对 `test` 生效：文件无函数时跳过观察面，
 * 报告与退出码与非 `--abs` 面逐字一致。
 */






const NO_FN_SRC = `export const x = 1;
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-652-"));
  const file = join(cwd, "nofn.js");
  writeFileSync(file, NO_FN_SRC, "utf-8");
  return { cwd, file };
}


  it("无函数文件：--abs 与非 --abs 同为 exit 0 + 同一句报告；无函数文件：--json 面（另一条机器面）同样 exit 0；对照：check --abs 的「无函数 ⇒ exit 1」是既有期望行为（Bug 669）不被本片改动", () => {
  {
    const { cwd, file } = makeProject();
    try {
      const plain = runCli(["test", file], { cwd });
      const abs = runCli(["test", file, "--abs"], { cwd });
      expect(plain.status).toBe(0);
      // 旧症状：--abs 面 exit 1
      expect(abs.status).toBe(0);
      // 两面同一句「无函数可分析」结论
      expect(plain.stdout).toContain("No functions found to analyze.");
      expect(abs.stdout).toContain("No functions found to analyze.");
      // 旧症状：--abs 面多打一行「Function not found」（与上面那句直接打架）
      expect(abs.stderr).not.toContain("Function not found");
      expect(abs.stdout).not.toContain("Function not found");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--json"], { cwd });
      expect(r.status).toBe(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.summary.functions).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["check", file, "--abs"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Function not found");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// check --abs --fn <不存在的名字> ⇒ 用法错误 + 非零 exit
// ---------------------------------------------------------------------------
describe("check --abs --fn <不存在的名字> ⇒ 用法错误 + 非零 exit", () => {
/**
 * `nudo check --abs --fn <不存在的名字>` 被当成「引擎推导失败」
 * （unknown / conf: partial）而不是**用法错误**。
 *
 * 旧行为：`--fn nosuch` ⇒ stdout 打印 `nosuch() / unknown / conf: partial`，
 * 门禁 exit 0（文件本身没函数时反而是 `Function not found` + exit 1 ⇒
 * 同一类错误两个口径）。真名错拼被静默吞掉。
 *
 * 修复：`--fn` 必须是文件里真实存在的顶层函数，否则与「文件没有函数」
 * 同款报错（stderr + fix: 提示）+ 非零 exit。
 */







const ONE = `export function one(){ return 1; }\n`;
const NOFN = `const x = 1;\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-669-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


  it("拼错的函数名 → Function not found + exit 1（不再是 unknown/partial）；真实函数名 → 正常观察面（不误伤）；文件本身没有函数 → 既有口径不变（Function not found + exit 1）；CLI 级：拼错的函数名 → 进程 exit 1（check 报告段不把 exitCode 复位）", async () => {
  {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { fn: "nosuch" });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Function not found");
      expect(r.stderr).toContain("nosuch");
      expect(r.stderr).toContain("fix:");
      // 旧行为：把拼错的名字当「引擎推导失败」打印出来
      expect(r.stdout).not.toContain("nosuch(");
      expect(r.stdout).not.toContain("conf: partial");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { fn: "one" });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("one()");
      expect(r.stderr).not.toContain("Function not found");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "nofn.js");
      writeFileSync(file, NOFN, "utf-8");
      const r = await runAbsViewCaptured(file, { fn: "nosuch" });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Function not found");
      expect(r.stderr).not.toContain("nosuch()");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = runCli(["check", file, "--abs", "--fn", "nosuch"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Function not found");
      expect(r.stdout).not.toContain("nosuch(");
    });
  }
});




});


// ---------------------------------------------------------------------------
// --assume 坏值 ⇒ 用法错误 + 非零 exit
// ---------------------------------------------------------------------------
describe("--assume 坏值 ⇒ 用法错误 + 非零 exit", () => {
/**
 * `--assume` 的**坏值**（形如 `x=5`）只打一行 stderr 就被吞掉，
 * 命令照常跑完并 exit 0 ⇒ CI 里把「假设根本没生效」当成功。
 *
 * 旧行为：stderr 有 `Cannot parse --assume: x=5`，但 exit code = 0。
 * 修复：坏值 = **用法错误**（stderr + fix: 提示）+ 非零 exit，且不进入观察面。
 */







const ONE = `export function one(){ return 1; }\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-670-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("-assume 坏值 ⇒ 用法错误 + 非零 exit", () => {
  it("`x=5` 这类坏值 → exit 1（旧行为 exit 0）；好值仍然生效（不误伤）；多个 --assume 里混一个坏值 → 仍然 exit 1（不得部分生效后假绿）；CLI 级：坏值 → 进程 exit 1", async () => {
  {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x=5"] });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Cannot parse --assume");
      expect(r.stderr).toContain("x=5");
      expect(r.stderr).toContain("fix:");
      // 旧行为：坏值被吞掉后继续跑观察面
      expect(r.stdout).not.toContain("nudo check --abs");
      expect(r.stdout).not.toContain("assume:");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>0"] });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).not.toContain("Cannot parse --assume");
      expect(r.stdout).toContain("assume: x > 0");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>0", "y=5"] });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("Cannot parse --assume");
      expect(r.stdout).not.toContain("assume:");
    });
  }
  {
    await withTmp(async (dir) => {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = runCli(["check", file, "--abs", "--assume", "x=5"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Cannot parse --assume");
    });
  }
});



});
});
