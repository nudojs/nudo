/**
 * E5/F6：agent `nudo.contract.draft` 与 CLI `--draft` 同源。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_TOOL_SOURCES, contractDraftTool } from "../agent-tools.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-agent-draft-"));
  // 写盘路径与 CLI 对齐：需要项目根（package.json / nudo 配置祖先）
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "nudo-draft-fixture", version: "1.0.0", nudo: {} }),
  );
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("nudo.contract.draft agent tool", () => {
  it("prints draft module text (same source as CLI --draft)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`);
    const r = await contractDraftTool({ file });
    const text = r.content[0].text;
    expect(text).toContain("double");
    expect(text).toContain("draft callsite/");
    expect(text).toContain("@nudo:draft");
    expect(text).toContain("export const double = ");
  });

  it("write lands *.nudo.draft.js only", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`);
    const r = await contractDraftTool({ file, write: true });
    expect(r.content[0].text).toContain("Draft written →");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
  });

  it("write without project root is fail-closed (CLI-aligned)", async () => {
    const isolated = mkdtempSync(join(tmpdir(), "nudo-draft-noroot-"));
    const prevForce = process.env.NUDO_DRAFT_FORCE;
    delete process.env.NUDO_DRAFT_FORCE;
    try {
      const file = join(isolated, "lib.js");
      writeFileSync(file, `export function double(x) {\n  return x * 2;\n}\n\ndouble(21);\n`);
      const r = await contractDraftTool(
        { file, write: true },
        { workspaceRoots: [isolated] },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("no project root found");
      expect(r.content[0].text).toContain("NUDO_DRAFT_FORCE=1");
      expect(existsSync(join(isolated, "lib.nudo.draft.js"))).toBe(false);
    } finally {
      if (prevForce !== undefined) process.env.NUDO_DRAFT_FORCE = prevForce;
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it("write outside workspace roots is rejected (fail-closed, same as emit)", async () => {
    const outside = mkdtempSync(join(tmpdir(), "nudo-draft-outside-"));
    try {
      writeFileSync(
        join(outside, "package.json"),
        JSON.stringify({ name: "outside", version: "1.0.0" }),
      );
      const file = join(outside, "evil.js");
      writeFileSync(file, `export function f(x) { return x; }\n`);
      const r = await contractDraftTool(
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
    const r = await contractDraftTool({ file, write: true }, { workspaceRoots: [dir] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("not an analysis target");
  });

  it("pins shared source table entry", () => {
    expect(AGENT_TOOL_SOURCES["contract.draft"]).toBe(
      "draftInterface + formatDraftSummary",
    );
  });
});
