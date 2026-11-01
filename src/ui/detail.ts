/**
 * Markdown → HTML for the detail panel. The text comes from the model (and through it, from web pages and apps it
 * analysed), so raw HTML is escaped, only http(s)/mailto links survive, and images become text.
 */
import { Marked } from "marked";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

const SAFE_LINK = /^(https?:|mailto:)/i;

const markdown = new Marked({
  gfm: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!SAFE_LINK.test(href)) return text;
      const tip = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${tip}>${text}</a>`;
    },
    image({ text }) {
      return text ? `<span class="image-alt">[image: ${escapeHtml(text)}]</span>` : "";
    },
  },
});

export function renderDetail(source: string): string {
  return markdown.parse(source, { async: false });
}
