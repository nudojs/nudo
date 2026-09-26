/**
 * @nudo:mock-module — module-level replacement into the modules map.
 * Full replace and partial `{ a, b }` overlay; fail-closed on missing mock.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyMockModuleDirectivesFromSource } from "../mock-module.ts";
import type { AbsModuleExports } from "@nudojs/core";
import { formatAbs, $call } from "@nudojs/core";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-mock-mod-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, body: string): string {
  const p = join(dir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body, "utf-8");
  return p;
}

describe("applyMockModuleDirectivesFromSource", () => {
  it("full replacement swaps the specifier export table", () => {
    write(
      "mocks/axios.js",
      `export function get(url) { return { data: ["ok"], url }; }\n`,
    );
    const src = `/// @nudo:mock-module "axios" from "./mocks/axios.js"\nimport axios from "axios";\nexport function go() { return axios; }\n`;
    const base: Record<string, AbsModuleExports> = {
      axios: { named: { get: { shape: { k: "unknown" }, conf: "opaque" } as never } },
    };
    const r = applyMockModuleDirectivesFromSource(src, base, {
      fromFile: join(dir, "app.js"),
    });
    expect(r.applied).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.modules.axios).toBeDefined();
    expect(r.modules.axios!.named.get).toBeDefined();
    expect(formatAbs(r.modules.axios!.named.get!)).not.toContain("unknown");
  });

  it("partial replacement only overlays listed names", () => {
    write("mocks/lodash.js", `export function debounce() { return 1; }\nexport function throttle() { return 2; }\n`);
    const src = `/// @nudo:mock-module "lodash" { debounce } from "./mocks/lodash.js"\nexport function go() { return 1; }\n`;
    const origThrottle = { shape: { k: "num" as const, v: 99 }, conf: "exact" as const };
    const base: Record<string, AbsModuleExports> = {
      lodash: { named: { debounce: { shape: { k: "unknown" }, conf: "opaque" } as never, throttle: origThrottle as never } },
    };
    const r = applyMockModuleDirectivesFromSource(src, base, {
      fromFile: join(dir, "app.js"),
    });
    expect(r.applied).toBe(true);
    // debounce comes from mock (not unknown)
    expect(formatAbs(r.modules.lodash!.named.debounce!)).not.toContain("unknown");
    // throttle falls through
    expect(r.modules.lodash!.named.throttle).toBe(origThrottle);
  });

  it("missing mock file is fail-closed error, original left intact", () => {
    const src = `/// @nudo:mock-module "axios" from "./missing.js"\nexport function go() { return 1; }\n`;
    const base: Record<string, AbsModuleExports> = {
      axios: { named: { get: { shape: { k: "unknown" }, conf: "opaque" } as never } },
    };
    const r = applyMockModuleDirectivesFromSource(src, base, {
      fromFile: join(dir, "app.js"),
    });
    expect(r.applied).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toContain("not found");
    expect(r.modules.axios!.named.get).toBe(base.axios!.named.get);
  });

  it("no mock-module directives is a no-op", () => {
    const r = applyMockModuleDirectivesFromSource(
      `export function go() { return 1; }\n`,
      {},
      { fromFile: join(dir, "app.js") },
    );
    expect(r.applied).toBe(false);
    expect(r.errors).toHaveLength(0);
    expect(r.modules).toEqual({});
  });

  it("mock file with relative imports resolves via the abs module graph", () => {
    write("lib/config.js", `export function portLabel() { return "3000"; }\n`);
    write(
      "mocks/api.js",
      `import { portLabel } from "../lib/config.js";\nexport function readConfig() { return portLabel(); }\n`,
    );
    const src = `/// @nudo:mock-module "axios" from "./mocks/api.js"\nimport axios from "axios";\nexport function go() { return axios.readConfig(); }\n`;
    const r = applyMockModuleDirectivesFromSource(src, {}, {
      fromFile: join(dir, "app.js"),
    });
    expect(r.applied).toBe(true);
    expect(r.errors).toHaveLength(0);
    const fn = r.modules.axios!.named.readConfig!;
    expect(fn).toBeDefined();
    expect(fn.shape.k).toBe("fn");
    // invoke the bridged export — result must come from the relative-import dep
    const applied = $call(fn, []);
    expect(formatAbs(applied)).toContain("3000");
  });
});
