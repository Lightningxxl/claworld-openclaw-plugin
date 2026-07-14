import {
  clipDisplay,
  displayCols,
  ellipsizeText,
  escapeXml,
  fontFamily,
  textUnits,
  wrapText,
} from './transcript-report-stylekit.js';

const CANVAS_MARGIN = 24;
const FRAME_MARGIN = 16;
const HEADER_Y = 48;
const HEADER_CARD_HEIGHT_ONE_LINE = 92;
const HEADER_CARD_HEIGHT_TWO_LINES = 110;
const HEADER_BOTTOM_PAD = 20;
const BODY_TOP_GAP = 24;
const PAGE_BOTTOM = 54;
const ITEM_GAP = 22;
const TIME_ROW_HEIGHT = 42;
const ELLIPSIS_HEIGHT = 34;
const BUBBLE_PAD_X = 32;
const BUBBLE_PAD_Y = 22;
const LABEL_HEIGHT = 30;
const LABEL_OVERLAP = 18;
const LABEL_RAISE = 9;
const LABEL_MAX_COLS = 14;
const BUBBLE_MAX_RATIO = 0.64;
const BUBBLE_MIN_WIDTH = 200;
const FONT_SIZE = 18;
const SMALL_FONT_SIZE = 12;
const LABEL_FONT_SIZE = 15;
const TITLE_FONT_SIZE = 34;
const LINE_HEIGHT = 29;
const HEADER_SUBTITLE_MAX_UNITS = 33;
const HEADER_SUBTITLE_MAX_LINES = 2;
const HEADER_SUBTITLE_LINE_HEIGHT = 19;
const TAG_HEIGHT = 58;
const TAG_ICON_SIZE = 30;
const TAG_ICON_GAP = 12;
const TAG_ICON_TOP_GAP = 8;
const TAG_FALLBACK_MAX_COLS = 10;
const TEXT_UNIT_PX = 18;
const BLACK = '#090909';

const THEME = Object.freeze({
  paper: '#FBF8EF',
  headerFill: '#FEF5D8',
  muted: '#222222',
  leftFill: '#EFFFF5',
  leftLabel: '#62E69D',
  rightFill: '#EFE0FF',
  rightLabel: '#B785FF',
  timeFill: '#FFFDF7',
});

const TAG_ICON_THEMES = Object.freeze({
  like: ['#D8F4FF', '#58B7FF'],
  dislike: ['#FFE0EA', '#FF6A9A'],
  'request end': ['#FFF0A8', '#FF9F2F'],
});

const fixed = (value, places = 1) => Number(value).toFixed(places);

function labelText(label) {
  return clipDisplay(String(label || 'AGENT').toUpperCase(), LABEL_MAX_COLS);
}

function labelWidth(label) {
  return Math.max(86, Math.min(158, displayCols(label) * 11 + 30));
}

function tagName(tag) {
  return String(tag ?? '').trim().toLowerCase();
}

function fallbackTagLabel(tag) {
  return clipDisplay(String(tag || 'tag'), TAG_FALLBACK_MAX_COLS);
}

function tagWidth(tag) {
  const normalized = tagName(tag);
  if (['like', 'dislike', 'request end'].includes(normalized)) return TAG_ICON_SIZE;
  return Math.max(58, Math.min(126, displayCols(fallbackTagLabel(normalized)) * 8 + 24));
}

function tagRowUnits(tags) {
  if (!tags.length) return 0;
  const width = tags.reduce((sum, tag) => sum + tagWidth(tag), 0)
    + Math.max(0, tags.length - 1) * TAG_ICON_GAP;
  return width / TEXT_UNIT_PX;
}

export function measureTranscriptItem(item, width) {
  const contentWidth = Math.max(270, Math.trunc(width * BUBBLE_MAX_RATIO));
  if (item.kind === 'ellipsis') {
    return {
      kind: 'ellipsis',
      message: null,
      lines: [],
      width: contentWidth,
      height: ELLIPSIS_HEIGHT,
      omittedCount: item.omitted,
      label: item.label,
    };
  }
  if (item.kind === 'time') {
    return {
      kind: 'time',
      message: null,
      lines: [],
      width: contentWidth,
      height: TIME_ROW_HEIGHT,
      label: item.label,
    };
  }

  const { message } = item;
  const maxUnits = Math.max(18, (contentWidth - BUBBLE_PAD_X * 2) / TEXT_UNIT_PX);
  const lines = wrapText(message.text, maxUnits);
  const labelUnits = textUnits(labelText(message.participantLabel)) + 4;
  const contentUnits = Math.max(
    ...lines.map((line) => textUnits(line)),
    tagRowUnits(message.tags),
    labelUnits,
    10,
  );
  const bubbleWidth = Math.trunc(Math.min(
    contentWidth,
    Math.max(BUBBLE_MIN_WIDTH, contentUnits * TEXT_UNIT_PX + BUBBLE_PAD_X * 2),
  ));
  const textHeight = lines.length * LINE_HEIGHT;
  const tagHeight = message.tags.length ? TAG_HEIGHT : 0;
  const bubbleHeight = BUBBLE_PAD_Y * 2 + textHeight + tagHeight;
  return {
    kind: 'message',
    message,
    lines,
    width: bubbleWidth,
    height: LABEL_HEIGHT - LABEL_OVERLAP + bubbleHeight + 10,
    tagHeight,
    textHeight,
  };
}

function headerSubtitleLines(subtitle) {
  const lines = wrapText(String(subtitle ?? '').trim(), HEADER_SUBTITLE_MAX_UNITS);
  if (lines.length <= HEADER_SUBTITLE_MAX_LINES) return lines;
  const visible = lines.slice(0, HEADER_SUBTITLE_MAX_LINES - 1);
  const remainder = lines.slice(HEADER_SUBTITLE_MAX_LINES - 1)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  visible.push(ellipsizeText(remainder, HEADER_SUBTITLE_MAX_UNITS, '…'));
  return visible;
}

function headerCardHeight(subtitle) {
  return headerSubtitleLines(subtitle).length > 1
    ? HEADER_CARD_HEIGHT_TWO_LINES
    : HEADER_CARD_HEIGHT_ONE_LINE;
}

function headerHeight(subtitle) {
  return HEADER_Y + headerCardHeight(subtitle) + HEADER_BOTTOM_PAD;
}

function positions(width, bubbleWidth, label, side) {
  const currentLabelWidth = labelWidth(label);
  const inset = CANVAS_MARGIN + 38;
  if (side === 'right') {
    const bubbleX = width - inset - bubbleWidth;
    return {
      bubbleX,
      labelX: bubbleX + bubbleWidth - currentLabelWidth - 16,
      labelWidth: currentLabelWidth,
      align: 'right',
    };
  }
  const bubbleX = inset;
  return {
    bubbleX,
    labelX: bubbleX + 16,
    labelWidth: currentLabelWidth,
    align: 'left',
  };
}

export function paginateTranscriptItems(items, width, maxHeight, title, subtitle) {
  const pageGroups = [[]];
  const currentHeaderHeight = headerHeight(subtitle);
  let used = currentHeaderHeight + BODY_TOP_GAP + PAGE_BOTTOM;
  items.forEach((item, index) => {
    const itemHeight = item.height + ITEM_GAP;
    let neededHeight = itemHeight;
    if (item.kind === 'time' && index + 1 < items.length) {
      neededHeight += items[index + 1].height + ITEM_GAP;
    }
    if (pageGroups.at(-1).length && used + neededHeight > maxHeight) {
      pageGroups.push([]);
      used = currentHeaderHeight + BODY_TOP_GAP + PAGE_BOTTOM;
    }
    pageGroups.at(-1).push(item);
    used += itemHeight;
  });

  return pageGroups.map((pageItems, pageIndex) => {
    let y = currentHeaderHeight + BODY_TOP_GAP;
    const layoutItems = [];
    for (const item of pageItems) {
      if (item.kind === 'ellipsis' || item.kind === 'time') {
        layoutItems.push({ kind: item.kind, y, height: item.height, label: item.label });
        y += item.height + ITEM_GAP;
        continue;
      }
      const label = labelText(item.message.participantLabel);
      const position = positions(width, item.width, label, item.message.side);
      const bubbleY = y + LABEL_HEIGHT - LABEL_OVERLAP;
      const bubbleHeight = BUBBLE_PAD_Y * 2 + item.textHeight + item.tagHeight;
      layoutItems.push({
        kind: 'message',
        y,
        ...position,
        bubbleY,
        labelY: y - LABEL_RAISE,
        label,
        width: item.width,
        bubbleHeight,
        lines: item.lines,
        message: item.message,
        tagHeight: item.tagHeight,
        textHeight: item.textHeight,
      });
      y += item.height + ITEM_GAP;
    }
    return {
      page: pageIndex + 1,
      width,
      height: Math.max(520, Math.min(maxHeight, y + PAGE_BOTTOM)),
      items: layoutItems,
      title,
      subtitle,
      footer: 'visit claworld.love',
    };
  });
}

function svgDefs() {
  return [
    '<defs>',
    `<style><![CDATA[text { font-family: ${fontFamily()}; letter-spacing: 0; } .message-row:hover rect:last-of-type { filter: url(#comicLift); }]]></style>`,
    '<pattern id="comicGridMinor" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#BED1D8" stroke-width="1" stroke-opacity="0.62"/></pattern>',
    '<pattern id="comicGridMajor" width="128" height="128" patternUnits="userSpaceOnUse"><path d="M 128 0 L 0 0 0 128" fill="none" stroke="#AABFC8" stroke-width="1.4" stroke-opacity="0.72"/></pattern>',
    '<linearGradient id="headerAccent" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#47B6FF"/><stop offset="52%" stop-color="#FF4EB4"/><stop offset="100%" stop-color="#FF8A2A"/></linearGradient>',
    '<linearGradient id="leftAccent" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#58E58F"/><stop offset="100%" stop-color="#47B6FF"/></linearGradient>',
    '<linearGradient id="rightAccent" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#A871FF"/><stop offset="100%" stop-color="#FF4EB4"/></linearGradient>',
    '<filter id="comicLift" x="-6%" y="-16%" width="112%" height="132%"><feDropShadow dx="0" dy="2" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.14"/></filter>',
    '</defs>',
  ].join('\n');
}

function starPoints(cx, cy, radius) {
  return [
    [cx, cy - radius],
    [cx + radius * 0.28, cy - radius * 0.28],
    [cx + radius, cy],
    [cx + radius * 0.28, cy + radius * 0.28],
    [cx, cy + radius],
    [cx - radius * 0.28, cy + radius * 0.28],
    [cx - radius, cy],
    [cx - radius * 0.28, cy - radius * 0.28],
  ];
}

function decorativeStarSvg(cx, cy, radius, fill, accent) {
  const points = (offsetX, offsetY) => starPoints(cx + offsetX, cy + offsetY, radius)
    .map(([x, y]) => `${fixed(x)},${fixed(y)}`)
    .join(' ');
  return [
    `<polygon points="${points(3, 5)}" fill="${accent}"/>`,
    `<polygon points="${points(0, 0)}" fill="${fill}" stroke="${BLACK}" stroke-width="3"/>`,
  ].join('\n');
}

function headerTitle(title) {
  const clean = String(title ?? '').trim();
  if (clean.startsWith('@')) return clean;
  return clean ? `@${clean}` : '@claworld';
}

function renderHeader(page) {
  const x = CANVAS_MARGIN + 26;
  const y = HEADER_Y;
  const width = page.width - (CANVAS_MARGIN + 26) * 2;
  const height = headerCardHeight(page.subtitle);
  const title = clipDisplay(headerTitle(page.title), 32);
  const subtitle = headerSubtitleLines(page.subtitle)
    .map((line, index) => `<text class="header-subtitle-line" x="${fixed(x + 35)}" y="${fixed(y + 70 + index * HEADER_SUBTITLE_LINE_HEIGHT)}" font-size="15" font-weight="600" fill="${THEME.muted}">${escapeXml(line)}</text>`)
    .join('\n');
  return [
    `<rect x="${x + 11}" y="${y + 6}" width="${width + 2}" height="${height + 10}" rx="22" fill="${BLACK}"/>`,
    `<rect x="${x + 7}" y="${y + 6}" width="${width}" height="${height + 4}" rx="22" fill="url(#headerAccent)"/>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="${THEME.headerFill}" stroke="${BLACK}" stroke-width="4"/>`,
    `<text x="${x + 28}" y="${y + 43}" font-size="${TITLE_FONT_SIZE}" font-weight="900" fill="${BLACK}">${escapeXml(title)}</text>`,
    subtitle,
    decorativeStarSvg(x + width - 62, y + 34, 22, '#FFFFFF', 'url(#headerAccent)'),
    `<circle cx="${x + width - 23}" cy="${y + 55}" r="9" fill="#72E3C0" stroke="${BLACK}" stroke-width="3"/>`,
    `<circle cx="${x + width - 25}" cy="${y + 53}" r="9" fill="#72E3C0" stroke="${BLACK}" stroke-width="3"/>`,
  ].join('\n');
}

function diamondSvg(cx, cy, radius, fill) {
  const shadow = `<polygon points="${fixed(cx + 1)},${fixed(cy + 2 - radius)} ${fixed(cx + 1 + radius * 0.46)},${fixed(cy + 2)} ${fixed(cx + 1)},${fixed(cy + 2 + radius)} ${fixed(cx + 1 - radius * 0.46)},${fixed(cy + 2)}" fill="${BLACK}" stroke="${BLACK}" stroke-width="2.5"/>`;
  const front = `<polygon points="${fixed(cx)},${fixed(cy - radius)} ${fixed(cx + radius * 0.46)},${fixed(cy)} ${fixed(cx)},${fixed(cy + radius)} ${fixed(cx - radius * 0.46)},${fixed(cy)}" fill="${fill}" stroke="${BLACK}" stroke-width="2.5"/>`;
  return `${shadow}\n${front}`;
}

function renderTimeSvg(page, item) {
  const label = clipDisplay(item.label, 22);
  const labelWidthValue = Math.max(150, displayCols(label) * 8 + 44);
  const x = page.width / 2 - labelWidthValue / 2;
  const y = item.y + 4;
  return [
    '<g class="time-row">',
    diamondSvg(x - 28, y + 16, 13, '#FF5BE2'),
    `<rect x="${fixed(x + 3)}" y="${y + 4}" width="${labelWidthValue}" height="30" rx="15" fill="${BLACK}"/>`,
    `<rect x="${fixed(x)}" y="${y}" width="${labelWidthValue}" height="30" rx="15" fill="${THEME.timeFill}" stroke="${BLACK}" stroke-width="3"/>`,
    `<text x="${fixed(page.width / 2)}" y="${y + 21}" text-anchor="middle" font-size="${FONT_SIZE}" font-weight="700" fill="${BLACK}">${escapeXml(label)}</text>`,
    diamondSvg(x + labelWidthValue + 28, y + 16, 13, '#5FE0A7'),
    '</g>',
  ].join('\n');
}

function sideColors(side) {
  return side === 'right'
    ? { fill: THEME.rightFill, label: THEME.rightLabel, accent: 'url(#rightAccent)' }
    : { fill: THEME.leftFill, label: THEME.leftLabel, accent: 'url(#leftAccent)' };
}

function bubbleLayersSvg(item, colors) {
  const { bubbleX: x, bubbleY: y, width, bubbleHeight: height } = item;
  return [
    `<rect x="${x + 11}" y="${y + 9}" width="${width + 2}" height="${height + 4}" rx="17" fill="${BLACK}"/>`,
    `<rect x="${x + 11}" y="${y + 9}" width="${width - 3}" height="${height}" rx="17" fill="${colors.accent}" stroke="${BLACK}" stroke-width="3"/>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="17" fill="${colors.fill}" stroke="${BLACK}" stroke-width="4"/>`,
  ].join('\n');
}

function thumbIconSvg(x, y, accent, down = false) {
  const paths = [
    `<path d="M${fixed(x + 7.8)} ${fixed(y + 13.3)} H${fixed(x + 12)} V${fixed(y + 24)} H${fixed(x + 7.8)} Z" fill="#FFFFFF" stroke="${BLACK}" stroke-width="2" stroke-linejoin="round"/>`,
    `<path d="M${fixed(x + 12)} ${fixed(y + 23.6)} H${fixed(x + 21.2)} C${fixed(x + 23)} ${fixed(y + 23.6)} ${fixed(x + 24)} ${fixed(y + 22.5)} ${fixed(x + 24.4)} ${fixed(y + 20.9)} L${fixed(x + 25.4)} ${fixed(y + 15.6)} C${fixed(x + 25.8)} ${fixed(y + 13.9)} ${fixed(x + 24.5)} ${fixed(y + 12.2)} ${fixed(x + 22.7)} ${fixed(y + 12.2)} H${fixed(x + 18.6)} L${fixed(x + 19.2)} ${fixed(y + 9.1)} C${fixed(x + 19.5)} ${fixed(y + 7.4)} ${fixed(x + 18.4)} ${fixed(y + 5.7)} ${fixed(x + 16.7)} ${fixed(y + 5.4)} L${fixed(x + 15.8)} ${fixed(y + 5.3)} L${fixed(x + 12)} ${fixed(y + 12.9)} Z" fill="${accent}" stroke="${BLACK}" stroke-width="2" stroke-linejoin="round"/>`,
  ].join('\n');
  if (!down) return paths;
  const centerX = x + TAG_ICON_SIZE / 2;
  const centerY = y + TAG_ICON_SIZE / 2;
  return `<g transform="rotate(180 ${fixed(centerX)} ${fixed(centerY)})">\n${paths}\n</g>`;
}

function requestEndIconSvg(x, y, accent) {
  return [
    `<path d="M${fixed(x + 22)} ${fixed(y + 4)} C${fixed(x + 25.2)} ${fixed(y + 5.4)} ${fixed(x + 26.6)} ${fixed(y + 7.8)} ${fixed(x + 26.5)} ${fixed(y + 10.6)}" fill="none" stroke="${BLACK}" stroke-width="2" stroke-linecap="round"/>`,
    `<path d="M${fixed(x + 9.215, 3)} ${fixed(y + 18.117, 3)} C${fixed(x + 10.043, 3)} ${fixed(y + 22.457, 3)} ${fixed(x + 13.384, 3)} ${fixed(y + 25.036, 3)} ${fixed(x + 17.132, 3)} ${fixed(y + 23.961, 3)} L${fixed(x + 19.44, 3)} ${fixed(y + 23.3, 3)} C${fixed(x + 22.323, 3)} ${fixed(y + 22.473, 3)} ${fixed(x + 23.488, 3)} ${fixed(y + 19.642, 3)} ${fixed(x + 22.538, 3)} ${fixed(y + 16.69, 3)} L${fixed(x + 21.435, 3)} ${fixed(y + 12.845, 3)} L${fixed(x + 9.227, 3)} ${fixed(y + 16.345, 3)} L${fixed(x + 9.215, 3)} ${fixed(y + 18.117, 3)} Z" fill="${accent}" stroke="${BLACK}" stroke-width="2" stroke-linejoin="round"/>`,
    `<path d="M${fixed(x + 9.665, 3)} ${fixed(y + 7.897, 3)} L${fixed(x + 9.473, 3)} ${fixed(y + 7.952, 3)} C${fixed(x + 8.756, 3)} ${fixed(y + 8.158, 3)} ${fixed(x + 8.286, 3)} ${fixed(y + 8.709, 3)} ${fixed(x + 8.422, 3)} ${fixed(y + 9.184, 3)} L${fixed(x + 10.192, 3)} ${fixed(y + 15.356, 3)} C${fixed(x + 10.328, 3)} ${fixed(y + 15.831, 3)} ${fixed(x + 11.019, 3)} ${fixed(y + 16.049, 3)} ${fixed(x + 11.736, 3)} ${fixed(y + 15.843, 3)} L${fixed(x + 11.928, 3)} ${fixed(y + 15.788, 3)} C${fixed(x + 12.645, 3)} ${fixed(y + 15.583, 3)} ${fixed(x + 13.115, 3)} ${fixed(y + 15.031, 3)} ${fixed(x + 12.979, 3)} ${fixed(y + 14.557, 3)} L${fixed(x + 11.209, 3)} ${fixed(y + 8.384, 3)} C${fixed(x + 11.073, 3)} ${fixed(y + 7.91, 3)} ${fixed(x + 10.382, 3)} ${fixed(y + 7.692, 3)} ${fixed(x + 9.665, 3)} ${fixed(y + 7.897, 3)} Z" fill="${accent}" stroke="${BLACK}" stroke-width="1.8"/>`,
    `<path d="M${fixed(x + 11.93, 3)} ${fixed(y + 5.999, 3)} L${fixed(x + 11.738, 3)} ${fixed(y + 6.055, 3)} C${fixed(x + 11.021, 3)} ${fixed(y + 6.26, 3)} ${fixed(x + 10.553, 3)} ${fixed(y + 6.82, 3)} ${fixed(x + 10.692, 3)} ${fixed(y + 7.306, 3)} L${fixed(x + 12.729, 3)} ${fixed(y + 14.408, 3)} C${fixed(x + 12.868, 3)} ${fixed(y + 14.894, 3)} ${fixed(x + 13.562, 3)} ${fixed(y + 15.122, 3)} ${fixed(x + 14.279, 3)} ${fixed(y + 14.916, 3)} L${fixed(x + 14.471, 3)} ${fixed(y + 14.861, 3)} C${fixed(x + 15.188, 3)} ${fixed(y + 14.655, 3)} ${fixed(x + 15.656, 3)} ${fixed(y + 14.095, 3)} ${fixed(x + 15.516, 3)} ${fixed(y + 13.609, 3)} L${fixed(x + 13.48, 3)} ${fixed(y + 6.507, 3)} C${fixed(x + 13.341, 3)} ${fixed(y + 6.021, 3)} ${fixed(x + 12.647, 3)} ${fixed(y + 5.794, 3)} ${fixed(x + 11.93, 3)} ${fixed(y + 5.999, 3)} Z" fill="${accent}" stroke="${BLACK}" stroke-width="1.8"/>`,
    `<path d="M${fixed(x + 14.636, 3)} ${fixed(y + 5.64, 3)} L${fixed(x + 14.443, 3)} ${fixed(y + 5.695, 3)} C${fixed(x + 13.727, 3)} ${fixed(y + 5.9, 3)} ${fixed(x + 13.258, 3)} ${fixed(y + 6.457, 3)} ${fixed(x + 13.396, 3)} ${fixed(y + 6.938, 3)} L${fixed(x + 15.338, 3)} ${fixed(y + 13.714, 3)} C${fixed(x + 15.476, 3)} ${fixed(y + 14.195, 3)} ${fixed(x + 16.169, 3)} ${fixed(y + 14.418, 3)} ${fixed(x + 16.886, 3)} ${fixed(y + 14.213, 3)} L${fixed(x + 17.078, 3)} ${fixed(y + 14.157, 3)} C${fixed(x + 17.795, 3)} ${fixed(y + 13.952, 3)} ${fixed(x + 18.264, 3)} ${fixed(y + 13.395, 3)} ${fixed(x + 18.126, 3)} ${fixed(y + 12.914, 3)} L${fixed(x + 16.183, 3)} ${fixed(y + 6.139, 3)} C${fixed(x + 16.045, 3)} ${fixed(y + 5.658, 3)} ${fixed(x + 15.352, 3)} ${fixed(y + 5.434, 3)} ${fixed(x + 14.636, 3)} ${fixed(y + 5.64, 3)} Z" fill="${accent}" stroke="${BLACK}" stroke-width="1.8"/>`,
    `<path d="M${fixed(x + 17.8, 3)} ${fixed(y + 6.085, 3)} L${fixed(x + 17.702, 3)} ${fixed(y + 6.113, 3)} C${fixed(x + 16.971, 3)} ${fixed(y + 6.322, 3)} ${fixed(x + 16.482, 3)} ${fixed(y + 6.851, 3)} ${fixed(x + 16.609, 3)} ${fixed(y + 7.294, 3)} L${fixed(x + 18.176, 3)} ${fixed(y + 12.759, 3)} C${fixed(x + 18.303, 3)} ${fixed(y + 13.202, 3)} ${fixed(x + 18.998, 3)} ${fixed(y + 13.391, 3)} ${fixed(x + 19.729, 3)} ${fixed(y + 13.182, 3)} L${fixed(x + 19.827, 3)} ${fixed(y + 13.154, 3)} C${fixed(x + 20.557, 3)} ${fixed(y + 12.944, 3)} ${fixed(x + 21.046, 3)} ${fixed(y + 12.415, 3)} ${fixed(x + 20.919, 3)} ${fixed(y + 11.972, 3)} L${fixed(x + 19.352, 3)} ${fixed(y + 6.507, 3)} C${fixed(x + 19.225, 3)} ${fixed(y + 6.065, 3)} ${fixed(x + 18.53, 3)} ${fixed(y + 5.875, 3)} ${fixed(x + 17.8, 3)} ${fixed(y + 6.085, 3)} Z" fill="${accent}" stroke="${BLACK}" stroke-width="1.8"/>`,
    `<path d="M${fixed(x + 9.546, 3)} ${fixed(y + 19.999, 3)} L${fixed(x + 6, 3)} ${fixed(y + 17.791, 3)} C${fixed(x + 4.736, 3)} ${fixed(y + 17.009, 3)} ${fixed(x + 5.668, 3)} ${fixed(y + 15.181, 3)} ${fixed(x + 7.138, 3)} ${fixed(y + 15.592, 3)} L${fixed(x + 10.615, 3)} ${fixed(y + 17.196, 3)} L${fixed(x + 9.546, 3)} ${fixed(y + 19.999, 3)} Z" fill="${accent}" stroke="${BLACK}" stroke-width="1.8" stroke-linejoin="round"/>`,
    `<rect x="${fixed(x + 10.887, 3)}" y="${fixed(y + 14.834, 3)}" width="9.584" height="3.800" transform="rotate(-16.9438 ${fixed(x + 10.887, 3)} ${fixed(y + 14.834, 3)})" fill="${accent}"/>`,
    `<path d="M${fixed(x + 10.5)} ${fixed(y + 19.5)} L${fixed(x + 11)} ${fixed(y + 20)} L${fixed(x + 11.5)} ${fixed(y + 17)} L${fixed(x + 9.5)} ${fixed(y + 17.5)} L${fixed(x + 9)} ${fixed(y + 18.5)} L${fixed(x + 10.5)} ${fixed(y + 19.5)} Z" fill="${accent}"/>`,
  ].join('\n');
}

function fallbackTagSvg(tag, x, y) {
  const label = fallbackTagLabel(tag);
  const width = tagWidth(tag);
  return [
    `<g class="tag-icon tag-fallback" role="img" aria-label="${escapeXml(label)}">`,
    `<title>${escapeXml(label)}</title>`,
    `<rect x="${fixed(x + 3)}" y="${fixed(y + 4)}" width="${width}" height="${TAG_ICON_SIZE}" rx="9" fill="${BLACK}"/>`,
    `<rect x="${fixed(x)}" y="${fixed(y)}" width="${width}" height="${TAG_ICON_SIZE}" rx="9" fill="#F6F1FF" stroke="${BLACK}" stroke-width="2.5"/>`,
    `<text x="${fixed(x + width / 2)}" y="${fixed(y + 20.5)}" text-anchor="middle" font-size="${LABEL_FONT_SIZE}" font-weight="900" fill="${BLACK}">${escapeXml(label)}</text>`,
    '</g>',
  ].join('\n');
}

function tagIconSvg(tag, x, y) {
  const normalized = tagName(tag);
  if (!['like', 'dislike', 'request end'].includes(normalized)) {
    return fallbackTagSvg(normalized, x, y);
  }
  const [fill, accent] = TAG_ICON_THEMES[normalized];
  const icon = normalized === 'request end'
    ? requestEndIconSvg(x, y, accent)
    : thumbIconSvg(x, y, accent, normalized === 'dislike');
  return [
    `<g class="tag-icon tag-${escapeXml(normalized.replaceAll(' ', '-'))}" role="img" aria-label="${escapeXml(normalized)}">`,
    `<title>${escapeXml(normalized)}</title>`,
    `<rect x="${fixed(x + 3)}" y="${fixed(y + 4)}" width="${TAG_ICON_SIZE}" height="${TAG_ICON_SIZE}" rx="9" fill="${BLACK}"/>`,
    `<rect x="${fixed(x)}" y="${fixed(y)}" width="${TAG_ICON_SIZE}" height="${TAG_ICON_SIZE}" rx="9" fill="${fill}" stroke="${BLACK}" stroke-width="2.5"/>`,
    icon,
    '</g>',
  ].join('\n');
}

function renderTagIconsSvg(tags, x, y) {
  const parts = [`<g class="tag-icons" transform="translate(${fixed(x)} ${fixed(y)})">`];
  let cursor = 0;
  for (const tag of tags) {
    parts.push(tagIconSvg(tag, cursor, 0));
    cursor += tagWidth(tag) + TAG_ICON_GAP;
  }
  parts.push('</g>');
  return parts.join('\n');
}

function renderMessageSvg(item) {
  const { message } = item;
  const colors = sideColors(message.side);
  const accessibleLabel = escapeXml(`${message.participantLabel}: ${ellipsizeText(message.text, 42)}`);
  const parts = [
    `<g class="message-row ${message.side}" role="listitem" aria-label="${accessibleLabel}">`,
    `<title>${accessibleLabel}</title>`,
    bubbleLayersSvg(item, colors),
    `<rect x="${item.labelX}" y="${item.labelY}" width="${item.labelWidth}" height="${LABEL_HEIGHT}" rx="9" fill="${colors.label}" stroke="${BLACK}" stroke-width="3"/>`,
    `<text x="${fixed(item.labelX + item.labelWidth / 2)}" y="${item.labelY + 21}" text-anchor="middle" font-size="${LABEL_FONT_SIZE}" font-weight="900" fill="${BLACK}">${escapeXml(item.label)}</text>`,
  ];
  const textX = item.bubbleX + BUBBLE_PAD_X;
  let textY = item.bubbleY + BUBBLE_PAD_Y + 17;
  for (const line of item.lines) {
    parts.push(`<text x="${textX}" y="${textY}" font-size="${FONT_SIZE}" font-weight="800" fill="${BLACK}">${escapeXml(line)}</text>`);
    textY += LINE_HEIGHT;
  }
  if (message.tags.length) {
    parts.push(renderTagIconsSvg(message.tags, textX, textY + TAG_ICON_TOP_GAP));
  }
  parts.push('</g>');
  return parts.join('\n');
}

export function renderTranscriptPageSvg(page) {
  const titleId = `claworld-report-title-${page.page}`;
  const descriptionId = `claworld-report-desc-${page.page}`;
  const description = `${page.title}. ${page.subtitle}. ${page.items.length} transcript rows.`;
  const parts = [
    `<svg class="comic-grid" xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-labelledby="${titleId} ${descriptionId}">`,
    `<title id="${titleId}">${escapeXml(page.title)}</title>`,
    `<desc id="${descriptionId}">${escapeXml(description)}</desc>`,
    svgDefs(),
    `<rect x="0" y="0" width="${page.width}" height="${page.height}" fill="${THEME.paper}"/>`,
    `<rect x="0" y="0" width="${page.width}" height="${page.height}" fill="url(#comicGridMinor)"/>`,
    `<rect x="0" y="0" width="${page.width}" height="${page.height}" fill="url(#comicGridMajor)" opacity="0.46"/>`,
    `<rect x="${FRAME_MARGIN}" y="${FRAME_MARGIN}" width="${page.width - FRAME_MARGIN * 2}" height="${page.height - FRAME_MARGIN * 2}" rx="46" fill="none" stroke="${BLACK}" stroke-width="6"/>`,
    renderHeader(page),
    '<g role="list">',
  ];
  for (const item of page.items) {
    if (item.kind === 'ellipsis') {
      const y = item.y + 7;
      parts.push(`<text x="${fixed(page.width / 2)}" y="${y + 14}" text-anchor="middle" font-size="${SMALL_FONT_SIZE}" fill="#555555">${escapeXml(item.label)}</text>`);
    } else if (item.kind === 'time') {
      parts.push(renderTimeSvg(page, item));
    } else {
      parts.push(renderMessageSvg(item));
    }
  }
  parts.push('</g>');
  if (page.footer) {
    parts.push(`<text x="${fixed(page.width / 2)}" y="${page.height - 24}" text-anchor="middle" font-size="${SMALL_FONT_SIZE}" fill="#444444">${escapeXml(page.footer)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}

export const CLAWORLD_TRANSCRIPT_STYLE_NAME = 'claworld-comic-grid';
