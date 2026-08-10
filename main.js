const { Plugin, Modal, ItemView, setIcon } = require('obsidian');

// const { readData } = require('./components/readData.js');

// Global state for selected tasks and categories
const selectedTaskIds = new Set();
let selectedTaskForTimeLine;

let fileData = {

};

// Helper function for edit button action setup (+ Add Task)


const PLACE_ID = Object.freeze({
    SILDE_TWO_COMPLPET_TASKS: Symbol('SILDE_TWO_COMPLPET_TASKS'),
    SILDE_TWO_NOT_COMPLPET_TASKS: Symbol('SILDE_TWO_NOT_COMPLPET_TASKS'),
    SILDE_ONE_TIME_LINE: Symbol('SILDE_ONE_TIME_LINE')
});


const THEMES = [
    { name: null, label: 'Theme' },
    { name: 'magma', label: 'Liquid Magma' },
    { name: 'metal', label: 'Atlas Metal' },
    { name: 'paper', label: 'Paper Crayon' }
];

const applyControlarTheme = (plugin, index) => {
    const i = ((index % THEMES.length) + THEMES.length) % THEMES.length;
    const theme = THEMES[i];
    document.body.classList.remove('controlar-theme-magma', 'controlar-theme-metal', 'controlar-theme-paper');
    if (theme.name) {
        document.body.classList.add(`controlar-theme-${theme.name}`);
    }
    plugin.persistedThemeIndex = i;
    return theme;
};


// When a task is saved, visually detach (clone) the form from the controlar
// and fly it into slide 2's tasks container before re-rendering the new task.
const flyFormToSlideTwo = (formContainer) => {
    const target = document.querySelector('.slide-two-tasks-scrollbar');
    if (!target || !formContainer) return false;

    const src = formContainer.getBoundingClientRect();
    const dst = target.getBoundingClientRect();
    if (src.width === 0 || src.height === 0 || (dst.width === 0 && dst.height === 0)) {
        return false;
    }

    const clone = formContainer.cloneNode(true);
    clone.classList.add('controlar-edit-fly-clone');
    clone.style.position = 'fixed';
    clone.style.zIndex = '9999';
    clone.style.pointerEvents = 'none';
    clone.style.margin = '0';
    clone.style.left = src.left + 'px';
    clone.style.top = src.top + 'px';
    clone.style.width = src.width + 'px';
    document.body.appendChild(clone);

    void clone.offsetWidth; // force reflow so the transition starts cleanly

    const dx = (dst.left + dst.width / 2) - (src.left + src.width / 2);
    const dy = (dst.top + dst.height / 2) - (src.top + src.height / 2);
    clone.style.transition = 'transform 750ms cubic-bezier(0.22, 0.9, 0.3, 1), opacity 600ms ease';
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.15)`;
    clone.style.opacity = '0.35';

    setTimeout(() => {
        if (clone && typeof clone.remove === 'function') clone.remove();
    }, 780);

    return true;
};




const controlarEdit = (buttonGroup, instance) => {
    // Clear previous form container if it exists
    const existingForm = buttonGroup.querySelector('.controlar-btn-edit');
    if (existingForm) existingForm.remove();

    // Create wrapper container
    const formContainer = buttonGroup.createDiv({ cls: 'controlar-btn-edit' });

    // 1. Task Name Input Field
    const taskInput = formContainer.createEl('input', {
        type: 'text',
        placeholder: 'Task Name...',
        cls: 'controlar-input controlar-input-task'
    });

    const taskNameError = formContainer.createDiv({
        cls: 'controlar-error-msg',
        text: 'Task Name is required.'
    });

    // 2. Category Selector
    const rawCategories = fileData?.data?.category || fileData?.category || [];
    const categories = rawCategories.map(c => typeof c === 'string' ? c : c?.Name).filter(Boolean);
    if (!categories.includes('Uncategorized')) {
        categories.unshift('Uncategorized');
    }
    const categorySelect = formContainer.createEl('select', { cls: 'controlar-select' });
    categories.forEach(catName => {
        categorySelect.createEl('option', { text: `Category: ${catName}`, value: catName });
    });
    categorySelect.createEl('option', { text: '＋ Custom Category...', value: '__custom__' });

    const customCategoryInput = formContainer.createEl('input', {
        type: 'text',
        placeholder: 'New Category Name...',
        cls: 'controlar-input controlar-input-custom-category'
    });
    customCategoryInput.addClass('controlar-error-msg-hidden');

    categorySelect.addEventListener('change', () => {
        const isCustom = categorySelect.value === '__custom__';
        customCategoryInput.toggleClass('controlar-error-msg-hidden', !isCustom);
        customCategoryInput.removeClass('controlar-input-error');
        if (isCustom) customCategoryInput.focus();
    });

    // 3. Category / Task Color Picker Container
    const colorPickerWrapper = formContainer.createDiv({ cls: 'controlar-color-picker-wrapper' });
    colorPickerWrapper.createEl('label', { text: 'Category Color: ', cls: 'controlar-color-label' });
    const categoryColorInput = colorPickerWrapper.createEl('input', {
        type: 'color',
        value: '#89b4fa',
        cls: 'controlar-color-picker'
    });

    // 4. Background Image Selector
    const rawBackGrounds = fileData?.data?.backgrounds || fileData?.backgrounds || [];
    const backGrounds = rawBackGrounds.map(b => typeof b === 'string' ? b : b?.Name).filter(Boolean);
    const backGroundSelect = formContainer.createEl('select', { cls: 'controlar-select' });
    backGrounds.forEach(bg => {
        backGroundSelect.createEl('option', { text: `Background: ${bg}`, value: bg });
    });

    // 5. Alarm Sound Selector
    const rawAlarmSounds = fileData?.data?.alarmSounds || fileData?.alarmSounds || [];
    const alarmSounds = rawAlarmSounds.map(s => typeof s === 'string' ? s : s?.Name).filter(Boolean);
    const alarmSoundSelect = formContainer.createEl('select', { cls: 'controlar-select' });
    alarmSounds.forEach(sound => {
        alarmSoundSelect.createEl('option', { text: `Alarm: ${sound}`, value: sound });
    });

    // 6. Ambient Sound Selector
    const rawAmbientSounds = fileData?.data?.ambientSounds || fileData?.ambientSounds || [];
    const ambientSounds = rawAmbientSounds.map(s => typeof s === 'string' ? s : s?.Name).filter(Boolean);
    const ambientSoundsSelect = formContainer.createEl('select', { cls: 'controlar-select' });
    ambientSounds.forEach(sound => {
        ambientSoundsSelect.createEl('option', { text: `Ambient: ${sound}`, value: sound });
    });

    // 7. Time & Duration Inputs
    const expiryTimeInput = formContainer.createEl('input', {
        type: 'number',
        placeholder: 'Expiry Time (mins)...',
        cls: 'controlar-input'
    });

    const gapInput = formContainer.createEl('input', {
        type: 'number',
        placeholder: 'Gap (mins)...',
        cls: 'controlar-input'
    });

    expiryTimeInput.addEventListener('input', () => {
        expiryTimeInput.removeClass('controlar-input-error');
        gapInput.removeClass('controlar-input-error');
        expiryGapError.addClass('controlar-error-msg-hidden');
    });

    gapInput.addEventListener('input', () => {
        expiryTimeInput.removeClass('controlar-input-error');
        gapInput.removeClass('controlar-input-error');
        expiryGapError.addClass('controlar-error-msg-hidden');
    });

    const runtimeGapInput = formContainer.createEl('input', {
        type: 'number',
        placeholder: 'Runtime Gap (mins)...',
        cls: 'controlar-input'
    });

    const timeInput = formContainer.createEl('input', {
        type: 'time',
        cls: 'controlar-input controlar-time-input'
    });

    const expiryGapError = formContainer.createDiv({
        cls: 'controlar-error-msg controlar-error-msg-hidden',
        text: 'Fill in Expiry Time or Gap.'
    });

    // 8. Custom Color Toggle Checkbox
    const checkboxLabel = formContainer.createEl('label', { cls: 'controlar-checkbox-label' });
    const selectBox = checkboxLabel.createEl('input', { type: 'checkbox', cls: 'controlar-checkbox' });
    checkboxLabel.createSpan({ text: ' Enable Custom Color' });

    // 9. Save Task Button
    const saveBtn = formContainer.createEl('button', {
        text: 'Save Task',
        cls: 'controlar-btn-submit'
    });

    // Click Event Handler
    saveBtn.addEventListener('click', async () => {
        const name = taskInput.value.trim();
        const selectedCategory = categorySelect.value;
        const customCategory = customCategoryInput.value.trim();
        const category = selectedCategory === '__custom__' ? customCategory : selectedCategory;
        const color = categoryColorInput.value;
        const background = backGroundSelect.value;
        const alarmSound = alarmSoundSelect.value;
        const ambientSound = ambientSoundsSelect.value;
        const expiryTime = expiryTimeInput.value;
        const gap = gapInput.value;
        const runtimeGap = runtimeGapInput.value;
        const time = timeInput.value;
        const customColorEnabled = selectBox.checked;

        taskInput.removeClass('controlar-input-error');
        taskNameError.addClass('controlar-error-msg-hidden');
        expiryTimeInput.removeClass('controlar-input-error');
        gapInput.removeClass('controlar-input-error');
        expiryGapError.addClass('controlar-error-msg-hidden');

        if (!name) {
            taskInput.addClass('controlar-input-error');
            taskNameError.removeClass('controlar-error-msg-hidden');
            taskInput.focus();
            return;
        }

        if (!expiryTime && !gap) {
            expiryTimeInput.addClass('controlar-input-error');
            gapInput.addClass('controlar-input-error');
            expiryGapError.removeClass('controlar-error-msg-hidden');
            return;
        }

        if (selectedCategory === '__custom__' && !category) {
            customCategoryInput.addClass('controlar-input-error');
            customCategoryInput.focus();
            return;
        }

        const newTask = {
            id: Date.now().toString(),
            name: name,
            description: name, // Added for compatibility with renderTaskCard
            completed: false,
            category: category,
            color: color,
            background: background,
            alarmSound: alarmSound,
            ambientSound: ambientSound,
            expiryTime: expiryTime ? Number(expiryTime) : null,
            gap: gap ? Number(gap) : null,
            runtimeGap: runtimeGap ? Number(runtimeGap) : null,
            time: time || '12:00',
            customColor: customColorEnabled
        };

        // --- FIX A: Target nested data property if present ---
        const targetData = fileData.data ? fileData.data : fileData;

        if (category === 'Uncategorized') {
            targetData.notCategoriseTasks = targetData.notCategoriseTasks || [];
            targetData.notCategoriseTasks.unshift(newTask);
        } else {
            targetData.category = targetData.category || [];
            let catObj = targetData.category.find(c => (typeof c === 'string' ? c : c?.Name) === category);
            if (catObj && typeof catObj === 'object') {
                catObj.color = color;
                catObj.Tasks = catObj.Tasks || catObj.tasks || [];
                catObj.Tasks.unshift(newTask);
            } else {
                targetData.category.push({ Name: category, color: color, Tasks: [newTask] });
            }
        }

        // --- FIX B: Call saveData from plugin instance ---
        if (instance && instance.plugin && typeof instance.plugin.saveData === 'function') {
            await instance.plugin.saveData(fileData);
        }

        // Detach the form from the controlar and fly it into slide 2's tasks
        // container, then re-render once it lands.
        const flyApplied = flyFormToSlideTwo(formContainer);
        const afterFlight = () => {
            // Re-render Slide Two view if available
            if (instance && typeof instance.refreshSlideTwo === 'function') {
                instance.refreshSlideTwo();
            }
            if (instance && typeof instance.refreshSlideOne === 'function') {
                instance.refreshSlideOne();
            }
        };
        if (flyApplied) {
            setTimeout(afterFlight, 780);
        } else {
            afterFlight();
        }

        // Reset input form for next task
        taskInput.value = '';
        expiryTimeInput.value = '';
        gapInput.value = '';
        runtimeGapInput.value = '';
        timeInput.value = '';
        selectBox.checked = false;
        customCategoryInput.value = '';
        customCategoryInput.addClass('controlar-error-msg-hidden');
        customCategoryInput.removeClass('controlar-input-error');
        categorySelect.value = 'Uncategorized';
        taskInput.removeClass('controlar-input-error');
        taskNameError.addClass('controlar-error-msg-hidden');
        expiryTimeInput.removeClass('controlar-input-error');
        gapInput.removeClass('controlar-input-error');
        expiryGapError.addClass('controlar-error-msg-hidden');
        taskInput.focus();
    });
};








// Helper function to build top control buttons
const controlsBtn = (parentContainer, instance) => {
    const buttonGroup = parentContainer.createEl('div', { cls: 'controlar-btn' });



    const controlarHelp = buttonGroup.createEl('button', { text: 'controlar help', cls: "controlar-btn-help" });
    
    setIcon(controlarHelp, 'help-circle');
    controlarHelp.addEventListener('click', () => {
        new HelpModal(instance.app).open();
    });



    const controlarTheme = buttonGroup.createEl('button', { text: 'controlar theme', cls: "controlar-btn-theme" });
    const themePlugin = instance.plugin;
    themePlugin.persistedThemeIndex = themePlugin.persistedThemeIndex || 0;
    const syncTheme = () => {
        const theme = applyControlarTheme(themePlugin, themePlugin.persistedThemeIndex);
        controlarTheme.setText(theme.label);
    };
    syncTheme();
    controlarTheme.addEventListener('click', () => {
        themePlugin.persistedThemeIndex = themePlugin.persistedThemeIndex + 1;
        syncTheme();
    });

    // Integrated controlarEdit call
    controlarEdit(buttonGroup, instance);

    const controlarPlus = buttonGroup.createEl('button', { text: 'controlar plus', cls: "controlar-btn controlar-btn-plus" });
    controlarPlus.addEventListener('click', () => {
        console.log(`Action triggered on slide ${instance.currentSlide + 1}`);
    });


    // Right Navigation Button
    const rightBtn = buttonGroup.createEl('button', {
        text: 'right ▶',
        cls: 'controlar-btn controlar-btn-right'
    });
    rightBtn.addEventListener('click', () => {
        if (instance && typeof instance.goToSlide === 'function') {
            instance.goToSlide(instance.currentSlide + 1);
        }
    });



    // Left Navigation Button
    const leftBtn = buttonGroup.createEl('button', {
        text: '◀ left',
        cls: 'controlar-btn controlar-btn-left'
    });
    leftBtn.addEventListener('click', () => {
        if (instance && typeof instance.goToSlide === 'function') {
            instance.goToSlide(instance.currentSlide - 1);
        }
    });


};


const attachTaskSelectionListener = (taskEl, taskId, place, instance) => {
    taskEl.addEventListener('click', (e) => {
        if (place === PLACE_ID.SILDE_ONE_TIME_LINE) {
            console.log("taskEl:", taskEl, "taskId:", taskId, "place:", place);

            // Store the live task object (not a copy) so the global task stays
            // in sync with the timeline and keeps its selected highlight.
            const globalTask = findTaskById(fileData, taskId);

            const currentGlobalId = fileData?.data?.globalTasks?.id;

            if (globalTask && currentGlobalId !== taskId) {
                fileData.data = fileData.data || {};
                fileData.data.globalTasks = globalTask;

                if (instance && instance.plugin && typeof instance.plugin.saveData === 'function') {
                    instance.plugin.saveData(fileData);
                }

                if (instance && typeof instance.refreshSlideOne === 'function') {
                    instance.refreshSlideOne();
                }
            }
        }

        if (place === PLACE_ID.SILDE_TWO_NOT_COMPLPET_TASKS || place === PLACE_ID.SILDE_TWO_COMPLPET_TASKS) {
            console.log("taskEl:", taskEl, "taskId:", taskId, "place:", place);
            
            // Find the checkbox inside the task element
            const checkbox = taskEl.querySelector(".task-card-checkbox");
            if (checkbox) {
                // Ensure we don't attach duplicate change listeners
                if (!checkbox.dataset.listenerAttached) {
                    checkbox.dataset.listenerAttached = "true";
                    
                    checkbox.addEventListener('change', async (evt) => {
                        const isChecked = evt.target.checked;
                        console.log("Checkbox changed for task:", taskId, isChecked);

                        // Update the task completion status in fileData directly so
                        // the change always persists, regardless of selectedTaskForTimeLine.
                        const updateCompletion = (tasksList) => {
                            if (!Array.isArray(tasksList)) return;
                            const idx = tasksList.findIndex(t => t && t.id === taskId);
                            if (idx === -1) return;
                            const task = tasksList[idx];
                            task.completed = isChecked;
                            // Move the just-completed task to the front of its list
                            // so it appears at the top of the completed section.
                            if (isChecked) {
                                tasksList.splice(idx, 1);
                                tasksList.unshift(task);
                            }
                        };

                        const categoryGroups = fileData?.data?.category || fileData?.category || [];
                        if (Array.isArray(categoryGroups)) {
                            categoryGroups.forEach(group => updateCompletion(group && group.Tasks));
                        }
                        updateCompletion(fileData?.data?.notCategoriseTasks || fileData?.notCategoriseTasks);

                        // Also keep selectedTaskForTimeLine in sync for any other consumers
                        if (selectedTaskForTimeLine && Array.isArray(selectedTaskForTimeLine)) {
                            selectedTaskForTimeLine.forEach(group => {
                                updateCompletion(group.Tasks || (Array.isArray(group) ? group : [group]));
                            });
                        }

                        // Persist data if instance and plugin are available
                        if (instance && instance.plugin && typeof instance.plugin.saveData === 'function') {
                            await instance.plugin.saveData(fileData);
                        }

                        // Re-render so the task moves to the completed section when checked
                        if (instance && typeof instance.refreshSlideTwo === 'function') {
                            instance.refreshSlideTwo();
                        }
                        if (instance && typeof instance.refreshSlideOne === 'function') {
                            instance.refreshSlideOne();
                        }
                    });
                }
            }
        }
    });
};


const slideOneClock = (parentContainer, instance) => {
    const clockEl = parentContainer.createEl('div', { cls: 'slide-one-clock-part-global-colck' });
    clockEl.style.fontSize = '1.4em';
    clockEl.style.fontWeight = 'bold';
    clockEl.style.fontFamily = 'monospace';
    clockEl.style.padding = '6px 16px';
    clockEl.style.borderRadius = '6px';
    clockEl.style.backgroundColor = 'red';
    clockEl.style.border = '1px solid var(--background-modifier-border)';

    const clockDisplay = clockEl.createDiv({ cls: 'slide-one-clock-part-global-colck-clock' });
    const timerDisplay = clockEl.createDiv({ cls: 'slide-one-clock-part-global-colck-timer' });
    const pipeWrap = timerDisplay.createDiv({ cls: 'slide-one-time-line-task-pipe-wrap' });
    const pipeEl = pipeWrap.createDiv({ cls: 'slide-one-time-line-task-pipe' });
    const fillEl = pipeEl.createDiv({ cls: 'slide-one-time-line-task-pipe-fill' });
    const timerText = pipeWrap.createDiv({ cls: 'slide-one-time-line-task-timer' });

    const updateClock = () => {
        const now = new Date();
        clockDisplay.setText(now.toLocaleTimeString());
    };

    const updateTimer = () => {
        const globalTask = fileData?.data?.globalTasks;
        if (!globalTask || globalTask.completed) {
            fillEl.style.width = '0%';
            fillEl.style.backgroundColor = 'transparent';
            timerText.setText('–');
            return;
        }
        const mode = getTimerMode(globalTask);
        const dur = getTimerDurationSeconds(globalTask, mode);
        let entry = instance.taskTimers?.[globalTask.id];
        if (!entry) {
            entry = { startedAt: Date.now(), durationSeconds: dur, mode };
            if (!instance.taskTimers) instance.taskTimers = {};
            instance.taskTimers[globalTask.id] = entry;
        }
        let remaining = null;
        let totalMs = 0;
        if (entry) {
            if (entry.paused) {
                remaining = entry.pausedRemaining != null ? entry.pausedRemaining : 0;
                totalMs = entry.pausedTotalMs || 0;
            } else if (entry.deadline != null) {
                remaining = (entry.deadline - Date.now()) / 1000;
                totalMs = entry.deadline - entry.startedAt;
            } else if (entry.durationSeconds != null && entry.durationSeconds > 0) {
                remaining = entry.durationSeconds - (Date.now() - entry.startedAt) / 1000;
                totalMs = entry.durationSeconds * 1000;
            }
        } else if (dur != null) {
            remaining = dur;
            totalMs = dur * 1000;
        }
        const totalSeconds = totalMs / 1000;
        const fill = totalSeconds > 0 && remaining != null
            ? Math.max(0, Math.min(100, 100 * (1 - remaining / totalSeconds)))
            : 0;
        fillEl.style.width = fill + '%';
        fillEl.style.backgroundColor = getTaskCategoryColor(globalTask, globalTask.categoryName || globalTask.category || 'Uncategorized');
        timerText.setText(remaining != null ? formatCountdown(remaining) : '–');
    };

    updateClock();
    updateTimer();
    if (instance.clockInterval) {
        clearInterval(instance.clockInterval);
    }
    instance.clockInterval = setInterval(() => {
        updateClock();
        updateTimer();
    }, 1000);
}



const slideOneGanntChart = (parentContainer, instance) => {
    const ganntChartEndTimeLine = parentContainer
        .createDiv({ cls: 'slide-one-clock-part-gantt-chart' });

    const ganntChartExpandBtn = ganntChartEndTimeLine.createDiv({
        cls: 'slide-one-clock-part-gantt-chart-expand-btn',
        text: "expand"
    });
    const ganntChartTimeAxis = ganntChartEndTimeLine.createDiv({
        cls: 'slide-one-clock-part-gantt-chart-time-axis'
    });
    const ganntChartTimeAxisTimeline = ganntChartTimeAxis.createDiv({
        cls: 'slide-one-clock-part-gantt-chart-time-axis-timeline'
    });
    const ganntChartPage = ganntChartEndTimeLine.createDiv({
        cls: 'slide-one-clock-part-gantt-chart-page'
    });
    const ganntChartBody = ganntChartPage.createDiv({
        cls: 'slide-one-clock-part-gantt-chart-body'
    });
    const ganntChartCategoryAxis = ganntChartEndTimeLine.createDiv({
        cls: 'slide-one-clock-part-gantt-chart-category-axis'
    });

    const formatAxisTime = (date) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    };

    const ROW_HEIGHT = 16;
    const MAX_ROWS = Math.ceil(400 / ROW_HEIGHT);

    const getTaskRuntime = (task) => {
        const entry = instance.taskTimers && instance.taskTimers[task.id];
        let durationSeconds = 60;
        if (task.runtimeGap != null && Number(task.runtimeGap) > 0) {
            durationSeconds = Number(task.runtimeGap) * 60;
        } else if (entry && entry.durationSeconds != null && entry.durationSeconds > 0) {
            durationSeconds = entry.durationSeconds;
        } else {
            const dur = getTimerDurationSeconds(task, getTimerMode(task));
            if (dur != null && dur > 0) durationSeconds = dur;
        }
        const startMs = (entry && entry.startedAt != null)
            ? entry.startedAt
            : Date.now() - durationSeconds * 1000;
        return { durationSeconds, startMs, endMs: startMs + durationSeconds * 1000 };
    };

    const collectColumns = () => {
        const data = (fileData && fileData.data) || fileData || {};
        const columns = [];
        const seen = new Set();
        const pushColumn = (name, color, tasks) => {
            if (seen.has(name)) return;
            seen.add(name);
            columns.push({ name, color, tasks: tasks || [] });
        };
        (Array.isArray(data.category) ? data.category : []).forEach(cat => {
            const name = typeof cat === 'string' ? cat : (cat.Name || 'Uncategorized');
            const color = typeof cat === 'string' ? '#ffffff' : (cat.color || '#ffffff');
            const catTasks = Array.isArray(cat.Tasks) ? cat.Tasks : [];
            pushColumn(name, color, catTasks.filter(t => t && !t.completed && !t.isCompleted));
        });
        const uncategorized = Array.isArray(data.notCategoriseTasks) ? data.notCategoriseTasks : [];
        const unc = uncategorized.filter(t => t && !t.completed && !t.isCompleted);
        if (unc.length > 0) pushColumn('Uncategorized', '#ffffff', unc);
        return columns;
    };

    const renderCategoryAxis = (columns) => {
        ganntChartCategoryAxis.empty();
        columns.forEach(col => {
            const cell = ganntChartCategoryAxis.createDiv({
                cls: 'slide-one-clock-part-gantt-chart-category-axis-cell',
                text: col.name
            });
            cell.style.backgroundColor = col.color || '#ffffff';
        });
    };

    const buildRow = (columns, timeMs) => {
        const rowEl = ganntChartBody.createDiv({ cls: 'slide-one-clock-part-gantt-chart-row' });
        columns.forEach(col => {
            const cell = rowEl.createDiv({ cls: 'slide-one-clock-part-gantt-chart-cell' });
            const actives = col.tasks.filter(t => {
                const r = getTaskRuntime(t);
                return r.startMs <= timeMs && timeMs <= r.endMs;
            });
            if (actives.length > 0) {
                cell.style.backgroundColor = col.color || '#ffffff';
                cell.textContent = actives.map(a => a.name || a.description || 't').join(',');
            } else {
                cell.style.backgroundColor = 'rgba(255,255,255,0.06)';
            }
        });
        return rowEl;
    };

    const buildLabel = (timeMs) => {
        const labelEl = ganntChartTimeAxisTimeline.createDiv({
            cls: 'slide-one-clock-part-gantt-chart-time-axis-timeline-fonts',
            text: formatAxisTime(new Date(timeMs))
        });
        return labelEl;
    };

    const renderInitialRows = () => {
        const columns = collectColumns();
        renderCategoryAxis(columns);
        const now = Date.now();
        for (let i = MAX_ROWS - 1; i >= 0; i--) {
            const timeMs = now - i * 1000;
            ganntChartBody.insertBefore(buildRow(columns, timeMs), ganntChartBody.firstChild);
            ganntChartTimeAxisTimeline.insertBefore(buildLabel(timeMs), ganntChartTimeAxisTimeline.firstChild);
        }
        ganntChartPage.scrollTop = 0;
        ganntChartTimeAxisTimeline.scrollTop = 0;
    };

    // Every second: prepend a new row (with one cell per category) at the top
    // and animate it scrolling down. When it reaches the bottom the oldest row
    // is deleted. A matching time label is added/removed in the time-axis
    // timeline so it scrolls in lock-step with the page.
    let ganntScrollAnim = null;
    const animateScrollToBottom = (onDone) => {
        if (ganntScrollAnim) {
            cancelAnimationFrame(ganntScrollAnim);
        }
        const start = ganntChartPage.scrollTop;
        const target = ganntChartPage.scrollHeight;
        const startTime = performance.now();
        const duration = 900;
        const step = (now) => {
            const progress = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            ganntChartPage.scrollTop = start + (target - start) * eased;
            ganntChartTimeAxisTimeline.scrollTop = ganntChartPage.scrollTop;
            if (progress < 1) {
                ganntScrollAnim = requestAnimationFrame(step);
            } else {
                ganntScrollAnim = null;
                if (typeof onDone === 'function') onDone();
            }
        };
        ganntScrollAnim = requestAnimationFrame(step);
    };

    const cyclePage = () => {
        const columns = collectColumns();
        renderCategoryAxis(columns);
        const now = Date.now();
        const newRow = buildRow(columns, now);
        ganntChartBody.insertBefore(newRow, ganntChartBody.firstChild);
        const newLabel = buildLabel(now);
        ganntChartTimeAxisTimeline.insertBefore(newLabel, ganntChartTimeAxisTimeline.firstChild);

        animateScrollToBottom(() => {
            if (ganntChartBody.lastChild && ganntChartBody.lastChild !== newRow) {
                ganntChartBody.lastChild.remove();
                if (ganntChartTimeAxisTimeline.lastChild && ganntChartTimeAxisTimeline.lastChild !== newLabel) {
                    ganntChartTimeAxisTimeline.lastChild.remove();
                }
            }
            ganntChartTimeAxisTimeline.scrollTop = ganntChartPage.scrollTop;
        });
    };

    renderInitialRows();

    if (instance.ganntInterval) {
        clearInterval(instance.ganntInterval);
    }
    instance.ganntInterval = setInterval(cyclePage, 1000);

    // Toggle expand state on click
    let isExpanded = false;
    ganntChartExpandBtn.addEventListener('click', () => {
        isExpanded = !isExpanded;
        if (isExpanded) {
            ganntChartEndTimeLine.style.width = "500px";
            ganntChartEndTimeLine.addClass('selected-global-task');
            ganntChartExpandBtn.setText('collapse');
        } else {
            ganntChartEndTimeLine.style.width = "";
            ganntChartEndTimeLine.removeClass('selected-global-task');
            ganntChartExpandBtn.setText('expand');
        }
    });
};




const nnnnnnnnnnnnnslideOneGanntChart = (parentContainer, instance) => {

    // const ganntChartEndTimeLine = parentContainer
    //     .createDiv({ cls: 'slide-one-clock-part-gantt-chart' })

    // const ganntChartExpandBtn = ganntChartEndTimeLine.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-expand-btn', text: "expand"
    // });
    // const ganntChartTimeAxis = ganntChartEndTimeLine.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-time-axis', text: "time"
    // });
    // const ganntChartTaskAxis = ganntChartEndTimeLine.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-task-axis', text: "task"
    // });
    // const ganntChartPage = ganntChartEndTimeLine.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-page', text: "page"
    // });
    // const ganntChartPageTaskUnit = ganntChartPage.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-page-tasks'
    // });
    // ganntChartPageTaskUnit.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-page-tasks-fonts', text: "a"
    // });
    // ganntChartPageTaskUnit.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-page-tasks-fonts', text: "a"
    // });
    // ganntChartPageTaskUnit.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-page-tasks-fonts', text: "a"
    // });
    // ganntChartPageTaskUnit.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-page-tasks-fonts', text: "a"
    // });
    // ganntChartPageTaskUnit.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-page-tasks-fonts', text: "a"
    // });
    // ganntChartPageTaskUnit.createDiv({
    //     cls: 'slide-one-clock-part-gantt-chart-page-tasks-fonts', text: "a"
    // });


    // ganntChartExpandBtn.addEventListener('click', () => {
    //     ganntChartEndTimeLine.style.width = "500px";
    //     ganntChartEndTimeLine.addClass('selected-global-task');
    // });

    // const endTimeLineControlsRange = endTimeLineControls.createDiv({ 
    //     cls: 'slide-one-clock-part-end-time-line-scroll-bar-control-range-bar' 
    // });
    // endTimeLineControlsRange.createDiv({ text: "r1" });
    // endTimeLineControlsRange.createDiv({ text: "r2" });
    // endTimeLineControlsRange.createDiv({ text: "r3" });

    // const endTimeLineBarLine = clockPartEndTimeLine.createDiv({ 
    //     cls: 'slide-one-clock-part-end-time-line-scroll-bar-line' 
    // });
    // const endTimeLineBarTask = clockPartEndTimeLine.createDiv({ 
    //     cls: 'slide-one-clock-part-end-time-line-scroll-bar-tasks' 
    // });

    // // --- FIX: Gather all tasks safely into a single array ---
    // const activeData = fileData?.data || fileData || {};
    // const uncategorized = activeData.notCategoriseTasks || activeData.notCategoriseTasksInComplete || [];
    // const categories = activeData.category || [];

    // const allTasks = [];

    // // Add uncategorized tasks
    // uncategorized.forEach(task => {
    //     allTasks.push({ task, catName: 'Uncategorized' });
    // });

    // // Add category tasks
    // categories.forEach(cat => {
    //     const catName = typeof cat === 'string' ? cat : (cat.Name || 'Category');
    //     const tasks = cat.Tasks || [];
    //     tasks.forEach(task => {
    //         allTasks.push({ task, catName });
    //     });
    // });

    // // Render safely without out-of-bounds array access
    // allTasks.forEach(({ task, catName }) => {
    //     const desc = typeof task === 'string' ? task : (task?.description || task?.Name || 'Unnamed Task');
    //     endTimeLineBarLine.createDiv({ 
    //         text: `task: ${desc} | cat: ${catName}` 
    //     });
    //     endTimeLineBarTask.createDiv({ text: "t1" });
    // });
    // const updateClock = () => {
    //     const now = new Date();
    //     gneretGanttChart.setText(now.toLocaleTimeString());
    // };

    // updateClock();
    // instance.clockInterval = setInterval(updateClock, 1000);
}




const slideOneEndTimeLine = (parentContainer, instance) => {
    const clockPartEndTimeLine = parentContainer
        .createDiv({ cls: 'slide-one-clock-part-end-time-line' });

    // Control bar sits ABOVE the end timeline
    const endTimeLineControls = clockPartEndTimeLine.createDiv({
        cls: 'slide-one-clock-part-end-time-line-scroll-bar-control'
    });

    const endTimeLineControlsExpandBtn = endTimeLineControls.createDiv({
        cls: 'slide-one-clock-part-end-time-line-scroll-bar-control-expand-btn',
        text: 'expand'
    });

    // Toggle expand state on click
    let isExpanded = false;
    endTimeLineControlsExpandBtn.addEventListener('click', () => {
        isExpanded = !isExpanded;
        if (isExpanded) {
            clockPartEndTimeLine.style.width = "500px";
            clockPartEndTimeLine.addClass('selected-global-task');
            endTimeLineControlsExpandBtn.setText('collapse');
        } else {
            clockPartEndTimeLine.style.width = "";
            clockPartEndTimeLine.removeClass('selected-global-task');
            endTimeLineControlsExpandBtn.setText('expand');
        }
    });

    const endTimeLineControlsRange = endTimeLineControls.createDiv({
        cls: 'slide-one-clock-part-end-time-line-scroll-bar-control-range-bar'
    });

    // r1: square magnifying glass showing all task details (zoomed)
    const endTimeLineControlsRangeGlass = endTimeLineControlsRange.createDiv({
        cls: 'slide-one-clock-part-end-time-line-range-bar-glass'
    });
    const endTimeLineControlsRangeGlassViewport = endTimeLineControlsRangeGlass.createDiv({
        cls: 'slide-one-clock-part-end-time-line-range-bar-glass-viewport'
    });

    // r2: point indicator showing current position in the timeline
    const endTimeLineControlsRangePoint = endTimeLineControlsRange.createDiv({
        cls: 'slide-one-clock-part-end-time-line-range-bar-point'
    });

    // r3: scrollable handle to drag through the timeline
    const endTimeLineControlsRangeHandle = endTimeLineControlsRange.createDiv({
        cls: 'slide-one-clock-part-end-time-line-range-bar-handle'
    });
    const endTimeLineControlsRangeHandleTrack = endTimeLineControlsRangeHandle.createDiv({
        cls: 'slide-one-clock-part-end-time-line-range-bar-handle-track'
    });
    const endTimeLineControlsRangeHandleThumb = endTimeLineControlsRangeHandleTrack.createDiv({
        cls: 'slide-one-clock-part-end-time-line-range-bar-handle-thumb'
    });

    const scrollRange = (percent) => {
        const viewport = endTimeLineControlsRangeGlassViewport;
        const scrollable = viewport.scrollHeight - viewport.clientHeight;
        const p = Math.max(0, Math.min(1, percent));
        viewport.style.transform = `translateY(${-scrollable * p}px)`;
        endTimeLineControlsRangePoint.style.top = `calc(${p * 100}% - 6px)`;
        const maxThumb = endTimeLineControlsRangeHandleTrack.clientHeight - endTimeLineControlsRangeHandleThumb.offsetHeight;
        endTimeLineControlsRangeHandleThumb.style.top = `${Math.max(0, maxThumb * p)}px`;
    };

    const setRangeFromClientY = (clientY) => {
        const rect = endTimeLineControlsRangeHandleTrack.getBoundingClientRect();
        const percent = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
        scrollRange(percent);
    };

    endTimeLineControlsRangeHandleTrack.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        endTimeLineControlsRangeHandleTrack.setPointerCapture(e.pointerId);
        setRangeFromClientY(e.clientY);
    });
    endTimeLineControlsRangeHandleTrack.addEventListener('pointermove', (e) => {
        if (endTimeLineControlsRangeHandleTrack.hasPointerCapture(e.pointerId)) {
            setRangeFromClientY(e.clientY);
        }
    });
    endTimeLineControlsRangeHandleTrack.addEventListener('pointerup', (e) => {
        endTimeLineControlsRangeHandleTrack.releasePointerCapture(e.pointerId);
    });

    // The end timeline (line + tasks) lives below the control bar
    const clockPartEndTimeLineScrollBar = clockPartEndTimeLine.createDiv({
        cls: 'slide-one-clock-part-end-time-line-scroll-bar'
    });

    const endTimeLineBarLine = clockPartEndTimeLineScrollBar.createDiv({
        cls: 'slide-one-clock-part-end-time-line-scroll-bar-line'
    });
    const endTimeLineBarTask = clockPartEndTimeLineScrollBar.createDiv({
        cls: 'slide-one-clock-part-end-time-line-scroll-bar-tasks'
    });

    const renderEndTimeLine = () => {
        endTimeLineBarLine.empty();
        endTimeLineBarTask.empty();
        endTimeLineControlsRangeGlassViewport.empty();

        // Gather ALL tasks (complete + incomplete) safely into a single array
        const activeData = fileData?.data || fileData || {};
        const uncategorized = activeData.notCategoriseTasks || activeData.notCategoriseTasksInComplete || [];
        const categories = activeData.category || [];

        const allTasks = [];

        uncategorized.forEach(task => {
            if (!task) return;
            allTasks.push({ task, catName: 'Uncategorized', completed: !!(task.completed || task.isCompleted) });
        });

        categories.forEach(cat => {
            const catName = typeof cat === 'string' ? cat : (cat.Name || 'Category');
            (cat.Tasks || []).forEach(task => {
                if (!task) return;
                allTasks.push({ task, catName, completed: !!(task.completed || task.isCompleted) });
            });
        });

        // Recently closed (completed) tasks sink to the bottom of the timeline
        allTasks.sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));

        // Every task gets a dot on the end-time line; finished tasks (including
        // tasks finished during gap time) use the green complete dot, all other
        // tasks use the red dot and are styled red.
        allTasks.forEach(({ task, catName, completed }) => {
            const desc = typeof task === 'string' ? task : (task?.description || task?.Name || 'Unnamed Task');

            endTimeLineBarLine.createDiv({
                cls: completed
                    ? 'slide-one-clock-part-end-time-line-task-dot-complete'
                    : 'slide-one-clock-part-end-time-line-task-dot',
                text: '•'
            });

            const taskRow = endTimeLineBarTask.createDiv({ cls: 'slide-one-clock-part-end-time-line-task-row' });
            const badgeColor = getTaskCategoryColor(task, catName);
            const badge = taskRow.createDiv({ cls: 'slide-one-clock-part-end-time-line-task-badge' });
            badge.setText(catName);
            badge.style.backgroundColor = badgeColor;
            badge.style.color = badgeColor === '#ffffff' ? '#000000' : '#ffffff';
            taskRow.createDiv({
                cls: completed
                    ? 'slide-one-clock-part-end-time-line-task-complete'
                    : 'slide-one-clock-part-end-time-line-task-incomplete',
                text: desc
            });

            // Mirror every task's full details inside the magnifier glass
            const glassRow = endTimeLineControlsRangeGlassViewport.createDiv({ cls: 'slide-one-clock-part-end-time-line-range-bar-glass-row' });
            const glassBadge = glassRow.createDiv({ cls: 'slide-one-clock-part-end-time-line-range-bar-glass-badge' });
            glassBadge.setText(catName);
            glassBadge.style.backgroundColor = badgeColor;
            glassBadge.style.color = badgeColor === '#ffffff' ? '#000000' : '#ffffff';
            const glassInfo = glassRow.createDiv({
                cls: completed
                    ? 'slide-one-clock-part-end-time-line-range-bar-glass-task-complete'
                    : 'slide-one-clock-part-end-time-line-range-bar-glass-task-incomplete'
            });

            const details = [
                ['name', task?.name || task?.title || desc],
                ['desc', desc],
                ['cat', catName],
                ['time', task?.time],
                ['expiry', task?.expiryTime != null ? `${task.expiryTime}m` : null],
                ['gap', task?.gap != null ? `${task.gap}m` : (task?.gapTime != null ? `${task.gapTime}m` : null)],
                ['runtimeGap', task?.runtimeGap != null ? `${task.runtimeGap}m` : null],
                ['alarm', task?.alarmSound],
                ['ambient', task?.ambientSound],
                ['bg', task?.background]
            ];
            const detailText = details
                .filter(d => d[1] != null && String(d[1]).trim() !== '')
                .map(d => `${d[0]}: ${d[1]}`)
                .join(' | ');
            glassInfo.setText(completed ? `[done] ${detailText}` : `[pending] ${detailText}`);
        });

        scrollRange(0);
    };

    renderEndTimeLine();
    instance.refreshEndTimeLine = renderEndTimeLine;
};



const slideOneClockpart = (parentContainer, instance) => {
    const clockEl = parentContainer.createEl('div', { cls: 'slide-one-clock-part' });
    slideOneEndTimeLine(clockEl, instance)
    slideOneClock(clockEl, instance)
    slideOneGanntChart(clockEl, instance)
}


// Find the actual (live) task object in the data by id, searching
// uncategorized tasks and every category's task list.
const findTaskById = (data, taskId) => {
    if (!data || taskId == null) return null;
    const targetData = data.data || data;
    const uncategorized = targetData.notCategoriseTasks || targetData.notCategoriseTasksInComplete || [];
    const searchList = (list) => {
        if (!Array.isArray(list)) return null;
        return list.find(t => t && t.id === taskId) || null;
    };
    let found = searchList(uncategorized);
    if (found) return found;
    const categories = targetData.category || [];
    for (const cat of categories) {
        found = searchList(cat.Tasks || cat.tasks);
        if (found) return found;
    }
    return null;
};

// Helper function to extract all incomplete tasks with category names
const getIncompleteTasksWithCategory = (data) => {
    const tasks = [];
    const seenIds = new Set();

    const pushTask = (task, categoryName) => {
        if (task && task.id != null) {
            if (seenIds.has(task.id)) return;
            seenIds.add(task.id);
        }
        tasks.push({
            ...(typeof task === 'object' ? task : { description: task }),
            categoryName: categoryName
        });
    };

    // 1. Collect Uncategorized Incomplete Tasks
    const uncategorized = data?.notCategoriseTasksInComplete || data?.data?.notCategoriseTasks || data?.notCategoriseTasks || [];
    uncategorized
        .filter(t => !t.completed && !t.isCompleted)
        .forEach(task => pushTask(task, 'Uncategorized'));

    // 2. Collect Incomplete Tasks from Categories
    const categories = data?.data?.category || data?.category || [];
    categories.forEach(cat => {
        const categoryName = typeof cat === 'string' ? cat : (cat.Name || cat.categoryName || 'Uncategorized');

        // Filter for incomplete tasks inside each category
        const catTasks = cat.Tasks || cat.incompleteTasks || cat.Incomplete || [];
        const incompleteCatTasks = Array.isArray(catTasks)
            ? catTasks.filter(t => !t.completed && !t.isCompleted)
            : [];

        incompleteCatTasks.forEach(task => pushTask(task, categoryName));
    });

    return tasks;
};


// --- Timeline per-task countdown timer helpers ---

const getExpiredMinutes = (task) => {
    if (!task) return null;
    if (task.expiryTime != null && !isNaN(Number(task.expiryTime)) && Number(task.expiryTime) > 0) {
        return { type: 'duration', minutes: Number(task.expiryTime) };
    }
    const raw = task.expiredTime;
    if (raw == null || raw === '' || String(raw).trim().toLowerCase() === 'never') return null;
    const s = String(raw).trim().toLowerCase();
    const durMatch = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)?$/);
    if (durMatch) {
        return { type: 'duration', minutes: parseFloat(durMatch[1]) };
    }
    const clockMatch = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
    if (clockMatch) {
        let h = parseInt(clockMatch[1], 10);
        const minute = parseInt(clockMatch[2], 10);
        const ampm = clockMatch[3];
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        return { type: 'clock', hour: h, minute: minute };
    }
    return null;
};

const getGapMinutes = (task) => {
    if (!task) return null;
    const gap = task.gap != null && !isNaN(Number(task.gap)) ? Number(task.gap)
        : (task.gapTime != null && String(task.gapTime).trim() !== '' && !isNaN(Number(task.gapTime)) ? Number(task.gapTime) : null);
    return gap != null && gap > 0 ? gap : null;
};

const getTimerMode = (task) => {
    const hasExpired = getExpiredMinutes(task) != null;
    const hasGap = getGapMinutes(task) != null;
    if (hasExpired && hasGap) return 'gapCycleUntilDeadline';
    if (hasExpired) return 'expiredTimer';
    if (hasGap) return 'gapCycle';
    return 'none';
};

const getTimerDurationSeconds = (task, mode) => {
    if (mode === 'expiredTimer') {
        const e = getExpiredMinutes(task);
        if (e && e.type === 'duration') return e.minutes * 60;
        return null; // clock-time expiry counts down to the deadline instead
    }
    const gap = getGapMinutes(task);
    if (gap != null && gap > 0) return gap * 60;
    return null;
};

const formatCountdown = (seconds) => {
    if (seconds == null || seconds <= 0) return '00:00';
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// Fluid RGB color for the live countdown progress.
// progress = remaining / total (1 = just started, 0 = almost out of time).
// Cascades seamlessly across 4 color brackets: Purple -> Blue -> Green -> Red.
const getColor = (progress) => {
    const p = Math.max(0, Math.min(1, progress));
    const stops = [
        { pos: 1, rgb: [176, 82, 255] },
        { pos: 2 / 3, rgb: [64, 120, 255] },
        { pos: 1 / 3, rgb: [60, 220, 130] },
        { pos: 0, rgb: [255, 60, 60] }
    ];
    for (let i = 0; i < stops.length - 1; i++) {
        const hi = stops[i];
        const lo = stops[i + 1];
        if (p <= hi.pos && p >= lo.pos) {
            const span = hi.pos - lo.pos;
            const t = span > 0 ? (hi.pos - p) / span : 1;
            const r = Math.round(hi.rgb[0] + (lo.rgb[0] - hi.rgb[0]) * t);
            const g = Math.round(hi.rgb[1] + (lo.rgb[1] - hi.rgb[1]) * t);
            const b = Math.round(hi.rgb[2] + (lo.rgb[2] - hi.rgb[2]) * t);
            return `rgb(${r}, ${g}, ${b})`;
        }
    }
    return 'rgb(255, 60, 60)';
};

const getTaskCategoryColor = (task, categoryName) => {
    if (task && task.color) return task.color;
    const categories = fileData?.data?.category || fileData?.category || [];
    const cat = categories.find(c => typeof c === 'string' ? c === categoryName : c?.Name === categoryName);
    return (cat && cat.color) || '#ffffff';
};


const slideOneTimeLine = (parentContainer, instance) => {
    const timeline = parentContainer
        .createEl('div', { cls: 'slide-one-time-line' })
        .createEl('div', { cls: 'slide-one-time-line-task-scroll-bar' });

    const taskList = timeline.createDiv({ cls: 'slide-one-time-line-task-list' });

    const collectTasks = () => {
        // Take slide 2's incomplete tasks directly from the live data,
        // mirroring exactly what slideTwo.renderTasks() displays.
        const incompleteTasks = [];
        const seenIds = new Set();

        const pushTask = (task, categoryName, parentList) => {
            if (!task || task.completed || task.isCompleted) return;
            if (task.id != null) {
                if (seenIds.has(task.id)) return;
                seenIds.add(task.id);
            }
            incompleteTasks.push({
                ...(typeof task === 'object' ? task : { description: task }),
                categoryName: categoryName,
                sourceTask: task,
                parentList: parentList
            });
        };

        // Respect slide 2's active badge filter so the timeline stays in sync
        const filter = instance?.slideTwoFilter || {};
        const activeFilter = filter.activeFilter || 'all';
        const selectedBadgeNames = filter.selectedBadgeNames || new Set();
        const showUncategorized = activeFilter === 'all' || selectedBadgeNames.has('Uncategorized');

        const categories = fileData?.data?.category || fileData?.category || [];
        const visibleCategories = activeFilter === 'all'
            ? categories
            : activeFilter === 'categories'
                ? categories.filter(cat => selectedBadgeNames.has(typeof cat === 'string' ? cat : cat.Name))
                : [];

        if (showUncategorized) {
            const uncategorizedTasks = fileData?.data?.notCategoriseTasks || fileData?.notCategoriseTasks || [];
            uncategorizedTasks.forEach(task => pushTask(task, 'Uncategorized', uncategorizedTasks));
        }

        visibleCategories.forEach(cat => {
            const categoryName = typeof cat === 'string' ? cat : (cat.Name || cat.categoryName || 'Uncategorized');
            const catTaskList = cat.Tasks || cat.tasks || [];
            catTaskList.forEach(task => pushTask(task, categoryName, catTaskList));
        });

        return incompleteTasks;
    };

    if (!instance.taskTimers) {
        instance.taskTimers = {};
    }

    const ensureTimers = (tasks) => {
        tasks.forEach(w => {
            const t = w.sourceTask;
            const mode = getTimerMode(t);
            const dur = getTimerDurationSeconds(t, mode);
            let entry = instance.taskTimers[t.id];
            if (!entry) {
                entry = { startedAt: Date.now(), durationSeconds: dur, mode };
                instance.taskTimers[t.id] = entry;
            } else if (entry.mode !== 'preset' && (entry.mode !== mode || entry.durationSeconds !== dur)) {
                entry.mode = mode;
                entry.durationSeconds = dur;
                entry.startedAt = Date.now();
            }

            // "gap cycle until deadline": keep one persistent expiry deadline
            if (mode === 'gapCycleUntilDeadline' && !t.timerDeadline) {
                const e = getExpiredMinutes(t);
                if (e && e.type === 'clock') {
                    const now = new Date();
                    const dl = new Date(now.getFullYear(), now.getMonth(), now.getDate(), e.hour, e.minute);
                    t.timerDeadline = dl.getTime();
                } else if (e) {
                    t.timerDeadline = Date.now() + e.minutes * 60000;
                }
            }
            // pure clock-time expiry counts down to the deadline
            if (mode === 'expiredTimer' && dur == null && !entry.deadline) {
                const e = getExpiredMinutes(t);
                if (e && e.type === 'clock') {
                    const now = new Date();
                    const dl = new Date(now.getFullYear(), now.getMonth(), now.getDate(), e.hour, e.minute);
                    entry.deadline = dl.getTime();
                }
            }
        });
    };

    const remainingSeconds = (entry) => {
        if (!entry) return null;
        if (entry.paused) return entry.pausedRemaining != null ? entry.pausedRemaining : 0;
        if (entry.deadline != null) return (entry.deadline - Date.now()) / 1000;
        if (entry.durationSeconds != null && entry.durationSeconds > 0) {
            return entry.durationSeconds - (Date.now() - entry.startedAt) / 1000;
        }
        return null;
    };

    const fillPercent = (entry) => {
        if (!entry) return 0;
        const remaining = remainingSeconds(entry);
        if (remaining == null) return 0;
        let totalMs;
        if (entry.paused) {
            totalMs = entry.pausedTotalMs || 0;
        } else if (entry.deadline != null) {
            totalMs = entry.deadline - entry.startedAt;
        } else if (entry.durationSeconds != null && entry.durationSeconds > 0) {
            totalMs = entry.durationSeconds * 1000;
        } else {
            return 0;
        }
        if (totalMs <= 0) return 0;
        return Math.max(0, Math.min(100, 100 * (1 - remaining / (totalMs / 1000))));
    };

    const handleTimerExpired = (w, entry) => {
        const t = w.sourceTask;
        if (entry.mode === 'none') return false;

        // expired-only task: complete and stop
        if (entry.mode === 'expiredTimer') {
            t.completed = true;
            delete instance.taskTimers[t.id];
            return true;
        }

        // gap cycle until deadline: once the expiry deadline has passed, stay completed
        if (entry.mode === 'gapCycleUntilDeadline' && t.timerDeadline && Date.now() >= t.timerDeadline) {
            t.completed = true;
            delete instance.taskTimers[t.id];
            return true;
        }

        // complete the current task and generate an identical new one
        t.completed = true;
        const newTask = { ...t };
        newTask.id = Date.now().toString() + '-' + Math.floor(Math.random() * 100000);
        newTask.completed = false;
        const parentList = w.parentList;
        const idx = parentList ? parentList.indexOf(t) : -1;
        if (idx >= 0) parentList.splice(idx + 1, 0, newTask);
        else if (parentList) parentList.push(newTask);

        // If the expired task was the selected global task, keep the selection
        // on its regenerated replacement so it stays highlighted in the timeline.
        if (fileData?.data?.globalTasks === t) {
            fileData.data.globalTasks = newTask;
        }

        delete instance.taskTimers[t.id];
        return true;
    };

    const renderTimeLine = () => {
        let tasks = collectTasks();

        ensureTimers(tasks);

        let persisted = false;
        tasks.forEach(w => {
            const t = w.sourceTask;
            const entry = instance.taskTimers[t.id];
            if (!entry) return;
            const deadlinePassed = entry.mode === 'gapCycleUntilDeadline' && t.timerDeadline && Date.now() >= t.timerDeadline;
            const remaining = remainingSeconds(entry);
            if (deadlinePassed || (remaining != null && remaining <= 0)) {
                if (handleTimerExpired(w, entry)) persisted = true;
            }
        });

        if (persisted) {
            if (instance.plugin && typeof instance.plugin.saveData === 'function') {
                instance.plugin.saveData(fileData);
            }
            if (instance && typeof instance.refreshSlideTwo === 'function') {
                instance.refreshSlideTwo();
            }
            // Re-collect so regenerated tasks appear immediately
            tasks = collectTasks();
            ensureTimers(tasks);
        }

        // Drop timer state for tasks that no longer need it (e.g. completed)
        // Never drop the global task's entry so the status bar stays in sync
        const activeIds = new Set(tasks.map(w => w.sourceTask.id));
        const protectedIds = new Set([fileData?.data?.globalTasks?.id]);
        Object.keys(instance.taskTimers).forEach(id => {
            if (!activeIds.has(id) && !protectedIds.has(id)) delete instance.taskTimers[id];
        });

        selectedTaskForTimeLine = tasks;
        taskList.empty();

        const globalTaskId = fileData?.data?.globalTasks?.id;

        if (selectedTaskForTimeLine && selectedTaskForTimeLine.length > 0) {
            selectedTaskForTimeLine.forEach((task) => {
                const entry = instance.taskTimers[task.id];
                const remaining = remainingSeconds(entry);

                // Filter: only show tasks finishing within [now, now + rangeFilter]
                if (rangeFilter != null) {
                    if (remaining == null || remaining <= 0 || remaining > rangeFilter) {
                        return;
                    }
                }

                const taskCls = task.id === globalTaskId
                    ? 'slide-one-time-line-task-global-task'
                    : 'slide-one-time-line-task';
                const taskEl = taskList.createEl('div', { cls: taskCls });

                const pipeWrap = taskEl.createDiv({ cls: 'slide-one-time-line-task-pipe-wrap' });
                const pipeEl = pipeWrap.createDiv({ cls: 'slide-one-time-line-task-pipe' });
                const fillEl = pipeEl.createDiv({ cls: 'slide-one-time-line-task-pipe-fill' });
                fillEl.style.backgroundColor = getTaskCategoryColor(task, task.categoryName);
                fillEl.style.width = fillPercent(entry) + '%';
                const timerEl = pipeWrap.createDiv({ cls: 'slide-one-time-line-task-timer' });
                timerEl.setText(remaining != null ? formatCountdown(remaining) : '–');

                const taskText = taskEl.createDiv({ cls: 'slide-one-time-line-task-text' });
                taskText.setText(`[${task.categoryName}] ${task.description || task.title || 'Task'}`);

                // Attach selection listener passing the actual task's ID
                attachTaskSelectionListener(taskEl, task.id, PLACE_ID.SILDE_ONE_TIME_LINE, instance);
            });
        } else {
            taskList.createEl('div', { text: 'No incomplete tasks available.' });
        }
    };

    let rangeFilter = null;

    renderTimeLine();

    const timeLineRange = timeline.createDiv({ cls: "slide-one-time-line-range" });
    const rangeLabel = timeLineRange.createEl('label', {
        text: 'rangeLabel',
        cls: "lide-one-time-line-range-label",
        attr: { for: 'slide-one-time-line-range-scroll-input' }
    });
    const rangeScrollInput = timeLineRange.createEl('input', {
        type: 'number',
        min: '0',
        step: '1',
        placeholder: 'seconds',
        cls: "slide-one-time-line-range-scroll",
        attr: { id: 'slide-one-time-line-range-scroll-input' }
    });

    rangeScrollInput.addEventListener('input', () => {
        const val = Number(rangeScrollInput.value);
        rangeFilter = (Number.isFinite(val) && val > 0) ? val : null;
        renderTimeLine();
    });

    instance.refreshSlideOne = () => {
        renderTimeLine();
        if (instance && typeof instance.refreshEndTimeLine === 'function') {
            instance.refreshEndTimeLine();
        }
    };

    if (instance.timelineInterval) {
        clearInterval(instance.timelineInterval);
    }
    instance.timelineInterval = setInterval(() => {
        if (instance && typeof instance.refreshSlideOne === 'function') {
            instance.refreshSlideOne();
        }
    }, 1000);

};

const slideOne = (parentContainer, instance) => {
    const _slideOne = parentContainer.createEl('div', { cls: 'slide-one' });
    slideOneClockpart(_slideOne, instance);
    slideOneTimeLine(_slideOne, instance);
};


const renderTaskCard = (container, taskEl, categoryName = "Uncategorized", className, instance) => {


    if (!taskEl) return;

    // const item = container.createDiv({ cls: className, text: `• ${taskEl.description || taskEl.Name || 'No description'}` });


    // Dynamic class assignment based on completion status
    const cardCls = taskEl.completed
        ? 'slide-two-tasks-complete-tasks-container'
        : 'slide-two-tasks-incomplete-tasks-container';

    const card = container.createDiv({ cls: cardCls });

    const completeLabel = card.createEl('label', { cls: 'slide-two-tasks-incomplete-tasks-container-completed-label' });
    completeLabel.createDiv({ cls: 'task-card-category-badge', text: categoryName });
    completeLabel.createSpan({ text: 'Done ' });
    const checkbox = completeLabel.createEl('input', { type: 'checkbox', cls: 'task-card-checkbox' });
    checkbox.checked = !!taskEl.completed;



    const headerRow = card.createDiv({ cls: 'slide-two-tasks-incomplete-tasks-container-header' });
    headerRow.createDiv({ cls: 'task-card-description', text: taskEl.description || taskEl.Name || 'No description' });
    const btnCircle = headerRow.createEl('button', { cls: 'task-card-action-btn-circle' });

    if (taskEl.completed) {
        if (typeof setIcon === 'function') {
            setIcon(btnCircle, 'trash');
        } else {
            btnCircle.setText('✖');
        }
        btnCircle.classList.add('controlar-btn-delete-task');
        btnCircle.addEventListener('click', async (evt) => {
            evt.stopPropagation();
            const categoryGroups = fileData?.data?.category || fileData?.category || [];
            if (Array.isArray(categoryGroups)) {
                for (const group of categoryGroups) {
                    const tasks = group && group.Tasks;
                    if (Array.isArray(tasks)) {
                        const idx = tasks.findIndex(t => t && t.id === taskEl.id);
                        if (idx !== -1) {
                            tasks.splice(idx, 1);
                            break;
                        }
                    }
                }
            }
            const uncategorizedTasks = fileData?.data?.notCategoriseTasks || fileData?.notCategoriseTasks;
            if (Array.isArray(uncategorizedTasks)) {
                const idx = uncategorizedTasks.findIndex(t => t && t.id === taskEl.id);
                if (idx !== -1) {
                    uncategorizedTasks.splice(idx, 1);
                }
            }
            if (instance && instance.plugin && typeof instance.plugin.saveData === 'function') {
                await instance.plugin.saveData(fileData);
            }
            if (instance && typeof instance.refreshSlideTwo === 'function') {
                instance.refreshSlideTwo();
            }
            if (instance && typeof instance.refreshSlideOne === 'function') {
                instance.refreshSlideOne();
            }
        });
    } else {
        if (typeof setIcon === 'function') {
            setIcon(btnCircle, 'play');
        } else {
            btnCircle.setText('▶');
        }
    }

    const detailsGrid = card.createDiv({ cls: 'slide-two-tasks-incomplete-tasks-container-details' });

    detailsGrid.createDiv({
        cls: 'task-card-detail-item detail-expired-time',
        text: `Expire: ${taskEl.expiredTime || 'never'}`
    });

    detailsGrid.createDiv({
        cls: 'task-card-detail-item detail-end-date',
        text: `End Date: ${taskEl.endDate || 'N/A'}`
    });

    detailsGrid.createDiv({
        cls: 'task-card-detail-item detail-gap-time',
        text: `Gap: ${taskEl.gapTime || '5'}m`
    });

    detailsGrid.createDiv({
        cls: 'task-card-detail-item detail-bg-image',
        text: `Bg: ${taskEl.selectedBgImage || 'none'}`
    });

    detailsGrid.createDiv({
        cls: 'task-card-detail-item detail-ambient-sound',
        text: `Ambient: ${taskEl.selectedAmbientSound || 'none'}`
    });

    detailsGrid.createDiv({
        cls: 'task-card-detail-item detail-alarm-sound',
        text: `Alarm: ${taskEl.selectedAlarmSound || 'default'}`
    });

    detailsGrid.createDiv({
        cls: 'task-card-detail-item detail-runtime-seconds',
        text: `Runtime: ${taskEl.runtimeSeconds != null ? taskEl.runtimeSeconds + 's' : 'N/A'}`
    });

    attachTaskSelectionListener(card, taskEl.id, PLACE_ID.SILDE_TWO_NOT_COMPLPET_TASKS, instance);



};


const slideTwo = (parentContainer, instance) => {
    const _slideTwo = parentContainer.createEl('div', { cls: 'slide-two' });
    const categoriesContainer = _slideTwo.createDiv({ cls: 'slide-two-badgesList' }).createDiv({ cls: 'slide-two-badgesList-scroll-bar' });
    const taskContainer = _slideTwo.createDiv({ cls: 'slide-two-tasks-scrollbar' });
    const categories = fileData?.data?.category || fileData?.category || [];
    const uncategorizedTasks = fileData?.data?.notCategoriseTasks || fileData?.notCategoriseTasks || [];

    let activeFilter = 'all';
    const selectedBadgeNames = new Set();

    const setBadgeActive = (badgeEl, isActive, color) => {
        if (isActive) {
            badgeEl.addClass('active-badge');
            badgeEl.style.backgroundColor = color || 'var(--interactive-accent)';
            badgeEl.style.color = 'var(--text-on-accent)';
        } else {
            badgeEl.removeClass('active-badge');
            badgeEl.style.backgroundColor = '';
            badgeEl.style.color = color || '';
        }
    };

    const renderTasks = () => {
        const selectedTasks = [...categories, ...uncategorizedTasks];
        taskContainer.empty();

        const summaryEl = taskContainer.createDiv({ cls: 'slide-two-tasks-summery' });

        const allTasks = [...categories.flatMap(e => e.Tasks || []), ...uncategorizedTasks];
        const totalTasks = allTasks.length;
        const completedTasks = allTasks.filter(e => e.completed).length;
        const incompleteTasks = allTasks.filter(e => !e.completed).length;
        const firstTask = uncategorizedTasks[0] || categories[0]?.Tasks?.[0] || null;

        const addSummaryItem = (label, value, cls) => {
            const item = summaryEl.createDiv({ cls: `slide-two-tasks-summery-item ${cls}` });
            item.createSpan({ cls: 'slide-two-tasks-summery-label', text: label });
            item.createSpan({ cls: 'slide-two-tasks-summery-value', text: String(value) });
        };

        addSummaryItem('Total', totalTasks, 'detail-total');
        addSummaryItem('Done', completedTasks, 'detail-done');
        addSummaryItem('Pending', incompleteTasks, 'detail-pending');
        addSummaryItem('Categories', categories.length, 'detail-categories');
        addSummaryItem('Uncategorized', uncategorizedTasks.length, 'detail-uncategorized');
        addSummaryItem('Gap', firstTask?.gapTime || '5', 'detail-gap');

        const visibleCategories = activeFilter === 'all'
            ? categories
            : activeFilter === 'categories'
                ? categories.filter(e => selectedBadgeNames.has(e.Name))
                : [];

        const showUncategorized = activeFilter === 'all' || selectedBadgeNames.has('Uncategorized');

        // --- INCOMPLETE TASKS ---
        // Uncategorized Header & List
        if (showUncategorized) {
            const hasUncatIncomplete = uncategorizedTasks.some(e => !e.completed);
            const uncatHeaderCls = hasUncatIncomplete ? 'slide-two-tasks-incomplete-category-name' : 'slide-two-tasks-disable';
            taskContainer.createDiv({ cls: uncatHeaderCls, text: "Uncategorized" });

            uncategorizedTasks.filter(e => e.completed === false).forEach(e => {
                renderTaskCard(taskContainer, e, "Uncategorized", 'slide-two-tasks-incomplete-tasks', instance);
                // attachTaskSelectionListener(e,e.id,PLACE_ID.SILDE_TWO_COMPLPET_TASKS)
            });
        }

        // Category Headers & List (Incomplete)
        visibleCategories.forEach(e => {
            const incompleteTasks = (e?.Tasks || []).filter(f => f.completed === false);
            const catCls = incompleteTasks.length > 0 ? 'slide-two-tasks-incomplete-category-name' : 'slide-two-tasks-disable';

            const item = taskContainer.createDiv({ cls: catCls, text: `• ${e.Name}` });
            // attachTaskSelectionListener(item, e.id, "::A::");

            incompleteTasks.forEach(f => {
                renderTaskCard(taskContainer, f, e.Name, 'slide-two-tasks-incomplete-tasks', instance);
                // attachTaskSelectionListener(item, e.id, "::A::");
            });
        });

        // Collapsible button that toggles the completed-tasks menu
        const colapsBtn = taskContainer.createEl('button', {
            cls: 'slide-two-tasks-colaps-btn',
            text: '☰ Completed Tasks Menu'
        });
        const completedTasksMenu = taskContainer.createDiv({ cls: 'slide-two-tasks-completed-menu' });

        colapsBtn.addEventListener('click', () => {
            const isHidden = completedTasksMenu.classList.toggle('slide-two-tasks-completed-menu-hidden');
            colapsBtn.setText(isHidden ? '☰ Completed Tasks Menu' : '▼ Completed Tasks Menu');
        });

        // --- COMPLETED TASKS ---
        // Uncategorized Header & List
        if (showUncategorized) {
            const hasUncatComplete = uncategorizedTasks.some(e => e.completed);
            const uncatCompleteHeaderCls = hasUncatComplete ? 'slide-two-tasks-complete-category-name' : 'slide-two-tasks-disable';
            completedTasksMenu.createDiv({ cls: uncatCompleteHeaderCls, text: "Uncategorized" });

            uncategorizedTasks.filter(e => e.completed === true).forEach(e => {
                renderTaskCard(completedTasksMenu, e, "Uncategorized", 'slide-two-tasks-complete-tasks', instance);
            });
        }

        // Category Headers & List (Completed)
        visibleCategories.forEach(e => {
            const completeTasks = (e?.Tasks || []).filter(f => f.completed === true);
            const catCls = completeTasks.length > 0 ? 'slide-two-tasks-complete-category-name' : 'slide-two-tasks-disable';

            const item = completedTasksMenu.createDiv({ cls: catCls, text: `• ${e.Name}` });
            attachTaskSelectionListener(item, e.id, "::A::");

            completeTasks.forEach(f => {
                renderTaskCard(completedTasksMenu, f, e.Name, 'slide-two-tasks-complete-tasks', instance);
            });
        });
    };

    instance.refreshSlideTwo = () => {
        renderTasks();
        renderBadges();
    };

    let allBadge, uncatBadge, catBadges;

    const syncFilterToInstance = () => {
        if (instance) {
            instance.slideTwoFilter = {
                activeFilter: activeFilter,
                selectedBadgeNames: new Set(selectedBadgeNames)
            };
        }
    };

    const refreshSlideOne = () => {
        if (instance && typeof instance.refreshSlideOne === 'function') {
            instance.refreshSlideOne();
        }
    };

    const renderBadges = () => {
        categoriesContainer.empty();

        const makeBadge = (text, onClick) => {
            const badge = categoriesContainer.createDiv({ text, cls: 'slide-two-badges' });
            badge.addEventListener('click', (evt) => {
                evt.stopPropagation();
                onClick();
                renderTasks();
                updateBadges();
                syncFilterToInstance();
                refreshSlideOne();
            });
            return badge;
        };

        // All badge (permanent)
        allBadge = makeBadge('All', () => {
            activeFilter = 'all';
            selectedBadgeNames.clear();
        });

        // Uncategorized badge (permanent)
        uncatBadge = makeBadge('Uncategorized', () => {
            if (activeFilter === 'all') {
                activeFilter = 'categories';
            }
            if (selectedBadgeNames.has('Uncategorized')) {
                selectedBadgeNames.delete('Uncategorized');
            } else {
                selectedBadgeNames.add('Uncategorized');
            }
            if (selectedBadgeNames.size === 0) {
                activeFilter = 'all';
            }
        });

        // Category badges (rebuilt so new categories appear)
        catBadges = categories.map(e => {
            const badge = categoriesContainer.createDiv({ text: e.Name, cls: 'slide-two-badges' });
            badge.style.color = e.color;
            badge.style.borderColor = e.color;

            badge.addEventListener('click', (evt) => {
                evt.stopPropagation();

                if (activeFilter === 'all') {
                    activeFilter = 'categories';
                }
                if (selectedBadgeNames.has(e.Name)) {
                    selectedBadgeNames.delete(e.Name);
                } else {
                    selectedBadgeNames.add(e.Name);
                }

                if (selectedBadgeNames.size === 0) {
                    activeFilter = 'all';
                }

                renderTasks();
                updateBadges();
                syncFilterToInstance();
                refreshSlideOne();
            });

            return badge;
        });

        updateBadges();
    };

    const updateBadges = () => {
        setBadgeActive(allBadge, activeFilter === 'all');
        setBadgeActive(uncatBadge, selectedBadgeNames.has('Uncategorized'));
        catBadges.forEach((badge, i) => {
            const e = categories[i];
            const isActive = selectedBadgeNames.has(e.Name);
            setBadgeActive(badge, isActive, e.color);
        });
    };

    renderTasks();
    renderBadges();
    syncFilterToInstance();
};

const slideThree = (parentContainer, instance) => {
    const _slideThree = parentContainer.createEl('div', { cls: 'slide-three' });
    const tableHeader = _slideThree.createDiv({ cls: 'slide-three-table-header' });
    tableHeader.createDiv({ cls: 'slide-three-table-header-address-home', text: '• Home Address' });
    tableHeader.createDiv({ cls: 'slide-three-table-header-address-reciveb', text: '• Received Address' });
    tableHeader.createDiv({ cls: 'slide-three-table-header-address-list', text: '• Address List' });

    const tableBody = _slideThree.createDiv({ cls: 'slide-three-table-body' });
    tableBody.createDiv({ text: 'slide-three-table-body' }).style.backgroundColor = "red";
    tableBody.createDiv({ text: 'slide-three-table-body' }).style.backgroundColor = "blue";
    tableBody.createDiv({ text: 'slide-three-table-body' }).style.backgroundColor = "yellow";
    tableBody.createDiv({ text: 'slide-three-table-body' }).style.backgroundColor = "green";
};

const buildSliderLayout = (parentContainer, instance) => {
    parentContainer.addClass('modal-controlar');
    // Populate selectedTaskForTimeLine before rendering any slide
    selectedTaskForTimeLine = getIncompleteTasksWithCategory(fileData);

    const topSection = parentContainer.createEl('div', { cls: 'controlar' });
    controlsBtn(topSection, instance);

    parentContainer.createEl('hr');

    const sliderWrapper = parentContainer.createEl('div', { cls: 'slide-columns-wrapper' });

    instance.sliderTrack = sliderWrapper.createEl('div', { cls: 'slider-track' });
    instance.sliderTrack.style.display = 'flex';
    instance.sliderTrack.style.width = `${instance.totalSlides * 100}%`;
    instance.sliderTrack.style.transition = 'transform 0.4s ease-in-out';

    for (let i = 0; i < instance.totalSlides; i++) {
        const slide = instance.sliderTrack.createEl('div', { cls: `slide slide-${i + 1}` });
        slide.style.width = `${100 / instance.totalSlides}%`;
        slide.style.flexShrink = '0';
        slide.style.padding = '20px 10px';
        slide.style.boxSizing = 'border-box';


        if (i === 0) {
            slideOne(slide, instance);
        } else if (i === 1) {
            slideTwo(slide, instance);
        } else if (i === 2) {
            slideThree(slide, instance);
        }
    }
};






// --- HELP MODAL COMPONENT ---
class HelpModal extends Modal {
    constructor(app) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pomodoro-help-modal');

        contentEl.createEl('h2', { text: 'Pomodoro Plugin Guide', cls: 'pomodoro-help-title' });

        const helpContainer = contentEl.createDiv({ cls: 'pomodoro-help-accordion-list' });

        const item1 = helpContainer.createEl('details', { cls: 'pomodoro-help-item' });
        item1.createEl('summary', { text: '📌 Overview & Dashboard' });
        const body1 = item1.createDiv({ cls: 'pomodoro-help-content' });
        body1.createEl('p', { text: 'Use the top action bar to toggle options or navigate across 3 slides containing your analytics, running timers, and workflow history.' });

        const item2 = helpContainer.createEl('details', { cls: 'pomodoro-help-item' });
        item2.createEl('summary', { text: '⚡ Mouse Shortcuts' });
        const body2 = item2.createDiv({ cls: 'pomodoro-help-content' });
        const list2 = body2.createEl('ul');
        list2.createEl('li', { text: 'Left Click (Status Bar): Pause or resume the running countdown.' });
        list2.createEl('li', { text: 'Right Click (Status Bar): Open main dashboard modal.' });
        list2.createEl('li', { text: 'Middle Click (Status Bar): Cycle forward through duration presets.' });

        const item3 = helpContainer.createEl('details', { cls: 'pomodoro-help-item' });
        item3.createEl('summary', { text: '⏱️ Dynamic Timers & Gantt Visuals' });
        const body3 = item3.createDiv({ cls: 'pomodoro-help-content' });
        body3.createEl('p', { text: 'The timeline charts update in real time every second to track active categories and interval runtimes.' });
    }

    onClose() {
        this.contentEl.empty();
    }
}






















class AddTaskModal extends Modal {
    constructor(app, plugin, onTaskAdded) {
        super(app);
        this.plugin = plugin;
        this.onTaskAdded = onTaskAdded;
        this.taskData = {
            description: '',
            selectedCategoryId: 'uncategorized',
            expiredTime: '',
            endDate: '',
            gapTime: '5',
            selectedBgImage: '',
            selectedAmbientSound: '',
            selectedAlarmSound: '',
            runtimeSeconds: ''
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Add New Task' });

        const form = contentEl.createEl('form');
        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '10px';

        // Task Description
        form.createEl('label', { text: 'Task Description / Name:' });
        const descInput = form.createEl('input', { type: 'text', placeholder: 'Enter task description' });
        descInput.addEventListener('input', (e) => this.taskData.description = e.target.value);

        // Category Selection
        form.createEl('label', { text: 'Select Category:' });
        const categorySelect = form.createEl('select');

        const uncategorizedOption = categorySelect.createEl('option', { text: 'Uncategorized', value: 'uncategorized' });

        const categories = fileData?.data?.category || fileData?.category || [];
        categories.forEach(cat => {
            const opt = categorySelect.createEl('option', { text: cat.Name, value: cat.id || cat.Name });
            if (cat.selected) opt.selected = true;
        });

        this.taskData.selectedCategoryId = categorySelect.value;
        categorySelect.addEventListener('change', (e) => this.taskData.selectedCategoryId = e.target.value);

        // Expired Time
        form.createEl('label', { text: 'Expired Time:' });
        const expiredInput = form.createEl('input', { type: 'text', placeholder: 'e.g. 10:00 AM or 30m' });
        expiredInput.addEventListener('input', (e) => this.taskData.expiredTime = e.target.value);

        // End Date
        form.createEl('label', { text: 'End Date:' });
        const endDateInput = form.createEl('input', { type: 'date' });
        endDateInput.addEventListener('input', (e) => this.taskData.endDate = e.target.value);

        // Gap Time
        form.createEl('label', { text: 'Gap Time (minutes):' });
        const gapInput = form.createEl('input', { type: 'number', value: '5' });
        gapInput.addEventListener('input', (e) => this.taskData.gapTime = e.target.value);

        // Background Image
        form.createEl('label', { text: 'Background Image URL / Path:' });
        const bgInput = form.createEl('input', { type: 'text', placeholder: 'Image URL or path' });
        bgInput.addEventListener('input', (e) => this.taskData.selectedBgImage = e.target.value);

        // Ambient Sound
        form.createEl('label', { text: 'Ambient Sound:' });
        const ambientInput = form.createEl('input', { type: 'text', placeholder: 'e.g. Rain, Forest' });
        ambientInput.addEventListener('input', (e) => this.taskData.selectedAmbientSound = e.target.value);

        // Alarm Sound
        form.createEl('label', { text: 'Alarm Sound:' });
        const alarmInput = form.createEl('input', { type: 'text', placeholder: 'e.g. Digital, Bell' });
        alarmInput.addEventListener('input', (e) => this.taskData.selectedAlarmSound = e.target.value);

        // Runtime Seconds
        form.createEl('label', { text: 'Runtime (Seconds):' });
        const runtimeInput = form.createEl('input', { type: 'number', placeholder: 'e.g. 1500' });
        runtimeInput.addEventListener('input', (e) => this.taskData.runtimeSeconds = e.target.value);

        // Submit Button
        const submitBtn = form.createEl('button', { text: 'Save Task', type: 'submit' });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!this.taskData.description.trim()) {
                alert('Please enter a task description.');
                return;
            }

            const newTask = {
                id: Date.now().toString(),
                description: this.taskData.description,
                completed: false,
                expiredTime: this.taskData.expiredTime || 'never',
                endDate: this.taskData.endDate || 'N/A',
                gapTime: this.taskData.gapTime || '5',
                selectedBgImage: this.taskData.selectedBgImage || 'none',
                selectedAmbientSound: this.taskData.selectedAmbientSound || 'none',
                selectedAlarmSound: this.taskData.selectedAlarmSound || 'default',
                runtimeSeconds: this.taskData.runtimeSeconds ? Number(this.taskData.runtimeSeconds) : null
            };

            if (this.taskData.selectedCategoryId === 'uncategorized') {
                const targetList = fileData.data ? fileData.data.notCategoriseTasks : fileData.notCategoriseTasks;
                if (targetList) targetList.push(newTask);
            } else {
                const catList = fileData.data ? fileData.data.category : fileData.category;
                const matchedCat = catList.find(c => (c.id || c.Name) === this.taskData.selectedCategoryId);
                if (matchedCat) {
                    if (!matchedCat.Tasks) matchedCat.Tasks = [];
                    matchedCat.Tasks.push(newTask);
                }
            }

            if (this.plugin) {
                await this.plugin.saveData(fileData);
            }

            if (this.onTaskAdded) {
                this.onTaskAdded();
            }

            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class SlidingModalWithClock extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.currentSlide = 0;
        this.totalSlides = 3;
        this.clockInterval = null;
        this.sliderTrack = null;
        this.taskTimers = plugin.taskTimers || (plugin.taskTimers = {});
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        buildSliderLayout(contentEl, this);
    }

    goToSlide(index) {
        if (index < 0) {
            this.currentSlide = this.totalSlides - 1;
        } else if (index >= this.totalSlides) {
            this.currentSlide = 0;
        } else {
            this.currentSlide = index;
        }

        if (this.sliderTrack) {
            const percentage = (100 / this.totalSlides) * this.currentSlide;
            this.sliderTrack.style.transform = `translateX(-${percentage}%)`;
        }
    }

    onClose() {
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }

        if (this.timelineInterval) {
            clearInterval(this.timelineInterval);
            this.timelineInterval = null;
        }

        const { contentEl } = this;
        contentEl.empty();
    }
}

// --- RIGHT SIDEBAR TIMER MENU VIEW ---
const SIDEBAR_VIEW_TYPE = 'timer-sidebar-view';

const renderSidebarMenu = (rootEl, plugin) => {
    if (plugin._sidebarFacade) {
        const old = plugin._sidebarFacade;
        if (old.clockInterval) clearInterval(old.clockInterval);
        if (old.timelineInterval) clearInterval(old.timelineInterval);
        if (old.ganntInterval) clearInterval(old.ganntInterval);
    }

    rootEl.empty();
    rootEl.addClass('controlar-sidebar-view');

    const facade = {
        plugin: plugin,
        app: plugin.app,
        taskTimers: plugin.taskTimers || (plugin.taskTimers = {}),
        slideTwoFilter: { activeFilter: 'all', selectedBadgeNames: new Set() },
        refreshSlideTwo: () => {}
    };
    plugin._sidebarFacade = facade;

    const clockWrap = rootEl.createDiv({ cls: 'controlar-sidebar-section controlar-sidebar-clock' });
    slideOneClock(clockWrap, facade);

    const timelineWrap = rootEl.createDiv({ cls: 'controlar-sidebar-section controlar-sidebar-timeline' });
    slideOneTimeLine(timelineWrap, facade);

    return facade;
};

class SidebarTimerView extends ItemView {
    constructor(leaf, pluginInstance) {
        super(leaf);
        this.pluginInstance = pluginInstance;
    }

    getViewType() {
        return SIDEBAR_VIEW_TYPE;
    }

    getDisplayText() {
        return 'Timer Menu';
    }

    getIcon() {
        return 'timer';
    }

    async onOpen() {
        renderSidebarMenu(this.contentEl, this.pluginInstance);
        const el = this.contentEl;
        const openModal = () => {
            new SlidingModalWithClock(this.pluginInstance.app, this.pluginInstance).open();
        };
        if (!el.dataset.menuListeners) {
            el.dataset.menuListeners = '1';
            el.addEventListener('dblclick', (e) => {
                e.preventDefault();
                openModal();
            });
            el.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                this._lpX = e.clientX;
                this._lpY = e.clientY;
                if (this._lpTimer) clearTimeout(this._lpTimer);
                this._lpTimer = setTimeout(() => {
                    this._lpTimer = null;
                    openModal();
                }, 600);
            });
            el.addEventListener('pointermove', (e) => {
                if (this._lpTimer && (Math.abs(e.clientX - this._lpX) > 10 || Math.abs(e.clientY - this._lpY) > 10)) {
                    clearTimeout(this._lpTimer);
                    this._lpTimer = null;
                }
            });
            const cancelLongPress = () => {
                if (this._lpTimer) {
                    clearTimeout(this._lpTimer);
                    this._lpTimer = null;
                }
            };
            el.addEventListener('pointerup', cancelLongPress);
            el.addEventListener('pointerleave', cancelLongPress);
            el.addEventListener('pointercancel', cancelLongPress);
            el.addEventListener('contextmenu', (e) => e.preventDefault());
        }
    }

    async onClose() {
        const facade = this.pluginInstance._sidebarFacade;
        if (facade) {
            if (facade.clockInterval) clearInterval(facade.clockInterval);
            if (facade.timelineInterval) clearInterval(facade.timelineInterval);
            if (facade.ganntInterval) clearInterval(facade.ganntInterval);
        }
        if (this._lpTimer) {
            clearTimeout(this._lpTimer);
            this._lpTimer = null;
        }
        this.pluginInstance._sidebarFacade = null;
    }
}

// Main Plugin Class
module.exports = class MyStatusBarPlugin extends Plugin {
    async getFolderFiles(relativePath) {
        try {
            const basePath = (this.manifest.dir || '') + '/' + relativePath;
            const listResult = await this.app.vault.adapter.list(basePath);
            if (!listResult || !Array.isArray(listResult.files)) return [];
            return listResult.files
                .map(f => f.split('/').pop())
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b));
        } catch (e) {
            return [];
        }
    }

    async populateAssetOptions() {
        const target = fileData.data ? fileData.data : fileData;
        target.backgrounds = await this.getFolderFiles('asset/image');
        target.alarmSounds = await this.getFolderFiles('asset/audio/alarm');
        target.ambientSounds = await this.getFolderFiles('asset/audio/background');
        await this.saveData(fileData);
    }

    async onload() {
        const rawData = await this.loadData();
        console.log('Loading Status Bar Plugin with Clock Slider Modal...');
        if (rawData) {
            fileData = rawData;
        }
        console.log("Data is loaded", fileData);

        // Re-link the persisted global task to its live task object so the
        // timeline can highlight it after a reload.
        if (fileData?.data?.globalTasks?.id) {
            const liveGlobal = findTaskById(fileData, fileData.data.globalTasks.id);
            if (liveGlobal) {
                fileData.data.globalTasks = liveGlobal;
            }
        }

        await this.populateAssetOptions();

        const statusBarItemEl = this.addStatusBarItem();
        statusBarItemEl.addClass('controlar-status-bar-timer');
        statusBarItemEl.style.cursor = 'pointer';
        statusBarItemEl.style.padding = '0 8px';
        statusBarItemEl.style.borderRadius = '4px';
        statusBarItemEl.style.fontFamily = 'monospace';
        statusBarItemEl.style.fontWeight = 'bold';
        statusBarItemEl.style.marginLeft = '6px';

        this.taskTimers = this.taskTimers || {};
        this.statusPresetIndex = 0;
        this.statusPaused = false;
        this.slideTwoFilter = this.slideTwoFilter || { activeFilter: 'all', selectedBadgeNames: new Set() };

        // Live remaining time (and total span) of the global task's timer
        const computeGlobalRemaining = () => {
            const globalTask = fileData?.data?.globalTasks;
            if (!globalTask || globalTask.completed) return null;
            const mode = getTimerMode(globalTask);
            const dur = getTimerDurationSeconds(globalTask, mode);
            let entry = this.taskTimers[globalTask.id];
            if (!entry) {
                entry = { startedAt: Date.now(), durationSeconds: dur, mode };
                this.taskTimers[globalTask.id] = entry;
            } else if (entry.mode !== 'preset' && (entry.mode !== mode || entry.durationSeconds !== dur)) {
                entry.mode = mode;
                entry.durationSeconds = dur;
                entry.startedAt = Date.now();
            }

            if (entry.mode !== 'preset') {
                if (mode === 'gapCycleUntilDeadline' && !globalTask.timerDeadline) {
                    const e = getExpiredMinutes(globalTask);
                    if (e && e.type === 'clock') {
                        const now = new Date();
                        const dl = new Date(now.getFullYear(), now.getMonth(), now.getDate(), e.hour, e.minute);
                        globalTask.timerDeadline = dl.getTime();
                    } else if (e) {
                        globalTask.timerDeadline = Date.now() + e.minutes * 60000;
                    }
                }
                if (mode === 'expiredTimer' && dur == null && !entry.deadline) {
                    const e = getExpiredMinutes(globalTask);
                    if (e && e.type === 'clock') {
                        const now = new Date();
                        const dl = new Date(now.getFullYear(), now.getMonth(), now.getDate(), e.hour, e.minute);
                        entry.deadline = dl.getTime();
                    }
                }
            }

            let remaining = null;
            let totalMs = 0;
            if (entry.paused) {
                remaining = entry.pausedRemaining != null ? entry.pausedRemaining : 0;
                totalMs = entry.pausedTotalMs || 0;
            } else if (entry.deadline != null) {
                remaining = (entry.deadline - Date.now()) / 1000;
                totalMs = entry.deadline - entry.startedAt;
            } else if (entry.durationSeconds != null && entry.durationSeconds > 0) {
                remaining = entry.durationSeconds - (Date.now() - entry.startedAt) / 1000;
                totalMs = entry.durationSeconds * 1000;
            }
            return { remaining, totalMs, entry, mode, globalTask };
        };

        // Time presets = durations (seconds) of slide one's timeline filtered tasks
        const buildTimelinePresets = () => {
            const presets = [];
            const seenIds = new Set();
            const filter = this.slideTwoFilter || {};
            const activeFilter = filter.activeFilter || 'all';
            const selectedBadgeNames = filter.selectedBadgeNames || new Set();
            const showUncategorized = activeFilter === 'all' || selectedBadgeNames.has('Uncategorized');

            const categories = fileData?.data?.category || fileData?.category || [];
            const visibleCategories = activeFilter === 'all'
                ? categories
                : activeFilter === 'categories'
                    ? categories.filter(cat => selectedBadgeNames.has(typeof cat === 'string' ? cat : cat.Name))
                    : [];

            const push = (task) => {
                if (!task || task.completed || task.isCompleted) return;
                if (task.id != null) {
                    if (seenIds.has(task.id)) return;
                    seenIds.add(task.id);
                }
                const dur = getTimerDurationSeconds(task, getTimerMode(task));
                if (dur != null && dur > 0) presets.push(dur);
            };

            if (showUncategorized) {
                const uncategorizedTasks = fileData?.data?.notCategoriseTasks || fileData?.notCategoriseTasks || [];
                uncategorizedTasks.forEach(push);
            }
            visibleCategories.forEach(cat => {
                (cat.Tasks || cat.tasks || []).forEach(push);
            });
            return presets;
        };

        const stopStatusInterval = () => {
            if (this.statusTimerInterval) {
                clearInterval(this.statusTimerInterval);
                this.statusTimerInterval = null;
            }
        };

        const updateStatusTimer = () => {
            const info = computeGlobalRemaining();
            if (!info) {
                statusBarItemEl.setText(this.statusPaused ? '⏸ 00:00' : '▶ 00:00');
                statusBarItemEl.style.backgroundColor = '';
                return;
            }
            // Preset countdown finished → fall back to the global task's own timer
            if (info.remaining != null && info.remaining <= 0 && info.entry.mode === 'preset') {
                delete this.taskTimers[info.globalTask.id];
                updateStatusTimer();
                return;
            }
            const remaining = info.remaining != null ? Math.max(0, info.remaining) : 0;
            const totalSeconds = info.totalMs / 1000;
            const progress = totalSeconds > 0 ? remaining / totalSeconds : 0;
            statusBarItemEl.setText((info.entry.paused ? '⏸ ' : '▶ ') + formatCountdown(remaining));
            statusBarItemEl.style.backgroundColor = getColor(progress);
        };

        const startStatusInterval = () => {
            stopStatusInterval();
            updateStatusTimer();
            this.statusTimerInterval = setInterval(updateStatusTimer, 1000);
        };

        const togglePause = () => {
            const info = computeGlobalRemaining();
            if (!info) return;
            if (info.entry.paused) {
                const rem = info.entry.pausedRemaining != null ? info.entry.pausedRemaining : 0;
                if (info.entry.deadline != null) {
                    info.entry.deadline = Date.now() + rem * 1000;
                } else if (info.entry.durationSeconds != null && info.entry.durationSeconds > 0) {
                    info.entry.startedAt = Date.now() - (info.entry.durationSeconds - rem) * 1000;
                }
                delete info.entry.paused;
                delete info.entry.pausedRemaining;
                delete info.entry.pausedTotalMs;
                this.statusPaused = false;
                startStatusInterval();
            } else {
                info.entry.paused = true;
                info.entry.pausedRemaining = info.remaining != null ? Math.max(0, info.remaining) : 0;
                info.entry.pausedTotalMs = info.totalMs;
                this.statusPaused = true;
                stopStatusInterval();
                updateStatusTimer();
            }
        };

        const cyclePreset = () => {
            const globalTask = fileData?.data?.globalTasks;
            const presets = buildTimelinePresets();
            if (!globalTask || presets.length === 0) return;
            this.statusPresetIndex = (this.statusPresetIndex || 0) + 1;
            if (this.statusPresetIndex >= presets.length) this.statusPresetIndex = 0;
            let entry = this.taskTimers[globalTask.id] || {};
            entry.mode = 'preset';
            entry.durationSeconds = presets[this.statusPresetIndex];
            entry.startedAt = Date.now();
            entry.deadline = null;
            delete entry.paused;
            delete entry.pausedRemaining;
            delete entry.pausedTotalMs;
            this.taskTimers[globalTask.id] = entry;
            this.statusPaused = false;
            startStatusInterval();
        };

        // Left click: pause or resume the running countdown
        statusBarItemEl.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePause();
        });

        // Right click: open the slider modal
        statusBarItemEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            new SlidingModalWithClock(this.app, this).open();
        });

        // Middle / scroll-wheel click: cycle forward through the duration presets
        statusBarItemEl.addEventListener('auxclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.button === 1) cyclePreset();
        });

        startStatusInterval();

        // Right sidebar timer menu (works on desktop and mobile)
        this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new SidebarTimerView(leaf, this));

        this.app.workspace.onLayoutReady(async () => {
            await this.openSidebarView();
        });

        // readData(); 
    }

    async openSidebarView() {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
        if (existing.length > 0) {
            workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = workspace.getRightLeaf(false) || workspace.getLeaf('tab');
        if (!leaf) return;
        await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
        workspace.revealLeaf(leaf);
    }

    onunload() {
        if (this.statusTimerInterval) {
            clearInterval(this.statusTimerInterval);
            this.statusTimerInterval = null;
        }
        console.log('Unloading Plugin.');
    }
};

