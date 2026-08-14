/** Optional ScrapeGraphAI bridge. RSS/API remains primary; this adapter is
 * used only when explicitly enabled and the local CLI is installed. */
export async function scrapeGraphFallback(url: string, prompt: string): Promise<string | null> {
  if (process.env.SCRAPEGRAPH_ENABLED !== "true") return null;
  const command = process.env.SCRAPEGRAPH_COMMAND || "scrapegraphai";
  // The production runner can provide a site-specific command without adding
  // a heavyweight Python dependency to the Node pipeline.
  const result = await new Promise<string | null>((resolve) => {
    import("node:child_process").then(({ execFile }) => {
      execFile(command, [url, prompt], { timeout: 30_000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null));
    }).catch(() => resolve(null));
  });
  return result;
}
