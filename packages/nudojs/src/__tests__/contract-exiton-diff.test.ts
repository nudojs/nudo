/**
 * DEC-005: contract --emit --dry-run --exit-on-diff 必须在 derived 侧车有 diff 时
 * exit 1（契约 cli-semantics §1.3「将写盘且有 diff → 1」），即使 written 为空
 * （whitespace 归一化导致 changed 但无新写入）。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const cli = join(root, "packages/nudojs/src/index.ts");
const tsx = join(root, "node_modules/.bin/tsx");

function runCli(
  args: string[],
  opts: { cwd: string },
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(tsx, [cli, ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

const STD_SRC = `import { number, fn } from "@nudojs/core";
export const positive = number().gt(0);
export const positive4 = number().gt(4);
`;

const ADD_JS = `export function add2(x) {
  return x + 2;
}
`;

const LIB_JS = `import { add2 } from "./add.js";

export function add4(x) {
  return add2(x + 1) + 1;
}
`;

const LIB_NUDO = `import { fn } from "@nudojs/core";
import { positive, positive4 } from "./std.nudo.js";

export const add4 = fn({ x: positive }, positive4);
`;

describe("contract --emit --dry-run --exit-on-diff (DEC-005)", () => {
  it("exit 1 when derived sidecar has diff even if written is empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-dec005-"));
    writeFileSync(join(dir, "std.nudo.js"), STD_SRC);
    writeFileSync(join(dir, "add.js"), ADD_JS);
    writeFileSync(join(dir, "lib.js"), LIB_JS);
    writeFileSync(join(dir, "lib.nudo.js"), LIB_NUDO);

    // First emit to create add.nudo.js (derived sidecar)
    const r1 = runCli(["contract", "lib.js", "--emit", "--fn", "add2"], { cwd: dir });
    expect(r1.status).toBe(0);
    expect(existsSync(join(dir, "add.nudo.js"))).toBe(true);

    // Add extra trailing whitespace → reassembly normalizes it → changed=true, written=false
    const addNudo = readFileSync(join(dir, "add.nudo.js"), "utf-8");
    writeFileSync(join(dir, "add.nudo.js"), addNudo + "\n\n\n");

    // Dry-run with exit-on-diff: derived sidecar has diff → must exit 1
    const r2 = runCli(["contract", "lib.js", "--emit", "--dry-run", "--exit-on-diff"], {
      cwd: dir,
    });
    // Derived diff is printed (proof the sidecar would change)
    expect(r2.stdout).toContain("[dry-run] would update");
    // Main interface has no change (only derived sidecar drifted)
    expect(r2.stdout).toContain("no interface changes");
    // Contract §1.3: 将写盘且有 diff → exit 1
    expect(r2.status).toBe(1);
  });
});
