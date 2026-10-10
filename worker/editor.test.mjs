import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const { default: worker } = await import("./index.js");
const appHtml = await (await worker.fetch(new Request("https://lili-social.test/"), {})).text();

const script = appHtml.match(/<script>([\s\S]*)<\/script>/)[1];
const uploadStart = script.indexOf("async function uploadMaterial");
const saveStart = script.indexOf("async function saveDraft");
const publishStart = script.indexOf("async function publish", saveStart);
const processJobsStart = script.indexOf("async function processDueJobs", publishStart);
assert(uploadStart >= 0 && saveStart > uploadStart && publishStart > saveStart && processJobsStart > publishStart, "editor functions must exist");
const uploadBody = script.slice(uploadStart, saveStart);
const saveBody = script.slice(saveStart, publishStart);
const publishBody = script.slice(publishStart, processJobsStart);

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
assert.match(script, /async function publicationImageUrl\(image\)/, "publication must resolve an externally reachable image URL");
assert.match(publishBody, /publicationImageUrl\(image\)/, "LinkedIn publication must use the external image URL resolver");
assert.match(script, /PUBLIC_SUPABASE_URL/, "the external image URL resolver must target Supabase storage");
assert.match(
  script,
  /signed\.startsWith\("\/object\/"\)[\s\S]*"\/api\/storage\/v1" \+ signed/,
  "relative signed Storage URLs must stay behind the Site's Supabase proxy",
);

assert.match(appHtml, /Recortar imagen/, "the composer must offer a crop editor");
assert.match(appHtml, /id="cropCanvas"/, "the crop editor must expose a preview canvas");
assert.match(appHtml, /Arrastra el recuadro para moverlo y sus esquinas para cambiar el tamaño/, "the crop editor must explain moving and resizing the crop box");
for (const key of ["free", "original", "square", "portrait", "landscape"]) {
  assert.match(appHtml, new RegExp(`data-crop-aspect="${key}"`), `the crop editor must offer the ${key} aspect preset`);
}
assert.match(appHtml, /id="cropInfo"/, "the crop editor must report the output size and LinkedIn fit");
assert.doesNotMatch(appHtml, /id="cropZoom"/, "the simple crop editor must not expose a zoom slider");
assert.doesNotMatch(appHtml, /id="cropX"/, "the simple crop editor must not expose a horizontal slider");
assert.doesNotMatch(appHtml, /id="cropY"/, "the simple crop editor must not expose a vertical slider");
assert.match(script, /addEventListener\("pointerdown"/, "the crop canvas must start a drag interaction");
assert.match(script, /addEventListener\("pointermove"/, "the crop canvas must update while dragging");
assert.match(script, /canvas\.toBlob/, "applying the crop must create a new local image file");
assert.match(script, /activeImage\s*=\s*\{[\s\S]*localFile:file[\s\S]*preview_url:url/, "applying the crop must replace the active image preview and file");
const applyCropBody = script.slice(script.indexOf("function applyCropEditor"), script.indexOf("let previewExpanded"));
assert.match(applyCropBody, /document\.createElement\("canvas"\)/, "the crop must be rendered at source resolution, not from the on-screen canvas");
assert.match(applyCropBody, /state\.rect\.w \* scale/, "the crop output size must follow the selected rectangle");

// Crop geometry and the LinkedIn feed aspect rules, exercised directly.
const pick = name => {
  const start = script.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} must exist`);
  let depth = 0;
  for (let i = script.indexOf("{", start); i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}" && --depth === 0) return script.slice(start, i + 1);
  }
  throw new Error(`${name} is not closed`);
};
const geometry = new Function(
  "FEED_MIN_ASPECT", "FEED_MAX_ASPECT",
  `${pick("linkedinFeedAspect")}\n${pick("cropRectForAspect")}\n${pick("cropRectFromAnchor")}\nreturn { linkedinFeedAspect, cropRectForAspect, cropRectFromAnchor };`,
)(0.8, 1.91);
assert.equal(geometry.linkedinFeedAspect(1200, 1200), 1, "a square image is shown square, uncropped");
assert.equal(geometry.linkedinFeedAspect(1080, 1350), 0.8, "a 4:5 portrait is shown uncropped");
assert.equal(geometry.linkedinFeedAspect(1080, 1920), 0.8, "taller images are cut to 4:5 in the feed");
assert.equal(geometry.linkedinFeedAspect(3000, 1000), 1.91, "wider images are cut to 1.91:1 in the feed");
assert.deepEqual(geometry.cropRectForAspect(2000, 1000, 1), { x: 500, y: 0, w: 1000, h: 1000 }, "a square crop of a landscape image is centred");
assert.deepEqual(geometry.cropRectForAspect(2000, 1000, 1, 0, 500), { x: 0, y: 0, w: 1000, h: 1000 }, "an aspect crop is kept inside the image");
assert.deepEqual(geometry.cropRectForAspect(800, 600, null), { x: 0, y: 0, w: 800, h: 600 }, "a free crop starts as the whole image");
const free = geometry.cropRectFromAnchor(100, 100, 400, 300, 1000, 1000, null, 20);
assert.deepEqual(free, { x: 100, y: 100, w: 300, h: 200 }, "a free crop follows the pointer");
const flipped = geometry.cropRectFromAnchor(500, 500, 200, 100, 1000, 1000, null, 20);
assert.deepEqual(flipped, { x: 200, y: 100, w: 300, h: 400 }, "dragging past the anchor flips the rectangle");
const locked = geometry.cropRectFromAnchor(0, 0, 900, 200, 1000, 1000, 1, 20);
assert.equal(locked.w, locked.h, "a locked 1:1 crop stays square");
const clamped = geometry.cropRectFromAnchor(800, 800, 2000, 1000, 1000, 1000, 1, 20);
assert(clamped.x + clamped.w <= 1000 && clamped.y + clamped.h <= 1000, "a locked crop never leaves the image");

// The LinkedIn preview must look like the feed: real image proportions and "…más".
assert.match(script, /onload="fitLinkedinPreview\(this\)"/, "the preview image must take LinkedIn's feed proportions once loaded");
assert.match(script, /function setPreviewBody\(text\)/, "the preview text must be rendered through the LinkedIn truncation helper");
assert.match(script, /"…más"/, "long posts must collapse behind LinkedIn's \"…más\" link");

// Image transforms. The Supabase project is in us-west-2 and the team works from
// China, so the composer must never pull a full-size phone original just to fill a
// preview card. Publication is the opposite: LinkedIn gets the untouched file.
const cropStart = script.indexOf("async function openCropEditor");
const cropBody = script.slice(cropStart, script.indexOf("function closeCropEditor", cropStart));
const hydrateStart = script.indexOf("async function hydrateImage");
const hydrateBody = script.slice(hydrateStart, script.indexOf("const DRAFT_BUFFER_KEY", hydrateStart));
const publicationStart = script.indexOf("async function publicationImageUrl");
const publicationBody = script.slice(publicationStart, script.indexOf("function setSaveBusy", publicationStart));
assert(cropStart >= 0 && hydrateStart >= 0 && publicationStart >= 0, "image helpers must exist");

assert.match(script, /async function signedUrl\(path, mediaItem = null, transform = null\)/, "signedUrl must accept an optional image transform");
assert.match(script, /body: JSON\.stringify\(transform \?/, "signedUrl must forward the transform to the sign request");
assert.match(script, /const PREVIEW_TRANSFORM = \{ width: \d+/, "the composer must define a lightweight preview transform");
assert.match(script, /const CROP_TRANSFORM = \{ width: \d+/, "the crop editor must define its own transform");
assert.match(hydrateBody, /signedUrl\([^)]*PREVIEW_TRANSFORM\)/, "the editor thumbnail and LinkedIn preview must request the resized image");
assert.match(cropBody, /signedUrl\([^)]*CROP_TRANSFORM\)/, "the crop editor must request its own resized image");
assert.doesNotMatch(publicationBody, /TRANSFORM/, "LinkedIn must receive the untouched original, never a transformed copy");
assert.match(script, /signed\.startsWith\("\/render\/"\)/, "transformed signed URLs come back under /render/ and must be resolved too");

// Multi-account publishing (the LinkedIn org page and, once connected, a
// personal profile) - the composer must let the user pick which account a
// post goes out as, instead of silently always picking "the org account, or
// whatever accounts[0] happens to be" (which could even resolve to a brand
// new, not-yet-authorized personal account depending on fetch order).
const renderComposerStart = script.indexOf("function renderComposer");
const renderComposerBody = script.slice(renderComposerStart, script.indexOf("function bindComposer", renderComposerStart));
assert(renderComposerStart >= 0, "renderComposer must exist");
assert.match(renderComposerBody, /id="accountSelect"/, "the composer must offer an account selector");
assert.match(renderComposerBody, /const selectedAccountId = p\.social_account_id \|\| accounts\.find\(a => a\.enabled\)\?\.id/, "the account selector must default to the post's own account, then any connected one");
assert.match(renderComposerBody, /\$\{a\.enabled \? "" : " disabled"\}/, "an unauthorized account must not be selectable in the dropdown");
assert.match(renderComposerBody, /const disconnectedAccount = accounts\.find\(a => !a\.enabled\)/, "the composer must detect any account still pending authorization");
assert.match(renderComposerBody, /linkedin-oauth-start\?social_account_id=/, "the composer must offer a direct link to connect a pending account");
assert.match(renderComposerBody, /FUNCTION_BASE \+ "\/linkedin-oauth-start/, "the connect link must go through the app's own endpoint resolver, not a hardcoded URL");

assert.match(saveBody, /const selectedAccountId = \$\("accountSelect"\)\?\.value \|\| ""/, "saving must read the chosen account from the selector");
assert.match(saveBody, /accounts\.find\(a => a\.id === selectedAccountId\) \|\| accounts\.find\(a => a\.enabled\) \|\| accounts\[0\]/, "saving must publish as the selected account, not always the same fixed one");
assert.doesNotMatch(saveBody, /a\.display_name === ORG_NAME/, "the account lookup must no longer be hardcoded to the organization page");
const patchBranch = saveBody.slice(saveBody.indexOf("if (activePost?.id)"), saveBody.indexOf("} else {"));
assert.match(patchBranch, /social_account_id: account\.id/, "editing an existing draft must be able to move it to a different account, not just create-time");

console.log("editor regression test passed");
