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
    expect(interfaceConfig(undefined)).toEqual({ autoBind: true });
    expect(interfaceConfig(null)).toEqual({ autoBind: true });
    expect(interfaceConfig({})).toEqual({ autoBind: true });
    // 向后兼容：既有键（env/mocks）存在时不改变 interface 段行为
    const legacy: NudoConfig = { env: ["es"], mocks: { fetch: "stub" } };
    expect(interfaceConfig(legacy)).toEqual({ autoBind: true });
  });

  it("defaults when interface key is present but empty", () => {
    expect(interfaceConfig({ interface: {} })).toEqual({ autoBind: true });
  });

  it("reads explicit autoBind", () => {
    const config: NudoConfig = { interface: { autoBind: false } };
    expect(interfaceConfig(config)).toEqual({ autoBind: false });
  });

  it("ignores unknown keys in the interface section (emit/ignore arrive with Phase 2)", () => {
    // emit/ignore 白名单曾声明+归一化但全仓零消费（用户写了被静默忽略）——
    // 已从类型面移除；写在 package.json 里的残留键不再是配置契约的一部分
    const malformed = { interface: { emit: "src/a.nudo.js", ignore: ["dist/**"] } } as unknown as NudoConfig;
    expect(interfaceConfig(malformed)).toEqual({ autoBind: true });
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
        nudo: { interface: { autoBind: false } },
      }),
    );
    const deep = join(root, "packages", "lib", "src");
    mkdirSync(deep, { recursive: true });

    const found = findProjectConfig(deep);
    expect(found?.projectDir).toBe(root);
    expect(interfaceConfig(found?.config)).toEqual({ autoBind: false });
  });

  it("package.json without a nudo key yields null config and default interface settings", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-iface-plain-"));
    dirs.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "plain", version: "1.0.0" }));
    const sub = join(root, "sub");
    mkdirSync(sub);

    const found = findProjectConfig(sub);
    expect(found).toBeNull();
    expect(interfaceConfig(found?.config)).toEqual({ autoBind: true });
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
    expect(interfaceConfig(found?.config)).toEqual({ autoBind: false });
  });
});
