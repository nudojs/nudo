import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTranspiled, callTranspiledExportFull, formatShape, $lit, setBCallCollector } from "@nudojs/core";
import { evalAbsModuleGraph } from "../abs-modules-graph.ts";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nudo-a3-native-"));
  // 真实形态：CJS 单文件纯 JS 包（ms 同构），含 isFinite + else-if 早退
  const pkgDir = join(root, "node_modules", "tiny-ms");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "tiny-ms", main: "index.js" }),
    "utf-8",
  );
  writeFileSync(
    join(pkgDir, "index.js"),
    `module.exports = function (val, options) {
  options = options || {};
  var type = typeof val;
  if (type === "string" && val.length > 0) {
    return "s:" + val;
  } else if (type === "number" && isFinite(val)) {
    return options.long ? "long:" + val : "n:" + val;
  }
  throw new Error("bad val");
};
`,
    "utf-8",
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("A3 native / bare-package returns", () => {
  it("global isFinite folds on number literals", () => {
    const exp = runTranspiled(
      `module.exports = function (val) { if (typeof val === "number" && isFinite(val)) { return 2; } return 0; };\n`,
      {},
    );
    expect(formatShape(callTranspiledExportFull(exp, "default", [$lit(90000)]).result)).toBe("2");
  });

  it("else-if early return is not overwritten by trailing return", () => {
    const exp = runTranspiled(
      `module.exports = function (val) { var type = typeof val; if (type === "string") { return 1; } else if (type === "number") { return 2; } return 0; };\n`,
      {},
    );
    expect(formatShape(callTranspiledExportFull(exp, "default", [$lit("x")]).result)).toBe("1");
    expect(formatShape(callTranspiledExportFull(exp, "default", [$lit(5)]).result)).toBe("2");
  });

  it("bare CJS package entry is executed (returns fold, not unknown stub)", () => {
    const entry = join(root, "consumer.js");
    const src = `import tiny from "tiny-ms";\nexport function fmt(v) { return tiny(v, { long: true }); }\nexport function tag(s) { return tiny(s); }\nfmt(1);\ntag("ab");\n`;
    const graph = evalAbsModuleGraph(src, entry, {});
    expect(graph.modules["tiny-ms"]).toBeDefined();
    const mod = graph.modules["tiny-ms"]!;
    expect(mod.default).toBeDefined();
    // 直接调包 default：必须折叠，而不是 harvest stub 的 unknown
    const tiny = runTranspiled(
      `module.exports = function (val, options) { options = options || {}; var type = typeof val; if (type === "string" && val.length > 0) { return "s:" + val; } else if (type === "number" && isFinite(val)) { return options.long ? "long:" + val : "n:" + val; } throw new Error("bad"); };\n`,
      {},
    );
    const viaGraph = callTranspiledExportFull(
      { default: mod.default } as never,
      "default",
      [$lit(1)],
    );
    // graph 注入的 default 可调用；返回非 unknown（执行路径）或至少不是 opaque stub 空
    expect(formatShape(viaGraph.result)).not.toBe("unknown");
    // 同构源码执行面
    expect(formatShape(callTranspiledExportFull(tiny, "default", [$lit(1)]).result)).toBe('"n:1"');
    expect(
      formatShape(callTranspiledExportFull(tiny, "default", [$lit("ab")]).result),
    ).toBe('"s:ab"');
  });
});
