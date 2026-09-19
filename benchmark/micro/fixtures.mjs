/**
 * Shared fixture generators for Nudo vs tsc micro-benchmarks.
 * Workloads are intentionally small and isolatable.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OUT_DIR = join(import.meta.dirname, "out");

export function ensureOut() {
  mkdirSync(OUT_DIR, { recursive: true });
  return OUT_DIR;
}

/** W1 — trivial arithmetic, 1 case */
export function w1Nudo() {
  return `/**
 * @nudo:case "ab" (1, 2)
 */
function add(a, b) {
  return a + b;
}
`;
}

export function w1Tsc() {
  return `function add(a: number, b: number): number {
  return a + b;
}
export const _ = add;
`;
}

/** W2 — typeof branch, 2 cases */
export function w2Nudo() {
  return `/**
 * @nudo:case "str" (string())
 * @nudo:case "num" (number())
 */
function process(x) {
  if (typeof x === "string") return x.length;
  return x * 2;
}
`;
}

export function w2Tsc() {
  return `function process(x: string | number): number {
  if (typeof x === "string") return x.length;
  return x * 2;
}
export const _ = process;
`;
}

/** W3 — N independent functions, each 1 case (scan cost) */
export function w3Nudo(n = 50) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(`/**
 * @nudo:case "c" (${i})
 */
function f${i}(x) {
  return x + ${i};
}
`);
  }
  return parts.join("\n");
}

export function w3Tsc(n = 50) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(`function f${i}(x: number): number {
  return x + ${i};
}
`);
  }
  parts.push("export const _ = [" + Array.from({ length: n }, (_, i) => `f${i}`).join(", ") + "];\n");
  return parts.join("\n");
}

/**
 * W4 — polyvariant pressure: one callee, many call sites (no directives).
 * Nudo synthesizes call@ cases; tsc checks a few structural sites.
 */
export function w4Nudo(sites = 40) {
  const calls = [];
  for (let i = 0; i < sites; i++) {
    calls.push(`double(${i});`);
  }
  return `function double(x) {
  return x * 2;
}

${calls.join("\n")}
`;
}

export function w4Tsc(sites = 40) {
  const calls = [];
  for (let i = 0; i < sites; i++) {
    calls.push(`double(${i});`);
  }
  return `function double(x: number): number {
  return x * 2;
}

${calls.join("\n")}
export const _ = double;
`;
}

/** W5 — union distribution pressure */
export function w5Nudo() {
  return `/**
 * @nudo:case "u" (union(1, 2, 3, 4, 5))
 */
function widen(x) {
  return x + 1;
}
`;
}

export function w5Tsc() {
  return `function widen(x: 1 | 2 | 3 | 4 | 5): number {
  return x + 1;
}
export const _ = widen;
`;
}

export function writeFixtures() {
  const dir = ensureOut();
  const files = {
    w1_nudo: join(dir, "w1_nudo.js"),
    w1_tsc: join(dir, "w1_tsc.ts"),
    w2_nudo: join(dir, "w2_nudo.js"),
    w2_tsc: join(dir, "w2_tsc.ts"),
    w3_nudo_50: join(dir, "w3_nudo_50.js"),
    w3_tsc_50: join(dir, "w3_tsc_50.ts"),
    w4_nudo_40: join(dir, "w4_nudo_40.js"),
    w4_tsc_40: join(dir, "w4_tsc_40.ts"),
    w5_nudo: join(dir, "w5_nudo.js"),
    w5_tsc: join(dir, "w5_tsc.ts"),
  };
  writeFileSync(files.w1_nudo, w1Nudo());
  writeFileSync(files.w1_tsc, w1Tsc());
  writeFileSync(files.w2_nudo, w2Nudo());
  writeFileSync(files.w2_tsc, w2Tsc());
  writeFileSync(files.w3_nudo_50, w3Nudo(50));
  writeFileSync(files.w3_tsc_50, w3Tsc(50));
  writeFileSync(files.w4_nudo_40, w4Nudo(40));
  writeFileSync(files.w4_tsc_40, w4Tsc(40));
  writeFileSync(files.w5_nudo, w5Nudo());
  writeFileSync(files.w5_tsc, w5Tsc());
  return files;
}
