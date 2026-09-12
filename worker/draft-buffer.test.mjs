import assert from "node:assert/strict";

const { default: worker } = await import("./index.js");
const appHtml = await (await worker.fetch(new Request("https://lili-social.test/"), {})).text();
const script = appHtml.match(/<script>([\s\S]*)<\/script>/)[1];

// Unsaved composer text must survive an accidental refresh even though the user
// never clicked "Guardar borrador" -- otherwise every reload silently discards
// whatever the person was in the middle of typing.
assert.match(
  script,
  /const DRAFT_BUFFER_KEY = "lili_social_unsaved_draft";/,
  "the composer must buffer unsaved drafts to localStorage under a stable key",
);
assert.match(
  script,
  /function draftBufferId\(postId\) \{ return postId \|\| "new"; \}/,
  "the buffer must be scoped per post (or the not-yet-created draft) so switching posts never mixes their text",
);
assert.match(
  script,
  /function saveDraftBuffer\(postId, title, body\) \{\s*try \{ localStorage\.setItem/,
  "buffering must never throw when localStorage is unavailable (private browsing, quota, etc.)",
);
assert.match(
  script,
  /function readDraftBuffer\(postId\) \{[\s\S]*?catch \{ return null; \}\s*\}/,
  "reading the buffer must never throw when localStorage is unavailable or holds malformed JSON",
);

const bindStart = script.indexOf("function bindComposer() {");
const nextFunctionStart = script.indexOf("async function uploadMaterial", bindStart);
assert(bindStart >= 0 && nextFunctionStart > bindStart, "bindComposer must exist");
const bindBody = script.slice(bindStart, nextFunctionStart);

assert.match(
  bindBody,
  /const buffered = readDraftBuffer\(activePost\?\.id\);/,
  "opening the composer must check for a buffered draft matching the current post",
);
assert.match(
  bindBody,
  /buffered\.title !== \(activePost\?\.internal_title \|\| ""\) \|\| buffered\.body !== \(activePost\?\.body \|\| ""\)/,
  "the buffer must only be applied (and only then shown to the user) when it actually differs from what was loaded from Supabase",
);
assert.match(
  bindBody,
  /showToast\("Recuperamos un borrador sin guardar\."\)/,
  "restoring a buffered draft must be visible to the user, not silent",
);
assert.match(
  bindBody,
  /setTimeout\(\(\) => saveDraftBuffer\(activePost\?\.id, titleInput\?\.value \|\| "", body\?\.value \|\| ""\), 400\)/,
  "typing in the title or body must debounce-persist to the buffer",
);
assert.match(
  bindBody,
  /titleInput\?\.addEventListener\("input", scheduleBufferSave\)/,
  "the title field must feed the debounced buffer save",
);
assert.match(
  bindBody,
  /body\?\.addEventListener\("input", \(\) => \{ \$\("counter"\)\.textContent = body\.value\.length; \$\("previewBody"\)\.textContent = body\.value \|\| "Tu texto aparecerá aquí\.\.\."; scheduleBufferSave\(\); \}\)/,
  "the body field must keep updating the counter/preview and also feed the debounced buffer save",
);

console.log("draft buffer regression test passed");
