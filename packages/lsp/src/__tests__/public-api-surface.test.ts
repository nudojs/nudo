/**
 * A7 — protocol / command consistency regression.
 * Pins the freeze inventory so public surface drift fails CI, not 1.x later.
 *
 * See packages/lsp/PUBLIC_API.md and src/public-api.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  NUDO_EXECUTE_COMMANDS,
  NUDO_SLASH_REQUESTS,
  NUDO_AGENT_TOOL_NAMES,
  NUDO_INITIALIZE_CAPABILITIES,
  NUDO_LSP_PACKAGE_SURFACE,
  slashToExecuteCommand,
} from "../public-api.ts";
import { AGENT_TOOL_SOURCES } from "../agent-tools.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicApiMd = readFileSync(join(here, "..", "..", "PUBLIC_API.md"), "utf-8");
const serverTs = readFileSync(join(here, "..", "server.ts"), "utf-8");
const lspPkg = JSON.parse(
  readFileSync(join(here, "..", "..", "package.json"), "utf-8"),
) as {
  name: string;
  bin: Record<string, string>;
  exports: Record<string, unknown>;
  files: string[];
};

describe("A7 public-api inventory — executeCommand ⊇ slash-form", () => {
  it("every slash-form request has a matching executeCommand name", () => {
    const commands = new Set<string>(NUDO_EXECUTE_COMMANDS);
    for (const slash of NUDO_SLASH_REQUESTS) {
      expect(commands.has(slashToExecuteCommand(slash) as (typeof NUDO_EXECUTE_COMMANDS)[number])).toBe(
        true,
      );
    }
  });

  it("slash form uses nudo/ prefix; executeCommand uses nudo. prefix", () => {
    for (const slash of NUDO_SLASH_REQUESTS) {
      expect(slash.startsWith("nudo/")).toBe(true);
      expect(slashToExecuteCommand(slash).startsWith("nudo.")).toBe(true);
    }
    for (const cmd of NUDO_EXECUTE_COMMANDS) {
      expect(cmd.startsWith("nudo.")).toBe(true);
    }
  });

  it("executeCommand inventory uses product names only (no aliases)", () => {
    expect(NUDO_EXECUTE_COMMANDS).not.toContain("nudo.infer");
    expect(NUDO_EXECUTE_COMMANDS).not.toContain("nudo.interface");
    expect(NUDO_EXECUTE_COMMANDS).not.toContain("nudo.interfaceDraft");
    expect(NUDO_EXECUTE_COMMANDS).not.toContain("nudo.interfaceEmit");
    expect(NUDO_EXECUTE_COMMANDS).not.toContain("nudo.interface.draft");
    expect(NUDO_EXECUTE_COMMANDS).not.toContain("nudo.interface.emit");
    expect(NUDO_EXECUTE_COMMANDS).toContain("nudo.test");
    expect(NUDO_EXECUTE_COMMANDS).toContain("nudo.contract");
    expect(NUDO_EXECUTE_COMMANDS).toContain("nudo.contract.draft");
    expect(NUDO_EXECUTE_COMMANDS).toContain("nudo.contract.emit");
  });

  it("inventory is documented in PUBLIC_API.md", () => {
    for (const cmd of NUDO_EXECUTE_COMMANDS) {
      expect(publicApiMd).toContain(cmd);
    }
    for (const slash of NUDO_SLASH_REQUESTS) {
      expect(publicApiMd).toContain(slash);
    }
  });
});

describe("A7 AGENT_TOOL_SOURCES ↔ documented agent tools", () => {
  it("every documented agent tool name exists in AGENT_TOOL_SOURCES", () => {
    for (const name of NUDO_AGENT_TOOL_NAMES) {
      expect(AGENT_TOOL_SOURCES).toHaveProperty(name);
    }
  });

  it("AGENT_TOOL_SOURCES keys are exactly documented tools + codeLens", () => {
    const keys = Object.keys(AGENT_TOOL_SOURCES).sort();
    const expected = [...NUDO_AGENT_TOOL_NAMES, "codeLens"].sort();
    expect(keys).toEqual(expected);
  });

  it("agent tool commands are on the executeCommand inventory", () => {
    const commands = new Set<string>(NUDO_EXECUTE_COMMANDS);
    for (const name of NUDO_AGENT_TOOL_NAMES) {
      expect(commands.has(`nudo.${name}` as (typeof NUDO_EXECUTE_COMMANDS)[number])).toBe(true);
    }
  });

  it("PUBLIC_API.md lists AGENT_TOOL_SOURCES values", () => {
    for (const source of Object.values(AGENT_TOOL_SOURCES)) {
      expect(publicApiMd).toContain(source);
    }
  });
});

describe("A7 package surface + initialize keys", () => {
  it("public-api package surface matches package.json", () => {
    expect(lspPkg.name).toBe(NUDO_LSP_PACKAGE_SURFACE.name);
    expect(lspPkg.bin[NUDO_LSP_PACKAGE_SURFACE.bin]).toBe(NUDO_LSP_PACKAGE_SURFACE.entryPath);
    expect(lspPkg.files).toEqual([...NUDO_LSP_PACKAGE_SURFACE.files]);
    expect(lspPkg.exports["."]).toBeDefined();
    expect(lspPkg.exports[NUDO_LSP_PACKAGE_SURFACE.publicApiExport]).toBeDefined();
  });

  it("initialize capability keys are documented", () => {
    for (const key of NUDO_INITIALIZE_CAPABILITIES) {
      expect(publicApiMd).toContain(key);
    }
  });
});

describe("A7 server.ts dispatch/request registration matches inventory", () => {
  it("every executeCommand name appears as a dispatch case in server.ts", () => {
    for (const cmd of NUDO_EXECUTE_COMMANDS) {
      expect(serverTs, `server.ts missing dispatch case for ${cmd}`).toContain(`case "${cmd}"`);
    }
  });

  it("agent slash requests are registered via public-api inventory", () => {
    // Editor commands registered explicitly
    for (const slash of ["nudo/selectCase", "nudo/getActiveCases"]) {
      expect(serverTs, `server.ts missing onRequest("${slash}")`).toContain(
        `onRequest("${slash}"`,
      );
    }
    // Agent tools must register from NUDO_AGENT_TOOL_NAMES (not a second hardcoded list)
    expect(serverTs).toMatch(
      /import \{ NUDO_EXECUTE_COMMANDS, NUDO_AGENT_TOOL_NAMES \} from "\.\/public-api\.ts"/,
    );
    expect(serverTs).toMatch(/for \(const name of NUDO_AGENT_TOOL_NAMES\)/);
    // Inventory names still exist and map to executeCommand + slash spellings
    const commands = new Set<string>(NUDO_EXECUTE_COMMANDS);
    for (const name of NUDO_AGENT_TOOL_NAMES) {
      expect(commands.has(`nudo.${name}` as (typeof NUDO_EXECUTE_COMMANDS)[number])).toBe(true);
    }
  });

  it("NUDO_COMMANDS is sourced from public-api inventory", () => {
    expect(serverTs).toMatch(/import \{ NUDO_EXECUTE_COMMANDS[^}]*\} from "\.\/public-api\.ts"/);
    expect(serverTs).toMatch(/const NUDO_COMMANDS = NUDO_EXECUTE_COMMANDS/);
  });
});
