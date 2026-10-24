/**
 * H8b 的**共享**产品面取证 helper（草稿面：导出 / 汇总 / 键转义 / 目录遍历）。
 *
 * 纪律：
 * - 工作目录建在 **仓库内的 `tmp/`**（gitignored）——侧车里
 *   `import … from "@nudojs/core"` 才能沿目录树解析到仓库的 node_modules；
 *   `os.tmpdir()` 下的目录解析不到 workspace 包。
 * - 产品 CLI 走 **src**（`node --import tsx packages/nudojs/src/index.ts`），
 *   不依赖 `dist/`。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 仓库根（`packages/harvester/src/__tests__/` 上溯 4 级） */
export const repoRoot = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** 已在仓库内建好的工作目录（测试结束由调用方清理） */
export function makeWorkDir(tag: string): string {
  const dir = join(repoRoot, "tmp", `harvest-bug-${tag}-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeWorkDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** 把草稿写成侧车（`app.nudo.js`）+ 配套源码（`app.js`） */
export function writeSidecar(
  dir: string,
  draftSource: string,
  source: string,
): { sidecar: string; target: string } {
  const sidecar = join(dir, "app.nudo.js");
  const target = join(dir, "app.js");
  writeFileSync(sidecar, draftSource, "utf-8");
  writeFileSync(target, source, "utf-8");
  return { sidecar, target };
}

export type CheckResult = {
  status: number;
  stdout: string;
  stderr: string;
};

/** 跑产品 CLI `nudo check <file>`（走 src） */
export function runNudoCheck(target: string): CheckResult {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--import", "tsx", join(repoRoot, "packages/nudojs/src/index.ts"), "check", target],
      { encoding: "utf-8", cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      status: typeof err.status === "number" ? err.status : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? "",
    };
  }
}
