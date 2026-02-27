/**
 * @nudo:case "concrete" (5)
 * @nudo:case "zero" (0)
 */
function factorial(n) {
  if (n === 0) return 1;
  if (n === 1) return 1;
  return n * factorial(n - 1);
}

/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}

/**
 * @nudo:case "test" ()
 */
async function fetchData() {
  const data = await Promise.resolve(42);
  return data;
}

/**
 * @nudo:case "test" (T.number)
 */
function checkType(x) {
  if (x instanceof Error) {
    return x.message;
  }
  return "not error";
}
