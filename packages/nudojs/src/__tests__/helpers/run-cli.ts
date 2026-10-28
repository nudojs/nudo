/**
 * nudojs CLI 测试共享 runner（原 ≥12 份私有 runCli/spawnSync 副本的统一面）。
 *
 * 两种 runner（与各测试原私有实现逐字等价）：
 * - `runCliTsx`：tsx 直跑 —— `spawnSync(node_modules/.bin/tsx, [cliEntry, ...args])`
 * - `runCliNode`：`spawnSync(process.execPath, [node_modules/tsx/dist/cli.mjs, cliEntry, ...args])`
 *
 * 固定面：env = `{ ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" }`
 * （CI 的 GITHUB_ACTIONS=true 会追加 `::error` 注记、NO_COLOR 稳定输出面），
 * opts.env 在此基线之后合入（如 NUDO_CACHE_DIR）。cwd 默认 repoRoot。
 * 返回值归一：`status ?? 1`、`stdout ?? ""`、`stderr ?? ""`。
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
export const cliEntry = join(repoRoot, "packages/nudojs/src/index.ts");

/**
 * 夹具目录用的 tsconfig：`@nudojs/*` 的 **paths 钉到仓内 `src`**。
 *
 * 子进程 CLI 解析 `@nudojs/*` 时按 **cwd** 找 tsconfig——cwd 是临时夹具时
 * 会落到各包的 `dist/`（本仓共享构建，可能是旧产物）⇒ 断言会测到陈旧实现。
 * 往夹具目录写一份带 `paths` 的 tsconfig，等价于 vitest 的源码别名（与
 * `export-dts-evidence.test.ts` 同口径）。改了 `src` 语义的回归测试
 * **必须**用 `writeSrcTsconfig` 建夹具，否则测到的是上一次构建。
 */
export const SRC_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      paths: {
        "@nudojs/core": [join(repoRoot, "packages/core/src")],
        "@nudojs/core/exec": [join(repoRoot, "packages/core/src/algebra/exec/index.ts")],
        "@nudojs/core/internal": [join(repoRoot, "packages/core/src/internal.ts")],
        "@nudojs/parser": [join(repoRoot, "packages/parser/src")],
        "@nudojs/service": [join(repoRoot, "packages/service/src")],
        "@nudojs/service/emit": [join(repoRoot, "packages/service/src/emit/index.ts")],
        "@nudojs/service/evaluator": [
          join(repoRoot, "packages/service/src/evaluator/evaluator-api.ts"),
        ],
        "@nudojs/env/es": [join(repoRoot, "packages/env/src/es.ts")],
        "@nudojs/env/web": [join(repoRoot, "packages/env/src/web.ts")],
        "@nudojs/env/node": [join(repoRoot, "packages/env/src/node.ts")],
        "@nudojs/harvester": [join(repoRoot, "packages/harvester/src")],
      },
    },
  },
  null,
  2,
)}\n`;

/** 在夹具目录写一份 `tsconfig.json`（内容见 `SRC_TSCONFIG`）。 */
export function writeSrcTsconfig(dir: string): void {
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
}

const tsxBin = join(repoRoot, "node_modules/.bin/tsx");
const tsxCliMjs = join(repoRoot, "node_modules/tsx/dist/cli.mjs");

export interface CliRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface CliRunOpts {
  /** 子进程 cwd（默认 repoRoot） */
  cwd?: string;
  /** 追加/覆盖 env（合入 NO_COLOR / GITHUB_ACTIONS 基线之后） */
  env?: Record<string, string>;
}

function run(
  command: string,
  baseArgs: string[],
  args: string[],
  opts: CliRunOpts,
): CliRunResult {
  const r = spawnSync(command, [...baseArgs, ...args], {
    cwd: opts.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false", ...opts.env },
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** runner (a)：tsx 直跑 src CLI（spawnSync(.bin/tsx, [cliEntry, ...])） */
export function runCliTsx(args: string[], opts: CliRunOpts = {}): CliRunResult {
  return run(tsxBin, [cliEntry], args, opts);
}

/** runner (b)：process.execPath + tsx/dist/cli.mjs + cliEntry */
export function runCliNode(args: string[], opts: CliRunOpts = {}): CliRunResult {
  return run(process.execPath, [tsxCliMjs, cliEntry], args, opts);
}
