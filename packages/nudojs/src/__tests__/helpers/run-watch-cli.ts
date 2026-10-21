/**
 * watch 面 runner（`nudo <verb> --watch` 是**常驻面**：进程自己不退出）。
 *
 * CLI 面不调用 startWatch 的关闭句柄 ⇒ 测试必须能**确定性收尾**：
 * 等到「本轮跑完」的标记出现（或进程自己退出）后杀掉进程，取回 stdout/stderr。
 *
 * 标记 = startWatch 的轮末行 `Watching for changes...`（当前在 stdout；
 * 693 修复后可能挪到 stderr）⇒ 两路都看，两种落点都能收尾。
 *
 * `waitFor: "exit"` = 只等进程自己退出（用于「本该自己退出却常驻」的钉）。
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const cliEntry = join(repoRoot, "packages/nudojs/src/index.ts");
/**
 * tsx 的 ESM loader（**绝对路径**）。
 *
 * `node --import tsx` 按**当前工作目录**解析 `tsx` ⇒ 测试把 cwd 设成临时目录时
 * 解析失败 ⇒ 子进程立刻退出（stdout 空 ⇒ 机器面钉假失败）。
 * 绝对路径的 loader 与 cwd 无关 ⇒ 任何 cwd 都能起。
 */
const tsxLoader = join(repoRoot, "node_modules/tsx/dist/loader.mjs");

export interface WatchRunResult {
  /** 进程自己退出时的退出码；被测试杀掉 ⇒ null */
  status: number | null;
  stdout: string;
  stderr: string;
  /** 进程是否自己退出（false = 到时限仍在跑 ⇒ 被杀掉） */
  exited: boolean;
}

export interface WatchRunOpts {
  cwd?: string;
  /** 到时限仍未结束 ⇒ 杀掉并返回 exited:false */
  timeoutMs?: number;
  /**
   * 收尾标记（默认 `Watching for changes...`）；`"exit"` = 只等进程退出；
   * **函数** = 等该谓词为真，收到 **stdout 与 stderr 两路**（分开传！机器面钉
   * 要判「stdout 里那份 JSON 可解析」时，合并判断会被 stderr 的横幅干扰）。
   */
  waitFor?: string | "exit" | ((stdout: string, stderr: string) => boolean);
  /** 追加 `--watch`（默认 true —— 本 helper 就是 watch 面 runner） */
  watch?: boolean;
}

export async function runWatchCli(
  args: string[],
  opts: WatchRunOpts = {},
): Promise<WatchRunResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const waitFor = opts.waitFor ?? "Watching for changes...";
  // `--watch` 必须**显式**进 argv：tsx 的 CLI（`node tsx/dist/cli.mjs …`）会把
  // `--watch` 当成自己/node 的旗标吞掉 ⇒ 子进程 process.argv 里没有 --watch
  // ⇒ CLI 根本没进 watch 形态（钉会假绿）。这里用 `node --import tsx <cli> …`
  // 并由本 helper 追加 `--watch`。
  const cliArgs = opts.watch === false ? args : [...args, "--watch"];
  const child = spawn(process.execPath, ["--import", tsxLoader, cliEntry, ...cliArgs], {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d: string) => {
    stdout += d;
  });
  child.stderr.on("data", (d: string) => {
    stderr += d;
  });

  let exitCode: number | null = null;
  let exited = false;
  const exitedPromise = new Promise<void>((resolve) => {
    child.on("exit", (code) => {
      exitCode = code;
      exited = true;
      resolve();
    });
    child.on("error", () => {
      exited = true;
      resolve();
    });
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) break;
    const acc = stdout + stderr;
    if (typeof waitFor === "function") {
      if (waitFor(stdout, stderr)) break;
    } else if (waitFor !== "exit" && acc.includes(waitFor)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!exited) {
    child.kill("SIGKILL");
    await exitedPromise;
  }
  return { status: exitCode, stdout, stderr, exited };
}

/**
 * 从混合输出里抽出**顶层 JSON 文档**（逐字扫描，忽略字符串里的括号）。
 * watch 的 --json 面：stdout = 横幅行 + JSON 文档（横幅污染是 693 的范围，
 * 本 helper 只负责把文档切出来）。
 */
export function extractJsonDocs(text: string): string[] {
  const docs: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        docs.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return docs;
}
