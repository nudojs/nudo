/**
 * @just:case "concrete" (1, 2)
 * @just:case "symbolic" (T.number, T.number)
 */
function calc(a, b) {
  if (a > b) return a - b;
  return a + b;
}

/**
 * @just:case "positive numbers" (5, 3)
 * @just:case "negative result" (1, 10)
 * @just:case "symbolic" (T.number, T.number)
 */
function subtract(a, b) {
  return a - b;
}

/**
 * @just:case "with number" (42)
 * @just:case "with string" ("hello")
 * @just:case "symbolic" (T.union(T.number, T.string))
 */
function describe(x) {
  if (typeof x === "number") return x + 1;
  return x;
}

/**
 * @just:case "null case" (null)
 * @just:case "number case" (5)
 * @just:case "symbolic" (T.union(T.null, T.number))
 */
function safe(x) {
  if (x === null) return 0;
  return x;
}
