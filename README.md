# Claude in Arc

A deep patching toolkit designed to inject Anthropic's Official Claude Chrome Extension natively into Arc Browser's visual structure.

Because Arc doesn't officially support Chrome's `chrome.sidePanel` APIs natively yet, this project intercepts the extension's unpacked local files and re-wires them to run as an injected iFrame, matching Arc's aesthetic perfectly.

## What's New in v0.3

- **Rebased onto the official Claude for Chrome `1.0.77` base** (was `1.0.66`), bringing Mermaid diagram rendering, KaTeX math, and the Slack / Google Docs / Sheets / Slides / Outlook connectors to the Arc side panel.
- **Expanded the Arc bridge interceptor** so far more MCP browser tools work without Chrome's Debugger Protocol (which Arc blocks). On top of tabs / navigate / screenshot, the patched build now handles `javascript_tool`, `read_page`, `find`, `form_input`, `read_console_messages`, and full `computer` actions (wait / scroll / zoom plus best-effort click / type / key). The interceptor runs tool calls through Arc-safe `chrome.scripting` / `chrome.tabs` APIs instead of CDP, so fully DOM-driven automation is possible with no screenshots required.
- **Known Arc limits** (these genuinely need the Debugger Protocol, which Arc blocks): `file_upload`; in-page `eval` is blocked on strict-CSP sites such as Gmail, so `javascript_tool` won't run there; and a screenshot of a non-foreground tab can be a stale frame, so verify background tabs with `read_page` / `javascript_tool` instead.

## What's New in v0.2

- Added **View Mode** selection — switch between two sidepanel injection modes: Squeeze (Default) and Overlay (iFrame)
- Established connection with Claude Desktop via Native Messaging
- Bug fixes

![View Mode setting location](view-mode.png)

## Installation

Download the ZIP from [Releases](https://github.com/chxsong/Claude-in-Arc/releases), or download the `1.0.77_0` folder directly from this repository and load it as an unpacked extension. (The previous `1.0.66_0` build remains in the repo for reference.)

## Uninstallation

Go to `arc://extensions` and click **Remove Extension**.
