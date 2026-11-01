/** Turns markdown into something that sounds right when read by a speech engine. */
export function toSpeakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/^\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+(.+)$/gm, "$1.")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/^>\s?/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\.\.(?=\s|$)/g, ".")
    .trim();
}

/**
 * Splits text into sentence-sized chunks so speech starts quickly and can be stopped between chunks.
 * A chunk never exceeds maxLen unless a single word does.
 */
export function chunkForSpeech(text: string, maxLen = 220): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxLen) {
      chunks.push(sentence);
      continue;
    }
    let line = "";
    for (const word of sentence.split(/\s+/)) {
      if (line && line.length + 1 + word.length > maxLen) {
        chunks.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) chunks.push(line);
  }
  return chunks;
}
