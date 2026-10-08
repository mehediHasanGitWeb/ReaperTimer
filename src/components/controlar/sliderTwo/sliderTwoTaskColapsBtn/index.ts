// "sliderTwoTaskColapsBtn": the collapsible toggle row for the "DONE till" and
// completed-tasks sections of slide 2.
//
// Look (matches the mockup's "secBtn"): while the section is open the button
// is the small icon-only circle (icon ▲ / △ meaning "click to close"); once
// collapsed it becomes the bigger solid pill with icon (☰) + label inviting
// you to open it again.
//
// The list is virtual (see ./source.ts), so the section's rows are no longer
// children of a menu element that gets hidden -- the button just reports the
// new state and the list rebuilds without those rows.

export interface CollapseBtnOptions {
	label?: string;
	/** Outlined (hollow) open-state icon (△ instead of ▲) -- used by the "DONE till" copy so the two buttons are easy to tell apart. */
	hollow?: boolean;
	/** Section is currently collapsed (rows hidden). */
	collapsed?: boolean;
	/** Called when the button is clicked, with the new collapsed state. */
	onToggle?: (collapsed: boolean) => void;
}

export const renderSliderTwoCollapseBtn = (parent: HTMLElement, options: CollapseBtnOptions = {}): HTMLButtonElement => {
	const { label = 'Completed Tasks Menu', hollow = false, collapsed = false, onToggle } = options;
	const openIcon = hollow ? '△' : '▲';
	const colapsBtn = parent.createEl('button', {
		cls: `slide-two-tasks-colaps-btn ${collapsed ? 'is-big' : 'is-small'}${hollow ? ' is-hollow' : ''}`,
	});
	colapsBtn.createSpan({ cls: 'slide-two-tasks-colaps-btn-icon', text: collapsed ? '☰' : openIcon });
	colapsBtn.createSpan({ cls: 'slide-two-tasks-colaps-btn-label', text: label });
	colapsBtn.addEventListener('click', () => {
		if (onToggle) onToggle(!collapsed);
	});
	return colapsBtn;
};
