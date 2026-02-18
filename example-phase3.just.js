/**
 * @just:case "concrete" (5)
 * @just:case "zero" (0)
 */
function factorial(n) {
  if (n === 0) return 1;
  if (n === 1) return 1;
  return n * factorial(n - 1);
}

/**
 * @just:case "valid" (10)
 * @just:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}

/**
 * @just:case "test" ()
 */
async function fetchData() {
  const data = await Promise.resolve(42);
  return data;
}

/**
 * @just:case "test" (T.number)
 */
function checkType(x) {
  if (x instanceof Error) {
    return x.message;
  }
  return "not error";
}
