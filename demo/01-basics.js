/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function calc(a, b) {
  if (a > b) return a - b;
  return a + b;
}

/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function subtract(a, b) {
  return a - b;
}

/**
 * @nudo:case "with number" (42)
 * @nudo:case "with string" ("hello")
 * @nudo:case "symbolic" (T.union(T.number, T.string))
 */
function describe(x) {
  if (typeof x === "number") return x + 1;
  return x;
}

/**
 * @nudo:case "null case" (null)
 * @nudo:case "number case" (5)
 * @nudo:case "symbolic" (T.union(T.null, T.number))
 */
function safe(x) {
  if (x === null) return 0;
  return x;
}
