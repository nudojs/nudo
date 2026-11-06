/**
 * Bug 464：`nudo test --from` 静默丢弃类方法调用点（`import { C }` 形态）。
 *
 * 根因（analyzer-abs-eval.ts 的调用记录归因）：点号被调名（`Svc.run`）只认
 * **命名空间导入**（`exportName === "*"`）；具名类导入（`import { Svc }`）
 * 拿不到 targetModule → 归因闸门（匹配阶段）整条丢弃 → 回落 entry@、
 * exit 0（假绿）。
 *
 * 钉：
 * - 具名导入 / 别名导入（`import { Svc as S }`）都要归因到**类所在模块**，
 *   并在 `--from` 注入后合成 `call@` case（实参 1 → 返回 2）。
 * - 负控制：命名空间导入形态不受影响；别的模块的调用点不得被挂到本文件。
 *
 * 类名逐用例唯一（引擎 classRegistry 按类名全局驻留——同名类跨 run 共享
 * 原型对象，会让后续用例的求值整体崩）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile, collectCallRecords } from "../analyzer.ts";
import { litValue, type Abs } from "@nudojs/core";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

const OTHER = `export function helper(x) { return x * 3; }
`;

/** 字面量值面（litValue 的 ok 判别式收窄；非字面量 → undefined） */
function litOf(a: Abs): unknown {
  const lv = litValue(a);
  return lv.ok ? lv.value : undefined;
}

describe("Bug 464：具名类导入的调用点归因（--from 不再丢弃）", () => {
  it("import { Svc }：调用点归因到类所在模块并合成 call@ case", () =>
    withTmpProject("nudo-b464-", (dir) => {
      const t9 = writeTmpFile(
        dir,
        "t9.js",
        "export class Svc464a { run(x) { return x + 1; } }\n",
      );
      const use = writeTmpFile(
        dir,
        "use.js",
        'import { Svc464a } from "./t9.js";\nconst s = new Svc464a();\nconst v = s.run(1);\n',
      );

      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "Svc464a.run");
      expect(rec).toBeDefined();
      // 归因到**类所在模块**（此前为 undefined → 记录被整条丢弃）
      expect(rec!.targetModule).toBe(t9);
      expect(litOf(rec!.argAbs[0]!)).toBe(1);
      expect(litOf(rec!.resultAbs)).toBe(2);

      // 注入后合成 call@ case（不再回落 entry@）
      const result = analyzeFile(t9, readFileSync(t9, "utf-8"), undefined, records);
      const fn = result.functions.find((f) => f.name === "Svc464a.run");
      expect(fn).toBeDefined();
      const call = fn!.cases.find((c) => c.source === "callsite");
      expect(call).toBeDefined();
      expect(litOf(call!.abs)).toBe(2);
      expect(fn!.cases.some((c) => c.name.startsWith("entry@"))).toBe(false);
    }));

  it("import { Svc as S }（本地名 ≠ 类名）：同样归因到类所在模块", () =>
    withTmpProject("nudo-b464b-", (dir) => {
      const t9 = writeTmpFile(
        dir,
        "t9.js",
        "export class Svc464b { run(x) { return x + 1; } }\n",
      );
      const use = writeTmpFile(
        dir,
        "use.js",
        'import { Svc464b as S } from "./t9.js";\nconst s = new S();\nconst v = s.run(2);\n',
      );
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "Svc464b.run");
      expect(rec).toBeDefined();
      expect(rec!.targetModule).toBe(t9);
      expect(litOf(rec!.resultAbs)).toBe(3);
    }));

  it("负控制：命名空间导入形态仍按成员名归因（exportName = 成员名）", () =>
    withTmpProject("nudo-b464c-", (dir) => {
      const t9 = writeTmpFile(
        dir,
        "t9.js",
        "export class Svc464c { run(x) { return x + 1; } }\n",
      );
      const use = writeTmpFile(
        dir,
        "use.js",
        'import * as Svc464c from "./t9.js";\nconst s = new Svc464c.Svc464c();\nconst v = s.run(1);\n',
      );
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "Svc464c.run");
      expect(rec).toBeDefined();
      expect(rec!.targetModule).toBe(t9);
      expect(rec!.targetExport).toBe("run");
    }));

  it("负控制：别的模块的调用点不得挂到本文件的函数域", () =>
    withTmpProject("nudo-b464d-", (dir) => {
      const t9 = writeTmpFile(
        dir,
        "t9.js",
        "export class Svc464d { run(x) { return x + 1; } }\n",
      );
      const other = writeTmpFile(dir, "other.js", OTHER);
      const use = writeTmpFile(
        dir,
        "use.js",
        'import { Svc464d } from "./t9.js";\nimport { helper } from "./other.js";\nconst s = new Svc464d();\ns.run(1);\nhelper(4);\n',
      );
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const helperRec = records.find((r) => r.fnName === "helper");
      expect(helperRec).toBeDefined();
      expect(helperRec!.targetModule).toBe(other);
      // 注入到 t9.js：helper 的记录不得成为 t9.js 的调用点证据
      const result = analyzeFile(t9, readFileSync(t9, "utf-8"), undefined, records);
      const fn = result.functions.find((f) => f.name === "Svc464d.run");
      expect(fn!.cases.filter((c) => c.source === "callsite")).toHaveLength(1);
      expect(litOf(fn!.cases[0]!.abs)).toBe(2);
    }));
});
