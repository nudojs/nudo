/**
 * 族 56 · nudojs **CLI 面** 3 条（机器消费者能看见的问题）：
 *
 * | # | 项 | 断言要点 |
 * |---|---|---|
 * | 1 | **排除清单未上 stdout** | 排除清单（pnpm 负向模式命中的包）此前**只在 stderr** ⇒ 机器消费者看不到「哪些包被排除了」。现在它在 **stdout 的机器面**（`--json`）可解析：`excluded` 字段（相对扫描根的 posix 路径，与 stderr 那行逐字一致）。**无排除 ⇒ JSON 逐字不变**（负控）。 |
 * | 2 | **M5 的 `migrateRetireMany` 原子性** | 原子性（任一失败 ⇒ 整批零写盘）**不变**；但错误消息此前**只带第一个失败目标** ⇒ 其余失败目标丢失。现在消息**列出全部失败目标**（人读消息 + `--json` 的 `failedTargets`）。 |
 * | 3 | **verify 的扫描面不含 `.jsx`**〔跨族〕 | `migrate verify` 此前复用 service 的 `isNudoTargetPath`（排除 `.jsx`）⇒ **JSX 产物对 verify 不可见** ⇒ 迁移闸门对不可加载的产物发绿灯。verify 现在**自己算扫描面**（含 `.jsx` / `.tsx` / `.cjs`），**service 侧仍是根因**（本片只做 CLI 侧兜底）。 |
 *
 * 反向闸（断言非永真）：
 * - 排除清单：无排除的 workspace ⇒ `--json` 里**不出现** `excluded` 键（stdout 逐字不变）。
 * - 失败清单：单个失败 ⇒ 消息与旧实现**逐字同形**（`<原因> (target: <目标>)`）。
 * - 扫描面：`.d.ts` 声明 / `*.nudo.js` 侧车**仍不是** verify 的目标（Bug 566 同口径不变）。
 */
import { describe, it, expect, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetireMany } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** pnpm workspace：`packages/*` + 负向模式 `!packages/legacy` */
function workspaceFixture(): { dir: string; app: string; legacy: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-56-ws-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", '  - "packages/*"', '  - "!packages/legacy"', ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "root-56", version: "1.0.0", private: true }),
    "utf-8",
  );
  const app = join(dir, "packages", "app");
  const legacy = join(dir, "packages", "legacy");
  mkdirSync(app, { recursive: true });
  mkdirSync(legacy, { recursive: true });
  const pkg = JSON.stringify({
    name: "app-56",
    version: "1.0.0",
    scripts: { typecheck: "tsc --noEmit" },
    devDependencies: { typescript: "^5.0.0" },
  });
  writeFileSync(join(app, "package.json"), pkg, "utf-8");
  writeFileSync(join(legacy, "package.json"), pkg, "utf-8");
  return { dir, app, legacy };
}

/** 无任何排除模式的 workspace（负控：stdout 逐字不变） */
function cleanWorkspaceFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-56-clean-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    ["packages:", '  - "packages/*"', ""].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "clean-56", version: "1.0.0", private: true }),
    "utf-8",
  );
  const app = join(dir, "packages", "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      name: "app-56-clean",
      version: "1.0.0",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return dir;
}

/** 无 tsc/typescript 的包（退役时报「nothing to retire」） */
function plainPkg(name: string): { dir: string; before: string } {
  const dir = mkdtempSync(join(tmpdir(), `nudo-cli-56-${name}-`));
  dirs.push(dir);
  const before = `${JSON.stringify({ name, version: "1.0.0" }, null, 2)}\n`;
  writeFileSync(join(dir, "package.json"), before, "utf-8");
  return { dir, before };
}

/** 畸形清单（真错误，不是「无可退役」） */
function brokenPkg(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `nudo-cli-56-${name}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), `{"name":"${name}", broken json`, "utf-8");
  return dir;
}

/** verify 的扫描面 fixture：`.jsx` 产物 + 声明 + 侧车 */
function verifyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-56-verify-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "Comp.jsx"),
    "export function Comp(props) {\n  return <div className=\"x\">{props.name}</div>;\n}\n",
    "utf-8",
  );
  writeFileSync(
    join(dir, "types.d.ts"),
    "export declare function foo(x: number): string;\n",
    "utf-8",
  );
  writeFileSync(
    join(dir, "sidecar.nudo.js"),
    "export const fooContract = {};\n",
    "utf-8",
  );
  return dir;
}

describe("族 56 · CLI 面 3 条", () => {
  it("第 1 条：排除清单上 stdout（--json 面可解析；文本面 stdout 不含被排除的包）", () => {
    const { dir, legacy } = workspaceFixture();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ root: string; excluded?: string[] }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    // 机器面：每行都带**同一份**排除清单（相对扫描根的 posix 路径）
    for (const row of parsed) {
      expect(row.excluded).toEqual(["packages/legacy"]);
    }
    // 被排除的包**不**进 status（排除 ≠ 审计对象）
    expect(parsed.map((row) => row.root).join(" ")).not.toContain("legacy");

    // 文本面：stdout 逐字**不含**被排除的包（人读提示仍在 stderr）
    const text = runCliTsx(["migrate", "status", dir]);
    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout).not.toContain("packages/legacy");
    expect(text.stderr).toContain("skipped (pnpm excluded)");
    // 反向闸：被排除的包真的在工作区里（否则上面的断言是永真）
    expect(existsSync(join(legacy, "package.json"))).toBe(true);
  });

  it("第 1 条：retire --all --json 同样带排除清单（机器面统一口径）", () => {
    const { dir } = workspaceFixture();
    const r = runCliTsx(["migrate", "retire", "--all", "--dry-run", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ root: string; excluded?: string[] }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const row of parsed) {
      expect(row.excluded).toEqual(["packages/legacy"]);
    }
  });

  it("第 1 条 · 负控：无排除的 workspace ⇒ --json 逐字不变（不出现 excluded 键）", () => {
    const dir = cleanWorkspaceFixture();
    const r = runCliTsx(["migrate", "status", "--json", dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("excluded");
    const parsed = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(parsed.length).toBeGreaterThan(0);
    for (const row of parsed) {
      expect(Object.keys(row)).not.toContain("excluded");
    }
  });

  it("第 2 条：多个目标失败 ⇒ 消息列出**全部**失败目标，且整批零写盘", () => {
    const a = plainPkg("plain-a");
    const b = plainPkg("plain-b");
    let err: Error | undefined;
    try {
      migrateRetireMany([a.dir, b.dir], { workflows: false });
    } catch (e) {
      err = e as Error;
    }
    expect(err, "两个目标都无可退役 ⇒ 必须抛错").toBeDefined();
    // 全部失败目标都在消息里（改前：只带第一个 ⇒ 另一个丢失）
    expect(err!.message).toContain(a.dir);
    expect(err!.message).toContain(b.dir);
    // 原子性**不变**：整批零写盘
    expect(readFileSync(join(a.dir, "package.json"), "utf-8")).toBe(a.before);
    expect(readFileSync(join(b.dir, "package.json"), "utf-8")).toBe(b.before);
    expect(existsSync(join(a.dir, ".nudo"))).toBe(false);
    expect(existsSync(join(b.dir, ".nudo"))).toBe(false);
  });

  it("第 2 条：CLI 面 —— 失败目标全部可见（文本面 + --json 的 failedTargets）", () => {
    const a = plainPkg("cli-plain-a");
    const b = plainPkg("cli-plain-b");
    const r = runCliTsx(["migrate", "retire", a.dir, b.dir]);
    expect(r.status).toBe(0); // 「无可退役」是正常结果（Bug 567 口径不变）
    const all = `${r.stdout}${r.stderr}`;
    expect(all).toContain(a.dir);
    expect(all).toContain(b.dir);

    const j = runCliTsx(["migrate", "retire", a.dir, b.dir, "--json"]);
    expect(j.status).toBe(0);
    // BUG-017：`--json` 顶层形状**恒为数组**（成功信封也是单元素数组）
    const envelope = JSON.parse(j.stdout) as Array<{
      ok: boolean;
      failedTargets?: Array<{ target: string; message: string }>;
    }>;
    expect(Array.isArray(envelope)).toBe(true);
    const parsed = envelope[0]!;
    expect(parsed.ok).toBe(true);
    expect(parsed.failedTargets).toHaveLength(2);
    expect(parsed.failedTargets!.map((f) => f.target)).toEqual([a.dir, b.dir]);
  });

  it("第 2 条：真错误与「无可退役」混在一批 ⇒ 报红（不再被当成正常结果吞成 exit 0）", () => {
    const plain = plainPkg("mix-plain");
    const broken = brokenPkg("mix-broken");
    const r = runCliTsx(["migrate", "retire", plain.dir, broken]);
    expect(r.status).toBe(1);
    const all = `${r.stdout}${r.stderr}`;
    expect(all).toContain(plain.dir);
    expect(all).toContain(broken);
    expect(all).toContain("package.json parse failed");
    // 原子性：整批零写盘
    expect(readFileSync(join(plain.dir, "package.json"), "utf-8")).toBe(plain.before);
  });

  it("第 2 条 · 反向闸：单个失败 ⇒ 消息与旧实现逐字同形", () => {
    const plain = plainPkg("single-plain");
    let err: Error | undefined;
    try {
      migrateRetireMany([plain.dir], { workflows: false });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toBe(
      `nothing to retire (no tsc/typescript in scope) (target: ${plain.dir})`,
    );
  });

  it("第 3 条：verify 的目标集合含 `.jsx`（JSX 产物不再对迁移闸门隐形）", () => {
    const dir = verifyFixture();
    const r = runCliTsx(["migrate", "verify", dir]);
    // 改前：`.jsx` 不可见 ⇒ verify 只看到 .js 目标（本 fixture 里一个都没有 ⇒
    // 走「空集 ⇒ 判红」分支），JSX 产物从未被验过。
    expect(r.stdout).toContain("Comp.jsx");
    expect(r.stdout).not.toContain("Not an analysis target");

    // 显式点名的 `.jsx` 目标也不再被拒（改前：not-a-target）
    const one = runCliTsx(["migrate", "verify", join(dir, "Comp.jsx")]);
    expect(one.stdout).toContain("Comp.jsx");
    expect(one.stdout).not.toContain("Not an analysis target");
  });

  it("第 3 条 · 反向闸：声明文件 / 侧车**仍不是** verify 的目标（Bug 566 同口径不变）", () => {
    const dir = verifyFixture();
    const r = runCliTsx(["migrate", "verify", dir]);
    expect(r.stdout).not.toContain("types.d.ts");
    expect(r.stdout).not.toContain("sidecar.nudo.js");
    // 显式点名的声明文件仍被拒（消息口径不变）
    const decl = runCliTsx(["migrate", "verify", join(dir, "types.d.ts")]);
    expect(decl.status).toBe(1);
    expect(`${decl.stdout}${decl.stderr}`).toContain("Not an analysis target");
  });
});
