/**
 * migrate workspace 面（pnpm/npm/yaml/GHA/workflow/脚本定位）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import * as migrate from "../migrate.ts";
import { migrateRetire, migrateStatus, rewriteWorkflowText, stripTsToJs, formatStatusTable, listWorkflowTscLines, migrateRetireAll, migrateStrip, rewriteTscCommand } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";
import { execFileSync } from "node:child_process";
import { collectNudoFiles } from "../commands/shared.ts";

// ---------------------------------------------------------------------------
// workflow 改写记录条数必须等于实际改写的行数
// ---------------------------------------------------------------------------
describe("workflow 改写记录条数必须等于实际改写的行数", () => {
/**
 * `nudo migrate retire` 的 workflow 改写**少报**（去重键 `file+from+to`
 * 不含位置）⇒ 同一 workflow 里**两处**相同的 tsc 命令只记 1 条记录，
 * 而落盘改了 2 处、`migrate status` 数到 2 行 ⇒ 报告 / 审计 / 落盘三面不一致。
 *
 * 修复：改写记录带 `line`（该 `run:` 的行号），去重键 = 文件 + 位置 + 命令。
 *
 * 反向闸：只有一处改写时仍只记 1 条（不得把同一条命令重复计数）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 两条**文本相同**的 tsc 命令（单行标量 + 折叠标量） */
const CI_TWO = [
  "steps:",
  "  - name: A single line",
  "    run: npx tsc --noEmit",
  "  - name: B folded scalar",
  "    run: >-",
  "      npx tsc --noEmit",
  "",
].join("\n");

const CI_ONE = [
  "steps:",
  "  - name: A single line",
  "    run: npx tsc --noEmit",
  "",
].join("\n");

function pkgWith(ci: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-063-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "w063",
      version: "1.0.0",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), ci, "utf-8");
  return dir;
}

describe("workflow 改写记录条数必须等于实际改写的行数", () => {
  it("两处相同命令 ⇒ 报告 2 条（带位置）、落盘 2 处、status 数到 0（已改写）", () => {
    const dir = pkgWith(CI_TWO);
    // 改前 status 数到 2 行
    expect(
      migrateStatus(dir)[0]!.blockers.find((b) => b.includes("tsc line(s)")),
    ).toBe("2 tsc line(s) in .github/workflows");

    const result = migrateRetire(dir);
    expect(result.rewrittenWorkflows).toHaveLength(2);
    expect(result.rewrittenWorkflows.map((w) => w.line)).toEqual([3, 5]);
    // 落盘确实改了 2 处
    const ci = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(ci.match(/nudojs check/g) ?? []).toHaveLength(2);
    // 审计标记与报告同条数
    const marker = JSON.parse(
      readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8"),
    ) as { rewrittenWorkflows: unknown[] };
    expect(marker.rewrittenWorkflows).toHaveLength(2);
  });

  it("反向闸：单处改写仍只记 1 条（不得因加位置而重复计数）", () => {
    const dir = pkgWith(CI_ONE);
    const result = migrateRetire(dir);
    expect(result.rewrittenWorkflows).toHaveLength(1);
    expect(result.rewrittenWorkflows[0]!.line).toBe(3);
  });
});
});

// ---------------------------------------------------------------------------
// 跨行的 shell 命令被按行拆坏
// ---------------------------------------------------------------------------
describe("跨行的 shell 命令被按行拆坏", () => {
/**
 * `nudo migrate retire` 改写 CI workflow 时**按行**处理 YAML，
 * 把**跨行的 shell 命令**拆开 ⇒ 原本可用的 CI 门禁被改坏
 * （续行标记被吃 ⇒ 命令裂成两条；折叠标量 ⇒ 旗标被并进命令）。
 *
 * 契约：块标量（`run: |` / `run: >`）在 YAML 层面是**一条标量**——
 * 改写器必须整体取出、在命令层面改写、再按原形态写回。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const WF = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  gate:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: A literal block with backslash continuation",
  "        run: |",
  "          npx tsc --noEmit \\",
  "            --project tsconfig.json",
  "      - name: B folded scalar",
  "        run: >",
  "          npx tsc",
  "          --noEmit",
  "      - name: C single line control",
  "        run: npx tsc --noEmit",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-1005-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b1005",
        version: "1.0.0",
        scripts: { typecheck: "npx tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, "ci.yml"), WF);
  return dir;
}

describe("跨行的 shell 命令被按行拆坏", () => {
  it("rewriteWorkflowText 把块标量当成一条命令改写", () => {
    const { text } = rewriteWorkflowText(WF);
    // A：续行标记与续行内容一起被改写，不得留下落单的残段
    expect(text).not.toContain("--project tsconfig.json");
    expect(text).toContain("run: |");
    expect(text).toContain("          npx nudojs check .");
    // B：折叠标量的旗标不得被并进命令
    expect(text).toContain("run: >");
    expect(text).not.toContain("npx nudojs check . --noEmit");
    // C：单行对照（step 的 `run:` 是 `name:` 的同级键）
    expect(text).toContain("        run: npx nudojs check .");
    expect(text.match(/npx nudojs check \./g)?.length).toBe(3);
  });

  it("retire 后落盘的 workflow 仍是合法 YAML 形态且命令语义正确", () => {
    const dir = fixture();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    // 落单的命令（原本的续行残段）不得残留
    expect(wf).not.toContain("--project tsconfig.json");
    expect(wf).not.toContain("npx nudojs check . --noEmit");
    // 块标量的样式保留
    expect(wf).toContain("run: |");
    expect(wf).toContain("run: >");
    // 每个 step 恰好一条 npx nudojs check 命令
    expect(wf.match(/npx nudojs check \./g)?.length).toBe(3);
    // 缩进保持（块标量内容仍比 key 深）
    expect(wf).toContain("\n          npx nudojs check .\n");
  });
});
});

// ---------------------------------------------------------------------------
// status 的 workflow blocker 归属与 retire 的作用域同口径
// ---------------------------------------------------------------------------
describe("status 的 workflow blocker 归属与 retire 的作用域同口径", () => {
/**
 * `nudo migrate status` 把**仓库根**共享 workflow 的 tsc 行算作
 * **每个子包**的 blocker ⇒ 子包 `retire` 成功后 blocker 永不消失
 * （status 与 retire 结论矛盾）。
 *
 * 根因：status 用 `listWorkflowTscLines` → `findWorkflowDir`（**向上找 6 层**），
 * 而 `retire` 的作用域是**包自有**的 `.github/workflows`（不向上找）⇒
 * status 报的 blocker `retire` 修不掉。
 *
 * 修复：status 的 workflow blocker 用 `ownWorkflowDir`（与 retire 同口径）——
 * 仓库根共享 workflow 的 tsc 行只算**根包**的 blocker。
 *
 * 反向闸：包**自有**的 workflow 仍照常计入（不得把真 blocker 也吞掉）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CI = "name: CI\njobs:\n  build:\n    steps:\n      - run: npx tsc --noEmit\n";

function monorepo(): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-102-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
    "utf-8",
  );
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), CI, "utf-8");
  const a = join(root, "packages", "a");
  mkdirSync(join(a, "src"), { recursive: true });
  writeFileSync(
    join(a, "package.json"),
    JSON.stringify({
      name: "a",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  writeFileSync(join(a, "src", "x.ts"), "export const x: number = 1;\n", "utf-8");
  return root;
}

function row(root: string, target: string) {
  const abs = relative(process.cwd(), join(root, "packages", "a"));
  return migrateStatus(target).find((r) => r.root === abs)!;
}

describe("status 的 workflow blocker 归属与 retire 的作用域同口径", () => {
  it("子包：不继承仓库根共享 workflow 的 tsc 行", () => {
    const root = monorepo();
    const sub = row(root, join(root, "packages", "a"));
    expect(sub.blockers.filter((b) => b.includes("tsc line(s)"))).toEqual([]);
    // 该包的**自有** blocker 照常报（反向闸：不是把 blocker 全吞了）
    expect(sub.blockers).toContain("tsc still in scripts");
    expect(sub.blockers).toContain("typescript still in dependencies");
  });

  it("根包：共享 workflow 的 tsc 行算在它头上（只算一次）", () => {
    const root = monorepo();
    const rows = migrateStatus(root);
    const rootRow = rows.find((r) => r.root === (relative(process.cwd(), root) || "."))!;
    expect(
      rootRow.blockers.filter((b) => b.includes("tsc line(s)")),
    ).toEqual(["1 tsc line(s) in .github/workflows"]);
  });

  it("子包 retire 成功后 blocker 清空（status 与 retire 不再矛盾）", () => {
    const root = monorepo();
    migrateRetire(join(root, "packages", "a"));
    const sub = migrateStatus(join(root, "packages", "a"))[0]!;
    expect(sub.retired).toBe(true);
    expect(sub.blockers).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// 未知 action 在 --json 下必须出合法信封
// ---------------------------------------------------------------------------
describe("未知 action 在 --json 下必须出合法信封", () => {
/**
 * `nudo migrate --json <未知 action>` ⇒ **stdout 空**（0 字节）
 * ⇒ 机器消费方 `JSON.parse("")` 抛「Unexpected end of JSON input」。
 *
 * 违反设计文档的明文契约（`docs/design/cli-semantics.md`）：
 * 「**`--json` 下 stdout 永不为空** —— 即使全部路径失败也输出信封」
 * 「绝不出现空 stdout + 非零 exit」。
 *
 * 反向闸：合法 action 的 `--json` 输出仍是合法 JSON（不得因修失败面而改成功面）。
 */



describe("未知 action 在 --json 下必须出合法信封", () => {
  it("stdout 非空、可解析、ok:false、error 点名 action", () => {
    const r = runCliTsx(["migrate", "--json", "frobnicate"]);
    expect(r.status).toBe(1);
    expect(r.stdout.length).toBeGreaterThan(0);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as Array<{ ok: boolean; action: string; error: string }>;
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("frobnicate");
    expect(parsed.error).toContain("Unknown migrate action");
  });

  it("人类面（无 --json）：错误仍进 stderr", () => {
    const r = runCliTsx(["migrate", "strp"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown migrate action");
  });

  it("反向闸：合法 action 的 --json 仍是合法 JSON", () => {
    const r = runCliTsx(["migrate", "strip", "--json", "packages/nudojs/src/migrate.ts"]);
    // 该目标不是 strip 源 ⇒ 走 no-files 分支，但 stdout 必须是合法 JSON
    expect(r.stdout.length).toBeGreaterThan(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});
});

// ---------------------------------------------------------------------------
// enum 计算成员的 strip 产物必须能在宿主里跑
// ---------------------------------------------------------------------------
describe("enum 计算成员的 strip 产物必须能在宿主里跑", () => {
/**
 * （协议面）—— `nudo migrate strip` 对 **enum 的计算成员**原样保留初始化
 * 表达式 ⇒ 产物引用**未绑定全局** ⇒ 运行时 ReferenceError；而 strip 的 note
 * 还宣称「TS enum semantics kept」。
 *
 * 本文件是**运行期**回归钉（`cli-` 只钉「产物可解析」，没钉「跑得起来」）：
 * 四种 enum 形态（数值 / 混合 / 字符串 / const）的 strip 产物都必须在宿主里
 * 跑出与 tsc 一致的结果。
 *
 * 反向闸：产物的计算成员里不得再出现裸成员标识符（`A * 10`），必须是
 * `E[\"A\"] * 10`——这正是 ReferenceError 的唯一来源。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runStrip(source: string): { code: string; notes: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-234-"));
  dirs.push(dir);
  const file = join(dir, "enum.ts");
  writeFileSync(file, source, "utf-8");
  return stripTsToJs(source, { filePath: file });
}

/** 把产物写进临时 `.mjs` 并**真的**用 node 跑它 */
function runProduct(code: string): { stdout: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-234-run-"));
  dirs.push(dir);
  const file = join(dir, "product.mjs");
  writeFileSync(file, code, "utf-8");
  try {
    const stdout = execFileSync(process.execPath, [file], {
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { stdout: stdout.trim(), status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim(), status: e.status ?? 1 };
  }
}

describe("enum 计算成员的 strip 产物必须能在宿主里跑", () => {
  it("数值 enum：`A = 1, B = A * 10, C` ⇒ [1,10,11]", () => {
    const { code } = runStrip(
      "export enum E { A = 1, B = A * 10, C }\nconsole.log(JSON.stringify([E.A, E.B, E.C]));\n",
    );
    // 反向闸：计算成员里不得再有裸 `A`
    expect(code).not.toMatch(/E\[E\["B"\] = A \*/);
    expect(code).toMatch(/E\[E\["B"\] = E\["A"\] \*/);
    const run = runProduct(code);
    expect(run.stdout).not.toContain("ReferenceError");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("[1,10,11]");
  });

  it("混合 enum：`A = 1, B = 'b', C = A + 5` ⇒ [1,\"b\",6]", () => {
    const { code } = runStrip(
      "export enum E { A = 1, B = 'b', C = A + 5 }\nconsole.log(JSON.stringify([E.A, E.B, E.C]));\n",
    );
    const run = runProduct(code);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('[1,"b",6]');
  });

  it("字符串 enum：`A = 'a', B = A + 'b'` ⇒ [\"a\",\"ab\"] 且不建反向映射", () => {
    const { code } = runStrip(
      "export enum E { A = 'a', B = A + 'b' }\nconsole.log(JSON.stringify([E.A, E.B]));\n",
    );
    const run = runProduct(code);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('["a","ab"]');
    // tsc 口径：字符串成员**不**建反向映射
    expect(code).not.toMatch(/E\[E\["B"\] =/);
  });

  it("const enum：`A = 1, B = A * 3` ⇒ [1,3]", () => {
    const { code } = runStrip(
      "export const enum E { A = 1, B = A * 3 }\nconsole.log(JSON.stringify([E.A, E.B]));\n",
    );
    const run = runProduct(code);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("[1,3]");
  });

  it("strip 的 note 仍声明语义已保住（现在与事实一致）", () => {
    const { notes } = runStrip("export enum E { A = 1, B = A * 10 }\n");
    expect(notes.join("\n")).toContain("TS enum semantics kept");
  });

  it("反向闸：无计算成员的 enum 产物不变（不引入多余改写）", () => {
    const { code } = runStrip(
      "export enum E { A = 1, B }\nconsole.log(JSON.stringify([E.A, E.B, E[1]]));\n",
    );
    expect(code).toContain('E[E["A"] = 1] = "A"');
    expect(code).toContain('E[E["B"] = 2] = "B"');
    const run = runProduct(code);
    expect(run.stdout).toBe('[1,2,"A"]');
  });
});
});

// ---------------------------------------------------------------------------
// migrate status 的 nudo 门禁判定看命令文本，不看脚本名
// ---------------------------------------------------------------------------
describe("migrate status 的 nudo 门禁判定看命令文本，不看脚本名", () => {
/**
 * `migrate status` 的「no nudo check/test script yet」是**假阻塞**：
 * 判定用脚本**名**（`/check|test/` 匹配脚本名），采集用脚本**命令**（`/\bnudo\b/`）。
 * ⇒ 命令已经是 `nudo check .` / `npx nudojs check .`、但脚本名叫 `lint` / `typecheck2`
 * 的包被报成「还没有 nudo 门禁」；retire 改写后（`npx nudojs check .`）该阻塞**永不消失**。
 *
 * 期望：门禁判定口径 = **命令文本**（`nudo check` / `npx nudojs check` / `nudo test`）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(name: string, scripts: Record<string, string>, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-571-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", scripts, ...extra }),
    "utf-8",
  );
  writeFileSync(join(dir, "index.ts"), "export const x = 1;\n", "utf-8");
  return dir;
}

describe("migrate status 的 nudo 门禁判定看命令文本，不看脚本名", () => {
  it("脚本名不含 check/test、命令是 nudo check ⇒ 不得报「no nudo check/test script yet」", () => {
    const dir = pkg("named2-pkg", { lint: "nudo check ." }, {
      devDependencies: { typescript: "^5.0.0" },
    });
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoScripts).toContain("lint");
    expect(rows[0]!.blockers).not.toContain("no nudo check/test script yet");
  });

  it("retire 改写后的形态 `npx nudojs check .` 同样算已有门禁（旧口径匹配不到 nudojs）", () => {
    const dir = pkg("retired-shape", { typecheck2: "npx nudojs check ." });
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).not.toContain("no nudo check/test script yet");
  });

  it("`nudo test` 也是门禁", () => {
    const dir = pkg("test-shape", { gate: "nudo test ." });
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).not.toContain("no nudo check/test script yet");
  });

  it("反向闸：命令里没有 nudo 门禁 ⇒ 仍必须报该阻塞（判定不是恒假）", () => {
    const dir = pkg("no-gate", { build: "tsc -p ." });
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).toContain("no nudo check/test script yet");
  });

  it("字符串里的 nudo check 不算门禁（shell 掩码口径不变）", () => {
    const dir = pkg("quoted", { note: 'echo "please run nudo check ."' });
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).toContain("no nudo check/test script yet");
  });

  it("文本面不再出现该假阻塞", () => {
    const dir = pkg("named2-pkg-text", { lint: "nudo check ." });
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).not.toContain("no nudo check/test script yet");
  });
});
});

// ---------------------------------------------------------------------------
// migrate status 的依赖口径必须含 peerDependencies
// ---------------------------------------------------------------------------
describe("migrate status 的依赖口径必须含 peerDependencies", () => {
/**
 * `peerDependencies.typescript` 不在 `status` 的作用域里：
 * status 的依赖集合只合并 `dependencies` + `devDependencies` ⇒
 * 只把 typescript 放在 peerDependencies 的包被报成「typescript dep: no」（假绿），
 * 且没有「typescript still in dependencies」阻塞（三个动词对同一事实三种答案）。
 *
 * 期望：依赖合并口径 = dependencies + devDependencies + peerDependencies + optionalDependencies。
 */






const { migrateStatus } = migrate;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(name: string, deps: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-572-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", ...deps }),
    "utf-8",
  );
  writeFileSync(
    join(dir, "src", "b.ts"),
    "export function mul(a: number, b: number): number { return a * b; }\n",
    "utf-8",
  );
  return dir;
}

describe("migrate status 的依赖口径必须含 peerDependencies", () => {
  it("peerDependencies.typescript ⇒ typescriptDep 为 true 且报出阻塞", () => {
    const dir = pkg("pkg-b", { peerDependencies: { typescript: "^5.0.0" } });
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.typescriptDep).toBe(true);
    expect(rows[0]!.blockers).toContain("typescript still in dependencies");
  });

  it("devDependencies / dependencies 口径不回退", () => {
    const dir = pkg("pkg-a", { devDependencies: { typescript: "^5.0.0" } });
    expect(migrateStatus(dir)[0]!.typescriptDep).toBe(true);
    const dir2 = pkg("pkg-a2", { dependencies: { typescript: "^5.0.0" } });
    expect(migrateStatus(dir2)[0]!.typescriptDep).toBe(true);
  });

  it("optionalDependencies.typescript 也算（四个来源同一口径）", () => {
    const dir = pkg("pkg-opt", { optionalDependencies: { typescript: "^5.0.0" } });
    expect(migrateStatus(dir)[0]!.typescriptDep).toBe(true);
  });

  it("反向闸：没有 typescript 依赖 ⇒ typescriptDep 为 false（判定不是恒真）", () => {
    const dir = pkg("pkg-none", { dependencies: { react: "^18.0.0" } });
    const rows = migrateStatus(dir);
    expect(rows[0]!.typescriptDep).toBe(false);
    expect(rows[0]!.blockers).not.toContain("typescript still in dependencies");
  });

  it("mergePackageDeps 合并四个依赖来源，且忽略非对象字段", () => {
    const merged = migrate.mergePackageDeps({
      dependencies: { a: "1" },
      devDependencies: { b: "2" },
      peerDependencies: { c: "3" },
      optionalDependencies: { d: "4" },
      scripts: { x: "y" },
    });
    expect(merged).toEqual({ a: "1", b: "2", c: "3", d: "4" });
  });
});
});

// ---------------------------------------------------------------------------
// migrate status 的 tsFiles 按 workspace 包边界统计
// ---------------------------------------------------------------------------
describe("migrate status 的 tsFiles 按 workspace 包边界统计", () => {
/**
 * `migrate status` 根行的 `tsFiles` 把**所有嵌套 workspace 包**的 .ts
 * 重复计入（listFiles 是目录递归，不按包边界裁剪）⇒ 根行 = 全仓库面，
 * 且与各包行重复计数（审计面「表面积」数字错）。
 *
 * 期望：status 按包分行 ⇒ 每行只统计**该包自己**的 .ts/.tsx。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-573-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "migws-root", version: "1.0.0", private: true }),
    "utf-8",
  );
  writeFileSync(join(dir, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n', "utf-8");
  for (const name of ["hasTsc", "peerOnly"]) {
    const p = join(dir, "packages", name);
    mkdirSync(join(p, "src"), { recursive: true });
    writeFileSync(
      join(p, "package.json"),
      JSON.stringify({ name, version: "1.0.0" }),
      "utf-8",
    );
    writeFileSync(join(p, "src", "x.ts"), "export const x = 1;\n", "utf-8");
  }
  return dir;
}

describe("migrate status 的 tsFiles 按 workspace 包边界统计", () => {
  it("根包自己 0 个 .ts ⇒ 根行 tsFiles 为 0（不重复计入子包）", () => {
    const dir = workspace();
    const rows = migrateStatus(dir);
    const base = dir.split("/").pop()!;
    const root = rows.find((r) => r.root.endsWith(base))!;
    expect(root).toBeDefined();
    expect(root.tsFiles).toBe(0);
    // 子包各自 1 个 .ts（计数不被吞掉）
    const subs = rows.filter((r) => r.root !== root.root);
    expect(subs).toHaveLength(2);
    for (const s of subs) expect(s.tsFiles).toBe(1);
  });

  it("反向闸：根包自己有 .ts 时，根行仍要数到自己的文件", () => {
    const dir = workspace();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "root.ts"), "export const r = 1;\n", "utf-8");
    const rows = migrateStatus(dir);
    const base = dir.split("/").pop()!;
    const root = rows.find((r) => r.root.endsWith(base))!;
    expect(root.tsFiles).toBe(1);
  });

  it("子包的 .tsx 也只算在子包行", () => {
    const dir = workspace();
    writeFileSync(
      join(dir, "packages", "hasTsc", "src", "c.tsx"),
      "export const C = () => null;\n",
      "utf-8",
    );
    const rows = migrateStatus(dir);
    const base = dir.split("/").pop()!;
    const root = rows.find((r) => r.root.endsWith(base))!;
    expect(root.tsxFiles).toBe(0);
    const sub = rows.find((r) => r.root.includes("hasTsc"))!;
    expect(sub.tsxFiles).toBe(1);
  });
});
});

// ---------------------------------------------------------------------------
// 注入的 check:nudo 必须真的落盘
// ---------------------------------------------------------------------------
describe("注入的 check:nudo 必须真的落盘", () => {
/**
 * `nudo migrate retire` 注入的 `check:nudo` **从未落盘**，
 * 但 CLI 输出与审计记录**都谎报「已改写」**。
 *
 * 根因：`pkg.scripts ?? {}` 产生**局部新对象**，注入写进局部副本，`pkg.scripts` 从未被赋值。
 * 期望：注入真的落进 package.json；报告与审计记录只记真正落盘的改动。
 * 反向闸：有 scripts 键的包注入照常落盘（断言非永真）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function noScriptsPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-578-"));
  dirs.push(dir);
  // 没有 scripts 键
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "f1-noscripts", "version": "1.0.0", "devDependencies": { "typescript": "^5.0.0" } }\n',
    "utf-8",
  );
  return dir;
}

describe("注入的 check:nudo 必须真的落盘", () => {
  it("库面：package.json 出现 scripts.check:nudo（报告与落盘一致）", () => {
    const dir = noScriptsPkg();
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts!["check:nudo"]).toBe("nudo check .");
    // 报告里说的就是落盘的
    expect(result.rewrittenScripts.some((s) => s.name === "check:nudo")).toBe(true);
  });

  it("CLI 面：--json 报文里报改了，落盘也得有", () => {
    const dir = noScriptsPkg();
    const r = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(r.status).toBe(0);
    // 收口：`migrate retire --json` 的顶层形状**恒为数组**（1 个包
    // 也是数组）⇒ 取第一条结果。
    const reported = JSON.parse(r.stdout) as Array<{
      rewrittenScripts: Array<{ name: string }>;
    }>;
    expect(Array.isArray(reported)).toBe(true);
    expect(reported[0]!.rewrittenScripts.some((s) => s.name === "check:nudo")).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["check:nudo"]).toBe("nudo check .");
  });

  it("反向闸：已有 scripts 键的包，注入也落进**既有** scripts 对象（不丢原有脚本）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m5-578-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "withscripts",
        scripts: { test: "node -e 0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:nudo"]).toBe("nudo check .");
    expect(pkg.scripts["test"]).toBe("node -e 0");
  });
});
});

// ---------------------------------------------------------------------------
// workflow 里非命令位的 tsc 被当命令改写（数据损坏）
// ---------------------------------------------------------------------------
describe("workflow 里非命令位的 tsc 被当命令改写（数据损坏）", () => {
/**
 * `nudo migrate retire` 把 workflow 里**任何提到 tsc 的行**当命令改写
 * ⇒ 数据损坏（env 变量的值 / 描述性文字被改成门禁命令）。
 *
 * 契约：workflow YAML 里**只有 `run:` 的标量是命令位**；
 * env 值 / 描述文字 / 注释必须逐字保留。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const WF = [
  "name: CI",
  "on: [push]",
  "env:",
  "  TSC: tsc",
  "  NOTE: use tsc for typecheck",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npx tsc --noEmit",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-579-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b579",
        version: "1.0.0",
        scripts: { typecheck: "npx tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, "ci.yml"), WF);
  return dir;
}

describe("workflow 里非命令位的 tsc 被当命令改写（数据损坏）", () => {
  it("status 的 tsc 行数只数真正的命令行（1 条，不是 3 条）", () => {
    const dir = fixture();
    expect(listWorkflowTscLines(dir).length).toBe(1);
    expect(listWorkflowTscLines(dir)[0]!.line).toContain("npx tsc --noEmit");
  });

  it("retire 后 env 值 / 描述文字逐字未变，只有 run: 那条被改写", () => {
    const dir = fixture();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    // 非命令位：逐字未变
    expect(wf).toContain("  TSC: tsc\n");
    expect(wf).toContain("  NOTE: use tsc for typecheck\n");
    // 命令位：被改写
    expect(wf).toContain("- run: npx nudojs check .");
    expect(wf).not.toContain("- run: npx tsc --noEmit");
    // 非命令位不得出现门禁命令
    expect(wf).not.toContain("TSC: nudo check");
    expect(wf).not.toContain("NOTE: use nudo check");
  });

  it("status 的 workflow blocker 计数与改写口径一致", () => {
    const dir = fixture();
    const rows = migrateStatus(dir);
    const blocker = rows[0]!.blockers.find((b) => b.includes("tsc line(s)"));
    expect(blocker).toBe("1 tsc line(s) in .github/workflows");
  });
});
});

// ---------------------------------------------------------------------------
// YAML 引号包住的 run: tsc 命令被漏改（假绿）
// ---------------------------------------------------------------------------
describe("YAML 引号包住的 run: tsc 命令被漏改（假绿）", () => {
/**
 * `nudo migrate retire` **漏改** YAML 引号包住的 `run:` tsc 命令
 * ⇒ 报「已退役」但 CI 的 tsc 门禁原样保留（假绿）。
 *
 * 契约：YAML 的标量引号 ≠ shell 的引号——处理 `run:` 时按 **YAML 语义**取标量
 * （剥掉 YAML 自己的引号），不得用 shell 词法掩码把引号内容当字符串遮掉。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const WF = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npx tsc --noEmit",
  '      - run: "npx tsc --noEmit"',
  "      - run: 'npx tsc --noEmit'",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-580-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b580",
        version: "1.0.0",
        scripts: { typecheck: "npx tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, "ci.yml"), WF);
  return dir;
}

describe("YAML 引号包住的 run: tsc 命令被漏改（假绿）", () => {
  it("rewriteWorkflowText 改写引号标量里的 tsc（保留原引号风格）", () => {
    const { text, changes } = rewriteWorkflowText(WF);
    expect(changes.length).toBe(3);
    expect(text).toContain('- run: "npx nudojs check ."');
    expect(text).toContain("- run: 'npx nudojs check .'");
    expect(text).toContain("- run: npx nudojs check .");
    expect(text).not.toContain("tsc --noEmit");
  });

  it("status 的 tsc 行数与真实条数一致（3 条，不是 1 条）", () => {
    const dir = fixture();
    expect(listWorkflowTscLines(dir).length).toBe(3);
    const blocker = migrateStatus(dir)[0]!.blockers.find((b) => b.includes("tsc line(s)"));
    expect(blocker).toBe("3 tsc line(s) in .github/workflows");
  });

  it("retire 后 CI 里不再残留 tsc 门禁", () => {
    const dir = fixture();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).not.toContain("tsc --noEmit");
    expect(wf).toContain('- run: "npx nudojs check ."');
    expect(wf).toContain("- run: 'npx nudojs check .'");
  });
});
});

// ---------------------------------------------------------------------------
// 对象式 workspaces（{ packages: [...] }）不被忽略
// ---------------------------------------------------------------------------
describe("对象式 workspaces（{ packages: [...] }）不被忽略", () => {
/**
 * `nudo migrate status` / `retire --all` **整个忽略对象式 workspaces**
 * （`{ "packages": [...] }`，npm / yarn berry 经典写法）⇒ 子包不可见、
 * 其 tsc 门禁留着却报「已退役」（假绿）。
 *
 * 根因：`packageRoots` 用 `Array.isArray(workspaces)` 判形态，对象形态被**静默丢弃**。
 * 本钉同时锁住：子包在 status 里**可见**、在 `retire --all` 的作用域里、
 * 且 `retire --all` **真的退役**它（落盘可见）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});


/** 对象式 workspaces：`{ "packages": ["packages/*"] }` */
function objectFormFixture(): { dir: string; sub: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-581-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "root-581",
      version: "1.0.0",
      private: true,
      workspaces: { packages: ["packages/*"] },
    }),
    "utf-8",
  );
  const sub = join(dir, "packages", "a");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(sub, "package.json"),
    JSON.stringify({
      name: "a-581",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return { dir, sub };
}

describe("对象式 workspaces（{ packages: [...] }）不被忽略", () => {
  it("status 能看到对象式 workspaces 的子包（改前：整行消失）", () => {
    const { dir, sub } = objectFormFixture();
    const rows = migrateStatus(dir);
    const roots = rows.map((r) => resolve(r.root));
    expect(roots).toContain(resolve(sub));
    const row = rows.find((r) => resolve(r.root) === resolve(sub));
    expect(row).toBeDefined();
    expect(row!.typescriptDep).toBe(true);
    expect(row!.tscScripts).toContain("typecheck");
    // 根行仍在（根目录自身始终是第一个根）
    expect(roots).toContain(resolve(dir));
  });

  it("retire --all 把对象式 workspaces 的子包纳入作用域并真的退役（落盘可见）", () => {
    const { dir, sub } = objectFormFixture();
    const results = migrateRetireAll(dir, { workflows: false });
    expect(results.map((r) => resolve(r.root))).toEqual([resolve(sub)]);
    const pkg = JSON.parse(readFileSync(join(sub, "package.json"), "utf-8"));
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(pkg.scripts.typecheck).toContain("nudo check");
    expect(existsSync(join(sub, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  it("CLI：migrate status 的 stdout 列出对象式 workspaces 的子包（exit 0）", () => {
    const { dir, sub } = objectFormFixture();
    const r = runCliTsx(["migrate", "status", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(relative(process.cwd(), sub));
    expect(r.stdout).toContain("typescript dep: yes");
  });

  it("对照组：数组式 workspaces 仍然可见（回归护栏，不被本次改动带坏）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-581-arr-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "root-581-arr",
        version: "1.0.0",
        private: true,
        workspaces: ["packages/*"],
      }),
      "utf-8",
    );
    const sub = join(dir, "packages", "b");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, "package.json"),
      JSON.stringify({
        name: "b-581",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const rows = migrateStatus(dir);
    expect(rows.map((r) => resolve(r.root))).toContain(resolve(sub));
  });
});
});

// ---------------------------------------------------------------------------
// pnpm 负向模式（`!packages/legacy`）真的排除
// ---------------------------------------------------------------------------
describe("pnpm 负向模式（`!packages/legacy`）真的排除", () => {
/**
 * `nudo migrate` 把 pnpm 用 `!packages/legacy` **显式排除**的包
 * 当成 workspace 包 ⇒ `retire --all` **真的改写**了被排除的包
 * （删 typescript 依赖 / 改 tsc 脚本 / 写退役 marker）——单向退役闸门下的数据损坏。
 *
 * 根因：`packageRoots` 把 `!…` 当成「不新增根的 pattern」直接 `continue`，
 * 排除**语义从未实现** ⇒ `packages/*` 把 `packages/legacy` 一并收进作用域。
 *
 * 本钉锁住：被排除的包**不进 status**、**不被 retire --all 改写**（落盘逐字不变）、
 * **不写 marker**；同 workspace 里未被排除的包**照常**退役。
 * oracle = pnpm 自身的 workspace 解析（`pnpm ls -r --depth -1` 不含 legacy）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const LEGACY_PKG = `${JSON.stringify(
  {
    name: "legacy-584",
    version: "1.0.0",
    scripts: { typecheck: "tsc --noEmit" },
    devDependencies: { typescript: "^5.0.0" },
  },
  null,
  2,
)}\n`;

/** pnpm workspace：`packages/*` + 负向模式 `!packages/legacy` */
function negativePatternFixture(): { dir: string; app: string; legacy: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-584-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", '  - "packages/*"', '  - "!packages/legacy"', ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "root-584", version: "1.0.0", private: true }),
    "utf-8",
  );
  const app = join(dir, "packages", "app");
  const legacy = join(dir, "packages", "legacy");
  mkdirSync(app, { recursive: true });
  mkdirSync(legacy, { recursive: true });
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      name: "app-584",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  writeFileSync(join(legacy, "package.json"), LEGACY_PKG, "utf-8");
  return { dir, app, legacy };
}

describe("pnpm 负向模式（`!packages/legacy`）真的排除", () => {
  it("status 不列出被 pnpm 排除的包（改前：legacy 占一行）", () => {
    const { dir, app, legacy } = negativePatternFixture();
    const roots = migrateStatus(dir).map((r) => resolve(r.root));
    expect(roots).toContain(resolve(app));
    expect(roots).not.toContain(resolve(legacy));
  });

  it("retire --all 只退役未被排除的包", () => {
    const { dir, app, legacy } = negativePatternFixture();
    const results = migrateRetireAll(dir, { workflows: false });
    expect(results.map((r) => resolve(r.root))).toEqual([resolve(app)]);
    // 被排除的包照常退役（对照组：排除不能把整仓都吃掉）
    const appPkg = JSON.parse(readFileSync(join(app, "package.json"), "utf-8"));
    expect(appPkg.devDependencies.typescript).toBeUndefined();
    expect(existsSync(join(app, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  it("retire --all 不改写被排除的包：package.json 逐字不变、不写 marker", () => {
    const { dir, legacy } = negativePatternFixture();
    migrateRetireAll(dir, { workflows: false });
    expect(readFileSync(join(legacy, "package.json"), "utf-8")).toBe(LEGACY_PKG);
    expect(existsSync(join(legacy, ".nudo", "migrate-retired.json"))).toBe(false);
    expect(existsSync(join(legacy, ".nudo"))).toBe(false);
  });

  it("CLI：retire --all --dry-run 的 stdout 不含被排除的包，stderr 显式说明跳过", () => {
    const { dir, legacy } = negativePatternFixture();
    const r = runCliTsx(["migrate", "retire", "--all", "--dry-run", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("packages/legacy");
    expect(r.stdout).toContain("packages/app");
    expect(r.stderr).toContain("skipped (pnpm excluded)");
    expect(r.stderr).toContain("packages/legacy");
  });

  it("CLI：retire --all 不落盘到被排除的包（package.json 不变）", () => {
    const { dir, legacy } = negativePatternFixture();
    const r = runCliTsx(["migrate", "retire", "--all", "--no-workflows", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("packages/legacy");
    expect(readFileSync(join(legacy, "package.json"), "utf-8")).toBe(LEGACY_PKG);
    expect(existsSync(join(legacy, ".nudo"))).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// 编译脚本不得被改写成 nudo check
// ---------------------------------------------------------------------------
describe("编译脚本不得被改写成 nudo check", () => {
/**
 * `nudo migrate retire` 把**编译脚本**（`build`）改写成 `nudo check .`
 * —— 构建不再产出任何产物，却绿灯通过并写下「已退役」标记。
 *
 * 期望：只改写**门禁角色**的脚本（`--noEmit` / 裸 tsc）；
 * 编译角色脚本（脚本名是构建角色 / 发射旗标 / `-b` / `-p` 无 `--noEmit`）**原样保留**，
 * 并且 typescript 依赖因此保留（摘掉它 build 当场坏掉）。
 * 反向闸：门禁脚本照常改写（断言非永真）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function buildPkg(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-586-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export const x: number = 1;\n", "utf-8");
  writeFileSync(
    join(dir, "tsconfig.build.json"),
    '{ "compilerOptions": { "outDir": "dist", "declaration": true } }\n',
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "buildpkg",
      version: "1.0.0",
      scripts,
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return dir;
}

describe("编译脚本不得被改写成 nudo check", () => {
  it("build（tsc -p tsconfig.build.json）原样保留，门禁脚本照常改写", () => {
    const dir = buildPkg({ build: "tsc -p tsconfig.build.json", typecheck: "tsc --noEmit" });
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // 编译脚本未被改写（仍产出 dist）
    expect(pkg.scripts["build"]).toBe("tsc -p tsconfig.build.json");
    expect(pkg.scripts["build"]).not.toContain("nudo check");
    // 门禁脚本被改写
    expect(pkg.scripts["typecheck"]).toContain("nudo check");
    // 报告里点出保留的编译器脚本
    expect(result.preservedScripts.map((s) => s.name)).toContain("build");
    // 编译器脚本仍要 tsc ⇒ 依赖不得摘（摘了 build 当场坏掉）
    expect(pkg.devDependencies["typescript"]).toBe("^5.0.0");
    expect(result.removedDeps).not.toContain("devDependencies");
  });

  it("只有编译脚本的包：明确拒绝退役，脚本零改动", () => {
    const dir = buildPkg({ build: "tsc -p tsconfig.build.json" });
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    expect(() => migrateRetire(dir, { workflows: false })).toThrow(/nothing to retire/);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  });

  it("CLI 面：build 不被改写", () => {
    const dir = buildPkg({ build: "tsc -p tsconfig.build.json", typecheck: "tsc --noEmit" });
    const r = runCliTsx(["migrate", "retire", dir, "--no-workflows"]);
    expect(r.status).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe("tsc -p tsconfig.build.json");
    expect(r.stdout).not.toContain("script build:");
  });

  it("反向闸：纯门禁脚本照常改写 + 摘依赖（断言非永真）", () => {
    const dir = buildPkg({ typecheck: "tsc --noEmit" });
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
    expect(result.removedDeps).toContain("devDependencies");
  });
});
});

// ---------------------------------------------------------------------------
// migrate strip 改写相对说明符
// ---------------------------------------------------------------------------
describe("migrate strip 改写相对说明符", () => {
/**
 * `migrate strip` 不改写相对模块说明符 ⇒ 产物里留着 `from "./helper"`。
 *
 * 根因：strip 只做 AST 级 TS 剥除，不碰 `import.source`；ESM 规定相对说明符
 * 必须带显式扩展名 ⇒ Node 加载不了（ERR_MODULE_NOT_FOUND），而 strip / verify /
 * check 三个面都不做链接检查 ⇒ 零告警放行。
 *
 * 期望：产物里的相对说明符指向**产物的真实文件名**（按源扩展名映射）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("migrate strip 改写相对说明符", () => {
  it("import \"./helper\" ⇒ 产物写 \"./helper.js\"", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-587-"));
    dirs.push(dir);
    writeFileSync(join(dir, "helper.ts"), `export function helper(): number { return 1; }\n`, "utf-8");
    writeFileSync(
      join(dir, "use.ts"),
      `import { helper } from "./helper";\nexport function use(): number { return helper(); }\n`,
      "utf-8",
    );

    await migrateStrip([dir], { write: true, draft: false });

    const out = readFileSync(join(dir, "use.js"), "utf-8");
    expect(out).toContain('from "./helper.js"');
    // 改前：原样保留 "./helper" ⇒ Node 加载不了
    expect(out).not.toContain('from "./helper"');
  });

  it("export … from 也被改写", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-587b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "helper.ts"), `export const v = 1;\n`, "utf-8");
    writeFileSync(join(dir, "reexport.ts"), `export { v } from "./helper";\n`, "utf-8");

    await migrateStrip([dir], { write: true, draft: false });
    expect(readFileSync(join(dir, "reexport.js"), "utf-8")).toContain('"./helper.js"');
  });

  it("包说明符不动（非相对说明符不在 ESM 扩展名规则的范围内）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-587c-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "use.ts"),
      `import { x } from "@nudojs/core";\nexport const y = x;\n`,
      "utf-8",
    );
    await migrateStrip([dir], { write: true, draft: false });
    const out = readFileSync(join(dir, "use.js"), "utf-8");
    expect(out).toContain('"@nudojs/core"');
  });

  it("相对说明符指向目录 ⇒ 补成目录索引（./dir → ./dir/index.js）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-587d-"));
    dirs.push(dir);
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "index.ts"), `export const v = 1;\n`, "utf-8");
    writeFileSync(join(dir, "use.ts"), `import { v } from "./sub";\nexport const y = v;\n`, "utf-8");
    await migrateStrip([dir], { write: true, draft: false });
    expect(readFileSync(join(dir, "use.js"), "utf-8")).toContain('"./sub/index.js"');
  });
});
});

// ---------------------------------------------------------------------------
// migrate status 区分「package.json 不存在」与「解析失败」
// ---------------------------------------------------------------------------
describe("migrate status 区分「package.json 不存在」与「解析失败」", () => {
/**
 * `migrate status` **吞掉畸形的 package.json**（readJson 解析失败 ⇒ undefined，
 * 与「文件不存在」不可区分）⇒ 报「typescript dep: no」＋「tscScripts: []」（假绿）。
 * 同一份文件在 `nudo check` 面被明确报成「package.json parse failed」。
 *
 * 期望：status 必须区分「不存在」/「解析失败」——
 * 解析失败 ⇒ 显式报出（blockers + JSON 字段 packageJsonError），不得当成「没有」。
 */






const { migrateStatus, formatStatusTable } = migrate;


const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function malformed() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-588-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  // 缺一个右花括号（JSON 语法错）
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "bad1", "scripts": { "typecheck": "tsc --noEmit" }, "devDependencies": { "typescript": "^5.0.0" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "src", "a.ts"), "export const a: number = 1;\n", "utf-8");
  return dir;
}

describe("migrate status 区分「package.json 不存在」与「解析失败」", () => {
  it("解析失败 ⇒ blockers 显式报出 + packageJsonError 字段", () => {
    const dir = malformed();
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.packageJson).toBe(true);
    expect(rows[0]!.packageJsonError).toBeDefined();
    expect(rows[0]!.packageJsonError).toContain("package.json parse failed");
    expect(rows[0]!.blockers).toContain("package.json parse failed");
  });

  it("文本面出现解析失败行", () => {
    const dir = malformed();
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).toContain("package.json parse failed");
  });

  it("JSON 面带 packageJsonError 且 stdout 是合法 JSON", () => {
    const dir = malformed();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(String(parsed[0]!.packageJsonError)).toContain("package.json parse failed");
    expect(parsed[0]!.blockers).toContain("package.json parse failed");
  });

  it("反向闸：合法 package.json ⇒ 无 packageJsonError、无该阻塞", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m2-588-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "ok1", version: "1.0.0", devDependencies: { typescript: "^5.0.0" } }),
      "utf-8",
    );
    const rows = migrateStatus(dir);
    expect(rows[0]!.packageJsonError).toBeUndefined();
    expect(rows[0]!.blockers).not.toContain("package.json parse failed");
  });

  it("反向闸：package.json 不存在 ≠ 解析失败（missing 不算错误）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m2-588-missing-"));
    dirs.push(dir);
    const rows = migrateStatus(dir);
    expect(rows[0]!.packageJson).toBe(false);
    expect(rows[0]!.packageJsonError).toBeUndefined();
    expect(rows[0]!.blockers).not.toContain("package.json parse failed");
  });

  it("readPackageJsonDetailed 分类：missing / ok / invalid", () => {
    const dir = malformed();
    expect(migrate.readPackageJsonDetailed(join(dir, "package.json")).kind).toBe("invalid");
    expect(migrate.readPackageJsonDetailed(join(dir, "nope.json")).kind).toBe("missing");
    const ok = mkdtempSync(join(tmpdir(), "nudo-m2-588-ok2-"));
    dirs.push(ok);
    writeFileSync(join(ok, "package.json"), '{"name":"x"}', "utf-8");
    expect(migrate.readPackageJsonDetailed(join(ok, "package.json")).kind).toBe("ok");
  });
});
});

// ---------------------------------------------------------------------------
// migrate status 的 blockers 汇总不得泄漏占位符「—」
// ---------------------------------------------------------------------------
describe("migrate status 的 blockers 汇总不得泄漏占位符「—」", () => {
/**
 * `nudo migrate status` 的 `blockers` 串里**泄漏占位符「—」**：
 * blockers 用「—」表示「本项无」，汇总成逗号串时没过滤占位符 ⇒
 * 用户 / 脚本看到 `1 tsc line(s) in .github/workflows; —` 会以为有**两条**待办。
 *
 * 期望：占位符不得出现在 blockers 汇总里（无阻塞项 ⇒ 空）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 本包无 TS、无依赖、无 tsc 脚本，但仓库 workflow 里还有 tsc 行 */
function pkgWithWorkflowTsc() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-590-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "wf-pkg", version: "1.0.0", private: true }),
    "utf-8",
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(
    join(wf, "ci.yml"),
    "name: CI\njobs:\n  typecheck:\n    steps:\n      - run: npx tsc --noEmit\n",
    "utf-8",
  );
  return dir;
}

describe("migrate status 的 blockers 汇总不得泄漏占位符「—」", () => {
  it("blockers 数组里没有「—」元素", () => {
    const dir = pkgWithWorkflowTsc();
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).not.toContain("—");
    for (const b of rows[0]!.blockers) expect(b.trim()).not.toBe("—");
  });

  it("文本面只有真 blocker，不带占位符", () => {
    const dir = pkgWithWorkflowTsc();
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).toContain("blockers: 1 tsc line(s) in .github/workflows");
    expect(text).not.toContain("—");
  });

  it("反向闸：真有 blocker 时占位符也不得混入（防御性过滤）", () => {
    const text = formatStatusTable([
      {
        root: "x",
        packageJson: true,
        typescriptDep: false,
        tsconfig: false,
        tscScripts: [],
        tsFiles: 0,
        tsxFiles: 0,
        nudoScripts: [],
        nudoConfig: false,
        retired: false,
        retiring: false,
        blockers: ["1 tsc line(s) in .github/workflows", "—"],
      },
    ]);
    expect(text).toContain("blockers: 1 tsc line(s) in .github/workflows");
    expect(text).not.toContain("—");
  });

  it("反向闸：只有占位符 ⇒ 文本面不出现 blockers 行", () => {
    const text = formatStatusTable([
      {
        root: "x",
        packageJson: true,
        typescriptDep: false,
        tsconfig: false,
        tscScripts: [],
        tsFiles: 0,
        tsxFiles: 0,
        nudoScripts: [],
        nudoConfig: false,
        retired: false,
        retiring: false,
        blockers: ["—"],
      },
    ]);
    expect(text).not.toContain("blockers:");
  });
});
});

// ---------------------------------------------------------------------------
// migrate strip --backup 撞名不静默跳过
// ---------------------------------------------------------------------------
describe("migrate strip --backup 撞名不静默跳过", () => {
/**
 * `migrate strip --backup` 撞到已存在的 `<file>.ts.bak` 时**静默跳过备份**。
 *
 * 根因：备份分支的条件是 `!existsSync(`${file}.bak`)` ⇒ 撞名就什么都不做，
 * exit 0、输出里也没有一行说明 ⇒ 用户以为备份了，其实在写一份「看起来像备份、
 * 内容却是旧的」的文件，后续按 `.bak` 恢复会拿到陈旧源码。
 *
 * 期望：备份成功与否必须在输出里有一行明确交代；撞名不得静默跳过。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("migrate strip --backup 撞名不静默跳过", () => {
  it("已有 keep.ts.bak ⇒ 换名留底（keep.ts.1.bak），且旧备份原样保留", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-591-"));
    dirs.push(dir);
    writeFileSync(join(dir, "keep.ts.bak"), `export const OLD = 1;\n`, "utf-8");
    writeFileSync(join(dir, "keep.ts"), `export function keep(): number { return 1; }\n`, "utf-8");

    const results = await migrateStrip([dir], { write: true, draft: false, backup: true });

    // 源确实被改名留底（改前：源留在原地、备份静默跳过）
    expect(existsSync(join(dir, "keep.ts"))).toBe(false);
    // 新备份不撞名
    expect(existsSync(join(dir, "keep.ts.1.bak"))).toBe(true);
    expect(readFileSync(join(dir, "keep.ts.1.bak"), "utf-8")).toContain("function keep");
    // 旧备份没被覆盖（陈旧内容仍可辨认）
    expect(readFileSync(join(dir, "keep.ts.bak"), "utf-8")).toContain("OLD");
  });

  it("备份动作在输出里有一行明确交代（源是否被改名是可观测事实）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-591b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "keep.ts.bak"), `export const OLD = 1;\n`, "utf-8");
    writeFileSync(join(dir, "keep.ts"), `export function keep(): number { return 1; }\n`, "utf-8");

    const results = await migrateStrip([dir], { write: true, draft: false, backup: true });
    const notes = results.flatMap((r) => r.notes).join("\n");
    expect(notes).toMatch(/backed up .*keep\.ts\.1\.bak/);
  });

  it("没有撞名时备份名仍是 <file>.bak", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-591c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "keep.ts"), `export function keep(): number { return 1; }\n`, "utf-8");

    await migrateStrip([dir], { write: true, draft: false, backup: true });
    expect(existsSync(join(dir, "keep.ts.bak"))).toBe(true);
    expect(existsSync(join(dir, "keep.ts"))).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// migrate status --json 的 blockers 无 blocker 时必须是 []
// ---------------------------------------------------------------------------
describe("migrate status --json 的 blockers 无 blocker 时必须是 []", () => {
/**
 * `nudo migrate status --json` 的 `blockers` **数组元素**是占位符 `"—"`：
 * 机器面把「无 blocker」当成**一条 blocker**（文本面会过滤掉它）⇒
 * 消费方按 `blockers.length` 判「能否退役」永远 ≥ 1 ⇒ 自动化误判。
 *
 * 期望：JSON 面无 blocker ⇒ `blockers: []`；stdout 必须是合法 JSON。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function cleanPkg() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-594-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "mig-clean", version: "1.0.0", private: true }),
    "utf-8",
  );
  return dir;
}

describe("migrate status --json 的 blockers 无 blocker 时必须是 []", () => {
  it("JSON 面 blockers 为空数组（不是 ['—']）", () => {
    const dir = cleanPkg();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ blockers: string[] }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.blockers).toEqual([]);
    expect(parsed[0]!.blockers).not.toContain("—");
  });

  it("API 面同样为空数组", () => {
    const dir = cleanPkg();
    const rows = migrateStatus(dir);
    expect(rows[0]!.blockers).toEqual([]);
  });

  it("反向闸：真有 blocker 时数组里是那条 blocker（判定不是恒空）", () => {
    const dir = cleanPkg();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "mig-dirty",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    const parsed = JSON.parse(r.stdout) as Array<{ blockers: string[] }>;
    expect(parsed[0]!.blockers).toContain("typescript still in dependencies");
    expect(parsed[0]!.blockers).not.toContain("—");
  });
});
});

// ---------------------------------------------------------------------------
// pnpm 嵌套 / 多段 workspace pattern 看得见
// ---------------------------------------------------------------------------
describe("pnpm 嵌套 / 多段 workspace pattern 看得见", () => {
/**
 * `migrate status` / `retire --all` **看不见 pnpm 嵌套 workspace 包**
 * （`packages/**` 只展开一层、多段 pattern 整条静默丢弃）⇒ 仍带 `typescript` + `tsc`
 * 的成员包**完全不存在**于审计与退役范围里 ⇒ `retire --all` 报「nothing to retire」
 * 并 exit 0（**退役假绿**）。
 *
 * 根因：`packageRoots` 用「一层 `readdirSync`」近似 glob。
 * 本钉锁住：`packages/**` 覆盖**任意深度**的嵌套成员、多段 pattern 逐段展开；
 * 嵌套成员在 status 里**可见**、在 `retire --all` 的作用域里、且**真的**被退役（落盘可见）。
 * oracle = pnpm 自身的 workspace 解析（`pnpm ls -r --depth -1` 两个成员都在）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});


function memberPkg(name: string): string {
  return `${JSON.stringify(
    {
      name,
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    },
    null,
    2,
  )}\n`;
}

/** pnpm workspace：`packages/**` —— 一层成员 + 嵌套成员 */
function nestedFixture(): { dir: string; plain: string; nested: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-597-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - 'packages/**'", ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "root-597", version: "1.0.0", private: true }),
    "utf-8",
  );
  const plain = join(dir, "packages", "plain");
  const nested = join(dir, "packages", "group", "sub");
  mkdirSync(plain, { recursive: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(plain, "package.json"), memberPkg("plain-597"), "utf-8");
  writeFileSync(join(nested, "package.json"), memberPkg("sub-597"), "utf-8");
  return { dir, plain, nested };
}

/** 多段 pattern（`packages` 目录下两层 `*`）—— 改前整条被静默丢弃 */
function multiSegmentFixture(): { dir: string; nested: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-597-seg-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", "  - 'packages/*/*'", ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "root-597-seg", version: "1.0.0", private: true }),
    "utf-8",
  );
  const nested = join(dir, "packages", "group", "sub");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "package.json"), memberPkg("sub2-597"), "utf-8");
  return { dir, nested };
}

describe("pnpm 嵌套 / 多段 workspace pattern 看得见", () => {
  it("status 列出嵌套成员（一层与深层都在）", () => {
    const { dir, plain, nested } = nestedFixture();
    const roots = migrateStatus(dir).map((r) => resolve(r.root));
    expect(roots).toContain(resolve(plain));
    expect(roots).toContain(resolve(nested));
    const row = migrateStatus(dir).find((r) => resolve(r.root) === resolve(nested));
    expect(row!.typescriptDep).toBe(true);
    expect(row!.tscScripts).toContain("typecheck");
  });

  it("retire --all 把嵌套成员纳入作用域并真的退役（落盘可见）", () => {
    const { dir, plain, nested } = nestedFixture();
    const results = migrateRetireAll(dir, { workflows: false });
    const roots = results.map((r) => resolve(r.root));
    expect(roots).toContain(resolve(nested));
    expect(roots).toContain(resolve(plain));
    expect(roots).toHaveLength(2);
    const pkg = JSON.parse(readFileSync(join(nested, "package.json"), "utf-8"));
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(pkg.scripts.typecheck).toContain("nudo check");
    expect(existsSync(join(nested, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  it("多段 pattern（两层 `*`）不再被整条丢弃", () => {
    const { dir, nested } = multiSegmentFixture();
    const roots = migrateStatus(dir).map((r) => resolve(r.root));
    expect(roots).toContain(resolve(nested));
    const results = migrateRetireAll(dir, { workflows: false });
    expect(results.map((r) => resolve(r.root))).toEqual([resolve(nested)]);
  });

  it("CLI：migrate status 的 stdout 列出嵌套成员（改前：整行缺席）", () => {
    const { dir, nested } = nestedFixture();
    const r = runCliTsx(["migrate", "status", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(relative(process.cwd(), nested));
  });

  it("CLI：retire --all --dry-run 不再报 nothing to retire（改前：假绿 exit 0）", () => {
    const { dir, nested } = nestedFixture();
    const r = runCliTsx(["migrate", "retire", "--all", "--dry-run", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("nothing to retire");
    expect(r.stdout).toContain("packages/group/sub");
  });
});
});

// ---------------------------------------------------------------------------
// scripts 的值为 null 时 migrate status 不崩
// ---------------------------------------------------------------------------
describe("scripts 的值为 null 时 migrate status 不崩", () => {
/**
 * `package.json` 的 `scripts` 值是 `null` 时 `migrate status` / `retire` 抛
 * 裸 TypeError（`Cannot read properties of null (reading 'split')`）——
 * 没有包名、没有文件路径、没有 `error:` / `fix:` 引导。
 * 根因：`as Record<string, string>` 只是编译期断言；`?? {}` 只兜「scripts 整个缺失」。
 *
 * 期望：非字符串的 script 值当作「无命令」（与 npm 语义一致）——不崩、不算 tsc。
 */






const { migrateStatus } = migrate;


const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function nullScriptPkg() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-598-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "badscripts", version: "1.0.0", scripts: { typecheck: null } }),
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(a) { return a + 1; }\n", "utf-8");
  return dir;
}

describe("scripts 的值为 null 时 migrate status 不崩", () => {
  it("API 面不抛，null 脚本不算 tsc", () => {
    const dir = nullScriptPkg();
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tscScripts).toEqual([]);
    expect(rows[0]!.nudoScripts).toEqual([]);
  });

  it("CLI 面 exit 0 且不出现裸 TypeError", () => {
    const dir = nullScriptPkg();
    const r = runCliTsx(["migrate", "status", dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("migrate status");
    expect(`${r.stdout}${r.stderr}`).not.toContain("Cannot read properties of null");
  });

  it("CLI --json 面也正常（exit 0 + 合法 JSON）", () => {
    const dir = nullScriptPkg();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ tscScripts: string[] }>;
    expect(parsed[0]!.tscScripts).toEqual([]);
  });

  it("反向闸：字符串脚本照常被识别（判定不是恒空）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m2-598-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "ok", version: "1.0.0", scripts: { typecheck: "tsc --noEmit" } }),
      "utf-8",
    );
    expect(migrateStatus(dir)[0]!.tscScripts).toEqual(["typecheck"]);
  });

  it("scriptCommandEntries 只收字符串值", () => {
    expect(
      migrate.scriptCommandEntries({ scripts: { a: "x", b: null, c: 3, d: "y" } }),
    ).toEqual([
      ["a", "x"],
      ["d", "y"],
    ]);
    expect(migrate.scriptCommandEntries({ scripts: null })).toEqual([]);
    expect(migrate.scriptCommandEntries(undefined)).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// retire 子包的 workflow 改写作用域必须限定在该包
// ---------------------------------------------------------------------------
describe("retire 子包的 workflow 改写作用域必须限定在该包", () => {
/**
 * `nudo migrate retire <子包>` 的 **workflow 改写作用域是「仓库根的整个
 * `.github/workflows` 目录」**，与被退役包的边界无关 ⇒ 未退役的根包 / 其它包的
 * CI 类型门禁被静默替换成 `npx nudojs check .`。
 *
 * 期望：退役子包时只改写**该包自有**的 `.github/workflows`；仓库根共享的 workflow
 * 属于整仓作用域，退役子包不得越界改写。
 * 反向闸：被退役包**自有**的 workflow 照常改写（断言非永真）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CI = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npx tsc --noEmit",
  "",
].join("\n");

/** monorepo：根包 + 子包 `packages/a`；根有共享 workflow，子包可选自带 workflow */
function monoRepo(subOwnWorkflow: boolean): { root: string; sub: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-m5-920-"));
  dirs.push(root);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), CI, "utf-8");
  mkdirSync(join(root, "packages", "a"), { recursive: true });
  if (subOwnWorkflow) {
    mkdirSync(join(root, "packages", "a", ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, "packages", "a", ".github", "workflows", "ci.yml"), CI, "utf-8");
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "root",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5" },
    }),
    "utf-8",
  );
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
  writeFileSync(
    join(root, "packages", "a", "package.json"),
    JSON.stringify({
      name: "a",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5" },
    }),
    "utf-8",
  );
  return { root, sub: join(root, "packages", "a") };
}

describe("retire 子包的 workflow 改写作用域必须限定在该包", () => {
  it("库面：仓库根的共享 workflow 零改动，根包 package.json 零改动", () => {
    const { root, sub } = monoRepo(false);
    const rootWfBefore = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8");
    const rootPkgBefore = readFileSync(join(root, "package.json"), "utf-8");

    const result = migrateRetire(sub);

    expect(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8")).toBe(rootWfBefore);
    expect(readFileSync(join(root, "package.json"), "utf-8")).toBe(rootPkgBefore);
    // 被退役包没有自己的 workflow ⇒ 本次没有任何 workflow 改写
    expect(result.rewrittenWorkflows).toEqual([]);
  });

  it("CLI 面：仓库根的共享 workflow 零改动，且不被报告", () => {
    const { root, sub } = monoRepo(false);
    const rootWfBefore = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8");
    const r = runCliTsx(["migrate", "retire", sub]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8")).toBe(rootWfBefore);
    expect(r.stdout).not.toContain("workflow ");
  });

  it("反向闸：被退役包**自有**的 workflow 照常改写", () => {
    const { root, sub } = monoRepo(true);
    migrateRetire(sub);
    const subWf = readFileSync(join(sub, ".github", "workflows", "ci.yml"), "utf-8");
    expect(subWf).toContain("npx nudojs check .");
    // 根的共享 workflow 仍然零改动
    expect(readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8")).toBe(CI);
  });
});
});

// ---------------------------------------------------------------------------
// strip 后的门禁按模块计数（不翻倍）
// ---------------------------------------------------------------------------
describe("strip 后的门禁按模块计数（不翻倍）", () => {
/**
 * `migrate strip --write` 保留源 `.ts`，门禁把「源 + 产物」当两个模块分析两遍。
 *
 * 根因：`strip` 默认（不加 `--backup`）把源 `.ts` 留在原地，产物 `.js` 落在旁边 ⇒
 * 目录级分析把同一个模块收了两份 ⇒ 机器面 `summary.errors` / `functions` /
 * `files` 恰好翻倍，`--fix` 的逐 issue 编辑也翻倍（改一份、另一份不变）。
 *
 * 期望：门禁按**模块**计数（同一模块只分析一遍）；`--backup` 与默认两条路径
 * 的计数必须相同。
 */








const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = `export function setDelay(ms: number): number {\n  return ms.toFixed(2);\n}\n`;

describe("strip 后的门禁按模块计数（不翻倍）", () => {
  it("strip --write 后：目录级分析只收一份（源 .ts 与产物 .js 是同一模块）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-923-"));
    dirs.push(dir);
    const src = join(dir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(dir, "package.json"), `{ "name": "dup-pkg", "version": "0.0.0" }\n`, "utf-8");
    writeFileSync(join(src, "index.ts"), SRC, "utf-8");

    await migrateStrip([src], { write: true, draft: false });

    // 源与产物都在（strip 默认保留源）⇒ 门禁不得把两者算成两个模块
    //
    // **（主 agent 追认，2026-10-23）**：同 stem 冲突时**代表文件由
    // 「取源 `.ts`」改为「取产物 `.js`」—— 因为 `migrate strip --write` 之后
    // 源 `.ts` 是**退役后不再被编译的死源**，门禁必须查**发布出去的产物**
    // （否则发布的产物零覆盖 ⇒ 假绿，且与 `migrate verify` 给出相反结论）。
    // ⇒ 本用例的**计数不变式**（同一模块只分析一遍 ⇒ `toHaveLength(1)`）**不变**，
    // 只更新「被选中的那一份是哪个」。
    const collected = collectNudoFiles(dir);
    expect(collected.filter((f) => f.endsWith("index.ts"))).toHaveLength(0);
    expect(collected.filter((f) => f.endsWith("index.js"))).toHaveLength(1);
    expect(collected).toHaveLength(1);
  });

  it("check --json 的计数：默认路径与 --backup 路径相同（都等于模块数）", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-923a-"));
    const dirB = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-923b-"));
    dirs.push(dirA, dirB);
    for (const d of [dirA, dirB]) {
      mkdirSync(join(d, "src"), { recursive: true });
      writeFileSync(join(d, "package.json"), `{ "name": "dup-pkg", "version": "0.0.0" }\n`, "utf-8");
      writeFileSync(join(d, "src", "index.ts"), SRC, "utf-8");
    }
    await migrateStrip([join(dirA, "src")], { write: true, draft: false });
    await migrateStrip([join(dirB, "src")], { write: true, draft: false, backup: true });

    const count = (dir: string): { files: number; functions: number } => {
      const r = runCliTsx(["check", dir, "--json"], { cwd: dir });
      expect(r.status).toBeGreaterThanOrEqual(0);
      const data = JSON.parse(r.stdout) as {
        kind?: string;
        summary: { files?: number; functions: number };
        reports?: unknown[];
      };
      const files = data.kind === "multi" ? (data.summary.files ?? 0) : 1;
      return { files, functions: data.summary.functions };
    };

    const a = count(dirA);
    const b = count(dirB);
    // 改前：a.files = 2（index.ts + index.js 各一份），b.files = 1 ⇒ 两条路径不一致
    expect(a.files).toBe(1);
    expect(b.files).toBe(1);
    expect(a.functions).toBe(b.functions);
  }, 120_000);
});
});

// ---------------------------------------------------------------------------
// CI 表达式 ${{ … }} 被截断成字面量路径
// ---------------------------------------------------------------------------
describe("CI 表达式 ${{ … }} 被截断成字面量路径", () => {
/**
 * `nudo migrate retire` 改写 CI 步骤时**按空白切词解析 tsc argv**
 * ⇒ GitHub Actions 的 `${{ … }}` 表达式被截断并单引号封死
 * ⇒ 写下**一条必然红**的 CI 命令（`npx nudojs check 'packages/${{'`）。
 *
 * 契约：`${{ … }}`（以及 shell 变量 / glob）是**不可分割的 token**；
 * 改写后要么仍指向存在的路径，要么被明确拒绝——不得产出「指向不存在目录的字面量」。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const WF = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    strategy:",
  "      matrix:",
  "        pkg: [a, b]",
  "        tsconfig: [tsconfig.a.json, tsconfig.b.json]",
  "    steps:",
  "      - run: npx tsc -p packages/${{ matrix.pkg }}/tsconfig.json",
  "      - run: npx tsc --project ${{ matrix.tsconfig }}",
  "      - run: npx tsc -p packages/a/tsconfig.json",
  "      - run: npx tsc --noEmit",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-924-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b924",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, "ci.yml"), WF);
  return dir;
}

describe("CI 表达式 ${{ … }} 被截断成字面量路径", () => {
  it("rewriteTscCommand 不把 ${{ … }} 切开", () => {
    const out = rewriteTscCommand("npx tsc -p packages/${{ matrix.pkg }}/tsconfig.json").cmd;
    // 表达式整体保留（不得被截成 `packages/${{`）
    expect(out).not.toContain("packages/${{'");
    expect(out).not.toContain("'${{'");
    expect(out).toContain("${{ matrix.pkg }}");
  });

  it("shell 变量 / glob 不被单引号封死（展开仍由 shell / CI 负责）", () => {
    const v = rewriteTscCommand("tsc -p $TSCONFIG").cmd;
    expect(v).not.toContain("'$TSCONFIG'");
    const g = rewriteTscCommand("tsc -p packages/*/tsconfig.json").cmd;
    expect(g).not.toContain("'packages/*'");
    expect(g).toContain("packages/*");
  });

  it("retire 后 CI 步骤里不再有被截断的表达式路径", () => {
    const dir = fixture();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).not.toContain("packages/${{'");
    expect(wf).not.toContain("'${{'");
    // 表达式整体保留 ⇒ CI 展开后仍指向 packages/<pkg>
    expect(wf).toContain("packages/${{ matrix.pkg }}");
    // 落盘的每条命令都以 npx nudojs check 开头（不是坏路径）
    for (const line of wf.split("\n")) {
      if (line.includes("run:") && line.includes("check")) {
        expect(line).toMatch(/run: npx nudojs check /);
      }
    }
  });
});
});

// ---------------------------------------------------------------------------
// 命令替换 $( … ) 被截断后粘到门禁路径上
// ---------------------------------------------------------------------------
describe("命令替换 $( … ) 被截断后粘到门禁路径上", () => {
/**
 * `nudo migrate retire` 改写 tsc 命令时把 shell 的 `$( … )` 命令替换
 * 留在改写结果里、并直接粘到门禁路径上
 * ⇒ 落盘命令要么是 bash 语法错误、要么指向不存在的路径。
 *
 * 契约：命令替换 / 算术替换 / 进程替换是**一个整体**——改写器必须整体消费，
 * 不得在左括号处截断（`nudo check .(pwd)/dist` / `nudo check '$'(cat …)`）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-966-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "b966", version: "1.0.0", scripts }, null, 2)}\n`,
  );
  return dir;
}

describe("命令替换 $( … ) 被截断后粘到门禁路径上", () => {
  it("旗标值里的命令替换被整体消费（不留尾巴）", () => {
    const out = rewriteTscCommand("tsc --outDir $(pwd)/dist").cmd;
    expect(out).toBe("nudo check .");
    expect(out).not.toContain("$(pwd)");
    expect(out).not.toContain(".(pwd)");
  });

  it("-p 的值是命令替换时不得产出 '$'( … ) 这种坏语法", () => {
    const out = rewriteTscCommand("tsc -p $(cat tsconfig.path)").cmd;
    expect(out).not.toContain("'$'");
    expect(out).not.toContain("$(cat");
    expect(out).toBe("nudo check .");
  });

  it("算术替换 / 进程替换同样整体消费", () => {
    expect(rewriteTscCommand("tsc --outDir $((1+1))/dist").cmd).toBe("nudo check .");
    expect(rewriteTscCommand("tsc --outDir <(cat x)/dist").cmd).toBe("nudo check .");
  });

  it("命令替换内部的 tsc 调用同样被退役（独立命令上下文）", () => {
    expect(rewriteTscCommand("echo $(tsc --noEmit)").cmd).toBe("echo $(nudo check .)");
  });

  it("tsc 之后的独立命令（&& 之后）原样保留", () => {
    const out = rewriteTscCommand("tsc --noEmit && echo $(git rev-parse --short HEAD)").cmd;
    expect(out).toBe("nudo check . && echo $(git rev-parse --short HEAD)");
  });

  it("retire 落盘的脚本是合法命令（无悬空 $() / 反引号）", () => {
    const dir = fixture({
      typecheck: "tsc --noEmit $(cat flags.txt)",
    });
    migrateRetire(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    for (const value of Object.values(pkg.scripts) as string[]) {
      expect(value).not.toContain("'$'");
      expect(value).not.toContain(".(pwd)");
      // 括号必须配平（`$(` 会被整体消费，不会留半个开括号）
      const opens = (value.match(/\(/g) ?? []).length;
      const closes = (value.match(/\)/g) ?? []).length;
      expect(opens).toBe(closes);
    }
    expect(pkg.scripts.typecheck).toBe("nudo check .");
  });
});
});

// ---------------------------------------------------------------------------
// 脚本面缺「命令位」预筛 ⇒ 非命令位的 tsc 被改写
// ---------------------------------------------------------------------------
describe("脚本面缺「命令位」预筛 ⇒ 非命令位的 tsc 被改写", () => {
/**
 * `nudo migrate retire` 的 package.json 脚本面**没有「命令位」预筛**
 * ⇒ 非命令位置的 tsc（描述文字 / 旗标值）被当 tsc 调用改写
 * ⇒ 脚本语义被改坏（`eslint --rule tsc` → `eslint --rule nudo check .`）。
 *
 * 契约：脚本面与 workflow 面**同一套**命令位判定——
 * 只有「命令词本身」或「透明包装器（sudo/env/…）的首个参数」算 tsc 调用。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const NON_COMMAND = [
  "eslint --rule tsc",
  "echo building with tsc",
  "echo see tsc docs",
  "eslint --rule=tsc",
  'echo "building with tsc"',
  "echo 'building with tsc'",
];

function fixture(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-967-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "b967", version: "1.0.0", scripts }, null, 2)}\n`,
  );
  return dir;
}

describe("脚本面缺「命令位」预筛 ⇒ 非命令位的 tsc 被改写", () => {
  it("非命令位置的 tsc 一律不改写", () => {
    for (const cmd of NON_COMMAND) {
      expect(rewriteTscCommand(cmd).changed).toBe(false);
      expect(rewriteTscCommand(cmd).cmd).toBe(cmd);
    }
  });

  it("命令位置的 tsc 仍然改写（含透明包装器后的首个参数）", () => {
    expect(rewriteTscCommand("tsc --noEmit").cmd).toBe("nudo check .");
    expect(rewriteTscCommand("npx tsc --noEmit").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("sudo tsc --noEmit").cmd).toBe("sudo nudo check .");
    expect(rewriteTscCommand("pnpm run lint && tsc --noEmit").cmd).toBe(
      "pnpm run lint && nudo check .",
    );
  });

  it("status 不把非命令位的 tsc 计入 tsc scripts", () => {
    const dir = fixture({
      lint: "eslint --rule tsc",
      note: "echo building with tsc",
      typecheck: "tsc --noEmit",
    });
    const rows = migrateStatus(dir);
    expect(rows[0]!.tscScripts).toEqual(["typecheck"]);
  });

  it("retire 后非命令位的 tsc 逐字未变", () => {
    const dir = fixture({
      lint: "eslint --rule tsc",
      note: "echo building with tsc",
      docs: "echo see tsc docs",
      flagval: "eslint --rule=tsc",
      quoted: 'echo "building with tsc"',
      typecheck: "tsc --noEmit",
    });
    migrateRetire(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.scripts.lint).toBe("eslint --rule tsc");
    expect(pkg.scripts.note).toBe("echo building with tsc");
    expect(pkg.scripts.docs).toBe("echo see tsc docs");
    expect(pkg.scripts.flagval).toBe("eslint --rule=tsc");
    expect(pkg.scripts.quoted).toBe('echo "building with tsc"');
    // 真门禁仍然退役
    expect(pkg.scripts.typecheck).toBe("nudo check .");
  });
});
});
