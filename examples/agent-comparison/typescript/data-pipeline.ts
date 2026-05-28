/**
 * Data Pipeline Service - TypeScript Version
 *
 * Same service as the Nudo version, but with explicit type annotations.
 */

// === Type Definitions ===

interface ApiResponse<T> {
  ok: boolean;
  status: number;
  body?: T;
  error?: string;
}

interface User {
  id: number;
  name: string;
  email: string;
  role?: string;
}

interface TransformedUser extends User {
  displayName: string;
}

interface ValidationResult<T> {
  valid: boolean;
  user?: T;
  errors?: string[];
}

interface CacheEntry<T> {
  value: T | null;
  ttl: number;
}

interface Logger {
  (message: string): undefined;
}

interface Validator {
  (schema: string, data: unknown): { valid: boolean; errors: string[] };
}

interface HttpClient {
  <T>(url: string, options?: RequestInit): { status: number; data: T };
}

interface RedisClient {
  (key: string): CacheEntry<unknown>;
}

interface FetchWithBackoff {
  (url: string, retryCount: number): Promise<ApiResponse<{ users: User[] }>>;
}

interface TransformUser {
  (user: User): TransformedUser;
}

// === Dependencies ===

declare const httpClient: HttpClient;
declare const redis: RedisClient;
declare const logger: Logger;
declare const validator: Validator;
declare const fetchWithBackoff: FetchWithBackoff;
declare const transformUser: TransformUser;

// === 1. HTTP Client with Retry ===

async function fetchWithRetry(
  url: string,
  maxRetries: number
): Promise<ApiResponse<{ users: User[] }> | { ok: false; error: string }> {
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

interface ParsedEndpoint {
  protocol: string;
  host: string;
  path: string;
  params: string;
}

function parseApiEndpoint(fullUrl: string): ParsedEndpoint {
  const url = new URL(fullUrl);
  return {
    protocol: url.protocol,
    host: url.host,
    path: url.pathname,
    params: url.search,
  };
}

// === 3. Data Validator ===

function validateUser(user: { id: number; name: string; email: string }): ValidationResult<typeof user> {
  const nameValid = typeof user.name === "string" && user.name.length > 0;
  const emailValid = typeof user.email === "string" && user.email.includes("@");
  const idValid = typeof user.id === "number" && user.id > 0;

  if (!nameValid || !emailValid || !idValid) {
    return { valid: false, errors: ["Invalid user data"] };
  }
  return { valid: true, user };
}

// === 4. Cache Layer with Map ===

interface CacheTestResult {
  hasKey: boolean;
  value: { id: number; name: string } | undefined;
  missing: { id: number; name: string } | undefined;
  size: number;
}

function testCacheOperations(): CacheTestResult {
  const cache = new Map<string, { id: number; name: string }>();
  cache.set("user:1", { id: 1, name: "Alice" });
  cache.set("user:2", { id: 2, name: "Bob" });

  const hasKey = cache.has("user:1");
  const value = cache.get("user:1");
  const missing = cache.get("user:999");

  return { hasKey, value, missing, size: cache.size };
}

// === 5. Set-based Deduplication ===

interface DedupResult {
  count: number;
  hasTwo: boolean;
  hasFour: boolean;
}

function deduplicateIds(ids: number[]): DedupResult {
  const unique = new Set(ids);
  return {
    count: unique.size,
    hasTwo: unique.has(2),
    hasFour: unique.has(4),
  };
}

// === 6. RegExp Pattern Matching ===

interface PatternResult {
  hasEmail: boolean;
  pattern: string;
}

function extractEmails(text: string): PatternResult {
  const pattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const hasAt = /@/.test(text);
  return { hasEmail: hasAt, pattern: pattern.source };
}

// === 7. Batch Data Processor ===

function processBatch(users: User[]): TransformedUser[] {
  return users
    .filter(u => u.id > 0)
    .map(transformUser);
}

// === 8. Promise.all for Parallel Operations ===

interface DashboardData {
  users: Array<{ id: number; name: string }>;
  stats: { total: number; active: number };
  config: { theme: string; lang: string };
}

function fetchDashboardData() {
  const usersPromise = Promise.resolve([{ id: 1, name: "Alice" }]);
  const statsPromise = Promise.resolve({ total: 42, active: 38 });
  const configPromise = Promise.resolve({ theme: "dark", lang: "en" });

  return Promise.all([usersPromise, statsPromise, configPromise]);
}

// === 9. Error Handling with Type Narrowing ===

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function safeParseJson(str: string): ParseResult<unknown> {
  try {
    const parsed = JSON.parse(str);
    return { success: true, data: parsed };
  } catch (e) {
    return { success: false, error: "Parse failed" };
  }
}

// === 10. Symbol and Reflect Usage ===

interface SymbolCheckResult {
  symbol: string | undefined;
  hasA: boolean;
}

function checkSymbols(): SymbolCheckResult {
  const sym = Symbol.for("app.version");
  const hasVersion = Symbol.keyFor(sym);
  const obj = { a: 1, b: 2 };
  const hasA = Reflect.has(obj, "a");
  return { symbol: hasVersion, hasA };
}
