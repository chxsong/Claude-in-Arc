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

## Features

### Side Panel (Core)
Toggle Claude's panel with **Cmd+E** on any page. The panel injects as a resizable iframe with CSS-based layout squeezing so page content reflows naturally.

### Arc Folder Cross-Tab Collaboration
Claude can see and interact with all tabs in the same Arc folder. The panel can:

- **List group tabs** — see all tabs in the current folder with their titles and URLs
- **Read page content** — extract text from any tab in the folder
- **Read all group content** — pull content from every tab in the folder at once
- **Navigate tabs** — open URLs in specific tabs
- **Focus tabs** — switch to a specific tab
- **Broadcast messages** — send data to all tabs in the folder

This enables use cases like "summarize all the tabs in this folder" or "compare the content across these tabs."

The content script can send these messages to the service worker:
- `TAB_ORCH_LIST_GROUP_TABS` — list all tabs in the current Arc folder
- `TAB_ORCH_GET_PAGE_CONTENT` — extract text from a specific tab
- `TAB_ORCH_GET_ALL_GROUP_CONTENT` — extract text from all tabs in the folder
- `TAB_ORCH_BROADCAST` — send a message to all tabs in the folder
- `TAB_ORCH_NAVIGATE` — navigate a tab to a URL
- `TAB_ORCH_FOCUS` — switch to a tab

### Claude Desktop Connection
Connect the extension to Claude Desktop via Native Messaging for local capabilities.

**Setup:**
```bash
node scripts/register-native-host.js
```
This registers the native messaging host for Arc (and Chrome if not already registered). Requires Claude Desktop to be installed.

The content script can send these messages:
- `NATIVE_BRIDGE_STATUS` — check connection status
- `NATIVE_BRIDGE_CONNECT` — establish connection to Claude Desktop
- `NATIVE_BRIDGE_DISCONNECT` — close the connection
- `NATIVE_BRIDGE_CHECK` — ping Claude Desktop to verify it's running
- `NATIVE_BRIDGE_SEND` — send a message to Claude Desktop

## How It Works

The toolkit patches five modules into the Claude extension's service worker:

1. **Zoom Manager** (`zoom-service-worker.js`): Manages zoom levels and routes panel toggle commands
2. **Panel Injector** (`claude-panel-injector.js`): Injects a resizable side panel iframe into every page
3. **Viewport Override** (`viewport-override.js`): Overrides viewport width APIs so websites think the browser is narrower
4. **Tab Orchestrator** (`tab-orchestrator.js`): Cross-tab collaboration within Arc folders via `chrome.tabGroups`
5. **Native Bridge** (`native-bridge.js`): Native Messaging connection to Claude Desktop
