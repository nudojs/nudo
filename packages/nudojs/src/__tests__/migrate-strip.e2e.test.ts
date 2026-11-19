/**
 * migrate strip 面（原子写/拒绝覆盖/TS-only/TSX/产品覆盖）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runCliTsx } from "./helpers/run-cli.ts";
import { migrateStrip } from "../migrate.ts";

// ---------------------------------------------------------------------------
// strip 不得写出仍是 TS 语法的 .js
// ---------------------------------------------------------------------------
describe("strip 不得写出仍是 TS 语法的 .js", () => {
/**
 * `nudo migrate strip --write` 写出 **Node 无法解析** 的 `.js`
 * 且 exit 0（非 `declare` 的 `namespace` / `import x = require(…)`）。
 *
 * 根因：命令层的 TS-only 构造清单（`tsOnlyConstructs`）**没有**
 * `TSModuleDeclaration` / `TSImportEqualsDeclaration`，而 core 的剥除器刻意
 * 保留这两个节点（运行时语义 / 「已知不处理」清单）⇒ 门禁永不命中 ⇒
 * 写盘 + exit 0。
 *
 * 期望（`commands/migrate.ts` 文件头的自述）：写盘**之前**检出「剥完仍有
 * TS-only 语法」的目标并**拒绝写盘** + 响亮报错（migrate 是一程闸门）。
 *
 * 反向闸：只含普通类型的 `.ts` 照常写盘（断言非永真）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-050-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), '{ "name": "b050", "type": "module" }\n', "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const NS = `export namespace Helpers {
  export const twice = (n: number): number => n * 2;
}
`;

const IMPORT_EQUALS = `import fs = require("node:fs");
export const readFile = (p: string): string => fs.readFileSync(p, "utf-8");
`;


  it("非 declare 的 namespace ⇒ 拒绝写盘 + exit 1", () => {
    const dir = dirWith({ "ns.ts": NS });
    const r = runCliTsx(["migrate", "strip", "--write", dir]);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("namespace");
    // 一程闸门：产物**不得**落盘
    expect(existsSync(join(dir, "ns.js"))).toBe(false);
    expect(readFileSync(join(dir, "ns.ts"), "utf-8")).toBe(NS);
  });

  it("`import x = require(…)` ⇒ 拒绝写盘 + exit 1（且提示里点名该构造）", () => {
    const dir = dirWith({ "ie.ts": IMPORT_EQUALS });
    const r = runCliTsx(["migrate", "strip", "--write", dir]);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("import x = require");
    expect(existsSync(join(dir, "ie.js"))).toBe(false);
  });

  it("--json 面同样是合法失败信封（pathErrors 带文件名）", () => {
    const dir = dirWith({ "ns.ts": NS });
    const r = runCliTsx(["migrate", "strip", "--write", "--json", dir]);
    expect(r.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as Array<{
      ok?: boolean;
      pathErrors?: Array<{ path: string; message: string }>;
    }>;
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors?.[0]?.path).toContain("ns.ts");
  });

  it("反向闸：纯类型剥除照常写盘（门禁不得误伤）", () => {
    const dir = dirWith({ "ok.ts": "export const twice = (n: number): number => n * 2;\n" });
    const r = runCliTsx(["migrate", "strip", "--write", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(dir, "ok.js"))).toBe(true);
    expect(readFileSync(join(dir, "ok.js"), "utf-8")).toContain("n * 2");
  });

});

// ---------------------------------------------------------------------------
// strip 产物被 check 跳过（发布物零覆盖 ⇒ 假绿）
// ---------------------------------------------------------------------------
describe("strip 产物被 check 跳过（发布物零覆盖 ⇒ 假绿）", () => {
/**
 * `migrate strip --write` 之后**源 `.ts` 仍在** ⇒ `nudo check`
 * （= `migrate retire` 装上的 CI 门禁）**跳过同 stem 的产物 `.js`**
 * ⇒ 发布的产物零覆盖（**假绿**）；且与 `migrate verify` 对同一包给出
 * **相反结论**（verify 红 / check 绿）。
 *
 * 根因：`collectNudoFiles`（`packages/nudojs/src/commands/shared.ts`）的
 * 「同 stem 只取其一」规则把「取哪一份」**硬编码成 `.ts`**（迁移**前**的
 * 事实源：带类型注解 ⇒ 推断更准）⇒ 迁移过渡期（strip → retire 之间，
 * `.ts` 与 `.js` **并存**是常态）恰好取**错**的那一份 ⇒ 门禁查的是
 * **退役后不再被编译的死源**，真正发布出去的 `.js` 零覆盖。
 *
 * 修法：同 stem 冲突时**产物（发布物）胜出** ⇒ 门禁门禁**要发布的东西**；
 * 「一个模块 ⇒ 一次分析」的不变式（）仍然成立（源被压掉，不是两份
 * 都分析 ⇒ 计数不翻倍）。
 *
 * 判据：
 * ① `strip --write` 后 `nudo check` **覆盖产物 `.js`**（能报出产物里的问题
 * ⇒ 证明产物被检查了；且被分析的文件是 `.js` 而**不是** `.ts`）；
 * ② **一致性**：`migrate verify` 与 `nudo check` 对同一包**结论一致**；
 * ③ 负控：普通项目（无同 stem 冲突）⇒ 目标集合**不变**；
 * ④ 负控：`migrate strip` **不带** `--write` ⇒ `.js` 未生成 ⇒ 行为不变。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 侧车契约模块（值级模板）—— 项目里**有契约**（迁移项目的常态）。 */
const SHAPES_NUDO_JS = `export const positive = number().gt(0);\n`;

/**
 * 源：带类型标注 ⇒ `ms` 是 `number` ⇒ `ms.toFixed(2)` **安全** ⇒ 源**绿**。
 * 产物（剥掉标注）：`ms` 是 `any` ⇒ `ms.toFixed(2)` **可能抛** ⇒ 产物**红**。
 * ⇒ 「源绿 / 产物红」正是「只查源 ⇒ 假绿」的证据。
 */
const INDEX_TS = `/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract n positive
 */
export function repeat(n) {
  return n;
}

export function setDelay(ms: number): number {
  return ms.toFixed(2);
}
`;

/** 普通项目（无同 stem 冲突）：`.ts` 与 `.js` **不同 stem** ⇒ 各自被分析。 */
const PLAIN_TS = `export function inc(n: number): number {\n  return n + 1;\n}\n`;
const PLAIN_JS = `export function id(x) {\n  return x;\n}\n`;

function tmpPkg(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "s9-pkg", version: "0.0.0", type: "module" }),
    "utf-8",
  );
  return dir;
}

/** `check --json` 的**被分析文件集合**（单文件面 / 多文件信封两种形状都吃）。 */
function analyzedFiles(stdout: string): string[] {
  const data = JSON.parse(stdout) as {
    file?: string;
    reports?: Array<{ file?: string }>;
  };
  if (Array.isArray(data.reports)) return data.reports.map((r) => r.file ?? "");
  return data.file ? [data.file] : [];
}

/** `check --json` 的诊断码集合（单文件面 / 多文件信封两种形状都吃）。 */
function issueCodes(stdout: string): string[] {
  const data = JSON.parse(stdout) as {
    issues?: Array<{ code?: string }>;
    reports?: Array<{ issues?: Array<{ code?: string }> }>;
  };
  if (Array.isArray(data.reports)) {
    return data.reports.flatMap((r) => (r.issues ?? []).map((i) => i.code ?? ""));
  }
  return (data.issues ?? []).map((i) => i.code ?? "");
}


  it("① strip --write 后 check 覆盖同 stem 的产物 .js（报出产物里的问题）", { timeout: 180_000 }, () => {
    const dir = tmpPkg("nudo-migrate-bug-1053-");
    writeFileSync(join(dir, "src", "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "src", "index.ts"), INDEX_TS, "utf-8");

    const strip = runCliTsx([
      "migrate",
      "strip",
      "--write",
      "--no-draft",
      join(dir, "src", "index.ts"),
    ]);
    expect(strip.status, strip.stderr).toBe(0);
    // strip 默认**保留源** ⇒ `.ts` 与 `.js` 并存（迁移过渡期的常态）
    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(dir, "src", "index.js"))).toBe(true);

    const check = runCliTsx(["check", dir, "--json"]);
    // 产物里的问题（`ms` 无标注 ⇒ may throw）必须被报出 ⇒ 产物**被检查了**
    expect(check.status, check.stdout).toBe(1);
    expect(issueCodes(check.stdout)).toContain("nudo:entry-may-throw");
    // 被分析的文件是**产物** `.js`（不是源 `.ts`）
    const files = analyzedFiles(check.stdout);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/index\.js$/);
    // 一个模块 ⇒ 一次分析（的计数不变式不翻倍）
    expect(files.filter((f) => f.endsWith("index.ts"))).toHaveLength(0);
  });

  it("② 一致性：migrate verify 与 nudo check 对同一包结论一致（都红）", { timeout: 180_000 }, () => {
    const dir = tmpPkg("nudo-migrate-bug-1053b-");
    writeFileSync(join(dir, "src", "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "src", "index.ts"), INDEX_TS, "utf-8");
    const strip = runCliTsx([
      "migrate",
      "strip",
      "--write",
      "--no-draft",
      join(dir, "src", "index.ts"),
    ]);
    expect(strip.status, strip.stderr).toBe(0);

    const verify = runCliTsx(["migrate", "verify", dir]);
    const check = runCliTsx(["check", dir]);
    // 改前：verify 红（产物红）/ check 绿（只查源）⇒ 相反结论 ⇒ 假绿
    expect(verify.status, verify.stdout + verify.stderr).toBe(1);
    expect(check.status, check.stdout + check.stderr).toBe(1);
    expect(check.status).toBe(verify.status);
    // 人类面也要看得见「查的是产物」
    expect(check.stdout).toMatch(/index\.js/);
  });

  it("③ 负控：普通项目（无同 stem 冲突）⇒ check 的目标集合不变", { timeout: 180_000 }, () => {
    const dir = tmpPkg("nudo-migrate-bug-1053c-");
    writeFileSync(join(dir, "src", "a.ts"), PLAIN_TS, "utf-8");
    writeFileSync(join(dir, "src", "b.js"), PLAIN_JS, "utf-8");

    const check = runCliTsx(["check", dir, "--json"]);
    expect(check.status, check.stdout).toBe(0);
    const files = analyzedFiles(check.stdout).map((f) => f.split("/").pop());
    expect(files.sort()).toEqual(["a.ts", "b.js"]);
  });

  it("④ 负控：strip 不带 --write ⇒ .js 未生成 ⇒ check 行为不变（仍查源）", { timeout: 180_000 }, () => {
    const dir = tmpPkg("nudo-migrate-bug-1053d-");
    writeFileSync(join(dir, "src", "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "src", "index.ts"), INDEX_TS, "utf-8");

    const strip = runCliTsx(["migrate", "strip", join(dir, "src", "index.ts")]);
    expect(strip.status, strip.stderr).toBe(0);
    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(dir, "src", "index.js"))).toBe(false);

    const check = runCliTsx(["check", dir, "--json"]);
    // 无产物 ⇒ 源照旧被分析（行为不变）
    const files = analyzedFiles(check.stdout);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/index\.ts$/);
  });

});

// ---------------------------------------------------------------------------
// migrate strip --write 是原子的（无半写状态）
// ---------------------------------------------------------------------------
describe("migrate strip --write 是原子的（无半写状态）", () => {
/**
 * `migrate strip --write` 遇语法错文件时留下半写状态，且错误信息不含文件名。
 *
 * 根因：逐文件 read → strip → write（无事务），前一个文件已落盘、后一个失败不回滚；
 * 异常路径也不携带文件名（只有 Babel 的 "Unexpected token (2:12)"）。
 *
 * 期望：要么全不写，要么明确报告失败于哪个文件 ⇒ 两阶段（先算完再写）+ 事务写盘。
 *
 * ⚠ 族 56b（**断言的通道变了，断言的强度没变**）：库面改**逐文件隔离**⇒ 解析失败
 * **不再整批 throw**，而是降级成**一行错误**（`code` + `error`，带文件名；结构同
 * `migrate verify` 的逐文件错误行）⇒ 同目标内其它文件的成功结果照常返回。
 * 本钉的两条断言因此从「promise reject」改到「返回的失败行」——
 * **断言的要点逐条保留**：错误信息点名文件 + 错误信息带解析位置 + 一个字节都不落盘。
 * （半写状态这条**不变**：有失败 ⇒ 整批零写盘。）
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});


  it("语法错文件 ⇒ 报错点名文件 + 一个字节都不落盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-574-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "a-good.ts"),
      `export function ok(a: number): number {\n  return a + 1;\n}\n`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "z-bad.ts"),
      `export function oops(a: number): number {\n  return a +;\n}\n`,
      "utf-8",
    );

    // 错误信息必须点名文件（改前只有 "Unexpected token (2:12)"）
    // 族 56b：失败以**一行错误**返回（不再整批 throw）⇒ 断言改到失败行上。
    const rows = await migrateStrip([dir], { write: true, draft: false });
    const failed = rows.filter((r) => r.code !== undefined);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toMatch(/z-bad\.ts/);

    // 半写状态：改前 a-good.js 已落盘 ⇒ 现在必须没有任何产物
    expect(existsSync(join(dir, "a-good.js"))).toBe(false);
    expect(existsSync(join(dir, "z-bad.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("语法错文件 ⇒ 错误信息同时含文件名与解析位置", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-574b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "bad.ts"), `const x = ;\n`, "utf-8");
    // 族 56b：失败以**一行错误**返回（`code` + `error`）—— 断言要点不变。
    const rows = await migrateStrip([dir], { write: true, draft: false });
    const failed = rows.filter((r) => r.code !== undefined);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toMatch(/bad\.ts/);
    expect(failed[0]!.error).toMatch(/\(1:\d+\)/);
  });

});

// ---------------------------------------------------------------------------
// migrate strip --write 不覆盖既有的同名 .js
// ---------------------------------------------------------------------------
describe("migrate strip --write 不覆盖既有的同名 .js", () => {
/**
 * `migrate strip --write` 静默覆盖同目录既有的同名 `.js`（手写 JS 丢失）。
 *
 * 根因：`foo.ts → foo.js` 是**不同文件** ⇒ 既有的存在性守卫完全失效；
 * 写目标前没有任何「目标已存在」的检查 ⇒ 手写的 `legacy()` 整段消失，exit 0。
 *
 * 期望：覆盖前必须检测 + 拒绝或报错（不得静默）；`--backup` 时先备份既有产物。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const TS_SRC = `export function add(a: number, b: number): number { return a + b; }\n`;
const HANDWRITTEN = `export function add(a, b) { return a + b; }\nexport function legacy() { return "hand-written"; }\n`;


  it("既有 util.js ⇒ 拒绝写入并报错（exit 非 0），手写内容原样保留", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-575-"));
    dirs.push(dir);
    writeFileSync(join(dir, "util.ts"), TS_SRC, "utf-8");
    writeFileSync(join(dir, "util.js"), HANDWRITTEN, "utf-8");

    await expect(migrateStrip([join(dir, "util.ts")], { write: true, draft: false })).rejects.toThrow(
      /target exists/,
    );

    // 手写 JS 必须原样保留（改前：整段被覆盖，legacy() 消失）
    expect(readFileSync(join(dir, "util.js"), "utf-8")).toBe(HANDWRITTEN);
    expect(readFileSync(join(dir, "util.js"), "utf-8")).toContain("legacy");
  });

  it("--backup ⇒ 既有产物先备份再写（不丢数据）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-575b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "util.ts"), TS_SRC, "utf-8");
    writeFileSync(join(dir, "util.js"), HANDWRITTEN, "utf-8");

    const results = await migrateStrip([join(dir, "util.ts")], {
      write: true,
      draft: false,
      backup: true,
    });

    // 产物被写出
    expect(readFileSync(join(dir, "util.js"), "utf-8")).toContain("function add(a, b)");
    // 既有内容进了备份（不丢数据）
    expect(existsSync(join(dir, "util.js.bak"))).toBe(true);
    expect(readFileSync(join(dir, "util.js.bak"), "utf-8")).toBe(HANDWRITTEN);
    // 备份动作在输出里可观测
    expect(results[0]!.notes.join("\n")).toMatch(/backed up existing .*util\.js/);
  });

  it("幂等重跑（目标内容逐字相同）⇒ 不报错、不丢内容", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-575c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "util.ts"), TS_SRC, "utf-8");
    await migrateStrip([join(dir, "util.ts")], { write: true, draft: false });
    const first = readFileSync(join(dir, "util.js"), "utf-8");
    await expect(
      migrateStrip([join(dir, "util.ts")], { write: true, draft: false }),
    ).resolves.toBeTruthy();
    expect(readFileSync(join(dir, "util.js"), "utf-8")).toBe(first);
  });

});

// ---------------------------------------------------------------------------
// migrate strip 不产出加载不了的 .jsx
// ---------------------------------------------------------------------------
describe("migrate strip 不产出加载不了的 .jsx", () => {
/**
 * `migrate strip` 把 `.tsx` 映射成 `.jsx`：Node 加载不了，且不被任何门禁分析。
 *
 * 根因：扩展名映射断言了「产物是 JSX」，但 strip 的产品约束是「只剥类型」
 * （TS 剥除 ≠ 编译变换）——JSX 需要 JSX 变换才能变成可加载的 JS。
 * 改前：`.jsx` 落盘、exit 0、零告警（`node --check` 直接 ERR_UNKNOWN_FILE_EXTENSION；
 * `.jsx` 也不在 isNudoTargetPath 里 ⇒ check / verify 都看不见它）。
 *
 * 期望：要么不迁移、要么产出**可加载**的 JS；notes 要如实 ⇒ strip 拒绝迁移 JSX 源。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const TSX_SRC = `export function Comp(props: { name: string }) {\n  return <div className="x">{props.name}</div>;\n}\n`;


  it(".tsx ⇒ 明确报错（不静默 exit 0），且不落任何产物", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-583-"));
    dirs.push(dir);
    writeFileSync(join(dir, "Comp.tsx"), TSX_SRC, "utf-8");

    await expect(migrateStrip([join(dir, "Comp.tsx")], { write: true, draft: false })).rejects.toThrow(
      /JSX/,
    );

    // 改前：Comp.jsx 落盘（Node: ERR_UNKNOWN_FILE_EXTENSION）
    expect(existsSync(join(dir, "Comp.jsx"))).toBe(false);
    expect(existsSync(join(dir, "Comp.js"))).toBe(false);
  });

  it("目录里有 .tsx ⇒ 整批不落盘（不留半写状态）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-583b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.ts"), `export const a = 1;\n`, "utf-8");
    writeFileSync(join(dir, "Comp.tsx"), TSX_SRC, "utf-8");

    await expect(migrateStrip([dir], { write: true, draft: false })).rejects.toThrow(/JSX/);
    expect(existsSync(join(dir, "a.js"))).toBe(false);
  });

  it("报错信息说明 strip 不做 JSX 变换（可操作）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-583c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "Comp.tsx"), TSX_SRC, "utf-8");
    const err = await migrateStrip([join(dir, "Comp.tsx")], { write: true, draft: false }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect((err as Error).message).toMatch(/Comp\.tsx/);
    expect((err as Error).message).toMatch(/no JSX transform/);
  });

});

// ---------------------------------------------------------------------------
// 产物必须可加载：解构默认值 / 类型专用再导出 / 包说明符提示
// ---------------------------------------------------------------------------
describe("产物必须可加载：解构默认值 / 类型专用再导出 / 包说明符提示", () => {
/**
 * BUG-219：`const { d = new Def() } = opts` 里的 `Def` 是值引用，但
 * `collectValueReferences` 不访问 declarator 的 `id` ⇒ import 被 elide ⇒
 * 产物加载成功、调用即 ReferenceError（且 notes 为空）。
 *
 * BUG-220：`export { Shape } from "./types.js"` 只作类型使用 ⇒ 保留被再
 * 导出的空模块 ⇒ 链接期 SyntaxError；同文件的 import 却被正确 elide。
 *
 * BUG-182：包说明符的类型专用 import 保守保留（合规），但文档承诺的
 * 「无法证明是值」提示结构性不可达 ⇒ 产物链接失败而 strip 零提示。
 */

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 带 package.json 的新夹具目录 */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-strip-load-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n', "utf-8");
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

  it("BUG-219 解构默认值引用本地 import ⇒ 保留 import，产物调用返回默认实例", async () => {
    const dir = project({
      "src/def.ts": `export class Def { kind = "def"; }\n`,
      "src/main.ts": `import { Def } from "./def.js";
export function pick(opts: { d?: Def }): Def {
  const { d = new Def() } = opts;
  return d;
}
`,
    });
    const results = await migrateStrip([join(dir, "src")], { write: true, draft: false });
    const main = readFileSync(join(dir, "src", "main.js"), "utf-8");
    expect(main).toContain(`import { Def } from "./def.js";`);
    expect(results.find((r) => r.file.endsWith("main.ts"))?.notes).toEqual([]);
    const mod = (await import(pathToFileURL(join(dir, "src", "main.js")).href)) as {
      pick: (opts: Record<string, unknown>) => { kind: string };
    };
    expect(mod.pick({})).toEqual({ kind: "def" });
  });

  it("BUG-220 类型专用本地再导出 ⇒ 整条 elide，产物可加载", async () => {
    const dir = project({
      "src/types.ts": `export interface Shape { kind: string }\n`,
      "src/main.ts": `import { Shape } from "./types.js";
export { Shape } from "./types.js";
export function area(s: Shape): number { return 1; }
`,
    });
    await migrateStrip([join(dir, "src")], { write: true, draft: false });
    const main = readFileSync(join(dir, "src", "main.js"), "utf-8");
    expect(main).not.toContain("export { Shape }");
    const mod = (await import(pathToFileURL(join(dir, "src", "main.js")).href)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(mod)).toEqual(["area"]);
  });

  it("BUG-220 无本地 import 的 barrel 再导出 ⇒ 按源模块声明 elide（不再留下空模块再导出）", async () => {
    const dir = project({
      "src/types.ts": `export interface Shape { kind: string }\n`,
      "src/index.ts": `export { Shape } from "./types.js";\n`,
    });
    await migrateStrip([join(dir, "src")], { write: true, draft: false });
    expect(readFileSync(join(dir, "src", "index.js"), "utf-8")).not.toContain("export { Shape }");
    // 空模块仍然可加载（改前：链接期 SyntaxError）
    const mod = (await import(pathToFileURL(join(dir, "src", "index.js")).href)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(mod)).toEqual([]);
  });

  it("BUG-220 类再导出：本文件只把它当类型用也不得删除（源模块声明是运行时值）", async () => {
    const dir = project({
      "src/types.ts": `export class Foo {}\n`,
      "src/main.ts": `import { Foo } from "./types.js";
export { Foo } from "./types.js";
export function use(f: Foo): Foo { return f; }
`,
    });
    await migrateStrip([join(dir, "src")], { write: true, draft: false });
    expect(readFileSync(join(dir, "src", "main.js"), "utf-8")).toContain(
      `export { Foo } from "./types.js";`,
    );
    const mod = (await import(pathToFileURL(join(dir, "src", "main.js")).href)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(mod).sort()).toEqual(["Foo", "use"]);
  });

  it("BUG-182 包说明符的类型专用 import 保守保留 ⇒ 必须如实提示（本地对照无提示）", async () => {
    const dir = project({
      "src/main.ts": `import { Foo } from "typeonly-pkg";
export function f(x: Foo): number { return x.a; }
`,
      "src/rel.ts": `import { Foo } from "./types.js";
export function f(x: Foo): number { return x.a; }
`,
      "src/types.d.ts": `export interface Foo { a: number }\n`,
    });
    const results = await migrateStrip([join(dir, "src")], { write: true, draft: false });
    const pkg = results.find((r) => r.file.endsWith("main.ts"));
    const rel = results.find((r) => r.file.endsWith("rel.ts"));
    expect(pkg?.notes.join("\n")).toContain("kept an import whose binding could not be proven type-only");
    expect(pkg?.notes.join("\n")).toContain("package specifier");
    // 保守保留本身不变（产物仍含包 import），但提示必须出现。
    expect(readFileSync(join(dir, "src", "main.js"), "utf-8")).toContain(`import { Foo } from "typeonly-pkg";`);
    // 本地对照：按 tsc 的 import elision 删除，且不产生「判不准」提示。
    expect(rel?.notes).toEqual([]);
    expect(readFileSync(join(dir, "src", "rel.js"), "utf-8")).not.toContain(`import { Foo }`);
  });

});
