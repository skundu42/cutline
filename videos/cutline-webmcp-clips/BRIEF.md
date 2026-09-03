---
workflow: motion-graphics
flow: automation
storyboard: no
message: "Cutline gives people and WebMCP agents one safe, inspectable, reversible editing workflow"
destination: in-app-demo
aspect: 16:9
language: en
audience: WebMCP challenge reviewers and product users
length: six 10s clips
---

## Intent

Rebuild the six Cutline WebMCP demo clips from scratch as a consistent motion-graphics set. Each clip must communicate one product capability quickly while feeling like a native part of the editor.

## Assets

- `../../public/demo/webmcp-clips/manifest.json` - topic order and public filenames only.
- `../webmcp-demo-clips/src/scenes/` - factual copy reference only; do not reuse its layout or animation code.

## Customizations

- Use a full-bleed 16:9 canvas with a shared alignment grid across all six clips.
- Keep every essential item comfortably inside the canvas while filling the frame with video-scale type and diagrams.
- Use distinct, seek-safe animation for each capability and a consistent Cutline palette.

## Notes

- No baked player frame, nested rounded viewport, or decorative safe-area border.
- No narration or external media.
- Final public outputs must remain 1280x720 MP4, 30 fps, and exactly 10 seconds each.
