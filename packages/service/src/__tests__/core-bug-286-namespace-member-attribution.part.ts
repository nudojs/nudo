/**
 * Bug 286：`--from` 注入的调用点记录在**命名空间成员调用**上无法归因 ⇒
 * `nudo:interface-domain-exceeds`（**error 级** L1 门禁）静默不报 ⇒ 假绿。
 *
 * 根因（analyzer-abs-eval.ts 的调用记录归因）：
 * - eval 侧对命名空间成员调用（`ns.helper(...)`）只记**成员名**（`helper`），
 *   不带接收者 ⇒ 归因侧的点号拆分**永远走不到** ⇒ `targetModule` /
 *   `targetExport` 为空 ⇒ 匹配侧（`matchingExternal` 要求可归因到本文件）
 *   整条丢弃 ⇒ 越界调用点证据消失 ⇒ 门禁绿灯。
 * - CJS `const ns = require("./m.js")` 的 import 表条目登记成
 *   `exportName: "default"` ⇒ 基名匹配（`exportName === "*"`）永远走不到。
 *
 * 修复后的契约（主 agent 裁决，D/E 共同遵守）：
 * - **命名空间成员调用**的记录名 = `<接收者绑定名>.<成员名>`（与类成员调用
 *   `Brand.method` 同形；不带 `ns.` 前缀——接收者的名字是用户的**本地绑定名**）。
 * - **普通调用**（本地函数 / 具名导入 / 宿主全局）**保持现状**：只记函数名。
 * - 归因侧按**最后一个点**拆分：base = 接收者绑定名（查 import 表）·
 *   member = 导出名。
 * - CJS `require` 的命名空间导入项：`exportName` 必须是 `"*"`。
 *
 * 钉：
 * - ESM `import * as` 与 CJS `require` 两种形态都要归因到**被调模块**。
 * - 记录名带接收者限定（`dep.g`），targetExport 是**成员名**（`g`）。
 * - 负控制：具名导入的记录名**不加前缀**（`g`）——既有快照面最小改动。
 * - 产品面：注入后 `nudo:interface-domain-exceeds` 必须是 **error**。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile, collectCallRecords } from "../analyzer.ts";
import { litValue } from "@nudojs/core";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

const DOMAIN = "nudo:interface-domain-exceeds";

/** 被调模块：g 的契约是 x > 0（越界调用 -1 ⇒ 门禁必须报） */
const DEP = `export const g = (x) => x;
`;
const DEP_SIDE = `export const g = fn({ x: number().gt(0) }, number());
`;

describe("Bug 286：命名空间成员调用的调用点可归因（domain-exceeds 不再静默）", () => {
  it("ESM `import * as dep`：记录名带接收者限定，且归因到被调模块", () =>
    withTmpProject("nudo-b286a-", (dir) => {
      const depPath = writeTmpFile(dir, "dep.js", DEP);
      const use = writeTmpFile(
        dir,
        "use.js",
        'import * as dep from "./dep.js";\ndep.g(-1);\n',
      );

      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "dep.g");
      expect(rec, `记录名未带接收者限定：${records.map((r) => r.fnName).join(", ")}`).toBeDefined();
      expect(rec!.targetModule).toBe(depPath);
      expect(rec!.targetExport).toBe("g");
      expect(litValue(rec!.argAbs[0]!).ok).toBe(true);
      const argLit = litValue(rec!.argAbs[0]!);
      expect(argLit.ok ? argLit.value : undefined).toBe(-1);
    }));

  it("CJS `const dep = require(...)`：同样带接收者限定且可归因", () =>
    withTmpProject("nudo-b286b-", (dir) => {
      const depPath = writeTmpFile(dir, "dep.js", DEP);
      const use = writeTmpFile(
        dir,
        "use.js",
        'const dep = require("./dep.js");\ndep.g(-1);\n',
      );

      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "dep.g");
      expect(rec, `记录名未带接收者限定：${records.map((r) => r.fnName).join(", ")}`).toBeDefined();
      expect(rec!.targetModule).toBe(depPath);
      expect(rec!.targetExport).toBe("g");
    }));

  it("负控制：具名导入的记录名保持原样（不加前缀）", () =>
    withTmpProject("nudo-b286c-", (dir) => {
      const depPath = writeTmpFile(dir, "dep.js", DEP);
      const use = writeTmpFile(dir, "use.js", 'import { g } from "./dep.js";\ng(-1);\n');

      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const rec = records.find((r) => r.fnName === "g");
      expect(rec).toBeDefined();
      expect(records.some((r) => r.fnName.includes("."))).toBe(false);
      expect(rec!.targetModule).toBe(depPath);
      expect(rec!.targetExport).toBe("g");
    }));

  it("负控制：对象字面量方法调用不被误加接收者限定", () =>
    withTmpProject("nudo-b286d-", (dir) => {
      const use = writeTmpFile(
        dir,
        "use.js",
        "const o = { helper: (x) => x };\no.helper(-1);\n",
      );
      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      expect(records.some((r) => r.fnName === "helper")).toBe(true);
      expect(records.some((r) => r.fnName.includes("."))).toBe(false);
    }));

  it("产品面：注入后 nudo:interface-domain-exceeds 必须是 error（不再是假绿）", () =>
    withTmpProject("nudo-b286e-", (dir) => {
      const depPath = writeTmpFile(dir, "dep.js", DEP);
      writeTmpFile(dir, "dep.nudo.js", DEP_SIDE);
      const use = writeTmpFile(
        dir,
        "use.js",
        'import * as dep from "./dep.js";\ndep.g(-1);\n',
      );

      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const result = analyzeFile(depPath, readFileSync(depPath, "utf-8"), undefined, records);
      const issues = result.diagnostics.filter((d) => d.code === DOMAIN);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("error");
    }));

  it("产品面：CJS 命名空间形态同样报 error", () =>
    withTmpProject("nudo-b286f-", (dir) => {
      const depPath = writeTmpFile(dir, "dep.js", DEP);
      writeTmpFile(dir, "dep.nudo.js", DEP_SIDE);
      const use = writeTmpFile(
        dir,
        "use.js",
        'const dep = require("./dep.js");\ndep.g(-1);\n',
      );

      const records = collectCallRecords(use, readFileSync(use, "utf-8"));
      const result = analyzeFile(depPath, readFileSync(depPath, "utf-8"), undefined, records);
      const issues = result.diagnostics.filter((d) => d.code === DOMAIN);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe("error");
    }));
});
