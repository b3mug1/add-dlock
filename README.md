# YouTube Ad Blocker

A small Chrome Manifest V3 extension that blocks requests to selected ad hosts on YouTube pages, filters known ad fields from player responses, hides known ad placements, and skips or mutes player ads when YouTube exposes them in the page UI.

## Install

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this directory.
4. Reload any open YouTube tabs.

Use the extension icon to turn filtering on or off, pause filtering in the current tab, or exempt the current video or channel. The popup shows counts of hidden ad elements and player ads handled, plus a diagnostic summary. Settings and counts stay in local browser storage; the extension does not send them to a server.

## Limits

YouTube changes its player, ad delivery, and blocker checks regularly. This extension cannot guarantee removal of every ad or prevent blocker warnings. In particular, an ad delivered through the same video stream may be impossible to block without interrupting playback. The fast forward and mute behavior applies only while the player marks itself as showing an ad.

## Files

- `rules.json`: narrow network blocking rules for known ad domains.
- `content.js`: page ad hiding and player ad handling.
- `inject.js`: filters ad fields from player data in the page's main world.
- `background.js`: synchronizes network rules and per-tab exceptions with popup settings.
- `icons/`: extension icons at Chrome's standard sizes.
- `popup.html`, `popup.css`, `popup.js`: the switch UI.
