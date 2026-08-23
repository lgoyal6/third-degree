import { redis } from "../redis";
import type { Progress } from "../progress";
import type { ReviewCard } from "../review";
import type { ShelfEntry } from "../shelf";

/**
 * The identity layer (BUILD_PLAN §10a). Everything the browser has been keeping
 * locally — streak, points, review queue, shelf — gets a durable home per user,
 * so a cache clear or a second device stops costing a month of work.
 *
 * §10a flags the tension with §2 and asks for the call to be deliberate: there
 * is no account gate in front of the first map. Signing in is additive, every
 * screen works without it, and the share loop stays a paste-a-URL loop.
 */

export interface User {
  id: string; // GitHub's numeric id, as a string
  login: string;
  avatarUrl?: string;
  createdAt: number;
}

/** §10a's profile, minus the parts that would need a taxonomy. */
export interface Profile {
  /** Optional and free text: not everyone is at a school. */
  school?: string;
  /** Concepts to lean on, chosen from tags their own answers produced (§8). */
  focus?: string[];
}

export interface AccountState {
  progress: Progress | null;
  review: ReviewCard[];
  shelf: ShelfEntry[];
  profile: Profile;
}

const userKey = (id: string) => `user:${id}`;
const stateKey = (id: string) => `acct:${id}`;

export async function rememberUser(user: Omit<User, "createdAt">): Promise<void> {
  const existing = await redis().get<User>(userKey(user.id));
  await redis().set(userKey(user.id), {
    ...user,
    createdAt: existing?.createdAt ?? Date.now(),
  });
}

export async function getUser(id: string): Promise<User | undefined> {
  return (await redis().get<User>(userKey(id))) ?? undefined;
}

export async function getState(id: string): Promise<AccountState> {
  const stored = await redis().get<AccountState>(stateKey(id));
  return {
    progress: stored?.progress ?? null,
    review: stored?.review ?? [],
    shelf: stored?.shelf ?? [],
    profile: stored?.profile ?? {},
  };
}

export async function putState(id: string, state: AccountState): Promise<void> {
  // No TTL: the whole point of an account is that it outlives a cache.
  await redis().set(stateKey(id), state);
}

/** Everything this account holds, gone. Offered because it should be. */
export async function forgetAccount(id: string): Promise<void> {
  await Promise.all([redis().del(stateKey(id)), redis().del(userKey(id))]);
}
