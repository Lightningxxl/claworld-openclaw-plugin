const FULL_WIDTH_RANGES = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f202],
  [0x1f210, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f250, 0x1f251],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

export function fontFamily() {
  return "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'WenQuanYi Zen Hei', "
    + "'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'IPA P Gothic', "
    + "'AR PL UMing CN', 'Arial Unicode MS', -apple-system, BlinkMacSystemFont, "
    + "'Segoe UI', Arial, sans-serif";
}

function isFullWidthCharacter(character) {
  const codePoint = character.codePointAt(0) || 0;
  return FULL_WIDTH_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

export function charUnits(character) {
  if (character === '\n') return 0;
  if (/\s/u.test(character)) return 0.35;
  return isFullWidthCharacter(character) ? 1 : 0.55;
}

export function textUnits(text) {
  return [...String(text ?? '')].reduce((total, character) => total + charUnits(character), 0);
}

export function displayCols(text) {
  return [...String(text ?? '')].reduce((total, character) => (
    total + (character === '\n' ? 0 : isFullWidthCharacter(character) ? 2 : 1)
  ), 0);
}

function wrapTokens(paragraph) {
  const tokens = [];
  let current = '';
  const flush = () => {
    if (!current) return;
    tokens.push(current);
    current = '';
  };
  for (const character of [...String(paragraph ?? '')]) {
    if (/\s/u.test(character)) {
      flush();
      tokens.push(' ');
    } else if (isFullWidthCharacter(character)) {
      flush();
      tokens.push(character);
    } else {
      current += character;
    }
  }
  flush();
  return tokens;
}

export function wrapText(text, maxUnits) {
  const lines = [];
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    let current = '';
    let currentUnits = 0;
    for (const token of wrapTokens(paragraph)) {
      if (/^\s+$/u.test(token)) {
        const tokenUnits = textUnits(token);
        if (current && currentUnits + tokenUnits <= maxUnits) {
          current += token;
          currentUnits += tokenUnits;
        }
        continue;
      }
      const tokenUnits = textUnits(token);
      if (current && currentUnits + tokenUnits > maxUnits) {
        lines.push(current.trimEnd());
        current = '';
        currentUnits = 0;
      }
      if (tokenUnits > maxUnits) {
        for (const character of [...token]) {
          const units = charUnits(character);
          if (current && currentUnits + units > maxUnits) {
            lines.push(current.trimEnd());
            current = '';
            currentUnits = 0;
          }
          current += character;
          currentUnits += units;
        }
      } else {
        current += token;
        currentUnits += tokenUnits;
      }
    }
    if (current || lines.length === 0) lines.push(current.trimEnd());
  }
  return lines;
}

export function ellipsizeText(text, maxUnits, suffix = '...') {
  const value = String(text ?? '');
  if (textUnits(value) <= maxUnits) return value;
  const allowed = Math.max(0, maxUnits - textUnits(suffix));
  let kept = '';
  let used = 0;
  for (const character of [...value]) {
    const units = charUnits(character);
    if (used + units > allowed) break;
    kept += character;
    used += units;
  }
  return `${kept.trimEnd()}${suffix}`;
}

export function clipDisplay(text, maxCols) {
  const value = String(text ?? '');
  if (displayCols(value) <= maxCols) return value;
  const suffix = '...';
  const target = Math.max(0, maxCols - suffix.length);
  let kept = '';
  let used = 0;
  for (const character of [...value]) {
    const cols = character === '\n' ? 0 : isFullWidthCharacter(character) ? 2 : 1;
    if (used + cols > target) break;
    kept += character;
    used += cols;
  }
  return `${kept.trimEnd()}${suffix}`;
}
