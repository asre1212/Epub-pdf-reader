export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Yellow', hex: '#ffd54a' },
  { id: 'green', label: 'Green', hex: '#8ee08a' },
  { id: 'blue', label: 'Blue', hex: '#8fc9ff' },
  { id: 'pink', label: 'Pink', hex: '#ff9ec4' },
  { id: 'purple', label: 'Purple', hex: '#c9a6ff' },
];

export const DEFAULT_COLOR = 'yellow';

export function colorHex(id) {
  return (HIGHLIGHT_COLORS.find((c) => c.id === id) || HIGHLIGHT_COLORS[0]).hex;
}

export function colorLabel(id) {
  return (HIGHLIGHT_COLORS.find((c) => c.id === id) || HIGHLIGHT_COLORS[0]).label;
}
