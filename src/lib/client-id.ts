/**
 * A stable anonymous id for this browser, so experiment assignment survives
 * across sessions without an account. Same honest limits as the streak: this
 * browser only, gone on a cache clear, and never required - the server falls
 * back to a per-session unit when it is absent.
 */

const KEY = "td:client";

export function clientId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = crypto.randomUUID();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return undefined; // private mode or a full quota
  }
}
