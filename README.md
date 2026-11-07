# YouTube Ad Blocker

A small Chrome Manifest V3 extension that blocks requests to selected ad hosts on YouTube pages, hides known ad placements, and skips or mutes player ads when YouTube exposes them in the page UI.

## Install

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this directory.
4. Reload any open YouTube tabs.

Use the extension icon to turn filtering on or off. It does not collect browsing data or send data to a server.

## Limits

YouTube changes its player and ad delivery regularly. This extension cannot guarantee removal of every ad. In particular, an ad delivered through the same video stream may be impossible to block without interrupting playback. The fast forward and mute behavior applies only while the player marks itself as showing an ad.

## Files

- `rules.json`: narrow network blocking rules for known ad domains.
- `content.js`: page ad hiding and player ad handling.
- `background.js`: synchronizes the network rules with the popup switch.
- `popup.html`, `popup.css`, `popup.js`: the switch UI.
