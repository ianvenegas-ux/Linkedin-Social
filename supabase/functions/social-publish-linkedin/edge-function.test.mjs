import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const publishStart = source.indexOf("const postUrn = await createPost");
const errorStart = source.indexOf("} catch (error)", publishStart);

assert(publishStart >= 0 && errorStart > publishStart, "the LinkedIn publication success path must exist");
const successPath = source.slice(publishStart, errorStart);

assert.doesNotMatch(source, /\\nimport/, "the Edge Function source must contain real line breaks between imports");
assert.match(
  source,
  /import \{ buildPublishedPostUpdate \} from "\.\/publish-state\.mjs";/,
  "the deployed function must use the tested social_posts update builder",
);
assert.match(successPath, /buildPublishedPostUpdate\(/, "the publication result must use the valid social_posts schema");
assert.doesNotMatch(
  successPath,
  /\.from\("social_posts"\)[\s\S]*?\.update\(\{[\s\S]*?published_at:/,
  "social_posts must not receive its nonexistent published_at column",
);
assert.match(
  successPath,
  /publishedUpdateError[\s\S]*throw new Error/,
  "a failed publication-state update must not be silently ignored",
);

console.log("deployed LinkedIn Edge Function regression test passed");
