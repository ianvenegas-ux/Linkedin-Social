// LinkedIn's Posts API reads `commentary` as "little text": these characters
// are markup and must be backslash-escaped, otherwise LinkedIn silently drops
// everything from the first unescaped one onwards (a "(" cut a post short on
// 2026-10-10). Hashtags use the documented {hashtag|\#|tag} template so they
// stay clickable.
const RESERVED = /[\\|{}@[\]()<>#*_~]/g;
const HASHTAG = /#([\p{L}\p{N}]+)/gu;

function escapeReserved(text) {
  return text.replace(RESERVED, "\\$&");
}

export function toLinkedinLittleText(text) {
  const source = String(text ?? "");
  let result = "";
  let last = 0;
  for (const match of source.matchAll(HASHTAG)) {
    result += escapeReserved(source.slice(last, match.index)) + `{hashtag|\\#|${match[1]}}`;
    last = match.index + match[0].length;
  }
  return result + escapeReserved(source.slice(last));
}
