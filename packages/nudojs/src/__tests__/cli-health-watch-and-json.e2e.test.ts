/**
 * 模块套件：cli-health-watch-and-json（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, runCliNode as runCli } from "./helpers/run-cli.ts";
import { runWatchCli, extractJsonDocs } from "./helpers/run-watch-cli.ts";
import { startWatch, collectNudoFiles } from "../commands/shared.ts";
import { noteEnvPathDeps, clearEnvPathDeps } from "@nudojs/service";
import { startCheckWatch } from "../commands/check-command.ts";


// ---------------------------------------------------------------------------
// watch 扫描应用 nudo.analysis.include / exclude
// ---------------------------------------------------------------------------
describe("watch 扫描应用 nudo.analysis.include / exclude", () => {
/**
 * CLI `nudo check/test <dir> --watch` 的**扫描面不应用**
 * `nudo.analysis.include` / `exclude` ⇒ watch 门禁对**项目范围外**的文件仍然
 * 报错，且与 IDE 对同一文件口径相反（文档明写 watch 扫描「应用」）。
 *
 * 修法：watch 的文件集走**产品唯一的范围闸门** `shouldAnalyzeFile`
 * （LSP / vite-plugin 同一个入口 ⇒ 同口径），但**不应用 mode**
 * （docs/design/cli-semantics.md §7 的「入口 × include/exclude」表：
 * watch 扫描「应用」include/exclude、「不应用 mode」）。
 *
 * 分工（与 ）：CLI **非 watch** 的目标扫描**忽略** include/exclude
 * （「点名路径即意图」，文档明写）⇒ 本用例同时钉住这条边界。
 */






const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const SRC = (n: number) => `export function f${n}() {\n  return ${n};\n}\n`;

{
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 夹具：fx/{package.json(include: src/**), src/in.js, other/out.js} */
  function makeFixture(): { fx: string; inFile: string; outFile: string } {
    const fx = mkdtempSync(join(tmpdir(), "nudo-689-"));
    dirs.push(fx);
    mkdirSync(join(fx, "src"), { recursive: true });
    mkdirSync(join(fx, "other"), { recursive: true });
    writeFileSync(
      join(fx, "package.json"),
      JSON.stringify({
        name: "scopefx",
        version: "1.0.0",
        private: true,
        type: "module",
        nudo: { analysis: { include: ["src/**"] } },
      }),
      "utf-8",
    );
    const inFile = join(fx, "src", "in.js");
    const outFile = join(fx, "other", "out.js");
    writeFileSync(inFile, SRC(1), "utf-8");
    writeFileSync(outFile, SRC(2), "utf-8");
    return { fx, inFile, outFile };
  }

  it("watch 扫描面不收 include 之外的文件（改前：收进来并报红）", () => {
    const { fx, inFile, outFile } = makeFixture();
    const watchSet = collectNudoFiles(fx, { scope: "watch" });
    expect(watchSet).toContain(inFile);
    expect(watchSet).not.toContain(outFile);
  });

  it("watch 首轮只分析范围内的文件（产品面：与 IDE 同口径）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fx, inFile, outFile } = makeFixture();

    const seen: string[] = [];
    const close = startWatch([fx], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 1);
      expect(seen).toContain(inFile);
      expect(seen).not.toContain(outFile);
    } finally {
      close();
    }
  });

  it("边界：CLI 非 watch 的目录目标扫描仍忽略 include/exclude（点名路径即意图）", () => {
    const { fx, inFile, outFile } = makeFixture();
    const targetSet = collectNudoFiles(fx);
    expect(targetSet).toContain(inFile);
    expect(targetSet).toContain(outFile);
  });
}
});


// ---------------------------------------------------------------------------
// watch --json 的 stdout 必须是纯 JSON
// ---------------------------------------------------------------------------
describe("watch --json 的 stdout 必须是纯 JSON", () => {
/**
 * `nudo test --watch --json` / `nudo health --watch --json` 的
 * **watch 横幅写进 stdout** ⇒ stdout = 横幅 + JSON + 横幅 ⇒
 * `JSON.parse(stdout)` 直接抛 SyntaxError（机器面契约破）。
 *
 * 修复：watch 横幅（人类进度）一律走 **stderr**；stdout 只剩 JSON。
 *
 * 钉法（必须真的 JSON.parse）：spawn 真实 CLI → 收 stdout → JSON.parse。
 *
 * ⚠️ 收口订正：本钉原先用 `node tsx/dist/cli.mjs <cli> … --watch` 起子进程 ——
 * tsx 的 CLI 会把 `--watch` 当成**自己/node 的旗标**吞掉 ⇒ 子进程的
 * `process.argv` 里没有 `--watch` ⇒ CLI **根本没进 watch 形态** ⇒ 钉在测
 * 非 watch 路径（假通过）。改用共享的 `runWatchCli`（`node --import tsx` +
 * 显式追加 `--watch`）⇒ 钉真的落在 watch 形态上。
 */






const ONE = `export function one(){ return 1; }\n`;


  it("nudo test --watch --json → JSON.parse(stdout) 不抛", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-c4-693-"));
    try {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runWatchCli(["test", file, "--json"], {
        cwd: dir,
        // 等 stdout 里出现**一份可解析的 JSON**（watch 面首轮跑完才有）；
        // 谓词只看 stdout —— stderr 的横幅不该参与 JSON 判定
        waitFor: (out) => {
          try {
            JSON.parse(out);
            return true;
          } catch {
            return false;
          }
        },
      });
      const stdout = r.stdout;
      const stderr = r.stderr;

      // 核心断言：stdout 真的能被 JSON.parse（旧行为：横幅在前 ⇒ 抛）
      expect(() => JSON.parse(stdout)).not.toThrow();
      const parsed = JSON.parse(stdout) as { version?: number; functions?: unknown[] };
      expect(parsed.version).toBe(1);
      // 横幅不再进 stdout
      expect(stdout).not.toContain("Watching for changes");
      expect(stdout).not.toContain("nudo test...");
      // 横幅走 stderr（人类面不丢）
      expect(stderr).toContain("nudo test...");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

});


// ---------------------------------------------------------------------------
// env 模板变更 ⇒ 依赖它的源文件复分析
// ---------------------------------------------------------------------------
describe("env 模板变更 ⇒ 依赖它的源文件复分析", () => {
/**
 * CLI watch 的 **env 模板失效分支是死代码** ⇒ 目录 watch 下改了
 * env 模板，依赖它的源文件**永不复分析**（IDE/watch 面板里类型一直是旧值）。
 *
 * 根因：`runIncremental` 的路径判定顺序 —— env 模板扩展名
 * （`.env.js` / `.env.mjs` / `.env.ts` / `mock-*.js` / `*.mock.js`）同时命中
 * `isNudoTargetPath` ⇒ `isNudoTargetPath` 分支先 `continue` ⇒ 下面的
 * env 反向边分支永远走不到。（`.env.mts` / `.env.cjs` 不命中
 * `isNudoTargetPath` ⇒ 旧顺序下反而正常。）
 *
 * 修复：env 模板判定**排在 `isNudoTargetPath` 之前**。
 */







const waitUntil = async (pred: () => boolean, ms = 20000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const ENV_SRC = `export function defineEnv(){ return { globals: { MAGIC: 1 } }; }\n`;
const MAIN_SRC = `/// @nudo:env ./globals.env.ts\nexport function useGlobal(){ return MAGIC; }\n`;

afterEach(() => {
  vi.restoreAllMocks();
  clearEnvPathDeps();
});


  it("改了 globals.env.ts → main.js 在增量轮被重新分析", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "clear").mockImplementation(() => {});

    const dir = mkdtempSync(join(tmpdir(), "nudo-c4-697-"));
    const envFile = join(dir, "globals.env.ts");
    const mainFile = join(dir, "main.js");
    try {
      writeFileSync(envFile, ENV_SRC, "utf-8");
      writeFileSync(mainFile, MAIN_SRC, "utf-8");
      // 反向边登记（分析器侧行为，与被测的 watch 路由无关）
      noteEnvPathDeps(mainFile, MAIN_SRC);

      const analyzed: string[] = [];
      const close = startWatch(
        [dir],
        async (f) => {
          analyzed.push(f);
        },
        "test",
      );
      try {
        await waitUntil(() => analyzed.length >= 2);
        const mainRunsBefore = analyzed.filter((f) => f.endsWith("main.js")).length;
        expect(mainRunsBefore).toBeGreaterThanOrEqual(1);

        // 改 env 模板 ⇒ 依赖它的 main.js 必须复分析（旧行为：永不复分析）
        writeFileSync(
          envFile,
          `export function defineEnv(){ return { globals: { MAGIC: 2 } }; }\n`,
          "utf-8",
        );
        await waitUntil(
          () => analyzed.filter((f) => f.endsWith("main.js")).length > mainRunsBefore,
        );
        expect(analyzed.filter((f) => f.endsWith("main.js")).length).toBeGreaterThan(
          mainRunsBefore,
        );
      } finally {
        close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearEnvPathDeps();
    }
  }, 60000);

});


// ---------------------------------------------------------------------------
// health --json 序列化 budget 截断快照
// ---------------------------------------------------------------------------
describe("health --json 序列化 budget 截断快照", () => {
/**
 * `nudo health --json` 的机器面**整条丢掉 budget 截断快照**。
 *
 * `HealthReport` 类型声明了 `budget?: AbsBudgetStats`（注释明写与
 * `nudo check --json` 的 budget **同源同义**），分析后也填了、文本分支
 * 也打了「⚠ budget truncated」——但 JSON 分支是**逐字段手写列举**的，
 * `budget` 不在清单里 ⇒ 机器消费者读到 `ok: true` 的「干净」健康报告，
 * 而实际结果已被**宽化**（同一轮两个面结论相反）。
 *
 * 钉：两个面同时断言——文本面报截断 + JSON 面**有**对应字段
 * （files[].budget 同源同义 + summary.budgetTruncated 聚合）。
 */






let dir: string;

/** 深自递归：实参逐层变形 ⇒ eval depth 截断（64/64） */
const DEEP = `export function down(n) {
  if (n <= 0) {
    return 0;
  }
  return down(n - 1);
}
`;

/** 普通导出函数：不触发任何预算 */
const PLAIN = `export function add(a, b) {
  return a + b;
}
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-925-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("截断文件：JSON 面带 budget.truncated=true + summary.budgetTruncated；文本面报截断", { timeout: 30_000 }, () => {
    const deep = join(dir, "deep.js");
    writeFileSync(deep, DEEP);

    const json = runCliTsx(["health", deep, "--json"]);
    const parsed = JSON.parse(json.stdout) as {
      ok: boolean;
      files: Array<{ file: string; budget?: { truncated: boolean; reasons: string[] } }>;
      summary: { budgetTruncated?: boolean };
    };
    expect(parsed.files[0]!.budget, `no budget in JSON face:\n${json.stdout}`).toBeDefined();
    expect(parsed.files[0]!.budget!.truncated).toBe(true);
    expect(parsed.summary.budgetTruncated).toBe(true);

    // 文本面：同一轮明确报「budget truncated」（两个面同源）
    const text = runCliTsx(["health", deep]);
    expect(text.stdout).toContain("budget truncated");

    // 与 `nudo check --json` 的同一份 core budget 快照同源同义
    const check = runCliTsx(["check", deep, "--json"]);
    const cj = JSON.parse(check.stdout) as { budget?: { truncated: boolean } };
    expect(cj.budget!.truncated).toBe(parsed.files[0]!.budget!.truncated);
  });

  it("未截断文件：budget 也在（truncated=false），summary 不报 budgetTruncated", { timeout: 30_000 }, () => {
    const plain = join(dir, "plain.js");
    writeFileSync(plain, PLAIN);
    const json = runCliTsx(["health", plain, "--json"]);
    const parsed = JSON.parse(json.stdout) as {
      files: Array<{ budget?: { truncated: boolean } }>;
      summary: { budgetTruncated?: boolean };
    };
    expect(parsed.files[0]!.budget).toBeDefined();
    expect(parsed.files[0]!.budget!.truncated).toBe(false);
    expect(parsed.summary.budgetTruncated).toBeUndefined();
    const text = runCliTsx(["health", plain]);
    expect(text.stdout).not.toContain("budget truncated");
  });

});


// ---------------------------------------------------------------------------
// health --watch 的路径错误通道可达
// ---------------------------------------------------------------------------
describe("health --watch 的路径错误通道可达", () => {
/**
 * `nudo health --watch <不存在的路径>`：**路径错误被 watch 的文件
 * 收集整个吞掉** ⇒ exit 0 / 零报告 / 静默空会话 ⇒ 假绿；而 `nudo health`
 * （无 watch）对**同一路径** exit 1。
 *
 * 根因：「File not found」报告的唯一生产者是 runHealth，而 watch 路径下
 * runHealth 只能作为 startWatch 的 per-file runner 被调用；路径不存在 ⇒
 * 收集为空 ⇒ runner 一次都不跑 ⇒ 报告永不产生、退出码永不置红。
 *
 * 钉：watch 面必须与无 watch 面**同款**——路径错误上屏 + 红 + 进程自己
 * 退出（不装 watch ⇒ 不常驻）。
 */







let dir: string;
let missing: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-927-"));
  missing = join(dir, "nope.js");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("health --watch <不存在路径>：路径错误上屏 + exit 1 + 进程自己退出（不装 watch）", { timeout: 40_000 }, async () => {
    const r = await runWatchCli(["health", missing], { waitFor: "exit", timeoutMs: 12_000 });
    expect(r.stdout, `stderr=${r.stderr}`).toContain("File not found");
    expect(r.stdout).toContain("Result: FAIL");
    expect(r.stdout).toContain("1 error(s)");
    // 不得装 watch（否则是常驻的静默绿会话）
    expect(r.stdout).not.toContain("Watching for changes");
    expect(r.exited, "watch 面仍在常驻（路径错误被吞）").toBe(true);
    expect(r.status).toBe(1);
  });

  it("与无 watch 面同款：同一路径的结论一致（红 + 同一句错误说明）", { timeout: 40_000 }, async () => {
    const watch = await runWatchCli(["health", missing], { waitFor: "exit", timeoutMs: 12_000 });
    const plain = runCliTsx(["health", missing]);
    expect(plain.status).toBe(1);
    expect(plain.stdout).toContain("File not found");
    expect(watch.stdout).toContain(plain.stdout.split("\n")[0]!.trim());
  });

});


// ---------------------------------------------------------------------------
// watch 每轮重采 --from 调用点证据
// ---------------------------------------------------------------------------
describe("watch 每轮重采 --from 调用点证据", () => {
/**
 * `check --watch --from` 的调用点证据是**启动快照** ⇒ 每轮从不刷新
 * ⇒ 同一轮里两个文件对同一次调用给出相反裁决，且与同一磁盘状态下的**全新**
 * 非 watch 运行结论相反。
 *
 * 修复：watch 每轮重采 `--from` 调用点证据（startCheckWatch 的 onRoundStart），
 * 证据缺失（读不到 / 解析失败）进入本轮门禁（红）。
 *
 * 测试直接驱动 startCheckWatch（拿到 startWatch 的关闭句柄 ⇒ 确定性清理）。
 */






const waitUntil = async (pred: () => boolean, ms = 30000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const LIB_SRC = `export function add(a, b) {
  return a + b;
}
`;
const LIB_CONTRACT = `import { fn, number } from "@nudojs/core";
export const add = fn({ a: number().gt(0), b: number() }, number());
`;
/** 越界的调用点实参（-1 不满足 a > 0）⇒ L1 domain-exceeds */
const USAGE_BAD = `import { add } from "./lib.js";

export const r = add(-1, 2);
`;
/** 合法的调用点实参 ⇒ 无 domain-exceeds */
const USAGE_OK = `import { add } from "./lib.js";

export const r = add(1, 2);
`;

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});


  it("调用点改了之后，重新分析依赖方时用的是**当前**证据（不是启动快照）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-928-watch-"));
    const lib = join(dir, "lib.js");
    const usage = join(dir, "usage.js");
    writeFileSync(lib, LIB_SRC, "utf-8");
    writeFileSync(join(dir, "lib.nudo.js"), LIB_CONTRACT, "utf-8");
    writeFileSync(usage, USAGE_BAD, "utf-8");

    const logs: string[] = [];
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const close = startCheckWatch([lib], {
      from: [usage],
      humanMode: true,
      shared: {},
    });

    try {
      // 首轮：启动快照里的 -1 ⇒ L1 domain-exceeds
      await waitUntil(() => logs.join("\n").includes("nudo:contract-domain-exceeds"));
      expect(logs.join("\n")).toContain("-1 exceeds");

      // 调用点改成合法实参（证据变了）
      writeFileSync(usage, USAGE_OK, "utf-8");
      // 等这一轮（usage.js 不是被跟踪目标 ⇒ 增量轮无脏文件，直接返回）
      await new Promise((r) => setTimeout(r, 600));
      const before = logs.length;

      // 触碰依赖方 ⇒ 触发增量轮，重新分析 lib.js
      writeFileSync(lib, LIB_SRC, "utf-8");
      await waitUntil(() => logs.length > before);
      await waitUntil(() => {
        const tail = logs.slice(before).join("\n");
        return tail.includes("nudo check") && !tail.includes("exceeds");
      });

      const tail = logs.slice(before).join("\n");
      // 新证据（1 ≤ a）⇒ 不再有 domain-exceeds（启动快照会一直报 -1）
      expect(tail).not.toContain("nudo:contract-domain-exceeds");
      expect(tail).not.toContain("-1 exceeds");
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

});


// ---------------------------------------------------------------------------
// health --watch 一轮只产出一份报告
// ---------------------------------------------------------------------------
describe("health --watch 一轮只产出一份报告", () => {
/**
 * `nudo health --watch <含 N 个文件的目录>`：**watch runner 把自己的
 * per-file 目标整个丢掉** ⇒ 每次都重跑整个路径集 ⇒ 首轮把完整报告打印
 * **N** 遍、`--json` 面 stdout 出 **N** 份完整 JSON 文档（JSON.parse 抛错）、
 * 分析工作量放大 N 倍。
 *
 * 钉：首轮**只**产生一份完整报告（Summary 行数 = 1，不是 N）；--json 面
 * stdout 里**只有一份** JSON 文档（可被 JSON.parse 解析）。
 */






let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-929-"));
  writeFileSync(join(dir, "a.js"), "export function a(x) {\n  return x;\n}\n");
  writeFileSync(join(dir, "b.js"), "export function b(x) {\n  return x * 2;\n}\n");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("人类面：首轮完整报告只打印 1 份（Summary 行数 = 1，不是文件数）", { timeout: 40_000 }, async () => {
    const r = await runWatchCli(["health", dir], { timeoutMs: 25_000 });
    const summaries = r.stdout.match(/^Summary:/gm) ?? [];
    expect(summaries.length, `stdout:\n${r.stdout}`).toBe(1);
    // 报告仍然覆盖整个目录（2 个文件都在报告里）
    expect(r.stdout).toContain("2 file(s)");
    expect(r.stdout).toContain("a.js");
    expect(r.stdout).toContain("b.js");
  });

  it("--json 面：stdout 只有一份 JSON 文档（JSON.parse 直接成功）", { timeout: 40_000 }, async () => {
    const r = await runWatchCli(["health", dir, "--json"], { timeoutMs: 25_000 });
    const docs = extractJsonDocs(r.stdout);
    expect(docs.length, `stdout:\n${r.stdout}`).toBe(1);
    const parsed = JSON.parse(docs[0]!) as {
      ok: boolean;
      files: Array<{ file: string }>;
      summary: { files: number };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.files.length).toBe(2);
    expect(parsed.summary.files).toBe(2);
  });

});


// ---------------------------------------------------------------------------
// health 必须与分析目标闸门同口径
// ---------------------------------------------------------------------------
describe("health 必须与分析目标闸门同口径", () => {
/**
 * `nudo health` **不设「分析目标」闸门** ⇒ 把 `.d.ts` / 侧车 / `.jsx`
 * 当成**已检查的源文件**并报「Result: OK」（exit 0），而 `nudo check` /
 * `nudo test` 对**同一路径** exit 1「Not an analysis target」⇒ 假绿 + 跨动词
 * 自相矛盾。
 *
 * 口径：health 的目标解析与 check / test **同口径**（`isNudoTargetPath` 闸门 +
 * 同款 pathNotTarget 错误：同样的 message / suggestion）。
 */






let dir: string;
const p = (f: string) => join(dir, f);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-947-"));
  writeFileSync(p("types.d.ts"), "export declare function g(x: number): number;\n");
  writeFileSync(p("sidecar.nudo.js"), "export const g = fn({ x: number() }, number());\n");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("文本面：.d.ts 目标 ⇒ exit 1 + Not an analysis target（不得 Result: OK）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("types.d.ts")]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stderr).toContain("Not an analysis target");
    expect(r.stderr).toContain("fix:");
  });

  it("侧车（*.nudo.js）同样不是分析目标 ⇒ 判红", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("sidecar.nudo.js")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not an analysis target");
  });

  it("--json 面：ok:false + pathErrors[0].code == nudo:path-not-target", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("types.d.ts")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: unknown[];
      pathErrors?: Array<{ code: string; message: string; suggestion: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.files).toEqual([]);
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-not-target");
    expect(parsed.pathErrors?.[0].suggestion).toContain(".js/.mjs/.ts");
  });

  it("跨动词同口径：check / test 对同一路径报同一款错误", { timeout: 60_000 }, () => {
    const check = runCliTsx(["check", p("types.d.ts")]);
    const health = runCliTsx(["health", p("types.d.ts")]);
    expect(check.status).toBe(1);
    expect(health.status).toBe(check.status);
    expect(health.stderr).toContain("Not an analysis target");
    expect(check.stderr).toContain("Not an analysis target");
  });

});


// ---------------------------------------------------------------------------
// 空目标集不得报「一切正常」
// ---------------------------------------------------------------------------
describe("空目标集不得报「一切正常」", () => {
/**
 * `nudo health --json` 在**空目标集**时给出 `"ok": true` + `"files": []`
 * + exit 0 ⇒ 机器消费者读到「一切正常」，而实际上**一个文件都没检查**（文本面
 * 仅一行「No files to check.」）。
 *
 * 口径：空目标集 = 「一个文件都没检查」⇒ 与 `nudo check` 同口径判红
 * （pathEmptyDir 错误 + ok:false + 非零 exit）。
 */






let dir: string;
let emptyDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-948-"));
  emptyDir = join(dir, "emptydir");
  mkdirSync(emptyDir);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("--json 面：ok:false + files:[] + 非零 exit", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", emptyDir]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: unknown[];
      pathErrors?: Array<{ code: string; message: string }>;
    };
    expect(parsed.files).toEqual([]);
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-empty-dir");
  });

  it("文本面：不得只给一行「No files to check.」——必须说清没检查任何文件并判红", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", emptyDir]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stderr).toContain("No nudo files found in directory");
  });

  it("跨动词同口径：nudo check 对同一空目录也判红", { timeout: 60_000 }, () => {
    const check = runCliTsx(["check", emptyDir]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("No nudo files found in directory");
  });

});


// ---------------------------------------------------------------------------
// uncovered 指标不得恒为 0
// ---------------------------------------------------------------------------
describe("uncovered 指标不得恒为 0", () => {
/**
 * `nudo health` 的 `uncovered` 指标**在结构上恒为 0**（过滤式恰好
 * 排除了文档定义的「entry fallback」那一类）⇒ 文档承诺的「uncovered ⇒
 * **Reported**, informational only」**永不成立**；机器面读出的 `"uncovered": 0`
 * 恒为假 ⇒ 消费者据此判断「全部函数都有覆盖」。
 *
 * 口径（guides/health.md:22）：uncovered = 「**无调用点证据**（回落 entry@）」的
 * 函数 ⇒ 必须被**报出来**（informational only：不判红，但必须可见）。
 */






let dir: string;
const p = (f: string) => join(dir, f);

/** 形态 1：导出函数、无调用点现场 ⇒ entry fallback ⇒ uncovered */
const NO_EVIDENCE = `export function a(x) {
  return x + 1;
}
`;

/** 形态 2：同文件内有调用点现场 ⇒ 该函数**有**调用点证据 ⇒ 不算 uncovered */
const WITH_EVIDENCE = `export function c(x) {
  return x + 1;
}
export function d() {
  return c(1);
}
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-949-"));
  writeFileSync(p("no-evidence.js"), NO_EVIDENCE);
  writeFileSync(p("with-evidence.js"), WITH_EVIDENCE);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("--json 面：无调用点证据的函数进 uncovered + summary.uncovered ≥ 1", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("no-evidence.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ uncovered: string[]; entryOnly: number }>;
      summary: { uncovered: number };
    };
    expect(parsed.files[0].uncovered).toContain("a");
    expect(parsed.summary.uncovered).toBeGreaterThanOrEqual(1);
    // informational only ⇒ 不判红
    expect(parsed.ok).toBe(true);
    expect(r.status).toBe(0);
  });

  it("文本面：uncovered 必须被报出来（informational only）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("no-evidence.js")]);
    // 必须是「逐个函数点名」的 uncovered 行（Summary 里的计数不算——它恒为 0）
    expect(r.stdout).toContain("uncovered (no call-site evidence): a");
    expect(r.stdout).toContain("Result: OK");
  });

  it("有调用点证据的函数不算 uncovered（指标不是恒真）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("with-evidence.js")]);
    const parsed = JSON.parse(r.stdout) as {
      files: Array<{ uncovered: string[] }>;
    };
    expect(parsed.files[0].uncovered).not.toContain("c");
  });

});


// ---------------------------------------------------------------------------
// watch 面的 JSON Lines 契约（早退分支也不打 pretty 文档）
// ---------------------------------------------------------------------------
describe("watch 面的 JSON Lines 契约（早退分支也不打 pretty 文档）", () => {
/**
 * `nudo check --json --watch <不存在的路径>` /
 * `nudo test --json --watch <不存在的路径>` 的**路径错误早退分支**仍打
 * **pretty 多行** JSON 文档 ⇒ 破坏 watch 面「stdout = JSON Lines（每行一份
 * 完整 JSON 文档，各自可 `JSON.parse`）」的契约。
 *
 * 症状：这两条早退分支位于 **watch 安装之前** ⇒ 命中后直接
 * `console.log(JSON.stringify(..., null, 2))` 落一份缩进多行文档并 return。
 * 逐行 `JSON.parse` 的机器消费者在**第一行**即抛 SyntaxError；且同一 flag
 * 组合的 stdout 形态**随路径是否可解析而变**（合法路径是 1 行 JSON Lines）。
 * 实测：check 29 行 / test 33 行，而同参数的 `health --json --watch` 只有 1 行。
 *
 * 修复：两条早退分支改用 `emitJsonDoc(doc, true)`（watch 面 = JSON Lines）
 * ⇒ 与 health / 每轮文档的口径一致。
 *
 * 负控：**非 watch 面**的单轮 stdout 仍是一份 pretty 文档（既有金标钉的形态）
 * ⇒ 本修复不得改动它。
 */







type Doc = {
  ok?: boolean;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
};

{
  const verbs = ["check", "test"] as const;

  for (const verb of verbs) {
    it(`CLI：${verb} --json --watch <不存在的路径> ⇒ stdout 是**一行**合法 JSON`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1085-"));
      try {
        const missing = join(dir, "no-such-file.js");
        const r = await runWatchCli([verb, missing, "--json"], {
          cwd: dir,
          timeoutMs: 20_000,
          // 早退分支不装 watch ⇒ 进程自己退出（等退出，不等横幅）
          waitFor: "exit",
        });
        expect(r.exited, `stderr:\n${r.stderr}`).toBe(true);
        expect(r.status).toBe(1);

        const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
        // 旧行为：pretty 多行文档（check 29 行 / test 33 行）
        expect(lines.length, `stdout:\n${r.stdout}`).toBe(1);
        // 每行各自是一份完整 JSON 文档（逐行可 parse）
        const doc = JSON.parse(lines[0]!) as Doc;
        // check 面的信封带 `ok:false`；test 面的 CaseJson 信封不带 `ok`（既有形状）
        if (doc.ok !== undefined) expect(doc.ok).toBe(false);
        expect(doc.pathErrors?.length ?? 0).toBeGreaterThan(0);
        expect(doc.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
        // stdout 保持纯机器面（横幅走 stderr）
        expect(r.stdout).not.toContain("Watching for changes");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);
  }

  it("口径对齐：health --json --watch <不存在的路径> 同样是一行（既有行为不回归）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1085-health-"));
    try {
      const missing = join(dir, "no-such-file.js");
      const r = await runWatchCli(["health", missing, "--json"], {
        cwd: dir,
        timeoutMs: 20_000,
        waitFor: "exit",
      });
      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length, `stdout:\n${r.stdout}`).toBe(1);
      expect(() => JSON.parse(lines[0]!)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("负控：非 watch 面（--json 无 --watch）仍是一份 pretty 文档（逐字不改）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1085-plain-"));
    try {
      const missing = join(dir, "no-such-file.js");
      for (const verb of ["check", "test"] as const) {
        const r = runCliTsx([verb, missing, "--json"], { cwd: dir });
        expect(r.status).toBe(1);
        // 非 watch 面 = 一份 pretty 文档（多行）
        expect(r.stdout.trimEnd().split("\n").length, `stdout:\n${r.stdout}`).toBeGreaterThan(1);
        expect(() => JSON.parse(r.stdout)).not.toThrow();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
});


// ---------------------------------------------------------------------------
// CLI：check 与 health 的 entry-only 口径一致
// ---------------------------------------------------------------------------
describe("CLI：check 与 health 的 entry-only 口径一致", () => {
/**
 * 回归（CLI 面）：`nudo:contract-entry-only` 在 **check** 面不可达
 * （分析器产出 info，但普通 check 路径不跑分析器 ⇒ 诊断被丢弃），而
 * `nudo health` 走另一条统计路径仍报「N entry-only」⇒ 同一事实两 verb
 * 口径分裂。
 *
 * 修法：普通 check 路径也跑分析器（白名单仍只有 contract 家族）⇒ 两个
 * verb 同一口径。**顺序要求**：分析器必须**先于** checkSource 跑（core 的
 * 侧车加载失败去重表按作用域共享；反序会让分析器误报「无契约根」）。
 *
 * 本文件锁：
 * ① 无契约根 + 无调用点域 ⇒ check 报 entry-only info，条数 == health 的
 * entry-only 计数（**本次修复的正面**）；
 * ② 同文件被调用的导出不算 entry-only（调用点域口径一致）；
 * ③ 有契约根（有侧车）的导出：check 不报「无契约根」info——但 health 的
 * entry-only 计数仍为 1（**两个口径本就不同的两个事实**，见下）。
 *
 * 关于 ③：health 的「entry-only」计数是**覆盖率**事实（该函数回落到了
 * entry@ 见证 = 没有调用点证据）；check 的 `nudo:contract-entry-only` 诊断是
 * **契约缺口**事实（没有契约根 **且** 没有调用点域，docs:
 * reference/diagnostics.md#nudo-contract-entry-only）。有契约根但无调用点
 * 时两者本就该不同（函数有契约，只是没被调用过）⇒ 不是 bug。真要对齐成
 * 同一个统计口径，需要改 service 的 `fn.entryOnly` 语义（越界，见报告）。
 */






/** 无契约根、无调用点域的导出 ⇒ entry-only */
const SOLO = `export function solo() {
  return 1;
}
`;

/** solo 被 same-file 的 other 调用 ⇒ 有调用点域 ⇒ 不是 entry-only */
const CALLED = `export function solo() {
  return 1;
}
export function other() {
  return solo();
}
`;

/** 有侧车契约根 ⇒ check 不报「无契约根」（health 的覆盖率计数仍为 1） */
const WITH_SIDECAR = `export function solo(x) {
  return x;
}
`;
const SIDECAR = `import { fn, number } from "@nudojs/core";

export const solo = fn({ x: number() }, number());
`;

function fixture(src: string, sidecar?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-461-cli-"));
  writeFileSync(join(dir, "probe.js"), src, "utf-8");
  if (sidecar !== undefined) writeFileSync(join(dir, "probe.nudo.js"), sidecar, "utf-8");
  return dir;
}

function checkEntryOnlyNames(dir: string): string[] {
  const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
  const json = JSON.parse(r.stdout) as {
    issues: { code: string; message: string }[];
  };
  return json.issues
    .filter((i) => i.code === "nudo:contract-entry-only")
    .map((i) => {
      const m = /export '([^']+)'/.exec(i.message);
      return m?.[1] ?? "?";
    });
}

function healthEntryOnly(dir: string): number {
  const r = runCli(["health", "probe.js"], { cwd: dir });
  const m = /(\d+) entry-only/.exec(r.stdout);
  return m ? Number(m[1]) : 0;
}


  it("无契约根的导出：check 报 entry-only info，条数 == health 的计数", () => {
    const dir = fixture(SOLO);
    try {
      const names = checkEntryOnlyNames(dir);
      expect(names).toEqual(["solo"]);
      expect(healthEntryOnly(dir)).toBe(1);
      expect(names.length).toBe(healthEntryOnly(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("同文件被调用的导出不算 entry-only（两 verb 同口径）", () => {
    const dir = fixture(CALLED);
    try {
      const names = checkEntryOnlyNames(dir);
      expect(names).toEqual(["other"]); // solo 有调用点域
      expect(healthEntryOnly(dir)).toBe(names.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("有侧车契约根 ⇒ check 不报「无契约根」（契约缺口事实不成立）", () => {
    const dir = fixture(WITH_SIDECAR, SIDECAR);
    try {
      const names = checkEntryOnlyNames(dir);
      expect(names).toEqual([]);
      // health 的 entry-only 计数是**覆盖率**事实（回落 entry@ 见证）——
      // 有契约但没被调用过时它仍是 1：两个口径本就不同的两个事实。
      expect(healthEntryOnly(dir)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("entry-only 是 info：不红门禁（exit 0）", () => {
    const dir = fixture(SOLO);
    try {
      const r = runCli(["check", "probe.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("nudo:contract-entry-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});


// ---------------------------------------------------------------------------
// --watch 不再被 --json 静默丢弃
// ---------------------------------------------------------------------------
describe("--watch 不再被 --json 静默丢弃", () => {
/**
 * `nudo check --watch --json` ⇒ **watch 从未启动**（--json 早退把它吞了）。
 *
 * 症状：--json 分支在 watch 安装之前就 return ⇒ 进程跑完 JSON 即退出，
 * 「Watching for changes...」永不出现、文件监听从未启动（用户以为在盯盘）。
 * 修复：两者**共存**——watch 每轮仍吐机器可读文档（每文件一份）。
 */






const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-645-"));
  const file = join(dir, "one.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file };
}

describe("-watch 不再被 --json 静默丢弃", () => {
  it("CLI：--watch --json ⇒ 监听真的启动（横幅出现 + 进程常驻 + stdout 仍是 CheckJson）", async () => {
    const { cwd, file } = makeProject();
    try {
      const r = await runWatchCli(["check", file, "--json"], {
        cwd,
        timeoutMs: 20_000,
        // 收尾条件 = 横幅出现 **且** stdout 里已有可解析的 JSON 文档
        // （两路管道到达顺序不定 ⇒ 只等横幅会偶发「文档还没到」的假失败）
        waitFor: (stdout, stderr) =>
          (stdout + stderr).includes("Watching for changes...") &&
          extractJsonDocs(stdout).length > 0,
      });
      // 旧症状：进程跑完 JSON 就退出 ⇒ 从来没有「Watching for changes...」
      expect(r.stdout + r.stderr).toContain("Watching for changes...");
      // watch 是常驻面 ⇒ 收尾标记出现时进程仍活着（status=null = 被测试杀掉）
      expect(r.status).toBeNull();
      // 机器面：stdout 仍是可解析的 CheckJson（单文件契约：裸 CheckJson）
      const docs = extractJsonDocs(r.stdout);
      expect(docs.length).toBeGreaterThan(0);
      const doc = JSON.parse(docs[0]!);
      expect(doc.version).toBe(1);
      expect(doc.kind).not.toBe("multi");
      expect(doc.ok).toBe(true);
      expect(doc.signatures[0].name).toBe("one");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 40_000);
});
});


// ---------------------------------------------------------------------------
// watch 面单文件分析失败必须置红（不得吞掉异常保持绿）
// ---------------------------------------------------------------------------
describe("watch 面单文件分析失败必须置红（不得吞掉异常保持绿）", () => {
/**
 * `nudo test --watch` 把**单文件分析失败整个吞掉** ⇒ 门禁**保持绿（exit 0）**；
 * 而**同一目录**的 `nudo check --watch` / `nudo health --watch` / 非 watch 的
 * `nudo test` **全部 exit 1** ⇒ **watch 面上唯一的假绿**（共享 watch 循环吞掉
 * `runOne` 抛出的异常，从不置红）。
 *
 * 修法（CLI 面，`packages/nudojs/src/commands/shared.ts` 的**共享** watch 循环
 * `startWatch`）：每文件的 catch **必须置红**（`process.exitCode = 1`）——
 * **全量轮与增量轮两处**都改；与同文件自陈的「退出码语义 = 最近一轮的门禁状态」
 * 一致。
 *
 * ⚠ **不中断整轮**：一个坏文件不该中止整轮（这是现在的行为，也是对的；
 * 错的只是「不置红」）——本文件同时锁住「坏文件不中止整轮」与
 * 「下一轮绿则退出码复位 0（不得引入粘滞红）」。
 *
 * 本钉直接驱动**共享** watch 循环（check / test / health 三个面走同一个
 * `startWatch`）——`runOne` 以 runCheck/runTest 同语义模拟：门禁红置 1、绿不置；
 * 分析失败（解析/装配失败）⇒ **抛异常**（旧实现只打一行 stderr 就吞掉）。
 */






const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** 坏文件：分析失败（模拟解析失败抛错） */
const BAD_SRC = `export function boom() {
  throw new TypeError("x");
}
`;
/** 好文件：分析通过 */
const GOOD_SRC = `export function id(x) {
  return x;
}
`;

/** 轮末横幅（startWatch 的 watchBanner ⇒ console.error） */
const ROUND_END = "Watching for changes...";

/** 装 console：抓横幅（轮末屏障）+ 静音 clear/log */
function installConsole(): { lines: string[]; rounds: () => number } {
  const lines: string[] = [];
  vi.spyOn(console, "clear").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  });
  return { lines, rounds: () => lines.filter((l) => l.includes(ROUND_END)).length };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});


  it("全量轮：坏文件分析失败 ⇒ exit 1（改前：吞掉异常 ⇒ exit 0 假绿）", async () => {
    const { rounds } = installConsole();
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-926-"));
    const bad = join(dir, "bad.js");
    writeFileSync(bad, BAD_SRC, "utf-8");
    writeFileSync(join(dir, "good.js"), GOOD_SRC, "utf-8");
    process.exitCode = undefined;

    const attempted: string[] = [];
    const close = startWatch(
      [dir],
      async (f) => {
        attempted.push(f);
        // 分析失败 ⇒ 抛（改前：watch 循环 catch 后只打 stderr ⇒ 保持绿）
        if (f.endsWith("bad.js")) throw new Error("parse failed: Unexpected token");
      },
      "test",
    );

    try {
      await waitUntil(() => rounds() >= 1);
      expect(attempted.some((f) => f.endsWith("bad.js"))).toBe(true);
      // 门禁必须红
      expect(process.exitCode).toBe(1);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

  it("全量轮：坏文件**不中止整轮**（后续文件仍被分析）", async () => {
    const { rounds } = installConsole();
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-926-"));
    writeFileSync(join(dir, "bad.js"), BAD_SRC, "utf-8");
    writeFileSync(join(dir, "good.js"), GOOD_SRC, "utf-8");
    process.exitCode = undefined;

    const attempted: string[] = [];
    const close = startWatch(
      [dir],
      async (f) => {
        attempted.push(f);
        if (f.endsWith("bad.js")) throw new Error("parse failed: Unexpected token");
      },
      "test",
    );

    try {
      await waitUntil(() => rounds() >= 1);
      expect(attempted.some((f) => f.endsWith("good.js"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

  it("增量轮：坏文件分析失败 ⇒ exit 1；改好后下一轮绿 ⇒ 复位 0（不粘滞红）", async () => {
    const { rounds } = installConsole();
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-926-"));
    const file = join(dir, "w.js");
    writeFileSync(file, GOOD_SRC, "utf-8");
    process.exitCode = undefined;

    let attempts = 0;
    const close = startWatch(
      [file],
      async (f) => {
        attempts++;
        if (readFileSync(f, "utf-8").includes("boom")) throw new Error("parse failed: Unexpected token");
      },
      "test",
    );

    try {
      // 首轮（绿）：退出码 0
      await waitUntil(() => rounds() >= 1);
      expect(attempts).toBeGreaterThanOrEqual(1);
      expect(process.exitCode).toBe(0);

      // 改坏 ⇒ 增量轮必须置红
      writeFileSync(file, BAD_SRC, "utf-8");
      await waitUntil(() => rounds() >= 2);
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(process.exitCode).toBe(1);

      // 改好 ⇒ 下一轮绿 ⇒ 复位 0（本次修复不得引入「粘滞红」）
      writeFileSync(file, GOOD_SRC, "utf-8");
      await waitUntil(() => rounds() >= 3);
      expect(process.exitCode).toBe(0);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
      process.exitCode = undefined;
    }
  });

});

// ---------------------------------------------------------------------------
// 源 vs 产物仲裁：`.cts → .cjs` 也是一条产物链
// ---------------------------------------------------------------------------
describe("目录目标集的 .cts / .cjs 仲裁", () => {
/** 产物索引此前只登记 `.js` / `.mjs`，`.cts` 又错用 `.js` 索引 ⇒
 * `.cts` + 无关 `boom.js` 时被静默丢弃（假绿）、`.cts` + 真正的 `boom.cjs`
 * 时两个都分析（计数翻倍）。期望：`.cts` 只看 `.cjs` 产物。
 */
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const mk = (): string => {
    const d = mkdtempSync(join(tmpdir(), "nudo-cts-arbitration-"));
    dirs.push(d);
    return d;
  };

  it(".cts + 真正的 .cjs 产物 ⇒ 只分析产物一次", () => {
    const d = mk();
    const src = join(d, "boom.cts");
    const prod = join(d, "boom.cjs");
    writeFileSync(src, `export function boom() { throw new Error("boom"); }\n`, "utf-8");
    writeFileSync(prod, `export function boom() { throw new Error("boom"); }\n`, "utf-8");
    expect(collectNudoFiles(d)).toEqual([prod]);
  });

  it(".cts + 无关的同 stem .js ⇒ 两个模块都进门禁（.cts 不得被压掉）", () => {
    const d = mk();
    const src = join(d, "boom.cts");
    const other = join(d, "boom.js");
    writeFileSync(src, `export function boom() { throw new Error("boom"); }\n`, "utf-8");
    writeFileSync(other, `export function unrelated() { return 1; }\n`, "utf-8");
    const files = collectNudoFiles(d);
    expect(files).toContain(src);
    expect(files).toContain(other);
  });

  it("对照：.ts + .js / .mts + .mjs 的产物胜出口径不变", () => {
    const d = mk();
    writeFileSync(join(d, "a.ts"), `export function a() { return 1; }\n`, "utf-8");
    writeFileSync(join(d, "a.js"), `export function a() { return 2; }\n`, "utf-8");
    writeFileSync(join(d, "b.mts"), `export function b() { return 1; }\n`, "utf-8");
    writeFileSync(join(d, "b.mjs"), `export function b() { return 2; }\n`, "utf-8");
    const files = collectNudoFiles(d);
    expect(files).toContain(join(d, "a.js"));
    expect(files).toContain(join(d, "b.mjs"));
    expect(files).not.toContain(join(d, "a.ts"));
    expect(files).not.toContain(join(d, "b.mts"));
  });
});
