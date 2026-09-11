import assert from "node:assert/strict";
import { buildPublishedPostUpdate } from "./publish-state.mjs";

const update = buildPublishedPostUpdate(
  { status: "approved" },
  "user-1",
  "urn:li:share:123",
  "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123",
  "2026-09-11T00:00:00.000Z",
);

assert.deepEqual(update, {
  status: "published",
  published_urn: "urn:li:share:123",
  published_url: "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123",
  approved_at: "2026-09-11T00:00:00.000Z",
  approved_by: "user-1",
  last_error: null,
});
assert.equal("published_at" in update, false);
console.log("publication state regression test passed");

