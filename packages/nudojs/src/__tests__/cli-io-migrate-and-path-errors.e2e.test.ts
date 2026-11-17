/**
 * 模块套件：cli-io-migrate-and-path-errors（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot, runCliTsx as runCli } from "./helpers/run-cli.ts";
import { spawnSync } from "node:child_process";
import { type PathError } from "@nudojs/service";
import { migrateStrip } from "../migrate.ts";
import { abs } from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
import { pathToFileURL } from "node:url";


// ---------------------------------------------------------------------------
// 文件级指令随被删语句消失（产物面 + 门禁行为）
// ---------------------------------------------------------------------------
describe("文件级指令随被删语句消失（产物面 + 门禁行为）", () => {
/**
 * 挂在「将被删除的语句」上的**文件级指令**被静默丢掉 ⇒ 产物
 * **失去契约绑定** ⇒ 门禁从**红变绿**（假绿）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（数组分支剔除语句时把它的
 * `leadingComments` **转挂**到下一个幸存节点 + 「剥除前后指令条数比对」的
 * 兜底自检）。本钉是**产物面**的回归钉：
 * ① 指令必须在产物里**存活**；
 * ② 门禁行为正确：`.ts` 源与 `.js` 产物**同样红**（源红 / 产物红 ⇒ 结论
 * 一致；产物绿才是假绿）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SHAPES_NUDO_JS = `export const positive = number().gt(0);
`;
const TYPES_JS = `export const Foo = 1;
`;
const LIB_TS = `/// @nudo:import { positive } from "./shapes.nudo.js"
import type { Foo } from "./types.js";

/**
 * @nudo:contract x positive
 */
export function inc(x) {
  return x + 1;
}

export function caller() {
  return inc(-1);
}
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}


  it("挂在被删语句上的 `/// @nudo:import` 必须在产物里存活；门禁行为正确：源红 / 产物**同样红**（契约仍被绑定 ⇒ 不是假绿）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-968-"));
    dirs.push(dir);
    writeFileSync(join(dir, "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "types.js"), TYPES_JS, "utf-8");
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "lib.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "lib.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    // ★ 指令必须存活（否则契约整条失效 ⇒ 产物绿 = 假绿）
    expect(code).toContain("@nudo:import");
    expect(code).toContain("@nudo:contract x positive");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-968b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "types.js"), TYPES_JS, "utf-8");
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");

    const strip = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "lib.ts")]);
    expect(strip.status, strip.stderr).toBe(0);

    for (const name of ["lib.ts", "lib.js"]) {
      const c = runCli(["check", join(dir, name), "--entry-throws", "off"]);
      expect(c.status, `${name}\n${c.stdout}\n${c.stderr}`).toBe(1);
      expect(c.stdout).toContain("nudo:constraint-violated");
    }
  }
});


});


// ---------------------------------------------------------------------------
// nudo test --from 模块解析失败不得静默放过
// ---------------------------------------------------------------------------
describe("nudo test --from 模块解析失败不得静默放过", () => {
/**
 * `nudo test --from <callsite>` 对**模块解析失败**
 * （import 不存在的模块 / 不存在的导出）**静默放过**：零提示、零 `call@`、
 * **exit 0 假绿**（而语法错 / 顶层抛错**有**报错）—— **的半修**
 * （只补了「求值抛错」这一档）。
 *
 * 修法（CLI 面，`packages/nudojs/src/commands/shared.ts`）：现场文件探针
 * `probeCallsiteFile` 补**第三档**「模块解析失败」——求值**成功**（lenient
 * 装载器给未解析的 import 补 stub，模块体继续跑完）但引擎的 `moduleIssues`
 * 报 `missing` / `missing-export` ⇒ **调用点已丢** ⇒ 判为「现场文件读失败」
 * （pathMissingCallsite 家族）⇒ 明确报错 + 非 0 退出。
 *
 * ⚠ 探针**不能**再挂在「0 条记录」分支上：模块解析失败时记录**非空**
 * （指向一个不存在的函数，下游被丢弃）⇒ 只挂 0 记录分支永远测不到第三档。
 *
 * 本文件锁：模块解析失败必须报错 + 非 0 退出；可读且模块可解析的邻近形态
 * （有调用 / 无调用）**不得**被这条修复波及（负控制）；的两档
 * （语法错 / 顶层抛错）**不得**被这条修复改口径（回归锁）。
 */






/** 被测文件：导出 add（entry-only） */
const TARGET_SRC = `export function add(a, b) {
  return a + b;
}
`;
/** 现场文件：import **不存在的模块** ⇒ 模块解析失败 */
const MISSING_MOD_SRC = `import { nope } from "./does-not-exist.js";
const r = nope(1);
`;
/** 现场文件：import **不存在的导出** ⇒ 模块解析失败 */
const MISSING_EXPORT_SRC = `import { missing } from "./target.js";
const r = missing(1);
`;
/** 现场文件：可解析可求值、模块可解析、有调用 */
const CALL_SRC = `import { add } from "./target.js";
const r = add(1, 2);
`;
/** 现场文件：可解析可求值、模块可解析、没有调用 */
const NO_CALL_SRC = `export function helper() {
  return 0;
}
`;
/** 现场文件：语法错（第一档） */
const SYNTAX_ERR_SRC = `import { add } from "./target.js";
const x = add(1, 2
`;
/** 现场文件：顶层抛错（第二档） */
const TOPLEVEL_THROW_SRC = `throw new Error("boom");
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1060-"));
  writeFileSync(join(dir, "package.json"), `{ "name": "nudo-1060", "private": true, "type": "module" }`, "utf-8");
  writeFileSync(join(dir, "target.js"), TARGET_SRC, "utf-8");
  writeFileSync(join(dir, "missing-mod.js"), MISSING_MOD_SRC, "utf-8");
  writeFileSync(join(dir, "missing-export.js"), MISSING_EXPORT_SRC, "utf-8");
  writeFileSync(join(dir, "call.js"), CALL_SRC, "utf-8");
  writeFileSync(join(dir, "nocall.js"), NO_CALL_SRC, "utf-8");
  writeFileSync(join(dir, "syntaxerr.js"), SYNTAX_ERR_SRC, "utf-8");
  writeFileSync(join(dir, "toplevel-throw.js"), TOPLEVEL_THROW_SRC, "utf-8");
  return dir;
}


  it("import 不存在的模块 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）；import 不存在的导出 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）；--json 面：pathErrors 收录该失败 + exit 1（改前：pathErrors 为空 + exit 0）；负控制：现场文件模块可解析且有调用 ⇒ call@ 而非 entry@ + exit 0；负控制：现场文件模块可解析但没有调用 ⇒ 不报错 + exit 0", () => {
  {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "missing-mod.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("missing-mod.js");
      expect(r.stderr).toContain("module resolution failed");
      // 报错要指名道姓：装不上的模块是谁
      expect(r.stderr).toContain("does-not-exist.js");
      expect(r.stderr).toContain("fix:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "missing-export.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("missing-export.js");
      expect(r.stderr).toContain("module resolution failed");
      expect(r.stderr).toContain("missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture();
    try {
      const r = runCli(["test", "--json", "target.js", "--from", "missing-mod.js"], { cwd: dir });
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout) as {
        pathErrors: { path: string; code: string; message: string }[];
      };
      expect(json.pathErrors).toHaveLength(1);
      expect(json.pathErrors[0]!.path).toContain("missing-mod.js");
      expect(json.pathErrors[0]!.code).toBe("nudo:path-missing-callsite");
      expect(json.pathErrors[0]!.message).toContain("Callsite file failed to load");
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
      const r = runCli(["test", "target.js", "--from", "syntaxerr.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("parse failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "toplevel-throw.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("evaluation failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});







});


// ---------------------------------------------------------------------------
// migrate strip --json 的逐文件隔离与 path 量纲
// ---------------------------------------------------------------------------
describe("migrate strip --json 的逐文件隔离与 path 量纲", () => {
/**
 * `nudo migrate strip --json` 的 `pathErrors[].path` **混用两种量纲**
 * （目标**目录** vs 失败**文件**），且同目标内**成功文件的逐文件结果被整条丢弃**。
 *
 * 症状（目标目录里混一个语法错文件：`a-good.ts` + `z-bad.ts`）：
 * 1. 库面（`packages/nudojs/src/migrate.ts`，族 56b）已按**逐文件隔离**改好 ——
 * `migrateStrip` 返回「成功行 + 失败行」，失败行自带 `file`；但 CLI 命中
 * `plan.find(r => r.code !== undefined)` 后直接 `continue` ⇒ 该目标**所有**
 * 成功行一并丢掉 ⇒ 机器消费者拿不到「哪些文件本来可以迁移」。
 * 2. 失败条目的 `path` 填的是**目标目录**而不是失败文件，而同一数组里
 * TS-only 闸门失败填的是**文件**（`path: l.file`）⇒ `path` 量纲不一致；
 * 消费者要定位坏文件只能去解析 message 里的文件名字符串。
 *
 * 修复：失败条目的 `path` 改用库面失败行的 `file`（失败**文件**）；同目标内的
 * 成功行**照常透出**（写盘轮按库面已附的「未写盘」注记透出）⇒ 原子性不变
 * （有失败 ⇒ 零写盘），但「哪些文件本来可以迁移」这一事实不再丢。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1086-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripEnvelope = {
  ok?: boolean;
  action?: string;
  results?: Array<{ file: string; outFile: string; notes?: string[] }>;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
  error?: string;
};


  it("混合目录 ⇒ results 保留成功文件的逐文件结果（不再整目标丢弃）；失败条目的 path 是**失败文件**（不是目标目录）⇒ 与 TS-only 闸门同量纲；pathErrors[] 内所有 path 量纲一致（都是文件，不是目录）；--write：成功行带库面的「未写盘」注记，且原子性不变（一个字节都不落盘）；负控：全部成功 ⇒ stdout 仍是顶层数组（形状不变）", () => {
  {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCli(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    // 成功文件的行**仍在** results 里（旧行为：整目标丢弃 ⇒ results 为空）
    expect(parsed.results?.length ?? 0).toBe(1);
    expect(parsed.results?.[0]?.file).toBe("a-good.ts");
    expect(parsed.results?.[0]?.outFile).toBe("a-good.js");
  }
  {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCli(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    const p = parsed.pathErrors![0]!.path;
    // 是**文件**（旧行为：目标目录 "."）
    expect(p).toBe("z-bad.ts");
    expect(p.endsWith(".ts")).toBe(true);
    expect(p).not.toBe(".");
    // 失败详情仍逐字沿用库面文案（带文件名）
    expect(parsed.pathErrors![0]!.message).toContain("z-bad.ts");
    expect(parsed.pathErrors![0]!.code).toBe("nudo:migrate-strip-failed");
    // stderr 仍带文件名（人类面不回归）
    expect(r.stderr).toContain("z-bad.ts");
  }
  {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCli(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    const paths = (parsed.pathErrors ?? []).map((e) => e.path);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      // 文件级量纲（不是目录）⇒ 与 `results[].file` 同量纲
      expect(p.endsWith(".ts"), `path=${p}`).toBe(true);
      expect(p).not.toBe(".");
      expect(p).not.toBe(dir);
    }
  }
  {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCli(["migrate", "strip", "--json", "--write", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    // 成功行仍在 results 里，且带「未写盘」注记（不被误读成已写盘）
    expect(parsed.results?.length ?? 0).toBe(1);
    expect(parsed.results?.[0]?.file).toBe("a-good.ts");
    expect(parsed.results?.[0]?.notes?.join(" ")).toContain("not written");
    // 失败条目的 path 仍是**文件**
    expect(parsed.pathErrors?.[0]?.path).toBe("z-bad.ts");
    // 原子性：零写盘
    expect(existsSync(join(dir, "a-good.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  }
  {
    const dir = dirWith({ "a-good.ts": GOOD });
    const r = runCli(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file).toBe("a-good.ts");
  }
});





});


// ---------------------------------------------------------------------------
// 用法错误的机器码三动词统一（nudo:usage-error）
// ---------------------------------------------------------------------------
describe("用法错误的机器码三动词统一（nudo:usage-error）", () => {
/**
 * 用法错误的机器码在三个动词间**分叉** ⇒ 同一类错误产出**不同的
 * `pathErrors[].code`** ⇒ 机器消费者必须为 `test` 单独维护一张码表。
 *
 * 实测（改前）：`nudo check --json`（无路径）⇒ `"nudo:usage-error"`；
 * `nudo contract --json`（无路径）⇒ `"nudo:usage-error"`；
 * `nudo test --json`（无路径）⇒ **`"usage-error"`**。
 *
 * 修复：`test` 面的用法错误码改成 `"nudo:usage-error"`（与 check / contract
 * 对齐）；`"syntax-error"` 保持不变（与 check 面同码）。
 *
 * 负控：非 `--json` 面的人读文案与 exit 码不变。
 */






type PathError = { path: string; code: string; message: string };
type Doc = { ok?: boolean; pathErrors?: PathError[] };

/** 各动词的 `--json` 文档形状不同（check/test = 单文档；contract = 文档数组） */
function firstPathError(stdout: string): PathError | undefined {
  const parsed = JSON.parse(stdout) as Doc | Doc[];
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  for (const d of docs) {
    if (d.pathErrors && d.pathErrors.length > 0) return d.pathErrors[0];
  }
  return undefined;
}

{
  const verbs = ["check", "contract", "test"] as const;

  for (const verb of verbs) {
    it(`CLI：${verb} --json（无路径）⇒ pathErrors[0].code === "nudo:usage-error"`, () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1087-"));
      try {
        const r = runCli([verb, "--json"], { cwd: dir });
        expect(r.status).toBe(1);
        // stdout 永不为空（机器面契约）
        expect(r.stdout.trim().length).toBeGreaterThan(0);
        const err = firstPathError(r.stdout);
        expect(err, `stdout:\n${r.stdout}`).toBeDefined();
        expect(err!.code).toBe("nudo:usage-error");
        expect(err!.message.length).toBeGreaterThan(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("负控：非 --json 面仍是 stderr 文案 + exit 1（人读面不回归）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1087-human-"));
    try {
      for (const verb of verbs) {
        const r = runCli([verb], { cwd: dir });
        expect(r.status, `${verb}: ${r.stderr}`).toBe(1);
        expect(r.stdout).toBe("");
        expect(r.stderr).toContain("Usage error");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
});


// ---------------------------------------------------------------------------
// migrate strip --write 的写盘状态（人类面不谎称 / 机器面可判定）
// ---------------------------------------------------------------------------
describe("migrate strip --write 的写盘状态（人类面不谎称 / 机器面可判定）", () => {
/**
 * `nudo migrate strip --write` 把「**未写盘**」的成功行报成 `wrote`。
 *
 * 症状（目标目录里混一个语法错文件：`good.ts` + `bad.ts`）：
 * 1. **人类面说谎**：stdout 打 `wrote good.ts → good.js`，而磁盘上**根本没有**
 * `good.js`（库面原子性：批内有失败 ⇒ 整批零写盘，）⇒ 同一行下面还
 * 跟着一句 `note: not written — …` ⇒ **同一行既说「wrote」又说「not
 * written」**（自相矛盾）。
 * 2. **机器面不可判定**：`--json` 的 `results[]` 里该行带 `outFile`
 * （`good.js`）⇒ 消费方**只能靠一条自由文本 `notes`** 才能区分「计划成功」
 * 与「已写盘」⇒ 极易误判已产出。
 *
 * 根因（两半）：
 * - 库面（`packages/nudojs/src/migrate.ts`）有失败时**整批零写盘**，但把成功行
 * 的结果一并返回（结果不丢是对的）⇒ 附注记 `STRIP_NOT_WRITTEN_NOTE`。
 * - 命令层（`packages/nudojs/src/commands/migrate.ts`）把这些成功行当普通成功行
 * 推入 `results`，人类面又**无条件**按 `--write` 打 `wrote`。
 *
 * 修法：
 * - 库面：逐行给**写盘状态**（机器面枚举）：写盘轮全成功 ⇒ `written`；批内有
 * 失败 ⇒ 整批 `not-written`（dry-run 的行不带此键，命令层补 `planned`）。
 * - 命令层：人类面措辞由**逐行**的写盘状态决定（`wrote` / `not written` /
 * `dry`）⇒ 未写盘**不得**打 `wrote`；`--json` 的每一行都带 `writeStatus`
 * ⇒ 消费方只读结构化字段即可判定。
 *
 * 必须保持的不变量（负控）：
 * - **整批零写盘的原子性不变**（）：有失败 ⇒ 磁盘上一个 `.js` 都没有。
 * - **成功行的结果不丢**：失败批次里「本来可以迁移」的文件仍出现在 `results[]`。
 * - **退出码语义不变**：有失败 ⇒ 非 0；全成功 ⇒ 0。
 * - `pathErrors[]` 的内容与量纲不变（失败**文件**，不是目标目录 —— ）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1100-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripRow = {
  file: string;
  outFile: string;
  notes?: string[];
  /** 写盘状态（机器面 · ）：`written` / `not-written` / `planned` */
  writeStatus?: string;
};

type StripEnvelope = {
  ok?: boolean;
  action?: string;
  results?: StripRow[];
  pathErrors?: Array<{ path: string; code: string; message: string }>;
  error?: string;
};


  it("验收 1：批内有失败文件 + --write ⇒ 人类面**不打** `wrote`，且磁盘上零产出；验收 2：同场景 --json ⇒ results[] 的该行带**机器可判定**的「未写盘」标记；验收 3：全部成功 + --write ⇒ 人类面照旧打 `wrote`，产物真实落盘，标记为「已写盘」；验收 4：退出码语义不变（有失败 ⇒ 非 0；全成功 ⇒ 0）；负控：dry-run（不带 --write）⇒ 人类面是 `dry`（不是 `wrote`），标记为「计划」", async () => {
  {
    const dir = dirWith({ "good.ts": GOOD, "bad.ts": BAD });

    const r = runCli(["migrate", "strip", "--write", "."], { cwd: dir });

    // 人类面：该行必须显示为「未写盘」，**不得**出现 `wrote`
    expect(r.stdout).not.toMatch(/^wrote /m);
    expect(r.stdout).toContain("not written");
    expect(r.stdout).toContain("good.ts");
    // 失败详情走 stderr（带文件名）
    expect(r.stderr).toContain("bad.ts");
    // 原子性：一个字节都没落盘
    expect(existsSync(join(dir, "good.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  }
  {
    const dir = dirWith({ "good.ts": GOOD, "bad.ts": BAD });

    const r = runCli(["migrate", "strip", "--json", "--write", "."], { cwd: dir });

    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    // 结果**不丢**（成功行仍在 results[] 里）
    expect(parsed.results?.length ?? 0).toBe(1);
    const row = parsed.results![0]!;
    expect(row.file).toBe("good.ts");
    expect(row.outFile).toBe("good.js");
    // 机器可判定：**只读结构化字段**就能判定「没落盘」（不必解析 notes）
    expect(row.writeStatus).toBe("not-written");
    expect(row.writeStatus).not.toBe("written");
    // 失败路径的量纲不变（失败**文件**，不是目标目录 —— ）
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors![0]!.path).toBe("bad.ts");
  }
  {
    const dir = dirWith({ "good.ts": GOOD });

    const r = runCli(["migrate", "strip", "--write", "."], { cwd: dir });

    expect(r.stdout).toMatch(/^wrote {2}good\.ts → good\.js$/m);
    expect(r.stdout).not.toContain("not written");
    // 产物真的落盘
    expect(existsSync(join(dir, "good.js"))).toBe(true);

    // 机器面：标记为「已写盘」
    const j = runCli(["migrate", "strip", "--json", "--write", "."], { cwd: dir });
    const parsed = JSON.parse(j.stdout) as StripRow[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]!.writeStatus).toBe("written");
  }
  {
    const bad = dirWith({ "good.ts": GOOD, "bad.ts": BAD });
    const good = dirWith({ "good.ts": GOOD });

    expect(runCli(["migrate", "strip", "--write", "."], { cwd: bad }).status).toBe(1);
    expect(runCli(["migrate", "strip", "--json", "--write", "."], { cwd: bad }).status).toBe(1);
    expect(runCli(["migrate", "strip", "--write", "."], { cwd: good }).status).toBe(0);
    expect(runCli(["migrate", "strip", "--json", "--write", "."], { cwd: good }).status).toBe(0);
  }
  {
    const dir = dirWith({ "good.ts": GOOD });

    const r = runCli(["migrate", "strip", "."], { cwd: dir });

    expect(r.stdout).not.toMatch(/^wrote /m);
    expect(r.stdout).toMatch(/^dry {2}good\.ts → good\.js$/m);
    expect(existsSync(join(dir, "good.js"))).toBe(false);

    const j = runCli(["migrate", "strip", "--json", "."], { cwd: dir });
    const parsed = JSON.parse(j.stdout) as StripRow[];
    expect(parsed[0]!.writeStatus).toBe("planned");
  }
  {
    const mixed = dirWith({ "good.ts": GOOD, "bad.ts": BAD });
    const rows = await migrateStrip([mixed], { write: true, draft: false });
    const good = rows.find((r) => r.file.endsWith("good.ts"))!;
    expect(good.writeStatus).toBe("not-written");
    // 原子性不变（）
    expect(readdirSync(mixed).filter((f) => f.endsWith(".js"))).toHaveLength(0);

    const ok = dirWith({ "good.ts": GOOD });
    const okRows = await migrateStrip([ok], { write: true, draft: false });
    expect(okRows[0]!.writeStatus).toBe("written");
    expect(existsSync(join(ok, "good.js"))).toBe(true);
  }
});






});


// ---------------------------------------------------------------------------
// migrate strip 的失败码走 DIAG 注册表
// ---------------------------------------------------------------------------
describe("migrate strip 的失败码走 DIAG 注册表", () => {
/**
 * `nudo:migrate-strip-failed` 必须走**稳定诊断码注册表**
 * （`@nudojs/core/internal` 的 `DIAG`），不得在 CLI 层直写字面量。
 *
 * 旧行为：`packages/nudojs/src/commands/migrate.ts` 的 `--json` 信封里直接写
 * `code: "nudo:migrate-strip-failed"` 字面量 ⇒ 绕过 `DIAG` 注册表 ⇒
 * - 码的**拼写**在生产面有两处真理源（注册表外的字面量 + 术语表）；
 * - 术语表反向对账（website docs-coverage rule 19）只能靠「src 字面量扫描」
 * 兜底，一旦 CLI 层改写法（变量 / 拼接）该码就会变成**永久幻影**
 * （文档里有、实现里扫不到 ⇒ rule 19 误报 phantom）。
 *
 * 新行为：码进 `DIAG` 注册表（键 `migrateStripFailed`），CLI 层引用常量。
 *
 * 断言口径：
 * - 产出的 `pathErrors[].code` **等于注册表常量**（不是另写的字面量）；
 * - 该码**在注册表里存在**（`Object.values(DIAG)` 含它）；
 * - 生产 src 里**不再残留**该码的裸字面量赋值（`code: "nudo:…"` 形态）。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1143-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripEnvelope = {
  ok?: boolean;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
};


  it("注册表里存在该码（键名 migrateStripFailed）；产出的 pathErrors[].code 等于注册表常量（不是另写的字面量）；生产 src 不再残留该码的裸字面量赋值（`code: \"nudo:…\"` 形态）", () => {
  {
    expect(DIAG.migrateStripFailed).toBe("nudo:migrate-strip-failed");
    expect(Object.values(DIAG)).toContain("nudo:migrate-strip-failed");
  }
  {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCli(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as StripEnvelope[];
    const parsed = __env[0]!;
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    // 非空字符串（防「两边都是 undefined ⇒ 断言空过」）
    expect(typeof parsed.pathErrors![0]!.code).toBe("string");
    expect(parsed.pathErrors![0]!.code).toBe(DIAG.migrateStripFailed);
    expect(parsed.pathErrors![0]!.code).toBe("nudo:migrate-strip-failed");
  }
  {
    const src = readFileSync(
      join(repoRoot, "packages/nudojs/src/commands/migrate.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/code:\s*"nudo:migrate-strip-failed"/);
    // 引用注册表常量
    expect(src).toContain("DIAG.migrateStripFailed");
  }
});



});


// ---------------------------------------------------------------------------
// CLI：不可读依赖 ⇒ 明确诊断 + 非零退出（不谎报「不存在」）
// ---------------------------------------------------------------------------
describe("CLI：不可读依赖 ⇒ 明确诊断 + 非零退出（不谎报「不存在」）", () => {
/**
 * 回归（CLI 面）：**依赖模块不可读（EACCES）**不得被说成「文件不存在」，
 * 也不得让异常冒到整轮外面。
 *
 * 口径（core 侧 load-guard + service 侧 ModuleReadError 同源）：
 * - 不可读 ⇒ 一条明确诊断（写明「读不到」+ errno），严重级 error ⇒ 非零退出；
 * - 不可读 ≠ 不存在（诊断文案不得出现「not found」）；
 * - 整轮仍产出报告（stdout 非空），不是「0 字节无报告」。
 *
 * root 对 chmod 000 免疫 ⇒ 真实 EACCES 用例在 root 下跳过。
 *
 * cwd 固定为仓库根（repoRoot）：tsx 的 tsconfig `paths` 解析以 cwd 为准
 * ——cwd 在仓库外时 `@nudojs/core` 会落到 package.json exports 的 dist
 * （未 build 时是陈旧产物），本用例要验的 core 侧 load-guard 就不在。
 * 仓库根 ⇒ core/service 走 src（CI build 后同样走 src，行为一致）。
 */






const isRoot = process.geteuid?.() === 0;

const MAIN = `import { probe } from "./dep.js";
export function run() {
  return probe();
}
`;
const DEP = `export function probe() {
  return 0;
}
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-499-cli-"));
  writeFileSync(join(dir, "main.js"), MAIN, "utf-8");
  writeFileSync(join(dir, "dep.js"), DEP, "utf-8");
  return dir;
}

{
  it.runIf(!isRoot)("chmod 000 的依赖 ⇒ EACCES 诊断 + exit 1 + 报告非空", () => {
    const dir = fixture();
    const dep = join(dir, "dep.js");
    chmodSync(dep, 0o000);
    try {
      const r = runCli(["check", join(dir, "main.js")], { cwd: repoRoot });
      // 报告非空（不是「整轮抛未捕获异常 ⇒ stdout 0 字节」）
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(r.stdout).toContain("nudo check");
      // 明确诊断：写明读不到 + errno
      expect(r.stdout).toContain("cannot read module");
      expect(r.stdout).toContain("EACCES");
      // 不可读 ≠ 不存在
      expect(r.stdout).not.toContain("not found");
      expect(r.stdout).not.toContain("Module file not found");
      // 非零退出（门禁 fail-closed）
      expect(r.status).toBe(1);
    } finally {
      chmodSync(dep, 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(!isRoot)("--json 面：ok:false + error 级 issue + 非零退出", () => {
    const dir = fixture();
    const dep = join(dir, "dep.js");
    chmodSync(dep, 0o000);
    try {
      const r = runCli(["check", "--json", join(dir, "main.js")], { cwd: repoRoot });
      const json = JSON.parse(r.stdout) as {
        ok: boolean;
        summary: { errors: number };
        issues: { code: string; severity: string; message: string }[];
      };
      expect(json.ok).toBe(false);
      expect(json.summary.errors).toBeGreaterThan(0);
      expect(r.status).toBe(1);
      const readErr = json.issues.filter((i) => i.message.includes("cannot read module"));
      expect(readErr.length).toBeGreaterThan(0);
      for (const i of readErr) expect(i.severity).toBe("error");
    } finally {
      chmodSync(dep, 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：依赖可读 ⇒ 无「cannot read module」诊断，门禁绿", () => {
    const dir = fixture();
    try {
      const r = runCli(["check", join(dir, "main.js")], { cwd: repoRoot });
      expect(r.stdout).not.toContain("cannot read module");
      expect(r.stdout).toContain("run() => 0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
});


// ---------------------------------------------------------------------------
// nudojs : standard 产物的字面量保真
// ---------------------------------------------------------------------------
describe("nudojs : standard 产物的字面量保真", () => {
/**
 * / `nudo export --format standard` 的**产品面**回归。
 *
 * 修前：standard 节点经 `JSON.stringify` 落地 ⇒ `Infinity` 静默变 `null` ⇒
 * 导出的校验器**拒绝函数必返的值**、**放行函数永不返回的 `null`**（schema 与
 * 函数完全反向）；bigint 字面量则让整条 export **崩溃、零产物**（`--format all`
 * 下四个方言的产物一起丢）。
 *
 * 修后：节点走保真序列化 ⇒ 产物放行 `Infinity`、拒绝 `null`；bigint 契约的
 * export 不再崩溃（四个方言的产物都在）。
 */







type StdExport = {
  "~standard": {
    validate(value: unknown): {
      value?: unknown;
      issues?: ReadonlyArray<{ message?: string }>;
    };
  };
};


  it("export --format standard：Infinity 放行、null 拒绝（不再折成 null）；export --format all：bigint 字面量契约不再让整条命令崩溃（零产物）", async () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-standard-inf-"));
    const file = join(dir, "divzero.js");
    writeFileSync(
      file,
      "export function divZero() { return 1 / 0; }\nexport function okNum() { return 42; }\n",
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);

    const p = join(out, "divZero.nudo.standard.ts");
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, "utf-8");
    // 修前：{"k":"lit","value":null}
    expect(body).toContain('"value":Infinity');
    expect(body).not.toContain('"value":null');

    const mod = (await import(pathToFileURL(p).href)) as unknown as Record<string, StdExport>;
    const validate = mod.divZeroOutput!["~standard"].validate;
    expect(validate(Infinity).issues).toBeUndefined();
    const nul = validate(null);
    expect(nul.issues).toBeDefined();
    expect(nul.issues?.[0]?.message).toContain("expected Infinity");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-standard-big-"));
    const file = join(dir, "big.js");
    writeFileSync(file, "export function bigAdd(a) { return a; }\n", "utf-8");
    writeFileSync(
      join(dir, "big.nudo.js"),
      // 侧车的契约形参名必须与函数形参表一致（`bigAdd(a)` ⇒ `a`）：写成 `n` 时
      // `nudo check` 判 `nudo:contract-param-mismatch`（error）⇒ 导出面按契约
      // 一致性闸门拒绝发布产物（）。
      'import { fn, lit } from "@nudojs/core";\nexport const bigAdd = fn({ a: lit(10n) }, lit(10n));\n',
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "all", "--out", out]);
    // 修前：exit 1 +「Do not know how to serialize a BigInt」+ 产物 0 个
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("Do not know how to serialize a BigInt");
    // 四个方言的产物都在（standard 面不再连坐其它方言）
    expect(existsSync(join(out, "big.nudo.schema.zod.ts"))).toBe(true);
    expect(existsSync(join(out, "big.nudo.guard.ts"))).toBe(true);
    expect(existsSync(join(out, "big.d.ts"))).toBe(true);
    const std = join(out, "bigAdd.nudo.standard.ts");
    expect(existsSync(std)).toBe(true);
    expect(readFileSync(std, "utf-8")).toContain('"value":10n');
  }
});


});


// ---------------------------------------------------------------------------
// --dry-run 与 --write 同时给出时以 dry-run 为准
// ---------------------------------------------------------------------------
describe("--dry-run 与 --write 同时给出时以 dry-run 为准", () => {
/**
 * `nudo check --fix --write --dry-run` 仍**落盘**（--dry-run 被静默忽略）。
 *
 * 症状：--dry-run 与 --write 同时给出时 write 胜出 ⇒ 磁盘被改、侧车被写；
 * 用户以为在演练、实际改了仓库。修复：--dry-run 优先（与兄弟命令同款口径：
 * `nudo contract --draft --write --dry-run` / `nudo test --freeze --dry-run`
 * 都是「只打印、不落盘」）。
 */






const SRC = `export function staticName(node) {
  return node.type;
}
`;

function makeProject(): { cwd: string; file: string; sidecar: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-629-"));
  const file = join(dir, "helper.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file, sidecar: join(dir, "helper.nudo.js") };
}

describe("-dry-run 与 --write 同时给出时以 dry-run 为准", () => {
  it("CLI：--fix --write --dry-run 只打印计划、**不落盘**；CLI：--fix --write（不带 --dry-run）仍落盘（旧口径不回归）；CLI：--fix（不带 --write）只打印计划、不落盘（默认值不回归）", () => {
  {
    const { cwd, file, sidecar } = makeProject();
    try {
      const r = runCli(["check", file, "--fix", "--write", "--dry-run"], { cwd });
      const out = r.stdout + r.stderr;
      // 计划面：打印 diff + 「planned (dry-run)」
      expect(out).toContain("planned (dry-run)");
      expect(out).not.toContain("edit(s) written");
      // 磁盘面：侧车不生成、源文件不变
      expect(existsSync(sidecar)).toBe(false);
      expect(readFileSync(file, "utf-8")).toBe(SRC);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file, sidecar } = makeProject();
    try {
      const r = runCli(["check", file, "--fix", "--write"], { cwd });
      const out = r.stdout + r.stderr;
      expect(out).toContain("edit(s) written");
      expect(existsSync(sidecar)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file, sidecar } = makeProject();
    try {
      const r = runCli(["check", file, "--fix"], { cwd });
      const out = r.stdout + r.stderr;
      expect(out).toContain("planned (dry-run)");
      expect(existsSync(sidecar)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});


});
});


// ---------------------------------------------------------------------------
// check 输入读取失败 ⇒ 显式 pathError（nudo:path-io）
// ---------------------------------------------------------------------------
describe("check 输入读取失败 ⇒ 显式 pathError（nudo:path-io）", () => {
/**
 * `check --json` 遇**输入读取失败**（EACCES）⇒ stdout 0 字节 + 裸 errno。
 *
 * 旧实现：`runCheck` 的 `readFileSync` 无 try/catch ⇒ 异常逃逸出命令层 ⇒
 * 顶层兜底只打一行裸 errno ⇒ `--json` 面 **stdout 0 字节** + exit 1
 * （违反 cli-semantics「--json 下 stdout 永不为空 / 绝不出现空 stdout + 非零
 * exit」）。同族的其它路径错误（不存在 / 空目录 / 非目标）都走 `pathErrors[]`
 * 信封，唯独「读输入」这条路漏了。
 *
 * 修复：读输入包 try/catch ⇒ 归一到 `PathError{code:"nudo:path-io"}`：
 * - `--json` 面 ⇒ 信封 `ok:false` + `pathErrors[{code:"nudo:path-io"}]`，stdout 非空；
 * - 人类面 ⇒ 一行 message + `fix:` 提示（同一 face）。
 *
 * 注：以 root 运行时 chmod 000 拦不住读取 ⇒ 该用例跳过（root 环境下无法
 * 构造 EACCES；非 root 环境正常跑）。
 */






const SRC = "export function f(x){ return x; }\n";

/** 造一个「存在但不可读」的文件；返回 undefined 表示本机拦不住（root） */
function makeUnreadable(dir: string): string | undefined {
  const file = join(dir, "u.js");
  writeFileSync(file, SRC, "utf-8");
  chmodSync(file, 0o000);
  try {
    readFileSync(file, "utf-8");
    return undefined; // 仍可读 ⇒ root / 特殊挂载
  } catch {
    return file;
  }
}


  it("--json 面：stdout 非空 + 信封 ok:false + pathErrors[nudo:path-io] + exit 1；人类面：message + fix: 提示（不是裸 errno）+ exit 1；对照：缺文件走既有 nudo:path-not-found 信封（不被本次改动影响）", () => {
__scenario_1: {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug630-"));
    try {
      const file = makeUnreadable(dir);
      if (file === undefined) break __scenario_1; // root：无法构造 EACCES
      const r = runCli(["check", file, "--json"]);
      expect(r.stdout.length, "stdout 不得为空（--json 面永不为空）").toBeGreaterThan(0);
      const env = JSON.parse(r.stdout) as {
        ok: boolean;
        reports: unknown[];
        pathErrors?: Array<{ code: string; path: string; message: string }>;
      };
      expect(env.ok).toBe(false);
      expect(env.reports).toEqual([]);
      expect(env.pathErrors).toHaveLength(1);
      expect(env.pathErrors?.[0]?.code).toBe("nudo:path-io");
      expect(env.pathErrors?.[0]?.path).toContain("u.js");
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
__scenario_2: {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug630-"));
    try {
      const file = makeUnreadable(dir);
      if (file === undefined) break __scenario_2; // root
      const r = runCli(["check", file]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("fix:");
      expect(r.stderr).toMatch(/Cannot read .*u\.js/);
      // 旧实现：stderr 只有一行裸 errno（「EACCES: permission denied, open …」）
      expect(r.stderr.trim().split("\n")).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug630-"));
    try {
      const r = runCli(["check", join(dir, "nope.js"), "--json"]);
      const env = JSON.parse(r.stdout) as {
        ok: boolean;
        pathErrors?: Array<{ code: string }>;
      };
      expect(env.ok).toBe(false);
      expect(env.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// check --json --gitlab：GitLab 注解不再被丢弃
// ---------------------------------------------------------------------------
describe("check --json --gitlab：GitLab 注解不再被丢弃", () => {
/**
 * `nudo check --json --gitlab`：GitLab 注解数组被**整段丢弃**
 * （既不进 stdout 也不进 stderr）。
 *
 * 根因（packages/nudojs/src/commands/check-report.ts）：注解分派把 GitLab
 * 挂在 `--json` 的 `else` 上，而 `--json` 路径**恒**置 `jsonCollect`
 * （check-command.ts）⇒ `opts.json && opts.jsonCollect` 永远成立 ⇒
 * `opts.gitlab` 分支永不可达 ⇒ 注解被静默吞掉（CI 面板上该文件的告警消失，
 * 且没有任何提示说这个组合被忽略了）。
 *
 * 修法：两个注解通道（GitLab Code Quality / GHA 行内注解）**并列**，
 * 机器面（--json）两者都只写 stderr —— stdout 是 CheckJson 机器契约，
 * 注解不得混进去（与 --gha 的既有口径同形）。
 *
 * 本文件钉住：
 * - `--json --gitlab`：stdout 可解析为 CheckJson + stderr 可解析为
 * Code Quality 数组（`check_name` 字段在位）；
 * - `--json`（无 --gitlab）：stderr 不含任何注解（不回归泄漏）；
 * - `--gitlab`（无 --json）：stdout 仍是**恰好一份** Code Quality 数组
 * （旧口径不变）。
 */






/** 未约束入口 → L2 entry may-throw（error）+ entry-only（info） */
const BAD = `export function staticName(node) {
  return node.type;
}
`;

type CodeQualityRow = {
  check_name: string;
  fingerprint: string;
  severity: string;
  location: { path: string; lines: { begin: number } };
};

/** stderr 里最后一行非空内容（注解以单行 JSON 数组写出） */
function lastJsonLine(stderr: string): unknown {
  const lines = stderr.split("\n").filter((l) => l.trim().length > 0);
  expect(lines.length).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1]!);
}


  it("--json --gitlab：stdout 是 CheckJson 契约，stderr 是 Code Quality 数组；--json（无 --gitlab）：stderr 不含任何 CI 注解（不回归泄漏）；--gitlab（无 --json）：stdout 仍是恰好一份 Code Quality 数组（旧口径不变）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b631-json-gitlab-"));
    const file = join(dir, "bad.js");
    writeFileSync(file, BAD, "utf8");
    try {
      const r = runCli(["check", file, "--json", "--gitlab"]);
      // 门禁语义不变：L2 entry may-throw（error）⇒ exit 1
      expect(r.status).toBe(1);

      // stdout：CheckJson 机器契约（可解析，注解不得混进来）
      const envelope = JSON.parse(r.stdout);
      expect(envelope.ok).toBe(false);
      expect(envelope.issues.map((i: { code: string }) => i.code)).toContain(
        "nudo:entry-may-throw",
      );
      expect(r.stdout).not.toContain("check_name");

      // stderr：GitLab Code Quality 数组（旧实现整段丢失 ⇒ 计数 0）
      const rows = lastJsonLine(r.stderr) as CodeQualityRow[];
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((r2) => r2.check_name)).toContain("nudo:entry-may-throw");
      for (const row of rows) {
        expect(row.fingerprint).toBeTruthy();
        expect(row.severity).toBeTruthy();
        expect(row.location.lines.begin).toBeGreaterThanOrEqual(1);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b631-json-only-"));
    const file = join(dir, "bad.js");
    writeFileSync(file, BAD, "utf8");
    try {
      const r = runCli(["check", file, "--json"]);
      expect(r.status).toBe(1);
      expect(JSON.parse(r.stdout).ok).toBe(false);
      expect(r.stderr).not.toContain("check_name");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b631-gitlab-only-"));
    const file = join(dir, "bad.js");
    writeFileSync(file, BAD, "utf8");
    try {
      const r = runCli(["check", file, "--gitlab"]);
      expect(r.status).toBe(1);
      const rows = JSON.parse(r.stdout) as CodeQualityRow[];
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.map((r2) => r2.check_name)).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// check — 模块装载问题族上屏（）
// ---------------------------------------------------------------------------
describe("check — 模块装载问题族上屏（）", () => {
/**
 * `nudo check` **从不报告模块装载问题族**
 * （`nudo:module-missing` / `nudo:missing-export` / `nudo:module-cycle` /
 * `nudo:module-depth`）：依赖解析失败的源文件**门禁绿灯、exit 0**。
 *
 * 根因：模块图装载问题（service `composeEvalModules` → `pushBModuleIssues`）
 * 只走**分析器诊断通道**；core `checkSource` 不装载依赖模块图 ⇒ 这些事实
 * 在 check 面完全没有出口。`domainIssuesFromDiagnostics` 的白名单此前**只**
 * 留 contract 家族两码 ⇒ 分析器产出的 module 族诊断被整条丢弃
 * ⇒ 「依赖解析失败」在 CI 门禁上不可见（fail-open）。
 *
 * 钉：
 * - 依赖文件缺失 ⇒ `nudo:module-missing` 上屏（error）+ **exit 1**（门禁红）；
 * - 依赖文件存在但缺导出 ⇒ `nudo:missing-export` 上屏（error）+ **exit 1**；
 * - `--json` 面同码同 severity（JSON 契约面不得比人面更弱）。
 *
 * 回归方向：把 `packages/nudojs/src/check-json-map.ts` 的
 * `CHECK_FACE_DIAG_CODES` 退回「只有 contract 家族两码」⇒ 本钉大面积失败。
 */






/** 最小 ESM 工程（type=module ⇒ .js 走 ESM 解析）。 */
function writeProject(dir: string, name: string): void {
  writeFileSync(
    join(dir, "package.json"),
    `{ "name": "${name}", "version": "1.0.0", "type": "module" }`,
    "utf-8",
  );
}

/** 从 `--json` 面解析出 issues（人面与 JSON 面必须同码同 severity）。 */
function jsonIssues(stdout: string): Array<{ severity: string; code: string; message: string }> {
  const parsed = JSON.parse(stdout) as {
    issues?: Array<{ severity: string; code: string; message: string }>;
  };
  return parsed.issues ?? [];
}


  it("依赖文件缺失 ⇒ nudo:module-missing 上屏 + 门禁红（exit 1）；依赖文件存在但缺导出 ⇒ nudo:missing-export 上屏 + 门禁红（exit 1）；--json 面同码同 severity（error）且 ok=false；不双报：mock 文件缺失（mock 通道 + 模块图通道同码同文）只报一条", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-missing-"));
    writeProject(dir, "b632-missing");
    writeFileSync(
      join(dir, "a.js"),
      `import { nope } from "./does-not-exist.js";\nexport function f() { return nope; }\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js")]);
    const out = r.stdout + r.stderr;
    // 人面：诊断码以 "(nudo:xxx)" 形式出现（docs 深链不是这个形态）
    expect(out).toContain("(nudo:module-missing)");
    // 门禁红（此前是 OK / exit 0）
    expect(r.status).toBe(1);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-export-"));
    writeProject(dir, "b632-export");
    writeFileSync(join(dir, "exists.js"), `export function g() { return 1; }\n`, "utf-8");
    writeFileSync(
      join(dir, "a.js"),
      `import { nope } from "./exists.js";\nexport function f() { return nope; }\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js")]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("(nudo:missing-export)");
    expect(r.status).toBe(1);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-json-"));
    writeProject(dir, "b632-json");
    writeFileSync(
      join(dir, "a.js"),
      `import { nope } from "./does-not-exist.js";\nexport function f() { return nope; }\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js"), "--json"]);
    const issues = jsonIssues(r.stdout);
    const hit = issues.find((i) => i.code === "nudo:module-missing");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(r.status).toBe(1);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug632-dup-"));
    writeProject(dir, "b632-dup");
    writeFileSync(
      join(dir, "a.js"),
      `// @nudo:mock fs from "./definitely-missing-mock-file.js"\nexport function useFs() {\n  return 1;\n}\n`,
      "utf-8",
    );

    const r = runCli(["check", join(dir, "a.js"), "--json"]);
    const issues = jsonIssues(r.stdout);
    const missing = issues.filter((i) => i.code === "nudo:module-missing");
    expect(missing.length).toBe(1);
    expect(missing[0].severity).toBe("error");
  }
});




});


// ---------------------------------------------------------------------------
// .js 里的 TS-only 语法不得判绿
// ---------------------------------------------------------------------------
describe(".js 里的 TS-only 语法不得判绿", () => {
/**
 * `nudo check` 对 `.js` 里的 **TS-only 语法**判 **OK / exit 0**
 * （CI 门禁假绿）：`node --check` 自己拒绝该文件（SyntaxError）。
 *
 * 修法（族 18 片 4）：
 * - core `parseSource` 新增 `filename` 选项 ⇒ **按扩展名**选解析插件
 * （`.js` / `.mjs` / `.cjs` / `.jsx` **不开** typescript 插件）；
 * - check 面按扩展名复核（`parseForCheck`）⇒ TS-only 语法走既有**语法错
 * 通道**（人类面 tsc 风格块 / `--json` 面 pathErrors + ok:false / `--fix`
 * 面残余 error ⇒ exit 1），不再静默判绿。
 *
 * oracle（改前 → 改后）：
 * 改前 `nudo check privfield.js` ⇒ OK / 0 error / exit 0
 * 改后 `nudo check privfield.js` ⇒ 语法错块（2:11 — syntax error:
 * TypeScript-only syntax is not valid in a .js file）/ exit 1
 */






/** `.js` 里的 TS-only 语法（Node 自己拒绝：`node --check` ⇒ SyntaxError） */
const TS_ONLY_JS = `export class A {
  private x = 0;
  m() { return this.x; }
}
`;

const PLAIN_JS = `export function f(x) {
  return x;
}
`;

function project(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b633-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "b633", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), src, "utf-8");
  return dir;
}


  it("人类面：语法错块 + exit 1（此前 OK / exit 0）；--json 面：信封 ok:false + pathErrors[0].code=syntax-error；check --fix 不得静默跳过：残余 error ⇒ exit 1；磁盘缓存不得把「假绿」固化：连跑两轮都判红；纯 JS 文件不受影响：仍判绿（exit 0）；`.ts` 文件仍允许 TS 语法（按扩展名收紧，不误伤 TS 面）", () => {
  {
    const dir = project(TS_ONLY_JS);
    const r = runCli(["check", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(1);
    expect(out).toContain("syntax error");
    expect(out).toContain("TypeScript-only syntax");
    // 不得再出现「判绿」的签名面
    expect(out).not.toContain("A.m() => 0");
  }
  {
    const dir = project(TS_ONLY_JS);
    const r = runCli(["check", "--json", join(dir, "lib.js")]);
    const json = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: Array<{ code: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.pathErrors?.[0]?.code).toBe("syntax-error");
    expect(json.pathErrors?.[0]?.message).toContain("TypeScript-only syntax");
    expect(r.status).toBe(1);
  }
  {
    const dir = project(TS_ONLY_JS);
    const r = runCli(["check", "--fix", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(1);
    expect(out).toContain("residual error");
    expect(out).toContain("TypeScript-only syntax");
  }
  {
    const dir = project(TS_ONLY_JS);
    const cacheDir = mkdtempSync(join(tmpdir(), "nudo-b633-cache-"));
    const file = join(dir, "lib.js");
    const first = runCli(["check", file], { env: { NUDO_CACHE_DIR: cacheDir } });
    expect(first.status, first.stdout + first.stderr).toBe(1);
    const second = runCli(["check", file], { env: { NUDO_CACHE_DIR: cacheDir } });
    expect(second.status, second.stdout + second.stderr).toBe(1);
    expect(second.stdout + second.stderr).toContain("TypeScript-only syntax");
  }
  {
    const dir = project(PLAIN_JS);
    const r = runCli(["check", join(dir, "lib.js")]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b633-ts-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "b633ts", version: "1.0.0", type: "module" }),
      "utf-8",
    );
    writeFileSync(join(dir, "lib.ts"), TS_ONLY_JS, "utf-8");
    const r = runCli(["check", join(dir, "lib.ts")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).not.toContain("TypeScript-only syntax");
  }
});






});


// ---------------------------------------------------------------------------
// profile typo 告警文案按生效档位生成
// ---------------------------------------------------------------------------
describe("profile typo 告警文案按生效档位生成", () => {
/**
 * 非法 `nudo.check.profile` 的告警文案与**实际生效档位**脱节。
 *
 * 旧文案写死「using default strict」⇒ 诊断说假话：配置里同层还有显式
 * `check.entryThrows:"warning"` 时，实际生效档位是 warning（门禁放行、
 * exit 0），告警却说「using default strict」（用户以为自己的文件没过）。
 *
 * 修复：文案按**最终解析出的档位**生成（解析链 = CLI 显式 > CLI profile >
 * 配置 entryThrows > 配置 profile > 默认 strict）。
 */






/** L2-only：export 上未消化 may-throw ⇒ 档位可从 exit code 观测 */
const L2_SRC = "export function getName(user){ return user.name; }\n";

function makeProject(nudoCheck: string): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug637-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "bug637",
      version: "0.0.0",
      nudo: { check: JSON.parse(nudoCheck) },
    }),
    "utf-8",
  );
  const file = join(cwd, "a.js");
  writeFileSync(file, L2_SRC, "utf-8");
  return { cwd, file };
}


  it("profile:\"bogus\" + entryThrows:\"warning\" ⇒ 告警说 using warning（且不说 default strict）；profile:\"bogus\" 单独 ⇒ 仍是 using default strict（默认档文案不变）+ strict 门禁 exit 1；CLI --entry-throws warning 压过配置 profile typo ⇒ 告警说 using warning", () => {
  {
    const { cwd, file } = makeProject(`{"profile":"bogus","entryThrows":"warning"}`);
    try {
      const r = runCli(["check", file], { cwd });
      expect(r.stderr).toContain(
        'warning: package.json nudo.check.profile: unknown value "bogus" (expected: adoption | strict) — using warning',
      );
      expect(r.stderr).not.toContain("using default strict");
      // 生效档位 = warning ⇒ L2 降级 ⇒ exit 0（文案与实际一致）
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("1 warning");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject(`{"profile":"bogus"}`);
    try {
      const r = runCli(["check", file], { cwd });
      expect(r.stderr).toContain(
        'warning: package.json nudo.check.profile: unknown value "bogus" (expected: adoption | strict) — using default strict',
      );
      expect(r.status).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject(`{"profile":"bogus"}`);
    try {
      const r = runCli(["check", file, "--entry-throws", "warning"], { cwd });
      expect(r.stderr).toContain("— using warning");
      expect(r.stderr).not.toContain("using default strict");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// nudo:dual-entry 缓存命中轮不重复上屏
// ---------------------------------------------------------------------------
describe("nudo:dual-entry 缓存命中轮不重复上屏", () => {
/**
 * `nudo:dual-entry` 在**磁盘缓存命中轮**被**重复**上屏
 * （冷缓存 1 条 → 热缓存 2 条同文案）⇒ 机器可读面逐轮漂移
 * （诊断条数随缓存状态变化）。
 *
 * 根因（packages/nudojs/src/commands/check-report.ts）：该 issue 在**缓存
 * 之后**注入（保证命中轮也上屏），但**上一轮的注入结果被写进了磁盘缓存**
 * ⇒ 命中轮拿到的 report / cachedJson 已经含这条 issue，再把 live 的那一条
 * merge 上去 ⇒ 同文案重复两条（mergeCheckIssues / mergeJsonIssues 只追加、
 * 不去重）。
 *
 * 修法：与 env-unresolved / 配置形状诊断同一口径 —— **写盘前剥除 +
 * 读回后剥除**，由本轮 live 注入单一来源上屏 ⇒ miss 轮与命中轮的 issues
 * 数组逐条相同（不引入"热轮无该条"的反向漂移）。
 *
 * 本文件钉住：
 * - `--json` 面：冷 / 热 / 热三轮的 issues 数组与 summary 逐条相同，
 * dual-entry 各**恰好 1 条**；
 * - 人类面：热轮的 issues 段只有**一行** dual-entry；
 * - 写盘口径：磁盘缓存条目里**不含** nudo:dual-entry。
 */






/** 双入口包：browser / node 两个面解析到不同文件 */
const PKG = JSON.stringify({
  name: "dualp",
  version: "1.0.0",
  type: "module",
  exports: { ".": { browser: "./browser.js", default: "./node.js" } },
});

const BROWSER_JS = `export function browserOnly() {
  return 1;
}
`;
const NODE_JS = `export function nodeOnly() {
  return 2;
}
`;

type Issue = { code: string };
type CheckJsonLike = { ok: boolean; issues: Issue[]; summary: Record<string, number> };

/** 递归收集缓存目录下的所有文件（缓存条目按 <ns>/<xx>/<hash>.json 分层） */
function cacheFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}


  it("--json 面：冷/热/热三轮 issues 逐条相同（dual-entry 各 1 条）；人类面：热轮的 issues 段只有一行 dual-entry；写盘口径：磁盘缓存条目里不含 nudo:dual-entry", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b641-json-"));
    const file = join(dir, "browser.js");
    const cache = join(dir, "cache");
    writeFileSync(join(dir, "package.json"), PKG, "utf8");
    writeFileSync(file, BROWSER_JS, "utf8");
    writeFileSync(join(dir, "node.js"), NODE_JS, "utf8");
    try {
      const env = { NUDO_CACHE_DIR: cache };
      const r1 = runCli(["check", file, "--json"], { env });
      const r2 = runCli(["check", file, "--json"], { env });
      const r3 = runCli(["check", file, "--json"], { env });
      const j1 = JSON.parse(r1.stdout) as CheckJsonLike;
      const j2 = JSON.parse(r2.stdout) as CheckJsonLike;
      const j3 = JSON.parse(r3.stdout) as CheckJsonLike;
      const dual = (j: CheckJsonLike): Issue[] =>
        j.issues.filter((i) => i.code === "nudo:dual-entry");
      // 冷轮 1 条；热轮（旧实现 2 条）必须仍是 1 条
      expect(dual(j1).length).toBe(1);
      expect(dual(j2).length).toBe(1);
      expect(dual(j3).length).toBe(1);
      // 逐条相同（不只是条数）：机器面不得随缓存状态漂移
      expect(j2.issues).toEqual(j1.issues);
      expect(j3.issues).toEqual(j1.issues);
      expect(j2.summary).toEqual(j1.summary);
      expect(j3.summary).toEqual(j1.summary);
      expect(r2.stdout).toBe(r1.stdout);
      expect(r3.stdout).toBe(r1.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b641-human-"));
    const file = join(dir, "browser.js");
    const cache = join(dir, "cache");
    writeFileSync(join(dir, "package.json"), PKG, "utf8");
    writeFileSync(file, BROWSER_JS, "utf8");
    writeFileSync(join(dir, "node.js"), NODE_JS, "utf8");
    try {
      const env = { NUDO_CACHE_DIR: cache };
      runCli(["check", file], { env });
      const hot = runCli(["check", file], { env });
      const issueLines = hot.stdout
        .split("\n")
        .filter((l) => l.includes("(nudo:dual-entry)"));
      expect(issueLines.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b641-cache-"));
    const file = join(dir, "browser.js");
    const cache = join(dir, "cache");
    writeFileSync(join(dir, "package.json"), PKG, "utf8");
    writeFileSync(file, BROWSER_JS, "utf8");
    writeFileSync(join(dir, "node.js"), NODE_JS, "utf8");
    try {
      const env = { NUDO_CACHE_DIR: cache };
      runCli(["check", file, "--json"], { env });
      const files = cacheFiles(cache);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(readFileSync(f, "utf8")).not.toContain("nudo:dual-entry");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// --what-if 不再静默吞掉机器 / 观察旗标
// ---------------------------------------------------------------------------
describe("--what-if 不再静默吞掉机器 / 观察旗标", () => {
/**
 * `nudo check --json --what-if …` **静默吞掉 --json**（stdout 是人读文本）。
 *
 * 症状：--what-if 是早退分支 ⇒ --json/--abs/--gha/--gitlab/--from/--watch/--verbose
 * 全部被静默丢弃（stdout 变成 `Type of "raw": …` 的人读文本、exit 0 ⇒ 机器面
 * `JSON.parse(stdout)` 直接炸）；且多文件时**静默塌缩**成第 1 个（其余文件从未被分析）。
 * 修复：组合表显式拒绝（与 --fix 的拒绝表同款纪律）+ 多文件显式报错。
 */






const SRC = `const raw = 1;

export function useRaw() {
  return raw + 1;
}
`;

function makeProject(): { cwd: string; file: string; other: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-644-"));
  const file = join(dir, "a.js");
  const other = join(dir, "b.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(other, SRC, "utf-8");
  return { cwd: dir, file, other };
}

describe("-what-if 不再静默吞掉机器 / 观察旗标", () => {
  it("CLI：--json --what-if ⇒ 显式 usage error（stdout 是机器可读信封）；CLI：--abs / --gha / --gitlab / --from / --watch 与 --what-if ⇒ 显式拒绝（exit 1）；CLI：多文件 --what-if 不再静默塌缩成第 1 个（显式报错）；CLI：单文件 + 无机器旗标的 --what-if 仍正常回答（旧口径不回归）", () => {
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(
        ["check", file, "--json", "--what-if", "raw:string", "--target", "raw"],
        { cwd },
      );
      expect(r.status).toBe(1);
      // 旧症状：stdout 是 `Type of "raw": string` 的人读文本 ⇒ JSON.parse 炸
      expect(r.stdout).not.toContain('Type of "raw"');
      const doc = JSON.parse(r.stdout);
      expect(doc.kind).toBe("multi");
      expect(doc.ok).toBe(false);
      expect(doc.pathErrors[0].code).toBe("nudo:usage-error");
      expect(doc.pathErrors[0].message).toContain("--what-if cannot be combined with --json");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file, other } = makeProject();
    try {
      const combos: string[][] = [
        ["--abs"],
        ["--gha"],
        ["--gitlab"],
        ["--from", other],
        ["--watch"],
      ];
      for (const combo of combos) {
        const r = runCli(
          ["check", file, ...combo, "--what-if", "raw:string", "--target", "raw"],
          { cwd },
        );
        expect(r.status, combo.join(" ")).toBe(1);
        const out = r.stdout + r.stderr;
        expect(out, combo.join(" ")).toContain("--what-if cannot be combined with");
        expect(out, combo.join(" ")).not.toContain('Type of "raw"');
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file, other } = makeProject();
    try {
      const r = runCli(
        ["check", file, other, "--what-if", "raw:string", "--target", "raw"],
        { cwd },
      );
      expect(r.status).toBe(1);
      const out = r.stdout + r.stderr;
      expect(out).toContain("--what-if needs exactly one file (got 2)");
      expect(out).not.toContain('Type of "raw"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(
        ["check", file, "--what-if", "raw:string", "--target", "raw"],
        { cwd },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Type of "raw": string');
      expect(r.stdout).toContain("Bindings applied: raw: string");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});



});
});


// ---------------------------------------------------------------------------
// 模块环不再丢弃整张依赖图（反向守护钉）
// ---------------------------------------------------------------------------
describe("模块环不再丢弃整张依赖图（反向守护钉）", () => {
/**
 * （**反向守护钉** · 报告说法的假阳性）：`nudo check` 遇**模块环**时
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
 * 「**不再**因为检出环就丢弃整张依赖图」——环内求值**有界**
 * （装载层：环内已部分求值的导出；求值层：调用/分支预算硬闸），
 * 无需「整图丢弃」这种有损降级；
 * - 环本身仍由诊断面报告（`nudo:module-cycle` warning）——**不靠丢图来「避免」环**。
 *
 * **为什么这条钉不是空转**：
 * - 门禁结果必须**逐字一致**：有环 / 无环两夹具的 `nudo check` exit code 与
 * 诊断文本相同 ⇒ 环没有改变分析结果；
 * - 一致结果里**仍有** `nudo:constraint-violated`（actual `5` ⊭ `> 999`）
 * ⇒ 跨模块的值**没有**塌成 `unknown`（塌成 unknown 时门禁会**假绿**，
 * exit code 变 0、约束违规消失 ⇒ 本钉必红）；
 * - 夹具**非空转**：有环夹具真被检出环（`nudo test` 面的 `nudo:module-cycle`），
 * 无环夹具没有 ⇒ 两夹具的差别只在「有没有环」。
 */






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
 * —— 环本身被诊断面报告是**期望**行为（模块装载问题族上屏），
 * 但它**不得**改变分析结果（签名 + L2 门禁判定）；
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


  it("有环 / 无环：nudo check 的 exit code 逐字一致（门禁同判）；有环 / 无环：nudo check 的诊断文本逐字一致（归一化模块图形状诊断后）；一致结果里仍有 constraint-violated（跨模块的值没有塌成 unknown）；夹具非空转：有环夹具真被检出环（nudo test 面），无环夹具没有", () => {
  {
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
  }
  {
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
  }
  {
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
  }
  {
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
  }
});




});


// ---------------------------------------------------------------------------
// check --fix 的 diff 单份头 + 干净路径字段
// ---------------------------------------------------------------------------
describe("check --fix 的 diff 单份头 + 干净路径字段", () => {
/**
 * `nudo check --fix` 打印的 unified diff **非法且不可 apply**。
 *
 * 旧实现（check.ts 的 diff 打印段）：
 * - 自印一份 `--- <file>` / `+++ <file> ([fix] …)` **又**追加自带头的
 * `unifiedDiff(...)` ⇒ **双份头**；
 * - `+++` 行的**路径字段被说明文字污染**（`+++ <path> ([fix] …)`）⇒
 * 解析出的文件名不是合法路径；
 * - 传给 `unifiedDiff` 的是**绝对路径** ⇒ 头拼成 `a//abs` 的**双斜杠**
 * ⇒ `git apply -p1` 剥掉 `a/` 后仍是绝对路径 ⇒ git 拒绝（exit 1）。
 *
 * 修复：diff 头**只**由 `unifiedDiff` 产出；说明文字移到 diff **之外**的一行；
 * 路径取**相对 cwd**（与兄弟命令 `test --freeze --dry-run` 同口径）。
 */







const SRC = "export function getName(user) {\n  return user.name;\n}\n";

/** 头行：unified diff 的 `---` / `+++` 各恰好一份，且路径字段干净 */
function diffHeaderLines(stdout: string): { minus: string[]; plus: string[] } {
  const lines = stdout.split("\n");
  return {
    minus: lines.filter((l) => l.startsWith("--- ")),
    plus: lines.filter((l) => l.startsWith("+++ ")),
  };
}


  it("单份 ---/+++ 头 + 路径字段无说明文字 + 相对路径（无 a// 双斜杠）；diff 可被 `git apply --check -p1` 消费（相对路径 ⇒ 剥掉 a/ 后是仓库内相对路径）", () => {
  {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug648-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "bug648", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "lib.js"), SRC, "utf-8");
      const r = runCli(["check", "--fix", "lib.js"], { cwd });
      const { minus, plus } = diffHeaderLines(r.stdout);
      // 旧实现：--- 两份（自印 + unifiedDiff 自带）、+++ 两份
      expect(minus, "unified diff 只允许一对 ---/+++ 头").toHaveLength(1);
      expect(plus, "unified diff 只允许一对 ---/+++ 头").toHaveLength(1);
      // 头路径字段干净（无 `([fix] …)` 说明文字污染）
      expect(plus[0]).toMatch(/^\+\+\+ b\/\S+$/);
      expect(minus[0]).toMatch(/^--- a\/\S+$/);
      // 相对路径（不是绝对路径拼出的 a// 双斜杠）
      expect(plus[0]).not.toContain("a//");
      expect(plus[0]).not.toContain("b//");
      expect(plus[0].replace(/^\+\+\+ b\//, "")).not.toMatch(/^\//);
      // 新建文件的 hunk 头是标准形态 @@ -0,0 +1,N @@
      expect(r.stdout).toMatch(/^@@ -0,0 \+1,\d+ @@$/m);
      // 说明文字在 diff 之外（仍可见，但不污染路径字段）
      expect(r.stdout).toContain("[fix]");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    // 夹具放在**仓库外**的临时目录、且以该目录为 cwd ⇒ diff 里的路径是
    // 「相对 cwd」的（`a/lib.nudo.js`）⇒ `git apply -p1` 在该目录下按相对
    // 路径解析（不依赖「补丁基准目录 == git 仓库根」这一偶然前提）。
    // 旧实现传的是**绝对路径** ⇒ 头是 `a//<绝对路径>` ⇒ -p1 后仍是绝对路径
    // ⇒ git 拒绝（invalid path ⇒ 非零 exit）。
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug648-apply-"));
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "bug648", private: true, type: "module" }),
        "utf-8",
      );
      writeFileSync(join(cwd, "lib.js"), SRC, "utf-8");
      const r = runCli(["check", "--fix", "lib.js"], { cwd });
      expect(r.stdout).toContain("--- a/lib.nudo.js");
      const g = spawnSync("git", ["apply", "--check", "-p1"], {
        cwd,
        input: r.stdout,
        encoding: "utf8",
      });
      expect(
        g.status,
        `git apply --check -p1 应成功（stderr: ${g.stderr}）`,
      ).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});


});
