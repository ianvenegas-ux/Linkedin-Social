import assert from "node:assert/strict";

const { default: worker } = await import("./index.js");

const originalFetch = globalThis.fetch;
let forwardedUrl = "";
let forwardedInit = null;

try {
  globalThis.fetch = async (url, init) => {
    forwardedUrl = String(url);
    forwardedInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const response = await worker.fetch(
    new Request("https://lili-social.test/api/functions/social-publish-linkedin", {
      method: "POST",
      headers: {
        Authorization: "Bearer user-session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ post_id: "post-1" }),
    }),
    {
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    },
  );

  assert.equal(response.status, 200);
  assert.equal(
    forwardedUrl,
    "https://project.supabase.co/functions/v1/social-publish-linkedin",
    "Edge Functions must be invoked through Supabase's /functions/v1 route",
  );
  assert.equal(
    forwardedInit.headers.get("Authorization"),
    "Bearer user-session-token",
    "the signed-in user's token must reach the Edge Function",
  );
  assert.equal(forwardedInit.headers.get("apikey"), "publishable-key");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Supabase Edge Function routing regression test passed");
