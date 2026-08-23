"use client";

import { useEffect, useState } from "react";
import { ACCOUNT_EVENT, readAccount } from "@/lib/account/client";

/**
 * The honest limit, or the absence of it. Every screen that keeps state in the
 * browser said so; with an account it says the truer thing instead.
 */
export default function StorageNote({ subject }: { subject: string }) {
  const [login, setLogin] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setLogin(readAccount()?.login ?? null);
    sync();
    window.addEventListener(ACCOUNT_EVENT, sync);
    return () => window.removeEventListener(ACCOUNT_EVENT, sync);
  }, []);

  return (
    <p className="max-w-sm font-mono text-[11px] leading-relaxed text-ink-muted/70">
      {login
        ? `Synced to @${login}, so ${subject} survives a cache clear and follows you to another machine.`
        : `Kept in this browser, like your streak: clear the cache and ${subject} goes with it.`}
    </p>
  );
}
