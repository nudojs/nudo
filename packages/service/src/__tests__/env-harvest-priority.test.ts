/**
 * B8 priority pin — handwritten `@nudojs/env` wins over harvest on
 * overlapping module keys / export names; harvest fills only missing slots.
 */
import { describe, it, expect } from "vitest";
import type { Abs, AbsModuleExports } from "@nudojs/core";
import { abs, unknown } from "@nudojs/core";
import { mergeHarvestUnderEnv, collectEnvModules } from "../bpath-run.ts";

function absTag(tag: string): Abs {
  return abs({ k: "brand", name: tag, shape: unknown }, undefined, undefined, "path");
}

describe("mergeHarvestUnderEnv — handwritten env wins (B8)", () => {
  it("env export overwrites harvest export on the same module key", () => {
    const harvest: Record<string, AbsModuleExports> = {
      path: { named: { join: absTag("harvest.join"), dirname: absTag("harvest.dirname") } },
    };
    const env: Record<string, AbsModuleExports> = {
      path: { named: { join: absTag("env.join") } },
    };
    const merged = mergeHarvestUnderEnv(harvest, env);
    expect(merged.path!.named.join).toBe(env.path!.named.join);
    // harvest-only slot kept as fill-in
    expect(merged.path!.named.dirname).toBe(harvest.path!.named.dirname);
  });

  it("env default wins when both sides provide default", () => {
    const harvest: Record<string, AbsModuleExports> = {
      ms: { named: {}, default: absTag("harvest.default") },
    };
    const env: Record<string, AbsModuleExports> = {
      ms: { named: { parse: absTag("env.parse") }, default: absTag("env.default") },
    };
    const merged = mergeHarvestUnderEnv(harvest, env);
    expect(merged.ms!.default).toBe(env.ms!.default);
    expect(merged.ms!.named.parse).toBe(env.ms!.named.parse);
  });

  it("harvest default is kept when env has none", () => {
    const harvest: Record<string, AbsModuleExports> = {
      pkg: { named: { a: absTag("h.a") }, default: absTag("h.default") },
    };
    const env: Record<string, AbsModuleExports> = {
      pkg: { named: { b: absTag("e.b") } },
    };
    const merged = mergeHarvestUnderEnv(harvest, env);
    expect(merged.pkg!.default).toBe(harvest.pkg!.default);
    expect(merged.pkg!.named.b).toBe(env.pkg!.named.b);
  });

  it("modules only in harvest or only in env are both present", () => {
    const harvest: Record<string, AbsModuleExports> = {
      commander: { named: { Command: absTag("h.Command") } },
    };
    const env: Record<string, AbsModuleExports> = {
      "node:path": { named: { join: absTag("e.join") } },
    };
    const merged = mergeHarvestUnderEnv(harvest, env);
    expect(merged.commander!.named.Command).toBeDefined();
    expect(merged["node:path"]!.named.join).toBeDefined();
  });

  it("collectEnvModules(node) join identity survives under a fake harvest path module", () => {
    const envMods = collectEnvModules(["node"]);
    const envJoin = envMods["node:path"]?.named.join ?? envMods["path"]?.named.join;
    expect(envJoin, "handwritten node env must expose path.join").toBeTruthy();
    const harvest: Record<string, AbsModuleExports> = {
      path: { named: { join: absTag("harvest.join"), resolve: absTag("harvest.resolve") } },
      "node:path": { named: { join: absTag("harvest.node.join") } },
    };
    const merged = mergeHarvestUnderEnv(harvest, envMods);
    if (envMods["node:path"]) {
      expect(merged["node:path"]!.named.join).toBe(envMods["node:path"]!.named.join);
    }
    if (envMods["path"]) {
      expect(merged.path!.named.join).toBe(envMods["path"]!.named.join);
    }
  });
});
