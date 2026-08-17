/**
 * Type Comparator - Better comparison between inferred types and expected values
 */

/**
 * Normalize a type string for comparison
 */
function normalizeType(typeStr) {
  return typeStr
    .replace(/\s+/g, "")  // Remove whitespace
    .replace(/"/g, "'")   // Normalize quotes
    .toLowerCase();
}

/**
 * Convert an expected value to a type string
 */
function valueToType(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const elements = value.map(valueToType).join(", ");
    return `[${elements}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([k, v]) => `${k}: ${valueToType(v)}`)
      .join(", ");
    return `{${entries}}`;
  }
  return "unknown";
}

/**
 * Compare inferred type with expected value
 * Returns: "exact", "partial", "unknown", "mismatch"
 */
export function compareTypeWithValue(inferredType, expected) {
  if (!inferredType || inferredType === "error") return "error";
  if (inferredType === "unknown") return "unknown";

  const normalizedInferred = normalizeType(inferredType);
  const expectedType = valueToType(expected);
  const normalizedExpected = normalizeType(expectedType);

  // Exact match
  if (normalizedInferred === normalizedExpected) return "exact";

  // Check for partial matches
  // Tuple vs array
  if (normalizedInferred.startsWith("[") && normalizedExpected.startsWith("[")) {
    // Both are arrays/tuples
    const inferredElements = normalizedInferred.slice(1, -1).split(",");
    const expectedElements = normalizedExpected.slice(1, -1).split(",");

    // Same length and all elements match
    if (inferredElements.length === expectedElements.length) {
      const allMatch = inferredElements.every((el, i) => {
        return el === expectedElements[i] || el === "unknown";
      });
      if (allMatch) return "exact";
    }

    // Contains some matching elements
    return "partial";
  }

  // Object partial match
  if (normalizedInferred.startsWith("{") && normalizedExpected.startsWith("{")) {
    // Check if inferred object has all expected keys
    const expectedKeys = normalizedExpected.match(/\w+(?=:)/g) || [];
    const inferredKeys = normalizedInferred.match(/\w+(?=:)/g) || [];

    const hasAllKeys = expectedKeys.every(k => inferredKeys.includes(k));
    if (hasAllKeys) return "partial";
  }

  // Union type - check if expected value is in the union
  if (normalizedInferred.includes("|")) {
    const unionTypes = normalizedInferred.split("|").map(t => t.trim());
    if (unionTypes.includes(normalizedExpected)) return "exact";
    // Check if expected is a subset of union
    if (unionTypes.some(t => normalizedExpected.includes(t))) return "partial";
  }

  // Promise wrapper
  if (normalizedInferred.startsWith("promise<") && normalizedInferred.endsWith(">")) {
    const innerType = normalizedInferred.slice(8, -1);
    return compareTypeWithValue(innerType, expected);
  }

  // Number literal vs number type
  if (normalizedInferred === "number" && typeof expected === "number") return "partial";
  if (normalizedInferred === "string" && typeof expected === "string") return "partial";

  return "mismatch";
}

/**
 * Compare inferred type with expected type string
 */
export function compareTypeWithType(inferredType, expectedType) {
  if (!inferredType || inferredType === "error") return "error";
  if (inferredType === "unknown") return "unknown";

  const normalizedInferred = normalizeType(inferredType);
  const normalizedExpected = normalizeType(expectedType);

  if (normalizedInferred === normalizedExpected) return "exact";

  // Check for partial matches
  if (normalizedInferred.includes("|") || normalizedExpected.includes("|")) {
    return "partial";
  }

  return "mismatch";
}
