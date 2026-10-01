# Framify Elementor: Wavy shapes, Placement, Float

Date: 2026-09-26
Status: design approved, awaiting spec review
Extends: `framify-elementor.php`, `assets/framify-elementor.js`, `assets/framify-elementor.css` (Organic Shape module, Framify 1.7.0)

## Goal

Reproduce two looks from the Pawsitive "Buddy" demo (pawsitive.bold-themes.com/buddy) with Elementor, reusable on any site running Framify:

1. **Wavy photo**: a photo cropped to a wide, hand-drawn-looking wave shape with one straight side, so it can bleed off the page edge.
2. **Yellow backdrop**: a large grainy colour shape behind a Container, with PNG objects (ball, bowl, stick) sitting over it and spilling past it, gently bobbing.

Reference findings:
- The demo's wavy photos use a static CSS `mask-image` with its own SVGs.
- The yellow image is a single pre-composed PNG, not an effect.

We build our own shapes and **do not copy the demo's SVG paths**, because they are Bold Themes' assets.

## Scope

In scope:
- **Wavy shape family** in the existing Shape picker (Image widget and Container), usable for clip and deco.
- **Flat edge** control for Wavy shapes.
- **Placement** group, with responsive values:
  - for the main shape
  - separately for the Image widget's deco blob
- **Trigger "None (static)"** plus an "Auto" default.
- **Float** effect on every widget.

Out of scope:
- New rendering paths such as CSS `mask-image`.
- Custom or uploaded shapes.
- Shape grouping UI. `VISUAL_CHOICE` has no option groups, so Wavy thumbnails follow the Blobs in one list; their wide, flat-sided thumbnails make the families visually distinct.

Compatibility: the module is not deployed anywhere except the Aberdeen local test page 145. So controls may be renamed and old values dropped with no migration.

## 1. Wavy shapes

### Geometry (PHP)

A new builder generates Wavy shapes in the same 0-100 box as Blobs, in two variants per shape.

**Anchored variant (canonical flat edge = right)**
- **Outline:** the free outline is half of a superellipse centred on (100, 50), with rx = 100, ry = 50 and exponent about 4. This gives a rounded-rectangle feel that fills the box like the reference.
- **Sampling:** the outline is sampled at `WAVE_POINTS` (16) positions, with s running from 0 at (100, 0) to 1 at (100, 100).
- **Waves:** each sample is pushed inward by `inset + env(s) * (a1*sin(2*pi*f1*s + p1) + a2*sin(2*pi*f2*s + p2))`.
  - The envelope `env(s) = sin(pi*s)` pins both ends to the corners, so the right edge stays perfectly straight.
- **Smoothing:** samples are smoothed with the existing Catmull-Rom conversion in open form (end points duplicated), then closed with a straight line back to (100, 0).

**Free variant (Flat edge = None)**
- The outline is a full superellipse centred on (50, 50), rx = ry = 50.
- It is sampled at 16 positions with periodic waves (no envelope) and closed with the existing `build_path()`.

**Presets and morphing**
- Each preset holds `rest` and `hover` parameter sets.
- Hover shifts phases and amplitudes only. So rest and hover share point count and path structure, which is what the existing number-blending morph needs.
- There are 6 presets: Tide, Ripple, Dune, Current, Swell, Shore. Values are tuned on screen during implementation; low-frequency waves only (f of 1.5 to 3), per the "no lemon points" lesson already recorded in the module docblock.

**Output**
- `shape_paths()` gains `family` (`blob` or `wavy`) and, for Wavy, a `free` pair: `{ family, rest, hover, free: { rest, hover } }`.
- Thumbnails show the anchored variant.

### Flat edge (JS)

- **Control:** `framify_org_edge`, a SELECT with the values `auto`, `none`, `left`, `right`, `top` and `bottom`.
  - It is shown only when the selected shape is Wavy: the condition lists the Wavy ids.
- **Default `auto`:** follows the horizontal position. Left gives a left edge, Right gives a right edge, Center gives `none`.
- **`none`** uses the `free` pair.
- **Other edges** use the anchored pair with an SVG `transform`, applied to the path inside the 0-100 box so the path numbers stay blendable:

  | Edge | Transform |
  |---|---|
  | right | identity |
  | left | `translate(100 0) scale(-1 1)` |
  | top | `rotate(-90 50 50)` |
  | bottom | `rotate(90 50 50)` |

  The box is square before objectBoundingBox or `preserveAspectRatio="none"` stretches it, so rotation is safe.
- **Blobs** ignore the Flat edge setting.

## 2. Placement

### Controls

Placement controls are responsive (`add_responsive_control`) and write CSS custom properties on `{{WRAPPER}}` through `selectors`, with `render_type: 'ui'`. Elementor then resolves the per-device values, and the JS reads the computed variables.

| Control | Type | CSS variable | Values |
|---|---|---|---|
| `framify_org_align_x` | CHOOSE (left / center / right icons) | `--framify-ax` | 0 / 0.5 / 1 |
| `framify_org_align_y` | CHOOSE (top / middle / bottom) | `--framify-ay` | 0 / 0.5 / 1 |
| `framify_org_width` | SLIDER, % | `--framify-w` | 20 to 150 |
| `framify_org_height` | SLIDER, % | `--framify-h` | 20 to 150 |
| `framify_org_offset_x` | SLIDER, % | `--framify-ox` | -50 to 50 |
| `framify_org_offset_y` | SLIDER, % | `--framify-oy` | -50 to 50 |

- **Image widget deco:** a second identical set with the `framify_org_deco_` prefix and `--framify-deco-*` variables. These replace the current `framify_org_deco_size`, `_x` and `_y`.
- **Container deco mode:** uses the main set.

Defaults, which match today's look:

| Target | Align | Width x height | Offset |
|---|---|---|---|
| Image clip | center / middle | 100 x 100 | 0 / 0 |
| Image deco | center / middle | 108 x 108 | 6 / 6 |
| Container (either mode) | center / middle | 100 x 100 | 0 / 0 |

### Geometry (JS)

One function turns the variables into a rectangle in the target box, in fractions of it:

```
w = W/100, h = H/100
x0 = (1 - w) * ax + ox/100
y0 = (1 - h) * ay + oy/100
```

- **Clip:** the path transform becomes `translate(x0 y0) scale(w/100 h/100)`, then the edge transform (all in objectBoundingBox units).
- **Zoom compensation:** zoom generalises from centre-only to an origin O:
  - O is the flat edge's midpoint, or the centre for Blobs and `none`.
  - The image's `transform-origin` is set to O.
  - The clip is wrapped as `translate(O) scale(1/z) translate(-O)`, so a gap never opens along the straight side.
- **Deco:** the SVG is positioned with the same rectangle.
  - Image widget: relative to the `<img>` layout box, as the current `place()` does.
  - Container: relative to the container.
  - Its path gets the edge transform.
- **When it runs:** the placement is recomputed on setup, on `ResizeObserver` (element and img), and on the existing debounced `onElementChange` rebuild.
  - The rebuild must also fire for the new responsive control ids (`_tablet` / `_mobile` suffixes); they already start with `framify_org_`.
  - Crossing a breakpoint re-resolves the CSS variables, and the ResizeObserver fires, so the geometry follows.

## 3. Motion changes

- **Trigger options:** `auto` (new default), `none`, `hover`, `inview`, `loop`.
  - `auto` means hover for Blobs and none for Wavy, because Elementor cannot vary a control's default by another control.
- **`none`:** renders the rest shape and binds nothing.
- **Hiding motion settings:** Spring, Duration and Zoom are hidden when the trigger is `none`.
  - They can't be hidden conditionally for `auto` + Wavy. Their help text says static shapes ignore them.

## 4. Yellow backdrop recipe

No new mechanism. Container > Framify > Organic Shape on:
- Mode: Deco
- Shape: a Wavy preset
- Grain: on
- Colour: any (the demo's yellow is about `#F2C53D`; the brand orange is `#F69216`)
- Placement: for example Right, 90 x 110

Children are Image widgets with transparent PNGs, positioned with Elementor's Advanced > Position. The deco already sits at z-index -1 inside an `isolation` context and does not clip children.

## 5. Float (every widget)

- **Hook:** `elementor/element/common/_section_responsive/after_section_end` adds a "Float" section to the Framify tab.
  - On most widgets the tab is created here and appears last.
  - On the Image widget it joins the existing tab.
- **Controls:**
  - `framify_float` (SWITCHER, `prefix_class: 'framify-float-'`)
  - Distance: px, 2 to 60, default 12
  - Duration: s, 1 to 12, default 4
  - Delay: s, 0 to 5, default 0
  - Rotate: deg, 0 to 15, default 0
- **CSS variables:** the numeric controls use `selectors` to write `--framify-float-d`, `-t`, `-delay` and `-r` on `{{WRAPPER}}`.
- **Pure CSS in `framify-elementor.css`:**
  - `.framify-float-yes` runs a keyframe animating the individual **`translate` and `rotate` properties**, not `transform`.
  - This way it composes with Elementor's own Transform and Motion Effects instead of overriding them.
  - The animation is ease-in-out, alternate and infinite.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` sets `animation: none`.
- **No JS.** The editor preview updates instantly because the controls use `render_type: 'ui'` with a prefix class and selectors.

## Error handling and edge cases

- **Unknown shape id:** falls back to the per-control default (existing `shapePair(id, fallback)`).
- **Missing CSS variables:** for example, the CSS isn't generated yet in the editor's first frame. `number()`-style parsing falls back to the control defaults.
- **Settings omitted from `data-settings`:** placement no longer depends on them, since it reads CSS. For Flat edge and Trigger, the JS falls back to `auto`.
- **No `<img>` in the Image widget:** no-op (existing).
- **Reduced motion:** rest shape only (existing), and no Float.

## Testing

Tests run on Aberdeen local through the Framify junction, using Playwright with the existing `claude` login.

1. `php -l framify-elementor.php` and `node --check assets/framify-elementor.js`.
2. Test page 145, cases added alongside the existing three:
   - Image: Wavy Tide, align right, width 100, trigger none. The straight right edge is flush, and a zoom of 10% on hover (trigger hover) leaves no gap on the right.
   - Image: Wavy with Flat edge `none`, left, top, bottom. Check the orientation of each.
   - Image deco: placement right/bottom 80 x 80. The deco follows on window resize.
   - Container deco: Wavy, grain, right, 90 x 110, with two child PNG images using Float at different delays. The children overflow the shape and bob out of phase.
   - Responsive: set align_x Right on desktop and Center on mobile. Resize the viewport to 375px and confirm the geometry changes without a reload.
3. Editor: change each placement control and confirm the preview updates without re-rendering. Float toggles live on a Heading widget. No console errors.
4. Reduced motion (`emulateMedia`): no morph and no float.
5. A non-ASCII grep on the changed files (Framify rule).

## Docs

- Update the Elementor module section in Framify `CLAUDE.md`: Wavy builder, edge transforms, CSS-variable placement, Float being pure CSS on `translate`/`rotate`.
- Update the file docblock of `framify-elementor.php`.
