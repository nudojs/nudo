/**
 * migrate retire 面（原子/批量/恢复/marker/sidecar/draft）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";
import { migrateRetireAll, migrateStatus, migrateRetire, stripTsToJs, formatStatusTable, migrateStrip, migrateRetireMany } from "../migrate.ts";

// ---------------------------------------------------------------------------
// 多目标批次里不得用「无可退役」掩盖「有活没干」
// ---------------------------------------------------------------------------
describe("多目标批次里不得用「无可退役」掩盖「有活没干」", () => {
/**
 * `nudo migrate retire <a> <b>` **静默跳过**可退役的包并 exit 0。
 *
 * 根因（命令层）：`commands/migrate.ts` 把批次错误按「**所有**失败项都以
 * `nothing to retire` 开头」整体判为良性 ⇒ exit 0 + 成功信封 ⇒ 同一批里
 * **有活可干**的目标（库面因原子性未提交）被良性失败掩盖。
 *
 * 期望：
 * - 有活的目标**照常退役**（落盘）；
 * - 无可退役的目标**明确报出**（不得静默）；
 * - 「nothing to retire」仍是正常结果（exit 0，口径不变）。
 *
 * 库面的**原子性**不变（`migrateRetireMany` 仍整批报错，/ 族 56 的
 * 契约）：本文件只钉命令层的「不得谎报」。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-051-"));
  dirs.push(dir);
  return dir;
}

/** 有 tsc 脚本 + typescript 依赖（可退役） */
function retirable(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.0.0",
        private: true,
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.4.0" },
      },
      null,
      2,
    ),
    "utf-8",
  );
  return dir;
}

/** 无 tsc/typescript（无可退役） */
function nothingToRetire(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", private: true, scripts: { build: "node build.js" } }),
    "utf-8",
  );
  return dir;
}

describe("多目标批次里不得用「无可退役」掩盖「有活没干」", () => {
  it("可退役 + 无可退役 ⇒ 可退役的那个**真的退役**（不是 exit 0 什么都没做）", () => {
    const root = scratch();
    const a = retirable(root, "p11a");
    const b = nothingToRetire(root, "p11b");
    const r = runCliTsx(["migrate", "retire", a, b]);
    expect(r.status, r.stderr).toBe(0);

    // ① 有活的目标必须落盘
    const pkg = JSON.parse(readFileSync(join(a, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    expect(existsSync(join(a, ".nudo", "migrate-retired.json"))).toBe(true);

    // ② 被跳过的目标必须**可见**（不得静默）
    expect(r.stdout).toContain(b);
    expect(r.stdout).toContain("nothing to retire");
  });

  it("--json 面：已退役目标进结果，被跳过目标挂 skipped（机器面不丢信息）", () => {
    const root = scratch();
    const a = retirable(root, "p11a");
    const b = nothingToRetire(root, "p11b");
    const r = runCliTsx(["migrate", "retire", a, b, "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{
      root: string;
      removedDeps: string[];
      skipped?: Array<{ target: string; message: string }>;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.removedDeps).toContain("devDependencies");
    expect(parsed[0]!.skipped?.map((s) => s.target)).toEqual([b]);
  });

  it("反向闸：全部目标都无可退役 ⇒ exit 0 + 「nothing to retire」（Bug 567 口径不变）", () => {
    const root = scratch();
    const a = nothingToRetire(root, "plain-a");
    const b = nothingToRetire(root, "plain-b");
    const r = runCliTsx(["migrate", "retire", a, b]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("nothing to retire");
    expect(existsSync(join(a, ".nudo"))).toBe(false);
    expect(existsSync(join(b, ".nudo"))).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// retire --all 必须与单目标同口径（含 workflow-only 的根包）
// ---------------------------------------------------------------------------
describe("retire --all 必须与单目标同口径（含 workflow-only 的根包）", () => {
/**
 * `nudo migrate retire --all` 跳过 workspace **根**的 workflow tsc 行
 * ⇒ 退役不完整且 exit 0（子包退役了，根的 CI 仍跑 `tsc`）。
 *
 * 根因：`migrateRetireAll` 的工作集判据只看「可摘的依赖 + 门禁脚本」，
 * **不看**「仅 workflow 里有 tsc 行」⇒ 根包被 `continue` 跳过；而单目标路径
 * （`planRetirePackage`）**计入** workflow 行 ⇒ 同一份夹具两个入口不同结果。
 *
 * 修复：两条入口共用 `retireScope` 的「有活可干」判据。
 *
 * 反向闸：没有 tsc 面的包仍不写标记（断言非永真）。
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

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-052-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
    "utf-8",
  );
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), CI, "utf-8");
  mkdirSync(join(root, "packages", "a"), { recursive: true });
  writeFileSync(
    join(root, "packages", "a", "package.json"),
    JSON.stringify({
      name: "a",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  return root;
}

describe("retire --all 必须与单目标同口径（含 workflow-only 的根包）", () => {
  it("根包只有 workflow 里的 tsc 行 ⇒ --all 仍要改写它", () => {
    const root = workspace();
    const results = migrateRetireAll(root);
    // `result.root` 是相对 process.cwd() 的路径（与 JSON 面同形）
    const roots = results.map((r) => r.root);
    expect(roots).toContain(relative(process.cwd(), root) || ".");
    expect(roots).toContain(relative(process.cwd(), join(root, "packages", "a")));
    // 落盘核对：CI 里不再有 tsc
    const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf-8");
    expect(ci).not.toContain("tsc --noEmit");
    expect(ci).toContain("nudojs check");
  });

  it("退役后 status 不再报 workflow blocker（CI 与仓库一致）", () => {
    const root = workspace();
    migrateRetireAll(root);
    const rows = migrateStatus(root);
    for (const row of rows) {
      expect(row.blockers.filter((b) => b.includes("tsc line(s)"))).toEqual([]);
    }
  });

  it("反向闸：没有 tsc 面的包不被写标记（--all 不得凭空退役）", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-mig-052-plain-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      "utf-8",
    );
    mkdirSync(join(root, "packages", "p"), { recursive: true });
    writeFileSync(
      join(root, "packages", "p", "package.json"),
      JSON.stringify({ name: "p", private: true, scripts: { test: "node -e 0" } }),
      "utf-8",
    );
    expect(migrateRetireAll(root)).toEqual([]);
    expect(existsSync(join(root, "packages", "p", ".nudo"))).toBe(false);
    expect(existsSync(join(root, ".nudo"))).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// dry-run 与真跑的机器面必须可区分
// ---------------------------------------------------------------------------
describe("dry-run 与真跑的机器面必须可区分", () => {
/**
 * `nudo migrate retire --dry-run --json` 与**真跑**的 JSON 输出
 * **逐字相同** ⇒ 机器消费者无法区分「这是计划」与「已经执行了」。
 *
 * 修复：`RetireResult` 带 `dryRun: true`（只在 dry-run 时出现 ⇒ 真跑的输出
 * 形状与旧版一致）；人类面本来就是区分的（`dry-run` vs `retired`）。
 *
 * 反向闸：真跑的 JSON **不得**出现 `dryRun`（否则「计划/事实」又被抹平）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-053-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "p11a",
      version: "1.0.0",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  return dir;
}

describe("dry-run 与真跑的机器面必须可区分", () => {
  it("库面：dry-run 的 result 带 dryRun: true，且零写盘", () => {
    const dir = pkg();
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    const result = migrateRetire(dir, { dryRun: true, workflows: false });
    expect(result.dryRun).toBe(true);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
  });

  it("库面：真跑的 result **不带** dryRun（形状与旧版一致）", () => {
    const dir = pkg();
    const result = migrateRetire(dir, { workflows: false });
    expect(result.dryRun).toBeUndefined();
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  it("CLI 面：dry-run 与真跑的 --json 输出**不再逐字相同**", () => {
    const dir = pkg();
    const dry = runCliTsx(["migrate", "retire", "--dry-run", "--json", dir]);
    expect(dry.status, dry.stderr).toBe(0);
    const apply = runCliTsx(["migrate", "retire", "--json", dir]);
    expect(apply.status, apply.stderr).toBe(0);
    expect(dry.stdout).not.toBe(apply.stdout);
    const dryRows = JSON.parse(dry.stdout) as Array<{ dryRun?: boolean }>;
    const applyRows = JSON.parse(apply.stdout) as Array<{ dryRun?: boolean }>;
    expect(dryRows[0]!.dryRun).toBe(true);
    expect(applyRows[0]!.dryRun).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// 退役完成的包必须真的装了门禁
// ---------------------------------------------------------------------------
describe("退役完成的包必须真的装了门禁", () => {
/**
 * `nudo migrate retire` 在已有**非门禁** `check:nudo` 脚本时**不装门禁**，
 * 却报「retired」并写审计标记 ⇒ 摘掉 typescript 后**零类型检查**；紧接着
 * `migrate status` 又报「no nudo check/test script yet」⇒ 两个子命令结论相反。
 *
 * 根因：注入判据是 `!scripts["check:nudo"]`（**脚本名存不存在**），而
 * `migrate status` 的门禁判据是 `NUDO_GATE_RE`（**命令文本是不是 nudo 门禁**）
 * ⇒ 两个判据不对齐。
 *
 * 修复：注入判据改为「命令文本里有没有门禁」——`check:nudo` 存在但不是门禁
 * 时**覆写**它。
 *
 * 反向闸：真的已有门禁（`typecheck: "tsc --noEmit"` 被改写成 `nudo check .`）
 * 时不重复注入（反向闸口径不变）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(scripts: Record<string, string>, deps: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-062-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "gate3", version: "1.0.0", type: "module", scripts, devDependencies: deps }),
    "utf-8",
  );
  return dir;
}

function scriptsOf(dir: string): Record<string, string> {
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  }).scripts;
}

describe("退役完成的包必须真的装了门禁", () => {
  it("`check:nudo: echo placeholder` ⇒ 被覆写成 nudo 门禁", () => {
    const dir = pkg({ "check:nudo": "echo placeholder" }, { typescript: "^5.4.0" });
    const result = migrateRetire(dir, { workflows: false });
    expect(scriptsOf(dir)["check:nudo"]).toContain("nudo check");
    expect(result.rewrittenScripts.map((s) => s.name)).toContain("check:nudo");
    // 被覆写的旧值必须如实报出（不得谎称 "(none)"）
    const change = result.rewrittenScripts.find((s) => s.name === "check:nudo")!;
    expect(change.from).toBe("echo placeholder");
  });

  it("退役后 status 不再报「还没有门禁」（两面口径一致）", () => {
    const dir = pkg({ "check:nudo": "echo placeholder" }, { typescript: "^5.4.0" });
    writeFileSync(join(dir, "src.ts"), "export const a: number = 1;\n", "utf-8");
    migrateRetire(dir, { workflows: false });
    const rows = migrateStatus(dir);
    expect(rows[0]!.retired).toBe(true);
    expect(rows[0]!.blockers).not.toContain("no nudo check/test script yet");
  });

  it("反向闸：已有真门禁时不重复注入 check:nudo", () => {
    const dir = pkg({ typecheck: "tsc --noEmit" }, { typescript: "^5.4.0" });
    const result = migrateRetire(dir, { workflows: false });
    const scripts = scriptsOf(dir);
    expect(scripts["typecheck"]).toBe("nudo check .");
    expect(scripts["check:nudo"]).toBeUndefined();
    expect(result.rewrittenScripts.map((s) => s.name)).toEqual(["typecheck"]);
  });
});
});

// ---------------------------------------------------------------------------
// 损坏的审计标记必须 fail-closed（不得静默覆盖）
// ---------------------------------------------------------------------------
describe("损坏的审计标记必须 fail-closed（不得静默覆盖）", () => {
/**
 * `nudo migrate retire` 遇到**损坏的** `.nudo/migrate-retired.json`
 * ⇒ 静默丢弃并覆盖审计记录（exit 0）。
 *
 * 根因：`readJson` 把「文件不存在」与「JSON 解析失败」压成同一个 `undefined`
 * ⇒ `readMarkerRecords(undefined)` 返回空记录 ⇒ 旧审计（`retiredAt` /
 * `removedDeps` / `rewrittenScripts`）被覆盖成空。
 *
 * 期望（与 `package.json` 同款策略）：`invalid` / `unreadable` ⇒ **fail-closed
 * 报错**、不覆盖原文件。
 *
 * 反向闸：标记**不存在**时照常退役（「没有既有记录」不是错误）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-065-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "b065",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  return dir;
}

const BROKEN = '{ "retiredAt": "2020-01-01T00:00:00.000Z", "removedDeps": ["dependencies"], ';

describe("损坏的审计标记必须 fail-closed（不得静默覆盖）", () => {
  it("库面：半截 JSON ⇒ 抛错，且原标记**逐字未变**", () => {
    const dir = pkg();
    mkdirSync(join(dir, ".nudo"), { recursive: true });
    writeFileSync(join(dir, ".nudo", "migrate-retired.json"), BROKEN, "utf-8");
    expect(() => migrateRetire(dir, { workflows: false })).toThrow(/migrate-retired\.json/);
    expect(readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8")).toBe(BROKEN);
    // 一程闸门：package.json 也不得被改
    expect(
      (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
        devDependencies: Record<string, string>;
      }).devDependencies["typescript"],
    ).toBe("^5.4.0");
  });

  it("CLI 面：exit 1 + 明确点名标记文件（不得静默 exit 0）", () => {
    const dir = pkg();
    mkdirSync(join(dir, ".nudo"), { recursive: true });
    writeFileSync(join(dir, ".nudo", "migrate-retired.json"), BROKEN, "utf-8");
    const r = runCliTsx(["migrate", "retire", dir]);
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("migrate-retired.json");
    expect(readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8")).toBe(BROKEN);
  });

  it("反向闸：标记不存在 ⇒ 照常退役并写下新标记", () => {
    const dir = pkg();
    const result = migrateRetire(dir, { workflows: false });
    expect(result.removedDeps).toContain("devDependencies");
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// retire --all 必须包间原子
// ---------------------------------------------------------------------------
describe("retire --all 必须包间原子", () => {
/**
 * `nudo migrate retire --all` **包间非原子**：第 N 个包失败时前 N−1 个包
 * 已落盘退役，而错误消息既不点名已提交的包、也不留任何「本批被中断」的痕迹。
 *
 * 期望：**全批原子** —— 任一包失败 ⇒ 整批零写盘（前 N−1 个包也不落盘），
 * 错误消息点名本批涉及的包。
 * 反向闸：全批成功时每个包都退役（断言非永真）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try {
      chmodSync(join(d, "packages", "b"), 0o755);
    } catch {
      /* 目录可能没建 */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

function batchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-m5-1006-"));
  dirs.push(root);
  mkdirSync(join(root, "packages", "a"), { recursive: true });
  mkdirSync(join(root, "packages", "b"), { recursive: true });
  mkdirSync(join(root, "packages", "c"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "root", version: "1.0.0", private: true, devDependencies: {} }),
    "utf-8",
  );
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n', "utf-8");
  for (const p of ["a", "b", "c"]) {
    writeFileSync(
      join(root, "packages", p, "package.json"),
      JSON.stringify({
        name: `pkg-${p}`,
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { typecheck: "npx tsc --noEmit" },
      }),
      "utf-8",
    );
  }
  return root;
}

describe("retire --all 必须包间原子", () => {
  it("第 2 个包不可写 ⇒ 整批零写盘（前面的包也不落盘）", () => {
    const root = batchRepo();
    chmodSync(join(root, "packages", "b"), 0o555);
    try {
      expect(() => migrateRetireAll(root, { workflows: false })).toThrow();
    } finally {
      chmodSync(join(root, "packages", "b"), 0o755);
    }
    for (const p of ["a", "b", "c"]) {
      const pkg = JSON.parse(
        readFileSync(join(root, "packages", p, "package.json"), "utf-8"),
      ) as { devDependencies: Record<string, string>; scripts: Record<string, string> };
      // 前序包不得已被退役
      expect(pkg.devDependencies["typescript"]).toBe("^5.0.0");
      expect(pkg.scripts["typecheck"]).toBe("npx tsc --noEmit");
      expect(existsSync(join(root, "packages", p, ".nudo", "migrate-retired.json"))).toBe(false);
    }
  });

  it("CLI 面：失败时点名本批涉及的包", () => {
    const root = batchRepo();
    chmodSync(join(root, "packages", "b"), 0o555);
    const r = runCliTsx(["migrate", "retire", root, "--all"]);
    chmodSync(join(root, "packages", "b"), 0o755);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("packages/a");
    expect(r.stderr).toContain("packages/b");
    const pkgA = JSON.parse(
      readFileSync(join(root, "packages", "a", "package.json"), "utf-8"),
    ) as { devDependencies: Record<string, string> };
    expect(pkgA.devDependencies["typescript"]).toBe("^5.0.0");
  });

  it("反向闸：全批成功时每个包都退役", () => {
    const root = batchRepo();
    const results = migrateRetireAll(root, { workflows: false });
    expect(results).toHaveLength(3);
    for (const p of ["a", "b", "c"]) {
      const pkg = JSON.parse(
        readFileSync(join(root, "packages", p, "package.json"), "utf-8"),
      ) as { devDependencies: Record<string, string> };
      expect(pkg.devDependencies["typescript"]).toBeUndefined();
      expect(existsSync(join(root, "packages", p, ".nudo", "migrate-retired.json"))).toBe(true);
    }
  });
});
});

// ---------------------------------------------------------------------------
// rewrittenWorkflows 在 stdout 与落盘 marker 里必须同型同值
// ---------------------------------------------------------------------------
describe("rewrittenWorkflows 在 stdout 与落盘 marker 里必须同型同值", () => {
/**
 * `nudo migrate retire` 的**同一个键 `rewrittenWorkflows` 在两份产物里是两种类型**：
 * stdout 的 `--json` 报文是 `[{file,from,to}]`（对象数组），落盘的
 * `.nudo/migrate-retired.json` 是 `["<path>"]`（字符串数组）⇒ 同键异型（协议层非法值），
 * 且落盘的审计记录丢掉 CI 改写的前后内容。
 *
 * 期望：两份产物**逐元素深比较完全相等**，且都是带 `from`/`to` 的对象数组。
 * 反向闸：确实改写了 workflow（断言非永真）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function wfPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-1028-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(dir, ".github", "workflows", "ci.yml"),
    [
      "name: CI",
      "on: [push]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: npx tsc --noEmit",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "migfx",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { typecheck: "tsc --noEmit" },
    }),
    "utf-8",
  );
  return dir;
}

function marker(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("rewrittenWorkflows 在 stdout 与落盘 marker 里必须同型同值", () => {
  it("库面：结果与 marker 的 rewrittenWorkflows 逐元素相等（对象数组，带 from/to）", () => {
    const dir = wfPkg();
    const result = migrateRetire(dir);
    const m = marker(dir);
    expect(result.rewrittenWorkflows.length).toBeGreaterThan(0);
    expect(m.rewrittenWorkflows).toEqual(result.rewrittenWorkflows);
    for (const rec of m.rewrittenWorkflows as Array<Record<string, unknown>>) {
      expect(typeof rec["file"]).toBe("string");
      expect(typeof rec["from"]).toBe("string");
      expect(typeof rec["to"]).toBe("string");
    }
  });

  it("CLI 面：--json 报文与落盘 marker 的同名键深比较相等", () => {
    const dir = wfPkg();
    const r = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(r.status).toBe(0);
    // 收口：`migrate retire --json` 的顶层形状**恒为数组**（1 个包
    // 也是数组）⇒ 取第一条结果与 marker 比较。
    const reported = JSON.parse(r.stdout) as Array<{ rewrittenWorkflows: unknown }>;
    expect(Array.isArray(reported)).toBe(true);
    expect(reported).toHaveLength(1);
    const m = marker(dir);
    expect(m.rewrittenWorkflows).toEqual(reported[0]!.rewrittenWorkflows);
  });

  it("反向闸：确实改写了 workflow 行（断言非永真）", () => {
    const dir = wfPkg();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).toContain("npx nudojs check .");
    const m = marker(dir);
    expect((m.rewrittenWorkflows as unknown[]).length).toBe(1);
  });
});
});

// ---------------------------------------------------------------------------
// 半完成标记必须能被重跑 retire 清掉
// ---------------------------------------------------------------------------
describe("半完成标记必须能被重跑 retire 清掉", () => {
/**
 * 残留的 `migrate-retiring.json`（半完成标记）且已无 tsc/typescript
 * 可退役时 ⇒ 「nothing to retire」直接 exit 0，**半完成标记永不清理**
 * ⇒ `status` 永远报「partial migrate retire — re-run nudo migrate retire」
 * （指引指向的命令是 no-op）。
 *
 * 修复：`planRetirePackage` 的「无活可干」分支区分 in-progress 标记的存在——
 * 存在 ⇒ 走**恢复路径**（清 in-progress + 写已完成标记），而不是抛
 * `nothing to retire`。
 *
 * 反向闸：没有 in-progress 标记且无活可干 ⇒ 仍是 `nothing to retire`（）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 已无可退役项（门禁已装、无 typescript），但带着故障注入的半完成标记 */
function recoveringPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-103-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "rec",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { typecheck: "nudo check ." },
    }),
    "utf-8",
  );
  mkdirSync(join(dir, ".nudo"), { recursive: true });
  writeFileSync(
    join(dir, ".nudo", "migrate-retiring.json"),
    JSON.stringify({
      retiringAt: "2020-01-01T00:00:00.000Z",
      error: "simulated",
      note: "partial migrate retire",
    }),
    "utf-8",
  );
  return dir;
}

describe("半完成标记必须能被重跑 retire 清掉", () => {
  it("status 先报 partial migrate retire（反向闸：前提成立）", () => {
    const dir = recoveringPkg();
    const blocks = migrateStatus(dir)[0]!.blockers;
    expect(blocks.some((b) => b.includes("partial migrate retire"))).toBe(true);
  });

  it("重跑 retire ⇒ 清 in-progress 标记 + 写已完成标记 + status 无 blocker", () => {
    const dir = recoveringPkg();
    const result = migrateRetire(dir, { workflows: false });
    expect(result.root).toBeTruthy();
    expect(existsSync(join(dir, ".nudo", "migrate-retiring.json"))).toBe(false);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
    const after = migrateStatus(dir)[0]!;
    expect(after.retiring).toBe(false);
    expect(after.blockers).toEqual([]);
  });

  it("反向闸：没有半完成标记且无活可干 ⇒ 仍是 nothing to retire", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-mig-103-plain-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "plain", version: "1.0.0", scripts: { test: "node -e 0" } }),
      "utf-8",
    );
    expect(() => migrateRetire(dir, { workflows: false })).toThrow(/nothing to retire/);
    expect(existsSync(join(dir, ".nudo"))).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// 已存在的说明符不得报 could-not-be-resolved
// ---------------------------------------------------------------------------
describe("已存在的说明符不得报 could-not-be-resolved", () => {
/**
 * `nudo migrate strip` 对**确实存在**的相对说明符报
 * 「could not be resolved」⇒ 输出与事实相反。
 *
 * 根因：`resolveProductSpecifier` 的候选表**从不包含「说明符原样」**——
 * `./foo.js`（`foo.js` 存在）只会试 `foo.js.ts` / `foo.js.js` / `index.*`
 * （以及 `.js→.ts` 映射），全部不命中 ⇒ 落到 note 分支。
 *
 * 修复：候选表第一项 = 说明符原样（已带显式扩展名且命中 ⇒ 什么都不用改）。
 *
 * 反向闸：`./foo`（只有 `foo.ts`）仍要补成 `./foo.js`（ESM 必须显式扩展名）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function dirWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-116-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  for (const name of files) {
    writeFileSync(join(dir, "src", name), "export const v = 1;\n", "utf-8");
  }
  return dir;
}

const MAIN = (spec: string) =>
  `import { v } from "${spec}";\nexport const main = () => v;\n`;

describe("已存在的说明符不得报 could-not-be-resolved", () => {
  it("`./foo.js`（foo.js 存在）⇒ 无 note，说明符保持原样", () => {
    const dir = dirWith(["foo.js"]);
    const { code, notes } = stripTsToJs(MAIN("./foo.js"), {
      filePath: join(dir, "src", "main.ts"),
    });
    expect(notes.join("\n")).not.toContain("could not be resolved");
    expect(code).toContain('from "./foo.js"');
  });

  it("`./foo.js` 但只有 `foo.ts` ⇒ 走 .js→.ts 映射（无 note）", () => {
    const dir = dirWith(["foo.ts"]);
    const { notes } = stripTsToJs(MAIN("./foo.js"), {
      filePath: join(dir, "src", "main.ts"),
    });
    expect(notes.join("\n")).not.toContain("could not be resolved");
  });

  it("反向闸：`./foo`（只有 foo.ts）⇒ 补成 `./foo.js`", () => {
    const dir = dirWith(["foo.ts"]);
    const { code } = stripTsToJs(MAIN("./foo"), { filePath: join(dir, "src", "main.ts") });
    expect(code).toContain('from "./foo.js"');
  });

  it("反向闸：说明符**真的**不存在 ⇒ 仍要报 could-not-be-resolved", () => {
    const dir = dirWith([]);
    const { notes } = stripTsToJs(MAIN("./nope"), { filePath: join(dir, "src", "main.ts") });
    expect(notes.join("\n")).toContain("could not be resolved");
  });
});
});

// ---------------------------------------------------------------------------
// 已退役包的机器面不得把历史台账当成本次改动
// ---------------------------------------------------------------------------
describe("已退役包的机器面不得把历史台账当成本次改动", () => {
/**
 * `nudo migrate retire` 对**已退役的包**重跑 ⇒ **谎报**「本次摘掉了
 * 依赖 / 改写了脚本」（实际字节未变），且与同一包 `--all` 入口的结论互斥。
 *
 * 根因：`planRetirePackage` 的 `result` 直接取 marker 里的**累计**台账
 * （`payload.removedDeps` / `payload.rewrittenScripts`）⇒ 历史被当成本次事实。
 *
 * 修复：`result` 只装**本次 delta**（累计台账只留在 `.nudo/migrate-retired.json`），
 * 并给「早已退役、本次无操作」的包 `alreadyRetired: true`。
 *
 * 反向闸：首次退役的 delta **必须非空**（否则「二次为空」是永真）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tsPkg(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `nudo-mig-117-${name}-`));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      private: true,
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.4.0" },
    }),
    "utf-8",
  );
  return dir;
}

describe("已退役包的机器面不得把历史台账当成本次改动", () => {
  it("首次退役：delta 非空（断言非永真）", () => {
    const dir = tsPkg("first");
    const first = migrateRetire(dir, { workflows: false });
    expect(first.removedDeps).toContain("devDependencies");
    expect(first.rewrittenScripts.length).toBeGreaterThan(0);
    expect(first.alreadyRetired).toBeUndefined();
  });

  it("二次退役：delta 为空 + alreadyRetired: true + 文件逐字未变", () => {
    const dir = tsPkg("second");
    migrateRetire(dir, { workflows: false });
    const after = readFileSync(join(dir, "package.json"), "utf-8");
    const second = migrateRetire(dir, { workflows: false });
    expect(second.removedDeps).toEqual([]);
    expect(second.rewrittenScripts).toEqual([]);
    expect(second.rewrittenWorkflows).toEqual([]);
    expect(second.alreadyRetired).toBe(true);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(after);
  });

  it("累计台账仍在 marker 里（Bug 576 口径不变：审计不得被擦）", () => {
    const dir = tsPkg("audit");
    migrateRetire(dir, { workflows: false });
    const firstMarker = JSON.parse(
      readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8"),
    ) as { removedDeps: string[]; rewrittenScripts: unknown[] };
    migrateRetire(dir, { workflows: false });
    const secondMarker = JSON.parse(
      readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8"),
    ) as { removedDeps: string[]; rewrittenScripts: unknown[] };
    expect(secondMarker.removedDeps).toEqual(firstMarker.removedDeps);
    expect(secondMarker.rewrittenScripts).toEqual(firstMarker.rewrittenScripts);
  });

  it("--all 与显式目标对已退役的包给同一结论（都不谎称有动作）", () => {
    const dir = tsPkg("all");
    migrateRetire(dir, { workflows: false });
    // 显式：already retired（无 delta）
    const explicit = migrateRetire(dir, { workflows: false });
    expect(explicit.alreadyRetired).toBe(true);
    // --all：没有可退役项 ⇒ 空结果（不谎报「刚摘了 typescript」）
    expect(migrateRetireAll(dir, { workflows: false })).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// --all 必须一次报全坏包，且 --json 信封带 failedTargets
// ---------------------------------------------------------------------------
describe("--all 必须一次报全坏包，且 --json 信封带 failedTargets", () => {
/**
 * `nudo migrate retire --all` 与显式多目标列表对**同一批坏包**给出
 * **不同的失败清单**；`--all` 的 `--json` 失败信封**缺 `failedTargets`**。
 *
 * 根因：`migrateRetireAll` 在第一个 `package.json` 解析失败的包上**立刻 throw**
 * （fail-fast，裸 `Error`，不带 `retireFailures`）⇒ 其余坏包完全消失，且命令层
 * 的 `failedTargets` 永不装配；而显式多目标入口是**收集式**（报全 + 带明细）。
 *
 * 修复：`--all` 改为收集式，统一走 `retireBatchError`（带 `retireFailures`）。
 *
 * 反向闸：合法 workspace 的 `--all` 照常退役（不得因为收集式而漏报成功项）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Failures = Array<{ target: string; message: string }>;

function batch(): { root: string; a: string; b: string; c: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-118-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["pkgA", "pkgB", "pkgC"] }),
    "utf-8",
  );
  const a = join(root, "pkgA");
  const b = join(root, "pkgB");
  const c = join(root, "pkgC");
  for (const d of [a, b, c]) mkdirSync(d, { recursive: true });
  writeFileSync(
    join(a, "package.json"),
    JSON.stringify({
      name: "pkgA",
      devDependencies: { typescript: "^5.4.0" },
      scripts: { typecheck: "tsc --noEmit" },
    }),
    "utf-8",
  );
  writeFileSync(join(b, "package.json"), '{"name":"pkgB", broken json}', "utf-8");
  writeFileSync(join(c, "package.json"), '{"name":"pkgC", broken json}', "utf-8");
  return { root, a, b, c };
}

describe("-all 必须一次报全坏包，且 --json 信封带 failedTargets", () => {
  it("库面：一次报全两个坏包（不再 fail-fast 只报第一个）", () => {
    const { root, b, c } = batch();
    let failures: Failures | undefined;
    try {
      migrateRetireAll(root, { workflows: false });
    } catch (err) {
      failures = (err as { retireFailures?: Failures }).retireFailures;
    }
    expect(failures, "必须抛带 retireFailures 的批次错误").toBeDefined();
    expect(failures!.map((f) => f.target).sort()).toEqual([b, c].sort());
  });

  it("原子性不变：整批零写盘（pkgA 未被改动）", () => {
    const { root, a } = batch();
    expect(() => migrateRetireAll(root, { workflows: false })).toThrow();
    expect(readFileSync(join(a, "package.json"), "utf-8")).toContain('"tsc --noEmit"');
  });

  it("CLI 面：--all --json 的信封带 failedTargets（与显式入口同形）", () => {
    const { root, b, c } = batch();
    const all = runCliTsx(["migrate", "retire", root, "--all", "--json"]);
    expect(all.status).toBe(1);
    // `--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(all.stdout) as Array<{
      ok: boolean;
      failedTargets?: Failures;
    }>;
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.failedTargets?.map((f) => f.target).sort()).toEqual([b, c].sort());
  });

  it("反向闸：合法 workspace 的 --all 照常退役全部包", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-mig-118-ok-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["pkgA", "pkgB"] }),
      "utf-8",
    );
    const dirsOut: string[] = [];
    for (const name of ["pkgA", "pkgB"]) {
      const d = join(root, name);
      mkdirSync(d, { recursive: true });
      dirsOut.push(d);
      writeFileSync(
        join(d, "package.json"),
        JSON.stringify({
          name,
          devDependencies: { typescript: "^5.4.0" },
          scripts: { typecheck: "tsc --noEmit" },
        }),
        "utf-8",
      );
    }
    const results = migrateRetireAll(root, { workflows: false });
    expect(results).toHaveLength(2);
    for (const d of dirsOut) {
      expect(
        (JSON.parse(readFileSync(join(d, "package.json"), "utf-8")) as {
          devDependencies: Record<string, string>;
        }).devDependencies["typescript"],
      ).toBeUndefined();
    }
  });
});
});

// ---------------------------------------------------------------------------
// status 与 retire 必须同结论（有意保留的项不算 blocker）
// ---------------------------------------------------------------------------
describe("status 与 retire 必须同结论（有意保留的项不算 blocker）", () => {
/**
 * `nudo migrate status` 与 `nudo migrate retire` 对**同一项目**给出
 * **相反结论**：`retired: true` 却仍报 2 个 blocker（正是 `retire` **有意保留**
 * 的两项：编译器角色的 tsc 脚本 + 它带出的 typescript 依赖）；且 `next:` 提示
 * **无条件**输出 ⇒ 已退役项目仍被建议「再退一次」。
 *
 * 修复：
 * - blocker 判定与 `retire` 的**保留**决策同源（gate / compiler 分类）——
 * 有意保留的项不算 blocker；
 * - 机器面新增 `preserved`（真 blocker 与有意保留**可区分**）；
 * - `formatStatusTable` 的 `next:` **按状态分支**。
 *
 * 反向闸：**门禁角色**的 tsc 脚本仍报 blocker（不得把真 blocker 也吞掉）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CI = "name: CI\njobs:\n  build:\n    steps:\n      - run: npx tsc --noEmit\n";

/** 编译器角色的 tsc 脚本（`--outDir` 会 emit）+ 它的 typescript 依赖 + CI 里的 tsc */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-178-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "b178",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { build: "tsc --outDir dist" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export const a: number = 1;\n", "utf-8");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), CI, "utf-8");
  return dir;
}

describe("status 与 retire 必须同结论（有意保留的项不算 blocker）", () => {
  it("retire 明确记录了「有意保留」的两项", () => {
    const dir = project();
    const result = migrateRetire(dir);
    expect(result.preservedScripts.map((p) => p.name)).toEqual(["build"]);
    const marker = JSON.parse(
      readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8"),
    ) as { keptDeps: string[] };
    expect(marker.keptDeps).toEqual(["devDependencies"]);
  });

  it("retire 之后 status 的 blockers 为空（不再与 retired: true 自相矛盾）", () => {
    const dir = project();
    migrateRetire(dir);
    const row = migrateStatus(dir)[0]!;
    expect(row.retired).toBe(true);
    expect(row.blockers).toEqual([]);
    // 有意保留**可区分**（机器面）
    expect(row.preserved?.scripts).toEqual(["build"]);
    expect(row.preserved?.deps).toEqual(["devDependencies"]);
  });

  it("已退役项目的 next: 提示不再指向 strip → verify → retire", () => {
    const dir = project();
    migrateRetire(dir);
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).toContain("nothing to do");
    expect(text).not.toContain("strip <path>");
  });

  it("反向闸：门禁角色的 tsc 脚本仍报 blocker，next: 仍给流水线指引", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-mig-178-gate-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "b178g",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const row = migrateStatus(dir)[0]!;
    expect(row.blockers).toContain("tsc still in scripts");
    expect(row.blockers).toContain("typescript still in dependencies");
    expect(formatStatusTable([row])).toContain("strip <path>");
  });
});
});

// ---------------------------------------------------------------------------
// 重复 retire 的人类面不得重放首次的 diff
// ---------------------------------------------------------------------------
describe("重复 retire 的人类面不得重放首次的 diff", () => {
/**
 * `nudo migrate retire` **重复运行**时，人类面输出的 diff「`-` 侧」
 * 与文件**当前内容**不符（重放首次计划，不读当前状态）⇒ 报告说谎 + 人读面的
 * 幂等性被破。
 *
 * 根因：人类面直接打印 marker 的**累计台账**（合并后的 `rewrittenScripts` /
 * `rewrittenWorkflows`），并把它们挂在 `retired <root>` 标题下 ⇒ 第二次运行
 * 打印 `- (none)` / `- npx tsc --noEmit`，而这两处**早已是** `nudo check .` /
 * `npx nudojs check .`。
 *
 * 修复（与 同一处根因）：`result` 只含**本次 delta**；人类面在
 * 「本次零改动」时打 `already retired` + `nothing to do` / `no changes`。
 *
 * 反向闸：首次运行**必须**打印 `- (none)`（否则「第二次不打印」是永真）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CI = "name: CI\njobs:\n  build:\n    steps:\n      - run: npx tsc --noEmit\n";

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-179-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "b179",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { build: "tsc --outDir dist" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export const a: number = 1;\n", "utf-8");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "ci.yml"), CI, "utf-8");
  return dir;
}

function scriptsOf(dir: string): Record<string, string> {
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  }).scripts;
}

describe("重复 retire 的人类面不得重放首次的 diff", () => {
  it("第一次：真的打印 `- (none)` / `- npx tsc --noEmit`（反向闸）", () => {
    const dir = project();
    const first = runCliTsx(["migrate", "retire", dir]);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("- (none)");
    expect(first.stdout).toContain("- npx tsc --noEmit");
    expect(first.stdout).toContain("+ nudo check .");
  });

  it("第二次：只报「已退役 / 无改动」，且 `-` 侧不再与文件现状矛盾", () => {
    const dir = project();
    runCliTsx(["migrate", "retire", dir]);
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    const second = runCliTsx(["migrate", "retire", dir]);
    expect(second.status, second.stderr).toBe(0);

    // 文件逐字未变（本次什么都没做）
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
    // 报文必须承认「没改」，而不是重放首次的 `-` 侧
    expect(second.stdout).toContain("already retired");
    expect(second.stdout).toContain("nothing to do");
    expect(second.stdout).not.toContain("- (none)");
    expect(second.stdout).not.toContain("- npx tsc --noEmit");
    // 文件现状：门禁已装、CI 已是 nudojs（`-` 侧若打印就与这两条冲突）
    expect(scriptsOf(dir)["check:nudo"]).toBe("nudo check .");
    expect(readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8")).toContain(
      "nudojs check",
    );
  });

  it("机器面同步：第二次的 --json 是零 delta + alreadyRetired", () => {
    const dir = project();
    runCliTsx(["migrate", "retire", dir]);
    const second = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(second.status, second.stderr).toBe(0);
    const rows = JSON.parse(second.stdout) as Array<{
      alreadyRetired?: boolean;
      removedDeps: string[];
      rewrittenScripts: unknown[];
      rewrittenWorkflows: unknown[];
    }>;
    expect(rows[0]!.alreadyRetired).toBe(true);
    expect(rows[0]!.removedDeps).toEqual([]);
    expect(rows[0]!.rewrittenScripts).toEqual([]);
    expect(rows[0]!.rewrittenWorkflows).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// retire 对「无 tsc 可退役」的包必须 no-op
// ---------------------------------------------------------------------------
describe("retire 对「无 tsc 可退役」的包必须 no-op", () => {
/**
 * `nudo migrate retire` 对「无 tsc 可退役」的包仍写退役标记并注入脚本。
 *
 * 夹具：纯 JS 包（无 typescript 依赖、无任何 tsc 脚本、无 CI workflow）。
 * 期望：retire 是 no-op —— 不注入 `check:nudo`、不写 `.nudo/migrate-retired.json`、
 * 明确报「nothing to retire」；不得 exit 0 谎报「retired」。
 * 反向闸：有 tsc 面的包照常退役（断言非永真）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function plainJsPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-567-"));
  dirs.push(dir);
  const pkg = '{ "name": "plainjs", "version": "1.0.0", "scripts": { "test": "node -e 0" } }\n';
  writeFileSync(join(dir, "package.json"), pkg, "utf-8");
  return dir;
}

describe("retire 对「无 tsc 可退役」的包必须 no-op", () => {
  it("库面：无 TS 面 ⇒ 抛 nothing to retire，且零写盘", () => {
    const dir = plainJsPkg();
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    expect(() => migrateRetire(dir, { workflows: false })).toThrow(/nothing to retire/);
    // 落盘零变化：无注入、无退役标记
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
  });

  it("CLI 面：exit 0 + 不谎报 retired + 落盘零变化", () => {
    const dir = plainJsPkg();
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    const r = runCliTsx(["migrate", "retire", dir]);
    // 报告口径：「nothing to retire (no tsc/typescript in scope)」分支在单根路径上
    // **永远不可达**（根因：库面无条件写标记 + 注入脚本）⇒ 修好后该分支**可达**。
    // 「无可退役」是**正常结果**（不是失败）⇒ exit 0（主 agent 收口时定的口径）。
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("retired");
    expect(`${r.stdout}${r.stderr}`).toContain("nothing to retire");
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
    expect(existsSync(join(dir, ".nudo"))).toBe(false);
  });

  it("反向闸：有 tsc 面的包照常退役（注入 + 标记落盘）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m5-567-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "tspkg",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const result = migrateRetire(dir, { workflows: false });
    expect(result.removedDeps).toContain("devDependencies");
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    // 门禁脚本被改写成 nudo check（该包已有门禁 ⇒ 不再重复注入 check:nudo）
    expect(pkg.scripts["typecheck"]).toContain("nudo check");
  });
});
});

// ---------------------------------------------------------------------------
// 二次 retire 不得擦掉退役审计记录
// ---------------------------------------------------------------------------
describe("二次 retire 不得擦掉退役审计记录", () => {
/**
 * `nudo migrate retire` **二次运行擦掉退役审计记录**
 * （`.nudo/migrate-retired.json` 的 `removedDeps` / `rewrittenScripts` /
 * `rewrittenWorkflows` 被清空、`retiredAt` 被改写）。
 *
 * 期望：二次运行 **合并** 既有审计记录（并集 + 保留首次 `retiredAt`）。
 * 反向闸：首次运行必须真的记下审计内容（否则「不被清空」是永真）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function auditPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-576-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "auditpkg",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return dir;
}

function marker(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("二次 retire 不得擦掉退役审计记录", () => {
  it("库面：二次运行的 marker 保留首次的 removedDeps / rewrittenScripts / retiredAt", () => {
    const dir = auditPkg();
    migrateRetire(dir, { workflows: false });
    const first = marker(dir);
    expect(first.removedDeps).toContain("devDependencies");
    expect((first.rewrittenScripts as unknown[]).length).toBeGreaterThan(0);
    const firstAt = String(first.retiredAt);

    migrateRetire(dir, { workflows: false });
    const second = marker(dir);
    expect(second.removedDeps).toContain("devDependencies");
    expect((second.rewrittenScripts as unknown[]).length).toBeGreaterThan(0);
    expect(second.retiredAt).toBe(firstAt);
  });

  it("CLI 面：跑两遍 ⇒ 审计记录仍在（removedDeps 不被清空）", () => {
    const dir = auditPkg();
    const r1 = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(r1.status).toBe(0);
    const r2 = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(r2.status).toBe(0);
    const m = marker(dir);
    expect(m.removedDeps).toContain("devDependencies");
    expect((m.rewrittenScripts as unknown[]).length).toBeGreaterThan(0);
    expect(typeof m.retiredAt).toBe("string");
  });

  it("反向闸：首次运行确实写下了审计内容", () => {
    const dir = auditPkg();
    migrateRetire(dir, { workflows: false });
    const first = marker(dir);
    expect(first.removedDeps).toEqual(["devDependencies"]);
    expect(first.rewrittenScripts).toEqual([
      { name: "typecheck", from: "tsc --noEmit", to: "nudo check ." },
    ]);
  });
});
});

// ---------------------------------------------------------------------------
// migrate strip 的草稿落在草稿路径
// ---------------------------------------------------------------------------
describe("migrate strip 的草稿落在草稿路径", () => {
/**
 * `migrate strip` 生成的侧车草稿落在**正式侧车路径**（`lib.nudo.js`）。
 *
 * 根因：草稿用 `sidecarPathOf(outFile)` 定位 ⇒ 与正式侧车同名同路径 ⇒
 * 草稿被 ambient 侧车表当成真契约加载（草稿内容是「待审模板」，
 * 却以契约身份生效）；而且草稿文件自带的抬头写的又是 `lib.nudo.draft.js`
 * ⇒ 文本与落盘位置自相矛盾。
 *
 * 期望：草稿落在**草稿路径**（`lib.nudo.draft.js`），不进 ambient 侧车表。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("migrate strip 的草稿落在草稿路径", () => {
  it("草稿写进 lib.nudo.draft.js，正式侧车路径 lib.nudo.js 不被占用", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-585-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "lib.ts"),
      `export function add(a: number, b: number): number { return a + b; }\n`,
      "utf-8",
    );

    const results = await migrateStrip([join(dir, "lib.ts")], { write: true, draft: true });

    // 草稿落在草稿路径
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
    // 正式侧车路径没有被草稿占用（改前：lib.nudo.js 里躺着草稿内容）
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
    // 结果里的 sidecarDraft 指向草稿路径（CLI 的 "draft" 行也据此打印）
    expect(results[0]!.sidecarDraft?.endsWith("lib.nudo.draft.js")).toBe(true);
  });

  it("草稿抬头自述的文件名与实际落盘一致", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-585b-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "lib.ts"),
      `export function add(a: number, b: number): number { return a + b; }\n`,
      "utf-8",
    );
    await migrateStrip([join(dir, "lib.ts")], { write: true, draft: true });
    const draft = readFileSync(join(dir, "lib.nudo.draft.js"), "utf-8");
    // 抬头说的是 "lib.nudo.draft.js"（改前：说 draft.js、落在 nudo.js ⇒ 自相矛盾）
    expect(draft).toContain("lib.nudo.draft.js");
    // 抬头说明「复制到 lib.nudo.js 才生效」⇒ 正式侧车路径是 lib.nudo.js
    expect(draft).toContain("lib.nudo.js");
  });
});
});

// ---------------------------------------------------------------------------
// 族 16 接线 —— 586 的判据：脚本会不会**真的**产出产物
// ---------------------------------------------------------------------------
describe("族 16 接线 —— 586 的判据：脚本会不会**真的**产出产物", () => {
/**
 * 族 16 主 agent 接线钉 —— 的**判据**收口。
 *
 * 报告 586 的诉求是「**编译脚本**被改成 `nudo check .` ⇒ 构建不再产出任何产物，
 * 却绿灯通过并写下『已退役』标记」。判定必须以「**这个脚本会不会真的产出产物**」
 * 为准 —— 而不是「命令行里出现了 `-p`」或「脚本名叫 build」。
 *
 * 旧判定（按形态猜）会把两种东西都判错：
 * - `tsc -p tsconfig.build.json`（带 `outDir` + `declaration`）⇒ **真的会 emit**
 * ⇒ 编译器角色 ⇒ 原样保留（**报告 586 要的就是这个**）；
 * - `tsc -p .` 而 tsconfig 里 `compilerOptions.noEmit: true` ⇒ **不产出任何产物**
 * ⇒ 它其实是**类型门禁** ⇒ 应改写成 `nudo check` 且 typescript 依赖**可摘**
 * （仓内公开样板 `docs/examples/migrate/before` 正是这一形状 —— 它的 tsconfig
 * 带 `noEmit: true`，旧判定会让「退役 tsc」的故事落空：依赖摘不掉）。
 *
 * 这里的钉覆盖两种形状 + `extends` 链 + 反向闸。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Fixture = { dir: string; tsconfig: Record<string, unknown> };

function pkgWith(
  name: string,
  scripts: Record<string, string>,
  tsconfig: Record<string, unknown>,
  extra?: Record<string, unknown>,
): Fixture {
  const dir = mkdtempSync(join(tmpdir(), `nudo-migrate-emit-${name}-`));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      devDependencies: { typescript: "^5.0.0" },
      scripts,
      ...extra,
    }),
    "utf-8",
  );
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2), "utf-8");
  return { dir, tsconfig };
}

describe("族 16 接线 —— 586 的判据：脚本会不会**真的**产出产物", () => {
  it("`-p` 指向 noEmit 的 tsconfig ⇒ 它是门禁角色 ⇒ 改写成 nudo check 且依赖可摘", () => {
    const { dir } = pkgWith(
      "noemit",
      { typecheck: "tsc --noEmit", build: "tsc -p ." },
      { compilerOptions: { noEmit: true, strict: true } },
    );
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // 不产产物的脚本 ⇒ 门禁角色 ⇒ 改写
    expect(pkg.scripts["build"]).toBe("nudo check .");
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    // 没有编译器角色脚本了 ⇒ typescript 依赖**可摘**
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
    expect(result.removedDeps).toContain("devDependencies");
    expect(result.preservedScripts).toEqual([]);
  });

  it("`-p` 指向**真的会 emit** 的 tsconfig ⇒ 编译器角色 ⇒ 原样保留且依赖不摘", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-emit-build-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "emitbuild",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        // 门禁脚本（可退役）+ 构建脚本（真会 emit ⇒ 保留）⇒ 包整体**可退役**
        scripts: { typecheck: "tsc --noEmit", build: "tsc -p tsconfig.build.json" },
      }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.build.json"),
      JSON.stringify({ compilerOptions: { outDir: "dist", declaration: true } }),
      "utf-8",
    );
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // 真的会 emit ⇒ 原样保留（报告 586 的核心诉求）
    expect(pkg.scripts["build"]).toBe("tsc -p tsconfig.build.json");
    // 门禁脚本照常改写
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    // 编译器脚本仍要 tsc ⇒ 依赖不得摘
    expect(pkg.devDependencies["typescript"]).toBeDefined();
    expect(result.preservedScripts.map((s) => s.name)).toEqual(["build"]);
  });

  it("`extends` 链上任何一层设了 noEmit ⇒ 不 emit（门禁角色）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-emit-extends-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "extendsemit",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { build: "tsc -p ." },
      }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { noEmit: true } }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base.json", compilerOptions: { strict: true } }),
      "utf-8",
    );
    migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe("nudo check .");
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
  });

  it("反向闸：tsconfig 读不到 ⇒ 保守按「会 emit」⇒ 脚本保留（不得猜着改写）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-emit-nocfg-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "nocfg",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { typecheck: "tsc --noEmit", build: "tsc -p ./missing-dir" },
      }),
      "utf-8",
    );
    // 没有 tsconfig.json ⇒ 读不到配置 ⇒ 保守：当作会 emit ⇒ 视为编译器角色
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // 读不到配置 ⇒ **不得猜着改写**（build 原样）
    expect(pkg.scripts["build"]).toBe("tsc -p ./missing-dir");
    // 门禁脚本照常退役
    expect(pkg.scripts["typecheck"]).toBe("nudo check .");
    // 还有编译器角色脚本 ⇒ typescript 依赖不得摘
    expect(pkg.devDependencies["typescript"]).toBeDefined();
    expect(result.removedDeps).not.toContain("devDependencies");
    expect(result.preservedScripts.map((s) => s.name)).toEqual(["build"]);
  });

  it("反向闸：JSONC 注释与尾逗号不得让读取失败（读失败会误判成「会 emit」）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-emit-jsonc-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "jsonccfg",
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { build: "tsc -p ." },
      }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      [
        "{",
        "  // 行注释",
        "  /* 块注释 */",
        "  \"compilerOptions\": {",
        "    \"noEmit\": true,",
        "  },",
        "}",
      ].join("\n"),
      "utf-8",
    );
    migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toBe("nudo check .");
    expect(pkg.devDependencies["typescript"]).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// migrate strip 的 draft 标注与落盘位置一致
// ---------------------------------------------------------------------------
describe("migrate strip 的 draft 标注与落盘位置一致", () => {
/**
 * `migrate strip` 的草稿写进**正式侧车路径** ⇒ CLI 标注与落盘位置不一致，
 * 且草稿被 ambient 侧车表当成真契约。
 *
 * 根因：草稿用 `sidecarPathOf(outFile)` 定位（正式侧车路径），而草稿抬头自述
 * `*.nudo.draft.js` ⇒ 文本与位置自相矛盾；CLI 打印的 draft 行也指着正式侧车路径。
 *
 * 期望：CLI 标注的 draft 路径 == 实际落盘路径 == 草稿路径；正式侧车路径不被占用。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("migrate strip 的 draft 标注与落盘位置一致", () => {
  it("CLI 打印的 draft 路径就是草稿路径，正式侧车路径不被占用", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-592-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "lib.ts"),
      `export function add(a: number, b: number): number { return a + b; }\n`,
      "utf-8",
    );

    const r = runCliTsx(["migrate", "strip", "lib.ts", "--write"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("draft  lib.nudo.draft.js");
    // 改前：stdout 打印 "draft lib.nudo.js" 且该文件真的存在（草稿冒充契约）
    expect(r.stdout).not.toContain("draft  lib.nudo.js");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
  }, 60_000);
});
});

// ---------------------------------------------------------------------------
// 多目标退役必须全退役或全报错
// ---------------------------------------------------------------------------
describe("多目标退役必须全退役或全报错", () => {
/**
 * `nudo migrate retire <a> <b>` **只退役 `a`**，`b` 被**静默跳过**且 exit 0。
 *
 * 库面修法：新增 `migrateRetireMany(paths)` —— **全退役或全报错**（原子）。
 * CLI 面（`packages/nudojs/src/commands/migrate.ts`，非本分片所有）仍需接线：
 * `targets[0]!` ⇒ `targets`（见交付报告）。
 * 反向闸：单目标退役照常工作（断言非永真）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tsPkg(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `nudo-m5-595-${name}-`));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      dependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return dir;
}

function plainPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-595-plain-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "plainjs", version: "1.0.0", scripts: { test: "node -e 0" } }),
    "utf-8",
  );
  return dir;
}

describe("多目标退役必须全退役或全报错", () => {
  it("两个目标都被退役（不得静默只处理第一个）", () => {
    const a = tsPkg("pkg-a");
    const b = tsPkg("pkg-b");
    const results = migrateRetireMany([a, b], { workflows: false });
    expect(results).toHaveLength(2);
    for (const dir of [a, b]) {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
        dependencies: Record<string, string>;
      };
      expect(pkg.dependencies["typescript"]).toBeUndefined();
      expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
    }
  });

  it("其中一个目标无可退役 ⇒ 报错，且整批零写盘（原子）", () => {
    const a = tsPkg("pkg-a");
    const plain = plainPkg();
    const before = readFileSync(join(a, "package.json"), "utf-8");
    expect(() => migrateRetireMany([a, plain], { workflows: false })).toThrow(/nothing to retire/);
    expect(readFileSync(join(a, "package.json"), "utf-8")).toBe(before);
    expect(existsSync(join(a, ".nudo", "migrate-retired.json"))).toBe(false);
  });

  it("反向闸：单目标退役照常工作", () => {
    const a = tsPkg("pkg-a");
    const result = migrateRetire(a, { workflows: false });
    expect(result.removedDeps).toContain("dependencies");
    expect(existsSync(join(a, ".nudo", "migrate-retired.json"))).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// migrate strip 的 notes 基于 AST 事实
// ---------------------------------------------------------------------------
describe("migrate strip 的 notes 基于 AST 事实", () => {
/**
 * `migrate strip` 的 notes 用**裸正则**扫源码 ⇒ 注释 / 字符串里的
 * "enum " / "namespace " 被当成声明 ⇒ 提示与事实相反。
 *
 * 根因：notes 由 `/\benum\s+[A-Za-z_$]/.test(source)` 这类正则产生，
 * 而真正的剥除事实只有 AST 知道（core strip-types 的解析结果）。
 *
 * 期望：notes 基于 AST 事实——真 enum 才提示「enum 被删」，
 * 真（非 declare）namespace 才提示「可能打印不干净」。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function notesOf(src: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-596-"));
  dirs.push(dir);
  writeFileSync(join(dir, "c.ts"), src, "utf-8");
  const results = await migrateStrip([join(dir, "c.ts")], { write: true, draft: false });
  return results.flatMap((r) => r.notes);
}

describe("migrate strip 的 notes 基于 AST 事实", () => {
  it("注释 / 字符串里的 enum / namespace ⇒ 不产生提示", async () => {
    const notes = await notesOf(
      `export function f(x: number): number {\n  // TODO: convert this enum later\n  const s = "the namespace is fine";\n  return x + 1;\n}\n`,
    );
    expect(notes.join("\n")).not.toMatch(/enum/);
    expect(notes.join("\n")).not.toMatch(/namespace/);
  });

  it("真 enum ⇒ 提示「enum 被删」", async () => {
    const notes = await notesOf(`export enum E { A, B }\n`);
    expect(notes.join("\n")).toMatch(/enum/);
  });

  it("真 namespace（非 declare）⇒ 提示「可能打印不干净」", async () => {
    const notes = await notesOf(`namespace NS {\n  export const x = 1;\n}\n`);
    expect(notes.join("\n")).toMatch(/namespace/);
  });

  it("declare namespace ⇒ 不提示（它被删掉了，打印不干净不成立）", async () => {
    const notes = await notesOf(`export declare namespace D {\n  const x: number;\n}\n`);
    expect(notes.join("\n")).not.toMatch(/namespace/);
  });

  it("export as namespace X ⇒ 不提示 namespace **声明**（它不是 namespace 声明）", async () => {
    const notes = await notesOf(`export as namespace MyGlobal;\nexport const y = 1;\n`);
    // ⚠ **口径更新**（族 12 S2 · 2026-10-23）：`export as namespace` 现在是
    // **被报告的事实**（TS-only 模块出口语句被剥除 ⇒ CommonJS / 全局出口面
    // 消失）⇒ 提示文本里**会提到这个语法名**。断言从「整段文本不含
    // namespace」收窄为「不含 namespace **声明**类提示」——原断言的**本意**
    // （不把非声明当声明来提示）**原样保留**；同时补一条**更强**的正向断言
    // （新事实必须被报出来）。
    expect(notes.join("\n")).not.toMatch(/may not print cleanly/);
    expect(notes.join("\n")).toMatch(/export =/);
  });
});
});

// ---------------------------------------------------------------------------
// 单文件 strip 也迁移既有侧车
// ---------------------------------------------------------------------------
describe("单文件 strip 也迁移既有侧车", () => {
/**
 * `migrate strip <file>`（单文件路径）不迁移既有的 `*.nudo.ts` 侧车。
 *
 * 根因：单文件路径只处理「用户点名的那个文件」⇒ 源模块迁到 `.js` 后，
 * 它的侧车还留在 `.nudo.ts` ⇒ 产物 `lib.js` 的侧车（`lib.nudo.js`）不存在
 * ⇒ 产物静默变成「无契约」（目录路径会迁侧车，单文件路径不会 ⇒ 两条路径不一致）。
 *
 * 期望：单文件路径与目录路径走**同一条**迁移逻辑 ⇒ 既有侧车一并改名迁移
 * （`lib.nudo.ts` → `lib.nudo.js`），产物的契约不丢。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const LIB_TS = `export function f(x) {\n  return x;\n}\n\nexport function caller() {\n  return f(1);\n}\n`;
const SIDECAR = `export const f = fn({ x: number().gt(10) });\n`;

describe("单文件 strip 也迁移既有侧车", () => {
  it("既有 lib.nudo.ts ⇒ 产物侧车 lib.nudo.js 被创建（契约不丢）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-969-"));
    dirs.push(dir);
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");
    writeFileSync(join(dir, "lib.nudo.ts"), SIDECAR, "utf-8");

    const results = await migrateStrip([join(dir, "lib.ts")], { write: true, draft: false });

    // 改前：lib.nudo.js 不存在 ⇒ 产物变成「无契约」
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(true);
    expect(readFileSync(join(dir, "lib.nudo.js"), "utf-8")).toContain("number().gt(10)");
    // 迁移动作可观测
    expect(results.flatMap((r) => r.notes).join("\n")).toMatch(/sidecar migrated/);
  });

  it("目录路径与单文件路径落到同一个侧车产物（口径一致）", async () => {
    const dirFile = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-969f-"));
    const dirDir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-969d-"));
    dirs.push(dirFile, dirDir);
    for (const d of [dirFile, dirDir]) {
      writeFileSync(join(d, "lib.ts"), LIB_TS, "utf-8");
      writeFileSync(join(d, "lib.nudo.ts"), SIDECAR, "utf-8");
    }
    await migrateStrip([join(dirFile, "lib.ts")], { write: true, draft: false });
    await migrateStrip([dirDir], { write: true, draft: false });
    expect(readFileSync(join(dirFile, "lib.nudo.js"), "utf-8")).toBe(
      readFileSync(join(dirDir, "lib.nudo.js"), "utf-8"),
    );
  });

  it("迁移后产物的契约仍然生效（check 不再是绿的假象）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-969c-"));
    dirs.push(dir);
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");
    writeFileSync(join(dir, "lib.nudo.ts"), SIDECAR, "utf-8");

    const r = runCliTsx(["migrate", "strip", "lib.ts", "--write", "--no-draft"], { cwd: dir });
    expect(r.status).toBe(0);

    // 改前：产物无侧车 ⇒ check 绿（契约丢了，零告警）
    const check = runCliTsx(["check", "lib.js"], { cwd: dir });
    expect(check.status).not.toBe(0);
  }, 120_000);
});
});
