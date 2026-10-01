# Framify Elementor: Flow shapes, Custom shape, grain in Clip mode

Date: 2026-09-26
Status: design approved, awaiting spec review
Builds on: `2026-09-26-framify-wavy-shapes-design.md` (implemented: Wavy family, Flat edge, responsive Placement, Trigger auto/none, Float)

## Goal

1. **Flow family.** Six built-in shapes with the character of the four reference SVGs the user likes: hand-drawn feeling, big asymmetric sweeps, deep dips, one straight side. These are original shapes, safe to ship in Framify on every site. None of the reference paths are copied.
2. **Custom shape.** On a given site, paste SVG code from any design tool into the element and use it as the shape. Static (no morph).
3. **Grain in Clip mode.** This lets the reference "Jack Russell / Boxer" compositions be built live in Elementor: a Container cut to the shape, with a textured colour fill and cut-out photos inside it clipped at the shape's edge.

Plus housekeeping from the final review of the previous spec.

## 1. Flow family

### Geometry (PHP)

- **`flow_presets()`:** `id => array( 'title', 'rest' => points, 'hover' => points )`.
  - Points are hand-placed `array( x, y )` anchors in the 0-100 box.
  - The anchors run from the top-right corner `(100, 0)` round the free side to the bottom-right corner `(100, 100)`, in the same orientation as Wavy anchored.
- **Anchor rules:**
  - The first and last anchors are exactly `(100, 0)` and `(100, 100)`.
  - There are 8 to 14 anchors, with the same count in rest and hover.
  - Every anchor lies inside the box.
- **Building the path:** `flow_path( $points )` passes the points to the existing `smooth_path( $points, false )`, so Z closes with a straight right edge. No new curve code.
- **Output:** `shape_paths()` adds `id => array( 'family' => 'flow', 'rest', 'hover' )`. There is no `free` variant.
- **Picker:** Flow thumbnails are drawn wide, like Wavy (`translate(0 15) scale(1 0.7)`). Flow ids follow the Wavy ids.
- **`flow_ids()`:** returns `array_keys( flow_presets() )`.

### Six presets (design intent; exact anchors are tuned on screen)

| id | Title | Character |
|---|---|---|
| `brook` | Brook | Deep dip in the top edge at about 55% width, bulging lower-left, long S along the bottom |
| `breeze` | Breeze | Top rises then falls, pinched waist on the left, soft bottom sweeping up to the right corner |
| `meadow` | Meadow | Broad hump top-left, dip mid-top, round bottom-left, wave rising along the bottom |
| `lagoon` | Lagoon | Low top-left shoulder, strong concave notch mid-bottom |
| `harbor` | Harbor | Tall bulge on the left, top edge dipping twice |
| `glade` | Glade | Two cloud-like humps on top, flat-ish S along the bottom |

- **Hover poses:** the same anchors nudged by at most about 6 box units, so the dips visibly drift without the shape changing identity.
- **Quality bar** (frontend-design):
  - No kinks or pointed tips.
  - No self-intersection.
  - Each shape distinct from the others.
  - Fills a photo crop generously; the shape should not shrink to an island.
  - Checked side by side against the user's reference compositions (Boxer / Jack Russell) for character, not geometry.

### Flat edge for Flow (JS)

- **Explicit settings:** Flow uses the Wavy edge transforms (`left` / `top` / `bottom`; `right` = identity).
- **"None":** Flow has no free variant, so `none` falls back to `right`. The Flat edge control's description says: "Flow shapes always keep one straight side."

### Auto edge fix (applies to Wavy and Flow)

`resolveEdge( family, setting, box )` now takes the whole placement box instead of only `ax`:

- `blob` and `custom` always return `none`.
- An explicit `setting` (not `auto`) is used as-is, except that Flow + `none` becomes `right`.
- `auto`:
  - `touchesLeft = box.x <= 0.001`
  - `touchesRight = box.x + box.w >= 0.999`
  - With `ax < 0.25` and `touchesLeft`, the edge is `left`.
  - With `ax > 0.75` and `touchesRight`, the edge is `right`.
  - Otherwise Wavy gets `none`. Flow gets `right` if `touchesRight`, else `left` if `touchesLeft`, else `right`.
- Every call site passes the box. That means the main shape in `setup()` / `place()` and the Image widget's deco in `setupImage()` / `place()`.

## 2. Custom shape

### Controls (PHP)

- **Shape picker:** `framify_org_shape` gets a final `custom` option titled "Custom", with a thumbnail of a dashed outline.
- **Deco picker:** the Image widget's deco shape picker does NOT get `custom`. `shape_options( $with_custom )` builds both lists.
- **Paste box:** `framify_org_custom_svg` is a TEXTAREA, `live()`, with the condition `$on + array( 'framify_org_shape' => 'custom' )`.
  - Label: "SVG code or path".
  - Placeholder: `<svg viewBox="0 0 1200 800"><path d="..."/></svg>`.
  - Description: "Paste an SVG from any design tool, or just its path data. Only the path is used; transforms inside the SVG are ignored."
- **Flat edge:** its condition is unchanged (Wavy and Flow ids only), so it is hidden for Custom.

### Parsing (JS, `parseCustom( text )`)

1. Trim, and cap the input at 50,000 characters. Anything longer is ignored and the effect is not applied.
2. **Path data:**
   - If the text contains `<`, collect every `d="..."` / `d='...'` value.
   - Otherwise treat the whole text as one path.
   - Keep only values matching `^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$`, and join them with a space. Several paths become one clip shape.
3. **Coordinate box:**
   - Use `viewBox="x y w h"` if present.
   - Otherwise use numeric `width` / `height` attributes with the origin at 0,0.
   - Otherwise measure: draw the path in a hidden, zero-size SVG, call `getBBox()`, then remove it.
   - A zero or invalid width or height means the shape is rejected.
4. **Result:** `{ d, box }` on success, otherwise `null`.
5. **Caching:** memoise by the input string so each element parses once per distinct paste.

Security: only the validated `d` string reaches the DOM, through `setAttribute( 'd', ... )`. Pasted markup is never inserted.

### Rendering

- **Normalising:** the custom path is fitted into the 0-100 box with `scale( 100/w 100/h ) translate( -x -y )`. This takes the place of the edge transform in the transform chain, both for the clip (`clipTransform`) and for the deco path's `transform`.
- **Family `custom`:**
  - The edge is always `none`.
  - The pair is `rest === hover`, the same parsed path, so the existing morph code runs but changes nothing.
  - Trigger `auto` resolves to `none`.
  - An explicit hover, in-view or loop trigger still drives the image zoom.
- **Invalid or empty paste:** no effect is applied, just as for an unknown shape. In the editor, `console.warn` once per element: "Framify: custom shape has no usable path."
- **Where it works:** Image widget clip, Container clip, and Container deco. Not the Image widget's deco.

## 3. Grain in Clip mode

- **Control:** `framify_org_clip_grain`, a SWITCHER, `live()`, default `''`.
  - Label: "Grain texture".
  - Condition: container + `framify_org_enable` + `framify_org_mode` = `clip`.
  - A separate control from the deco grain, because grain over a background photo is rarely wanted, so off is the right default here.
- **JS, container clip branch, when it is on:**
  - Insert a grain layer as the container's first child.
  - The layer is an `<svg class="framify-organic__deco framify-organic__grain">` at left/top 0 and 100% x 100%, with `preserveAspectRatio="none"`.
  - It holds one full-size `<rect>` whose filter outputs only the white specks (no source fill), so the container's own background colour shows through.
- **Stacking:** add `framify-organic-container`, and `position: relative` if the container is static; the existing deco-mode cleanup handles both. The existing CSS `.framify-organic-container > .framify-organic__deco { z-index: -1 }` with `isolation: isolate` puts the layer above the background and below the children. The container's clip-path cuts everything to the shape.
- **Shared filter:** extract a `buildGrainFilter( filterId, specksOnly )` helper from `buildDeco`, used by both the deco blob and this layer.
  - `specksOnly = false`: merge the source graphic and the specks, as today.
  - `specksOnly = true`: output the composited specks only.

## 4. Housekeeping (from the previous final review)

- `clipTransform`: call `edgeTransform( edge )` once.
- `dev/tests/elementor-shapes-test.php`:
  - Take the Wavy id list from `wavy_presets()` keys.
  - Drop the needless `method_exists` guards.
  - Add equivalent checks for Flow.
- Remove the redundant `window` `resize` listener in `observeLayout()`; the ResizeObserver already covers resizes. Keep the `load` listener.
- `CLAUDE.md`, Elementor module section:
  - Document the Flow family.
  - Document Custom shape parsing and its security rule.
  - Document clip grain.
  - Document the Auto edge rule.
  - Note that `dev/` is development-only and can be left out when copying the plugin to a live site.
  - Note the assumption that `DEFAULT_SHAPE` must stay a Blob.

## Error handling and edge cases

- **Unknown shape id:** falls back as today.
- **`custom` with an invalid paste:** no effect (see section 2).
- **Flow + `none`:** becomes `right`.
- **Settings left out of `data-settings`:**
  - A missing `framify_org_clip_grain` means off.
  - A missing `framify_org_custom_svg` means an invalid paste, so no effect.
- **Custom SVG with transforms or `<use>` elements:** the transforms are ignored and `<use>` is not followed, as documented in the control description.
- **Reduced motion:** unchanged; rest shape only, no Float.

## Testing

Tests run on Aberdeen local through the Framify junction.

- **Page 145:** it is **published**. Its latest content lives in an autosave, so use the editor's `urls.wp_preview` link for previews.
- **Test SVGs:** only our own sample SVGs, never the reference files.
- **Env note:** in this environment, create one element per `document/elements/create` call.

1. **CLI:** `php dev/tests/elementor-shapes-test.php` adds these Flow checks:
   - there are six ids
   - rest and hover can morph (same path skeleton)
   - the path starts at `M100.00 0.00`
   - the path ends at `100 100`
   - the numbers stay within -3..103
   - the picker offers 21 main shapes: 8 Blob + 6 Wavy + 6 Flow + Custom
   - the picker offers 20 deco shapes
2. **`--preview` grid:** includes Flow. Screenshot it for the frontend-design review against the reference character, and tune the anchors until the quality bar is met.
3. **Browser, page 145, new elements:**
   - `fo-flow-r`: Image, Brook, align right, hover. The straight edge is flush, and it stays flush while zoomed.
   - `fo-flow-auto-in`: Image, Breeze, align right, width 80, offset X -10, so the box touches neither side. The Auto edge must be `right` (a Flow fallback), but a Wavy shape with the same settings must give `none`. Add `fo-wavy-auto-in`, Tide with the same placement, to check this.
   - `fo-custom-vb`: Image, custom, sample SVG with a `viewBox`. The clip transform contains the normalising scale, and a hit-test inside the shape's bounds passes.
   - `fo-custom-novb`: the same path with no viewBox and no width/height. Check the `getBBox` fallback.
   - `fo-custom-bad`: the paste `<svg><rect/></svg>`. No clip is applied, the editor shows one warning, and there are no errors.
   - `fo-jr`: Container, clip mode, Flow Meadow, background `#F2C53D`, clip grain on, with one image child. The grain layer exists, sits under the child (`elementFromPoint` on the child hits the image), and is clipped with the container.
   - The console shows no errors, apart from the expected single warning.
4. **Editor:**
   - Pasting into the Custom box updates the preview live.
   - Switching to a Flow shape shows Flat edge.
   - Switching to Custom hides it.
   - Nothing is saved from these UI experiments.
5. **ASCII check** of the changed files, using the Grep tool with `[^\x00-\x7F]`.

## Out of scope

- A morph for Custom shapes.
- Custom shapes for the Image widget's deco blob.
- A free (no flat edge) Flow variant.
- Copying the reference SVGs.
