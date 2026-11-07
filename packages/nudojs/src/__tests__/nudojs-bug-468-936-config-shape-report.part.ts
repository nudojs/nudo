/**
 * Bug 468 / 936 回归（CLI 报告面）：package.json#nudo 键的**形状**问题
 * （值不是对象 / 是假值）必须**在报告面可见**——service 侧只给 stderr 一行，
 * check / health 的报告面看不到 ⇒ 用户不知道自己写错了。
 *
 * 另锁 onboarding 条件对齐：形状写坏时**不得**打「本项目还没有 nudo 配置」
 * 的 onboarding 块（那个前提不成立，且「nudo init」是错 advice）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const SRC = `export function f() {
  return 1;
}
`;

/** 468：`nudo` 键的值不是对象 */
function projectWithNudo(nudo: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-468-cli-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "p", version: "1.0.0", type: "module", nudo }),
    "utf-8",
  );
  writeFileSync(join(dir, "probe.js"), SRC, "utf-8");
  return dir;
}

describe("Bug 468 CLI：nudo 键形状非法 ⇒ 报告面可见（不静默）", () => {
  it("check --json：config-shape warning 进 issues 段", () => {
    const dir = projectWithNudo(true);
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as {
        issues: { code: string; severity: string; message: string }[];
      };
      const shape = json.issues.filter((i) => i.code === "config-shape");
      expect(shape).toHaveLength(1);
      expect(shape[0].severity).toBe("warning");
      expect(shape[0].message).toContain("invalid");
      expect(shape[0].message).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("check 人类面：issues 段看得见 config-shape", () => {
    const dir = projectWithNudo(true);
    try {
      const r = runCli(["check", "probe.js"], { cwd: dir });
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("health 人类面：config 提示行可见", () => {
    const dir = projectWithNudo(true);
    try {
      const r = runCli(["health", "probe.js"], { cwd: dir });
      expect(r.stdout).toContain("config:");
      expect(r.stdout).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("health --json：configShape 字段可见", () => {
    const dir = projectWithNudo(true);
    try {
      const r = runCli(["health", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as {
        files: { configShape?: { pkgPath: string; message: string } }[];
      };
      expect(json.files[0].configShape).toBeDefined();
      expect(json.files[0].configShape?.message).toContain("expected an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("936：假值 nudo 键（false）同样可见（且措辞说 falsy）", () => {
    const dir = projectWithNudo(false);
    try {
      const r = runCli(["check", "probe.js"], { cwd: dir });
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain("falsy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：合法 nudo 对象 ⇒ 无 config-shape 诊断", () => {
    const dir = projectWithNudo({ check: { ignoreThrows: ["RangeError"] } });
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as { issues: { code: string }[] };
      expect(json.issues.filter((i) => i.code === "config-shape")).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Bug 468/936 CLI：配置形状诊断是 live 事实（磁盘缓存不得留痕/重复）", () => {
  it("缓存命中轮：config-shape 仍恰 1 条（不重复）", () => {
    const dir = projectWithNudo(true);
    try {
      const env = { NUDO_CACHE_DIR: join(dir, ".cache") };
      const first = runCli(["check", "--json", "probe.js"], { cwd: dir, env });
      const second = runCli(["check", "--json", "probe.js"], { cwd: dir, env });
      const a = JSON.parse(first.stdout) as { issues: { code: string }[] };
      const b = JSON.parse(second.stdout) as { issues: { code: string }[] };
      expect(a.issues.filter((i) => i.code === "config-shape")).toHaveLength(1);
      expect(b.issues.filter((i) => i.code === "config-shape")).toHaveLength(1);
      // 落盘的缓存条目**不得**含 config-shape（live 事实不持久化）——
      // 否则命中轮 live merge 会与缓存条目重复。
      const cacheFiles = collectCacheFiles(join(dir, ".cache"));
      expect(cacheFiles.length).toBeGreaterThan(0);
      for (const f of cacheFiles) {
        expect(readFileSync(f, "utf-8")).not.toContain("config-shape");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("键被改好后：陈旧的 config-shape 告警不得留在缓存里", () => {
    const dir = projectWithNudo(true);
    try {
      const env = { NUDO_CACHE_DIR: join(dir, ".cache") };
      const first = runCli(["check", "--json", "probe.js"], { cwd: dir, env });
      expect(
        (JSON.parse(first.stdout) as { issues: { code: string }[] }).issues.filter(
          (i) => i.code === "config-shape",
        ),
      ).toHaveLength(1);
      // 用户把写坏的键改好
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "p", version: "1.0.0", type: "module", nudo: {} }),
        "utf-8",
      );
      const second = runCli(["check", "--json", "probe.js"], { cwd: dir, env });
      expect(
        (JSON.parse(second.stdout) as { issues: { code: string }[] }).issues.filter(
          (i) => i.code === "config-shape",
        ),
      ).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** 递归收集缓存条目文件 */
function collectCacheFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}
