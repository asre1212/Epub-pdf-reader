import { colorLabel } from './highlightColors.js';
import { sentenceCase } from './textCase.js';

function locationLabel(highlight) {
  if (highlight.format === 'pdf') return `p. ${highlight.page}`;
  return highlight.chapter || '';
}

/**
 * Where a passage sits, when saying so adds anything.
 *
 * Under a heading that is already the chapter name, repeating it on every
 * bullet is noise on every line of the document. A page number never is.
 */
function placeUnder(highlight, sectionTitle) {
  const label = locationLabel(highlight);
  return label && label !== sectionTitle ? label : '';
}

/**
 * The line under a highlight: its colour, where it sits, and — when the section
 * heading is not already the book — which book it came from. Grouped by
 * project, a section mixes books, and a quotation with no source is useless.
 */
function metaFor(entry, group) {
  const parts = [colorLabel(entry.highlight.color), locationLabel(entry.highlight)];
  if (group.kind !== 'book' && entry.book) parts.push(entry.book.title);
  return parts.filter(Boolean).join(' · ');
}

export function highlightsToMarkdown(groups) {
  const out = ['# Highlights', ''];
  for (const group of groups) {
    out.push(`## ${group.title}`);
    if (group.subtitle) out.push(`*${group.subtitle}*`);
    out.push('');
    for (const entry of group.entries) {
      const h = entry.highlight;
      out.push(`> ${h.text.replace(/\n+/g, '\n> ')}`);
      const tags = metaFor(entry, group);
      if (tags) out.push(`\n— ${tags}`);
      if (h.note) out.push(`\n**Note:** ${h.note}`);
      out.push('');
    }
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

export function highlightsToText(groups) {
  const out = [];
  for (const group of groups) {
    out.push(group.title.toUpperCase());
    if (group.subtitle) out.push(group.subtitle);
    out.push('-'.repeat(Math.min(60, Math.max(group.title.length, 8))));
    out.push('');
    for (const entry of group.entries) {
      const h = entry.highlight;
      out.push(`"${h.text}"`);
      const tags = metaFor(entry, group);
      if (tags) out.push(`   ${tags}`);
      if (h.note) out.push(`   Note: ${h.note}`);
      out.push('');
    }
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

/**
 * A Cornell sheet as one document.
 *
 * Markdown has no columns, so the cue becomes the heading of the passage it
 * recalls — which is what a cue is for. Reading it back, the cues are the
 * skimmable outline and the quotations hang beneath them, which is how the
 * sheet is meant to be revised from.
 */
export function cornellToMarkdown(doc) {
  const out = [`# ${doc.book.title}`];
  if (doc.book.author) out.push(`*${doc.book.author}*`);
  out.push('');

  for (const section of doc.sections) {
    if (section.title) {
      out.push(`## ${section.title}`);
      out.push('');
    }
    for (const { highlight } of section.entries) {
      out.push(`### ${highlight.cue || '—'}`);
      out.push('');
      out.push(`> ${highlight.text.replace(/\n+/g, '\n> ')}`);
      const place = placeUnder(highlight, section.title);
      if (place) out.push(`\n— ${place}`);
      if (highlight.note) out.push(`\n${highlight.note}`);
      out.push('');
    }
    if (section.summary) {
      out.push(`**Summary${section.title ? ` — ${section.title}` : ''}:** ${section.summary}`);
      out.push('');
    }
  }

  if (doc.summary) {
    out.push('---', '', `**Summary — ${doc.book.title}**`, '', doc.summary, '');
  }
  return out.join('\n').trimEnd() + '\n';
}

/**
 * A book's highlights as one outline.
 *
 * Markdown is already an outline format, so this is close to a direct
 * translation: the chapter becomes the heading, each passage a bullet, and a
 * note a nested bullet under the passage it belongs to. What comes out pastes
 * into a document as structure rather than as a wall of quotations.
 */
export function outlineToMarkdown(doc) {
  const out = [`# ${doc.book.title}`];
  if (doc.book.author) out.push(`*${doc.book.author}*`);
  out.push('');

  const numbered = doc.sections.length > 1 || !!doc.sections[0]?.title;
  doc.sections.forEach((section, index) => {
    if (section.title) {
      out.push(`## ${numbered ? `${index + 1}. ` : ''}${section.title}`);
      out.push('');
    }
    for (const { highlight } of section.entries) {
      const where = placeUnder(highlight, section.title);
      // A single bullet, however long the passage: a quotation broken across
      // list items stops being one bullet in every renderer downstream.
      const text = sentenceCase(highlight.text.replace(/\s*\n+\s*/g, ' ').trim());
      out.push(`- ${text}${where ? ` *(${where})*` : ''}`);
      if (highlight.cue) out.push(`  - **${sentenceCase(highlight.cue)}**`);
      if (highlight.note) {
        out.push(`  - ${sentenceCase(highlight.note.replace(/\s*\n+\s*/g, ' ').trim())}`);
      }
    }
    out.push('');
    if (section.summary) {
      out.push(`**Summary.** ${section.summary}`);
      out.push('');
    }
  });

  if (doc.summary) {
    out.push('---', '', `**Summary — ${doc.book.title}.** ${doc.summary}`, '');
  }
  return out.join('\n').trimEnd() + '\n';
}

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  // Clipboard API is unavailable on insecure origins and some older WebViews.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand?.('copy');
  area.remove();
  return !!ok;
}
