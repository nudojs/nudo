/**
 * E5：MCP / agent 工具与 LSP 命令 / CLI 同源
 * - AGENT_TOOL_SOURCES 表钉住共享数据源
 * - check ↔ checkSource+serializeCheckJson（CLI --json 同构）
 * - hover ↔ getHoverAtPosition + interfaceTierOf（CodeLens 同源）
 * - test ↔ analyzeFile + serializeCaseJson
 * - contract ↔ interfaceSurface + formatInterfaceSurfaceLine
 * - whatIf / suggestCase 真注入 / 真分析，不旁路
 * - autoBind：项目配置 AND 客户端（客户端不能打开已关闭项）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeFile,
  getHoverAtPosition,
  interfaceSurface,
  formatInterfaceSurfaceLine,
  serializeCaseJson,
} from "@nudojs/service";
import {
  checkSource,
  serializeCheckJson,
  pTrue,
  formatInterfaceTierLine,
  interfaceTierOf,
} from "@nudojs/core";
import {
  AGENT_TOOL_SOURCES,
  resolveProjectAutoBind,
  checkTool,
  hoverTool,
  testTool,
  whatIf,
  suggestCase,
  contractTool,
  computeInterfaceLenses,
} from "../agent-tools.ts";

const HANDWRITTEN = `
import { fn, number } from "@nudojs/core";

export const add = fn({ x: number().gt(0) }, number().gt(2));
`;
const loader = (sidecar: string) => (spec: string) =>
  spec.endsWith("lib.nudo.js") ? sidecar : undefined;

const ADD_SRC = `export function add(x) {\n  return x + 2;\n}\n`;
const CHECK_SRC = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`;
const STD = `
export const positive = number().gt(0);
`;
const stdLoader = (spec: string) => (spec.includes("std.nudo") ? STD : undefined);

describe("E5 AGENT_TOOL_SOURCES 共享数据源表", () => {
  it("pins the shared-source contract for every agent tool", () => {
    expect(AGENT_TOOL_SOURCES.check).toBe("checkSource + serializeCheckJson");
    expect(AGENT_TOOL_SOURCES.hover).toBe("getHoverAtPosition + interfaceTierOf");
    expect(AGENT_TOOL_SOURCES.test).toBe("analyzeFile + serializeCaseJson");
    expect(AGENT_TOOL_SOURCES.contract).toBe(
      "interfaceSurface + formatInterfaceSurfaceLine",
    );
    expect(AGENT_TOOL_SOURCES.whatIf).toBe("injectBindings + analyzeFile");
    expect(AGENT_TOOL_SOURCES.suggestCase).toBe("analyzeFile + buildCaseDirective");
    expect(AGENT_TOOL_SOURCES["contract.emit"]).toBe("emitInterface");
    expect(AGENT_TOOL_SOURCES.codeLens).toBe(
      "computeInterfaceLenses + interfaceTierOf",
    );
  });
});

describe("E5 checkTool ↔ CLI checkSource/serializeCheckJson", () => {
  it("agent check JSON equals direct checkSource+serializeCheckJson", () => {
    const r = checkTool(
      { file: "/t/a.js", source: CHECK_SRC, format: "json", loadModule: stdLoader },
      { readFile: () => CHECK_SRC },
    );
    const fromAgent = JSON.parse(r.content[0].text);
    const direct = serializeCheckJson(
      checkSource("/t/a.js", CHECK_SRC, pTrue, {
        loadModule: stdLoader,
        fromFile: "/t/a.js",
      }),
    );
    expect(fromAgent.version).toBe(direct.version);
    expect(fromAgent.ok).toBe(direct.ok);
    expect(fromAgent.summary).toEqual(direct.summary);
    const agentCodes = fromAgent.issues.map((i: { code: string }) => i.code).sort();
    const directCodes = direct.issues.map((i) => i.code).sort();
    expect(agentCodes).toEqual(directCodes);
  });

  it("autoBind:false project collapses agent check like CLI", () => {
    // handwritten sidecar would enforce x>0; autoBind false → no ambient bind
    const src = `export function add(x) {\n  return x + 2;\n}\nadd(-1);\n`;
    const withBind = checkTool(
      {
        file: "/t/lib.js",
        source: src,
        format: "json",
        loadModule: loader(HANDWRITTEN),
        autoBind: true,
      },
      { readFile: () => src },
    );
    const without = checkTool(
      {
        file: "/t/lib.js",
        source: src,
        format: "json",
        loadModule: loader(HANDWRITTEN),
        autoBind: false,
      },
      { readFile: () => src },
    );
    const a = JSON.parse(withBind.content[0].text);
    const b = JSON.parse(without.content[0].text);
    // 有侧车义务时违规可见；关掉 autoBind 后义务消失（与 CLI 同口径）
    const hasViolation = (j: { issues: { code: string }[] }) =>
      j.issues.some((i) => i.code === "nudo:constraint-violated");
    if (hasViolation(a)) {
      expect(hasViolation(b)).toBe(false);
    } else {
      // 至少两边 ok 一致（无义务时都不因侧车红）
      expect(a.ok).toBe(b.ok);
    }
  });
});

describe("E5 hoverTool ↔ getHoverAtPosition / CodeLens", () => {
  it("payload abs/interfaceSource match getHoverAtPosition + interfaceTierOf", () => {
    const file = "/t/lib.js";
    const hoverDirect = getHoverAtPosition(file, ADD_SRC, 1, 16, undefined, {
      loadModule: loader(HANDWRITTEN),
    });
    const r = hoverTool({
      file,
      line: 1,
      column: 16,
      source: ADD_SRC,
      loadModule: loader(HANDWRITTEN),
    });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.abs).toBe(hoverDirect?.abs ?? null);
    expect(payload.intension).toBe(hoverDirect?.intension ?? null);
    expect(payload.interfaceSource).toBe(hoverDirect?.interfaceSource ?? null);

    const tier = interfaceTierOf(ADD_SRC, "add", file, {
      loadModule: loader(HANDWRITTEN),
    });
    expect(payload.interfaceSource).toBe(tier?.source);
    expect(payload.interfaceLine).toBe(formatInterfaceTierLine(tier!.source));
  });
});

describe("E5 testTool ↔ analyzeFile + serializeCaseJson", () => {
  it("JSON tail matches serializeCaseJson of the same analyzeFile", () => {
    const src = `export function scale(x) { return x + 1; }\n`;
    const r = testTool(
      { file: "/t/scale.js", source: src, format: "json" },
      { readFile: () => src },
    );
    const fromAgent = JSON.parse(r.content[0].text);
    const direct = serializeCaseJson(analyzeFile("/t/scale.js", src), "/t/scale.js");
    expect(fromAgent.version).toBe(direct.version);
    expect(fromAgent.functions.map((f: { name: string }) => f.name)).toEqual(
      direct.functions.map((f) => f.name),
    );
    const agentCase = fromAgent.functions[0].cases[0];
    const directCase = direct.functions[0]!.cases[0]!;
    expect(agentCase.name).toBe(directCase.name);
    expect(agentCase.intension?.abs).toBe(directCase.intension?.abs);
  });
});

describe("E5 contractTool ↔ interfaceSurface / CodeLens / interfaceTierOf", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-e5-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("printed lines match formatInterfaceSurfaceLine(interfaceSurface)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, ADD_SRC);
    writeFileSync(join(dir, "lib.nudo.js"), HANDWRITTEN);

    const r = await contractTool({ file });
    const text = r.content[0].text;
    const entries = await interfaceSurface(file, { loadModule: undefined });
    // disk truth: default loadModule reads real sidecar
    for (const e of entries) {
      expect(text).toContain(formatInterfaceSurfaceLine(e));
    }
  });

  it("contractTool source equals CodeLens lens source (same tier)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, ADD_SRC);
    writeFileSync(join(dir, "lib.nudo.js"), HANDWRITTEN);
    const loadModule = loader(HANDWRITTEN);

    const r = await contractTool({ file, functionName: "add", loadModule });
    const payloadLine = r.content[0].text
      .split("\n")
      .find((l) => l.includes("[handwritten]") || l.includes("[generated]") || l.includes("[implicit]"));
    const lenses = computeInterfaceLenses(ADD_SRC, file, { loadModule });
    const lens = lenses.find((l) => l.kind === "interface");
    expect(lens!.kind === "interface" && lens!.source).toBe("handwritten");
    expect(payloadLine).toContain(`[${lens!.kind === "interface" ? lens!.source : ""}]`);
  });
});

describe("E5 whatIf / suggestCase 真语义（不旁路）", () => {
  it("whatIf binding injection changes inferred Abs of target", () => {
    const src = `const x = 1;\nconst y = x + 1;\n`;
    const base = whatIf(
      { file: "/t/w.js", bindings: [], target: "y", source: src },
      { readFile: () => src },
    );
    const assumed = whatIf(
      {
        file: "/t/w.js",
        bindings: [{ name: "x", type: "string" }],
        target: "y",
        source: src,
      },
      { readFile: () => src },
    );
    const baseText = base.content[0].text;
    const assumedText = assumed.content[0].text;
    expect(baseText).not.toBe(assumedText);
    expect(assumedText).toContain("Bindings applied");
  });

  it("suggestCase cases equal analyzeFile cases for synthesized path", () => {
    const src = `
export function add(a, b) {
  return a + b;
}
add(1, 2);
add("a", "b");
`;
    const result = analyzeFile("/t/s.js", src);
    const fn = result.functions.find((f) => f.name === "add");
    expect(fn).toBeDefined();
    const r = suggestCase(
      { file: "/t/s.js", functionName: "add", source: src },
      { readFile: () => src },
    );
    const text = r.content[0].text;
    if (fn!.cases.every((c) => c.source === "callsite") && fn!.cases.length > 0) {
      expect(text).toContain("suggested directives");
      expect(text).toContain("@nudo:case");
    } else if (fn!.cases.length > 0) {
      expect(text).toContain(`already has ${fn!.cases.length} case`);
    }
  });
});

describe("E5 resolveProjectAutoBind", () => {
  it("defaults true when no project config; client cannot open a false project", () => {
    expect(resolveProjectAutoBind("/tmp/nudo-e5-no-pkg/x.js")).toBe(true);
    expect(resolveProjectAutoBind("/tmp/nudo-e5-no-pkg/x.js", true)).toBe(true);
    expect(resolveProjectAutoBind("/tmp/nudo-e5-no-pkg/x.js", false)).toBe(false);
  });

  it("package.json nudo.contract.autoBind:false wins over client true", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-e5-pkg-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "t", nudo: { contract: { autoBind: false } } }),
      );
      writeFileSync(join(dir, "src", "lib.js"), ADD_SRC);
      expect(resolveProjectAutoBind(join(dir, "src", "lib.js"), true)).toBe(false);
      expect(resolveProjectAutoBind(join(dir, "src", "lib.js"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
