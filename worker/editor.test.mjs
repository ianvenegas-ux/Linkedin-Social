import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const { default: worker } = await import("./index.js");
const appHtml = await (await worker.fetch(new Request("https://lili-social.test/"), {})).text();

const script = appHtml.match(/<script>([\s\S]*)<\/script>/)[1];
const uploadStart = script.indexOf("async function uploadMaterial");
const saveStart = script.indexOf("async function saveDraft");
const publishStart = script.indexOf("async function publish", saveStart);
assert(uploadStart >= 0 && saveStart > uploadStart && publishStart > saveStart, "editor functions must exist");
const uploadBody = script.slice(uploadStart, saveStart);
const saveBody = script.slice(saveStart, publishStart);

assert.match(
  script,
  /activeImage\s*=\s*\{\s*localFile:file,\s*preview_url:\s*URL\.createObjectURL\(file\)/,
  "selecting a local image must create a preview URL before it is uploaded",
);
assert.match(appHtml, /id="saveStatus"[^>]*aria-live="polite"/, "the composer must expose a visible save status");
assert.match(saveBody, /render\(\);\s*const saveStatus[\s\S]*showToast\(/, "successful save feedback must be shown after the refreshed editor is rendered");
assert.match(uploadBody, /const existing\s*=\s*postMedia\(postId\)\[0\]/, "uploading a replacement image must inspect the existing post media");
assert.match(uploadBody, /social_media\?id=eq\./, "uploading a replacement image must update the existing media row");
assert.match(uploadBody, /display_order:\s*1/, "the primary image must keep display order one");

console.log("editor regression test passed");
