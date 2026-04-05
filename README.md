# Claude-in-Arc

A deep patching toolkit that injects Anthropic's Official Claude Chrome Extension natively into Arc Browser's visual structure.

Arc doesn't support Chrome's `chrome.sidePanel` APIs, so this toolkit intercepts the extension's local files and re-wires them to run as an injected iframe panel, matching Arc's aesthetic.

## Installation

1. Install the **Official Claude Extension** from the Chrome Web Store in Arc.

2. Clone this repository:
   ```bash
   git clone https://github.com/realzachsmith/Claude-in-Arc.git
   cd Claude-in-Arc
   ```

3. Run the install script:
   ```bash
   node scripts/install.js
   ```

   The script automatically detects your Arc profile and finds the Claude extension. If you have multiple profiles, it picks the most recently active one.

   To target a specific profile:
   ```bash
   node scripts/install.js --profile="Profile 1"
   ```

4. Open `arc://extensions` in Arc.

5. Click **Reload** on "Claude in Arc v0.1".

6. Refresh any open tabs.

7. Use **Cmd+E** or the extension icon to toggle the panel.

## Uninstallation

To revert to the original unpatched extension:

```bash
node scripts/uninstall.js
```

Then reload the extension in `arc://extensions` and refresh your tabs.

## Re-patching After Updates

When Anthropic updates the Claude extension, you'll need to re-run the install script:

```bash
node scripts/install.js
```

The script always restores from backup before patching, so it's safe to run multiple times.

## Troubleshooting

**Extension not visible in arc://extensions:**
This is fixed in this version. The install script removes content verification hashes that would otherwise cause Arc to hide the patched extension.

**"Could not find Claude extension" error:**
- Make sure the Claude extension is installed from the Chrome Web Store
- Try specifying your profile: `node scripts/install.js --profile="Default"`
- Check which profiles exist: `ls ~/Library/Application\ Support/Arc/User\ Data/`

**Panel doesn't appear after Cmd+E:**
- Reload the extension in `arc://extensions`
- Refresh the page
- Check the browser console for `[Claude Panel Injector]` log messages

**Panel overlaps page content:**
The panel uses CSS-based layout squeezing. If a specific site doesn't squeeze correctly, open an issue with the URL.

## How It Works

The toolkit patches three layers into the Claude extension:

1. **Service Worker** (`zoom-service-worker.js`): Manages zoom levels and routes panel toggle commands
2. **Content Script** (`claude-panel-injector.js`): Injects a resizable side panel iframe into every page
3. **Main World Script** (`viewport-override.js`): Overrides viewport width APIs so websites think the browser is narrower, triggering correct responsive layouts

## TODO

- [ ] **Arc Folder Cross-Tab Collaboration:** Tab orchestration within Arc's folder structure
- [ ] **Claude Desktop Connection:** Native Messaging link to Claude Code CLI and Claude Desktop
