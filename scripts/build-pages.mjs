import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderAppHtml } from "../worker/index.js";

function requiredHttpsUrl(value) {
  const url = new URL(value || "");
  if (url.protocol !== "https:") throw new Error("SUPABASE_URL must use HTTPS");
  return url.toString().replace(/\/$/, "");
}

export async function buildPages({
  outputDir = "dist-pages",
  supabaseUrl = process.env.SUPABASE_URL,
  publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY,
} = {}) {
  const resolvedUrl = requiredHttpsUrl(supabaseUrl);
  if (!publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");

  const resolvedOutputDir = path.resolve(outputDir);
  await fs.rm(resolvedOutputDir, { recursive: true, force: true });
  await fs.mkdir(resolvedOutputDir, { recursive: true });
  await fs.writeFile(
    path.join(resolvedOutputDir, "index.html"),
    renderAppHtml({
      supabaseUrl: resolvedUrl,
      publishableKey,
      transport: "direct",
    }),
    "utf8",
  );
  return resolvedOutputDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputDir = await buildPages();
  console.log(`Built ${outputDir}`);
}
