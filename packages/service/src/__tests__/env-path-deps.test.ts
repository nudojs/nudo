import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  noteEnvPathDeps,
  envPathDependents,
  clearEnvPathDeps,
  isEnvTemplatePath,
} from "../env-path-deps.ts";
import { isWatchRelevantPath } from "../watch-paths.ts";

describe("path-based @nudo:env reverse deps", () => {
  it("registers reverse edges and watch gate accepts env templates", () => {
    clearEnvPathDeps();
    const dir = mkdtempSync(join(tmpdir(), "nudo-env-dep-"));
    try {
      const env = join(dir, "custom.env.ts");
      const main = join(dir, "main.js");
      writeFileSync(env, `export function defineEnv(){ return { globals: { MAGIC: 1 } }; }\n`);
      writeFileSync(main, `/// @nudo:env ./custom.env.ts\nexport function f(){ return MAGIC; }\n`);
      noteEnvPathDeps(main, `/// @nudo:env ./custom.env.ts\nexport function f(){ return MAGIC; }\n`);
      expect(envPathDependents(env)).toContain(main.replace(/\\/g, "/"));
      expect(isEnvTemplatePath(env)).toBe(true);
      expect(isWatchRelevantPath(env)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearEnvPathDeps();
    }
  });
});
