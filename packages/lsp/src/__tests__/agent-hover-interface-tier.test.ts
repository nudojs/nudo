/**
 * A7：CodeLens `● interface` 与 hover / inlay 同源
 * （design-refine-derivation §8）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHoverAtPosition } from "@nudojs/service";
import { collectAbsInlays } from "@nudojs/core/internal";
import { formatInterfaceTierLine } from "@nudojs/core";
import { computeInterfaceLenses, hoverTool } from "../agent-tools.ts";

const HANDWRITTEN = `
import { fn, number } from "@nudojs/core";

export const add = fn({ x: number().gt(0) }, number().gt(2));
`;

const loader = (sidecar: string) => (spec: string) =>
  spec.endsWith("lib.nudo.js") ? sidecar : undefined;

const ADD_SRC = `export function add(x) {\n  return x + 2;\n}\n`;

describe("A7 CodeLens ↔ hover 同源", () => {
  it("hover.interfaceSource equals CodeLens interface lens source", () => {
    const lenses = computeInterfaceLenses(ADD_SRC, "/t/lib.js", {
      loadModule: loader(HANDWRITTEN),
    });
    const lens = lenses.find((l) => l.kind === "interface");
    expect(lens).toBeDefined();
    const src = lens!.kind === "interface" ? lens!.source : "";

    // hover 在函数名 `add`（L1 C16 起）
    const hover = getHoverAtPosition("/t/lib.js", ADD_SRC, 1, 16, undefined, {
      loadModule: loader(HANDWRITTEN),
    });
    expect(hover?.interfaceSource).toBe(src);
    expect(hover?.interfaceDisplay).toBe("(x: number().gt(0)) → number().gt(2)");
    expect(formatInterfaceTierLine(hover!.interfaceSource!)).toBe(
      `● interface / ${src}`,
    );
  });

  it("implicit export: lens and hover both say implicit; display omitted", () => {
    const src = `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`;
    const lenses = computeInterfaceLenses(src, "/t/calls.js");
    const lens = lenses.find((l) => l.kind === "interface");
    expect(lens!.kind === "interface" && lens!.source).toBe("implicit");

    const hover = getHoverAtPosition("/t/calls.js", src, 1, 16, undefined, {});
    expect(hover?.interfaceSource).toBe("implicit");
    expect(hover?.interfaceDisplay).toBeUndefined();
  });

  it("inlay.interfaceSource equals lens source", () => {
    const lenses = computeInterfaceLenses(ADD_SRC, "/t/lib.js", {
      loadModule: loader(HANDWRITTEN),
    });
    const iface = lenses.find((l) => l.kind === "interface");
    expect(iface?.kind).toBe("interface");
    const lensSrc = iface!.kind === "interface" ? iface!.source : "";
    const inlays = collectAbsInlays(ADD_SRC, {
      fromFile: "/t/lib.js",
      loadModule: loader(HANDWRITTEN),
    });
    for (const i of inlays) {
      expect(i.interfaceSource).toBe(lensSrc);
    }
  });

  it("autoBind:false collapses lens + hover to implicit together", () => {
    const lenses = computeInterfaceLenses(ADD_SRC, "/t/lib.js", {
      loadModule: loader(HANDWRITTEN),
      autoBind: false,
    });
    const lens = lenses.find((l) => l.kind === "interface");
    expect(lens!.kind === "interface" && lens!.source).toBe("implicit");

    const hover = getHoverAtPosition("/t/lib.js", ADD_SRC, 1, 16, undefined, {
      loadModule: loader(HANDWRITTEN),
      autoBind: false,
    });
    expect(hover?.interfaceSource).toBe("implicit");
  });
});

describe("A7 agent hoverTool payload 同源", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-a7-hover-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns interfaceSource + interfaceLine matching CodeLens title", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, ADD_SRC);
    writeFileSync(join(dir, "lib.nudo.js"), HANDWRITTEN);

    const r = hoverTool({ file, line: 1, column: 16, includeInlays: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.interfaceSource).toBe("handwritten");
    expect(payload.interfaceLine).toBe("● interface / handwritten");
    expect(payload.interfaceDisplay).toBe("(x: number().gt(0)) → number().gt(2)");
    expect(Array.isArray(payload.inlays)).toBe(true);
    const ret = payload.inlays.find((i: { kind: string }) => i.kind === "type");
    expect(ret.interfaceSource).toBe("handwritten");
  });

  it("implicit call-site file: interfaceSource=implicit, interfaceLine matches", async () => {
    const file = join(dir, "calls.js");
    writeFileSync(
      file,
      `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`,
    );
    const r = hoverTool({ file, line: 1, column: 16 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.interfaceSource).toBe("implicit");
    expect(payload.interfaceLine).toBe("● interface / implicit");
    expect(payload.interfaceDisplay).toBeNull();
  });
});
