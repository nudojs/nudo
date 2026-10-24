/**
 * 族 63 · nudojs CLI 协议面（W16）—— health 文本面量纲 / `pathErrors[]` 命名 /
 * watch 多轮 JSON 形态，三条精度债。
 *
 * 1. **health 文本面两处量纲不一**：Summary 的「N case drift」计**有漂移的文件数**，
 *    明细行计**见证条数** ⇒ 同一份报告里两个「N」量纲不同（用户读到的数自相矛盾）。
 *    修法：Summary 的数 = **见证（case）条数**（= Σ 明细行的条数）⇒ 标签
 *    「case drift」与数字终于同义；`--json` 的 `summary.drift` 同一量纲。
 * 2. **`pathErrors[]` 命名漂移**：C1 把「分析目标闸门」错误也推进了同一个 sink
 *    ⇒ 该数组名不再只表示「--from 路径错误」。
 *    修法：**`pathErrors[]` 字段名与内容逐字保留**（兼容既有机器消费者），
 *    **新增可选字段 `targetErrors[]`**（分析目标闸门错误的精确子集）⇒ 语义可见。
 * 3. **watch 多轮累积的 JSON 形态**：第 2 轮起 stdout 里会有第 2 份文档
 *    ⇒ 机器消费者 `JSON.parse(stdout)` 炸。
 *    修法：watch `--json` ⇒ **JSON Lines**（每行一份完整 JSON 文档）；
 *    **非 watch 的单轮输出逐字不变**（既有金标钉的形态）。
 *
 * 钉法：
 * - 文本面 / JSON 面：真跑 CLI（`runCliTsx`），断言**等式**（Summary 的数 ==
 *   Σ 明细行的条数）。
 * - watch 面：真起常驻进程（`runWatchCli`），**改文件触发第 2 轮** ⇒ stdout
 *   必须是**两行**，每行各自 `JSON.parse` 得通。
 * - 负控：**非 watch 的单轮 stdout 逐字不变**（用 `git archive HEAD` 抽出的
 *   改前输出做基线常量，逐字比对）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";
import { runWatchCli } from "./helpers/run-watch-cli.ts";

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

/**
 * 漂移 fixture：**一个**文件里有**两条**陈旧见证 ⇒
 * 「有漂移的文件数」= 1，「见证条数」= 2 ⇒ 两个量纲**可区分**（旧口径 Summary
 * 印 1、明细行印 2 ⇒ 自相矛盾）。
 */
const DRIFT_LIB = `/**
 * @nudo:case "call@L2" ("Hello")
 */
export function up(s) {
  return s.toUpperCase();
}

/**
 * @nudo:case "call@L3" ("Hello")
 */
export function down(s) {
  return s.toLowerCase();
}
`;

/** 使用现场：两个调用点（usage.js 第 2/3 行），实参与冻结见证不同 ⇒ 两条见证都陈旧 */
const DRIFT_USAGE = `import { up, down } from "./lib.js";
console.log(up("Goodbye"));
console.log(down("Goodbye"));
`;

/** 干净 fixture（无漂移）：负控的逐字基线 */
const CLEAN_LIB = `export function libFn(x) {
  return x + 1;
}
`;

/**
 * 改前（`git archive HEAD` 抽出改前 CLI 实跑）的**逐字**输出基线。
 * 负控：非 watch 的单轮 stdout 必须与它**逐字一致**。
 */
const CLEAN_JSON_BEFORE = `{
  "ok": true,
  "files": [
    {
      "file": "clean.js",
      "functions": 1,
      "entryOnly": 1,
      "uncovered": [
        "libFn"
      ],
      "budget": {
        "calls": 0,
        "maxCalls": 20000,
        "forks": 0,
        "maxForks": 5000,
        "callTruncated": false,
        "forkTruncated": false,
        "truncated": false,
        "evalCalls": 0,
        "maxEvalCalls": 20000,
        "evalCallTruncated": false,
        "cycleTruncated": false,
        "loopTruncated": false,
        "reasons": [],
        "callReasons": [],
        "depth": 0,
        "maxDepth": 64,
        "evalReasons": [],
        "evalDepth": 0,
        "maxEvalDepth": 64
      },
      "internal_fallbacks": 0
    }
  ],
  "summary": {
    "files": 1,
    "drift": 0,
    "interfaceDrift": 0,
    "errors": 0,
    "uncovered": 1,
    "internal_fallbacks": 0
  }
}
`;

const CLEAN_TEXT_BEFORE = `clean.js
  · 1 function(s), 1 entry-only
  ⚠ uncovered (no call-site evidence): libFn

Summary: 1 file(s) · 0 case drift · 0 contract drift · 0 error(s) · 1 uncovered function(s)
Result: OK (uncovered function(s) are informational only)
`;

let dir: string;
const p = (f: string) => join(dir, f);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-63-"));
  writeFileSync(p("lib.js"), DRIFT_LIB);
  writeFileSync(p("usage.js"), DRIFT_USAGE);
  writeFileSync(p("clean.js"), CLEAN_LIB);
  writeFileSync(p("types.d.ts"), "export declare function g(x: number): number;\n");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. health 文本面：Summary 与明细行同量纲
// ---------------------------------------------------------------------------

describe("族 63-1: health Summary 的漂移数与明细行同量纲（见证条数）", () => {
  it("文本面：Summary 的「N case drift」== Σ 明细行的「N witness directive(s) changed」", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("lib.js"), "--from", p("usage.js")]);
    expect(r.status).toBe(1);

    // 明细行：每个有漂移的文件一行「N witness directive(s) changed」
    const detail = [...r.stdout.matchAll(/(\d+) witness directive\(s\) changed/g)].map((m) =>
      Number(m[1]),
    );
    expect(detail.length, `stdout:\n${r.stdout}`).toBe(1);
    expect(detail[0]).toBe(2);

    // Summary：同一个数（同一量纲）
    const summary = /Summary: .*?· (\d+) case drift/.exec(r.stdout);
    expect(summary, `stdout:\n${r.stdout}`).not.toBeNull();
    const summaryDrift = Number(summary![1]);

    // 等式：Summary 的数 == 明细行的数之和
    expect(summaryDrift).toBe(detail.reduce((a, b) => a + b, 0));
    // 且它**不是**「有漂移的文件数」（= 1）⇒ 旧口径（文件数）会被本钉抓住
    expect(summaryDrift).toBe(2);
    expect(summaryDrift).not.toBe(1);
  });

  it("--json 面：summary.drift 与 Σ files[].drift 同量纲（同为见证条数）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("lib.js"), "--from", p("usage.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ drift?: { added: number; removed: number } }>;
      summary: { drift: number; files: number };
    };
    expect(parsed.ok).toBe(false);
    // 只有一个文件，但漂移的是**两条**见证 ⇒ 两个量纲可区分
    expect(parsed.files.length).toBe(1);
    const cases = parsed.files.reduce(
      (n, f) => n + (f.drift ? f.drift.added + f.drift.removed : 0),
      0,
    );
    expect(cases).toBe(2);
    // summary.drift 与每文件 drift 之和**同量纲**（旧口径是文件数 = 1）
    expect(parsed.summary.drift).toBe(cases);
    expect(parsed.summary.drift).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. pathErrors[] 命名漂移：字段逐字保留 + 新增语义可见的 targetErrors[]
// ---------------------------------------------------------------------------

describe("族 63-2: pathErrors[] 逐字保留 + targetErrors[] 让语义可见", () => {
  it("分析目标闸门错误：pathErrors[] 原样保留 + targetErrors[] 精确可见", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("types.d.ts")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: Array<{ path: string; code: string; message: string; suggestion: string }>;
      targetErrors?: Array<{ path: string; code: string; message: string; suggestion: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);

    // 既有字段**逐字不变**：名字、条数、码、message/suggestion 形状
    expect(Object.keys(parsed)).toContain("pathErrors");
    expect(parsed.pathErrors?.length).toBe(1);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-not-target");
    expect(parsed.pathErrors?.[0].suggestion).toContain(".js/.mjs/.ts");

    // 新增字段：同一批「分析目标闸门」错误的**精确**入口（不丢事实）
    expect(parsed.targetErrors?.length).toBe(1);
    expect(parsed.targetErrors?.[0].code).toBe("nudo:path-not-target");
    expect(parsed.targetErrors?.[0].message).toBe(parsed.pathErrors?.[0].message);
  });

  it("--from 路径错误：仍在 pathErrors[] 里，但**不**冒充分析目标闸门错误", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("clean.js"), "--from", p("no-such-usage.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: Array<{ code: string; message: string }>;
      targetErrors?: Array<{ code: string; message: string }>;
    };
    expect(parsed.ok).toBe(false);
    // --from 路径错误照旧在 pathErrors[]（既有消费者零影响）
    expect(parsed.pathErrors?.length).toBe(1);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-missing-callsite");
    // 但它**不是**分析目标闸门错误 ⇒ 新字段不得把它收进去（语义精确，不是副本）
    expect(parsed.targetErrors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. watch 多轮 JSON：JSON Lines（每行一份完整 JSON 文档）
// ---------------------------------------------------------------------------

describe("族 63-3: watch --json ⇒ JSON Lines（多轮累积不再炸 JSON.parse）", () => {
  it("health --watch --json：两轮 ⇒ stdout 两行，每行各自 JSON.parse 得通", { timeout: 60_000 }, async () => {
    const watchDir = mkdtempSync(join(tmpdir(), "nudo-bug-63-watch-"));
    const file = join(watchDir, "w.js");
    writeFileSync(file, "export function w(x) {\n  return x;\n}\n");
    try {
      let touched = false;
      const r = await runWatchCli(["health", watchDir, "--json"], {
        cwd: watchDir,
        timeoutMs: 40_000,
        // 见到第 1 份文档 ⇒ 改文件触发第 2 轮；见到第 2 份文档 ⇒ 收尾
        waitFor: (stdout) => {
          const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
          if (!touched && lines.length >= 1) {
            touched = true;
            // 多一个函数 ⇒ 第 2 轮的报告可与第 1 轮区分开
            writeFileSync(
              file,
              "export function w(x) {\n  return x;\n}\nexport function w2(x) {\n  return x + 1;\n}\n",
            );
          }
          return lines.length >= 2;
        },
      });

      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      // 两轮 ⇒ **两行**（旧行为：第 2 份文档是 pretty 多行 ⇒ 整份 JSON.parse 炸）
      expect(lines.length, `stdout:\n${r.stdout}`).toBe(2);
      // 每行**各自**是一份完整 JSON 文档
      const docs = lines.map((l) => JSON.parse(l) as { files: Array<{ functions: number }> });
      expect(docs.length).toBe(2);
      expect(docs[0].files[0].functions).toBe(1);
      expect(docs[1].files[0].functions).toBe(2);
      // 整份 stdout 仍**不可** JSON.parse（多文档流）⇒ 消费者必须逐行读
      expect(() => JSON.parse(r.stdout)).toThrow();
      // watch 横幅继续走 stderr（stdout 保持纯机器面）
      expect(r.stdout).not.toContain("Watching for changes");
      expect(r.stderr).toContain("Watching for changes");
    } finally {
      rmSync(watchDir, { recursive: true, force: true });
    }
  });

  it("test --watch --json：同一套 JSON Lines 契约（两轮 ⇒ 两行）", { timeout: 60_000 }, async () => {
    const watchDir = mkdtempSync(join(tmpdir(), "nudo-bug-63-watch-test-"));
    const file = join(watchDir, "w.js");
    writeFileSync(file, "export function w(x) {\n  return x;\n}\n");
    try {
      let touched = false;
      const r = await runWatchCli(["test", file, "--json"], {
        cwd: watchDir,
        timeoutMs: 40_000,
        waitFor: (stdout) => {
          const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
          if (!touched && lines.length >= 1) {
            touched = true;
            writeFileSync(
              file,
              "export function w(x) {\n  return x;\n}\nexport function w2(x) {\n  return x + 1;\n}\n",
            );
          }
          return lines.length >= 2;
        },
      });

      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length, `stdout:\n${r.stdout}`).toBe(2);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(r.stdout).not.toContain("Watching for changes");
      expect(r.stderr).toContain("Watching for changes");
    } finally {
      rmSync(watchDir, { recursive: true, force: true });
    }
  });
  it("check --watch --json：同一套 JSON Lines 契约（两轮 ⇒ 两行）", { timeout: 60_000 }, async () => {
    const watchDir = mkdtempSync(join(tmpdir(), "nudo-bug-63-watch-check-"));
    const file = join(watchDir, "w.js");
    writeFileSync(file, "export function w(x) {\n  return x;\n}\n");
    try {
      let touched = false;
      const r = await runWatchCli(["check", file, "--json"], {
        cwd: watchDir,
        timeoutMs: 40_000,
        waitFor: (stdout) => {
          const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
          if (!touched && lines.length >= 1) {
            touched = true;
            writeFileSync(
              file,
              "export function w(x) {\n  return x;\n}\nexport function w2(x) {\n  return x + 1;\n}\n",
            );
          }
          return lines.length >= 2;
        },
      });

      const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length, `stdout:\n${r.stdout}`).toBe(2);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(r.stdout).not.toContain("Watching for changes");
      expect(r.stderr).toContain("Watching for changes");
    } finally {
      rmSync(watchDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 负控：非 watch 的单轮 stdout 逐字不变
// ---------------------------------------------------------------------------

describe("族 63 负控: 非 watch 的单轮 stdout 逐字不变", () => {
  it("--json 面：仍是**一份** pretty 文档（逐字等于改前基线）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", "clean.js"], { cwd: dir });
    expect(r.status).toBe(0);
    // 逐字比对（不是形状比对）
    expect(r.stdout).toBe(CLEAN_JSON_BEFORE);
    // 非 watch 面**不是** JSON Lines（仍是一份 pretty 文档）
    expect(r.stdout.trimEnd().split("\n").length).toBeGreaterThan(1);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it("文本面：仍是改前那份报告（逐字等于改前基线）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "clean.js"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(CLEAN_TEXT_BEFORE);
  });
});
