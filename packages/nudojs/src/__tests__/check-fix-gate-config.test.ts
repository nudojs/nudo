/**
 * G4/G5（PR #80 第二轮审查）：`check --fix` 与 plain check 的门禁一致性。
 *
 * G4：--fix 路径此前只用 CLI 旗标解析 entryThrows/ignoreThrows，不读
 * package.json#nudo.check（profile / entryThrows / ignoreThrows）→
 * adoption 档项目 plain check 绿而 --fix 红（门禁分叉）。修法 = 与
 * plain check 同链（checkGateFromConfig + checkConfig →
 * resolveEntryThrows + mergeIgnoreThrows）。
 *
 * G5：--fix 拒绝表漏 --from——`check f.js --fix --write --from usage.js`
 * 静默丢使用处证据并以弱分析落盘契约。修法 = 拒绝表加 --from。
 *
 * subprocess 型（tsx 直跑 src，与 check-profile.test.ts 同法）。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const cli = join(root, "packages/nudojs/src/index.ts");
const tsx = join(root, "node_modules/.bin/tsx");

function runCli(
  args: string[],
  opts: { cwd?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(tsx, [cli, ...args], {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/** L2-only：export 上未消化 may-throw（throws TypeError） */
const L2_SRC = "export function getName(user){ return user.name; }\n";

function project(pkgNudo: Record<string, unknown>): string {
  const d = mkdtempSync(join(tmpdir(), "nudo-fix-cfg-"));
  writeFileSync(
    join(d, "package.json"),
    JSON.stringify({ name: "t", nudo: pkgNudo }),
  );
  writeFileSync(join(d, "a.js"), L2_SRC);
  return d;
}

describe("G4: --fix 与 plain check 同读 package.json#nudo.check", () => {
  it("profile adoption：plain 绿则 --fix 也绿（此前分叉：--fix 红）", () => {
    const d = project({ check: { profile: "adoption" } });
    const plain = runCli(["check", join(d, "a.js")]);
    expect(plain.status, plain.stdout + plain.stderr).toBe(0);
    const fix = runCli(["check", join(d, "a.js"), "--fix"]);
    const out = fix.stdout + fix.stderr;
    expect(out).toContain("check --fix");
    // adoption = L2 → warning：无 error 级诊断 → 残余 0 → exit 0
    expect(fix.status, out).toBe(0);
  });

  it("entryThrows warning：与 plain check 判定一致", () => {
    const d = project({ check: { entryThrows: "warning" } });
    const plain = runCli(["check", join(d, "a.js")]);
    expect(plain.status, plain.stdout + plain.stderr).toBe(0);
    const fix = runCli(["check", join(d, "a.js"), "--fix"]);
    expect(fix.status, fix.stdout + fix.stderr).toBe(0);
  });

  it("ignoreThrows：package.json 列表在 --fix 路径同样生效", () => {
    const d = project({ check: { ignoreThrows: ["TypeError"] } });
    const plain = runCli(["check", join(d, "a.js")]);
    expect(plain.status, plain.stdout + plain.stderr).toBe(0);
    const fix = runCli(["check", join(d, "a.js"), "--fix"]);
    expect(fix.status, fix.stdout + fix.stderr).toBe(0);
  });

  it("CLI --entry-throws error 仍压过 package.json adoption（fix 与 plain 同序）", () => {
    const d = project({ check: { profile: "adoption" } });
    const plain = runCli(["check", join(d, "a.js"), "--entry-throws", "error"]);
    expect(plain.status).toBe(1);
    const fix = runCli([
      "check",
      join(d, "a.js"),
      "--fix",
      "--entry-throws",
      "error",
    ]);
    expect(fix.status, fix.stdout + fix.stderr).toBe(1);
  });
});

describe("G5: --fix 拒绝 --from（使用处证据不得静默丢弃）", () => {
  it("--fix --write --from → usage error 指名 --from，不落盘", () => {
    const d = mkdtempSync(join(tmpdir(), "nudo-fix-from-"));
    const file = join(d, "f.js");
    writeFileSync(
      file,
      `export function staticName(node) {\n  return node.type;\n}\n`,
    );
    writeFileSync(
      join(d, "usage.js"),
      `import { staticName } from "./f.js";\nstaticName({ type: "x" });\n`,
    );
    const r = runCli(["check", file, "--fix", "--write", "--from", join(d, "usage.js")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--fix cannot be combined");
    expect(r.stderr).toContain("--from");
    // 拒绝发生在物化前：弱分析契约不得落盘
    expect(existsSync(join(d, "f.nudo.js"))).toBe(false);
  });

  it("dry-run --fix --from 同样拒绝（与 --write 无关）", () => {
    const d = mkdtempSync(join(tmpdir(), "nudo-fix-from-dry-"));
    const file = join(d, "f.js");
    writeFileSync(
      file,
      `export function staticName(node) {\n  return node.type;\n}\n`,
    );
    // usage.js 必须存在：旧实现静默丢 --from（stderr 无拒绝文案），
    // 而「文件缺失」的 from 错误信息恰含 "--from" 字样会假绿
    writeFileSync(
      join(d, "usage.js"),
      `import { staticName } from "./f.js";\nstaticName({ type: "x" });\n`,
    );
    const r = runCli(["check", file, "--fix", "--from", join(d, "usage.js")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--fix cannot be combined");
    expect(r.stderr).toContain("--from");
    expect(existsSync(join(d, "f.nudo.js"))).toBe(false);
  });
});
