/**
 * E5/F6：agent `nudo.interface.draft` 与 CLI `--draft` 同源。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_TOOL_SOURCES, interfaceDraftTool } from "../agent-tools.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-agent-draft-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("nudo.interface.draft agent tool", () => {
  it("prints draft module text (same source as CLI --draft)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`);
    const r = await interfaceDraftTool({ file });
    const text = r.content[0].text;
    expect(text).toContain("double");
    expect(text).toContain("draft callsite/");
    expect(text).toContain("@nudo:draft");
    expect(text).toContain("export const double = ");
  });

  it("write lands *.nudo.draft.js only", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`);
    const r = await interfaceDraftTool({ file, write: true });
    expect(r.content[0].text).toContain("Draft written →");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
  });

  it("write outside workspace roots is rejected (fail-closed, same as emit)", async () => {
    const outside = mkdtempSync(join(tmpdir(), "nudo-draft-outside-"));
    try {
      const file = join(outside, "evil.js");
      writeFileSync(file, `export function f(x) { return x; }\n`);
      const r = await interfaceDraftTool(
        { file, write: true },
        { workspaceRoots: [dir] },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("outside allowed roots");
      expect(existsSync(join(outside, "evil.nudo.draft.js"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("write of non-target path is rejected", async () => {
    const file = join(dir, "contract.nudo.js");
    writeFileSync(file, `export const f = fn({}, unknown());\n`);
    const r = await interfaceDraftTool({ file, write: true }, { workspaceRoots: [dir] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("not an analysis target");
  });

  it("pins shared source table entry", () => {
    expect(AGENT_TOOL_SOURCES["interface.draft"]).toBe(
      "draftInterface + formatDraftSummary",
    );
  });
});
