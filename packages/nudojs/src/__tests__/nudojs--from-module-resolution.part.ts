/**
 * Bug 1060：`nudo test --from <callsite>` 对**模块解析失败**
 * （import 不存在的模块 / 不存在的导出）**静默放过**：零提示、零 `call@`、
 * **exit 0 假绿**（而语法错 / 顶层抛错**有**报错）—— **Bug 466 的半修**
 * （只补了「求值抛错」这一档）。
 *
 * 修法（CLI 面，`packages/nudojs/src/commands/shared.ts`）：现场文件探针
 * `probeCallsiteFile` 补**第三档**「模块解析失败」——求值**成功**（lenient
 * 装载器给未解析的 import 补 stub，模块体继续跑完）但引擎的 `moduleIssues`
 * 报 `missing` / `missing-export` ⇒ **调用点已丢** ⇒ 判为「现场文件读失败」
 * （pathMissingCallsite 家族）⇒ 明确报错 + 非 0 退出。
 *
 * ⚠ 探针**不能**再挂在「0 条记录」分支上：模块解析失败时记录**非空**
 * （指向一个不存在的函数，下游被丢弃）⇒ 只挂 0 记录分支永远测不到第三档。
 *
 * 本文件锁：模块解析失败必须报错 + 非 0 退出；可读且模块可解析的邻近形态
 * （有调用 / 无调用）**不得**被这条修复波及（负控制）；Bug 466 的两档
 * （语法错 / 顶层抛错）**不得**被这条修复改口径（回归锁）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 被测文件：导出 add（entry-only） */
const TARGET_SRC = `export function add(a, b) {
  return a + b;
}
`;
/** 现场文件：import **不存在的模块** ⇒ 模块解析失败 */
const MISSING_MOD_SRC = `import { nope } from "./does-not-exist.js";
const r = nope(1);
`;
/** 现场文件：import **不存在的导出** ⇒ 模块解析失败 */
const MISSING_EXPORT_SRC = `import { missing } from "./target.js";
const r = missing(1);
`;
/** 现场文件：可解析可求值、模块可解析、有调用 */
const CALL_SRC = `import { add } from "./target.js";
const r = add(1, 2);
`;
/** 现场文件：可解析可求值、模块可解析、没有调用 */
const NO_CALL_SRC = `export function helper() {
  return 0;
}
`;
/** 现场文件：语法错（Bug 466 第一档） */
const SYNTAX_ERR_SRC = `import { add } from "./target.js";
const x = add(1, 2
`;
/** 现场文件：顶层抛错（Bug 466 第二档） */
const TOPLEVEL_THROW_SRC = `throw new Error("boom");
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1060-"));
  writeFileSync(join(dir, "package.json"), `{ "name": "nudo-1060", "private": true, "type": "module" }`, "utf-8");
  writeFileSync(join(dir, "target.js"), TARGET_SRC, "utf-8");
  writeFileSync(join(dir, "missing-mod.js"), MISSING_MOD_SRC, "utf-8");
  writeFileSync(join(dir, "missing-export.js"), MISSING_EXPORT_SRC, "utf-8");
  writeFileSync(join(dir, "call.js"), CALL_SRC, "utf-8");
  writeFileSync(join(dir, "nocall.js"), NO_CALL_SRC, "utf-8");
  writeFileSync(join(dir, "syntaxerr.js"), SYNTAX_ERR_SRC, "utf-8");
  writeFileSync(join(dir, "toplevel-throw.js"), TOPLEVEL_THROW_SRC, "utf-8");
  return dir;
}

describe("Bug 1060: nudo test --from 模块解析失败不得静默放过", () => {
  it("import 不存在的模块 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "missing-mod.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("missing-mod.js");
      expect(r.stderr).toContain("module resolution failed");
      // 报错要指名道姓：装不上的模块是谁
      expect(r.stderr).toContain("does-not-exist.js");
      expect(r.stderr).toContain("fix:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("import 不存在的导出 ⇒ 明确报错 + exit 1（改前：零提示 + exit 0 假绿）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "missing-export.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("missing-export.js");
      expect(r.stderr).toContain("module resolution failed");
      expect(r.stderr).toContain("missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json 面：pathErrors 收录该失败 + exit 1（改前：pathErrors 为空 + exit 0）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "--json", "target.js", "--from", "missing-mod.js"], { cwd: dir });
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout) as {
        pathErrors: { path: string; code: string; message: string }[];
      };
      expect(json.pathErrors).toHaveLength(1);
      expect(json.pathErrors[0]!.path).toContain("missing-mod.js");
      expect(json.pathErrors[0]!.code).toBe("nudo:path-missing-callsite");
      expect(json.pathErrors[0]!.message).toContain("Callsite file failed to load");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：现场文件模块可解析且有调用 ⇒ call@ 而非 entry@ + exit 0", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "call.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Callsite file failed to load");
      expect(r.stdout).toContain("call@");
      expect(r.stdout).not.toContain("entry@");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：现场文件模块可解析但没有调用 ⇒ 不报错 + exit 0", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "nocall.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Callsite file failed to load");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("回归锁：语法错现场仍是 parse failed + exit 1（口径不得被第三档改写）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "syntaxerr.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("parse failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("回归锁：顶层抛错现场仍是 evaluation failed + exit 1（口径不得被第三档改写）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "toplevel-throw.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("evaluation failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
