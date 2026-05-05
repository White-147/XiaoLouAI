export type RequestCall = {
  path: string;
  init?: RequestInit;
};

export type RequestHandler = (path: string, init?: RequestInit) => Promise<unknown> | unknown;

export const SYNTHETIC_ACTOR_ID = "synthetic-actor";
export const SYNTHETIC_CREATED_AT = "2026-05-05T00:00:00.000Z";
export const SYNTHETIC_UPDATED_AT = "2026-05-05T00:01:00.000Z";

const FORBIDDEN_REAL_MATERIAL_PATTERNS = [
  /\.runtime/i,
  /deploy[\\/]local-secrets/i,
  /production[-_ ]?(dump|snapshot)/i,
  /BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY/i,
  /\bsk_(?:live|prod)_[A-Za-z0-9_-]{8,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
];

export function assertSyntheticFixtureBoundary<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (!serialized) return value;

  const matchedPattern = FORBIDDEN_REAL_MATERIAL_PATTERNS.find((pattern) => pattern.test(serialized));
  if (matchedPattern) {
    throw new Error(`Synthetic fixture boundary rejected real-material marker: ${matchedPattern}`);
  }

  return value;
}

export function parseJsonBody<T = unknown>(call: RequestCall): T {
  const body = call.init?.body;
  if (typeof body !== "string") {
    throw new Error("Expected synthetic request body to be a JSON string.");
  }

  return assertSyntheticFixtureBoundary(JSON.parse(body) as T);
}

export function createSyntheticMediaScope(actorId: string = SYNTHETIC_ACTOR_ID) {
  return {
    accountOwnerType: "user" as const,
    accountOwnerId: actorId,
    regionCode: "CN" as const,
    currency: "CNY" as const,
  };
}
