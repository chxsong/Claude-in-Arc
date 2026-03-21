# Claude-in-Arc
A deep patching toolkit designed to inject Anthropic's Official Claude Chrome Extension natively into Arc Browser's visual structure.

Because Arc doesn't officially support Chrome's `chrome.sidePanel` APIs natively yet, this script intercepts the extension's unpacked local files and re-wires them to run as an injected iFrame, matching Arc's aesthetic perfectly.

## Installation

This script automatically finds your active Claude Extension directory within Arc's User Data folder, safely backs up everything, and applies the injection patches. 

1. Ensure the **Official Claude Extension** is installed via the Chrome Web Store on Arc.

2. Clone or Download this repository.

3. Open Terminal, cd into this directory and run:

   ```bash
   node scripts/install.js
   ```

4. Once completed, navigate to `arc://extensions` in Arc.

5. Click the **Reload** button on the "Claude in Arc v0.1" extension.

6. Refresh any open tabs.

7. Use `Cmd+E` or the extension icon to toggle the panel!

## Uninstallation / Revert to Official

The installer always creates a `_backup` directory of the unmodified official extension before injecting files.
To revert, simply go to your extensions folder (`~/Library/Application Support/Arc/User Data/Default/Extensions/fcoeoabgfenejglbffodgkkbkcdhcgfn`), delete the latest patched version folder, and rename `1.0.xx_x_backup` back to `1.0.xx_x`. Reload the extension in Arc, and you are back to vanilla.

## TODO

- [ ] **Arc Folder Cross-Tab Collaboration:** Implement tab orchestration and cross-tab collaboration specifically within Arc's folder structure. We plan to explore workarounds to allow Claude to interact with multiple tabs seamlessly as long as they reside within the same Arc folder.
- [ ] **Claude Desktop Connection:** Establish a connection via Native Messaging to link the extension with the local Claude Code CLI and Claude Desktop application for advanced local capabilities.
