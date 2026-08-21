/**
 * Capitalises the first letter of a line, for lists that read as sentences.
 *
 * A highlight usually starts wherever the reader's finger did, which is often
 * mid-sentence — "when the moon was at its fullest". Set beside a bullet in an
 * outline that reads as a mistake rather than as a quotation, so the first
 * letter is raised for display.
 *
 * It raises the first *letter*, not the first character: a passage opening on a
 * quotation mark, a bracket or an ellipsis keeps it, and the letter after it is
 * the one that changes. Nothing is written back — the stored text is what was
 * highlighted, and this is only how it is shown.
 */
export function sentenceCase(text) {
  if (!text) return text;
  const at = [...text].findIndex((character) => character.toLowerCase() !== character.toUpperCase());
  // No cased letters at all — a number, a symbol, or a script without case.
  if (at === -1) return text;
  const letter = text[at];
  const upper = letter.toUpperCase();
  if (upper === letter) return text;
  return text.slice(0, at) + upper + text.slice(at + 1);
}
