# ReplyKit — Smart Quick Replies

A premium Chrome extension that brings a beautifully crafted quick-reply toolkit to Facebook. Save your most-used messages, organize them by category, and paste them in a click — with fuzzy search, dynamic variables, and keyboard shortcuts.

## Features

- **Categories** — Group templates by topic (general, support, sales, etc.) and switch with tabs.
- **Fuzzy search** — Find the right reply instantly, even with partial or misspelled queries.
- **Dynamic variables** — Use `{firstName}`, `{date}`, `{time}`, and `{clipboard}` placeholders that expand at paste time.
- **Keyboard shortcut** — Toggle the on-page panel with `Ctrl+Shift+R` (`⌘+Shift+R` on macOS).
- **Light & dark themes** — One-tap theme switch in the popup.
- **Import / export** — Back up your library as JSON, or seed it with sample replies.
- **Chrome sync** — Templates roam with your Google account via `chrome.storage`.

## Installation (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/biplab85/ReplyKit.git
   ```
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `ReplyKit` folder.
5. Pin the ReplyKit icon to your toolbar for quick access.

## Usage

1. Click the **ReplyKit** icon to open the popup.
2. Type a template into the composer, pick a category, and hit **Save reply**.
3. On any Facebook page, press `Ctrl+Shift+R` to open the on-page panel and click a reply to paste it into the active message box.
4. Use the search bar to filter replies on the fly.

### Variables

| Variable      | Expands to                                  |
| ------------- | ------------------------------------------- |
| `{firstName}` | The first name of the current chat partner  |
| `{date}`      | Today's date                                |
| `{time}`      | Current time                                |
| `{clipboard}` | The current clipboard contents              |

## Project Structure

```
ReplyKit/
├── manifest.json     # Chrome MV3 manifest
├── popup.html        # Extension popup UI
├── popup.css         # Popup styles
├── popup.js          # Popup logic (templates, categories, import/export)
├── content.js        # Content script injected into facebook.com
├── content.css       # Styles for the on-page panel
├── icons/            # SVG icons (16/32/48/128)
└── test.html         # Local testbed
```

## Permissions

- `storage` — Save and sync your reply library.
- `clipboardRead` — Resolve the `{clipboard}` variable when pasting.
- Host access to `*.facebook.com` for the content script.

## Tech

- **Manifest V3** Chrome extension
- Vanilla JavaScript, HTML, and CSS — no build step required
- Chrome Storage API for persistence

## Version

**v2.0.0**

## License

MIT
