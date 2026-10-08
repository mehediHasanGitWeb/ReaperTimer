// Colors a task-card text element with its category's color, and lets the
// card's decorative "crack" lines (the ::before SVG background on
// .slide-two-tasks-incomplete-tasks-container in styles.css, ported from
// the "Default theme" mockup) show through as a bright flash of light on
// just the characters they visually cross -- e.g. the "the" in "Draft the
// weekly status update" flashing white for the couple of letters a
// diagonal line passes through, while the rest of the title stays the
// task's category color.
//
// History:
//  v1 tinted the crack-crossing characters via a background-clip:text
//     gradient while leaving the rest of the element at its normal color.
//     Didn't work -- the element's own white text-shadow glow painted over
//     the (invisible) transparent-filled glyphs regardless of the gradient
//     underneath.
//  v2 fixed that by wrapping just the crack-crossing characters in their
//     own <span> with an explicit accent color + matching glow, measuring
//     each character's on-screen position via Range.getClientRects().
//  v3 fixed a real hang: v2's per-character Range measurement forced a
//     synchronous layout flush on every call, and slide two renders every
//     task with no virtualization -- hundreds of tasks meant tens of
//     thousands of forced layout flushes in a single frame. v3 switched to
//     <canvas> text measurement (zero layout cost) and added a hard
//     per-render budget so the effect can never cost more than a small,
//     fixed amount of work no matter how large the task list gets.
//  v4 makes the crack-crossing characters the ACCENT (the task's category
//     color went on the accent spans, in v2/v3); this inverts that -- the
//     category color is now the element's own base color (the bulk of the
//     text), and the crack-crossing characters flash a fixed white instead,
//     like the card's crack literally letting light through the colored
//     text.
//  v5 (this version) also tints the decorative crack-line artwork itself
//     (the ::before SVG background on the card, previously always plain
//     white) to match the task's category color -- see
//     applyCrackLinesColor() below. The crack-crossing TEXT characters
//     stay the fixed white flash from v4; only the background line
//     artwork picks up the category color.

// The 13 line segments from styles.css's ::before SVG, in its 300x180
// viewBox coordinate space. Keep in sync with that SVG if it ever changes.
const CRACK_LINES: [number, number, number, number][] = [
	[10, 5, 140, 85],
	[290, 10, 140, 85],
	[140, 85, 40, 175],
	[140, 85, 210, 178],
	[140, 85, 295, 140],
	[140, 85, 5, 110],
	[140, 85, 180, 10],
	[70, 35, 100, 60],
	[200, 45, 165, 70],
	[90, 130, 120, 105],
	[230, 120, 195, 100],
	[40, 175, 15, 150],
	[295, 140, 270, 165],
];

const VIEWBOX_W = 300;
const VIEWBOX_H = 180;

// Fixed color for the characters a crack line actually crosses -- a bright
// white "light through the crack", independent of whichever category color
// the rest of the element is using, so it reads as the same crack effect
// across every category.
const CRACK_COLOR = '#ffffff';

// Hard cap on how many elements applyCrackHighlight (and the other per-
// theme accent highlighters below -- applyDripHighlight, applyMetalHighlight,
// applyPaperTapeHighlight -- they all share this one counter) will do the
// (layout-reading) crack-detection work for, across one full slide-two
// render (incomplete + complete cards together) -- see
// resetCrackHighlightBudget. Recoloring an element to its base color is
// unconditional and cheap (no layout reads), so every card still gets that
// regardless of the budget; only the accent detail on top of it is capped.
// Was 120 (~6 elements/card, "~20 cards"), sized for a short list -- with
// uncategorized/category tasks alone routinely in the hundreds (seen: 103
// uncategorized tasks in one real vault), and each card spending up to 9
// of these calls (title + up to 7 detail chips + the Done label), 120 ran
// out after roughly the first 13 cards, silently leaving every task after
// that with its plain base color and no accent at all -- not a bug in any
// one highlighter, just a budget sized for a much smaller list than real
// usage. 4000 covers well over 400 such cards in one render pass.
const DEFAULT_BUDGET = 4000;
let budgetRemaining = DEFAULT_BUDGET;

/** Call once at the start of each full slide-two render, before any renderTaskCard calls. */
export const resetCrackHighlightBudget = (max = DEFAULT_BUDGET): void => {
	budgetRemaining = max;
};

// Lazily-created, reused canvas context. Canvas text measurement never
// touches page layout, so it's safe to call per-character regardless of
// how many cards are on screen.
/**
 * text-shadow switches between a computed glow (inline style) and "none"
 * (the .controlar-no-text-shadow class in styles.css) as themes change, so
 * both directions go through these two helpers to keep them from fighting.
 */
export const clearTextShadow = (el: HTMLElement): void => {
	el.style.removeProperty('text-shadow');
	el.addClass('controlar-no-text-shadow');
};
const setTextShadow = (el: HTMLElement, value: string): void => {
	el.removeClass('controlar-no-text-shadow');
	el.style.textShadow = value;
};

let measureCtx: CanvasRenderingContext2D | null = null;
const getMeasureCtx = (): CanvasRenderingContext2D => {
	if (!measureCtx) {
		measureCtx = createEl('canvas').getContext('2d');
	}
	return measureCtx as CanvasRenderingContext2D;
};

/**
 * Call once a text element and its card ancestor (the element carrying the
 * crack ::before background) are both attached and laid out. Always
 * recolors `el` to `baseColor` (typically the task's category color).
 * Additionally, unless the per-render budget is used up, wraps whichever
 * characters a crack line crosses in a fixed-color (CRACK_COLOR) glow span,
 * so those letters flash independently of the category color around them.
 */
export const applyCrackHighlight = (el: HTMLElement, cardEl: HTMLElement, baseColor: string = '#ffffff'): void => {
	// Recolor both the fill AND the glow to the category color -- these
	// elements carry their own white multi-layer text-shadow glow from
	// styles.css (task-card-description etc.), which otherwise stays white
	// underneath the colored fill and makes the letters look like a
	// colored core inside a mismatched white halo instead of one unified
	// color. Overriding text-shadow here too keeps the whole glyph -- fill
	// and glow -- in the category color, so only the crack flash (below)
	// stands out as a distinct, deliberate white.
	el.style.color = baseColor;
	setTextShadow(el, `0 0 4px ${baseColor}, 0 0 10px ${baseColor}, 0 0 18px ${baseColor}`);

	if (budgetRemaining <= 0) return;
	budgetRemaining--;

	const cardRect = cardEl.getBoundingClientRect();
	if (cardRect.width === 0 || cardRect.height === 0) return;

	const sx = cardRect.width / VIEWBOX_W;
	const sy = cardRect.height / VIEWBOX_H;

	const elRect = el.getBoundingClientRect();
	if (elRect.width === 0) return;

	// Vertical center of this text element, in page (viewport) px -- the
	// crack SVG is stretched to the card's own box via
	// background-size:100% 100%, so scaling its viewBox coords by the
	// card's actual size and offsetting by the card's page position lines
	// them up with the element's own page position.
	const yc = elRect.top + elRect.height / 2;

	const crossingXs: number[] = [];
	for (const [x1, y1, x2, y2] of CRACK_LINES) {
		const ay = cardRect.top + y1 * sy;
		const by = cardRect.top + y2 * sy;
		if (ay === by) continue;
		if ((ay <= yc && by >= yc) || (ay >= yc && by <= yc)) {
			const t = (yc - ay) / (by - ay);
			const ax = cardRect.left + x1 * sx;
			const bx = cardRect.left + x2 * sx;
			crossingXs.push(ax + t * (bx - ax));
		}
	}
	if (crossingXs.length === 0) return;

	// These elements are rendered with a single plain-text child (no
	// nested markup), so the first non-empty text node is the one to walk.
	const textNode = Array.from(el.childNodes).find(
		(n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.textContent && n.textContent.length > 0
	);
	if (!textNode) return;

	const text = textNode.textContent;
	const len = text.length;
	if (len === 0) return;

	const cs = window.getComputedStyle(el);
	const ctx = getMeasureCtx();
	ctx.font = `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

	// Cumulative per-character widths via canvas only -- no DOM layout cost.
	const cum: number[] = new Array<number>(len + 1);
	cum[0] = 0;
	for (let i = 0; i < len; i++) {
		cum[i + 1] = (cum[i] ?? 0) + ctx.measureText(text.charAt(i)).width;
	}
	const totalWidth = cum[len] ?? 0;
	if (totalWidth <= 0) return;

	// Canvas-measured width can differ slightly from the element's actual
	// rendered width (subpixel/hinting differences between the canvas and
	// DOM text renderers), so scale canvas offsets to match the element's
	// real on-screen span rather than assuming they're identical.
	const elLeft = elRect.left;
	const scale = elRect.width / totalWidth;

	const touched = new Array<boolean>(len).fill(false);
	for (const x of crossingXs) {
		if (x < elLeft || x > elLeft + elRect.width) continue;
		let lo = 0;
		let hi = len - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			const midX = elLeft + (cum[mid + 1] ?? 0) * scale;
			if (midX < x) lo = mid + 1;
			else hi = mid;
		}
		touched[lo] = true;
	}
	if (!touched.some(Boolean)) return;

	const frag = createFragment();
	let i = 0;
	while (i < len) {
		if (touched[i]) {
			let j = i;
			while (j < len && touched[j]) j++;
			const span = createSpan();
			span.textContent = text.slice(i, j);
			span.style.color = CRACK_COLOR;
			setTextShadow(span, `0 0 4px ${CRACK_COLOR}, 0 0 10px ${CRACK_COLOR}, 0 0 18px ${CRACK_COLOR}`);
			frag.appendChild(span);
			i = j;
		} else {
			let j = i;
			while (j < len && !touched[j]) j++;
			frag.appendChild(document.createTextNode(text.slice(i, j)));
			i = j;
		}
	}
	el.replaceChild(frag, textNode);
};

// ===========================================================================
// Atlas Metal theme: "corrosion" text highlight
//
// Atlas Metal's own decorative crack artwork (a corroded-plate polyline
// pattern, pixel-matched to the mockup) is a DIFFERENT shape than the
// Default theme's crack lines, so it needs its own line set for the same
// crossing test applyCrackHighlight already does -- but unlike Default
// (fixed white accent, category-colored base) or Magma (fixed neutral
// accent, category-colored base), Atlas Metal's whole palette is FIXED
// regardless of task category: base #e06c75 always, with just the
// caller-supplied accent color swapped in for whichever characters a
// line crosses. (The card border/glow/badge/checkbox are all this same
// fixed #e06c75 too -- see styles.css -- matching the mockup, which
// never references --category-color-rgb anywhere in this theme.)
//
// METAL_LINES is the 8 polylines from the mockup's crack SVG
// (project/indTask.dc.html), each decomposed into its individual line
// segments -- keep in sync with the literal <path> data in styles.css's
// Atlas Metal ::before rule if that SVG ever changes.
const METAL_LINES: [number, number, number, number][] = [
	[0, 60, 100, 80],
	[100, 80, 160, 40],
	[160, 40, 300, 70],
	[100, 80, 120, 180],
	[160, 40, 200, 0],
	[60, 70, 40, 120],
	[40, 120, 10, 150],
	[100, 80, 180, 110],
	[180, 110, 260, 100],
	[160, 40, 120, 20],
	[120, 20, 90, 0],
	[230, 55, 260, 30],
	[260, 30, 300, 20],
	[120, 180, 160, 160],
	[160, 160, 200, 175],
];

const METAL_BASE_COLOR = '#e06c75';

// Per-segment stroke-width, in the same order as METAL_LINES -- copied
// from the old fixed ::before SVG's per-<path> stroke-width (the first
// path's 3 segments are width 2, etc.). Used by buildMetalCrackBgUrl so
// the category-colored version keeps the exact same line weights as the
// original fixed-pink artwork it replaces.
const METAL_LINE_WIDTH: number[] = [2, 2, 2, 2, 1.5, 1.3, 1.3, 1.3, 1.3, 1, 1, 1.2, 1.2, 1, 1];

const metalCrackBgCache = new Map<string, string>();

// Same idea as buildCrackBgUrl (Default theme) but for Atlas Metal's own
// line shape (METAL_LINES) -- builds the ::before crack-line artwork in
// the task's category color instead of the theme's old fixed #e06c75.
const buildMetalCrackBgUrl = (rgb: [number, number, number]): string => {
	const [r, g, b] = rgb;
	const lines = METAL_LINES.map(([x1, y1, x2, y2], i) => {
		const width = METAL_LINE_WIDTH[i];
		return `<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}' stroke='rgb(${r},${g},${b})' stroke-width='${width}'/>`;
	}).join('');
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 180'>${lines}</svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

/**
 * Like applyCrackHighlight, but for the Atlas Metal theme: always recolors
 * `el` to the theme's fixed base color (never the task's category color)
 * and sets its text-shadow to `baseTextShadow` (most elements are flat,
 * only the title carries the mockup's pink glow -- pass 'none' for the
 * rest). Whichever characters fall under a METAL_LINES crossing at this
 * element's row get wrapped in a span colored `accentColor` instead.
 */
export const applyMetalHighlight = (el: HTMLElement, cardEl: HTMLElement, accentColor: string, baseTextShadow: string = 'none', baseColor: string = METAL_BASE_COLOR): void => {
	el.style.color = baseColor;
	setTextShadow(el, baseTextShadow);

	if (budgetRemaining <= 0) return;
	budgetRemaining--;

	const cardRect = cardEl.getBoundingClientRect();
	if (cardRect.width === 0 || cardRect.height === 0) return;

	const sx = cardRect.width / VIEWBOX_W;
	const sy = cardRect.height / VIEWBOX_H;

	const elRect = el.getBoundingClientRect();
	if (elRect.width === 0) return;

	const yc = elRect.top + elRect.height / 2;

	const crossingXs: number[] = [];
	for (const [x1, y1, x2, y2] of METAL_LINES) {
		const ay = cardRect.top + y1 * sy;
		const by = cardRect.top + y2 * sy;
		if (ay === by) continue;
		if ((ay <= yc && by >= yc) || (ay >= yc && by <= yc)) {
			const t = (yc - ay) / (by - ay);
			const ax = cardRect.left + x1 * sx;
			const bx = cardRect.left + x2 * sx;
			crossingXs.push(ax + t * (bx - ax));
		}
	}
	if (crossingXs.length === 0) return;

	const textNode = Array.from(el.childNodes).find(
		(n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.textContent && n.textContent.length > 0
	);
	if (!textNode) return;

	const text = textNode.textContent;
	const len = text.length;
	if (len === 0) return;

	const cs = window.getComputedStyle(el);
	const ctx = getMeasureCtx();
	ctx.font = `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

	const cum: number[] = new Array<number>(len + 1);
	cum[0] = 0;
	for (let i = 0; i < len; i++) {
		cum[i + 1] = (cum[i] ?? 0) + ctx.measureText(text.charAt(i)).width;
	}
	const totalWidth = cum[len] ?? 0;
	if (totalWidth <= 0) return;

	const elLeft = elRect.left;
	const scale = elRect.width / totalWidth;

	const touched = new Array<boolean>(len).fill(false);
	for (const x of crossingXs) {
		if (x < elLeft || x > elLeft + elRect.width) continue;
		let lo = 0;
		let hi = len - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			const midX = elLeft + (cum[mid + 1] ?? 0) * scale;
			if (midX < x) lo = mid + 1;
			else hi = mid;
		}
		touched[lo] = true;
	}
	if (!touched.some(Boolean)) return;

	const frag = createFragment();
	let i = 0;
	while (i < len) {
		if (touched[i]) {
			let j = i;
			while (j < len && touched[j]) j++;
			const span = createSpan();
			span.textContent = text.slice(i, j);
			span.style.color = accentColor;
			clearTextShadow(span);
			frag.appendChild(span);
			i = j;
		} else {
			let j = i;
			while (j < len && !touched[j]) j++;
			frag.appendChild(document.createTextNode(text.slice(i, j)));
			i = j;
		}
	}
	el.replaceChild(frag, textNode);
};

// Per-line stroke style for the decorative crack SVG, in the same order as
// CRACK_LINES -- copied from the literal SVG in styles.css's ::before rule
// (the 7 main branches are stroke-opacity 0.7 / width 1.3, the 4 secondary
// lines 0.5 / 0.8, the 2 smallest 0.45 / 0.7).
const CRACK_LINE_STYLE: [number, number][] = [
	[0.7, 1.3],
	[0.7, 1.3],
	[0.7, 1.3],
	[0.7, 1.3],
	[0.7, 1.3],
	[0.7, 1.3],
	[0.7, 1.3],
	[0.5, 0.8],
	[0.5, 0.8],
	[0.5, 0.8],
	[0.5, 0.8],
	[0.45, 0.7],
	[0.45, 0.7],
];

const hexToRgb = (hex: string): [number, number, number] | null => {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	let h = m[1] as string;
	if (h.length === 3) {
		h = h
			.split('')
			.map((c) => c + c)
			.join('');
	}
	const num = parseInt(h, 16);
	return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

// Cache built SVG data-URLs by color -- most cards on screen share a
// handful of category colors, so this avoids rebuilding/re-encoding the
// same string over and over.
const crackBgCache = new Map<string, string>();

const buildCrackBgUrl = (rgb: [number, number, number]): string => {
	const [r, g, b] = rgb;
	const lines = CRACK_LINES.map(([x1, y1, x2, y2], i) => {
		const [opacity, width] = CRACK_LINE_STYLE[i] as [number, number];
		return `<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}' stroke='rgba(${r},${g},${b},${opacity})' stroke-width='${width}'/>`;
	}).join('');
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${VIEWBOX_W} ${VIEWBOX_H}'>${lines}</svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

/**
 * Tints the card's own decorative crack-line artwork (the ::before SVG
 * background defined in styles.css) to a task's category color instead of
 * the default plain white. Call once per card (not per text element --
 * unlike applyCrackHighlight, this doesn't touch the crack-crossing TEXT
 * characters, which stay the fixed white flash). Pure style/CSS-variable
 * work, no layout reads, so it's not budget-limited and safe to call for
 * every card regardless of list size.
 */
export const applyCrackLinesColor = (cardEl: HTMLElement, categoryColor: string): void => {
	const rgb = hexToRgb(categoryColor);
	if (!rgb) return;
	const key = `${rgb[0]},${rgb[1]},${rgb[2]}`;
	let url = crackBgCache.get(key);
	if (!url) {
		url = buildCrackBgUrl(rgb);
		crackBgCache.set(key, url);
	}
	cardEl.style.setProperty('--crack-bg-image', url);
	// Drives category-tinted chrome elsewhere on the card (the Start
	// button pill, the action icon badge) via CSS rgba(var(--category-color-rgb), a)
	// -- see .task-card-action-btn-start / -icon in styles.css.
	cardEl.style.setProperty('--category-color-rgb', key);

	// Atlas Metal's own crack-line artwork, same category color -- see
	// buildMetalCrackBgUrl above. Cheap to always set (small cached map,
	// same as --crack-bg-image above) even on cards under a different
	// theme; only Atlas Metal's CSS ever reads this variable.
	let metalUrl = metalCrackBgCache.get(key);
	if (!metalUrl) {
		metalUrl = buildMetalCrackBgUrl(rgb);
		metalCrackBgCache.set(key, metalUrl);
	}
	cardEl.style.setProperty('--metal-crack-bg-image', metalUrl);
};

// ===========================================================================
// Liquid Magma theme: "drip"-crossing text highlight
//
// The magma theme's 3 decorative drip divs (.controlar-magma-drip*, added
// by taskCard.ts, styled in styles.css) are fixed-pixel absolutely
// positioned rectangles -- not the Default theme's diagonal crack lines --
// so they need their own crossing test instead of reusing
// applyCrackHighlight's CRACK_LINES/viewBox math above. Same
// canvas-measurement approach (zero layout cost per character): find
// which characters of a text element horizontally fall under a drip that
// also vertically overlaps that element's row, and give just those
// characters a different (accent) color while the rest of the text stays
// the base (category) color -- matching the mockup's per-element gradient-
// clip text, which is mostly category color with a short accent-colored
// band exactly where a drip crosses.
//
// Coordinates mirror the literal px values in styles.css's
// .controlar-magma-drip-left/-right/-bottom rules and the divs taskCard.ts
// creates -- keep both in sync if the drip geometry ever changes.
const DRIP_TOP_RECTS: { top: number; height: number; left?: number; right?: number; width: number }[] = [
	{ top: 0, height: 105, left: 30, width: 21 },
	{ top: 0, height: 107, right: 39, width: 11 },
];
const DRIP_BOTTOM_RECT = { height: 44, left: 30, width: 16 };

/**
 * Like applyCrackHighlight, but for the Liquid Magma theme's drip accents
 * instead of the Default theme's crack lines. Always recolors `el` to
 * `baseColor` (the task's category color); additionally, for whichever
 * characters fall under a drip that vertically overlaps this element's
 * row, wraps them in a span colored `accentColor` instead.
 */
export const applyDripHighlight = (el: HTMLElement, cardEl: HTMLElement, baseColor: string, accentColor: string): void => {
	el.style.color = baseColor;
	clearTextShadow(el);

	const cardRect = cardEl.getBoundingClientRect();
	if (cardRect.width === 0 || cardRect.height === 0) return;
	const elRect = el.getBoundingClientRect();
	if (elRect.width === 0) return;

	const yc = elRect.top + elRect.height / 2;
	const ranges: [number, number][] = [];
	for (const d of DRIP_TOP_RECTS) {
		const dTop = cardRect.top + d.top;
		const dBottom = dTop + d.height;
		if (yc < dTop || yc > dBottom) continue;
		const x1 = d.left !== undefined ? cardRect.left + d.left : cardRect.right - (d.right as number) - d.width;
		ranges.push([x1, x1 + d.width]);
	}
	{
		const dTop = cardRect.bottom - DRIP_BOTTOM_RECT.height;
		if (yc >= dTop && yc <= cardRect.bottom) {
			const x1 = cardRect.left + DRIP_BOTTOM_RECT.left;
			ranges.push([x1, x1 + DRIP_BOTTOM_RECT.width]);
		}
	}
	if (ranges.length === 0) return;

	const textNode = Array.from(el.childNodes).find(
		(n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.textContent && n.textContent.length > 0
	);
	if (!textNode) return;
	const text = textNode.textContent;
	const len = text.length;
	if (len === 0) return;

	const cs = window.getComputedStyle(el);
	const ctx = getMeasureCtx();
	ctx.font = `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

	const cum: number[] = new Array<number>(len + 1);
	cum[0] = 0;
	for (let i = 0; i < len; i++) {
		cum[i + 1] = (cum[i] ?? 0) + ctx.measureText(text.charAt(i)).width;
	}
	const totalWidth = cum[len] ?? 0;
	if (totalWidth <= 0) return;

	const elLeft = elRect.left;
	const scale = elRect.width / totalWidth;

	const touched = new Array<boolean>(len).fill(false);
	for (let i = 0; i < len; i++) {
		const charLeft = elLeft + (cum[i] ?? 0) * scale;
		const charRight = elLeft + (cum[i + 1] ?? 0) * scale;
		const charMid = (charLeft + charRight) / 2;
		for (const [x1, x2] of ranges) {
			if (charMid >= x1 && charMid <= x2) {
				touched[i] = true;
				break;
			}
		}
	}
	if (!touched.some(Boolean)) return;

	const frag = createFragment();
	let i = 0;
	while (i < len) {
		if (touched[i]) {
			let j = i;
			while (j < len && touched[j]) j++;
			const span = createSpan();
			span.textContent = text.slice(i, j);
			span.style.color = accentColor;
			clearTextShadow(span);
			frag.appendChild(span);
			i = j;
		} else {
			let j = i;
			while (j < len && !touched[j]) j++;
			frag.appendChild(document.createTextNode(text.slice(i, j)));
			i = j;
		}
	}
	el.replaceChild(frag, textNode);
};

// ===========================================================================
// Liquid Magma theme: completed-card wavy strikethrough
//
// The "Liquid Magma (disabled)" mockup draws a wavy strikethrough across
// every text row of a completed card via an absolutely positioned SVG (a
// gradient stroke fading from solid #c21f00 to transparent), instead of
// the Default theme's CSS text-decoration:wavy (fixed cyan -- see
// styles.css -- which would look wrong on this theme's light neumorphic
// card, and which the shared completed-card rules are scoped to exclude
// Magma from for that reason). The color is intentionally FIXED
// (#c21f00, the mockup's own red) regardless of the task's category
// color -- per the user's explicit "strikethrough color will not change"
// instruction -- and, per the mockup's own DOM (its strike SVGs are
// siblings of the filtered/dimmed card content, not descendants of it),
// these are appended to the card's outer element so they render at full
// saturation on top of the muted content, not dimmed along with it (see
// taskCard.ts's contentParent split).
//
// Real task text (unlike the mockup's static placeholders) varies in
// length, and the tag count doesn't (always the same 7 detail tags), so
// rather than copying the mockup's literal per-line pixel positions this
// measures each text element's own on-screen box once laid out and draws
// one strike sized/positioned to match it -- one call per line.
const WAVY_STRIKE_PATH_D =
	'M0,4 L2,4.1 L4,4.19 L6,4.29 L8,4.37 L10,4.44 L12,4.5 L14,4.55 L16,4.58 L18,4.6 L20,4.6 L22,4.58 L24,4.55 L26,4.5 L28,4.44 L30,4.37 L32,4.29 L34,4.19 L36,4.1 L38,4 L40,3.9 L42,3.81 L44,3.71 L46,3.63 L48,3.56 L50,3.5 L52,3.45 L54,3.42 L56,3.4 L58,3.4 L60,3.42 L62,3.45 L64,3.5 L66,3.56 L68,3.63 L70,3.71 L72,3.81 L74,3.9 L76,4 L78,4.1 L80,4.19 L82,4.29 L84,4.37 L86,4.44 L88,4.5 L90,4.55 L92,4.58 L94,4.6 L96,4.6 L98,4.58 L100,4.55 L102,4.5 L104,4.44 L106,4.37 L108,4.29 L110,4.19 L112,4.1 L114,4 L116,3.9 L118,3.81 L120,3.71 L122,3.63 L124,3.56 L126,3.5 L128,3.45 L130,3.42 L132,3.4 L134,3.4 L136,3.42 L138,3.45 L140,3.5 L142,3.56 L144,3.63 L146,3.71 L148,3.81 L150,3.9 L152,4';

const WAVY_STRIKE_COLOR = '#c21f00';

// Atlas Metal's completed ("553 ... disabled") mockup uses a muted green
// strike instead of Magma's fixed red -- see applyWavyStrikethrough's
// strikeColor param below.
export const METAL_STRIKE_COLOR = '#3F9B4F';
// Paper Crayon's "(disabled)" mockup uses a light mint green instead --
// sampled directly from its own wavyStrike gradient/Done-badge fill.
export const PAPER_STRIKE_COLOR = '#D6FFE0';
let wavyStrikeGradientCounter = 0;

/**
 * Removes any wavy-strikethrough overlays a previous call added directly
 * to this card -- call before re-adding (renders are idempotent this way)
 * and whenever a card leaves the Magma-completed state (e.g. after a
 * theme switch), so overlays never pile up or linger on the wrong theme.
 */
export const clearWavyStrikethrough = (cardEl: HTMLElement): void => {
	const old = cardEl.querySelectorAll(':scope > .controlar-magma-strike-svg');
	old.forEach((n) => n.remove());
};

/**
 * Draws one fixed-red wavy strikethrough line over `el`, sized and
 * positioned (via getBoundingClientRect, so it works for any real text
 * length) to match its current on-screen box, and appends it directly to
 * `cardEl` -- which must be position:relative (true for both task-card
 * container classes already) and is deliberately NOT the same element
 * `el` is nested inside when that ancestor carries the completed card's
 * dimming filter (see taskCard.ts's contentParent), so the line itself
 * stays fully saturated. Safe to call once per text line; call
 * clearWavyStrikethrough(cardEl) first if re-rendering the same card.
 */
// Draws one wavy strike positioned at an explicit (left, top, width) --
// factored out of applyWavyStrikethrough so applyWavyStrikethroughGrouped
// below can draw ONE strike spanning several elements on the same visual
// line, instead of one strike per element (see that function's doc).
const drawWavyStrikeSvg = (cardEl: HTMLElement, left: number, top: number, width: number, strikeColor: string): void => {
	const svgNS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(svgNS, 'svg');
	// Matches the mockup's own technique exactly: ONE fixed 152-unit-wide
	// wavy path (WAVY_STRIKE_PATH_D), stretched via preserveAspectRatio
	// "none" to fill whatever width this strike actually needs -- not a
	// path regenerated per width (that produced a visibly different wave
	// density on short vs long elements than the mockup's single squished
	// line).
	svg.setAttribute('viewBox', '0 0 152 8');
	svg.setAttribute('preserveAspectRatio', 'none');
	svg.classList.add('controlar-magma-strike-svg');
	const svgEl = svg as unknown as HTMLElement;
	// position / height / pointer-events / overflow / z-index: .controlar-magma-strike-svg (styles.css)
	svgEl.style.left = `${left}px`;
	svgEl.style.top = `${top}px`;
	svgEl.style.width = `${width}px`;
	const strikeRgb = hexToRgb(strikeColor) || [194, 31, 0];
	svgEl.style.filter = `drop-shadow(0 0 0.1px rgba(${strikeRgb[0]}, ${strikeRgb[1]}, ${strikeRgb[2]}, 0.25))`;

	const gradId = `controlar-magma-strike-${wavyStrikeGradientCounter++}`;
	const defs = document.createElementNS(svgNS, 'defs');
	const gradient = document.createElementNS(svgNS, 'linearGradient');
	gradient.setAttribute('id', gradId);
	gradient.setAttribute('x1', '0');
	gradient.setAttribute('y1', '0');
	gradient.setAttribute('x2', '1');
	gradient.setAttribute('y2', '0');
	const stops: [string, string][] = [
		['0%', '1'],
		['55%', '1'],
		['100%', '0'],
	];
	for (const [offset, opacity] of stops) {
		const stop = document.createElementNS(svgNS, 'stop');
		stop.setAttribute('offset', offset);
		stop.setAttribute('stop-color', strikeColor);
		stop.setAttribute('stop-opacity', opacity);
		gradient.appendChild(stop);
	}
	defs.appendChild(gradient);
	svg.appendChild(defs);

	const path = document.createElementNS(svgNS, 'path');
	path.setAttribute('d', WAVY_STRIKE_PATH_D);
	path.setAttribute('stroke', `url(#${gradId})`);
	path.setAttribute('stroke-width', '3');
	path.setAttribute('fill', 'none');
	path.setAttribute('stroke-linecap', 'round');
	svg.appendChild(path);

	cardEl.appendChild(svg);
};

export const applyWavyStrikethrough = (el: HTMLElement, cardEl: HTMLElement, strikeColor: string = WAVY_STRIKE_COLOR): void => {
	const cardRect = cardEl.getBoundingClientRect();
	if (cardRect.width === 0 || cardRect.height === 0) return;
	const elRect = el.getBoundingClientRect();
	if (elRect.width === 0 || elRect.height === 0) return;
	drawWavyStrikeSvg(cardEl, elRect.left - cardRect.left, elRect.top - cardRect.top + elRect.height / 2 - 4, elRect.width, strikeColor);
};

/**
 * Removes the round "checked" badge a previous drawCheckedBadge call
 * added directly to this card, and restores the real checkbox input's
 * own opacity -- call before re-adding (idempotent) and whenever a card
 * leaves the Magma-completed state (theme toggle, re-render), mirroring
 * clearWavyStrikethrough right above.
 */
export const clearCheckedBadge = (cardEl: HTMLElement): void => {
	const old = cardEl.querySelectorAll(':scope > .controlar-checked-badge');
	old.forEach((n) => n.remove());
	const checkbox = cardEl.querySelector<HTMLElement>('.task-card-checkbox');
	if (checkbox) checkbox.removeClass('controlar-checkbox-covered');
};

/**
 * Liquid Magma's completed/"disabled" Done checkbox: a solid round badge,
 * fixed red (#c21f00, same WAVY_STRIKE_COLOR the wavy strikethrough uses)
 * with a near-black (#101418) checkmark -- sampled directly from the
 * "Liquid Magma (disabled)" mockup's own Done badge, which is a flat
 * #c21f00 circle + `box-shadow: 0 0 4px rgba(194,31,0,0.6)` glow, no
 * border, no category color involved (a fixed "done" stamp, same as
 * Default theme's cyan one and Metal's green one -- independent of
 * whichever category the task belongs to).
 *
 * It can't just be styles.css's body.controlar-theme-magma
 * .task-card-checkbox:checked rule applying here, though: the completed
 * card's real checkbox lives inside .controlar-magma-completed-content,
 * which carries the grayscale/opacity "disabled" filter muting the rest
 * of the card, and a CSS filter mutes its ENTIRE subtree with no way for
 * a child to opt out -- so even a fixed-red fill would render as a dull
 * washed-out grey there, never the vivid red the mockup shows.
 *
 * Same fix as the wavy strikethrough lines above: draw the visible badge
 * as its own element appended directly to `cardEl`, a true sibling of
 * the filtered wrapper instead of a descendant of it, positioned via
 * getBoundingClientRect over the real (now invisible) checkbox input.
 * The input itself stays in the DOM at opacity:0 -- not display:none --
 * so it keeps receiving clicks; unmarking a completed task as done still
 * works, exactly like the completed card's delete button already does.
 */
export const drawCheckedBadge = (checkboxEl: HTMLElement, cardEl: HTMLElement, color: string = WAVY_STRIKE_COLOR, checkColor: string = '#101418'): void => {
	const cardRect = cardEl.getBoundingClientRect();
	if (cardRect.width === 0 || cardRect.height === 0) return;
	const cbRect = checkboxEl.getBoundingClientRect();
	if (cbRect.width === 0 || cbRect.height === 0) return;
	appendCheckedBadge(checkboxEl, cardEl, cbRect.left - cardRect.left, cbRect.top - cardRect.top, cbRect.width, cbRect.height, color, checkColor);
};

// Write half of drawCheckedBadge (no layout reads) -- split out so
// queueCompletedOverlays below can measure every card first and only then
// write, instead of interleaving a read and a write per card.
const appendCheckedBadge = (checkboxEl: HTMLElement, cardEl: HTMLElement, left: number, top: number, width: number, height: number, color: string, checkColor: string): void => {
	// .controlar-checkbox-covered: opacity 0 (styles.css) -- the drawn badge sits on top
	checkboxEl.addClass('controlar-checkbox-covered');

	const badge = createSpan({ cls: 'controlar-checked-badge' });
	const badgeStyle = badge.style;
	badgeStyle.position = 'absolute';
	badgeStyle.left = `${left}px`;
	badgeStyle.top = `${top}px`;
	badgeStyle.width = `${width}px`;
	badgeStyle.height = `${height}px`;
	badgeStyle.borderRadius = '50%';
	badgeStyle.display = 'inline-flex';
	badgeStyle.alignItems = 'center';
	badgeStyle.justifyContent = 'center';
	// Flat fill + colored glow, no border/sheen -- sampled directly from
	// the "Liquid Magma (disabled)" mockup's own Done badge (a fixed
	// #c21f00 circle, same red as the wavy strikethrough, with a plain
	// `box-shadow: 0 0 4px rgba(194,31,0,0.6)` glow and nothing else).
	// The glow is derived from `color` (not hardcoded to Magma's red) so
	// every theme that reuses this badge -- Metal's green, Paper's mint --
	// gets a glow that actually matches its own circle instead of always
	// glowing red underneath whatever color the fill is.
	const glowRgb = hexToRgb(color) || [194, 31, 0];
	badgeStyle.background = color;
	badgeStyle.border = 'none';
	badgeStyle.boxShadow = `0 0 4px rgba(${glowRgb[0]}, ${glowRgb[1]}, ${glowRgb[2]}, 0.6)`;
	badgeStyle.pointerEvents = 'none';
	badgeStyle.zIndex = '2';

	const svgNS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(svgNS, 'svg');
	svg.setAttribute('width', '62%');
	svg.setAttribute('height', '62%');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	// Near-black by default (Magma/Metal's own mockups both use it
	// regardless of their badge's fill color), but overridable -- Paper's
	// mockup draws its checkmark in the card's own ink color (#4e2e35)
	// instead, not near-black, since the badge fill is a near-white mint.
	svg.setAttribute('stroke', checkColor);
	svg.setAttribute('stroke-width', '3.2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	const polyline = document.createElementNS(svgNS, 'polyline');
	polyline.setAttribute('points', '4 12.5 9.5 18 20.5 5.5');
	svg.appendChild(polyline);
	badge.appendChild(svg);

	cardEl.appendChild(badge);
};

/**
 * Like applyWavyStrikethrough, but for a group of small inline elements
 * that flow on the same line(s) -- Atlas Metal's 7 separate detail-tag
 * spans, for example. Striking each one individually produced a messy,
 * slightly-misaligned double/triple line where they sit close together
 * (each span's own getBoundingClientRect is a hair different even when
 * visually on the same row), which read as "different" from the
 * mockup's one clean wavy line per row. This groups elements whose tops
 * land within 3px of each other (same visual line, allowing for
 * sub-pixel jitter) and draws ONE strike per group, spanning from the
 * leftmost element's left edge to the rightmost element's right edge --
 * so wrapped detail tags still get one strike per wrapped line, but
 * tags sharing a line get exactly one continuous strike instead of N
 * overlapping ones.
 */
interface StrikeSpec { left: number; top: number; width: number }

// Read-only half of applyWavyStrikethroughGrouped (measures + groups, draws
// nothing) -- see queueCompletedOverlays below.
const groupedStrikeSpecs = (elements: HTMLElement[], cardRect: DOMRect): StrikeSpec[] => {
	const rects = elements
		.map((el) => el.getBoundingClientRect())
		.filter((r) => r.width > 0 && r.height > 0);
	if (rects.length === 0) return [];

	const sorted = rects.slice().sort((a, b) => a.top - b.top);
	const groups: DOMRect[][] = [];
	for (const r of sorted) {
		// Compared against the LAST element added to each group (chained/
		// transitive clustering), not the group's first element. A rotated
		// card (Paper Crayon's `transform: rotate(-2deg)` on its content
		// wrapper) tilts each successive same-row element's top a little
		// further than the last, so on a long wrapped row of several short
		// tags the drift from the first tag to the last can exceed the 3px
		// tolerance even though every ADJACENT pair is well within it --
		// comparing everyone back to g[0] then incorrectly split one true
		// visual row into two groups partway through, leaving a gap in the
		// middle of what should be one continuous strike. Consecutive-pair
		// comparison tracks gradual drift correctly while still splitting
		// genuinely different rows apart (their top gap is tens of px, not
		// a couple of px of rotation drift).
		const g = groups.find((g) => Math.abs(g[g.length - 1]!.top - r.top) < 3);
		if (g) {
			g.push(r);
		} else {
			groups.push([r]);
		}
	}

	return groups.map((g) => {
		const left = Math.min(...g.map((r) => r.left));
		const right = Math.max(...g.map((r) => r.right));
		const top = Math.min(...g.map((r) => r.top));
		const height = Math.max(...g.map((r) => r.height));
		return { left: left - cardRect.left, top: top - cardRect.top + height / 2 - 4, width: right - left };
	});
};

export const applyWavyStrikethroughGrouped = (elements: HTMLElement[], cardEl: HTMLElement, strikeColor: string = WAVY_STRIKE_COLOR): void => {
	const cardRect = cardEl.getBoundingClientRect();
	if (cardRect.width === 0 || cardRect.height === 0) return;
	for (const spec of groupedStrikeSpecs(elements, cardRect)) {
		drawWavyStrikeSvg(cardEl, spec.left, spec.top, spec.width, strikeColor);
	}
};

// ---------------------------------------------------------------------------
// Batched read/write for completed-card overlays (wavy strikes + Done badge).
//
// Each card used to measure one element, append an SVG to the card, then
// measure the next one -- every append invalidates layout, so the next
// getBoundingClientRect forced a FULL synchronous relayout of the page.
// ~12 of those per card x every completed card (all rotated/filtered, in
// Paper/Atlas) made the completed list's render time grow roughly with the
// square of its length. Here every card only QUEUES a job; one animation
// frame then runs every job's reads first (a single layout), and only
// afterwards every job's writes.
// ---------------------------------------------------------------------------
type OverlayWrite = () => void;
const overlayJobs: Array<() => OverlayWrite | null> = [];
let overlayFlushScheduled = false;

const flushOverlayJobs = (): void => {
	overlayFlushScheduled = false;
	const jobs = overlayJobs.splice(0, overlayJobs.length);
	const writes: OverlayWrite[] = [];
	for (const job of jobs) {
		try {
			const w = job();
			if (w) writes.push(w);
		} catch (err) {
			console.error('[controlar] completed-card overlay measure failed', err);
		}
	}
	for (const w of writes) {
		try {
			w();
		} catch (err) {
			console.error('[controlar] completed-card overlay draw failed', err);
		}
	}
};

/**
 * Queues a completed card's wavy strikes (title, tag, detail rows, Done
 * label) and, when `badge` is given, its round Done badge. Replaces the
 * clear + applyWavyStrikethrough* + drawCheckedBadge sequence; same output,
 * measured and drawn in batches. Anything already drawn is cleared first
 * (inside the write phase) so re-renders stay idempotent.
 */
export const queueCompletedOverlays = (
	cardEl: HTMLElement,
	titleEl: HTMLElement | null,
	badgeEl: HTMLElement | null,
	detailEls: HTMLElement[],
	doneTextEl: HTMLElement | null,
	checkboxEl: HTMLElement | null,
	strikeColor: string,
	badge: { color: string; checkColor: string } | null,
): void => {
	overlayJobs.push(() => {
		const cardRect = cardEl.getBoundingClientRect();
		if (cardRect.width === 0 || cardRect.height === 0) return null;
		const specs: StrikeSpec[] = [];
		const single = (el: HTMLElement | null) => {
			if (!el) return;
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) return;
			specs.push({ left: r.left - cardRect.left, top: r.top - cardRect.top + r.height / 2 - 4, width: r.width });
		};
		single(titleEl);
		single(badgeEl);
		specs.push(...groupedStrikeSpecs(detailEls, cardRect));
		single(doneTextEl);
		let badgeSpec: { left: number; top: number; width: number; height: number } | null = null;
		if (badge && checkboxEl) {
			const cb = checkboxEl.getBoundingClientRect();
			if (cb.width > 0 && cb.height > 0) {
				badgeSpec = { left: cb.left - cardRect.left, top: cb.top - cardRect.top, width: cb.width, height: cb.height };
			}
		}
		return () => {
			clearWavyStrikethrough(cardEl);
			clearCheckedBadge(cardEl);
			for (const spec of specs) drawWavyStrikeSvg(cardEl, spec.left, spec.top, spec.width, strikeColor);
			if (badge && checkboxEl && badgeSpec) {
				appendCheckedBadge(checkboxEl, cardEl, badgeSpec.left, badgeSpec.top, badgeSpec.width, badgeSpec.height, badge.color, badge.checkColor);
			}
		};
	});
	if (!overlayFlushScheduled) {
		overlayFlushScheduled = true;
		window.requestAnimationFrame(flushOverlayJobs);
	}
};

// ===========================================================================
// Re-syncs an already-rendered card's TEXT highlighting to the currently
// active theme.
//
// The theme toggle button (controlar/index.ts) only flips a class on
// <body> -- every CSS-driven part of a card (background, border, drips,
// badge/button/checkbox colors) reacts to that instantly, for free. But
// the highlight pattern on title/tags/done-label is computed once in JS
// at renderTaskCard() time (applyDripHighlight for Magma, applyCrackHighlight
// for every other theme) and baked into the DOM as literal <span> wraps --
// switching themes afterward doesn't re-run that, so a card rendered
// before the switch keeps showing the OLD theme's highlight pattern/color
// (e.g. Default theme's white diagonal-crack flash) laid on top of the
// NEW theme's now-correct chrome. That mismatch is what this fixes: call
// it for every on-screen card right after the theme class changes.
export const refreshCardTextHighlight = (card: HTMLElement, isMagmaTheme: boolean, isMetalTheme: boolean, isPaperTheme: boolean, isCompleted: boolean): void => {
	const rgbKey = card.style.getPropertyValue('--category-color-rgb').trim();
	const categoryColor = rgbKey ? `rgb(${rgbKey})` : '#ffffff';
	const textBaseColor = isCompleted ? '#ffffff' : categoryColor;

	const titleEl = card.querySelector<HTMLElement>('.task-card-description');
	const badgeEl = card.querySelector<HTMLElement>('.task-card-category-badge');
	const detailEls = Array.from(card.querySelectorAll<HTMLElement>('.task-card-detail-item'));
	const doneTextEl = card.querySelector<HTMLElement>('.slide-two-tasks-incomplete-tasks-container-completed-label span');
	const els = [titleEl, badgeEl, ...detailEls, doneTextEl].filter((e): e is HTMLElement => !!e);

	// Both highlight functions expect ONE plain text node to split; after a
	// prior pass the element may now hold [text, span, text, ...] instead,
	// so collapse back to plain text first (textContent read+reassign
	// merges everything into a single text node) or a second pass would
	// only see -- and re-wrap -- whatever fragment happens to come first.
	for (const el of els) {
		const plain = el.textContent;
		el.textContent = plain;
	}

	if (isMagmaTheme) {
		if (titleEl) applyDripHighlight(titleEl, card, categoryColor, '#333333');
		for (const detailEl of detailEls) applyDripHighlight(detailEl, card, categoryColor, '#6b6b6b');
		if (doneTextEl) applyDripHighlight(doneTextEl, card, categoryColor, '#4b4b4b');
		if (badgeEl) {
			badgeEl.style.color = categoryColor;
			clearTextShadow(badgeEl);
		}
	} else if (isMetalTheme) {
		// Atlas Metal -- incomplete and completed cards use the same
		// crack-crossing highlight; badge/done-label are plain fixed color,
		// set by CSS (!important, since nothing here sets an inline color to
		// fight with -- unlike title/tags there's no per-character accent
		// for them to clobber).
		if (titleEl) applyMetalHighlight(titleEl, card, '#f2a765', '0 0 8px rgba(var(--category-color-rgb, 224, 108, 117), 0.6)', categoryColor);
		for (const detailEl of detailEls) applyMetalHighlight(detailEl, card, '#cde8d5', 'none', categoryColor);
	} else if (isPaperTheme && isCompleted) {
		// Completed Paper card: plain flat ink color from CSS, no tape
		// accent (matches taskCard.ts's isPaperCompleted branch).
	} else if (isPaperTheme) {
		// Fixed flat palette, tape-crossing contrast only -- see taskCard.ts's
		// matching isPaperTheme branch and applyPaperTapeHighlight's own doc
		// comment above. Badge ("WORK") is plain CSS (!important) -- the tape
		// never crosses that row in the mockup, so it never calls into the
		// tape-crossing check at all, not even to come back negative.
		if (titleEl) applyPaperTapeHighlight(titleEl, card, '#4e2e35', true);
		for (const detailEl of detailEls) applyPaperTapeHighlight(detailEl, card, '#7a4853');
		if (doneTextEl) applyPaperTapeHighlight(doneTextEl, card, '#4e2e35');
	} else {
		if (titleEl) applyCrackHighlight(titleEl, card, textBaseColor);
		if (badgeEl) applyCrackHighlight(badgeEl, card, textBaseColor);
		for (const detailEl of detailEls) applyCrackHighlight(detailEl, card, textBaseColor);
		if (doneTextEl) applyCrackHighlight(doneTextEl, card, textBaseColor);
	}

	// Wavy strikethrough overlays (Magma completed cards only) are
	// appended directly to `card`, independent of the text-node collapsing
	// above -- always clear and only re-add when the CURRENT theme/state
	// actually calls for them, so switching away from a Magma-completed
	// card (theme toggle, or re-render) never leaves stale ones behind.
	clearWavyStrikethrough(card);
	clearCheckedBadge(card);
	if (isCompleted) {
		const checkboxEl = card.querySelector<HTMLElement>('.task-card-checkbox');
		// A started ("DONE till") card wears the completed look but isn't done -- no Done badge.
		const noBadge = card.classList.contains('controlar-done-till-card');
		// Same colors as taskCard.ts's per-theme completed branches; queued
		// (batched) so a theme toggle over a long completed list doesn't
		// force a relayout per card.
		if (isMagmaTheme) {
			queueCompletedOverlays(card, titleEl, badgeEl, detailEls, doneTextEl, checkboxEl, WAVY_STRIKE_COLOR, noBadge ? null : { color: WAVY_STRIKE_COLOR, checkColor: '#101418' });
		} else if (isMetalTheme) {
			queueCompletedOverlays(card, titleEl, badgeEl, detailEls, doneTextEl, checkboxEl, METAL_STRIKE_COLOR, noBadge ? null : { color: METAL_STRIKE_COLOR, checkColor: '#101418' });
		} else if (isPaperTheme) {
			queueCompletedOverlays(card, titleEl, badgeEl, detailEls, doneTextEl, checkboxEl, PAPER_STRIKE_COLOR, noBadge ? null : { color: PAPER_STRIKE_COLOR, checkColor: '#4e2e35' });
		} else {
			queueCompletedOverlays(card, titleEl, badgeEl, detailEls, doneTextEl, null, '#7fd9ff', null);
		}
	}
};

/**
 * Call right after the theme class on <body> changes. Finds every task
 * card currently on screen (slide two's incomplete + complete lists) and
 * re-syncs its text highlighting via refreshCardTextHighlight above --
 * without this, only already-open cards' CSS chrome would follow a theme
 * switch, not their text.
 */
export const refreshAllVisibleCardTextHighlights = (isMagmaTheme: boolean, isMetalTheme: boolean = false, isPaperTheme: boolean = false): void => {
	const incomplete = document.querySelectorAll('.slide-two-tasks-incomplete-tasks-container');
	incomplete.forEach((card) => refreshCardTextHighlight(card as HTMLElement, isMagmaTheme, isMetalTheme, isPaperTheme, false));
	const complete = document.querySelectorAll('.slide-two-tasks-complete-tasks-container');
	complete.forEach((card) => refreshCardTextHighlight(card as HTMLElement, isMagmaTheme, isMetalTheme, isPaperTheme, true));
};

// ===========================================================================
// Paper Crayon theme: "text under the tape" contrast highlight
//
// The only text-level contrast this theme's mockup actually shows is
// where its decorative grey tape strip (styles.css's fixed-position
// ::before on .slide-two-tasks-incomplete-tasks-container, in the same
// 273x161 reference frame the yellow border-highlight overlay uses) sits
// on top of a line of text -- those specific characters flip from the
// card's flat dark-brown/muted-brown to the mockup's own highlighter
// yellow (sampled directly from "not-E tem-P-L-ate" in the title, where
// the capitalized letters are exactly the ones the tape covers).
// Everywhere else stays plain flat color -- no crack lines, no category
// tinting, same fixed-palette convention as Atlas Metal above.
//
// The tape is a plain CSS ::before with no JS-readable geometry
// (pseudo-elements can't be measured via getBoundingClientRect), so this
// re-derives the exact same fixed rectangle styles.css draws and tests
// each character's on-screen center point against it directly --
// point-in-rotated-rectangle via an inverse rotation into the tape's own
// local axes, simpler than applyCrackHighlight's line-crossing test
// since the tape is a filled band, not a thin stroked line.
// Tape rect in the reference frame, BEFORE rotation (styles.css's own
// fixed left/top/width/height) -- center + half-extents, since the
// rotation below pivots on the rect's own center, matching CSS
// transform-origin's default.
const PAPER_TAPE_CX = 8 + 300 / 2;
const PAPER_TAPE_CY = 66 + 22 / 2;
const PAPER_TAPE_HALF_W = 300 / 2;
const PAPER_TAPE_HALF_H = 22 / 2;
// CSS rotate(40deg) -- clockwise in screen (y-down) coordinates.
const PAPER_TAPE_ANGLE = (40 * Math.PI) / 180;
const PAPER_TAPE_COS = Math.cos(PAPER_TAPE_ANGLE);
const PAPER_TAPE_SIN = Math.sin(PAPER_TAPE_ANGLE);

// Fixed highlighter-yellow accent for characters under the tape -- the
// mockup's own #fff200, same color the border-highlight and badge-outline
// overlays use (see styles.css).
const PAPER_TAPE_COLOR = '#fff200';

/**
 * Call once a text element and its card ancestor are both attached and
 * laid out. Always recolors `el` to `baseColor` (Paper's fixed flat
 * dark-brown/muted-brown, never category color -- see taskCard.ts).
 * Additionally, unless the shared per-render budget (see
 * resetCrackHighlightBudget above) is used up, wraps whichever characters
 * the tape strip actually covers in a fixed-yellow (PAPER_TAPE_COLOR)
 * span, so only text physically under the tape contrasts.
 */
export const applyPaperTapeHighlight = (el: HTMLElement, cardEl: HTMLElement, baseColor: string, underline: boolean = false): void => {
	el.style.color = baseColor;
	clearTextShadow(el);

	if (budgetRemaining <= 0) return;
	budgetRemaining--;

	const cardRect = cardEl.getBoundingClientRect();
	if (cardRect.width === 0 || cardRect.height === 0) return;

	const elRect = el.getBoundingClientRect();
	if (elRect.width === 0) return;

	// The CSS tape (styles.css's paper ::before) is placed with FIXED px
	// (top:66px; left:8px; width:300px; height:22px), not scaled to the
	// card's actual size the way the border-highlight/badge-outline SVGs
	// are (those use preserveAspectRatio=none + background-size 100% 100%,
	// which DO stretch). A real task card's height varies a lot with its
	// content (detail-chip count/wrapping, title length) and is rarely a
	// clean 273x161 reference box, so scaling this geometry by
	// cardRect.width/height (as if the tape scaled too) drifted away from
	// where the tape is actually drawn on anything but a card that happens
	// to match the reference size almost exactly -- matching the CSS means
	// using these offsets unscaled, straight off the card's own top-left.
	const tapeCxPage = cardRect.left + PAPER_TAPE_CX;
	const tapeCyPage = cardRect.top + PAPER_TAPE_CY;
	const tapeHalfWPage = PAPER_TAPE_HALF_W;
	const tapeHalfHPage = PAPER_TAPE_HALF_H;

	// Same single-y-value simplification applyCrackHighlight uses above --
	// these are short single-line text elements, so the element's own
	// vertical center stands in for every character's y.
	const yc = elRect.top + elRect.height / 2;

	// These elements are rendered with a single plain-text child (no
	// nested markup), so the first non-empty text node is the one to walk.
	const textNode = Array.from(el.childNodes).find(
		(n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.textContent && n.textContent.length > 0
	);
	if (!textNode) return;

	const text = textNode.textContent;
	const len = text.length;
	if (len === 0) return;

	const cs = window.getComputedStyle(el);
	const ctx = getMeasureCtx();
	ctx.font = `${cs.fontStyle} ${cs.fontVariant} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

	// Cumulative per-character widths via canvas only -- no DOM layout cost.
	const cum: number[] = new Array<number>(len + 1);
	cum[0] = 0;
	for (let i = 0; i < len; i++) {
		cum[i + 1] = (cum[i] ?? 0) + ctx.measureText(text.charAt(i)).width;
	}
	const totalWidth = cum[len] ?? 0;
	if (totalWidth <= 0) return;

	// Canvas-measured width can differ slightly from the element's actual
	// rendered width, so scale canvas offsets to match the element's real
	// on-screen span rather than assuming they're identical.
	const elLeft = elRect.left;
	const scale = elRect.width / totalWidth;

	const touched = new Array<boolean>(len).fill(false);
	let anyTouched = false;
	for (let i = 0; i < len; i++) {
		const charCenterX = elLeft + (((cum[i] ?? 0) + (cum[i + 1] ?? 0)) / 2) * scale;
		const dx = charCenterX - tapeCxPage;
		const dy = yc - tapeCyPage;
		// Inverse-rotate the point into the tape's own local (unrotated)
		// axes -- a plain point-in-axis-aligned-box test from there.
		const localX = dx * PAPER_TAPE_COS + dy * PAPER_TAPE_SIN;
		const localY = -dx * PAPER_TAPE_SIN + dy * PAPER_TAPE_COS;
		if (Math.abs(localX) <= tapeHalfWPage && Math.abs(localY) <= tapeHalfHPage) {
			touched[i] = true;
			anyTouched = true;
		}
	}
	if (!anyTouched) return;

	const frag = createFragment();
	let i = 0;
	while (i < len) {
		if (touched[i]) {
			let j = i;
			while (j < len && touched[j]) j++;
			const span = createSpan();
			span.textContent = text.slice(i, j);
			span.style.color = PAPER_TAPE_COLOR;
			clearTextShadow(span);
			if (underline) {
				// Redeclare the line itself (not just its color) -- a nested
				// span that only sets text-decoration-color, without also
				// resetting text-decoration-line, still draws using the
				// ANCESTOR's color in most engines, not its own.
				span.addClass('controlar-wavy-underline');
				span.style.textDecorationColor = PAPER_TAPE_COLOR;
			}
			frag.appendChild(span);
			i = j;
		} else {
			let j = i;
			while (j < len && !touched[j]) j++;
			frag.appendChild(document.createTextNode(text.slice(i, j)));
			i = j;
		}
	}
	el.replaceChild(frag, textNode);
};
