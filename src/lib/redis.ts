import { Redis } from "@upstash/redis";

// Lazily constructed: `Redis.fromEnv()` throws when the Upstash vars are
// missing, and Next evaluates module top-level code at build time — an eager
// client would break `next build` before the integration is provisioned.
let client: Redis | null = null;

export function redis(): Redis {
  if (!client) client = Redis.fromEnv();
  return client;
}
