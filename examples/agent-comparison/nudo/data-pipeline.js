/**
 * Data Pipeline Service
 *
 * A realistic service that processes API data with caching,
 * validation, transformation, and error handling.
 */

// === Dependencies (mocked for type inference) ===

// @nudo:mock httpClient = stub().returns({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com", role: "admin" } })
// @nudo:mock redis = stub().returns({ value: null, ttl: 3600 })
// @nudo:mock logger = stub().returns(undefined)
// @nudo:mock validator = (schema, data) => ({ valid: true, errors: [] })

// === 1. HTTP Client with Retry ===

// @nudo:mock fetchWithBackoff = stub().resolves({ ok: true, status: 200, body: { users: [{ id: 1, name: "Alice" }] } })
// @nudo:case "fetch-users" ("/api/users", 3)
// @nudo:returns (T.object({ ok: true, status: 200, body: { users: [{ id: 1, name: "Alice" }] } }) | T.object({ ok: false, error: "max retries exceeded" }))
async function fetchWithRetry(url, maxRetries) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetchWithBackoff(url, i);
      if (response.ok) {
        return response;
      }
    } catch (err) {
      logger("Retry " + i + " failed: " + err);
    }
  }
  return { ok: false, error: "max retries exceeded" };
}

// === 2. URL Parser ===

// @nudo:case "parse-api-url" ()
function parseApiEndpoint(fullUrl) {
  const url = new URL(fullUrl);
  return {
    protocol: url.protocol,
    host: url.host,
    path: url.pathname,
    params: url.search,
  };
}

// === 3. Data Validator ===

// @nudo:case "valid-user" ({ id: 1, name: "Alice", email: "alice@example.com" })
// @nudo:case "invalid-user" ({ id: -1, name: "", email: "bad" })
function validateUser(user) {
  const nameValid = typeof user.name === "string" && user.name.length > 0;
  const emailValid = typeof user.email === "string" && user.email.includes("@");
  const idValid = typeof user.id === "number" && user.id > 0;

  if (!nameValid || !emailValid || !idValid) {
    return { valid: false, errors: ["Invalid user data"] };
  }
  return { valid: true, user };
}

// === 4. Cache Layer with Map ===

// @nudo:case "cache-ops" ()
function testCacheOperations() {
  const cache = new Map();
  cache.set("user:1", { id: 1, name: "Alice" });
  cache.set("user:2", { id: 2, name: "Bob" });

  const hasKey = cache.has("user:1");
  const value = cache.get("user:1");
  const missing = cache.get("user:999");

  return { hasKey, value, missing, size: cache.size };
}

// === 5. Set-based Deduplication ===

// @nudo:case "dedup-ids" ([1, 2, 2, 3, 3, 3])
function deduplicateIds(ids) {
  const unique = new Set(ids);
  return {
    count: unique.size,
    hasTwo: unique.has(2),
    hasFour: unique.has(4),
  };
}

// === 6. RegExp Pattern Matching ===

// @nudo:case "extract-emails" ("Contact alice@example.com or bob@test.org")
function extractEmails(text) {
  const pattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const hasAt = /@/.test(text);
  return { hasEmail: hasAt, pattern: pattern.source };
}

// === 7. Batch Data Processor ===

// @nudo:mock transformUser = (user) => ({ ...user, displayName: user.name.toUpperCase() })
// @nudo:case "process-batch" ([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }])
function processBatch(users) {
  return users
    .filter(u => u.id > 0)
    .map(transformUser);
}

// === 8. Promise.all for Parallel Operations ===

// @nudo:case "parallel-fetch" ()
function fetchDashboardData() {
  const usersPromise = Promise.resolve([{ id: 1, name: "Alice" }]);
  const statsPromise = Promise.resolve({ total: 42, active: 38 });
  const configPromise = Promise.resolve({ theme: "dark", lang: "en" });

  return Promise.all([usersPromise, statsPromise, configPromise]);
}

// === 9. Error Handling with Type Narrowing ===

// @nudo:case "safe-parse" ('{"valid": true}')
// @nudo:case "safe-parse-invalid" ("not json")
function safeParseJson(str) {
  try {
    const parsed = JSON.parse(str);
    return { success: true, data: parsed };
  } catch (e) {
    return { success: false, error: "Parse failed" };
  }
}

// === 10. Symbol and Reflect Usage ===

// @nudo:case "symbol-check" ()
function checkSymbols() {
  const sym = Symbol.for("app.version");
  const hasVersion = Symbol.keyFor(sym);
  const obj = { a: 1, b: 2 };
  const hasA = Reflect.has(obj, "a");
  return { symbol: hasVersion, hasA };
}
