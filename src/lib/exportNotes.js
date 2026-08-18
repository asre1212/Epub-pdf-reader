import { colorLabel } from './highlightColors.js';

function locationLabel(highlight) {
  if (highlight.format === 'pdf') return `p. ${highlight.page}`;
  return highlight.chapter || '';
}

export function highlightsToMarkdown(groups) {
  const out = ['# Highlights', ''];
  for (const group of groups) {
    out.push(`## ${group.book.title}`);
    if (group.book.author) out.push(`*${group.book.author}*`);
    out.push('');
    for (const h of group.highlights) {
      const where = locationLabel(h);
      out.push(`> ${h.text.replace(/\n+/g, '\n> ')}`);
      const tags = [colorLabel(h.color), where].filter(Boolean).join(' · ');
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
    out.push(group.book.title.toUpperCase());
    if (group.book.author) out.push(group.book.author);
    out.push('-'.repeat(Math.min(60, Math.max(group.book.title.length, 8))));
    out.push('');
    for (const h of group.highlights) {
      out.push(`"${h.text}"`);
      const where = locationLabel(h);
      const tags = [colorLabel(h.color), where].filter(Boolean).join(' · ');
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
