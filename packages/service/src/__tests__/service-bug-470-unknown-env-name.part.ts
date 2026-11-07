/**
 * Bug 470 — `@nudo:env <未知名>`（bogus / nodejs / Node）被静默忽略：
 * 零诊断、env 不生效、分析退化。
 *
 * 契约：未知名 env 必须产出一条**可见**诊断（nudo:env-unresolved 通道，
 * CLI check/test 与 LSP 同源消费），不得静默 `continue`；
 * 合法内建名（es / web / node）不受影响（负控制）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createEnvironment } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";
import {
  loadEnvs,
  preloadPathEnvs,
  getPathEnvLoadErrors,
  clearPathEnvCaches,
} from "../evaluator/env-loader.ts";

beforeEach(() => {
  clearPathEnvCaches();
});

describe("Bug 470 — 未知名 env 不得静默忽略", () => {
  it("loadEnvs：未知名产出可见诊断且不注入任何全局", () => {
    for (const name of ["bogus", "nodejs", "Node"]) {
      const dir = tmpProject("nudo-bug-470-");
      const loaded = loadEnvs([name], createEnvironment(), dir);
      expect(Object.keys(loaded.globals)).toHaveLength(0);
      const errs = getPathEnvLoadErrors(dir);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.error).toContain(`unknown env name "${name}"`);
      // 诊断必须列出合法名（用户据此自查拼写）
      expect(errs[0]!.error).toContain("es, web, node");
    }
  });

  it("preload 通道同样可见（CLI check 的诊断来源）", async () => {
    const dir = tmpProject("nudo-bug-470-preload-");
    await preloadPathEnvs(["bogus"], dir);
    const errs = getPathEnvLoadErrors(dir);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.error).toContain('unknown env name "bogus"');
    expect(errs[0]!.baseDir).toBe(dir);
  });

  it("原型键（constructor）不得取到 Object 构造器并炸掉", () => {
    const dir = tmpProject("nudo-bug-470-proto-");
    const loaded = loadEnvs(["constructor"], createEnvironment(), dir);
    expect(Object.keys(loaded.globals)).toHaveLength(0);
    const errs = getPathEnvLoadErrors(dir);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.error).toContain('unknown env name "constructor"');
  });

  it("负控制：合法内建名（node / es）照常生效且零诊断", () => {
    const dir = tmpProject("nudo-bug-470-ok-");
    const node = loadEnvs(["node"], createEnvironment(), dir);
    expect(Object.keys(node.globals).length).toBeGreaterThan(0);
    expect(getPathEnvLoadErrors(dir)).toHaveLength(0);

    const es = loadEnvs(["es"], createEnvironment(), dir);
    expect(Object.keys(es.globals).length).toBeGreaterThan(0);
    expect(getPathEnvLoadErrors(dir)).toHaveLength(0);
  });

  it("负控制：内建名的依赖展开（web ⇒ es）不被误判为未知名", () => {
    const dir = tmpProject("nudo-bug-470-deps-");
    const loaded = loadEnvs(["web"], createEnvironment(), dir);
    expect(Object.keys(loaded.globals).length).toBeGreaterThan(0);
    expect(getPathEnvLoadErrors(dir)).toHaveLength(0);
  });
});
