import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildPages } from "./build-pages.mjs";

let outputDir = "";
try {
  outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "lili-pages-"));
  await buildPages({
    outputDir,
    supabaseUrl: "https://project.supabase.co",
    publishableKey: "test-publishable-key",
  });
  const html = await fs.readFile(path.join(outputDir, "index.html"), "utf8");
  assert.match(html, /https:\/\/project\.supabase\.co/);
  assert.match(html, /test-publishable-key/);
  assert.match(html, /LILI_TRANSPORT = "direct"/);
  assert.doesNotMatch(html, /__LILI_(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|TRANSPORT)__/);
} finally {
  if (outputDir) await fs.rm(outputDir, { recursive: true, force: true });
}

console.log("Pages artifact build regression test passed");
