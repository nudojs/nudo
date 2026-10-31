/**
 * BUG-240 回归：依赖图里**裸包说明符也必须成边**。
 *
 * 改前 `extractImportEdges` 直接丢弃裸包说明符 ⇒ `dependents` 缺边 ⇒
 * `computeDirtySet` 拿不到裸包消费者的路径 ⇒ watch / LSP 增量轮整轮跳过
 * （消费者永不重算）。相对依赖与裸包依赖在宿主侧取到同一实现，脏传播口径
 * 必须等价。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { buildModuleGraph, computeDirtySet } from "../analyzer-module-load.ts";
import { tmpProject } from "./tmp-project.ts";

function project(): { dir: string; consumer: string; pkgEntry: string } {
  const dir = tmpProject("nudo-240-", {
    "node_modules/barepkg/package.json": JSON.stringify({
      name: "barepkg",
      version: "1.0.0",
      main: "./index.js",
    }),
    "node_modules/barepkg/index.js": 'exports.v = "world";\n',
    "consumer.js": 'const { v } = require("barepkg");\nmodule.exports = { v };\n',
    "rel-consumer.js": 'const { v } = require("./local.js");\nmodule.exports = { v };\n',
    "local.js": 'exports.v = "world";\n',
  });
  return {
    dir,
    consumer: join(dir, "consumer.js"),
    pkgEntry: join(dir, "node_modules", "barepkg", "index.js"),
  };
}

describe("BUG-240 — 裸包依赖进依赖图（脏传播不缺边）", () => {
  it("裸包入口变更 ⇒ 消费者进脏集", () => {
    const { consumer, pkgEntry } = project();
    const graph = buildModuleGraph([consumer]);
    expect(graph.dependents.get(pkgEntry)?.has(consumer)).toBe(true);
    expect(computeDirtySet(graph.dependents, pkgEntry)).toContain(consumer);
  });

  it("相对路径消费者同口径（对照组，两路都成边）", () => {
    const { dir, consumer, pkgEntry } = project();
    const relConsumer = join(dir, "rel-consumer.js");
    const graph = buildModuleGraph([consumer, relConsumer]);
    expect(graph.dependents.get(pkgEntry)?.has(consumer)).toBe(true);
    expect(graph.dependents.get(join(dir, "local.js"))?.has(relConsumer)).toBe(true);
  });

  it("解析不到的裸包 ⇒ 不进边（不猜）", () => {
    const dir = tmpProject("nudo-240-miss-", {
      "consumer.js": 'require("not-installed-anywhere");\n',
    });
    const graph = buildModuleGraph([join(dir, "consumer.js")]);
    expect(graph.imports.get(join(dir, "consumer.js"))?.size ?? 0).toBe(0);
  });
});
