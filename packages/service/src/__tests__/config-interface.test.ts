import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findProjectConfig,
  interfaceConfig,
  matchesEmitAllowlist,
  type NudoConfig,
} from "../evaluator/config.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("interfaceConfig", () => {
  it("defaults when config is null/undefined or lacks the interface key", () => {
    expect(interfaceConfig(undefined)).toEqual({ autoBind: true, emit: [] });
    expect(interfaceConfig(null)).toEqual({ autoBind: true, emit: [] });
    expect(interfaceConfig({})).toEqual({ autoBind: true, emit: [] });
    const legacy: NudoConfig = { env: ["es"], mocks: { fetch: "stub" } };
    expect(interfaceConfig(legacy)).toEqual({ autoBind: true, emit: [] });
  });

  it("defaults when interface key is present but empty", () => {
    expect(interfaceConfig({ interface: {} })).toEqual({ autoBind: true, emit: [] });
  });

  it("reads explicit autoBind", () => {
    const config: NudoConfig = { interface: { autoBind: false } };
    expect(interfaceConfig(config)).toEqual({ autoBind: false, emit: [] });
  });

  it("reads emit allowlist as string or array (Phase 3 §7.3)", () => {
    expect(interfaceConfig({ interface: { emit: "src/api/**" } })).toEqual({
      autoBind: true,
      emit: ["src/api/**"],
    });
    expect(interfaceConfig({ interface: { emit: ["src/api/**", "lib/*.js"] } })).toEqual({
      autoBind: true,
      emit: ["src/api/**", "lib/*.js"],
    });
    expect(interfaceConfig({ interface: { emit: [] } })).toEqual({
      autoBind: true,
      emit: [],
    });
  });

  it("ignores unknown keys in the interface section", () => {
    const malformed = { interface: { ignore: ["dist/**"] } } as unknown as NudoConfig;
    expect(interfaceConfig(malformed)).toEqual({ autoBind: true, emit: [] });
  });
});

describe("matchesEmitAllowlist", () => {
  const projectDir = "/proj";

  it("empty allowlist allows everything", () => {
    expect(matchesEmitAllowlist("/proj/src/a.js", projectDir, [])).toBe(true);
  });

  it("matches ** and * globs relative to projectDir", () => {
    expect(matchesEmitAllowlist("/proj/src/api/add.js", projectDir, ["src/api/**"])).toBe(true);
    expect(matchesEmitAllowlist("/proj/src/util/x.js", projectDir, ["src/api/**"])).toBe(false);
    expect(matchesEmitAllowlist("/proj/lib/a.js", projectDir, ["lib/*.js"])).toBe(true);
    expect(matchesEmitAllowlist("/proj/lib/nested/a.js", projectDir, ["lib/*.js"])).toBe(false);
  });

  it("does not treat trailing ** as a prefix smear (src/** ⊄ srcX)", () => {
    expect(matchesEmitAllowlist("/proj/src/a.js", projectDir, ["src/**"])).toBe(true);
    expect(matchesEmitAllowlist("/proj/src/nested/a.js", projectDir, ["src/**"])).toBe(true);
    expect(matchesEmitAllowlist("/proj/srcX/a.js", projectDir, ["src/**"])).toBe(false);
    expect(matchesEmitAllowlist("/proj/src", projectDir, ["src/**"])).toBe(false);
    expect(matchesEmitAllowlist("/proj/a.js", projectDir, ["**/*.js"])).toBe(true);
    expect(matchesEmitAllowlist("/proj/x/a.js", projectDir, ["**/*.js"])).toBe(true);
    expect(matchesEmitAllowlist("/proj/a.jsx", projectDir, ["**/*.js"])).toBe(false);
  });

  it("rejects paths outside projectDir", () => {
    expect(matchesEmitAllowlist("/other/src/a.js", projectDir, ["src/**"])).toBe(false);
  });
});

describe("findProjectConfig with interface key", () => {
  it("finds package.json upward across directory levels and reads its interface section", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-iface-cfg-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "iface-fixture",
        nudo: { interface: { autoBind: false, emit: ["src/**"] } },
      }),
    );
    const deep = join(root, "packages", "lib", "src");
    mkdirSync(deep, { recursive: true });

    const found = findProjectConfig(deep);
    expect(found?.projectDir).toBe(root);
    expect(interfaceConfig(found?.config)).toEqual({ autoBind: false, emit: ["src/**"] });
  });

  it("package.json without a nudo key yields null config and default interface settings", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-iface-plain-"));
    dirs.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "plain", version: "1.0.0" }));
    const sub = join(root, "sub");
    mkdirSync(sub);

    const found = findProjectConfig(sub);
    expect(found).toBeNull();
    expect(interfaceConfig(found?.config)).toEqual({ autoBind: true, emit: [] });
  });

  it("monorepo: child package.json without nudo continues up to the root nudo config", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-iface-mono-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "mono-root",
        private: true,
        nudo: { interface: { autoBind: false } },
      }),
    );
    const child = join(root, "packages", "lib");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(child, "package.json"), JSON.stringify({ name: "@acme/lib", version: "1.0.0" }));
    const src = join(child, "src");
    mkdirSync(src);

    const found = findProjectConfig(src);
    expect(found?.projectDir).toBe(root);
    expect(interfaceConfig(found?.config)).toEqual({ autoBind: false, emit: [] });
  });
});
