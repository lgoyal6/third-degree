"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ACCOUNT_EVENT, readAccount, type Account } from "@/lib/account/client";

/**
 * Sign-in, offered and never demanded (§10a's call about §2's share loop): the
 * paste-a-URL path never asks for it, and this is the only place that mentions
 * it on the way in.
 */
export default function AccountBadge({ available }: { available: boolean }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      setAccount(readAccount());
      setReady(true);
    };
    sync();
    window.addEventListener(ACCOUNT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ACCOUNT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!ready) return null;

  if (account) {
    return (
      <Link href="/account" className="font-mono text-xs text-ink-muted hover:text-lamp">
        <span className="text-lamp">@{account.login}</span> · your account
      </Link>
    );
  }

  if (!available) return null;
  return (
    <a
      href="/api/auth/github?scope=identity"
      className="font-mono text-xs text-ink-muted hover:text-lamp"
    >
      sign in to keep your streak
    </a>
  );
}
