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

assert.match(appHtml, /Ajustar encuadre/, "the composer must offer a crop/position editor");
assert.match(appHtml, /id="cropCanvas"/, "the crop editor must expose a preview canvas");
assert.match(appHtml, /Arrastra la imagen dentro del recuadro/, "the crop editor must explain direct image dragging");
assert.doesNotMatch(appHtml, /id="cropZoom"/, "the simple crop editor must not expose a zoom slider");
assert.doesNotMatch(appHtml, /id="cropX"/, "the simple crop editor must not expose a horizontal slider");
assert.doesNotMatch(appHtml, /id="cropY"/, "the simple crop editor must not expose a vertical slider");
assert.match(script, /addEventListener\("pointerdown"/, "the crop canvas must start a drag interaction");
assert.match(script, /addEventListener\("pointermove"/, "the crop canvas must update while dragging");
assert.match(script, /canvas\.toBlob/, "applying the crop must create a new local image file");
assert.match(script, /activeImage\s*=\s*\{[\s\S]*localFile:file[\s\S]*preview_url:url/, "applying the crop must replace the active image preview and file");

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
