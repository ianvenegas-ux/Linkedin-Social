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

  // GitHub Pages reads a bare CNAME file (no scheme, no trailing slash) at the
  // artifact root to serve the custom domain; without it every deploy resets
  // Pages back to the default *.github.io URL.
  const cname = await fs.readFile(path.join(outputDir, "CNAME"), "utf8");
  assert.equal(cname.trim(), "social.liliantrade.com");

  const workflow = await fs.readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /SUPABASE_URL:\s*\$\{\{ secrets\.SUPABASE_URL \}\}/);
  assert.match(workflow, /SUPABASE_PUBLISHABLE_KEY:\s*\$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|LINKEDIN_/);
} finally {
  if (outputDir) await fs.rm(outputDir, { recursive: true, force: true });
}

console.log("Pages artifact build regression test passed");
