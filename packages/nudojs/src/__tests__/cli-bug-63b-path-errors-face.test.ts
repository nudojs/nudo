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
 *   （既有机器消费者零影响）；
 * - `targetErrors[]`：**新增的可选** JSON 字段 = **分析目标闸门**错误的
 *   **精确**子集
 *   - `--from` 路径错误**不**进它（它是**精确入口**，不是副本）；
 *   - 闸门错误**同时**留在 `pathErrors[]` 里（全集不变 ⇒ 不丢事实）；
 * - **无**闸门错误 ⇒ `targetErrors[]` **不出现**（既有场景 stdout 逐字不变）。
 *
 * **钉法**（真跑 CLI，`runCliTsx`）：
 * - 闸门错误场景：`pathErrors[]` 与**改前**逐字一致（名字 / 条数 / 码 /
 *   `suggestion` / 顺序）+ `targetErrors[]` **精确**只装闸门错误；
 * - `--from` 路径错误：**不**进 `targetErrors[]`；
 * - 无闸门错误：`targetErrors[]` 不出现 + stdout 与**改前基线逐字一致**
 *   （负控；基线 = 改前实跑抓的常量）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

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
      "code": "nudo:interface-entry-only",
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
    "diagnostics": 1
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
      "code": "nudo:interface-entry-only"
    }
  ],
  "assertions": {
    "passed": 0,
    "failed": 0,
    "unchecked": 0
  }
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

describe("族 63b-1: check --json", () => {
  it("分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误", { timeout: 60_000 }, () => {
    const r = runCliTsx(["check", "--json", p("types.d.ts")], { cwd: dir });
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
  });

  it("--from 路径错误**不**进 targetErrors[]（它是精确入口，不是副本）", { timeout: 60_000 }, () => {
    const r = runCliTsx(
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
  });

  it("闸门错误 + `--from` 错误并存：pathErrors[] 全集（顺序不变）+ targetErrors[] 只装闸门", { timeout: 60_000 }, () => {
    const r = runCliTsx(
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
  });
});

// ---------------------------------------------------------------------------
// 2. test —— 同一套口径
// ---------------------------------------------------------------------------

describe("族 63b-2: test --json", () => {
  it("分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误", { timeout: 60_000 }, () => {
    const r = runCliTsx(["test", "--json", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      pathErrors?: PathErr[];
      targetErrors?: PathErr[];
    };
    expect(parsed.pathErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(parsed.targetErrors).toEqual([gateEntry(p("types.d.ts"))]);
    expect(parsed.targetErrors).toHaveLength(1);
  });

  it("--from 路径错误**不**进 targetErrors[]", { timeout: 60_000 }, () => {
    const r = runCliTsx(
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
  });
});

// ---------------------------------------------------------------------------
// 3. contract —— 同一套口径
// ---------------------------------------------------------------------------

describe("族 63b-3: contract --json", () => {
  it("分析目标闸门错误：pathErrors[] 逐字不变 + targetErrors[] 精确只装闸门错误", { timeout: 60_000 }, () => {
    const r = runCliTsx(["contract", "--json", p("types.d.ts")], { cwd: dir });
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
  });

  it("--from 路径错误**不**进 targetErrors[]", { timeout: 60_000 }, () => {
    const r = runCliTsx(
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
  });
});

// ---------------------------------------------------------------------------
// 4. 负控：无闸门错误 ⇒ targetErrors[] 不出现 + stdout 逐字不变
// ---------------------------------------------------------------------------

describe("族 63b 负控: 无闸门错误时输出逐字不变（既有场景零影响）", () => {
  it("check --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors", { timeout: 60_000 }, () => {
    const r = runCliTsx(["check", "--json", p("clean.js")], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout)).toBe(CHECK_CLEAN_JSON_BEFORE);
    expect(r.stdout).not.toContain("targetErrors");
  });

  it("test --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors", { timeout: 60_000 }, () => {
    const r = runCliTsx(["test", "--json", p("clean.js")], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout)).toBe(TEST_CLEAN_JSON_BEFORE);
    expect(r.stdout).not.toContain("targetErrors");
  });

  it("contract --json（干净文件）：stdout 与改前基线逐字一致 + 无 targetErrors", { timeout: 60_000 }, () => {
    const r = runCliTsx(["contract", "--json", p("clean.js")], { cwd: dir });
    expect(r.status).toBe(0);
    expect(normalize(r.stdout)).toBe(CONTRACT_CLEAN_JSON_BEFORE);
    expect(r.stdout).not.toContain("targetErrors");
  });

  it("人类面（闸门错误）：stderr 文案与改前逐字一致（机器面改动不外溢）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["check", p("types.d.ts")], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(normalize(r.stderr)).toBe(GATE_TEXT_BEFORE);
  });
});
