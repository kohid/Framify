# Framify: Container clip bleed, Deco Blob on Containers, Shape Divider

Date: 2026-09-28. Status: approved by the user in conversation.

## A0. Container clip: outward motion is cut flat (bug)

Reproduced on the test page: nested container 98f6625 (Clip whole
container, Custom shape, Gentle Strong, Loop) is cut in straight lines at
its left, top and right edges. The Gentle swell / Liquid ripple reaches past
the container box, but the container's background ends at the box, so the
clip has nothing to reveal there. Same root cause as the Spacer (fixed with
an oversized fill layer).

Fix ("bleed"): keep the clip-path on the container (so content stays
clipped: clip-path is not bounded by the border box, it shows whatever
paints inside the clip region, including outside the box), and move the
container's background into an oversized fill layer inside it (the
Spacer's fill: copied computed background, host background suppressed,
margin M, background positions anchored, radii grown). The shape stays
mapped to the container box. Elementor's background overlay (::before) and
background video / slideshow layers must bleed too (extend them by M, e.g.
via a CSS variable and a class on the host), or they would still end
flat at the box.

Applies only when the clip can reach outward: Container clip mode with a
Custom shape and moving Liquid / Gentle motion. Every other clipped
container keeps today's path byte for byte (same clip-path strings, no
fill). The editor handle fix (keepHandle) keeps working.

## A. Deco Blob section on every Container (Clip mode)

- Panel: a separate "Deco Blob" section after Organic Shape, shown when Mode
  is Clip whole container, exactly the Image widget / Spacer section
  (register_deco_controls variant as the Spacer's clip-mode section: shape,
  style solid/outline, colour, placement, flip/rotate, own motion). Deco
  mode unchanged (the shape is the blob). All Containers, top-level and
  nested. Legacy Sections out of scope.
- Rendering with the Deco Blob on: the Spacer model: the background is
  copied into a clipped, oversized fill layer, the blob sits behind it,
  the container itself is not clipped, so content is no longer cut at the
  shape's edge. Deco Blob off: Clip as today (or A0's bleed when it
  applies).
- Grain: containers in Clip mode with the deco on get the Image-style
  target (blob / fill / both / none) or the Spacer's equivalent, whichever
  the Spacer uses; reuse it.
- Works with Floating Shapes, Floating Text, Float (nested), editor handle
  fix.

## B. Framify Shape Divider on top-level Containers

- Panel: "Shape Divider" section on the Framify tab, top-level containers
  only (hidden on nested ones in the editor like Float; runtime ignores it
  on .e-child). Top and Bottom tabs, each:
  - Source: SVG code or path | Media Library (MEDIA control, SVG only)
  - Colour (shapes only, filled with it)
  - Width 100-300% (responsive), Height px (responsive)
  - Flip horizontally, Upside down, Bring to front
  - Motion: Static | Liquid ripple (Loop / In view / Hover), amount
    Subtle / Normal / Strong; the side touching the section edge is pinned.
- Safety: code and uploaded SVG go through the Custom-shape sanitiser rule:
  only geometry becomes path data (path, and rect / circle / ellipse /
  line / polyline / polygon converted), transforms and the viewBox are
  applied to the data; markup is never inserted (no script, style, image,
  foreignObject, event attributes). Media SVG is fetched same-origin only.
  Panel note: SVG uploads need Elementor's "Enable Unfiltered File Uploads".
- Rendering: JS (live in the editor), an absolutely positioned svg at the
  container's top or bottom edge, preserveAspectRatio none, pointer-events
  none, above the background (below content unless Bring to front).
  Coexists with Elementor's own Shape Divider (they overlap on the same
  edge).

## Plan

1. Part A0 + A (framify-elementor.php/.js/.css): bleed path; Deco Blob
   section + fill path on containers; tests; browser checks on 98f6625,
   4e00dc5, fo00006 and a container with the deco turned on in the editor
   (unsaved).
2. Part B (new module files framify-elementor-divider.php +
   assets/framify-divider.js/.css, loaded like the shapes/text modules;
   shared sanitiser reused from framify-elementor.js if exposed, else
   factored into FramifyFx): tests incl. sanitiser strips script / on* /
   image / foreignObject; browser: path + media SVG, top/bottom, flips,
   bring to front, Liquid with pinned edge, hidden on nested containers.
3. Code review, fix, report.

## Testing

CLI suite ALL PASSED with new checks; real Chrome via the Playwright node
library, editor changes unsaved; front end of every untouched element
identical; 0 errors. Never save or publish page 145. No zip.

## Implementation notes (A0/A)

- A0 bleed (assets/framify-elementor.js `bleedLayers`, `bleedVars`): gate
  `fx.bleed = ! spacer && clip mode && custom && fx.motion` (so reduced
  motion, static / Auto custom shapes, built-in shapes and the deco-on path
  never bleed). The host keeps its clip (and keepHandle); the fill is
  unclipped, grain goes inside it; the clip box is not remapped.
- Overlay / video / slideshow: class `framify-organic-bleed` plus
  `--framify-bleed-t/r/b/l` and `-tl/tr/br/bl` (fill margins and grown
  radii) extend `.e-con::before`, the slideshow and the video container in
  framify-elementor.css. Elementor has no background `::after`. Not bled:
  Pro background Motion Effects, the hover background (suppressed as on
  the Spacer), a border (stays at the box edge).
- Found while testing: a fill reaching past the page's left / right edge
  adds a horizontal scrollbar (clip-path does not trim scrollable
  overflow). Container fills (bleed and deco) use a per-side margin
  (`fillSides`) that stops at the document's left / right edge; the Spacer
  keeps its single number, byte for byte. Container fills also re-copy
  when Elementor's lazy-loaded background arrives (`watchLazy`).
- A: Containers use the Spacer's Deco Blob section (`register_deco_controls`
  variant renamed 'spacer' -> 'block'; the 'container' variant and
  `framify_org_deco_heading` are gone). The section shows whenever the shape
  is on, because the shared look controls also style Behind content mode
  (one id, one registration), so in that mode they moved from Organic Shape
  to Deco Blob; rendering there is unchanged. Grain: the Spacer's switches
  (clip grain keeps the container wording). Clip + deco on routes to
  `setupFill()` (the Spacer path); containers rebuild the fill on
  `CONTAINER_FILL_KEYS`.
- Verified: CLI ALL PASSED; Spacer / Image panels identical to the snapshot
  (md5 of the registered controls); front end before (snapshot routed) vs
  after: static clip strings identical, motion clip urls and fill counts
  identical except the two bled containers, 0 errors, scrollWidth 1366 =
  clientWidth; 98f6625 and 4e00dc5 (hovered) now show the shape past the
  box (0 before). Editor (unsaved): deco on / off, section order, handle,
  overlay bleed.

## Implementation notes (B)

- Files: framify-elementor-divider.php (hooked on the container at 50, after
  Float), assets/framify-divider.js / .css, loaded from framify.php after
  the text module. Control ids `framify_org_dv_{top|bottom}_*` (Top / Bottom
  controls tabs); the Organic handler skips that prefix. Source adds a
  "None" option (default) as the off state. Width / Height are CSS
  selectors (responsive, no rebuild); everything else is live().
- Sanitiser: `FramifyOrganicShape.parseSvgShape` in framify-elementor.js
  (DOMParser image/svg+xml, detached; geometry whitelist; transforms and
  viewBox baked into number-built M/L/C/Z path data). Bare path data or
  non-XML markup falls back to parseCustom. Each source shape is painted as
  its own path (overlaps with opposite windings cut holes in one path).
- Orientation follows Elementor: art drawn for the top edge, Bottom rotates
  it 180deg. Pinned side = art top, or art bottom when Upside down, plus
  both ends (pinDistance now takes a list). Liquid: traced curve clamped to
  the pinned lines (corner overshoot) and viewBox 4 0 92 100 (end curl).
- Media: the MEDIA value's url, fetched only same-origin. The test site has
  no SVG in its Media Library, so the media path was tested with an SVG
  shipped in Elementor (plugins/elementor/assets/shapes/mountains.svg) set
  as the control value in the editor; a real upload was not tested.
- Verified: CLI ALL PASSED (incl. node sanitiser test); editor (unsaved)
  on fo00001 and nested 98f6625; front end identical to the page with the
  divider files blocked, 0 errors, no scrollWidth change.
