import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeBufferAwareLoadModule } from "../validation.ts";
import { resolveDefinitionLocations } from "../symbols.ts";
import { parse } from "@nudojs/parser";
import { findIdentifierAtPosition } from "../symbols.ts";

describe("A4 sidecar unsaved buffer", () => {
  it("prefers open buffer text over disk for relative sidecar", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-a4-"));
    try {
      const srcPath = join(dir, "a.js");
      const sidecarPath = join(dir, "a.nudo.js");
      writeFileSync(srcPath, "export function add(x){return x;}\n");
      writeFileSync(sidecarPath, "export const add = number().int();\n");
      const open = "export const add = number().gt(0); // unsaved\n";
      const load = makeBufferAwareLoadModule((p) => (p === sidecarPath ? open : undefined));
      expect(load("./a.nudo.js", srcPath)).toBe(open);
      expect(load(sidecarPath, srcPath)).toBe(open);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to disk when buffer is closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-a4b-"));
    try {
      const srcPath = join(dir, "b.js");
      const sidecarPath = join(dir, "b.nudo.js");
      writeFileSync(srcPath, "export function f(){return 1;}\n");
      writeFileSync(sidecarPath, "export const f = number();\n");
      const load = makeBufferAwareLoadModule(() => undefined);
      const out = load("./b.nudo.js", srcPath);
      expect(out).toContain("number()");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("A5 go-to sidecar contract", () => {
  it("includes sidecar export among definition locations", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-a5-"));
    try {
      const srcPath = join(dir, "add.js");
      const sidecarPath = join(dir, "add.nudo.js");
      const src = "export function add2(x) {\n  return x + 2;\n}\n";
      writeFileSync(srcPath, src);
      writeFileSync(sidecarPath, "export const add2 = number().int();\n");
      const ident = findIdentifierAtPosition(parse(src), 1, 16);
      expect(ident).toBe("add2");
      const locs = resolveDefinitionLocations(srcPath, src, "add2");
      const files = locs.map((d) => d.filePath);
      expect(files).toContain(srcPath);
      expect(files).toContain(sidecarPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
