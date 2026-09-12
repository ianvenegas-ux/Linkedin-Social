import fs from "node:fs/promises";
import path from "node:path";

const artifactPath = path.resolve("dist-pages/index.html");
const html = await fs.readFile(artifactPath, "utf8");

const requiredFragments = [
  'LILI_TRANSPORT = "direct"',
  "/auth/v1/token",
  "/rest/v1/",
  "/storage/v1",
  "/functions/v1",
  "social-publish-linkedin",
];
const blockedFragments = [
  "__LILI_SUPABASE_URL__",
  "__LILI_SUPABASE_PUBLISHABLE_KEY__",
  "__LILI_TRANSPORT__",
  "service_role",
  "LINKEDIN_",
  "SUPABASE_DB_",
  "OPENAI_API_KEY",
];

for (const fragment of requiredFragments) {
  if (!html.includes(fragment)) throw new Error(`Pages artifact is missing ${fragment}`);
}
for (const fragment of blockedFragments) {
  if (html.includes(fragment)) throw new Error(`Pages artifact contains prohibited ${fragment}`);
}

console.log(`Validated ${artifactPath}`);
