import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectConfig, interfaceConfig, type NudoConfig } from "../evaluator/config.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("interfaceConfig", () => {
  it("defaults when config is null/undefined or lacks the interface key", () => {
    expect(interfaceConfig(undefined)).toEqual({ autoBind: true, emit: [], ignore: [] });
    expect(interfaceConfig(null)).toEqual({ autoBind: true, emit: [], ignore: [] });
    expect(interfaceConfig({})).toEqual({ autoBind: true, emit: [], ignore: [] });
    // 向后兼容：既有键（env/mocks）存在时不改变 interface 段行为
    const legacy: NudoConfig = { env: ["es"], mocks: { fetch: "stub" } };
    expect(interfaceConfig(legacy)).toEqual({ autoBind: true, emit: [], ignore: [] });
  });

  it("defaults when interface key is present but empty", () => {
    expect(interfaceConfig({ interface: {} })).toEqual({ autoBind: true, emit: [], ignore: [] });
  });

  it("reads explicit autoBind/emit/ignore", () => {
    const config: NudoConfig = {
      interface: { autoBind: false, emit: ["src/a.nudo.js", "src/b.nudo.js"], ignore: ["dist/**"] },
    };
    expect(interfaceConfig(config)).toEqual({
      autoBind: false,
      emit: ["src/a.nudo.js", "src/b.nudo.js"],
      ignore: ["dist/**"],
    });
  });

  it("reads partial overrides (autoBind:false alone)", () => {
    expect(interfaceConfig({ interface: { autoBind: false } })).toEqual({
      autoBind: false,
      emit: [],
      ignore: [],
    });
  });

  it("returns defensive copies of emit/ignore arrays", () => {
    const config: NudoConfig = { interface: { emit: ["a"], ignore: ["b"] } };
    const norm = interfaceConfig(config);
    norm.emit.push("c");
    norm.ignore.push("d");
    expect(config.interface?.emit).toEqual(["a"]);
    expect(config.interface?.ignore).toEqual(["b"]);
  });

  it("non-array emit/ignore degrade to [] instead of throwing", () => {
    const malformed = { interface: { emit: "src/a.nudo.js" } } as unknown as NudoConfig;
    expect(interfaceConfig(malformed)).toEqual({ autoBind: true, emit: [], ignore: [] });
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
        nudo: { interface: { autoBind: false, emit: ["out.d.ts"], ignore: ["vendor/**"] } },
      }),
    );
    const deep = join(root, "packages", "lib", "src");
    mkdirSync(deep, { recursive: true });

    const found = findProjectConfig(deep);
    expect(found?.projectDir).toBe(root);
    expect(interfaceConfig(found?.config)).toEqual({
      autoBind: false,
      emit: ["out.d.ts"],
      ignore: ["vendor/**"],
    });
  });

  it("package.json without a nudo key yields null config and default interface settings", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-iface-plain-"));
    dirs.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "plain", version: "1.0.0" }));
    const sub = join(root, "sub");
    mkdirSync(sub);

    const found = findProjectConfig(sub);
    expect(found).toBeNull();
    expect(interfaceConfig(found?.config)).toEqual({ autoBind: true, emit: [], ignore: [] });
  });
});
