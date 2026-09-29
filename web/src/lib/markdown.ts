import DOMPurify from "isomorphic-dompurify";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

// Summaries of maths and physics lessons are full of formulas; the agent
// writes them as $…$ and they are rendered at the same time as the Markdown.
const md = new Marked({ gfm: true, breaks: false }).use(markedKatex({ throwOnError: false, nonStandard: true }));

/**
 * Summaries arrive from an API token or a shared unit's owner — both
 * untrusted from the reader's point of view, so the HTML is always sanitised.
 */
export function renderMarkdown(src: string | null | undefined): string {
  if (!src) return "";
  const html = md.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } });
}
