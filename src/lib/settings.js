import { getPref, setPref } from './db.js';

export const DEFAULT_SETTINGS = {
  theme: 'sepia', // light | sepia | dark | black
  fontSize: 105, // percent, EPUB only
  lineHeight: 1.55,
  fontFamily: 'serif', // serif | sans | publisher
  letterSpacing: 0, // px
  margin: 6, // percent of the viewport width, both formats
  flow: 'paginated', // paginated | scrolled
  justify: false,
  pageAnimation: true, // slide the page across a turn
  pdfFit: 'width', // width | page — what 100% zoom means for a PDF
  pdfZoom: 1, // multiplier applied on top of the fit
  defaultColor: 'yellow',
  tapToErase: false, // tap a highlight to remove it instead of opening its menu
  keepAwake: false,
};

export const FONT_STACKS = {
  serif: 'Iowan Old Style, Palatino, Palatino Linotype, "Book Antiqua", Georgia, serif',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  publisher: null, // leave the book's own fonts alone
};

export const THEMES = {
  light: { name: 'Light', bg: '#ffffff', fg: '#16161a', muted: '#6b7280' },
  sepia: { name: 'Sepia', bg: '#f6ecd9', fg: '#453a29', muted: '#8a7b63' },
  dark: { name: 'Dark', bg: '#22242a', fg: '#dcdde2', muted: '#9095a0' },
  black: { name: 'Black', bg: '#000000', fg: '#c6c8cf', muted: '#7c8089' },
};

const KEY = 'reader-settings';

export async function loadSettings() {
  const stored = await getPref(KEY, null);
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

export async function saveSettings(settings) {
  await setPref(KEY, settings);
}
