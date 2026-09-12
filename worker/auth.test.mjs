import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const { default: worker, renderAppHtml } = await import("./index.js");
const html = await (await worker.fetch(new Request("https://lili-social.test/"), {})).text();
const directHtml = renderAppHtml({
  supabaseUrl: "https://project.supabase.co",
  publishableKey: "test-publishable-key",
  transport: "direct",
});

assert.match(source, /\/api\/auth\/recover/, "the worker must proxy password recovery");
assert.match(source, /async function requestPasswordReset\(/, "the UI must request a recovery email");
assert.match(source, /async function updatePassword\(/, "the UI must update the password from a recovery link");
assert.match(source, /¿Olvidaste|Restablecer contraseña/, "the login must expose password recovery");
assert.match(
  source,
  /targetPath === "\/auth\/v1\/token" \|\| targetPath === "\/auth\/v1\/recover"[\s\S]*headers\.set\("Authorization", "Bearer " \+ key\)/,
  "login and recovery must forward the Supabase anonymous authorization key",
);
assert.doesNotMatch(
  html,
  /credentials:\s*["']omit["']/,
  "private Site auth requests must not discard the ChatGPT session cookie",
);
assert.equal(
  (html.match(/credentials:\s*["']same-origin["']/g) || []).length,
  1,
  "proxy-mode auth requests must preserve same-origin credentials through the shared auth helper",
);
assert.match(directHtml, /const SUPABASE_URL = "https:\/\/project\.supabase\.co"/);
assert.match(directHtml, /const SUPABASE_PUBLISHABLE_KEY = "test-publishable-key"/);
assert.match(directHtml, /const LILI_TRANSPORT = "direct"/);
assert.match(directHtml, /"\/auth\/v1\/token"/);
assert.match(directHtml, /"\/auth\/v1\/recover"/);
assert.match(directHtml, /"\/auth\/v1\/user"/);
assert.match(directHtml, /redirect_to:\s*applicationRoot\(\)/);
console.log("auth recovery regression test passed");
