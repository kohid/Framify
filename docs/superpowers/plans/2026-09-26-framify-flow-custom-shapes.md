# Framify Flow Shapes, Custom Shape and Clip Grain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Always collaborate with /feature-dev:feature-dev (workflow + review) and /frontend-design:frontend-design (every visual judgement).

**Goal:** Add six hand-placed "Flow" shapes, a paste-your-own Custom shape, and grain in Container Clip mode to Framify's Elementor Organic Shape module. Also fix the Auto flat-edge rule and apply the housekeeping items from the last review.

**Architecture:**
- **Flow shapes** are hand-placed anchor points, smoothed by the existing `smooth_path()`. They reuse the Wavy flat-edge transforms.
- **Custom shapes** are parsed client-side from pasted SVG. Only validated path data reaches the DOM. The shape is fitted into the 0-100 box by an "inner" transform that replaces the edge transform in the transform chain.
- **Clip grain** is a specks-only SVG layer placed inside the clipped container. It shares one grain-filter builder with the deco blob.

**Tech Stack:** WordPress plugin PHP (no build step), Elementor 4.2.4 controls API, vanilla JS (ES5 style, IIFE), SVG clipPath and filters, and CSS. Tests are a plain PHP CLI script (`php` 8.2 on PATH) plus Playwright checks in the browser.

**Spec:** `docs/superpowers/specs/2026-09-26-framify-flow-custom-shapes-design.md`

## Global Constraints

**Location and workflow**
- Plugin root: `c:/Users/Admin/Local Sites/business-directory/app/public/wp-content/plugins/framify/`. All paths below are relative to it.
- Not a git repo: there are **no commit steps**. Each task's checkpoint is its passing verification.

**Code rules**
- Source files are pure ASCII. Check them with the Grep tool, pattern `[^\x00-\x7F]` (`grep -P` is broken in this Git Bash); it must find no matches.
- Edit with the Edit/Write tools only. Never round-trip files through PowerShell `Get-Content` / `Set-Content`.
- JS: `var`, one IIFE, `'use strict'`, no modules.
- Text domain `'framify'`.
- Assets are versioned by `filemtime()`, so do not bump `FRAMIFY_VERSION`.

**Naming**
- Control ids start with `framify_org_`.
- CSS custom properties start with `--framify-`.

**Shapes and security**
- Never copy or trace the user's reference SVGs (Bold Themes assets). Test the Custom shape only with the sample SVGs given in this plan.
- Custom shape security rule: only path data matching `^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$` may reach the DOM, and only through `setAttribute( 'd', ... )`. Pasted markup is never inserted.
- `DEFAULT_SHAPE` stays `'pebble'` (a Blob).

**Test site (Aberdeen local)**
- It loads this plugin through a junction, so edits are live. Playwright is logged in as the local admin.
- Do not start, stop or control the Local app.
- Editor: `http://aberdeen-taxi-knowledge.local/wp-admin/post.php?post=145&action=elementor`
  - Take over a stale lock if asked.
  - Accept any beforeunload dialog when leaving.
- Page 145:
  - It is **published**. Its latest content lives in an autosave, so for previews use `elementor.config.document.urls.wp_preview`, evaluated inside the editor.
  - Saving test elements with `$e.run( 'document/save/draft' )` is expected.
  - Never publish, and never save UI experiments.
- `document/elements/create`: create **one element per call**, because this install drops extra siblings of a multi-child model.
  - The image setting for new Image widgets comes from `elementor.getContainer( 'fo00003' ).settings.get( 'image' )`.
  - If `fo00003` is missing, use the `image` setting of the widget whose preview element has id `fo-nest`.
- Before scroll-dependent checks, set `document.documentElement.style.scrollBehavior = 'auto'`.
- Wait at least 3 s for a 1.5 s animation; this browser's requestAnimationFrame can be throttled.
- Screenshots can only be saved under the working tree. Copy any you keep into the scratchpad `C:/Users/Admin/AppData/Local/Temp/claude/d--Local-Sites-aberdeen-taxi-knowledge-app-public-wp-content/50e79500-63e0-4288-b81a-6d7cce9413df/scratchpad/sdd/`, then delete them from `d:/Local Sites/aberdeen-taxi-knowledge/app/public/wp-content/`. Only delete PNGs you created.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `framify-elementor.php` | Modify | Flow geometry, the picker (incl. Custom), Custom and clip-grain controls, Flat edge condition and text |
| `assets/framify-elementor.js` | Modify | Auto-edge rule, inner transform, Custom parsing and rendering, clip grain layer, housekeeping |
| `assets/framify-elementor.css` | Modify | Grain layer box |
| `dev/tests/elementor-shapes-test.php` | Modify | Flow checks, derived Wavy ids, picker counts, preview labels |
| `CLAUDE.md` | Modify | Document the new behaviour |

---

### Task 1: Flow shape geometry and test housekeeping (PHP)

**Files:**
- Modify: `framify-elementor.php`: after `wavy_ids()` (about line 103); `shape_paths()` (about 207-228); `shape_options()` (about 230-250)
- Modify: `dev/tests/elementor-shapes-test.php`

**Interfaces:**
- Consumes: the existing `smooth_path( array $points, $closed )` and `wavy_presets()`.
- Produces:
  - `flow_presets()`: returns `id => array( 'title', 'rest' => array( array( x, y ), ... ), 'hover' => ... )`.
  - `public flow_ids()`: returns `string[]`, which is `brook, breeze, meadow, lagoon, harbor, glade`.
  - `shape_paths()` entries `id => array( 'family' => 'flow', 'rest', 'hover' )`, with no `free` variant.
  - `shape_options( $with_custom = false )`: Task 3 adds the `custom` option; this task adds only the parameter.

- [ ] **Step 1: Update the test script**

In `dev/tests/elementor-shapes-test.php`:

(a) Replace the `framify_call` function with a version that passes arguments through:

```php
function framify_call( $module, $method ) {
    $m = new ReflectionMethod( $module, $method );
    $m->setAccessible( true );
    return $m->invokeArgs( $module, array_slice( func_get_args(), 2 ) );
}
```

(b) In the `--preview` block, replace the line `$variants = array( ( isset( $p['free'] ) ? 'anchored' : 'blob' ) => $p );` with:

```php
        $variants = array( ( 'wavy' === $p['family'] ? 'anchored' : $p['family'] ) => $p );
```

(c) Replace everything from `// 2. Wavy presets.` down to (and not including) the line `echo $failures ? ...` with:

```php
// 2. Wavy presets (ids derived from the module, so a new preset is tested automatically).
$presets  = framify_call( $module, 'wavy_presets' );
$wavy_ids = array_keys( $presets );
check( 'wavy_ids() matches wavy_presets() keys', $wavy_ids === framify_call( $module, 'wavy_ids' ) );
check( 'six wavy shapes', 6 === count( $wavy_ids ) );
foreach ( $wavy_ids as $id ) {
    $p = isset( $paths[ $id ] ) ? $paths[ $id ] : null;
    check( "$id exists as wavy", $p && 'wavy' === $p['family'] && isset( $p['free'] ) );
    if ( ! $p || ! isset( $p['free'] ) ) {
        continue;
    }
    foreach ( array( 'rest', 'hover' ) as $state ) {
        $w = $presets[ $id ][ $state ];
        check( "$id $state inset covers both amplitudes", $w[0] >= $w[1] + $w[4] );
    }
    check( "$id anchored rest/hover morphable", skeleton( $p['rest'] ) === skeleton( $p['hover'] ) );
    check( "$id free rest/hover morphable", skeleton( $p['free']['rest'] ) === skeleton( $p['free']['hover'] ) );
    $n = nums( $p['rest'] );
    check( "$id starts at the top-right corner", 0 === strpos( $p['rest'], 'M100.00 0.00' ) );
    check( "$id ends at the bottom-right corner", array( 100.0, 100.0 ) === array_slice( $n, -2 ) );
    check( "$id stays near the box", min( $n ) >= -3 && max( $n ) <= 103 );
    $f = nums( $p['free']['rest'] );
    check( "$id free variant stays inside the box", min( $f ) >= -3 && max( $f ) <= 103 );
}

// 3. Flow presets: hand-placed anchors from the top-right corner round to the bottom-right corner.
$flow = framify_call( $module, 'flow_presets' );
check( 'flow_ids() matches flow_presets() keys', array_keys( $flow ) === framify_call( $module, 'flow_ids' ) );
check( 'six flow shapes', 6 === count( $flow ) );
foreach ( $flow as $id => $preset ) {
    $p = isset( $paths[ $id ] ) ? $paths[ $id ] : null;
    check( "$id exists as flow", $p && 'flow' === $p['family'] && ! isset( $p['free'] ) );
    if ( ! $p ) {
        continue;
    }
    foreach ( array( 'rest', 'hover' ) as $state ) {
        $pts    = $preset[ $state ];
        $inside = true;
        foreach ( $pts as $pt ) {
            if ( $pt[0] < 0 || $pt[0] > 100 || $pt[1] < 0 || $pt[1] > 100 ) {
                $inside = false;
            }
        }
        check( "$id $state has 8-14 anchors inside the box", count( $pts ) >= 8 && count( $pts ) <= 14 && $inside );
        check( "$id $state is pinned to the right-hand corners", array( 100, 0 ) == $pts[0] && array( 100, 100 ) == $pts[ count( $pts ) - 1 ] );
    }
    check( "$id rest/hover have the same anchor count", count( $preset['rest'] ) === count( $preset['hover'] ) );
    $drift = 0;
    foreach ( $preset['rest'] as $i => $pt ) {
        $drift = max( $drift, abs( $pt[0] - $preset['hover'][ $i ][0] ), abs( $pt[1] - $preset['hover'][ $i ][1] ) );
    }
    check( "$id hover drifts at most 6 units", $drift <= 6 );
    check( "$id rest/hover morphable", skeleton( $p['rest'] ) === skeleton( $p['hover'] ) );
    check( "$id starts at the top-right corner", 0 === strpos( $p['rest'], 'M100.00 0.00' ) );
    $n = nums( $p['rest'] );
    check( "$id ends at the bottom-right corner", array( 100.0, 100.0 ) === array_slice( $n, -2 ) );
    check( "$id stays near the box", min( $n ) >= -3 && max( $n ) <= 103 );
}

// 4. The pickers list every shape; wide families have wide thumbnails.
$options = framify_call( $module, 'shape_options' );
check( 'deco picker has 20 shapes (no custom)', 20 === count( $options ) && ! isset( $options['custom'] ) );
check( 'wavy thumbnail is drawn wide', isset( $options['tide'] ) && false !== strpos( rawurldecode( $options['tide']['image'] ), 'scale(1 0.7)' ) );
check( 'flow thumbnail is drawn wide', isset( $options['brook'] ) && false !== strpos( rawurldecode( $options['brook']['image'] ), 'scale(1 0.7)' ) );
```

Task 3 extends section 4 with the 21-shape main-picker check.

- [ ] **Step 2: Run the checks to confirm they fail**

Run: `cd "c:/Users/Admin/Local Sites/business-directory/app/public/wp-content/plugins/framify" && php dev/tests/elementor-shapes-test.php`

Expected: a non-zero exit code. It is 255 if PHP stops on an uncaught `ReflectionException` ("Method Framify_Elementor::flow_presets() does not exist"), or 1 if flow `FAIL` lines print. Record this output as the RED evidence.

- [ ] **Step 3: Add the Flow library**

In `framify-elementor.php`, directly after the `wavy_ids()` method, insert:

```php
    /* ------------------------------------------------------------------
       Flow library
       Hand-placed shapes with the character of a designer's freehand
       crop: big asymmetric sweeps, deep dips, one straight side (right,
       turned to any side by the frontend like Wavy). Each pose is a list of
       anchors in the 0-100 box running from the top-right corner round the
       free side to the bottom-right corner; smooth_path() draws the curves,
       so hover is the same anchors nudged (<= 6 units) and always morphs.
       Anchors, not Bezier handles: a smoother through points can't kink.
    ------------------------------------------------------------------ */
    private function flow_presets() {
        return array(
            'brook'  => array(
                'title' => __( 'Brook', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 80, 4 ), array( 62, 20 ), array( 48, 12 ), array( 28, 6 ), array( 8, 22 ), array( 3, 55 ), array( 14, 86 ), array( 40, 94 ), array( 64, 84 ), array( 84, 97 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 82, 6 ), array( 60, 24 ), array( 44, 14 ), array( 24, 5 ), array( 7, 20 ), array( 4, 52 ), array( 12, 84 ), array( 38, 95 ), array( 60, 88 ), array( 82, 94 ), array( 100, 100 ) ),
            ),
            'breeze' => array(
                'title' => __( 'Breeze', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 78, 10 ), array( 55, 4 ), array( 32, 12 ), array( 14, 8 ), array( 4, 26 ), array( 16, 50 ), array( 6, 72 ), array( 20, 94 ), array( 50, 97 ), array( 78, 86 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 80, 12 ), array( 56, 6 ), array( 34, 10 ), array( 15, 6 ), array( 5, 24 ), array( 19, 48 ), array( 7, 70 ), array( 22, 92 ), array( 52, 95 ), array( 80, 88 ), array( 100, 100 ) ),
            ),
            'meadow' => array(
                'title' => __( 'Meadow', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 84, 6 ), array( 66, 24 ), array( 50, 26 ), array( 36, 10 ), array( 16, 4 ), array( 4, 22 ), array( 3, 58 ), array( 12, 88 ), array( 34, 98 ), array( 58, 90 ), array( 80, 94 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 86, 8 ), array( 68, 20 ), array( 52, 28 ), array( 38, 12 ), array( 18, 6 ), array( 5, 20 ), array( 4, 55 ), array( 10, 86 ), array( 32, 96 ), array( 56, 92 ), array( 78, 90 ), array( 100, 100 ) ),
            ),
            'lagoon' => array(
                'title' => __( 'Lagoon', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 74, 4 ), array( 48, 8 ), array( 26, 20 ), array( 8, 30 ), array( 3, 58 ), array( 10, 84 ), array( 28, 95 ), array( 44, 80 ), array( 58, 78 ), array( 72, 94 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 76, 6 ), array( 50, 6 ), array( 28, 18 ), array( 9, 28 ), array( 4, 55 ), array( 12, 82 ), array( 30, 94 ), array( 46, 84 ), array( 60, 76 ), array( 74, 92 ), array( 100, 100 ) ),
            ),
            'harbor' => array(
                'title' => __( 'Harbor', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 84, 14 ), array( 70, 6 ), array( 56, 18 ), array( 42, 8 ), array( 24, 6 ), array( 6, 16 ), array( 2, 50 ), array( 6, 84 ), array( 24, 97 ), array( 56, 92 ), array( 82, 96 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 86, 12 ), array( 72, 8 ), array( 58, 16 ), array( 44, 10 ), array( 26, 4 ), array( 7, 14 ), array( 3, 48 ), array( 7, 82 ), array( 26, 95 ), array( 58, 94 ), array( 80, 94 ), array( 100, 100 ) ),
            ),
            'glade'  => array(
                'title' => __( 'Glade', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 86, 10 ), array( 72, 4 ), array( 58, 14 ), array( 44, 20 ), array( 30, 8 ), array( 14, 6 ), array( 4, 22 ), array( 4, 64 ), array( 14, 90 ), array( 40, 94 ), array( 66, 88 ), array( 86, 94 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 88, 12 ), array( 74, 6 ), array( 60, 12 ), array( 46, 18 ), array( 32, 6 ), array( 15, 8 ), array( 5, 20 ), array( 5, 60 ), array( 12, 88 ), array( 38, 96 ), array( 64, 90 ), array( 84, 92 ), array( 100, 100 ) ),
            ),
        );
    }

    public function flow_ids() {
        return array_keys( $this->flow_presets() );
    }
```

In `shape_paths()`, directly before `return $paths;`, insert:

```php
        foreach ( $this->flow_presets() as $id => $preset ) {
            $paths[ $id ] = array(
                'family' => 'flow',
                'rest'   => $this->smooth_path( $preset['rest'], false ),
                'hover'  => $this->smooth_path( $preset['hover'], false ),
            );
        }
```

Replace the whole `shape_options()` method, including its docblock, with:

```php
    /**
     * VISUAL_CHOICE options: each shape's rest outline as an inline SVG
     * thumbnail, matching the look of Elementor's own Mask shape picker.
     * Wavy and Flow thumbnails are squashed wide, like the photos they crop.
     * $with_custom adds the paste-your-own option (main Shape picker only).
     */
    private function shape_options( $with_custom = false ) {
        $all     = $this->presets() + $this->wavy_presets() + $this->flow_presets();
        $options = array();
        foreach ( $this->shape_paths() as $id => $shape ) {
            $path = '<path fill="#69727d" d="' . $shape['rest'] . '"/>';
            if ( 'blob' !== $shape['family'] ) {
                $path = '<g transform="translate(0 15) scale(1 0.7)">' . $path . '</g>';
            }
            $svg            = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' . $path . '</svg>';
            $options[ $id ] = array(
                'title' => $all[ $id ]['title'],
                'image' => 'data:image/svg+xml,' . rawurlencode( $svg ),
            );
        }
        return $options;
    }
```

- [ ] **Step 4: Run the checks to confirm they pass**

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`
Expected: `No syntax errors detected`, every line `PASS`, and `ALL PASSED` (exit 0). The "blob X unchanged" lines must still pass.

- [ ] **Step 5: Visual tuning (frontend-design)**

1. Run: `php dev/tests/elementor-shapes-test.php --preview`.
2. Open `dev/tests/shapes-preview.html` in Playwright via `file:///` and take a full-page screenshot.
3. Compare the six `(flow)` tiles with these reference compositions (character, not geometry): `C:/Users/Admin/AppData/Local/Temp/claude/d--Local-Sites-aberdeen-taxi-knowledge-app-public-wp-content/50e79500-63e0-4288-b81a-6d7cce9413df/images/70.png` and `.../images/71.png`.

Quality bar:
- no kinks or pointed tips
- no self-intersection
- each shape distinct and matching its intent in the spec table
- at least one pronounced concave dip per shape
- fills the box generously
- the hover outline drifts visibly without the shape changing identity

Tune only anchor coordinates. Keep the corner pins, the 8-14 anchors, identical rest/hover counts, drift <= 6, and 0-100 bounds. After each change, rerun Step 4 and re-screenshot. Record old -> new anchors for any shape you change.

- [ ] **Step 6: ASCII check**

Use the Grep tool with pattern `[^\x00-\x7F]` on `framify-elementor.php` and `dev/tests/elementor-shapes-test.php`. Expected: no matches.

---

### Task 2: Flow in the panel, the Auto edge rule, and the inner transform

**Files:**
- Modify: `framify-elementor.php`: the `framify_org_edge` control (about lines 311-325)
- Modify: `assets/framify-elementor.js`: `resolveEdge` (about 77-89), `clipTransform` (about 176-189), `setup` (about 287-327), `setupImage` deco block (about 359-366), `setupContainer` deco block (about 394-395), `observeLayout` (about 416-444), `place` (about 446-477), `bindTrigger` auto (about 483-484), `render`

**Interfaces:**
- Consumes (from Task 1):
  - `window.framifyOrganic.shapes[id].family` can be `'flow'`
  - `Framify_Elementor::flow_ids()`
- Produces:
  - `resolveEdge( family, setting, box )`, where `box` is the `readBox()` result `{ x, y, w, h, ax }`
  - `clipTransform( box, inner, zoom, origin )`, where `inner` is the transform string applied first in the 0-100 box
  - `fx.inner` on each handler, a string set in `setup()`
  - The trigger `auto` resolves to hover for `blob` and to none for every other family.

- [ ] **Step 1: Flat edge control covers Flow**

In the `framify_org_edge` control, replace the `description` and `condition` lines with:

```php
            'description' => esc_html__( 'The straight side of a Wavy or Flow shape, flush with the element edge so it can run off the page. Flow shapes always keep one straight side.', 'framify' ),
            'condition'   => $on + array( 'framify_org_shape' => array_merge( $this->wavy_ids(), $this->flow_ids() ) ),
```

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`. Expected: no syntax errors and `ALL PASSED`.

- [ ] **Step 2: Replace `resolveEdge`**

Replace the whole `resolveEdge` function and the comment above it with:

```js
	// Blob and Custom shapes have no straight side; Flow always keeps one.
	// Auto only picks a side the shape's box actually reaches, so a narrowed
	// or offset shape never shows its straight side as a hard cut inside the
	// element. Flow has no free variant, so where Wavy would drop the edge,
	// Flow falls back to the side it touches, else right.
	function resolveEdge( family, setting, box ) {
		if ( 'wavy' !== family && 'flow' !== family ) {
			return 'none';
		}
		var flow = 'flow' === family;
		if ( setting && 'auto' !== setting ) {
			return flow && 'none' === setting ? 'right' : setting;
		}
		var touchesLeft = box.x <= 0.001;
		var touchesRight = box.x + box.w >= 0.999;
		if ( box.ax < 0.25 && touchesLeft ) {
			return 'left';
		}
		if ( box.ax > 0.75 && touchesRight ) {
			return 'right';
		}
		if ( ! flow ) {
			return 'none';
		}
		return touchesRight || ! touchesLeft ? 'right' : 'left';
	}
```

- [ ] **Step 3: `clipTransform` takes an inner transform**

Replace the whole `clipTransform` function and the comment above it with:

```js
	// Clip paths live in 0-100 units; this maps one into the placement box in
	// objectBoundingBox units (0-1). `inner` is applied first, in the 0-100
	// box: the flat-edge turn, or a custom shape's fit into that box. zoom > 1
	// shrinks the clip around `origin` by the factor the image is scaled up,
	// so the photo zooms inside a shape that stays put.
	function clipTransform( box, inner, zoom, origin ) {
		var t = '';
		if ( zoom && 1 !== zoom ) {
			t = 'translate(' + origin.x + ' ' + origin.y + ') scale(' + ( 1 / zoom ) + ') translate(' + ( -origin.x ) + ' ' + ( -origin.y ) + ') ';
		}
		t += 'translate(' + box.x + ' ' + box.y + ') scale(' + ( box.w / 100 ) + ' ' + ( box.h / 100 ) + ')';
		return inner ? t + ' ' + inner : t;
	}
```

- [ ] **Step 4: Update the call sites**

In `setup()`:
1. Add `inner: '',` to the `fx` object literal, directly after the line `edge: 'none',`.
2. Replace the line `fx.edge = resolveEdge( fx.family, fx.edgeSetting, readBox( el, '', MAIN_BOX ).ax );` with:

```js
				fx.edge = resolveEdge( fx.family, fx.edgeSetting, readBox( el, '', MAIN_BOX ) );
				fx.inner = edgeTransform( fx.edge );
```

In `setupImage()`, replace `var decoEdge = resolveEdge( decoFamily, 'auto', readBox( el, 'deco-', DECO_BOX ).ax );` with:

```js
				var decoEdge = resolveEdge( decoFamily, 'auto', readBox( el, 'deco-', DECO_BOX ) );
```

In `setupContainer()`, deco branch, replace `deco.path.setAttribute( 'transform', edgeTransform( fx.edge ) );` with:

```js
				deco.path.setAttribute( 'transform', fx.inner );
```

In `place()`:
- Replace `if ( resolveEdge( fx.family, fx.edgeSetting, box.ax ) !== fx.edge ) {` with `if ( resolveEdge( fx.family, fx.edgeSetting, box ) !== fx.edge ) {`.
- Replace `if ( deco.prefix && resolveEdge( deco.family, 'auto', decoBox.ax ) !== deco.edge ) {` with `if ( deco.prefix && resolveEdge( deco.family, 'auto', decoBox ) !== deco.edge ) {`.

In `render()`, replace `clipTransform( fx.clip.box, fx.edge, zoom, fx.clip.origin )` with `clipTransform( fx.clip.box, fx.inner, zoom, fx.clip.origin )`.

In `bindTrigger()`, replace `trigger = 'wavy' === fx.family ? 'none' : 'hover';` with:

```js
					// Only Blobs spring on hover by default; wide and custom shapes are static.
					trigger = 'blob' === fx.family ? 'hover' : 'none';
```

- [ ] **Step 5: Drop the redundant resize listener**

The ResizeObserver already fires on every element resize. Replace the whole `observeLayout` method and its comment with:

```js
			// Placement can change with no settings change: a window resize, an
			// editor device switch, a breakpoint, the image loading. The
			// ResizeObserver covers every size change of the element or image.
			observeLayout: function () {
				var self = this;
				var fx = this.fx;
				var place = function () {
					self.place();
				};
				var observer = 'ResizeObserver' in window ? new ResizeObserver( place ) : null;
				if ( observer ) {
					observer.observe( fx.el );
					if ( fx.img ) {
						observer.observe( fx.img );
					}
				}
				if ( fx.img ) {
					fx.img.addEventListener( 'load', place );
				}
				fx.cleanup.push( function () {
					if ( observer ) {
						observer.disconnect();
					}
					if ( fx.img ) {
						fx.img.removeEventListener( 'load', place );
					}
				} );
			},
```

Run: `node --check assets/framify-elementor.js`, then use the Grep tool with pattern `resolveEdge\([^)]*\.ax|edgeTransform\( edge \)|'resize'` on `assets/framify-elementor.js`. Expected: node prints nothing, and Grep finds no matches.

- [ ] **Step 6: Create the browser test elements**

In the editor, run with `browser_evaluate`, one create call per element as this code does:

```js
async () => {
  const img = ( elementor.getContainer( 'fo00003' ) || {} ).settings ? elementor.getContainer( 'fo00003' ).settings.get( 'image' ) : null;
  if ( ! img ) { return 'no fo00003: use the fo-nest image setting instead'; }
  const pct = ( n ) => ( { unit: '%', size: n, sizes: [] } );
  const doc = elementor.getPreviewContainer();
  const add = ( cssId, extra ) => $e.run( 'document/elements/create', { container: doc, model: { elType: 'widget', widgetType: 'image', settings: Object.assign( { image: img, _element_id: cssId, framify_org_enable: 'yes' }, extra ) } } );
  add( 'fo-flow-r', { framify_org_shape: 'brook', framify_org_align_x: 'right', framify_org_trigger: 'hover' } );
  add( 'fo-flow-auto-in', { framify_org_shape: 'breeze', framify_org_align_x: 'right', framify_org_width: pct( 80 ), framify_org_offset_x: pct( -10 ) } );
  add( 'fo-wavy-auto-in', { framify_org_shape: 'tide', framify_org_align_x: 'right', framify_org_width: pct( 80 ), framify_org_offset_x: pct( -10 ) } );
  add( 'fo-flow-none', { framify_org_shape: 'glade', framify_org_edge: 'none' } );
  await $e.run( 'document/save/draft' );
  return 'created';
}
```

If it returns the `fo00003` message, repeat it with the image setting of the widget whose preview element id is `fo-nest`. Then get the preview URL with `browser_evaluate` `() => elementor.config.document.urls.wp_preview` and navigate there at 1280x900.

- [ ] **Step 7: Verify in the preview**

```js
async () => {
  const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
  document.documentElement.style.scrollBehavior = 'auto';
  const parts = ( id ) => {
    const img = document.getElementById( id ).querySelector( 'img' );
    const clipId = ( img.style.clipPath.match( /#([\w-]+)/ ) || [] )[ 1 ];
    return { img, path: clipId && document.getElementById( clipId ).querySelector( 'path' ) };
  };
  const hit = ( img, x, y ) => document.elementFromPoint( x, y ) === img;
  const out = {};

  const fr = parts( 'fo-flow-r' );
  fr.img.scrollIntoView( { block: 'center', behavior: 'instant' } );
  await wait( 500 );
  const r = fr.img.getBoundingClientRect();
  out.flowAnchored = fr.path.getAttribute( 'd' ).startsWith( 'M100.00 0.00' );
  out.flowRightFlush = [ 0.05, 0.5, 0.95 ].every( ( f ) => hit( fr.img, r.right - 2, r.top + r.height * f ) );
  document.getElementById( 'fo-flow-r' ).dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 3500 );
  out.flowZoomed = /scale\(1\.1\)/.test( fr.img.style.transform );
  out.flowRightFlushZoomed = [ 0.05, 0.5, 0.95 ].every( ( f ) => hit( fr.img, r.right - 2, r.top + r.height * f ) );
  document.getElementById( 'fo-flow-r' ).dispatchEvent( new MouseEvent( 'mouseleave' ) );

  const fin = parts( 'fo-flow-auto-in' );
  out.flowAutoInsideFallsBackRight = fin.path.getAttribute( 'd' ).startsWith( 'M100.00 0.00' ) && / scale\(0\.008 0\.01\)$/.test( fin.path.getAttribute( 'transform' ) );
  out.wavyAutoInsideDropsEdge = ! parts( 'fo-wavy-auto-in' ).path.getAttribute( 'd' ).startsWith( 'M100.00 0.00' );
  out.flowNoneBecomesRight = parts( 'fo-flow-none' ).path.getAttribute( 'd' ).startsWith( 'M100.00 0.00' ) && / scale\(0\.01 0\.01\)$/.test( parts( 'fo-flow-none' ).path.getAttribute( 'transform' ) );
  out.wavyRightStillAnchored = parts( 'fo-wr' ).path.getAttribute( 'd' ).startsWith( 'M100.00 0.00' );
  return out;
}
```

Expected: every value `true`. `fo-wr` is an existing Wavy test element, aligned right at full width; it guards against a regression in the Auto rule. Then check `browser_console_messages`: expect no errors.

- [ ] **Step 8: ASCII check**

Use the Grep tool with pattern `[^\x00-\x7F]` on `framify-elementor.php` and `assets/framify-elementor.js`. Expected: no matches.

---

### Task 3: Custom shape

**Files:**
- Modify: `framify-elementor.php`: the `framify_org_shape` control's `options`, a new `framify_org_custom_svg` control, and `shape_options()`
- Modify: `assets/framify-elementor.js`: new helpers after `grainOn()`, plus `setup`, `setupImage`, `setupContainer` and a new `mainPair` / `warnCustom`
- Modify: `dev/tests/elementor-shapes-test.php`: section 4

**Interfaces:**
- Consumes (from Task 2):
  - `fx.inner` (a string, applied first in the 0-100 box)
  - `resolveEdge( family, setting, box )` returns `'none'` for family `'custom'`
  - `bindTrigger` auto resolves to none for non-blob families
- Produces:
  - setting `framify_org_shape = 'custom'`
  - setting `framify_org_custom_svg` (string)
  - JS `parseCustom( text )` returns `{ d, box: { x, y, w, h } }` or `null`
  - `fx.family === 'custom'`
  - `fx.custom`

- [ ] **Step 1: Extend the picker test**

In `dev/tests/elementor-shapes-test.php`, section 4, add after the `deco picker` check:

```php
$main = framify_call( $module, 'shape_options', true );
check( 'main picker has 21 shapes ending with custom', 21 === count( $main ) && 'custom' === array_key_last( $main ) );
check( 'custom thumbnail is a dashed outline', isset( $main['custom'] ) && false !== strpos( rawurldecode( $main['custom']['image'] ), 'stroke-dasharray' ) );
```

Run `php dev/tests/elementor-shapes-test.php`. Expected: FAIL on the two new checks (RED).

- [ ] **Step 2: PHP, the Custom option and control**

In `shape_options()`, directly before `return $options;`, insert:

```php
        if ( $with_custom ) {
            $svg                = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="12" y="24" width="76" height="52" rx="16" fill="none" stroke="#69727d" stroke-width="4" stroke-dasharray="8 6"/></svg>';
            $options['custom'] = array(
                'title' => __( 'Custom', 'framify' ),
                'image' => 'data:image/svg+xml,' . rawurlencode( $svg ),
            );
        }
```

In `register_controls()`, in the `framify_org_shape` control, replace `'options'     => $this->shape_options(),` with `'options'     => $this->shape_options( true ),`. The deco shape control keeps `shape_options()`.

Directly after the `framify_org_edge` control, insert:

```php
        // Parsed in the browser: only validated path data is used, and only
        // ever through setAttribute('d'), so pasted markup can't inject.
        $element->add_control( 'framify_org_custom_svg', $this->live( array(
            'label'       => esc_html__( 'SVG code or path', 'framify' ),
            'type'        => $cm::TEXTAREA,
            'rows'        => 6,
            'placeholder' => '<svg viewBox="0 0 1200 800"><path d="..."/></svg>',
            'description' => esc_html__( 'Paste an SVG from any design tool, or just its path data. Only the path is used; transforms inside the SVG are ignored.', 'framify' ),
            'ai'          => array( 'active' => false ),
            'condition'   => $on + array( 'framify_org_shape' => 'custom' ),
        ) ) );
```

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`. Expected: `ALL PASSED` (GREEN).

- [ ] **Step 3: JS, the parsing helpers**

In `assets/framify-elementor.js`, directly after the `grainOn` function, insert:

```js
	/* ---------- custom shape ---------- */

	// Only characters of the SVG path grammar; anything else is dropped.
	var PATH_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;
	var customCache = {};

	// Pasted SVG code (or bare path data) -> { d, box } in the paste's own
	// coordinates, or null. Only the validated d string is ever used, and
	// only through setAttribute('d'), so pasted markup can never inject.
	function parseCustom( text ) {
		text = String( text || '' ).trim();
		if ( ! text || text.length > 50000 ) {
			return null;
		}
		if ( Object.prototype.hasOwnProperty.call( customCache, text ) ) {
			return customCache[ text ];
		}
		var paths = [];
		if ( -1 === text.indexOf( '<' ) ) {
			paths.push( text );
		} else {
			var re = /\sd\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
			var m;
			while ( ( m = re.exec( text ) ) ) {
				paths.push( undefined !== m[ 1 ] ? m[ 1 ] : m[ 2 ] );
			}
		}
		var d = paths.map( function ( p ) {
			return p.trim();
		} ).filter( function ( p ) {
			return p && PATH_CHARS.test( p );
		} ).join( ' ' );
		var box = d ? customBox( text, d ) : null;
		customCache[ text ] = box ? { d: d, box: box } : null;
		return customCache[ text ];
	}

	// The paste's coordinate box: its viewBox, else numeric width/height,
	// else the path's own measured bounds.
	function customBox( text, d ) {
		var vb = text.match( /viewBox\s*=\s*["']([^"']+)["']/i );
		if ( vb ) {
			var v = vb[ 1 ].trim().split( /[\s,]+/ ).map( Number );
			if ( 4 === v.length && v.every( isFinite ) && v[ 2 ] > 0 && v[ 3 ] > 0 ) {
				return { x: v[ 0 ], y: v[ 1 ], w: v[ 2 ], h: v[ 3 ] };
			}
		}
		var w = text.match( /\swidth\s*=\s*["']?([\d.]+)(?:px)?["'\s>\/]/i );
		var h = text.match( /\sheight\s*=\s*["']?([\d.]+)(?:px)?["'\s>\/]/i );
		if ( w && h && +w[ 1 ] > 0 && +h[ 1 ] > 0 ) {
			return { x: 0, y: 0, w: +w[ 1 ], h: +h[ 1 ] };
		}
		var svg = svgEl( 'svg', { width: '0', height: '0', 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' } );
		var path = svgEl( 'path', { d: d } );
		svg.appendChild( path );
		document.body.appendChild( svg );
		var b = null;
		try {
			b = path.getBBox();
		} catch ( e ) {
			b = null;
		}
		svg.remove();
		return b && b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
	}

	// Fits a custom path's box into the 0-100 shape box.
	function customTransform( box ) {
		return 'scale(' + ( 100 / box.w ) + ' ' + ( 100 / box.h ) + ') translate(' + ( -box.x ) + ' ' + ( -box.y ) + ')';
	}
```

`svgEl` is defined further down the file as a function declaration, so it is hoisted and available here.

- [ ] **Step 4: JS, wire Custom into the handler**

In `setup()`, replace the opening guard:

```js
				var s = this.getElementSettings();
				if ( 'yes' !== s.framify_org_enable || ! shapeData( s.framify_org_shape ) ) {
					return;
				}
```

with:

```js
				var s = this.getElementSettings();
				if ( 'yes' !== s.framify_org_enable || ! shapeData( s.framify_org_shape ) ) {
					return;
				}
				var custom = null;
				if ( 'custom' === s.framify_org_shape ) {
					custom = parseCustom( s.framify_org_custom_svg );
					if ( ! custom ) {
						this.warnCustom( s.framify_org_custom_svg );
						return;
					}
				}
```

In the `fx` literal:
- Replace `family: familyOf( s.framify_org_shape ),` with `family: custom ? 'custom' : familyOf( s.framify_org_shape ),`.
- Add `custom: custom,` directly after it.

Replace `fx.inner = edgeTransform( fx.edge );` with:

```js
				fx.inner = custom ? customTransform( custom.box ) : edgeTransform( fx.edge );
```

In both `setupImage()` and `setupContainer()`, replace `var main = shapePair( s.framify_org_shape, null, fx.edge );` with `var main = this.mainPair( s );`.

Add these two methods directly after `rebuild`:

```js
			// The element's own shape as a rest/hover pair. A custom shape never
			// morphs, so both poses are the same path.
			mainPair: function ( s ) {
				var fx = this.fx;
				if ( fx.custom ) {
					var path = parsePath( fx.custom.d );
					return { rest: path, hover: path };
				}
				return shapePair( s.framify_org_shape, null, fx.edge );
			},

			// Editor only, once per distinct paste: say why nothing happened.
			warnCustom: function ( text ) {
				if ( elementorFrontend.isEditMode() && this.warnedFor !== text ) {
					this.warnedFor = text;
					window.console.warn( 'Framify: custom shape has no usable path.' );
				}
			},
```

Run: `node --check assets/framify-elementor.js`. Expected: no output.

- [ ] **Step 5: Create the browser test elements**

These are our own sample shapes; never use the user's reference SVGs. In the editor:

```js
async () => {
  const img = elementor.getContainer( 'fo00003' ).settings.get( 'image' );
  const doc = elementor.getPreviewContainer();
  const PATH = 'M60 120 C 260 -40 520 200 760 90 S 1180 60 1150 380 C 1120 700 820 780 560 700 C 300 620 80 780 40 520 C 0 300 -20 200 60 120 Z';
  const add = ( cssId, extra ) => $e.run( 'document/elements/create', { container: doc, model: { elType: 'widget', widgetType: 'image', settings: Object.assign( { image: img, _element_id: cssId, framify_org_enable: 'yes', framify_org_shape: 'custom' }, extra ) } } );
  add( 'fo-custom-vb', { framify_org_custom_svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><path d="' + PATH + '"/></svg>' } );
  add( 'fo-custom-novb', { framify_org_custom_svg: PATH } );
  add( 'fo-custom-bad', { framify_org_custom_svg: '<svg><rect width="10" height="10"/></svg>' } );
  $e.run( 'document/elements/create', { container: doc, model: { elType: 'container', settings: { _element_id: 'fo-custom-deco', min_height: { unit: 'px', size: 320, sizes: [] }, framify_org_enable: 'yes', framify_org_mode: 'deco', framify_org_shape: 'custom', framify_org_custom_svg: '<svg viewBox="0 0 1200 800"><path d="' + PATH + '"/></svg>' } } } );
  await $e.run( 'document/save/draft' );
  return 'created';
}
```

The `fo00003` fallback rule in Global Constraints applies here too.

Then, still in the editor, check the editor preview's console with `browser_console_messages`. Expect exactly one `Framify: custom shape has no usable path.` warning, from `fo-custom-bad`, and no errors.

- [ ] **Step 6: Verify in the preview**

Navigate to `elementor.config.document.urls.wp_preview` at 1280x900 and run:

```js
async () => {
  const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
  document.documentElement.style.scrollBehavior = 'auto';
  const q = ( id ) => document.getElementById( id );
  const parts = ( id ) => {
    const img = q( id ).querySelector( 'img' );
    const clipId = ( img.style.clipPath.match( /#([\w-]+)/ ) || [] )[ 1 ];
    return { img, path: clipId && document.getElementById( clipId ).querySelector( 'path' ) };
  };
  const out = {};
  const vb = parts( 'fo-custom-vb' );
  vb.img.scrollIntoView( { block: 'center', behavior: 'instant' } );
  await wait( 500 );
  const r = vb.img.getBoundingClientRect();
  out.vbNormalised = /scale\(0\.0833\d* 0\.125\) translate\(-?0 -?0\)$/.test( vb.path.getAttribute( 'transform' ) );
  out.vbCentreVisible = document.elementFromPoint( r.left + r.width / 2, r.top + r.height / 2 ) === vb.img;
  out.vbCornerCut = document.elementFromPoint( r.left + 3, r.top + r.height - 3 ) !== vb.img;
  const nv = parts( 'fo-custom-novb' );
  out.noViewBoxMeasured = !! nv.path && /^scale\([\d.]+ [\d.]+\) translate\(-?[\d.]+ -?[\d.]+\)$/.test( nv.path.getAttribute( 'transform' ).replace( /^.*scale\(0\.01 0\.01\) /, '' ) );
  out.badHasNoClip = '' === q( 'fo-custom-bad' ).querySelector( 'img' ).style.clipPath;
  const decoSvg = q( 'fo-custom-deco' ).querySelector( ':scope > .framify-organic__deco' );
  out.customDecoDrawn = !! decoSvg && /^scale\(0\.0833\d* 0\.125\)/.test( decoSvg.querySelector( 'path' ).getAttribute( 'transform' ) );
  q( 'fo-custom-vb' ).dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 1500 );
  out.customStaticOnAuto = '' === vb.img.style.transform;
  return out;
}
```

Expected: every value `true`, and `browser_console_messages` shows no errors (warnings only come from the editor).

- [ ] **Step 7: Editor live check (frontend-design eye on the panel)**

In the editor, select `fo-custom-vb` and open the Framify tab (use `browser_snapshot` to find the controls). Check:
- The Shape picker's last tile is the dashed "Custom" outline.
- The "SVG code or path" box is visible, and Flat edge is hidden.
- Typing a new path into the box with real key input, e.g. replacing it with `M0 0 H100 V100 H0 Z`, updates the preview within about 500 ms: the clip path `d` changes.
- Selecting Brook shows Flat edge and hides the SVG box.

Undo everything and do not save. Take a screenshot of the Framify tab with Custom selected, for the final report.

- [ ] **Step 8: ASCII check**

Use the Grep tool with pattern `[^\x00-\x7F]` on `framify-elementor.php`, `assets/framify-elementor.js` and `dev/tests/elementor-shapes-test.php`. Expected: no matches.

---

### Task 4: Grain in Container Clip mode

**Files:**
- Modify: `framify-elementor.php`: a new `framify_org_clip_grain` control, directly before `framify_org_motion_heading` (about line 336)
- Modify: `assets/framify-elementor.js`: `buildDeco` (about 216-242), a new `buildGrainFilter` / `buildGrainLayer`, `setupContainer`, and a new `holdLayer`
- Modify: `assets/framify-elementor.css`

**Interfaces:**
- Consumes: `setupContainer( el, id, s )` and its clip and deco branches.
- Produces:
  - setting `framify_org_clip_grain` (`'yes'` or `''`)
  - the DOM layer `svg.framify-organic__deco.framify-organic__grain`, first child of a clipped container
  - `buildGrainFilter( filterId, specksOnly )`

- [ ] **Step 1: PHP control**

Directly before the `$element->add_control( 'framify_org_motion_heading', array(` line, insert:

```php
        // Separate from the deco grain (default on): over a container's
        // background photo, speckle is rarely wanted, so this starts off.
        if ( $is_container ) {
            $element->add_control( 'framify_org_clip_grain', $this->live( array(
                'label'       => esc_html__( 'Grain texture', 'framify' ),
                'type'        => $cm::SWITCHER,
                'default'     => '',
                'description' => esc_html__( 'Chalky speckle over the container background, under its content.', 'framify' ),
                'condition'   => $on + array( 'framify_org_mode' => 'clip' ),
            ) ) );
        }
```

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`. Expected: no syntax errors and `ALL PASSED`.

- [ ] **Step 2: JS, shared grain filter and layer**

Replace the whole `buildDeco` function with these three functions:

```js
	// Chalky speckle: fractal noise thresholded into soft white specks, kept
	// inside the source shape. Low frequency + soft alpha ramp = broad chalky
	// patches, like a dry-brushed print; higher frequency read as sharp
	// sprinkles. specksOnly drops the source itself, for the Clip-mode layer
	// that sits over the container's own background.
	function buildGrainFilter( filterId, specksOnly ) {
		var filter = svgEl( 'filter', { id: filterId, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' } );
		filter.appendChild( svgEl( 'feTurbulence', { type: 'fractalNoise', baseFrequency: '0.45', numOctaves: '3', seed: '7', result: 'noise' } ) );
		filter.appendChild( svgEl( 'feColorMatrix', { 'in': 'noise', type: 'matrix', values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.6 0 0 0 -0.78', result: 'specks' } ) );
		filter.appendChild( svgEl( 'feComposite', { 'in': 'specks', in2: 'SourceGraphic', operator: 'in', result: 'specksIn' } ) );
		if ( ! specksOnly ) {
			var merge = svgEl( 'feMerge' );
			merge.appendChild( svgEl( 'feMergeNode', { 'in': 'SourceGraphic' } ) );
			merge.appendChild( svgEl( 'feMergeNode', { 'in': 'specksIn' } ) );
			filter.appendChild( merge );
		}
		return filter;
	}

	function buildDeco( id, d, color, grain ) {
		var svg = svgEl( 'svg', { 'class': 'framify-organic__deco', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' } );
		var path = svgEl( 'path', { d: d, fill: color || '#F2C53D' } );
		if ( grain ) {
			var defs = svgEl( 'defs' );
			defs.appendChild( buildGrainFilter( id + '-grain', false ) );
			svg.appendChild( defs );
			path.setAttribute( 'filter', 'url(#' + id + '-grain)' );
		}
		svg.appendChild( path );
		return { svg: svg, path: path };
	}

	// Clip mode: specks only, full size, so the container's own background
	// colour shows through; the container's clip cuts it to the shape.
	function buildGrainLayer( id ) {
		var svg = svgEl( 'svg', { 'class': 'framify-organic__deco framify-organic__grain', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' } );
		var defs = svgEl( 'defs' );
		defs.appendChild( buildGrainFilter( id + '-grain', true ) );
		svg.appendChild( defs );
		svg.appendChild( svgEl( 'rect', { width: '100', height: '100', fill: '#fff', filter: 'url(#' + id + '-grain)' } ) );
		return svg;
	}
```

- [ ] **Step 3: JS, `holdLayer` and the clip branch**

Add this method directly after `warnCustom`:

```js
			// Deco and grain layers sit at z-index -1 inside the container: make
			// it a stacking context (and a positioning context if it's static).
			holdLayer: function ( el, layer ) {
				var madeRelative = 'static' === window.getComputedStyle( el ).position;
				if ( madeRelative ) {
					el.style.position = 'relative';
				}
				el.classList.add( 'framify-organic-container' );
				el.insertBefore( layer, el.firstChild );
				this.fx.cleanup.push( function () {
					layer.remove();
					el.classList.remove( 'framify-organic-container' );
					if ( madeRelative ) {
						el.style.position = '';
					}
				} );
			},
```

In `setupContainer()`, clip branch, directly before its `return;`, insert:

```js
					if ( 'yes' === s.framify_org_clip_grain ) {
						this.holdLayer( el, buildGrainLayer( id ) );
					}
```

In the deco branch, replace everything from `var madeRelative = ...` down to the end of the method's last `fx.cleanup.push( ... );` with:

```js
				this.holdLayer( el, deco.svg );

				// In deco mode the deco IS the shape, so it uses the main placement.
				fx.deco = { svg: deco.svg, prefix: '', defaults: MAIN_BOX, family: fx.family, edge: fx.edge, anchor: null };
				fx.parts.push( { pair: main, path: deco.path } );
```

Run: `node --check assets/framify-elementor.js`. Expected: no output.

- [ ] **Step 4: CSS**

Append to `assets/framify-elementor.css`:

```css
/* Clip-mode grain: fills the container; the container's clip cuts it. */
.framify-organic__grain {
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
}
```

- [ ] **Step 5: Build the "Jack Russell" test composition**

In the editor:

```js
async () => {
  const img = elementor.getContainer( 'fo00003' ).settings.get( 'image' );
  const doc = elementor.getPreviewContainer();
  await $e.run( 'document/elements/create', { container: doc, model: { elType: 'container', settings: { _element_id: 'fo-jr', min_height: { unit: 'px', size: 460, sizes: [] }, background_background: 'classic', background_color: '#F2C53D', framify_org_enable: 'yes', framify_org_mode: 'clip', framify_org_shape: 'meadow', framify_org_clip_grain: 'yes' } } } );
  const jr = elementor.getContainer( elementor.$preview[ 0 ].contentDocument.getElementById( 'fo-jr' ).dataset.id );
  $e.run( 'document/elements/create', { container: jr, model: { elType: 'widget', widgetType: 'image', settings: { image: img, _element_id: 'fo-jr-dog', width: { unit: '%', size: 50, sizes: [] } } } } );
  await $e.run( 'document/save/draft' );
  return 'created';
}
```

The `fo00003` fallback rule in Global Constraints applies.

- [ ] **Step 6: Verify in the preview**

```js
async () => {
  const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
  document.documentElement.style.scrollBehavior = 'auto';
  const jr = document.getElementById( 'fo-jr' );
  jr.scrollIntoView( { block: 'center', behavior: 'instant' } );
  await wait( 500 );
  const layer = jr.firstElementChild;
  const dog = document.querySelector( '#fo-jr-dog img' );
  const d = dog.getBoundingClientRect();
  return {
    containerClipped: /url\(/.test( jr.style.clipPath ),
    grainIsFirstChild: !! layer && layer.classList.contains( 'framify-organic__grain' ),
    grainUnderContent: '-1' === getComputedStyle( layer ).zIndex,
    grainSpecksOnly: ! layer.querySelector( 'feMerge' ) && !! layer.querySelector( 'rect[filter]' ),
    dogOnTop: document.elementFromPoint( d.left + d.width / 2, d.top + d.height / 2 ) === dog,
    backgroundKept: 'rgb(242, 197, 61)' === getComputedStyle( jr ).backgroundColor
  };
}
```

Expected: every value `true`. `browser_console_messages` shows no errors.

Then regression-check the existing `fo-yellow` deco container: its `:scope > .framify-organic__deco` path still has the `swell` shape, and the container still has the class `framify-organic-container`.

- [ ] **Step 7: Visual check (frontend-design)**

Screenshot `fo-jr` at 1280 and at 375 wide. Compare it with the user's reference compositions (`.../images/70.png`, `.../images/71.png`) for character:
- The textured yellow fill is cut to a flowing shape with one straight side.
- The grain reads as chalky, not noisy.
- The child image is cut by the same edge.

Report the verdict. Tune nothing in code here; describe any mismatch.

- [ ] **Step 8: ASCII check**

Use the Grep tool with pattern `[^\x00-\x7F]` on `framify-elementor.php`, `assets/framify-elementor.js` and `assets/framify-elementor.css`. Expected: no matches.

---

### Task 5: Docs, editor pass and final visual

**Files:**
- Modify: `CLAUDE.md` (the "### Elementor module" section)
- Modify: `framify-elementor.php` (file docblock)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation and screenshots.

- [ ] **Step 1: Docs**

In `framify-elementor.php`, replace the docblock bullet line ` * - Organic Shape (Image widget + Containers): clip to, or place behind, a` and the lines that continue that bullet, up to the ` * - Float` line, with:

```php
 * - Organic Shape (Image widget + Containers): clip to, or place behind, a
 *   Blob, a Wavy or a hand-placed Flow shape (Wavy and Flow keep one
 *   straight "flat edge" for bleeding off the page), or a pasted Custom SVG,
 *   with responsive Placement, optional spring motion on hover / scroll-in /
 *   loop, a coloured grainy deco shape, and grain in Container Clip mode.
```

In `CLAUDE.md`, "### Elementor module" section, add these bullets after the existing ones:

```markdown
- **Flow family** (`flow_presets()`): hand-placed anchors from (100,0) round to (100,100), drawn by `smooth_path( $points, false )`; hover = the same anchors nudged <= 6 units. No free variant, so Flat edge "None" means right. Tune anchors only; the CLI test guards corner pins, 8-14 anchors and drift.
- **Auto flat edge** only picks a side the placement box actually reaches (`box.x <= 0` / `box.x + box.w >= 1`); otherwise Wavy drops the edge and Flow falls back to the side it touches, else right.
- **Custom shape** (`framify_org_shape = custom`, `framify_org_custom_svg`): parsed in the browser (`parseCustom`). Security rule: only path data matching the SVG path character set is kept, and only via `setAttribute('d')`; pasted markup is never inserted. Fitted into the 0-100 box by `customTransform()`, which takes the place of the edge transform as `fx.inner`. Static (no morph); not offered for the Image widget's deco.
- **Clip-mode grain** (`framify_org_clip_grain`, default off): a specks-only layer (`buildGrainLayer`) as the clipped container's first child at z-index -1; shares `buildGrainFilter()` with the deco blob.
- **`DEFAULT_SHAPE` must stay a Blob**: the Flat edge condition checks the saved shape, while JS falls back to the default shape.
- **`dev/` is development-only** (CLI tests, guarded by `PHP_SAPI`); it can be left out when copying the plugin to a live site.
```

Also in `CLAUDE.md`: if the existing "Two shape families" bullet exists, change its first words to "**Three built-in shape families (plus Custom).**" and add ", and Flow (hand-placed anchors, below)" after the Wavy description in that sentence. Use Read to see the exact current text first.

Run: Grep with `[^\x00-\x7F]` on `framify-elementor.php`. Expected: no matches. For `CLAUDE.md`, only the new lines must be ASCII; check them by eye or by Grep with `-n` limited to the new line numbers.

- [ ] **Step 2: Editor pass (real UI clicks, nothing saved)**

In the editor, select `fo-flow-r` and open the Framify tab. Then:
1. The Shape picker shows 21 tiles; the Flow tiles are wide and the last tile is the dashed Custom.
2. Flat edge is visible. Choose "Left": within 500 ms the preview's clip transform ends with `translate(100 0) scale(-1 1)`.
3. Choose Custom: Flat edge hides and the SVG box shows.
4. Select `fo-jr` (a Container): Mode "Clip whole container" shows the Grain texture switch. Switch the Mode to "Deco blob behind content": the clip Grain switch hides, and the deco Grain switch shows.
5. Check `browser_console_messages`: expect no errors.

Undo everything and leave without saving.

- [ ] **Step 3: Final screenshots (frontend-design)**

From the `wp_preview` URL, take full-page screenshots at 1280, 768 and 375 wide, plus one close-up each of `fo-flow-r` mid-hover and `fo-jr`. Save them to the scratchpad path in Global Constraints. Write an honest verdict against the reference compositions.

---

## Self-review notes (plan author)

- **Spec coverage:**
  - Flow geometry and picker: Task 1
  - Flat edge for Flow, the Auto fix, and every call site passing the box: Task 2
  - Custom controls, parsing, rendering, errors and the security rule: Task 3
  - Clip grain and the shared filter: Task 4
  - Housekeeping (single `edgeTransform` call via `inner`, derived test ids and no `method_exists`, dropping the resize listener): Tasks 1-2
  - The CLAUDE.md items: Task 5
  - The spec's test list is spread across Tasks 1-5
- **Names used across tasks:**
  - Task 1: `flow_presets` / `flow_ids` / `shape_options( $with_custom )`
  - Task 2: `resolveEdge( family, setting, box )`, `clipTransform( box, inner, zoom, origin )`, `fx.inner`
  - Task 3: `parseCustom` / `customBox` / `customTransform` / `mainPair` / `warnCustom`
  - Task 4: `buildGrainFilter( filterId, specksOnly )` / `buildGrainLayer( id )` / `holdLayer( el, layer )`
