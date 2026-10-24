/**
 * Bug 499 回归：**依赖模块不可读（EACCES）**不得被折叠成「文件不存在」。
 *
 * 本分片在 service 侧提供两件东西（根因行的其余消费点在 core / nudojs 侧，
 * 见交付报告的「越界」段）：
 * - `loadModuleOutcome`：三态结果（ok / missing / unreadable）——模块图侧
 *   据此把「不可读」报成不可读，而不是「Module file not found」。
 * - `guardedLoadModule`：宿主 loader 的容错包装——读失败退化为「该依赖不可用」
 *   + 一次性可见告警，**不得让异常穿透到 CLI 顶层**（整轮分析被带走）。
 */
import { describe, it, expect, vi } from "vitest";
import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import {
  loadModuleOutcome,
  guardedLoadModule,
  ModuleReadError,
} from "../load-module.ts";
import { evalAbsModuleGraph, clearAbsModuleCache } from "../abs-modules-graph.ts";
import { tmpProject } from "./tmp-project.ts";

/** root 对 chmod 000 免疫，真实 EACCES 用例无法生效 */
const isRoot = process.geteuid?.() === 0;

describe("Bug 499 — 不可读依赖：missing 与 unreadable 必须分开", () => {
  it("不存在的依赖 → missing（不是 unreadable）", () => {
    const dir = tmpProject("nudo-499-missing-");
    const from = join(dir, "main.js");
    writeFileSync(from, "", "utf-8");
    expect(loadModuleOutcome("./nope.js", from).kind).toBe("missing");
  });

  it("可读依赖 → ok（路径 + 内容）", () => {
    const dir = tmpProject("nudo-499-ok-");
    const from = join(dir, "main.js");
    writeFileSync(from, "", "utf-8");
    writeFileSync(join(dir, "dep.js"), "export const x = 1;\n", "utf-8");
    const r = loadModuleOutcome("./dep.js", from);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.content).toContain("export const x");
  });

  it.runIf(!isRoot)("存在但不可读 → unreadable（带 errno 与路径），不得报成 missing", () => {
    const dir = tmpProject("nudo-499-eacces-");
    const from = join(dir, "main.js");
    const dep = join(dir, "dep.js");
    writeFileSync(from, "", "utf-8");
    writeFileSync(dep, "export const x = 1;\n", "utf-8");
    chmodSync(dep, 0o000);
    try {
      const r = loadModuleOutcome("./dep.js", from);
      expect(r.kind).toBe("unreadable");
      if (r.kind === "unreadable") {
        expect(r.code).toBe("EACCES");
        expect(r.path).toBe(dep);
        expect(r.message).toContain("permission denied");
      }
    } finally {
      chmodSync(dep, 0o644);
    }
  });

  it("guardedLoadModule：loader 抛错 → undefined + 一次性可见告警（不穿透）", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dep = "/nudo-499-guarded/dep.js";
    const failures: { path: string; code: string }[] = [];
    const guarded = guardedLoadModule(
      () => {
        throw new ModuleReadError(
          dep,
          Object.assign(new Error(`EACCES: permission denied, open '${dep}'`), { code: "EACCES" }),
        );
      },
      (f) => failures.push({ path: f.path, code: f.code }),
    );
    try {
      expect(guarded("./dep.js", "/nudo-499-guarded/main.js")).toBeUndefined();
      expect(guarded("./dep.js", "/nudo-499-guarded/main.js")).toBeUndefined();
      // 同一路径只告警一次（防刷屏），但失败回调每次都到（供诊断聚合）
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(String(errSpy.mock.calls[0]?.[0])).toContain("EACCES");
      expect(failures.length).toBe(2);
      expect(failures[0]?.path).toBe(dep);
      expect(failures[0]?.code).toBe("EACCES");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("负控制：ENOENT 与正常返回不受 guarded 包装影响", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const guardedMissing = guardedLoadModule(() => {
        throw new ModuleReadError(
          "/nudo-499-guarded/gone.js",
          Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }),
        );
      });
      expect(guardedMissing("./gone.js", "/t/main.js")).toBeUndefined();
      const guardedOk = guardedLoadModule(() => "export const x = 1;");
      expect(guardedOk("./dep.js", "/t/main.js")).toBe("export const x = 1;");
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.runIf(!isRoot)("模块图侧：不可读依赖报 unreadable（不得折叠成 missing）", () => {
    // abs-modules-graph 的 readFirstRel 与 loadModuleOutcome 同口径（三态）：
    // 依赖文件在但读不了 ⇒ issue kind = "unreadable"（诊断码
    // nudo:module-unreadable），不是 "missing"（那会说「文件不存在」）。
    const dir = tmpProject("nudo-499-graph-eacces-");
    const from = join(dir, "main.js");
    const dep = join(dir, "dep.js");
    const src = `import { x } from "./dep.js";\nexport const y = x;\n`;
    writeFileSync(from, src, "utf-8");
    writeFileSync(dep, "export const x = 1;\n", "utf-8");
    chmodSync(dep, 0o000);
    try {
      clearAbsModuleCache();
      const graph = evalAbsModuleGraph(src, from);
      const kinds = graph.issues.map((i) => i.kind);
      expect(kinds).toContain("unreadable");
      expect(kinds).not.toContain("missing");
    } finally {
      chmodSync(dep, 0o644);
    }
  });
});
