# FM SaveLens 24 icon

`app-icon.png` is the master artwork, created with the built-in ImageGen tool.
The charcoal tile, lime football lens, and large off-white **24** match the app.

Run `npm run build:icons` from the repository root to derive the desktop and
browser assets with the pinned Tauri CLI. Generated assets are checked in;
ordinary builds do not require an image-generation service. The image keeps
transparent rounded corners, so the web manifest uses `purpose: "any"`.

## Final artwork prompt

```text
Use case: logo-brand
Asset type: final FM SaveLens 24 desktop/browser app icon.
Edit target: supplied football-inside-a-magnifying-lens app icon.
Primary request: prominently integrate the exact numerals "24" into this app icon. Make "24" large, crisp, very bold geometric sans-serif, off-white #e9efec, in the lower-left of the dark tile, with numerals roughly one-third of the tile height. Resize and move the football-and-lime-magnifying-lens symbol toward the upper center as necessary to give the numerals their own clear charcoal area and keep the whole composition balanced. "24" must be immediately legible at 32 pixels, with thick stems and generous spacing; it is a main element, not a tiny badge. Preserve the recognizable football and magnifier.
Style and palette: clean minimal flat vector-like artwork; pale lime #c4ef75 lens and handle, off-white ball with large simple charcoal panels; charcoal #171e20 rounded-square tile; subtle deep forest connector. Keep generous safe inset.
Text (verbatim): "24"
Constraints: only the text "24", no other words or numerals. No watermark, no fine decorative details, no photorealism, no mockup. Preserve actual transparent alpha-zero pixels outside all four rounded tile corners. Transparent PNG, square app icon.
```

The final transparency correction used:

```text
Use case: logo-brand. Remove the background outside the dark rounded-square app tile. Make the four corners fully transparent, alpha zero. Preserve the dark tile, the large off-white "24", and the pale lime magnifying-glass soccer-ball icon exactly. Return a transparent PNG.
```
