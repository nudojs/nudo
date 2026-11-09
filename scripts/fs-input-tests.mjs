/**
 * Test files that read repository-level inputs through `fs` instead of the
 * module graph. Vitest's `--changed` selection cannot see these reads, and
 * `forceRerunTriggers` is global (a match reruns every spec, not just the
 * reader), so CI runs this suite unconditionally on incremental paths.
 *
 * Add a file here when it reads docs/, packages/website/, benchmark/,
 * .github/workflows/, or root scripts/ from disk. The AST gate in
 * scripts/check-fs-input-tests.mjs flags obvious misses for the first four;
 * exec/script reads are not statically visible and stay manual.
 */
export const FS_INPUT_TARGETS = [
  "packages/website/tests",
  "packages/core/src/algebra/__tests__/check-mini-repo.test.ts",
  "packages/env/src/__tests__/env-bug-61-node-surface.test.ts",
];

/** @param {string} rel repo-relative path */
export function isFsInputTest(rel) {
  return FS_INPUT_TARGETS.some((target) =>
    target.endsWith(".test.ts") || target.endsWith(".part.ts")
      ? rel === target
      : rel.startsWith(`${target.replace(/\/$/, "")}/`),
  );
}
