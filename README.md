# Plugin Name

A task-timer dashboard for Obsidian. Create tasks with categories, colours and sounds, run countdowns from the status bar, and follow your day on a live timeline and Gantt chart.

> Replace "Plugin Name" above with your plugin's final name (it should match `name` in `manifest.json`).

## Features

### Status bar timer
A countdown for the currently selected task sits in Obsidian's status bar. Its colour changes as the time runs down.

| Mouse action | What it does |
| --- | --- |
| Left click | Pause or resume the countdown |
| Right click | Open the dashboard |
| Middle click | Cycle through duration presets |

### Dashboard
The dashboard opens in a window with three slides. Use the arrow buttons on the left and right to move between them.

At the top of the dashboard:

- **Add task form** with task name, category, category colour, alarm sound, ambient sound, expiry time, gap, runtime gap, a time picker and an optional custom colour.
- **Theme button**, which cycles through four looks: Default, Liquid Magma, Atlas Metal and Paper Crayon.
- **Help button**, which opens a short in-app guide.

**Slide 1: Clock and timeline**
- A live clock, with a progress bar for the selected task's countdown.
- A timeline of your tasks and their timers, updated every second.
- A seconds filter to narrow the timeline.

**Slide 2: Tasks**
- Category filter badges to show all tasks or only certain categories.
- A summary of completed and pending tasks and the number of categories.
- Task cards grouped by category, with **Start** and **Done** controls, plus a separate completed-tasks section.

**Slide 3: Gantt chart and end timeline**
- A live Gantt chart of tasks by category, with its own options panel.
- An end-of-day timeline with a magnifying glass. Drag or scroll its handle to look through different parts of the list.
- Each panel has an **expand** button that lets it fill the slide. Click **collapse** to go back to both panels.

### Sidebar timer
A timer panel opens in Obsidian's right sidebar when the plugin loads. It works on desktop and mobile.

### Sounds
Each task can have an alarm sound and an ambient (background) sound.

The sounds are not part of the plugin install (Obsidian only downloads `main.js`, `manifest.json` and `styles.css`). The first time the plugin starts without them, it asks whether to download the sound pack (about 21 MB). You can also run **Download sound pack** from the command palette at any time.

The files are saved in the plugin's own folder:

- `asset/audio/alarm/` for alarm sounds
- `asset/audio/background/` for ambient sounds

You can also add your own files to these folders; the plugin lists every file it finds there.

### Network use
The plugin connects to the internet for one thing only: downloading the sound pack (`audio-pack.zip`) from this repository's GitHub releases, and only after you agree or run the command. Nothing is uploaded and no other data is sent.

### Large task lists
Small task lists are saved in the plugin's `data.json`, as usual. When a vault has more than 8,000 tasks, the plugin automatically splits them into smaller files in a `tasks` folder inside the plugin folder. Only the changed parts are rewritten on each save.

## Installation

### From Community plugins
1. Open **Settings → Community plugins** and turn off Restricted mode if needed.
2. Select **Browse** and search for the plugin name.
3. Select **Install**, then **Enable**.

### Manual install
1. Download `main.js`, `manifest.json` and `styles.css` from the latest [release](../../releases).
2. Create the folder `<your vault>/.obsidian/plugins/<plugin-id>/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable the plugin in **Settings → Community plugins**.

## Publishing the sound pack (maintainers)

1. Put the audio files in `asset/audio/alarm/` and `asset/audio/background/`.
2. Run `npm run pack-audio`. This creates `audio-pack.zip`.
3. On GitHub, create a release with the tag `sound-pack-1` (the `SOUND_PACK_TAG` in `src/sounds/soundPack.ts`) and attach `audio-pack.zip`.
4. If the sounds change later, bump `SOUND_PACK_TAG`, release the plugin, and upload the new zip under the new tag.

## Development

Requires Node.js 18 or newer.

```bash
npm install
npm run dev     # rebuilds main.js on every change
npm run build   # type-check and production build
npm run lint    # lint with Obsidian's ESLint rules
npm test        # store, persistence and timer-engine tests
```

For development, put the project folder in `<your vault>/.obsidian/plugins/`, run `npm run dev`, and reload Obsidian after changes.

## License

Licensed under the [Apache License 2.0](LICENSE).
