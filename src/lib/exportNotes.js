import { colorLabel } from './highlightColors.js';

function locationLabel(highlight) {
  if (highlight.format === 'pdf') return `p. ${highlight.page}`;
  return highlight.chapter || '';
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
