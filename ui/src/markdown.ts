// Turns Pia's Markdown into safe HTML. Links become plain text and remote
// images are dropped, so nothing in an answer can open or load anything.

import DOMPurify from "dompurify";
import { marked } from "marked";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "b", "i", "u", "s", "del", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "code", "pre", "hr",
  "table", "thead", "tbody", "tr", "th", "td", "a", "span",
];

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(markdown: string): DocumentFragment {
  const html = marked.parse(markdown, { async: false });
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [],
    RETURN_DOM_FRAGMENT: true,
  });
  // Make links inert: keep the words, drop the link.
  for (const link of Array.from(fragment.querySelectorAll("a"))) {
    const span = document.createElement("span");
    span.className = "inert-link";
    span.textContent = link.textContent ?? "";
    link.replaceWith(span);
  }
  return fragment;
}
