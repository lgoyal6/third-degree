"use client";

import { normalizeTags } from "../learn/tags";
import { dueTags } from "../review";
import type { Profile } from "./store";

/**
 * The browser's view of who is signed in. A cache of server truth, kept in
 * localStorage so every screen can read it synchronously the way it already
 * reads the streak — refreshed by AccountSync on load and cleared on sign-out.
 */

export interface Account {
  login: string;
  avatarUrl?: string;
  scope: "identity" | "repos";
  profile: Profile;
}

const KEY = "td:account";
export const ACCOUNT_EVENT = "td:account";

export function readAccount(): Account | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Account) : null;
    return parsed?.login ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAccount(account: Account | null): void {
  try {
    if (account) window.localStorage.setItem(KEY, JSON.stringify(account));
    else window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(ACCOUNT_EVENT));
  } catch {
    // private mode: the account still works, it just cannot be cached
  }
}

/**
 * What a new session should lean towards: everything the review queue says is
 * due, plus whatever the profile asks to be pushed on. The profile's focus is
 * chosen from tags their own answers produced, so this stays §8's emergent
 * vocabulary rather than a curriculum.
 */
export function sessionTags(): string[] {
  return normalizeTags([...dueTags(), ...(readAccount()?.profile.focus ?? [])], 12);
}
