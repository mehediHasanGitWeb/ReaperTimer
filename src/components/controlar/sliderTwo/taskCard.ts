// Shared task-card renderer used by both sliderTwoTaskIncomplete and
// sliderTwoTaskComplete (the card's class/icon/checkbox behavior differs
// based on `taskEl.completed`, but it's the same render function either way).
//
// Row order matches the "Default · Theme" card design (title on its own
// line, category badge + action button on one row, the detail-tag row,
// then the Done/checkbox row last) instead of the original main.js layout
// (Done/checkbox first, title+button second) -- see AGENTS/task history for
// the reasoning; visuals live in styles.css under the same class names.

import { setIcon } from 'obsidian';
import { PLACE_ID, safeSaveData } from '../../../state';
import type { ControlarHost, Task } from '../../../types';
import { attachTaskSelectionListener } from '../../../utils/taskSelection';
import { clearTextShadow, applyCrackHighlight, applyCrackLinesColor, applyDripHighlight, applyMetalHighlight, METAL_STRIKE_COLOR, applyPaperTapeHighlight, PAPER_STRIKE_COLOR, queueCompletedOverlays } from '../../../utils/crackHighlight';
import { getTaskCategoryColor } from '../../../utils/timer';
import { isTaskStarted } from '../../../utils/startedTasks';
import { store } from '../../../store/taskStore';

export const renderTaskCard = (container: HTMLElement, taskEl: Task | null | undefined, categoryName = 'Uncategorized', _className: string, instance: ControlarHost | undefined): HTMLElement => {
	// Always returns the card's element (the virtual list needs it to measure/remove the row).
	if (!taskEl) return container.createDiv();

	// The crack-highlight accent (below) uses this task's own category
	// color -- same lookup sliderOne's timeline/clock views already use for
	// per-category coloring (task's own override color, else its category's
	// color, else white for Uncategorized).
	const categoryColor = String(getTaskCategoryColor(taskEl, categoryName));

	// A started task (Start pressed, held in the "DONE till" menu -- see
	// utils/startedTasks.ts) is still NOT completed, but is drawn with the
	// completed card's look (muted card, wavy strikes) per the design; only
	// its action button (Stop) and Done checkbox keep working.
	const isStartedTask = !taskEl.completed && isTaskStarted(taskEl.id);
	const looksDone = !!taskEl.completed || isStartedTask;

	// Dynamic class assignment based on completion status
	const cardCls = looksDone
		? 'slide-two-tasks-complete-tasks-container'
		: 'slide-two-tasks-incomplete-tasks-container';

	const card = container.createDiv({ cls: cardCls });
	if (isStartedTask) card.classList.add('controlar-done-till-card');

	// Whether the Liquid Magma theme is active, and whether this is one of
	// its completed ("disabled") cards -- computed up front because it
	// decides the DOM shape below (see contentParent).
	const isMagmaTheme = document.body.classList.contains('controlar-theme-magma');
	const isMagmaCompleted = isMagmaTheme && looksDone;
	// Atlas Metal: incomplete cards only for now (its completed/"disabled"
	// card hasn't been requested/built yet -- those still fall back to the
	// Default theme's crack treatment below, same as before this theme
	// existed).
	const isMetalTheme = document.body.classList.contains('controlar-theme-metal');
	// Atlas Metal completed ("disabled") card -- the "553 (disabled)"
	// mockup variant: same plate/crack/border/dot recipe as the
	// incomplete card, muted with a grayscale/opacity filter, with fixed-
	// green (not red, unlike Magma) wavy strikethroughs laid on top that
	// stay fully saturated -- same contentParent-wrapper split Magma uses
	// below, so the filter never touches those overlays.
	const isMetalCompleted = isMetalTheme && looksDone;
	// Paper Crayon: the card's own CSS (!important) already fixes title/
	// badge/tag/done-label text to a flat dark-brown/muted-brown -- the
	// mockup has no crack-line-crossing text effect at all for this theme
	// (unlike Default, which this card type would otherwise inherit below
	// via the catch-all else branch). The only "contrast" on a Paper card
	// is the tape strip's own dimming where it physically overlaps -- see
	// styles.css's ::before -- so applyCrackHighlight is skipped entirely
	// here, not just recolored, to avoid random per-character flashes
	// unrelated to the tape.
	const isPaperTheme = document.body.classList.contains('controlar-theme-paper');
	// Paper Crayon completed ("disabled") card -- the "Paper Crayon
	// (disabled)" mockup variant: the SAME pink/tape/dashed card as the
	// incomplete one, muted via a grayscale/opacity filter on its own
	// contentParent wrapper (controlar-paper-completed-content, same
	// Magma/Metal convention below), with the mockup's own light mint
	// (#D6FFE0) wavy strikethrough + Done badge laid on top, outside that
	// filter, so they stay fully saturated. Unlike the incomplete card,
	// the mockup's title/tags have no inner gradient-clip spans at all --
	// no tape-crossing accent on a completed card -- so applyPaperTapeHighlight
	// is skipped for these below, same as applyCrackHighlight already is.
	const isPaperCompleted = isPaperTheme && looksDone;

	// Tint this card's own decorative crack-line artwork to match the
	// task's category color (cheap, no layout reads -- see
	// applyCrackLinesColor). The crack-crossing TEXT characters below stay
	// a fixed white flash regardless of category.
	applyCrackLinesColor(card, categoryColor);

	// Liquid Magma's completed ("disabled") card mockup mutes ONLY its
	// neumorphic content (drips, badge, title, tags, button) via a
	// grayscale/opacity filter, while its fixed-red wavy strikethrough
	// overlays (added near the bottom of this function) sit OUTSIDE that
	// filter and stay fully saturated -- see the user's "strikethrough
	// color will not change" instruction. CSS can't apply a filter to only
	// some of an element's children, so under this one condition the
	// card's usual content goes into its own wrapper div (styled/filtered
	// in styles.css as .controlar-magma-completed-content) instead of
	// directly into `card`; the strike SVGs are appended straight to
	// `card` later, as siblings of this wrapper. Every other card
	// (every other theme, and Magma's own incomplete cards) is unaffected
	// -- contentParent just IS `card` there, same as before this wrapper
	// existed.
	const contentParent = isMagmaCompleted ? card.createDiv({ cls: 'controlar-magma-completed-content' }) : (isMetalCompleted ? card.createDiv({ cls: 'controlar-metal-completed-content' }) : (isPaperCompleted ? card.createDiv({ cls: 'controlar-paper-completed-content' }) : card));

	// Liquid Magma theme's 3 decorative "drip" accents -- CSS-only under
	// every other theme (.controlar-magma-drip is display:none by
	// default, see styles.css), so these are harmless no-ops unless the
	// magma theme is active. Created here rather than in CSS because each
	// needs its own size/position/border-radius, which a single ::before/
	// ::after pseudo-element pair can't give 3 independent shapes.
	contentParent.createDiv({ cls: 'controlar-magma-drip controlar-magma-drip-left' });
	contentParent.createDiv({ cls: 'controlar-magma-drip controlar-magma-drip-right' });
	contentParent.createDiv({ cls: 'controlar-magma-drip controlar-magma-drip-bottom' });

	// Row 1: title, alone.
	const headerRow = contentParent.createDiv({ cls: 'slide-two-tasks-incomplete-tasks-container-header' });
	const titleEl = headerRow.createDiv({ cls: 'task-card-description', text: taskEl.description || taskEl.Name || 'No description' });

	// Row 2: category badge + action button.
	const metaRow = contentParent.createDiv({ cls: 'slide-two-tasks-incomplete-tasks-container-meta' });
	const badgeEl = metaRow.createDiv({ cls: 'task-card-category-badge', text: categoryName });
	const btnCircle = metaRow.createEl('button', { cls: 'task-card-action-btn-circle' });

	if (taskEl.completed) {
		if (typeof setIcon === 'function') {
			setIcon(btnCircle, 'trash');
		} else {
			btnCircle.setText('✖');
		}
		btnCircle.classList.add('controlar-btn-delete-task');
		btnCircle.addEventListener('click', (evt) => { void (async () => {
			evt.stopPropagation();
			// Removes the task from whichever list holds it (store keeps its counters/chunks in step).
			store.removeTask(taskEl);
			if (instance && instance.plugin && typeof instance.plugin.saveData === 'function') {
				await safeSaveData(instance.plugin, null);
			}
			if (instance && typeof instance.refreshSlideTwo === 'function') {
				instance.refreshSlideTwo();
			}
			if (instance && typeof instance.refreshSlideOne === 'function') {
				instance.refreshSlideOne();
			}
		})(); });
	} else {
		// Mockup's "Default · Theme" card shows a labeled pill button
		// ("Start" + a small round play-icon badge), not a bare icon-only
		// circle -- see Claude outputs/ mockup reference (artifact 11 ·
		// indTask). Swap the shared circular class for a dedicated pill
		// class and build the label + icon badge as its own children.
		btnCircle.classList.remove('task-card-action-btn-circle');
		btnCircle.classList.add('task-card-action-btn-start');
		// A task held in the "DONE till" menu (Start was pressed, not
		// finished yet) shows the same pill as "Stop" -- same look, square
		// icon instead of the play triangle -- which sends it back to the
		// incomplete list. See utils/startedTasks.ts.
		const isStarted = isStartedTask;
		const startLabel = btnCircle.createSpan({ cls: 'task-card-action-btn-start-label', text: isStarted ? 'Stop' : 'Start' });
		if (isMetalTheme) {
			// Atlas Metal's mockup bakes a per-letter vertical "scanline" --
			// each of the 5 letters gets its OWN background-clip:text
			// gradient with a thin orange band at a slightly different
			// height, so the band sweeps diagonally across the word like
			// the card's own crack line passing through it. Safe to
			// hardcode: this button's label is always literally "Start",
			// never task-dependent text (unlike the title/tags, which use
			// applyMetalHighlight's live crack-crossing instead).
			const scanlineBands: [string, number, number][] = [
				['S', 32, 46],
				['t', 42.8, 57.2],
				['a', 53.5, 67.9],
				['r', 64.2, 78.6],
				['t', 75.0, 89.4],
			];
			startLabel.setText('');
			// "Stop" has 4 letters: same first four bands, 'o'/'p' for 'a'/'r'.
			const labelBands: [string, number, number][] = isStarted
				? scanlineBands.slice(0, 4).map(([, a, b], i) => [['S', 't', 'o', 'p'][i] as string, a, b] as [string, number, number])
				: scanlineBands;
			for (const [ch, bandStart, bandEnd] of labelBands) {
				const letterSpan = startLabel.createSpan({ text: ch });
				letterSpan.style.backgroundImage = `linear-gradient(180deg, #e06c75 0%, #e06c75 ${bandStart}%, #f2a765 ${bandStart}%, #f2a765 ${bandEnd}%, #e06c75 ${bandEnd}%, #e06c75 100%)`;
				// background-clip: text + transparent fill come from .controlar-gradient-text (styles.css)
				letterSpan.addClass('controlar-gradient-text');
			}
		}
		const startIcon = btnCircle.createSpan({ cls: 'task-card-action-btn-start-icon' });
		// Obsidian's built-in "play" lucide icon (setIcon) is a stroke-only
		// outline triangle. The mockup's icon is a ring (drawn as one
		// annulus <path>, fill-rule evenodd) + 4 small dots at the
		// cardinal points + a solid filled triangle -- built manually via
		// SVG DOM methods so it matches pixel-for-pixel. Previously this
		// was just the bare triangle with the ring done separately as a
		// CSS ::before on .task-card-action-btn-start-icon, but that read
		// as a "double ring" (the disc's own rim highlight + this CSS
		// ring); removed that ::before in styles.css in favor of the
		// mockup's actual single SVG ring, restored here along with the
		// dots the CSS-only version had dropped. width/height come from
		// styles.css (.task-card-action-btn-start-icon svg), not set here.
		const svgNS = 'http://www.w3.org/2000/svg';
		const playSvg = document.createElementNS(svgNS, 'svg');
		playSvg.setAttribute('viewBox', '0 0 24 24');
		playSvg.setAttribute('fill', 'currentColor');
		const ring = document.createElementNS(svgNS, 'path');
		ring.setAttribute('fill-rule', 'evenodd');
		ring.setAttribute(
			'd',
			'M12 1a11 11 0 100 22 11 11 0 000-22zm0 3a8 8 0 110 16 8 8 0 010-16z'
		);
		ring.setAttribute('opacity', '0.6');
		playSvg.appendChild(ring);
		const dotPositions: [number, number][] = [
			[12, 2.6],
			[12, 21.4],
			[2.6, 12],
			[21.4, 12],
		];
		for (const [cx, cy] of dotPositions) {
			const dot = document.createElementNS(svgNS, 'circle');
			dot.setAttribute('cx', String(cx));
			dot.setAttribute('cy', String(cy));
			dot.setAttribute('r', '1.1');
			playSvg.appendChild(dot);
		}
		const playTriangle = document.createElementNS(svgNS, 'polygon');
		// Centered inside the ring above (was 7,4 20,12 7,20 -- sized for
		// the old bare-triangle/no-ring layout; shrunk and recentered now
		// that a ring actually surrounds it).
		playTriangle.setAttribute('points', isStarted ? '8.6,8.6 15.4,8.6 15.4,15.4 8.6,15.4' : '9.2,7.8 17,12 9.2,16.2');
		playSvg.appendChild(playTriangle);
		startIcon.appendChild(playSvg);

		// Start moves the task into the "DONE till" menu, Stop moves it back.
		// In-memory only (no data.json change) -- it's a temporary hold.
		btnCircle.addEventListener('click', () => {
			store.setStarted(taskEl, !isStarted);
			if (instance && typeof instance.refreshSlideTwo === 'function') {
				instance.refreshSlideTwo();
			}
		});
	}

	// Row 3: the detail tags.
	const detailsGrid = contentParent.createDiv({ cls: 'slide-two-tasks-incomplete-tasks-container-details' });

	const detailEls: HTMLElement[] = [];
	detailEls.push(detailsGrid.createDiv({
		cls: 'task-card-detail-item detail-expired-time',
		text: `Expire: ${String(taskEl.expiredTime || 'never')}`,
	}));

	detailEls.push(detailsGrid.createDiv({
		cls: 'task-card-detail-item detail-end-date',
		text: `End Date: ${taskEl.endDate || 'N/A'}`,
	}));

	detailEls.push(detailsGrid.createDiv({
		cls: 'task-card-detail-item detail-gap-time',
		text: `Gap: ${String(taskEl.gapTime || '5')}m`,
	}));

	detailEls.push(detailsGrid.createDiv({
		cls: 'task-card-detail-item detail-bg-image',
		text: `Bg: ${taskEl.selectedBgImage || 'none'}`,
	}));

	detailEls.push(detailsGrid.createDiv({
		cls: 'task-card-detail-item detail-ambient-sound',
		text: `Ambient: ${taskEl.selectedAmbientSound || 'none'}`,
	}));

	detailEls.push(detailsGrid.createDiv({
		cls: 'task-card-detail-item detail-alarm-sound',
		text: `Alarm: ${taskEl.selectedAlarmSound || 'default'}`,
	}));

	detailEls.push(detailsGrid.createDiv({
		cls: 'task-card-detail-item detail-runtime-seconds',
		text: `Runtime: ${taskEl.runtimeSeconds != null ? taskEl.runtimeSeconds + 's' : 'N/A'}`,
	}));

	// Row 4: Done label + checkbox, last.
	const completeLabel = contentParent.createEl('label', { cls: 'slide-two-tasks-incomplete-tasks-container-completed-label' });
	const doneTextEl = completeLabel.createSpan({ text: 'Done ' });
	const checkbox = completeLabel.createEl('input', { type: 'checkbox', cls: 'task-card-checkbox' });
	checkbox.checked = !!taskEl.completed;

	attachTaskSelectionListener(card, taskEl.id, PLACE_ID.SILDE_TWO_NOT_COMPLPET_TASKS, instance);

	// Only the slice of each text that the card's decorative crack lines
	// actually pass through changes color -- computed from real layout
	// once the card is attached and painted, since task text (unlike the
	// mockup's static placeholders) varies in length. See crackHighlight.ts.
	// Completed cards keep the category-colored crack-line background/
	// border (applyCrackLinesColor above) and the fixed-cyan wavy
	// strikethrough (styles.css), but the text itself goes back to plain
	// white instead of the category color -- a done task fades out rather
	// than staying as vividly colored as an active one. Incomplete cards
	// are unchanged (still category-colored text).
	const textBaseColor = looksDone ? '#ffffff' : categoryColor;

	// Liquid Magma theme uses its own drip-crossing highlight instead of the
	// Default theme's crack-line one, for BOTH incomplete and completed
	// cards (the mockup's completed/"disabled" card reuses the exact same
	// per-element gradient-clip text as the active one -- it's the whole
	// card that gets muted via a filter afterward, not the text itself):
	// mostly category color, with just the slice of text under a drip
	// switching to a fixed neutral accent. See applyDripHighlight in
	// crackHighlight.ts. Every other theme (and a completed card under any
	// of THOSE themes) keeps the Default theme's crack-line highlight,
	// with text fading to plain white once completed (textBaseColor).
	window.requestAnimationFrame(() => {
		if (isMagmaTheme) {
			applyDripHighlight(titleEl, card, categoryColor, '#333333');
			for (const detailEl of detailEls) {
				applyDripHighlight(detailEl, card, categoryColor, '#6b6b6b');
			}
			applyDripHighlight(doneTextEl, card, categoryColor, '#4b4b4b');
			// Badge's own drip-crossing shift in the mockup is a near-
			// imperceptible shade of the same orange, not a real contrast
			// change -- not worth the extra complexity, so it stays plain
			// category color like the Start button already is.
			badgeEl.style.color = categoryColor;
			clearTextShadow(badgeEl);
		} else if (isMetalTheme) {
			// Atlas Metal: fixed palette throughout (never category-color --
			// see applyMetalHighlight), matching the mockup. Only the title
			// carries its glow; badge/done-label are plain fixed color, set
			// entirely by CSS (no per-character touch in the mockup for
			// those), so nothing to do for them here.
			applyMetalHighlight(titleEl, card, '#f2a765', '0 0 8px rgba(var(--category-color-rgb, 224, 108, 117), 0.6)', categoryColor);
			for (const detailEl of detailEls) {
				applyMetalHighlight(detailEl, card, '#cde8d5', 'none', categoryColor);
			}
		} else if (isPaperTheme && !isPaperCompleted) {
			// Fixed flat palette (never category color, same convention as
			// Atlas Metal) -- the only contrast is where the tape strip
			// physically covers a character, handled by
			// applyPaperTapeHighlight's own geometry test. The title is the
			// only one of these with an underline (styles.css), so it's the
			// only call that needs the tape-crossing spans to also redeclare
			// it in yellow. Badge ("WORK") is plain CSS (!important) -- the
			// tape never crosses that row in the mockup, so it's skipped
			// entirely rather than running the geometry check only to
			// (usually) come back negative. Completed ("disabled") Paper
			// cards are excluded here (isPaperCompleted) -- the mockup's
			// own disabled card has no gradient-clip accent spans at all,
			// just the plain CSS flat color; see the wavy-strike branch
			// below for its actual completed-state treatment.
			applyPaperTapeHighlight(titleEl, card, '#4e2e35', true);
			for (const detailEl of detailEls) {
				applyPaperTapeHighlight(detailEl, card, '#7a4853');
			}
			applyPaperTapeHighlight(doneTextEl, card, '#4e2e35');
		} else if (isPaperCompleted) {
			// Completed Paper card: plain flat ink color, set entirely by
			// CSS (!important) -- same as Atlas Metal's badge/done-label,
			// nothing to do here. The mint wavy-strike + Done badge are
			// handled in the dedicated isPaperCompleted branch below.
		} else {
			applyCrackHighlight(titleEl, card, textBaseColor);
			applyCrackHighlight(badgeEl, card, textBaseColor);
			for (const detailEl of detailEls) {
				applyCrackHighlight(detailEl, card, textBaseColor);
			}
			applyCrackHighlight(doneTextEl, card, textBaseColor);
		}

		// Liquid Magma's completed-card wavy strikethrough (fixed red,
		// per the mockup -- see applyWavyStrikethrough) goes across every
		// text line, appended directly to `card` (NOT contentParent) so it
		// renders outside the grayscale/opacity filter muting the rest of
		// the card and stays fully saturated. Title/badge/done-label each
		// get their own call (one per row), but the detail tags use the
		// grouped form below -- several tags share one row, and one strike
		// per tag reads as a messy double/triple line where they sit close
		// together.
		if (isMagmaCompleted) {
			// Strikes (title, tag, grouped detail rows, Done label) + badge
			// are queued, not drawn inline: every card measuring then
			// appending one overlay at a time forced a full relayout per
			// element, which made long completed lists render very slowly
			// -- see queueCompletedOverlays in crackHighlight.ts. Rows of
			// detail tags are grouped into one strike per visual line
			// (applyWavyStrikethroughGrouped's own doc comment).
			// Completed card's Done checkbox: fixed-red round badge (same
			// #c21f00 as the wavy strikethrough, not the task's category
			// color) + near-black checkmark, matching the mockup exactly.
			// Drawn outside contentParent's grayscale filter so it stays
			// fully saturated instead of washing out to grey. See
			// drawCheckedBadge's own doc comment in crackHighlight.ts.
			queueCompletedOverlays(card, titleEl, badgeEl, detailEls, doneTextEl, checkbox, '#c21f00', isStartedTask ? null : { color: '#c21f00', checkColor: '#101418' });
		} else if (isMetalCompleted) {
			// Same idea, green instead of red (the "553 (disabled)" mockup's
			// own strike color), and the same round Done checkbox badge too
			// -- the mockup's own green (METAL_STRIKE_COLOR) circle +
			// near-black checkmark, drawn outside contentParent's grayscale
			// filter exactly like Magma's red one above.
			queueCompletedOverlays(card, titleEl, badgeEl, detailEls, doneTextEl, checkbox, METAL_STRIKE_COLOR, isStartedTask ? null : { color: METAL_STRIKE_COLOR, checkColor: '#101418' });
		} else if (isPaperCompleted) {
			// Paper Crayon's "(disabled)" mockup: same light-mint
			// (#D6FFE0) wavy strikethrough + Done badge mechanism as
			// Magma's red/Metal's green above, drawn directly on `card`
			// (a true sibling of the controlar-paper-completed-content
			// wrapper that carries the grayscale/opacity filter -- see
			// that contentParent split above) so they stay fully
			// saturated instead of washing out grey with the rest of the
			// card. The checkmark itself uses Paper's own ink color
			// (#4e2e35) rather than the other themes' near-black --
			// sampled directly from the mockup's own Done badge.
			queueCompletedOverlays(card, titleEl, badgeEl, detailEls, doneTextEl, checkbox, PAPER_STRIKE_COLOR, isStartedTask ? null : { color: PAPER_STRIKE_COLOR, checkColor: '#4e2e35' });
		} else if (!isMagmaTheme && !isMetalTheme && !isPaperTheme && looksDone) {
			// Default completed cards: used to be a native CSS
			// text-decoration wavy line (styles.css), but that rendered too
			// tall/heavy at these font sizes and swallowed the text -- same
			// fixed #7fd9ff (matches the checked checkbox) via the same
			// measured SVG overlay + grouping the other themes use.
			queueCompletedOverlays(card, titleEl, badgeEl, detailEls, doneTextEl, null, '#7fd9ff', null);
		}
	});
	return card;
};
