/**
 * A7：CodeLens `● contract` 与 hover / inlay 同源
 * （design-refine-derivation §8）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHoverAtPosition } from "../lsp-surface.ts";
import { collectAbsInlays } from "@nudojs/core/internal";
import { formatContractTierLine, CONTRACT_SOURCE_ABBR } from "@nudojs/core";
import { computeContractLenses, hoverTool, type ContractLens } from "../agent-tools.ts";

const HANDWRITTEN = `
import { fn, number } from "@nudojs/core";

export const add = fn({ x: number().gt(0) }, number().gt(2));
`;

const loader = (sidecar: string) => (spec: string) =>
  spec.endsWith("lib.nudo.js") ? sidecar : undefined;

const ADD_SRC = `export function add(x) {\n  return x + 2;\n}\n`;

describe("A7 CodeLens ↔ hover 同源", () => {
  it("hover.contractSource equals CodeLens contract lens source", () => {
    const lenses = computeContractLenses(ADD_SRC, "/t/lib.js", {
      loadModule: loader(HANDWRITTEN),
    });
    const lens = lenses.find(
      (l): l is Extract<ContractLens, { kind: "contract" }> =>
        l.kind === "contract",
    );
    expect(lens).toBeDefined();
    const src = lens!.source;

    // hover 在函数名 `add`（L1 C16 起）
    const hover = getHoverAtPosition("/t/lib.js", ADD_SRC, 1, 16, undefined, {
      loadModule: loader(HANDWRITTEN),
    });
    expect(hover?.contractSource).toBe(src);
    expect(hover?.contractDisplay).toBe("(x: number().gt(0)) → number().gt(2)");
    expect(formatContractTierLine(hover!.contractSource!)).toBe(
      `● contract / ${CONTRACT_SOURCE_ABBR[src]}`,
    );
  });

  it("implicit export: lens and hover both say implicit; display omitted", () => {
    const src = `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`;
    const lenses = computeContractLenses(src, "/t/calls.js");
    const lens = lenses.find((l) => l.kind === "contract");
    expect(lens!.kind === "contract" && lens!.source).toBe("implicit");

    const hover = getHoverAtPosition("/t/calls.js", src, 1, 16, undefined, {});
    expect(hover?.contractSource).toBe("implicit");
    expect(hover?.contractDisplay).toBeUndefined();
  });

  it("inlay.contractSource equals lens source", () => {
    const lenses = computeContractLenses(ADD_SRC, "/t/lib.js", {
      loadModule: loader(HANDWRITTEN),
    });
    const iface = lenses.find((l) => l.kind === "contract");
    expect(iface?.kind).toBe("contract");
    const lensSrc = iface!.kind === "contract" ? iface!.source : "";
    const inlays = collectAbsInlays(ADD_SRC, {
      fromFile: "/t/lib.js",
      loadModule: loader(HANDWRITTEN),
    });
    for (const i of inlays) {
      expect(i.contractSource).toBe(lensSrc);
    }
  });

  it("autoBind:false collapses lens + hover to implicit together", () => {
    const lenses = computeContractLenses(ADD_SRC, "/t/lib.js", {
      loadModule: loader(HANDWRITTEN),
      autoBind: false,
    });
    const lens = lenses.find((l) => l.kind === "contract");
    expect(lens!.kind === "contract" && lens!.source).toBe("implicit");

    const hover = getHoverAtPosition("/t/lib.js", ADD_SRC, 1, 16, undefined, {
      loadModule: loader(HANDWRITTEN),
      autoBind: false,
    });
    expect(hover?.contractSource).toBe("implicit");
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

  it("returns contractSource + contractLine matching CodeLens title", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, ADD_SRC);
    writeFileSync(join(dir, "lib.nudo.js"), HANDWRITTEN);

    const r = hoverTool({ file, line: 1, column: 16, includeInlays: true });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.contractSource).toBe("handwritten");
    expect(payload.contractLine).toBe("● contract / hw");
    expect(payload.contractDisplay).toBe("(x: number().gt(0)) → number().gt(2)");
    expect(Array.isArray(payload.inlays)).toBe(true);
    const ret = payload.inlays.find((i: { kind: string }) => i.kind === "type");
    expect(ret.contractSource).toBe("handwritten");
  });

  it("implicit call-site file: contractSource=implicit, contractLine matches", async () => {
    const file = join(dir, "calls.js");
    writeFileSync(
      file,
      `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`,
    );
    const r = hoverTool({ file, line: 1, column: 16 });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.contractSource).toBe("implicit");
    expect(payload.contractLine).toBe("● contract / imp");
    expect(payload.contractDisplay).toBeNull();
  });
});
