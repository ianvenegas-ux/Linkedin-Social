import assert from "node:assert/strict";

const { default: worker } = await import("./index.js");
const appHtml = await (await worker.fetch(new Request("https://lili-social.test/"), {})).text();
const script = appHtml.match(/<script>([\s\S]*)<\/script>/)[1];

const calendarStart = script.indexOf("function renderCalendar");
const calendarBody = script.slice(calendarStart, script.indexOf("function renderMaterials", calendarStart));
assert(calendarStart >= 0, "renderCalendar must exist");

// Each day cell needs a stable, unambiguous drop target (an ISO date), and the
// weekday-header / leading-offset cells (which have no real date) must not get
// one - only cells built from an actual `date` in the month loop do.
assert.match(calendarBody, /data-date="\$\{iso\}"/, "in-month day cells must carry the date they represent");
assert.match(calendarBody, /const iso=`\$\{date\.getFullYear\(\)\}-/, "the day-cell date must be derived from the same `date` used to match posts, not recomputed separately");

// Drag and drop: events are draggable, days accept a drop, and the reschedule
// preserves time-of-day (only the calendar day changes).
assert.match(calendarBody, /draggable="true"/, "calendar events must be draggable");
assert.match(script, /function bindCalendarDrag\(\)/, "calendar drag interactions must be wired up");
assert.match(script, /addEventListener\("dragstart"/, "dragstart must be handled on events");
assert.match(script, /addEventListener\("drop"/, "drop must be handled on day cells");
assert.match(script, /async function rescheduleToDate\(postId,isoDate\)/, "dropping an event must reschedule its post");
assert.match(script, /next\.setFullYear\(year,month-1,day\)/, "rescheduling must move the calendar day without touching the stored time-of-day");
assert.match(script, /method:"PATCH"/, "rescheduling must persist via PATCH, not a full re-save");
assert.match(script, /if\(next\.getFullYear\(\)===year&&next\.getMonth\(\)===month-1&&next\.getDate\(\)===day\)return;/, "dropping a post back on its own day must be a no-op, not a wasted write");

// Hover preview: a lightweight popover with a thumbnail (via the resized
// PREVIEW_TRANSFORM, never the full original) and a short body snippet.
assert.match(script, /function bindCalendarPreview\(\)/, "calendar events must offer a hover preview");
assert.match(script, /addEventListener\("mouseenter"/, "hover preview must trigger on mouseenter");
assert.match(script, /addEventListener\("mouseleave",hideCalendarPreview\)/, "hover preview must clean up on mouseleave");
assert.match(script, /async function showCalendarPreview\(eventEl,post\)/, "hover preview must exist as its own function");
assert.match(script, /signedUrl\(media0\.cached_storage_path\|\|media0\.source_path,media0,PREVIEW_TRANSFORM\)/, "the hover preview thumbnail must reuse the small preview transform, not the full-size image");
assert.match(script, /className="event-preview"/, "the hover preview must be styled as a popover, not inline content");
assert.match(script, /\(post\.body\|\|""\)\.slice\(0,160\)/, "the hover preview body must be a short snippet, not the full post text");
assert.match(script, /\.textContent=post\.internal_title/, "the hover preview must use textContent, not innerHTML, so a post title can never inject markup");

console.log("calendar regression test passed");
