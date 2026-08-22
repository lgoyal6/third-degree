/**
 * The editor title bar: the same facts in the same place on every screen, so
 * the product reads as one tool rather than four pages. Everything in it is
 * measured from the repo; nothing decorative earns a slot.
 */
export default function StatusLine({
  repo,
  branch,
  sha,
  files,
  lines,
  children,
}: {
  repo: string;
  branch?: string;
  /** Commit the map was indexed from; shown so a stale map is visible. */
  sha?: string;
  files?: number;
  lines?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="flex items-center gap-5 px-6 py-2 font-mono text-xs">
        <span className="truncate text-ink">{repo}</span>
        {branch && (
          <span className="hidden text-ink-muted sm:inline">
            {branch}
            {sha && <span className="text-ink-muted/60"> {sha.slice(0, 7)}</span>}
          </span>
        )}
        {files !== undefined && (
          <span className="hidden text-ink-muted sm:inline">{files.toLocaleString()} files</span>
        )}
        {lines !== undefined && (
          <span className="hidden text-ink-muted md:inline">{lines.toLocaleString()} lines</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-4">{children}</span>
      </div>
    </div>
  );
}
