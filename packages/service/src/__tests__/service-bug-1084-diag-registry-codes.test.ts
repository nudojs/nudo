/**
 * Bug 1084 —— 两条新诊断码在 service 侧**硬编码字面量**，与 core 的 `DIAG`
 * 注册表重复。
 *
 * 修前：`analyzer-orchestrate-uncached.ts` 写的是
 * `{ code: "nudo:module-unreadable" }.code` / `{ code: "nudo:json-invalid" }.code`
 * ——当时的**前提**是「core 侧还没把这两个码补进 DIAG 注册表」（注释里写着
 * 「core 的 DIAG 注册表只读——越界上报」）。该前提**已不成立**：core 已注册
 * （`packages/core/src/algebra/diag-codes.ts`）。
 *
 * 影响：同一码两处字面量并存 ⇒ core 侧改名时 service 侧不会跟随 ⇒ 按码分支
 * 的消费方（LSP / CLI）把诊断**静默漏掉**。
 *
 * 本用例钉住：service 生产面**不得**再出现这两个码的裸字面量（诊断码只能
 * 来自 core 的 DIAG 注册表——唯一真理源）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAG } from "@nudojs/core/internal";
import { analyzeFile } from "../analyzer.ts";
import { tmpProject, writeTmpFile } from "./tmp-project.ts";

const UNCACHED_SRC = fileURLToPath(new URL("../analyzer-orchestrate-uncached.ts", import.meta.url));

describe("Bug 1084: 诊断码必须取自 core 的 DIAG 注册表（唯一真理源）", () => {
  it("core 注册表里确有这两个码（service 侧引用的目标存在）", () => {
    expect(DIAG.moduleUnreadable).toBe("nudo:module-unreadable");
    expect(DIAG.jsonInvalid).toBe("nudo:json-invalid");
  });

  it("service 生产面不得再硬编码这两个码的字面量", () => {
    const src = readFileSync(UNCACHED_SRC, "utf8");
    expect(src).not.toContain('"nudo:module-unreadable"');
    expect(src).not.toContain('"nudo:json-invalid"');
    // ……且确实在用注册表项（不是把码删掉了）
    expect(src).toContain("DIAG.moduleUnreadable");
    expect(src).toContain("DIAG.jsonInvalid");
  });

  it("非法 JSON 依赖的诊断码 = DIAG.jsonInvalid（注册表项落到诊断面）", () => {
    const dir = tmpProject("nudo-1084-json-", { "data.json": "{ not json" });
    const file = join(dir, "main.js");
    writeTmpFile(dir, "main.js", `const d = require("./data.json");\nexport function getA() { return d.a; }\n`);
    const r = analyzeFile(file, `const d = require("./data.json");\nexport function getA() { return d.a; }\n`);
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain(DIAG.jsonInvalid);
    // 不得折叠成「文件不存在」——那是另一种事实
    expect(codes).not.toContain(DIAG.moduleMissing);
  });
});
