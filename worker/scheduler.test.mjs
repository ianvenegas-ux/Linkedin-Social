import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
assert.match(source, /async function processDueJobs\(\)/, "due publication processing must exist");
const processStart = source.indexOf("async function processDueJobs()");
const processEnd = source.indexOf("function renderRecentPosts", processStart);
const processBody = source.slice(processStart, processEnd);
assert.match(processBody, /social_publication_jobs/, "scheduler must use publication jobs");
assert.match(processBody, /queue_state.*processing/, "scheduler must claim queued jobs");
assert.match(processBody, /queue_state.*completed/, "scheduler must complete successful jobs");
console.log("scheduled publication processing test passed");

