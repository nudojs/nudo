/**
 * 模块套件：cli-io-export-out-and-contract-json（CLI e2e 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, realpathSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { repoRoot, runCliTsx as runCli } from "./helpers/run-cli.ts";
import { spawnSync } from "node:child_process";
import { type PathError } from "@nudojs/service";
import { collectNudoFiles } from "../commands/shared.ts";
import { abs } from "@nudojs/core";
import { runContractDraft } from "../commands/contract-draft.ts";
import { parseWhatIfBindings } from "../check-gate-config.ts";


// ---------------------------------------------------------------------------
// export — async 返回约束的 Promise 保形（族 17 · S1 · ）
// ---------------------------------------------------------------------------
describe("export — async 返回约束的 Promise 保形（族 17 · S1 · ）", () => {
/**
 * async 函数的**返回约束被当成整个返回类型** ⇒ `Promise<…>` 包装丢失。
 *
 * 症状（改前）：`@nudo:contract return num` 的 async 函数，zod 面产出
 * `fOutput = z.number()…`（**不是** Promise）、dts 面产出
 * `export declare function f(x: number): number;`
 * ⇒ 产物说「返回 number」，实现返回的是 `Promise<number>` ⇒ 校验器会把合法
 * 返回值判非法（运行时校验器拿到的是 Promise）。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一返回面直接投影契约返回
 * Abs，没有按观测返回的 `eff/promise` 形态保形。
 *
 * 修法（族 17 · S1）：观测返回是 `promise<…>` 时，契约返回描述的是 **await 后**
 * 的值 ⇒ 返回面用 `wrapPromise` 包住契约返回（三个产物面同口径）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-618-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 侧车约束：number 的纯数据形态 */
const NUM = `export const num = { __nudoConstraint: true, prim: "number", preds: [] };\n`;


  it("zod 返回面保留 promise 包装；dts 面返回类型是 Promise<number>（不是 number）", () => {
  {
    const dir = fixture({
      "c618.nudo.js": NUM,
      "async618.js": [
        `/// @nudo:import { num } from "./c618.nudo.js"`,
        `/** @nudo:contract return num */`,
        `export async function f(x) { return x + 1; }`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCli(["export", join(dir, "async618.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.promise(");
  }
  {
    const dir = fixture({
      "c618b.nudo.js": NUM,
      "async618b.js": [
        `/// @nudo:import { num } from "./c618b.nudo.js"`,
        `/** @nudo:contract return num */`,
        `export async function f(x) { return x + 1; }`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCli(["export", join(dir, "async618b.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(x: number): Promise<number>;");
  }
});


});


// ---------------------------------------------------------------------------
// nudo export --out · 同 stem 模块产物不互相覆盖
// ---------------------------------------------------------------------------
describe("nudo export --out · 同 stem 模块产物不互相覆盖", () => {
/**
 * `nudo export --out` 的 dts / zod / guard 三面按源文件 **stem** 命名
 * ⇒ 不同目录下的同名模块映射到同一批产物路径 ⇒ 后写覆盖先写（先导出的那份
 * 无声丢失）⇒ 消费方拿到别的模块的声明。
 *
 * 钉：两个不同目录下的同名模块导出到同一个 out 目录 ⇒ 两份产物都在，
 * 先导出的那份内容不被覆盖。
 */







  it("两个目录下的同名模块 ⇒ 两份 .d.ts 都在（先导出的不被覆盖）；同 stem 模块 ⇒ zod / guard 面同样不互相覆盖", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-622-"));
    const a = join(dir, "a");
    const b = join(dir, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const aFile = join(a, "lib.js");
    const bFile = join(b, "lib.js");
    writeFileSync(aFile, "export function alphaOnly(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(bFile, "export function betaOnly(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });

    const r1 = runCli(["export", aFile, "--format", "all", "--out", out]);
    expect(r1.status).toBe(0);
    const dtsFiles = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    expect(dtsFiles).toHaveLength(1);
    const firstBody = readFileSync(join(out, dtsFiles[0]!), "utf-8");
    expect(firstBody).toContain("alphaOnly");

    const r2 = runCli(["export", bFile, "--format", "all", "--out", out]);
    expect(r2.status).toBe(0);
    const dtsAfter = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    // 两份都在 ⇒ 没有互相覆盖
    expect(dtsAfter).toHaveLength(2);
    // 先导出的那份内容不变（仍是 a 模块的声明）
    expect(readFileSync(join(out, dtsFiles[0]!), "utf-8")).toBe(firstBody);
    // 另一份是 b 模块的声明
    const other = dtsAfter.find((f) => f !== dtsFiles[0]!)!;
    expect(readFileSync(join(out, other), "utf-8")).toContain("betaOnly");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-622b-"));
    const a = join(dir, "a");
    const b = join(dir, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const aFile = join(a, "lib.js");
    const bFile = join(b, "lib.js");
    writeFileSync(aFile, "export function alphaOnly(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(bFile, "export function betaOnly(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });

    runCli(["export", aFile, "--format", "all", "--out", out]);
    const guardFirst = readdirSync(out).filter((f) => f.endsWith(".nudo.guard.ts"));
    expect(guardFirst).toHaveLength(1);
    const body = readFileSync(join(out, guardFirst[0]!), "utf-8");

    runCli(["export", bFile, "--format", "all", "--out", out]);
    const guardAfter = readdirSync(out).filter((f) => f.endsWith(".nudo.guard.ts"));
    expect(guardAfter).toHaveLength(2);
    expect(readFileSync(join(out, guardFirst[0]!), "utf-8")).toBe(body);
  }
}); // 2 个顺序 CLI 子进程（tsx 冷启动）

   // 2 个顺序 CLI 子进程

});


// ---------------------------------------------------------------------------
// nudo export --out · 同名函数的产物不互相覆盖
// ---------------------------------------------------------------------------
describe("nudo export --out · 同名函数的产物不互相覆盖", () => {
/**
 * 产物面把「函数名 → 校验器」建成**以函数名为键**的映射 ⇒ 同名
 * 函数后者覆盖前者；standard 面则把**同一个文件写两次**（后者静默覆盖前者，
 * CLI 零告警）。
 *
 * 钉（写盘面）：同一个类里两个同名方法 ⇒ standard 产物**两份都在**
 * （`C.m.nudo.standard.ts` + `C.m.2.nudo.standard.ts`），先写的那份不被覆盖。
 */






const DUP = `export class C {
  /**
   * @nudo:case "m1" (1) => 2
   */
  m(a) { return a + 1; }
  /**
   * @nudo:case "m2" (3) => 4
   */
  m(b) { return b + 2; }
}
`;


  it("同一文件里两个同名方法 ⇒ 两份 standard 产物都在", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-623-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, DUP, "utf-8");
    const out = join(dir, "out");

    const r = runCli(["export", file, "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    const files = readdirSync(out).filter((f) => f.endsWith(".nudo.standard.ts"));
    // 两个同名方法 ⇒ 两份产物（不是同一个文件写两次）
    expect(files).toHaveLength(2);
    expect(files).toContain("C.m.nudo.standard.ts");
    // 两份内容不同（各带自己那条 case 的见证）
    const bodies = files.map((f) => readFileSync(join(out, f), "utf-8"));
    expect(bodies[0]).not.toBe(bodies[1]);
    // 两行 wrote ⇒ 两个不同路径（不是同一路径写两次）
    const wrote = r.stdout.split("\n").filter((l) => l.startsWith("wrote "));
    expect(wrote).toHaveLength(2);
    expect(new Set(wrote).size).toBe(2);
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

});


// ---------------------------------------------------------------------------
// nudo export --out · 写失败提示可执行
// ---------------------------------------------------------------------------
describe("nudo export --out · 写失败提示可执行", () => {
/**
 * `nudo export --out` 写失败的 `fix:` 提示硬编码成 **不存在的**
 * `check --out` ⇒ 用户照做只会再吃一个 `unknown option '--out'`。
 *
 * 钉：写失败的提示指向**本命令**且可执行（不含 `check --out`）。
 */







  it("--out 指向已有文件 ⇒ 提示不再指向不存在的 check --out；目标路径是目录 ⇒ 写失败提示点名该文件且指向本命令（EISDIR 走写失败通道）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-624-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function scale(x) {\n  return x + 1;\n}\n", "utf-8");
    const notDir = join(dir, "notadir");
    writeFileSync(notDir, "not a directory\n", "utf-8");

    const r = runCli(["export", file, "--format", "dts", "--out", notDir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("export --out mkdir failed");
    expect(r.stderr).toContain("fix:");
    // 提示里不得出现不存在的 `check --out`
    expect(r.stderr).not.toContain("check --out");
    // 提示指向本命令的 --out（可执行）
    expect(r.stderr).toContain("export --out");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-624b-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function scale(x) {\n  return x + 1;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    // 目标路径是目录 ⇒ readFileSync EISDIR。目录不可能被 writeFileSync
    // 覆盖（无绕过「拒绝覆盖」守卫的风险）⇒ 照常走写入，由**写失败通道**
    // 点名该文件并给可执行 fix:（与 的回放语义同一通道）。
    // （EACCES/EIO 等真读不出 ⇒ refuse 分支；refuse 文案由
    // 「可读手写文件」钉住。）
    mkdirSync(join(out, "lib.d.ts"), { recursive: true });

    const r = runCli(["export", file, "--format", "dts", "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("export --out write failed");
    expect(r.stderr).toContain("lib.d.ts");
    expect(r.stderr).toContain("fix:");
    expect(r.stderr).not.toContain("check --out");
    // 提示指向本命令的 --out（可执行）
    expect(r.stderr).toContain("export --out");
  }
}); // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程

});


// ---------------------------------------------------------------------------
// 族 63b-1: check --json
// ---------------------------------------------------------------------------
describe("b-1: check --json", () => {
/**
 * 族 63b · nudojs `pathErrors[]` 口径一致性（**check / test / contract**）。
 *
 * **根因**：`pathErrors[]` 这个名字原本只承诺「`--from` 路径错误」，但 C1 把
 * 「**分析目标闸门**」错误（路径不存在 / 空目录 / 非分析目标）也推进了**同一个**
 * sink ⇒ 数组名不再副实 ⇒ **机器消费者**读 `pathErrors[]` 时会误以为里面
 * 全是 `--from` 路径问题。
 *
 * **口径**（与 health 面（W16）**同款**，三个动词统一）：
 * - `pathErrors[]`：**有序全集**，**字段名 + 内容 + 顺序逐字不变**
 * （既有机器消费者零影响）；
 * - `targetErrors[]`：**新增的可选** JSON 字段 = **分析目标闸门**错误的
 * **精确**子集
 * - `--from` 路径错误**不**进它（它是**精确入口**，不是副本）；
 * - 闸门错误**同时**留在 `pathErrors[]` 里（全集不变 ⇒ 不丢事实）；
 * - **无**闸门错误 ⇒ `targetErrors[]` **不出现**（既有场景 stdout 逐字不变）。
 *
 * **钉法**（真跑 CLI，`runCliTsx`）：
 * - 闸门错误场景：`pathErrors[]` 与**改前**逐字一致（名字 / 条数 / 码 /
 * `suggestion` / 顺序）+ `targetErrors[]` **精确**只装闸门错误；
 * - `--from` 路径错误：**不**进 `targetErrors[]`；
 * - 无闸门错误：`targetErrors[]` 不出现 + stdout 与**改前基线逐字一致**
 * （负控；基线 = 改前实跑抓的常量）。
 */







// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

/** 干净的分析目标（负控 / `--from` 场景的被检查文件） */
const CLEAN_SRC = `export function id(x) {
  return x;
}
`;

/** **非**分析目标（`.d.ts` 声明文件）⇒ 触发「分析目标闸门」错误 */
const DECL_SRC = `export declare function g(x: number): number;
`;

let dir: string;
const p = (f: string): string => join(dir, f);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-63b-"));
  writeFileSync(p("clean.js"), CLEAN_SRC);
  writeFileSync(p("types.d.ts"), DECL_SRC);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** fixture 目录绝对路径 → `<DIR>`（跨机器稳定；同 cli-e2e-golden 的 normalize） */
function normalize(text: string): string {
  const real = realpathSync(dir);
  return text.split(real).join("<DIR>").split(dir).join("<DIR>");
}

/** `--json` 面的路径错误条目形状 */
type PathErr = { path: string; code: string; message: string; suggestion?: string };

/**
 * 「分析目标闸门」错误条目（`nudo:path-not-target`）——**改前**的既有内容
 * （逐字钉住：`pathErrors[]` 的名字 / 条数 / 码 / `suggestion` / 顺序）。
 */
function gateEntry(abs: string): PathErr {
  return {
    path: abs,
    code: "nudo:path-not-target",
    message: `Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): ${abs}`,
    suggestion:
      "pass a .js/.mjs/.ts analysis file (not .nudo.js sidecars, .d.ts decls, or .jsx/.tsx)",
  };
}

/** `--from` 路径错误条目（`nudo:path-missing-callsite`） */
function fromEntry(abs: string): PathErr {
  return {
    path: abs,
    code: "nudo:path-missing-callsite",
    message: `Callsite file not found: ${abs}`,
    suggestion:
      "pass --from <file-or-dir> that exists; it supplies call@ records for generation",
  };
}

// ---------------------------------------------------------------------------
// 改前（HEAD 实跑抓的）逐字基线 —— 负控用
// ---------------------------------------------------------------------------

const CHECK_CLEAN_JSON_BEFORE = `{
  "version": 1,
  "file": "<DIR>/clean.js",
  "ok": true,
  "summary": {
    "errors": 0,
    "warnings": 0,
    "infos": 1,
    "functions": 1
  },
  "signatures": [
    {
      "name": "id",
      "params": [
        "x"
      ],
      "paramTypes": [
        "any"
      ],
      "display": "any",
      "detail": "id\\n  any\\n  term: A1\\n  conf: path",
      "conf": "path",
      "abs": "any  = A1  #path",
      "entry": true
    }
  ],
  "issues": [
    {
      "severity": "info",
      "code": "nudo:contract-entry-only",
      "message": "export 'id' has no contract root and no call-site domain (entry-only)",
      "line": 1,
      "column": 7
    }
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
  }
}
`;

const TEST_CLEAN_JSON_BEFORE = `{
  "version": 1,
  "file": "<DIR>/clean.js",
  "summary": {
    "functions": 1,
    "externalFunctions": 0,
    "cases": 1,
    "diagnostics": 1,
    "errors": 0
  },
  "functions": [
    {
      "name": "id",
      "loc": {
        "start": {
          "line": 1,
          "column": 7
        },
        "end": {
          "line": 3,
          "column": 1
        }
      },
      "entryOnly": true,
      "cases": [
        {
          "name": "entry@L1",
          "args": [
            "any"
          ],
          "result": "any",
          "throws": null,
          "source": null,
          "argsAbs": [
            "any  #path"
          ],
          "resultAbs": "any  #path",
          "intension": {
            "display": "id: (x: A1) => A1",
            "abs": "any  #path",
            "absMultiline": "id\\n  any\\n  conf: path",
            "term": "A1",
            "conf": "path"
          }
        }
      ],
      "combined": "any",
      "combinedAbs": "any  #path"
    }
  ],
  "diagnostics": [
    {
      "range": {
        "start": {
          "line": 1,
          "column": 7
        },
        "end": {
          "line": 1,
          "column": 7
        }
      },
      "severity": "info",
      "message": "export 'id' has no contract root and no call-site domain (entry-only)",
      "code": "nudo:contract-entry-only"
    }
  ],
  "assertions": {
    "passed": 0,
    "failed": 0,
    "unchecked": 0
  },
  "ok": true
}
`;

const CONTRACT_CLEAN_JSON_BEFORE = `[
  {
    "file": "clean.js",
    "entries": [
      {
        "fn": "id",
        "signature": "  id  [implicit]  (x: any) → any"
      }
    ]
  }
]
`;

const GATE_TEXT_BEFORE = `Not an analysis target (need .js/.mjs/.ts, not sidecar/decl/JSX): <DIR>/types.d.ts
fix:  pass a .js/.mjs/.ts analysis file (not .nudo.js sidecars, .d.ts decls, or .jsx/.tsx)
`;


// ---------------------------------------------------------------------------
// 1. check —— pathErrors[] 逐字不变 + targetErrors[] 精确可见
// ---------------------------------------------------------------------------


  it("分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误；--from 路径错误**不**进 targetErrors[]（它是精确入口，不是副本）；闸门错误 + `--from` 错误并存：pathErrors[] 全集（顺序不变）+ targetErrors[] 只装闸门", () => {
  {
    const r = runCli(["check", "--json", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    expect(parsed.ok).toBe(false);

    // 既有字段**逐字不变**：名字 / 条数 / 码 / suggestion / 顺序
    expect(Object.keys(parsed)).toContain("pathErrors");
    expect(parsed.pathErrors).toEqual([gateEntry(p("types.d.ts"))]);

    // 新增字段：**精确**子集（逐字同形，不是一份副本）
    expect(parsed.targetErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(parsed.targetErrors).toHaveLength(1);
  }
  {
    const r = runCli(
      ["check", "--json", p("clean.js"), "--from", p("no-such-from.js")],
      { cwd: dir },
    );
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    // `--from` 路径错误照旧在 pathErrors[]（既有消费者零影响）
    expect(parsed.pathErrors).toEqual([fromEntry(p("no-such-from.js"))]);
    // 但它**不是**分析目标闸门错误 ⇒ 新字段不得把它收进去
    expect(parsed.targetErrors).toBeUndefined();
  }
  {
    const r = runCli(
      ["check", "--json", p("types.d.ts"), "--from", p("no-such-from.js")],
      { cwd: dir },
    );
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    // 全集：闸门在前、`--from` 在后（顺序逐字不变）
    expect(parsed.pathErrors).toEqual([
      gateEntry(p("types.d.ts")),
      fromEntry(p("no-such-from.js")),
    ]);
    // 精确子集：只有闸门那一条
    expect(parsed.targetErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(
      parsed.targetErrors?.some((e) => e.code === "nudo:path-missing-callsite"),
    ).toBe(false);
  }
});




// ---------------------------------------------------------------------------
// 2. test —— 同一套口径
// ---------------------------------------------------------------------------

describe("b-2: test --json", () => {
  it("分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误；--from 路径错误**不**进 targetErrors[]", () => {
  {
    const r = runCli(["test", "--json", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    expect(parsed.pathErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(parsed.targetErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(parsed.targetErrors).toHaveLength(1);
  }
  {
    const r = runCli(
      ["test", "--json", p("clean.js"), "--from", p("no-such-from.js")],
      { cwd: dir },
    );
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    expect(parsed.pathErrors).toEqual([fromEntry(p("no-such-from.js"))]);
    expect(parsed.targetErrors).toBeUndefined();
  }
});

});

// ---------------------------------------------------------------------------
// 3. contract —— 同一套口径
// ---------------------------------------------------------------------------

describe("b-3: contract --json", () => {
  it("分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误；--from 路径错误**不**进 targetErrors[]", () => {
  {
    const r = runCli(["contract", "--json", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as Array<{
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    }>;
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(errDocs[0].targetErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(errDocs[0].targetErrors).toHaveLength(1);
  }
  {
    const r = runCli(
      ["contract", "--json", p("clean.js"), "--from", p("no-such-from.js")],
      { cwd: dir },
    );
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as Array<{
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    }>;
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors).toEqual([fromEntry(p("no-such-from.js"))]);
    expect(errDocs[0].targetErrors).toBeUndefined();
  }
});

});

// ---------------------------------------------------------------------------
// 4. 负控：无闸门错误 ⇒ targetErrors[] 不出现 + stdout 逐字不变
// ---------------------------------------------------------------------------

describe("b 负控: 无闸门错误时输出逐字不变（既有场景零影响）", () => {
  it("check --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors；test --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors；contract --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors；人类面（闸门错误）：stderr 文案与改前逐字一致（机器面改动不外溢）", () => {
  {
    const r = runCli(["check", "--json", p("clean.js")], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout)).toBe(CHECK_CLEAN_JSON_BEFORE);
    expect(r.stdout).not.toContain("targetErrors");
  }
  {
    const r = runCli(["test", "--json", p("clean.js")], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout)).toBe(TEST_CLEAN_JSON_BEFORE);
    expect(r.stdout).not.toContain("targetErrors");
  }
  {
    const r = runCli(["contract", "--json", p("clean.js")], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout)).toBe(CONTRACT_CLEAN_JSON_BEFORE);
    expect(r.stdout).not.toContain("targetErrors");
  }
  {
    const r = runCli(["check", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(normalize(r.stderr)).toBe(GATE_TEXT_BEFORE);
  }
});



});
});


// ---------------------------------------------------------------------------
// test 面语法错：人类面 tsc 风格块 + --json 面 pathErrors
// ---------------------------------------------------------------------------
describe("test 面语法错：人类面 tsc 风格块 + --json 面 pathErrors", () => {
/**
 * `nudo test` 遇解析失败 ⇒ **裸 message、无文件名**；`--json` 面
 * stdout **0 字节**（而 `nudo check` 对同一文件有 tsc 风格块 +
 * `pathErrors[{code:"syntax-error"}]` 信封）。
 *
 * 旧行为：Babel 解析异常上浮到顶层 catch ⇒ stderr 只有一行
 * `Unexpected keyword 'return'. (2:2)`（**没有文件名**、没有行:列、没有
 * 源码摘录），`--json` 面的序列化点排在异常之后 ⇒ stdout 一个字节都没有
 * ⇒ 机器面 `JSON.parse(stdout)` 直接炸。
 *
 * 修复：`runTest` 复用 check 面的语法错分支（`check-report.ts` 的
 * `syntaxErrorInfo` / `formatSyntaxErrorBlock`）——人类面给 tsc 风格块
 * （路径 + 行:列 + 摘录 + `^` 指位），`--json` 面并入
 * `pathErrors[{code:"syntax-error"}]`（同一条 CaseJson 失败信封）。
 *
 * ⚠ 错误**文案随夹具变**（Babel 版本 / 夹具不同 ⇒ 措辞不同）⇒ 本钉只钉
 * **形状**（有文件名 / 有 `path:line:col` / `--json` 有 body + 机器码），
 * 不断言文案字面量。
 */






const SYNTAX_ERROR_SRC = `export function broken( {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-650-"));
  const file = join(cwd, "syn.js");
  writeFileSync(file, SYNTAX_ERROR_SRC, "utf-8");
  return { cwd, file };
}


  it("人类面：文件名 + 行:列 + 摘录 + ^ 指位（不再是无路径的裸 message）；--json 面：stdout 是 CaseJson 失败信封（pathErrors[{code:\"syntax-error\"}]）+ exit 1；对照面：nudo check 对同一文件给同码 pathErrors（两个 verb 机器面同形）", () => {
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(1);
      // 形状：<file>:<line>:<col> — syntax error: <本质信息>
      expect(r.stderr).toMatch(/syn\.js:\d+:\d+ — syntax error: /);
      // 源码摘录 + 指位
      expect(r.stderr).toContain("return 1;");
      expect(r.stderr).toMatch(/\n\s*\^\s*$/m);
      // 旧症状：stderr 只有一个不带文件名的裸 message
      expect(r.stderr).not.toMatch(/^Unexpected .*$/m);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--json"], { cwd });
      expect(r.status).toBe(1);
      // 旧症状：stdout 0 字节 ⇒ JSON.parse 炸
      expect(r.stdout.trim().length).toBeGreaterThan(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.version).toBe(1);
      expect(Array.isArray(doc.pathErrors)).toBe(true);
      expect(doc.pathErrors.length).toBeGreaterThan(0);
      expect(doc.pathErrors[0].code).toBe("syntax-error");
      expect(doc.pathErrors[0].path).toContain("syn.js");
      // 形状：<line>:<col> — syntax error: <本质信息>
      expect(doc.pathErrors[0].message).toMatch(/^\d+:\d+ — syntax error: /);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["check", file, "--json"], { cwd });
      expect(r.status).toBe(1);
      const doc = JSON.parse(r.stdout);
      const codes = (doc.pathErrors ?? []).map((e: { code: string }) => e.code);
      expect(codes).toContain("syntax-error");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});



});


// ---------------------------------------------------------------------------
// --exit-on-diff 的前置校验不得嵌在 --freeze 分支内
// ---------------------------------------------------------------------------
describe("--exit-on-diff 的前置校验不得嵌在 --freeze 分支内", () => {
/**
 * `nudo test --exit-on-diff`（**无 `--freeze`**）被**静默忽略**、
 * exit 0 ⇒ CI 门禁形同虚设（用户以为「有 diff 就红」）。
 *
 * 根因：旗标校验被**嵌在 `if (opts.freeze !== undefined)` 块内** ⇒
 * `--exit-on-diff` 的前置条件（需 `--freeze` / `--dry-run`）只在有
 * `--freeze` 时才被检查；无 `--freeze` 时整段被跳过。
 *
 * 修复：前置校验**移到分支外** ⇒ 无 `--freeze` 时也报**用法错误**
 * （与 `nudo contract --exit-on-diff` 的口径对齐）。
 */






const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-653-"));
  const file = join(cwd, "one.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd, file };
}

describe("-exit-on-diff 的前置校验不得嵌在 --freeze 分支内", () => {
  it("无 --freeze：报用法错误 + exit 1（旧行为：静默忽略 + exit 0）；有 --freeze 无 --dry-run：仍是既有的「requires --dry-run」用法错误；合法组合 --freeze --dry-run --exit-on-diff：照常跑（不误伤）", () => {
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--exit-on-diff"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--exit-on-diff");
      expect(r.stderr).toContain("--freeze");
      // 旧症状：旗标被吞掉 ⇒ 一句提示都没有
      expect(r.stderr.trim().length).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--exit-on-diff", "--freeze"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("--exit-on-diff requires --dry-run");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["test", file, "--exit-on-diff", "--freeze", "--dry-run"], { cwd });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("--exit-on-diff requires");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});


});
});


// ---------------------------------------------------------------------------
// contract --json 的路径错误必须进 JSON body
// ---------------------------------------------------------------------------
describe("contract --json 的路径错误必须进 JSON body", () => {
/**
 * `nudo contract --json`（**非** `--draft` 形态）把**路径错误整个吞掉**
 * ⇒ exit 1 但 stdout 的 JSON 里**没有** `pathErrors`、stderr 0 字节
 * ⇒ 「置红的那个原因没有任何地方说得出来」。
 *
 * 修法（族 20 · 片 A）：`--json` 形态下**路径错误必须进 JSON body**
 * （`pathErrors[]`）⇒ print / emit / draft **三形态统一**。
 *
 * ⚠ 勘误（族 21 已修 print 分支 ⇒ stdout **现在就是**合法 JSON）：
 * 验收用例**不**断言「stdout 不是 JSON」，只断言「JSON 里有 `pathErrors[]`」
 * +「stderr **可**为空」+「exit **仍** 1」。
 */






let dir: string;
let lib: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-661-"));
  lib = join(dir, "lib.js");
  writeFileSync(lib, "export function alpha(x) { return x; }\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonDoc = {
  file?: string;
  entries?: { fn: string }[];
  pathErrors?: { path: string; code: string; message: string; suggestion?: string }[];
};


  it("print 形态 + 缺失路径：stdout 是合法 JSON 且带 pathErrors[] + exit 1；draft 形态 + 缺失路径：同一套 pathErrors[]（三形态统一）；全部路径都缺失（无 root）：stdout 仍是**非空**合法 JSON + pathErrors[] + exit 1；对照面：非 --json 的人类面仍在 stderr（不因 --json 消失）", () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-661-"));
  lib = join(dir, "lib.js");
  writeFileSync(lib, "export function alpha(x) { return x; }\n", "utf-8");


    const missing = join(dir, "nope.js");
    const r = runCli(["contract", lib, missing, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    // stdout 是**一份**合法 JSON（恒定数组外壳）
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(Array.isArray(docs)).toBe(true);
    // 路径错误独立成一项（命令级事实，不是某个 root 的）
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors).toHaveLength(1);
    expect(errDocs[0].pathErrors?.[0]?.code).toBe("nudo:path-not-found");
    expect(errDocs[0].pathErrors?.[0]?.path).toContain("nope.js");
    expect(errDocs[0].pathErrors?.[0]?.message).toContain("Not found");
    // 好文件的文档仍在载荷里（不被路径错误挤掉）
    expect(docs.some((d) => d.file === "lib.js")).toBe(true);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-661-"));
  lib = join(dir, "lib.js");
  writeFileSync(lib, "export function alpha(x) { return x; }\n", "utf-8");


    const missing = join(dir, "nope.js");
    const r = runCli(["contract", lib, missing, "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors?.[0]?.code).toBe("nudo:path-not-found");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-661-"));
  lib = join(dir, "lib.js");
  writeFileSync(lib, "export function alpha(x) { return x; }\n", "utf-8");


    const missing = join(dir, "nope.js");
    const r = runCli(["contract", missing, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs[0].pathErrors?.[0]?.code).toBe("nudo:path-not-found");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-661-"));
  lib = join(dir, "lib.js");
  writeFileSync(lib, "export function alpha(x) { return x; }\n", "utf-8");


    const missing = join(dir, "nope.js");
    const r = runCli(["contract", lib, missing], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not found:");
    expect(r.stderr).toContain("fix:");
  }
});




});


// ---------------------------------------------------------------------------
// contract --draft --write 不得把 `..data/` 判成越出项目根
// ---------------------------------------------------------------------------
describe("contract --draft --write 不得把 `..data/` 判成越出项目根", () => {
/**
 * `nudo contract --write` 的**项目根边界**用 `rel.startsWith("..")`
 * 判逃逸 ⇒ 项目根下的**合法目录** `..data/` 被判「在项目根之外」⇒ 草稿
 * **拒写**（exit 1）—— 而同一文件在项目根下**正常写出**。
 *
 * 根因：`relative()` 返回的是**相对路径字符串**——「向上逃逸」的判据是
 * 「整段等于 `..`」或「以 `..` + 路径分隔符开头」，**不是**裸
 * `startsWith("..")`：后者把 `..data/` / `...cfg/` 这类**合法**相对路径
 * （目录名以 `..` 开头）误判成父目录逃逸。
 *
 * 修法（族 20 · 片 B · **CLI 半**）：判据改成
 * `rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)`
 * —— 与 service 半（`packages/service/src/emit/contract-draft.ts` 的
 * `writeContractDraft`）**逐字同款**（同一个 bug 的两半 ⇒ 同一片修）。
 *
 * ⚠ 本钉的夹具**全部写在临时目录**里 ⇒ 绝不往仓里写文件。
 * ⚠ 两层钉：
 * ① **进程内**直调 `runContractDraft`（`@nudojs/service/emit` 在测试里
 * 走 **src** 别名 ⇒ CLI 半 + service 半**两端都是源码**）⇒ 端到端写盘；
 * ② **CLI 级**（子进程）：断言 CLI 半**不再**用那句 CLI 专属的拒写文案。
 */







let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-665-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "dotdir-probe", "private": true, "type": "module" }\n',
    "utf-8",
  );
  mkdirSync(join(dir, "..data"), { recursive: true });
  writeFileSync(join(dir, "..data", "f.js"), "export function f(x) { return x + 1; }\n", "utf-8");
  writeFileSync(join(dir, "normal.js"), "export function g(x) { return x + 1; }\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 进程内跑一次 `runContractDraft`，收走 console 与 exit code（不污染测试进程）。 */
async function runDraftInProcess(
  file: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | string | null | undefined }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const prevExitCode = process.exitCode;
  console.log = (...args: unknown[]): void => {
    out.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  console.error = (...args: unknown[]): void => {
    err.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  let exitCode: number | string | null | undefined;
  try {
    await runContractDraft(file, { fnNames: [], write: true, dryRun: false });
    exitCode = process.exitCode;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exitCode = prevExitCode;
  }
  return { stdout: out.join("\n"), stderr: err.join("\n"), exitCode };
}


  it("进程内：CLI 半 + service 半（都走 src）⇒ `..data/f.js` 的草稿**写出来了**；CLI 级：CLI 半**不再**用那句「is outside project root」拒写文案；负控制：同一项目根下的普通文件照常写出（不误伤）", async () => {
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-665-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "dotdir-probe", "private": true, "type": "module" }\n',
    "utf-8",
  );
  mkdirSync(join(dir, "..data"), { recursive: true });
  writeFileSync(join(dir, "..data", "f.js"), "export function f(x) { return x + 1; }\n", "utf-8");
  writeFileSync(join(dir, "normal.js"), "export function g(x) { return x + 1; }\n", "utf-8");


    const file = join(dir, "..data", "f.js");

    const r = await runDraftInProcess(file);

    // 改前：CLI 半就拒了（`is outside project root …; draft write refused`）
    expect(r.stderr).not.toContain("outside project root");
    expect(r.exitCode).not.toBe(1);
    expect(r.stdout).toContain("Draft written →");
    expect(existsSync(join(dir, "..data", "f.nudo.draft.js"))).toBe(true);
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-665-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "dotdir-probe", "private": true, "type": "module" }\n',
    "utf-8",
  );
  mkdirSync(join(dir, "..data"), { recursive: true });
  writeFileSync(join(dir, "..data", "f.js"), "export function f(x) { return x + 1; }\n", "utf-8");
  writeFileSync(join(dir, "normal.js"), "export function g(x) { return x + 1; }\n", "utf-8");


    const r = runCli(["contract", "--draft", "--write", "..data/f.js"], { cwd: dir });

    // 改前：stderr = "Error: '…/..data/f.js' is outside project root '…'; draft write refused"
    // （service 半的拒写文案是「draft write refused: outside project root」，
    // 两者**不同** ⇒ 这条断言精确地钉住 **CLI 半**。）
    expect(r.stderr).not.toContain("is outside project root");
  }
  {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-665-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "dotdir-probe", "private": true, "type": "module" }\n',
    "utf-8",
  );
  mkdirSync(join(dir, "..data"), { recursive: true });
  writeFileSync(join(dir, "..data", "f.js"), "export function f(x) { return x + 1; }\n", "utf-8");
  writeFileSync(join(dir, "normal.js"), "export function g(x) { return x + 1; }\n", "utf-8");


    const r = runCli(["contract", "--draft", "--write", "normal.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Draft written → normal.nudo.draft.js");
    expect(existsSync(join(dir, "normal.nudo.draft.js"))).toBe(true);
  }
}); // 进程内分析（不走子进程）

   // 1 个 CLI 子进程（tsx 冷启动）

   // 1 个 CLI 子进程（tsx 冷启动）

});


// ---------------------------------------------------------------------------
// migrate status 审计全部路径（回归钉）
// ---------------------------------------------------------------------------
describe("migrate status 审计全部路径（回归钉）", () => {
/**
 * `nudo migrate status` 静默忽略第一个之后的全部路径。
 *
 * 族 16（commit e5b3f388）已在**命令层**修好（`packages/nudojs/src/commands/
 * migrate.ts` 的 status 分支改为**全量审计**）⇒ 本文件是**回归钉**（防止
 * 回退到「只报 targets[0]」），不是重复修复。
 *
 * 反向闸（断言非永真）：把命令层换回**族 16 之前**的版本（`git show
 * e5b3f388^:packages/nudojs/src/commands/migrate.ts`）⇒ 「两个包都被审计」
 * 断言**必红**（旧实现只报 pkg-a）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-668-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", scripts: { typecheck: "tsc --noEmit" } }),
    "utf-8",
  );
  return dir;
}


  it("migrate status <a> <b> ⇒ 两个包都被审计（不得只报第一个）；migrate status --json <a> <b> ⇒ 顶层数组含两个 root；单路径时行为不变（不得因多路径支持而破坏单路径）", () => {
  {
    const a = pkgDir("status-a");
    const b = pkgDir("status-b");
    const r = runCli(["migrate", "status", a, b]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(a);
    expect(r.stdout).toContain(b);
  }
  {
    const a = pkgDir("status-json-a");
    const b = pkgDir("status-json-b");
    const r = runCli(["migrate", "status", "--json", a, b]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Array<{ root: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    // migrate status 的 root 是**相对 cwd** 的路径（CLI 的 cwd = repoRoot）
    expect(parsed.map((row) => row.root)).toEqual([relative(repoRoot, a), relative(repoRoot, b)]);
  }
  {
    const a = pkgDir("status-single");
    const r = runCli(["migrate", "status", a]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(a);
  }
});



});


// ---------------------------------------------------------------------------
// 目录扫描跟随符号链接
// ---------------------------------------------------------------------------
describe("目录扫描跟随符号链接", () => {
/**
 * 目录目标的文件收集**静默跳过符号链接**。
 *
 * 旧实现用 `entry.isDirectory()` / `entry.isFile()` 判定 dirent ⇒ 符号链接
 * 条目两者皆 false（既非 dir 也非 file）⇒ 被**静默丢弃**（既不分析、也不报
 * 路径错误）⇒ `check <dir>` 对链接进来的坏文件**假绿**（exit 0），同一文件
 * 直传却 FAILED（exit 1）。
 *
 * 修法：`collectNudoFiles` 跟随符号链接判定（`statSync`），目录链接按
 * realpath 防环。
 */







/** L2 entry-may-throw：解引用 unconstrained 参数 */
const BAD_SRC = `export function getName(obj) {
  return obj.name;
}
`;
const GOOD_SRC = `export function one() {
  return 1;
}
`;

{
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 夹具：base/l2.js（坏）+ base/symdir/{good.js, badlink.js -> ../l2.js} */
  function makeFixture(): string {
    const base = mkdtempSync(join(tmpdir(), "nudo-671-"));
    dirs.push(base);
    const scanDir = join(base, "symdir");
    mkdirSync(scanDir, { recursive: true });
    writeFileSync(join(base, "l2.js"), BAD_SRC, "utf-8");
    writeFileSync(join(scanDir, "good.js"), GOOD_SRC, "utf-8");
    symlinkSync(join(base, "l2.js"), join(scanDir, "badlink.js"));
    return scanDir;
  }

  it("collectNudoFiles 收进链接进来的 .js（改前：静默跳过）；符号链接目录被递归进入（改前：整棵链接目录被跳过）；CLI check <dir>：链接进来的坏文件参与门禁（改前：exit 0 假绿）；同一文件直传与目录扫描结论一致（不再一个绿一个红）", () => {
  {
    const scanDir = makeFixture();
    const names = collectNudoFiles(scanDir)
      .map((f) => f.split("/").pop())
      .sort();
    expect(names).toEqual(["badlink.js", "good.js"]);
  }
  {
    const base = mkdtempSync(join(tmpdir(), "nudo-671-dir-"));
    dirs.push(base);
    const real = join(base, "real");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "inside.js"), GOOD_SRC, "utf-8");
    const scanDir = join(base, "scan");
    mkdirSync(scanDir, { recursive: true });
    symlinkSync(real, join(scanDir, "linked-dir"));
    const names = collectNudoFiles(scanDir)
      .map((f) => f.split("/").pop())
      .sort();
    expect(names).toEqual(["inside.js"]);
  }
  {
    const scanDir = makeFixture();
    const r = runCli(["check", scanDir]);
    expect(r.stdout).toContain("badlink.js");
    expect(r.status).toBe(1);
  }
  {
    const scanDir = makeFixture();
    const direct = runCli(["check", join(scanDir, "badlink.js")]);
    const viaDir = runCli(["check", scanDir]);
    expect(direct.status).toBe(1);
    expect(viaDir.status).toBe(direct.status);
    // 目录扫描必须**看见**同一个文件（改前：链接被静默跳过，目录面看不见它）
    expect(viaDir.stdout).toContain("badlink.js");
    expect(viaDir.stdout).toContain("nudo:entry-may-throw");
  }
});



}
});


// ---------------------------------------------------------------------------
// strip 产物必须是 Node 能解析的纯 JS
// ---------------------------------------------------------------------------
describe("strip 产物必须是 Node 能解析的纯 JS", () => {
/**
 * `nudo migrate strip --write` 写出的 `.js` **Node 无法解析**
 * （`private` / `public` / `readonly` 未剥离；参数属性
 * `constructor(private opening: number)` 也原样保留）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（经 `packages/nudojs/src/migrate.ts` 的
 * `stripTsToJs` 调用）—— 族 21 收口时由主 agent 接线修好：
 * ① 类成员修饰符（`private` / `public` / `protected` / `readonly` / `abstract` /
 * `override` / `declare`）剥掉；② 构造器参数属性降级成
 * 「普通形参 + 构造器体开头的 `this.x = x`」。
 *
 * 命令层（`packages/nudojs/src/commands/migrate.ts`）另有一道**兜底闸门**：
 * 写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错
 * （migrate 是一程闸门，写坏了没有回退路径）。真源修好后常规路径不再触发它，
 * 它只作为真源漏网时的兜底存在。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CLASS_TS = `export class Account {
  private balance: number = 0;
  public readonly owner: string = "ada";
  constructor(private opening: number) { this.balance = opening; }
}
`;

function dirWith(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-672-"));
  dirs.push(dir);
  writeFileSync(join(dir, name), content, "utf-8");
  return dir;
}

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}


  it("产物必须落盘且能被 `node --check` 解析（成员修饰符已剥、参数属性已降级）；命令层闸门是**兜底**：真源修好后常规路径不再触发它（不得误拦合法产物）；对照：纯类型注解的 TS 源照常 strip（闸门不得过度拦截）", () => {
  {
    const dir = dirWith("cls.ts", CLASS_TS);
    const r = runCli(["migrate", "strip", "--write", join(dir, "cls.ts")]);
    const product = join(dir, "cls.js");
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(product)).toBe(true);
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
    const code = readFileSync(product, "utf-8");
    // 成员修饰符不得残留
    expect(code).not.toContain("private");
    expect(code).not.toContain("public");
    expect(code).not.toContain("readonly");
    // 参数属性降级：形参变普通形参 + 构造器体补上字段赋值
    expect(code).toContain("this.opening = opening");
    expect(code).not.toContain("constructor(private");
  }
  {
    const dir = dirWith("cls.ts", CLASS_TS);
    const r = runCli(["migrate", "strip", "--write", join(dir, "cls.ts")]);
    // 闸门仍在（真源漏网时拒写盘 + 点名文件 + exit 1），但真源已修 ⇒ 不该拦
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");
    expect(existsSync(join(dir, "cls.js"))).toBe(true);
  }
  {
    const dir = dirWith("ok.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    const r = runCli(["migrate", "strip", "--write", join(dir, "ok.ts")]);
    expect(r.status, r.stderr).toBe(0);
    const product = join(dir, "ok.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain(": number");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  }
});



});


// ---------------------------------------------------------------------------
// --what-if 等号 / 冒号两种写法等价
// ---------------------------------------------------------------------------
describe("--what-if 等号 / 冒号两种写法等价", () => {
/**
 * `--what-if` 只认冒号 ⇒ 文档给的可复制命令（等号形态）原样跑不通。
 *
 * 症状：整串被当成绑定名 ⇒ 「Bindings not applied」+ exit 0（假设静默不生效，
 * 用户以为假设生效了）。修复：解析器**两种分隔符都认**（`:` 与 `=`），
 * 文档保持等号形态（ai-native-dx.md / reference/agents.md 的命令示例不变）。
 */







const SRC = `const raw = 1;

export function len() {
  return raw;
}
`;

function makeProject(): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-673-whatif-"));
  const file = join(dir, "c.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file };
}

describe("-what-if 等号 / 冒号两种写法等价", () => {
  it("解析器：等号形态切出 name/type（不是整串当绑定名）；解析器：冒号形态不变（旧口径不回归）；解析器：分隔符取最先出现的那个；无分隔符仍是 name=整串 / type=any；CLI：等号形态的假设真的生效（绑定被应用，类型按假设打印）；CLI：冒号形态仍然生效（两种写法同结果）", () => {
  {
    expect(parseWhatIfBindings(["raw=string"])).toEqual([
      { name: "raw", type: "string" },
    ]);
  }
  {
    expect(parseWhatIfBindings(["raw:string"])).toEqual([
      { name: "raw", type: "string" },
    ]);
  }
  {
    expect(parseWhatIfBindings(["a=b:c"])).toEqual([{ name: "a", type: "b:c" }]);
    expect(parseWhatIfBindings(["m:a:b"])).toEqual([{ name: "m", type: "a:b" }]);
    expect(parseWhatIfBindings(["plain"])).toEqual([{ name: "plain", type: "any" }]);
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["check", file, "--what-if", "raw=string", "--target", "raw"], {
        cwd,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Type of "raw": string');
      expect(r.stdout).toContain("Bindings applied: raw: string");
      // 旧症状：整串被当成绑定名 ⇒ 「not applied」
      expect(r.stdout).not.toContain("Bindings not applied");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject();
    try {
      const r = runCli(["check", file, "--what-if", "raw:string", "--target", "raw"], {
        cwd,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Type of "raw": string');
      expect(r.stdout).toContain("Bindings applied: raw: string");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});




});
});


// ---------------------------------------------------------------------------
// migrate retire --all --json 顶层形状恒定（回归钉）
// ---------------------------------------------------------------------------
describe("migrate retire --all --json 顶层形状恒定（回归钉）", () => {
/**
 * `migrate retire --all --json` 的**顶层 JSON 形状随结果条数变化**
 * （1 个包 = 对象，≥2 个包 = 数组）⇒ 机器可读契约不稳定。
 *
 * 族 16（commit e5b3f388）已在**命令层**修好（顶层恒为数组）⇒ 本文件是
 * **回归钉**（防止回退到「单元素退化为对象」的糖）。
 *
 * 反向闸（断言非永真）：把命令层换回**族 16 之前**的版本 ⇒ 「1 个包时顶层
 * 仍是数组」断言**必红**（旧实现顶层是对象，`Array.isArray` 为 false）。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** pnpm workspace：root + n 个可退役包 */
function workspace(pkgCount: number): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-675-"));
  dirs.push(root);
  writeFileSync(join(root, "package.json"), '{ "name": "root", "private": true }\n', "utf-8");
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
  for (let i = 0; i < pkgCount; i++) {
    const dir = join(root, "packages", `p${i}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: `p${i}`,
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { typecheck: "tsc --noEmit" },
      }),
      "utf-8",
    );
  }
  return root;
}


  it("1 个可退役包 ⇒ 顶层仍是数组（不得退化为对象）；2 个可退役包 ⇒ 顶层同样是数组（形状不随条数漂移）；两个场景的顶层形状一致（都是数组）", () => {
  {
    const root = workspace(1);
    const r = runCli(["migrate", "retire", root, "--all", "--dry-run", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  }
  {
    const root = workspace(2);
    const r = runCli(["migrate", "retire", root, "--all", "--dry-run", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  }
  {
    const one = runCli([
      "migrate",
      "retire",
      workspace(1),
      "--all",
      "--dry-run",
      "--json",
    ]);
    const two = runCli([
      "migrate",
      "retire",
      workspace(2),
      "--all",
      "--dry-run",
      "--json",
    ]);
    expect(one.status, one.stderr).toBe(0);
    expect(two.status, two.stderr).toBe(0);
    expect(Array.isArray(JSON.parse(one.stdout))).toBe(Array.isArray(JSON.parse(two.stdout)));
  }
});



});


// ---------------------------------------------------------------------------
// TS enum 被合成成运行时对象（产物面 + 门禁行为）
// ---------------------------------------------------------------------------
describe("TS enum 被合成成运行时对象（产物面 + 门禁行为）", () => {
/**
 * TS 的 `enum` 被整段删除 ⇒ 成员引用退化成**未绑定全局**读取 ⇒
 * 门禁报 error 级 `nudo:entry-may-throw`（**假红**）+ dts / zod / standard /
 * guard 四个产物面把返回类型落成 `never`。
 *
 * **真源**：`packages/core/src/strip-types.ts`（把 TS enum **合成成运行时
 * 对象**，逐形态对齐 tsc 的 emit）。本钉是**产物面**的回归钉：
 * ① 产物必须是可加载的运行时对象（不是空模块）；
 * ② 门禁行为正确：`.ts` 源与 `.js` 产物**都绿**，签名都是 `f() => 1`
 * （不再是 `never` + ReferenceError 的假红）。
 */







const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ENUM_TS = `export enum E { A = 1 }
export function f() {
  return E.A;
}
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

/** 真 ESM 加载并读 enum 成员（运行时语义面） */
function esmReadEnum(path: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import(${JSON.stringify(`file://${path}`)}).then(m=>console.log("VALUE:", m.E.A)).catch(e=>{console.log("LOAD ERROR:", e.constructor.name+":", e.message); process.exitCode=1;});`,
    ],
    { encoding: "utf-8" },
  );
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}


  it("产物含运行时 enum 对象 ⇒ `node --check` 过且 `E.A === 1`；门禁行为正确：`.ts` 源与 `.js` 产物都绿，签名是 `f() => 1`（不再是 never）", () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-913-"));
    dirs.push(dir);
    writeFileSync(join(dir, "enum.ts"), ENUM_TS, "utf-8");

    const r = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "enum.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "enum.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    // enum 不得被整段删除：绑定 `E` 必须**有声明**（只剩引用 `E.A` ⇒ 运行时
    // 未绑定全局读取 ⇒ ReferenceError）
    expect(code).toMatch(/\b(var|const|let)\s+E\b/);
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);

    // 运行时语义面：enum 成员必须取得到值（tsc 同口径：E.A === 1）
    const load = esmReadEnum(product);
    expect(load.status, `${load.stdout}\n${load.stderr}`).toBe(0);
    expect(load.stdout).toContain("VALUE: 1");
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-913b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "enum.ts"), ENUM_TS, "utf-8");

    const strip = runCli(["migrate", "strip", "--write", "--no-draft", join(dir, "enum.ts")]);
    expect(strip.status, strip.stderr).toBe(0);

    for (const name of ["enum.ts", "enum.js"]) {
      const c = runCli(["check", join(dir, name)]);
      expect(c.status, `${name}\n${c.stdout}\n${c.stderr}`).toBe(0);
      expect(c.stdout).toContain("f() => 1");
      expect(c.stdout).not.toContain("never");
      expect(c.stdout).not.toContain("ReferenceError");
    }
  }
});


});


// ---------------------------------------------------------------------------
// 断言判定的第三态：推导失败 ⇒ unchecked（不是失败、不是空洞通过）
// ---------------------------------------------------------------------------
describe("断言判定的第三态：推导失败 ⇒ unchecked（不是失败、不是空洞通过）", () => {
/**
 * `nudo test` 的断言判定**没有「推导失败」第三态**。
 *
 * 根因（`packages/nudojs/src/run-test.ts` 的报告面）：断言判定是**二值**的
 * ——实测侧 `unknown`（**引擎没推出来**）被压成「断言不符」（假红），
 * 而 `any()` 期望又借 core `leqAbs` 的「目标放宽 ⇒ 通过」捷径**空洞通过**
 * （假绿）⇒ **同一事实两种期望都不可用**；且与 check 面把同一状态判成
 * INFO（`nudo:opaque-result`、exit 0）**严重度相反**。
 *
 * 修法：报告面引入**第三态**——实测侧是 `unknown` / `conf === "opaque"`
 * （推导失败）⇒ 记 **unchecked（无法判定）**：不是失败、不置红（exit 0）、
 * 也不是空洞通过；诊断文本区分「实测与期望不符」（真失败）与
 * 「引擎未能推断实测值」（工具的局限，指向 `nudo:opaque-result` 的补证据路径）。
 *
 * 钉（CLI 报告面）：
 * - 推导失败 + 期望 `number()` ⇒ **unchecked**（不是 FAIL）+ exit 0；
 * - 推导失败 + 期望 `any()` ⇒ 同样 **unchecked**（不是空洞 ok）+ exit 0；
 * - 诊断文本区分：含「无法判定」口径 + 指向 `nudo:opaque-result`；
 * - `--json` 面：assertions = {passed: 0, failed: 0, unchecked: 1}；
 * - 负控制：推导成功 + 期望不符 ⇒ 仍是 **FAIL / exit 1**（既有行为不变）。
 *
 * ⚠ 本钉只钉**报告面**（两个报告面的第三态是同一条口径，见 service 面的
 * 平行钉 `packages/service/src/__tests__/service--test-report-third-state.part.ts`）。
 */






/**
 * 引擎**推不出来**的函数体（`(x.get)().a ||= 2` 不被求值器支持
 * ⇒ 实测落到 `unknown`）——与 check 面的 `nudo:opaque-result` 同一事实。
 */
const OPAQUE_BODY = `export function f(o) {
  const x = { a: 1 };
  (x.get)().a ||= 2;
  return x.a;
}
`;

/** 推导成功（负控制）：实测是 `2`，期望 `string()` ⇒ 真失败。 */
const INFERRED_BODY = `export function g(x) { return x + 1; }
`;

type Fixture = { cwd: string; file: string };

/** 写一个临时项目（ESM）+ 一个带声明期望的 case 文件。 */
function makeProject(expectation: string, body: string): Fixture {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-950-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b950", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  const file = join(cwd, "t.js");
  writeFileSync(
    file,
    `/**
 * @nudo:case "w" (1) => ${expectation}
 */
${body}`,
    "utf-8",
  );
  return { cwd, file };
}


  it("推导失败 + 期望 number() ⇒ unchecked + exit 0（改前：FAIL + exit 1）；推导失败 + 期望 any() ⇒ 同样 unchecked（改前：空洞 ok「1 passed」）；诊断文本区分「无法判定」与「类型不匹配」，并指向 nudo:opaque-result 的补证据路径；--json 面：assertions = {passed: 0, failed: 0, unchecked: 1}；负控制：推导成功 + 期望不符 ⇒ 仍是 ", () => {
  {
    const { cwd, file } = makeProject("number()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("0 passed · 0 failed · 1 unchecked");
      expect(r.stdout).not.toContain("[FAIL]");
      expect(r.stdout).toContain("[unchecked]");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject("any()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("0 passed · 0 failed · 1 unchecked");
      expect(r.stdout).not.toContain("[ok]");
      expect(r.stdout).not.toContain("1 passed");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject("number()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      // 报告面：说「引擎没推出来」，不是「类型不匹配」
      expect(r.stdout).toContain("cannot judge");
      expect(r.stdout).toContain("the engine could not infer the actual value");
      expect(r.stdout).toContain("not a type mismatch");
      // 补证据路径 = check 面同事实的 INFO（nudo:opaque-result）
      expect(r.stdout).toContain("nudo:opaque-result");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject("number()", OPAQUE_BODY);
    try {
      const r = runCli(["test", file, "--json"], { cwd });
      expect(r.status).toBe(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.assertions).toEqual({ passed: 0, failed: 0, unchecked: 1 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
  {
    const { cwd, file } = makeProject("string()", INFERRED_BODY);
    try {
      const r = runCli(["test", file], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("1 failed");
      expect(r.stdout).toContain("0 unchecked");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});





});


// ---------------------------------------------------------------------------
// test --json 的用法错误也必须有机器可读 body
// ---------------------------------------------------------------------------
describe("test --json 的用法错误也必须有机器可读 body", () => {
/**
 * `nudo test --json` 的**用法错误**路径产出「**空 stdout + 非零
 * exit**」⇒ 违反「`--json` 下 stdout 永不为空 / 绝不出现空 stdout + 非零
 * exit」的机器面契约；而**同一动词**的路径失败路径**有**合法
 * `pathErrors[]` 信封 ⇒ 机器面自相矛盾。
 *
 * 根因：全部用法错误分支都排在 CaseJson 序列化点**之前**，且沿用「写
 * stderr + exit 1 + return」的人类面约定 ⇒ `--json` 下机器面根本没有机会
 * 产出。
 *
 * 修复：用法错误在 `--json` 下也走**同一条** CaseJson 失败信封
 * （`pathErrors[{code:"nudo:usage-error"}]` + exit 1）；非 `--json` 面的人读
 * 文案**不变**。
 *
 * ⚠ 码：用法错误码本地定义在 `commands/test.ts`（不改 `shared.ts` 的
 * `PathError["code"]` 联合）——：该码原为 `"usage-error"`，与
 * `check` / `contract` 的 `"nudo:usage-error"` **分叉** ⇒ 同一类错误在三个
 * 动词产出不同的机器码 ⇒ 消费者要为 test 单独维护一张码表 ⇒ 已统一为
 * `"nudo:usage-error"`（`"syntax-error"` 保持不变）。
 */






const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string; other: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-957-"));
  const file = join(cwd, "one.js");
  const other = join(cwd, "two.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(other, SRC, "utf-8");
  return { cwd, file, other };
}

{
  const cases: Array<{ name: string; args: (p: { file: string; other: string }) => string[] }> = [
    { name: "无路径", args: () => ["test", "--json"] },
    { name: "--json + --abs", args: (p) => ["test", p.file, "--json", "--abs"] },
    { name: "--json 多文件", args: (p) => ["test", p.file, p.other, "--json"] },
    { name: "--json + --freeze（旗标吞路径）", args: (p) => ["test", "--json", "--freeze", p.file] },
    { name: "--json + --from（变参吞路径）", args: (p) => ["test", "--json", "--from", p.file] },
    { name: "--json + --exit-on-diff（无 --freeze）", args: (p) => ["test", p.file, "--json", "--exit-on-diff"] },
  ];

  for (const c of cases) {
    it(`CLI：${c.name} ⇒ stdout 是 CaseJson 信封（pathErrors[{code:\"nudo:usage-error\"}]）+ exit 1`, () => {
      const p = makeProject();
      try {
        const r = runCli(c.args(p), { cwd: p.cwd });
        expect(r.status).toBe(1);
        // 旧症状：stdout 0 字节 ⇒ 机器面 JSON.parse 炸
        expect(r.stdout.trim().length, `stdout 为空：${r.stderr}`).toBeGreaterThan(0);
        const doc = JSON.parse(r.stdout);
        expect(doc.version).toBe(1);
        expect(Array.isArray(doc.pathErrors)).toBe(true);
        expect(doc.pathErrors.length).toBeGreaterThan(0);
        // 用法错误码与 check / contract 同码（`nudo:usage-error`）
        expect(doc.pathErrors[0].code).toBe("nudo:usage-error");
        expect(doc.pathErrors[0].message.length).toBeGreaterThan(0);
        // 与路径错误信封同形（同一动词不再有两条失败通道）
        expect(Array.isArray(doc.functions)).toBe(true);
        expect(Array.isArray(doc.diagnostics)).toBe(true);
        expect(doc.assertions).toEqual({ passed: 0, failed: 0, unchecked: 0 });
      } finally {
        rmSync(p.cwd, { recursive: true, force: true });
      }
    }, 30000);
  }

  it("CLI：非 --json 面的人读文案不变（stderr 一行 + stdout 空 + exit 1）；CLI：非 --json 面的其它用法错误文案不变（--exit-on-diff 无 --freeze）；CLI：路径错误信封（对照）仍是 pathErrors 机器码，两条通道同形", () => {
  {
    const p = makeProject();
    try {
      const r = runCli(["test"], { cwd: p.cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Usage error: `nudo test` needs at least one path.");
    } finally {
      rmSync(p.cwd, { recursive: true, force: true });
    }
  }
  {
    const p = makeProject();
    try {
      const r = runCli(["test", p.file, "--exit-on-diff"], { cwd: p.cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("--exit-on-diff");
      expect(r.stderr).toContain("--freeze");
    } finally {
      rmSync(p.cwd, { recursive: true, force: true });
    }
  }
  {
    const p = makeProject();
    try {
      const r = runCli(["test", join(p.cwd, "missing.js"), "--json"], { cwd: p.cwd });
      expect(r.status).toBe(1);
      expect(r.stdout.trim().length).toBeGreaterThan(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.pathErrors.length).toBeGreaterThan(0);
      expect(doc.pathErrors[0].code).toBe("nudo:path-not-found");
    } finally {
      rmSync(p.cwd, { recursive: true, force: true });
    }
  }
});


}
});
