// Pure-JS twin of scorer/src/lib.rs — identical 7-check bitmask, same API.
// Family decision 2026-10-14: drop Rust/WASM; zero toolchain, testable on phone,
// wasm can drop in later behind the same scoreHtml() if the gate ever grows heavy.

const CHECKS = [
  "doctype and html tag",
  "balanced script tags",
  "balanced style tags",
  "balanced div tags",
  "no external URLs",
  "not a stub",
  "closing html tag",
];

const count = (h, needle) => h.split(needle).length - 1;

export function scoreHtml(html) {
  const raw = typeof html === "string" ? html : "";
  // invalid utf-8 equivalent: lone surrogates / non-string
  if (typeof html !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(html)) {
    return { passed: CHECKS.length, total: CHECKS.length, failed: ["invalid utf-8"] };
  }

  const h = raw.toLowerCase();
  const fails = [];

  if (!(h.includes("<!doctype html") && h.includes("<html"))) fails.push(CHECKS[0]);
  if (count(h, "<script") !== count(h, "</script>")) fails.push(CHECKS[1]);
  if (count(h, "<style") !== count(h, "</style>")) fails.push(CHECKS[2]);
  if (count(h, "<div") !== count(h, "</div>")) fails.push(CHECKS[3]);
  if (h.includes('src="http') || h.includes('href="http') || h.includes("src='http")) fails.push(CHECKS[4]);
  if (h.length < 500 || h.includes("lorem ipsum") || h.includes("<!-- todo")) fails.push(CHECKS[5]);
  if (!h.trimEnd().endsWith("</html>")) fails.push(CHECKS[6]);

  return { passed: CHECKS.length - fails.length, total: CHECKS.length, failed: fails };
}
