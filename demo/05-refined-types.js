// ============================================================
// Demo 5: Refined Types — Template Strings, Ranges, String Methods
// ============================================================
//
// Nudo can infer more precise types than TypeScript in many cases.
// This demo showcases Phase 5 & 6 features.

// --- Template String Inference ---
// TypeScript: `"xy" + someString` => string (loses prefix info)
// Nudo:       `"xy" + someString` => `xy${string}` (preserves structure)

const prefix = "0x";
const hexAddr = prefix + "ff";       // => "0xff" (literal, both sides known)

/**
 * @nudo:case "symbolic" (T.string)
 */
function makeHexString(s) {
  return "0x" + s;                    // => `0x${string}` (template type)
}

/**
 * @nudo:case "symbolic" (T.string)
 */
function isHex(s) {
  const hex = "0x" + s;
  return hex.startsWith("0x");        // => true (known prefix)
}

// --- Chained Concatenation ---
// TypeScript: `"[" + x + "]"` => string
// Nudo:       `"[" + x + "]"` => `[${string}]`

/**
 * @nudo:case "symbolic" (T.string)
 */
function bracket(s) {
  return "[" + s + "]";               // => `[${string}]`
}

/**
 * @nudo:case "symbolic" (T.string)
 */
function bracketChecks(s) {
  const result = "[" + s + "]";
  const a = result.startsWith("[");   // => true
  const b = result.endsWith("]");     // => true
  const c = result.startsWith("(");   // => false
  return { a, b, c };
}

// --- Template Literal Syntax ---

/**
 * @nudo:case "symbolic" (T.string, T.number)
 */
function greetTemplate(name, age) {
  return `Hello, ${name}! Age: ${age}`;
  // => `Hello, ${string}! Age: ${number}`
}

// --- String Methods on Literals ---
// TypeScript: "hello".toUpperCase() => string
// Nudo:       "hello".toUpperCase() => "HELLO"

/**
 * @nudo:case "test" ()
 */
function stringMethodDemo() {
  const upper = "hello".toUpperCase();       // => "HELLO"
  const lower = "WORLD".toLowerCase();       // => "world"
  const trimmed = "  hi  ".trim();           // => "hi"
  const idx = "abcabc".indexOf("bc");        // => 1
  const parts = "a,b,c".split(",");          // => ["a", "b", "c"]
  const replaced = "hello".replace("l", "r");// => "herlo"
  const repeated = "ab".repeat(3);           // => "ababab"
  const padded = "5".padStart(3, "0");       // => "005"
  const sliced = "hello".slice(1, 3);        // => "el"
  const char = "abc".charAt(1);              // => "b"
  const len = "hello".length;                // => 5
  return { upper, lower, trimmed, idx, parts, replaced, repeated, padded, sliced, char, len };
}

// --- String Length on Literals ---
// TypeScript: "hello".length => number
// Nudo:       "hello".length => 5

/**
 * @nudo:case "test" ()
 */
function lengthPrecision() {
  const a = "hello";
  const len = a.length;           // => 5
  const check = len > 3;          // => true
  return { len, check };
}

// --- For / While Loops ---
// TypeScript: cannot compute loop results at type level
// Nudo:       evaluates loops with concrete bounds

/**
 * @nudo:case "concrete" (5)
 * @nudo:case "symbolic" (T.number)
 */
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + i;
  }
  return sum;
  // concrete: sumTo(5) => 10
  // symbolic: sumTo(T.number) => number (widened after abstract iteration)
}

/**
 * @nudo:case "test" ()
 */
function loopDemo() {
  let result = "";
  for (let i = 0; i < 3; i++) {
    result = result + "x";
  }
  return result;                  // => "xxx"
}
