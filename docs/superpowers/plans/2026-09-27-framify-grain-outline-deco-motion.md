# Framify Grain Section, Outlined Deco and Deco Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Always collaborate with /feature-dev:feature-dev (workflow + review) and /frontend-design:frontend-design (every visual judgement).

**Goal:** Give Framify's Organic Shape module three things:
- its own Grain section, with an amount and a per-element random pattern
- a Solid or Outline style for the deco blob
- independent motion for the Image widget's deco blob

**Architecture:**
- **Grain options** (a cut threshold and a seed) are computed per element and passed into the one shared grain filter builder.
- **The deco's look** (solid fill with grain, or a non-scaling pixel stroke) is decided by one `decoLook()` helper.
- **Motion** runs on two animation channels, `main` and `deco`. Each render part follows its own channel, and deco rotation is a CSS transform on the deco svg.

**Tech Stack:** WordPress plugin PHP (Elementor 4.2.4 controls API) and vanilla JS (ES5 style, IIFE). SVG filters and strokes. Tests are the PHP CLI script plus Playwright browser checks.

**Spec:** `docs/superpowers/specs/2026-09-27-framify-grain-outline-deco-motion-design.md`

## Global Constraints

**Location and workflow**
- Plugin root: `c:/Users/Admin/Local Sites/business-directory/app/public/wp-content/plugins/framify/`. All paths below are relative to it.
- Not a git repo: there are **no commit steps**. Each task's checkpoint is its passing verification.

**Code rules**
- Source files are pure ASCII. Check with the Grep tool, pattern `[^\x00-\x7F]` (`grep -P` is broken in this Git Bash); it must find no matches.
- Edit with the Edit/Write tools only. Never round-trip files through PowerShell `Get-Content` / `Set-Content`.
- JS: `var`, one IIFE, `'use strict'`, no modules.
- Text domain `'framify'`. Assets are versioned by `filemtime()`, so there is no version bump.
- Control ids start with `framify_org_`.
- The existing ids `framify_org_deco_grain` and `framify_org_clip_grain` must stay unchanged, so saved values carry over.

**Test site (Aberdeen local)**
- It loads this plugin through a junction. Playwright is logged in as the local admin. Do not start or stop the Local app.
- Editor: `http://aberdeen-taxi-knowledge.local/wp-admin/post.php?post=145&action=elementor`. Take over a stale lock if asked.
- Page 145 is published. For previews use `elementor.config.document.urls.wp_preview`, evaluated in the editor.
- Saving test elements with `$e.run( 'document/save/draft' )` is part of these steps. If the permission system denies it, stop and report BLOCKED: do not work around it.
- Never publish. Never save UI experiments. Accepting a beforeunload dialog (leaving without saving) is fine.
- On this install a **widget** cannot be created at the document root.
  - Create a container at the root first, then create widgets inside it, with one element per `document/elements/create` call.
  - `elementor.getContainer( id )` takes Elementor's internal id (the preview element's `data-id`), not the CSS `_element_id`.
- The image setting for test widgets comes from `elementor.getContainer( 'fo00003' ).settings.get( 'image' )`. If that container is missing, use the image setting of the widget whose preview element id is `fo-nest`.
- Before scroll-dependent checks, set `document.documentElement.style.scrollBehavior = 'auto'`. Wait at least 3 s for a 1.5 s animation.
- Screenshots save only under `d:/Local Sites/aberdeen-taxi-knowledge/app/public/wp-content/`. Copy the ones you keep to `C:/Users/Admin/AppData/Local/Temp/claude/d--Local-Sites-aberdeen-taxi-knowledge-app-public-wp-content/50e79500-63e0-4288-b81a-6d7cce9413df/scratchpad/sdd4/`, then delete the PNGs you created in wp-content.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `framify-elementor.php` | Modify | Grain section, deco style controls, deco motion controls |
| `assets/framify-elementor.js` | Modify | `grainOptions` / `elementSeed`, grain filter args, `decoLook` / `buildDeco`, animation channels, deco rotate |
| `assets/framify-elementor.css` | Modify | Deco svg transform origin |
| `CLAUDE.md` | Modify | Docs |

---

### Task 1: Grain section with amount and pattern

**Files:**
- Modify: `framify-elementor.php`:
  - `register_controls()`: remove the `framify_org_clip_grain` block (about lines 415-423) and add a call after `end_controls_section()` (about line 512)
  - `register_deco_controls()`: remove `framify_org_deco_grain` (about lines 561-566)
  - add the new `register_grain_controls()`
- Modify: `assets/framify-elementor.js`:
  - after `grainOn()` (about line 121), add `grainOptions` / `elementSeed`
  - `buildGrainFilter` (about 545)
  - `buildDeco` (about 559), `buildGrainLayer` (about 574)
  - the callers in `setupImage` (about 791) and `setupContainer` (about 819, 824)

**Interfaces:**
- Consumes: `grainOn( s )`, `number()` and `svgEl()`.
- Produces:
  - `grainOptions( s, el )` returns `{ cut: number, seed: number }`.
  - `elementSeed( el )` returns a number from 1 to 997, or 7 when the element has no `data-id`.
  - `buildGrainFilter( filterId, specksOnly, frequency, grain )`.
  - `buildGrainLayer( id, grain )`.
  - `buildDeco( id, d, color, grain )`, where `grain` is a `grainOptions` result or `null`. Task 2 replaces this signature.
  - Settings `framify_org_grain_amount` and `framify_org_grain_pattern`.

- [ ] **Step 1: PHP, move grain into its own section**

In `register_controls()`, delete this whole block:

```php
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

In `register_deco_controls()`, delete the `framify_org_deco_grain` control (the last `add_control` in that method).

In `register_controls()`, replace the lines

```php
        $this->register_deco_controls( $element, $is_container, $on );

        $element->end_controls_section();
    }
```

with:

```php
        $this->register_deco_controls( $element, $is_container, $on );

        $element->end_controls_section();

        $this->register_grain_controls( $element, $is_container );
    }

    /**
     * Grain: its own section, so texture is set in one place for whatever
     * is filled (the deco blob, or a container's clip fill). The switch ids
     * are unchanged from when they lived in the Organic Shape section, so
     * saved values carry over.
     */
    private function register_grain_controls( $element, $is_container ) {
        $cm = 'Elementor\Controls_Manager';
        $on = array( 'framify_org_enable' => 'yes' );

        $element->start_controls_section( 'framify_grain_section', array(
            'label'     => esc_html__( 'Grain', 'framify' ),
            'tab'       => self::TAB,
            'condition' => $on,
        ) );

        $element->add_control( 'framify_org_deco_grain', $this->live( array(
            'label'     => esc_html__( 'Grain on deco blob', 'framify' ),
            'type'      => $cm::SWITCHER,
            'default'   => 'yes',
            'condition' => $on + ( $is_container ? array( 'framify_org_mode' => 'deco' ) : array( 'framify_org_deco' => 'yes' ) ),
        ) ) );

        if ( $is_container ) {
            // Off by default: speckle over a container's background photo is
            // rarely wanted.
            $element->add_control( 'framify_org_clip_grain', $this->live( array(
                'label'       => esc_html__( 'Grain on container fill', 'framify' ),
                'type'        => $cm::SWITCHER,
                'default'     => '',
                'description' => esc_html__( 'Chalky speckle over the container background, under its content.', 'framify' ),
                'condition'   => $on + array( 'framify_org_mode' => 'clip' ),
            ) ) );
        }

        $element->add_control( 'framify_org_grain_amount', $this->live( array(
            'label'       => esc_html__( 'Grain amount', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 'px' ),
            'range'       => array( 'px' => array( 'min' => 0, 'max' => 100, 'step' => 1 ) ),
            'default'     => array( 'unit' => 'px', 'size' => 50 ),
            'description' => esc_html__( 'Applies wherever grain is on.', 'framify' ),
            'condition'   => $on,
        ) ) );

        $element->add_control( 'framify_org_grain_pattern', $this->live( array(
            'label'       => esc_html__( 'Pattern', 'framify' ),
            'type'        => $cm::NUMBER,
            'min'         => 0,
            'max'         => 999,
            'step'        => 1,
            'default'     => 0,
            'description' => esc_html__( '0 gives every element its own random speckle. Any other number fixes the pattern.', 'framify' ),
            'condition'   => $on,
        ) ) );

        $element->end_controls_section();
    }
```

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`
Expected: `No syntax errors detected`, then `ALL PASSED`.

- [ ] **Step 2: JS, grain options**

Directly after the `grainOn` function, insert:

```js
	// Grain amount and pattern from the Grain section. cut is the colour
	// matrix's alpha offset: amount 50 = 0.78, the original look; 0 gives a
	// few faint specks, 100 heavy chalk. Pattern 0 = a speckle of the
	// element's own, seeded from its Elementor id so it stays the same
	// across reloads.
	function grainOptions( s, el ) {
		var amount = Math.max( 0, Math.min( 100, number( s.framify_org_grain_amount, 50 ) ) );
		var pattern = Math.round( number( s.framify_org_grain_pattern, 0 ) );
		return {
			cut: Math.round( ( 1.11 - 0.0066 * amount ) * 1000 ) / 1000,
			seed: pattern > 0 ? pattern : elementSeed( el )
		};
	}

	function elementSeed( el ) {
		var id = ( el && el.getAttribute( 'data-id' ) ) || '';
		if ( ! id ) {
			return 7;
		}
		var h = 0;
		for ( var i = 0; i < id.length; i++ ) {
			h = ( h * 31 + id.charCodeAt( i ) ) % 997;
		}
		return h + 1;
	}
```

- [ ] **Step 3: JS, grain filter arguments**

In `buildGrainFilter`:
- Change the signature to `function buildGrainFilter( filterId, specksOnly, frequency, grain ) {`.
- Add as its first line: `grain = grain || { cut: 0.78, seed: 7 };`.
- In the `feTurbulence` attributes, replace `seed: '7'` with `seed: String( grain.seed )`.
- In the `feColorMatrix` attributes, replace `values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.6 0 0 0 -0.78'` with `values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.6 0 0 0 ' + ( -grain.cut )`.
- Add `grain = { cut, seed } from grainOptions()` to the function's comment block.

In `buildDeco`, replace `defs.appendChild( buildGrainFilter( id + '-grain', false ) );` with `defs.appendChild( buildGrainFilter( id + '-grain', false, null, grain ) );`. The `grain` argument is now either `null` or a `grainOptions` object, so the existing `if ( grain )` check stays.

Change `buildGrainLayer`:
- Signature: `function buildGrainLayer( id, grain ) {`
- Replace `buildGrainFilter( id + '-grain', true, '0.09' )` with `buildGrainFilter( id + '-grain', true, '0.09', grain )`.

Callers:
- In `setupImage`, replace `buildDeco( id, decoPair.rest.d, s.framify_org_deco_color, grainOn( s ) )` with `buildDeco( id, decoPair.rest.d, s.framify_org_deco_color, grainOn( s ) ? grainOptions( s, el ) : null )`.
- In `setupContainer`, replace `buildDeco( id, main.rest.d, s.framify_org_deco_color, grainOn( s ) )` with `buildDeco( id, main.rest.d, s.framify_org_deco_color, grainOn( s ) ? grainOptions( s, el ) : null )`.
- In `setupContainer`, replace `buildGrainLayer( id )` with `buildGrainLayer( id, grainOptions( s, el ) )`.

Run: `node --check assets/framify-elementor.js`. Expected: no output.

- [ ] **Step 4: Browser test elements**

In the editor, run with `browser_evaluate`:

```js
async () => {
  const img = elementor.getContainer( 'fo00003' ).settings.get( 'image' );
  await $e.run( 'document/elements/create', { container: elementor.getPreviewContainer(), model: { elType: 'container', settings: { _element_id: 'fo-gr-wrap', flex_direction: 'row', flex_wrap: 'wrap' } } } );
  const wrap = elementor.getContainer( elementor.$preview[ 0 ].contentDocument.getElementById( 'fo-gr-wrap' ).dataset.id );
  const add = ( cssId, extra ) => $e.run( 'document/elements/create', { container: wrap, model: { elType: 'widget', widgetType: 'image', settings: Object.assign( { image: img, _element_id: cssId, framify_org_enable: 'yes', framify_org_shape: 'pebble', framify_org_deco: 'yes', framify_org_deco_color: '#FF5A44' }, extra ) } } );
  add( 'fo-gr-a', {} );
  add( 'fo-gr-b', {} );
  add( 'fo-gr-fixed', { framify_org_grain_pattern: 42 } );
  add( 'fo-gr-heavy', { framify_org_grain_amount: { unit: 'px', size: 100, sizes: [] } } );
  add( 'fo-gr-light', { framify_org_grain_amount: { unit: 'px', size: 0, sizes: [] } } );
  await $e.run( 'document/save/draft' );
  return 'created';
}
```

- [ ] **Step 5: Verify in the preview**

Navigate to `wp_preview` at 1280x900 and run:

```js
() => {
  const f = ( id ) => {
    const svg = document.getElementById( id ).querySelector( '.framify-organic__deco' );
    return { seed: svg.querySelector( 'feTurbulence' ).getAttribute( 'seed' ), matrix: svg.querySelector( 'feColorMatrix' ).getAttribute( 'values' ) };
  };
  const a = f( 'fo-gr-a' ), b = f( 'fo-gr-b' );
  const jrLayer = document.querySelector( '#fo-jr > .framify-organic__grain' );
  return {
    autoSeedsDiffer: a.seed !== b.seed && +a.seed >= 1 && +a.seed <= 997,
    defaultAmount: / -0\.78$/.test( a.matrix ),
    fixed: '42' === f( 'fo-gr-fixed' ).seed,
    heavy: / -0\.45$/.test( f( 'fo-gr-heavy' ).matrix ),
    light: / -1\.11$/.test( f( 'fo-gr-light' ).matrix ),
    clipLayerStillWorks: !! jrLayer && !! jrLayer.querySelector( 'feTurbulence[seed]' ),
    yellowDecoStillGrainy: !! document.querySelector( '#fo-yellow > .framify-organic__deco filter' )
  };
}
```

Expected: every value `true`. `fo-jr` and `fo-yellow` are existing test containers. `fo-jr`'s saved mode may currently be `deco` from an earlier autosave experiment. If `clipLayerStillWorks` is false for that reason, check `#fo-jr`'s mode in the editor and report it, not treating it as a failure of this task. `browser_console_messages` shows no errors.

- [ ] **Step 6: ASCII check**

Use the Grep tool with pattern `[^\x00-\x7F]` on `framify-elementor.php` and `assets/framify-elementor.js`. Expected: no matches.

---

### Task 2: Deco style, Solid or Outline

**Files:**
- Modify: `framify-elementor.php`: `register_deco_controls()` (style, outline colour, outline width; condition on colour); `register_grain_controls()` (deco grain condition)
- Modify: `assets/framify-elementor.js`: a new `decoLook()` after `elementSeed()`; replace `buildDeco`; update its two callers
- Modify: `assets/framify-elementor.css`

**Interfaces:**
- Consumes (from Task 1): `grainOn`, `grainOptions( s, el )`, `buildGrainFilter( filterId, specksOnly, frequency, grain )`.
- Produces:
  - `decoLook( s, el )` returns `{ outline: bool, color, outlineColor, outlineWidth, grain }`.
  - `buildDeco( id, d, look )` returns `{ svg, path }`.
  - Settings `framify_org_deco_style`, `framify_org_deco_outline_color`, `framify_org_deco_outline_width`.

- [ ] **Step 1: PHP controls**

In `register_deco_controls()`, directly before `$element->add_control( 'framify_org_deco_color', ...`, insert:

```php
        $element->add_control( 'framify_org_deco_style', $this->live( array(
            'label'     => esc_html__( 'Style', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'solid',
            'options'   => array(
                'solid'   => esc_html__( 'Solid', 'framify' ),
                'outline' => esc_html__( 'Outline', 'framify' ),
            ),
            'condition' => $deco_on,
        ) ) );

        $outline_on = $deco_on + array( 'framify_org_deco_style' => 'outline' );

        $element->add_control( 'framify_org_deco_outline_color', $this->live( array(
            'label'     => esc_html__( 'Outline color', 'framify' ),
            'type'      => $cm::COLOR,
            'default'   => '#1E1E1E',
            'condition' => $outline_on,
        ) ) );

        $element->add_control( 'framify_org_deco_outline_width', $this->live( array(
            'label'      => esc_html__( 'Outline width (px)', 'framify' ),
            'type'       => $cm::SLIDER,
            'size_units' => array( 'px' ),
            'range'      => array( 'px' => array( 'min' => 1, 'max' => 10, 'step' => 0.5 ) ),
            'default'    => array( 'unit' => 'px', 'size' => 2 ),
            'condition'  => $outline_on,
        ) ) );
```

In the `framify_org_deco_color` control, replace `'condition' => $deco_on,` with `'condition' => $deco_on + array( 'framify_org_deco_style!' => 'outline' ),`.

In `register_grain_controls()`, in the `framify_org_deco_grain` control, replace its `'condition'` line with:

```php
            // Grain on a thin outline is invisible, so only offer it for Solid.
            'condition' => $on + array( 'framify_org_deco_style!' => 'outline' ) + ( $is_container ? array( 'framify_org_mode' => 'deco' ) : array( 'framify_org_deco' => 'yes' ) ),
```

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`. Expected: no syntax errors and `ALL PASSED`.

- [ ] **Step 2: JS, `decoLook` and `buildDeco`**

Directly after the `elementSeed` function, insert:

```js
	// What the deco blob looks like: a grainy colour fill, or a pixel-width
	// outline (grain is skipped: on a thin line it would be invisible).
	function decoLook( s, el ) {
		var outline = 'outline' === s.framify_org_deco_style;
		return {
			outline: outline,
			color: s.framify_org_deco_color || '#F2C53D',
			outlineColor: s.framify_org_deco_outline_color || '#1E1E1E',
			outlineWidth: number( s.framify_org_deco_outline_width, 2 ),
			grain: ! outline && grainOn( s ) ? grainOptions( s, el ) : null
		};
	}
```

Replace the whole `buildDeco` function with:

```js
	function buildDeco( id, d, look ) {
		var svg = svgEl( 'svg', { 'class': 'framify-organic__deco', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' } );
		var path = svgEl( 'path', { d: d } );
		if ( look.outline ) {
			// non-scaling-stroke: the svg is stretched with
			// preserveAspectRatio="none", so a plain stroke would be thicker
			// along the stretched axis. This keeps a true pixel width.
			path.setAttribute( 'fill', 'none' );
			path.setAttribute( 'stroke', look.outlineColor );
			path.setAttribute( 'stroke-width', String( look.outlineWidth ) );
			path.setAttribute( 'stroke-linejoin', 'round' );
			path.setAttribute( 'vector-effect', 'non-scaling-stroke' );
		} else {
			path.setAttribute( 'fill', look.color );
			if ( look.grain ) {
				var defs = svgEl( 'defs' );
				defs.appendChild( buildGrainFilter( id + '-grain', false, null, look.grain ) );
				svg.appendChild( defs );
				path.setAttribute( 'filter', 'url(#' + id + '-grain)' );
			}
		}
		svg.appendChild( path );
		return { svg: svg, path: path };
	}
```

Callers:
- In `setupImage`, replace `buildDeco( id, decoPair.rest.d, s.framify_org_deco_color, grainOn( s ) ? grainOptions( s, el ) : null )` with `buildDeco( id, decoPair.rest.d, decoLook( s, el ) )`.
- In `setupContainer`, replace `buildDeco( id, main.rest.d, s.framify_org_deco_color, grainOn( s ) ? grainOptions( s, el ) : null )` with `buildDeco( id, main.rest.d, decoLook( s, el ) )`.

Run: `node --check assets/framify-elementor.js`. Expected: no output.

- [ ] **Step 3: CSS**

In `assets/framify-elementor.css`, add inside the existing `.framify-organic__deco { ... }` rule:

```css
	transform-origin: 50% 50%;
```

Task 3 rotates the deco svg around its centre.

- [ ] **Step 4: Browser test element**

In the editor, add one widget to the existing `fo-gr-wrap` container:

```js
async () => {
  const img = elementor.getContainer( 'fo00003' ).settings.get( 'image' );
  const wrap = elementor.getContainer( elementor.$preview[ 0 ].contentDocument.getElementById( 'fo-gr-wrap' ).dataset.id );
  await $e.run( 'document/elements/create', { container: wrap, model: { elType: 'widget', widgetType: 'image', settings: { image: img, _element_id: 'fo-dm-outline', framify_org_enable: 'yes', framify_org_shape: 'pebble', framify_org_trigger: 'hover', framify_org_deco: 'yes', framify_org_deco_shape: 'cloud', framify_org_deco_style: 'outline' } } } );
  await $e.run( 'document/save/draft' );
  return 'created';
}
```

- [ ] **Step 5: Verify in the preview**

```js
() => {
  const p = document.querySelector( '#fo-dm-outline .framify-organic__deco path' );
  const solid = document.querySelector( '#fo-gr-a .framify-organic__deco path' );
  return {
    outlineNoFill: 'none' === p.getAttribute( 'fill' ),
    outlineStroke: '#1E1E1E' === p.getAttribute( 'stroke' ) && '2' === p.getAttribute( 'stroke-width' ),
    nonScaling: 'non-scaling-stroke' === p.getAttribute( 'vector-effect' ),
    outlineNoGrain: ! p.getAttribute( 'filter' ),
    solidStillFilled: '#FF5A44' === solid.getAttribute( 'fill' ) && !! solid.getAttribute( 'filter' ),
    rendered: p.getBoundingClientRect().width > 50
  };
}
```

Expected: every value `true`. The console shows no errors.

- [ ] **Step 6: ASCII check**

Use the Grep tool with `[^\x00-\x7F]` on the PHP, JS and CSS files. Expected: no matches.

---

### Task 3: Separate deco motion (two channels)

**Files:**
- Modify: `framify-elementor.php`: `register_deco_controls()`, adding the deco motion controls (Image widget only)
- Modify: `assets/framify-elementor.js`, handler:
  - the `fx` literal in `setup()` (about 713-733) and the trigger binding at the end of `setup()` (about 751-753)
  - `setupImage` deco part (about 795-796)
  - `setupContainer` parts (about 812, 831)
  - `place()` end (about 911)
  - `bindTrigger` (about 914-962), `animate` (about 964-985), `startLoop` / `stopLoop` (about 987-1011), `render` (about 1013-1045), `teardown` (about 1047-1059)

**Interfaces:**
- Consumes (from Task 2): the deco svg with `transform-origin: 50% 50%` (CSS), and `fx.deco.svg`.
- Produces:
  - `fx.channels.main` and `fx.channels.deco`, each `{ value, raf, loopTimer, looping }`.
  - `part.channel` (`'main'` | `'deco'`).
  - `fx.deco.channel` and `fx.deco.rotate`.
  - `bindTrigger( el, channel, trigger, duration, period )`, `animate( channel, target, duration, ease )`, `startLoop( channel, duration )`, `stopLoop( channel )`, and `render()` with no arguments.
  - Settings `framify_org_deco_trigger`, `framify_org_deco_duration`, `framify_org_deco_spring`, `framify_org_deco_rotate`.

- [ ] **Step 1: PHP controls**

In `register_deco_controls()`, replace:

```php
        // Container "deco" mode positions the deco with the main Placement.
        if ( ! $is_container ) {
            $this->register_placement_controls( $element, 'deco_', array( 'w' => 108, 'h' => 108, 'ox' => 6, 'oy' => 6 ), $deco_on );
        }
```

with:

```php
        // Container "deco" mode positions the deco with the main Placement,
        // and moves with the main Motion: there the deco IS the shape.
        if ( ! $is_container ) {
            $this->register_placement_controls( $element, 'deco_', array( 'w' => 108, 'h' => 108, 'ox' => 6, 'oy' => 6 ), $deco_on );
            $this->register_deco_motion_controls( $element, $deco_on );
        }
```

Add this method after `register_deco_controls()`:

```php
    /**
     * Deco motion (Image widget): its own trigger, timing and a turn, so
     * the deco blob can move differently from the image. "Same as image"
     * keeps the original behaviour of following the image's motion.
     */
    private function register_deco_motion_controls( $element, $deco_on ) {
        $cm = 'Elementor\Controls_Manager';

        $element->add_control( 'framify_org_deco_motion_heading', array(
            'label'     => esc_html__( 'Deco motion', 'framify' ),
            'type'      => $cm::HEADING,
            'separator' => 'before',
            'condition' => $deco_on,
        ) );

        $element->add_control( 'framify_org_deco_trigger', $this->live( array(
            'label'     => esc_html__( 'Deco trigger', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'same',
            'options'   => array(
                'same'   => esc_html__( 'Same as image', 'framify' ),
                'none'   => esc_html__( 'None (static)', 'framify' ),
                'hover'  => esc_html__( 'On hover', 'framify' ),
                'inview' => esc_html__( 'Once, when scrolled into view', 'framify' ),
                'loop'   => esc_html__( 'Continuous gentle loop', 'framify' ),
            ),
            'condition' => $deco_on,
        ) ) );

        $element->add_control( 'framify_org_deco_duration', $this->live( array(
            'label'      => esc_html__( 'Deco duration (ms)', 'framify' ),
            'type'       => $cm::SLIDER,
            'size_units' => array( 'px' ),
            'range'      => array( 'px' => array( 'min' => 400, 'max' => 5000, 'step' => 100 ) ),
            'default'    => array( 'unit' => 'px', 'size' => 2400 ),
            'condition'  => $deco_on + array( 'framify_org_deco_trigger!' => array( 'same', 'none' ) ),
        ) ) );

        $element->add_control( 'framify_org_deco_spring', $this->live( array(
            'label'     => esc_html__( 'Deco spring', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'normal',
            'options'   => array(
                'subtle' => esc_html__( 'Subtle', 'framify' ),
                'normal' => esc_html__( 'Normal', 'framify' ),
                'bouncy' => esc_html__( 'Bouncy', 'framify' ),
            ),
            'condition' => $deco_on + array( 'framify_org_deco_trigger!' => array( 'same', 'none', 'loop' ) ),
        ) ) );

        $element->add_control( 'framify_org_deco_rotate', $this->live( array(
            'label'       => esc_html__( 'Rotate (deg)', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 'px' ),
            'range'       => array( 'px' => array( 'min' => 0, 'max' => 45, 'step' => 1 ) ),
            'default'     => array( 'unit' => 'px', 'size' => 0 ),
            'description' => esc_html__( 'Turns the deco blob as it moves, so it reads differently from the image.', 'framify' ),
            'condition'   => $deco_on + array( 'framify_org_deco_trigger!' => 'none' ),
        ) ) );
    }
```

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`. Expected: no syntax errors and `ALL PASSED`.

- [ ] **Step 2: JS, channels in `setup()` and the parts**

In the `fx` literal in `setup()`, replace these four lines:

```js
					value: 0,
					raf: 0,
					loopTimer: 0,
					looping: false,
```

with:

```js
					// Two animation timelines: the image/shape, and the Image
					// widget's deco when it has its own trigger.
					channels: {
						main: { value: 0, raf: 0, loopTimer: 0, looping: false },
						deco: { value: 0, raf: 0, loopTimer: 0, looping: false }
					},
```

At the end of `setup()`, replace:

```js
				if ( ! REDUCE_MOTION ) {
					this.bindTrigger( el, s );
				}
```

with:

```js
				if ( ! REDUCE_MOTION ) {
					this.bindTrigger( el, 'main', resolveTrigger( s.framify_org_trigger, fx.family ), number( s.framify_org_duration, 1500 ), SPRING_PERIOD[ s.framify_org_spring ] );
					if ( fx.deco && 'deco' === fx.deco.channel ) {
						this.bindTrigger( el, 'deco', s.framify_org_deco_trigger, number( s.framify_org_deco_duration, 2400 ), SPRING_PERIOD[ s.framify_org_deco_spring ] );
					}
				}
```

In `setupImage`, replace:

```js
				fx.deco = { svg: deco.svg, prefix: 'deco-', defaults: DECO_BOX, family: decoFamily, edge: decoEdge, anchor: img };
				fx.parts.push( { pair: decoPair, path: deco.path } );
```

with:

```js
				// "Same as image" (the default) keeps following the main channel.
				var decoTrigger = s.framify_org_deco_trigger || 'same';
				var decoChannel = 'same' === decoTrigger ? 'main' : 'deco';
				fx.deco = {
					svg: deco.svg,
					prefix: 'deco-',
					defaults: DECO_BOX,
					family: decoFamily,
					edge: decoEdge,
					anchor: img,
					channel: decoChannel,
					rotate: 'none' === decoTrigger ? 0 : number( s.framify_org_deco_rotate, 0 )
				};
				fx.parts.push( { pair: decoPair, path: deco.path, channel: decoChannel } );
```

In `setupImage`, replace `fx.parts.push( { pair: main, path: clip.path } );` with `fx.parts.push( { pair: main, path: clip.path, channel: 'main' } );`.

In `setupContainer`, replace both `fx.parts.push( { pair: main, path: clip.path } );` and `fx.parts.push( { pair: main, path: deco.path } );` so each object also has `channel: 'main'`. In the deco-mode `fx.deco = { ... }` literal, add `channel: 'main', rotate: 0` at the end.

In `place()`, replace `this.render( fx.value );` with `this.render();`.

- [ ] **Step 3: JS, generic trigger, animation, render and teardown**

Replace the whole `bindTrigger`, `animate`, `startLoop`, `stopLoop`, `render` and `teardown` methods with:

```js
			// Binds one animation channel to a trigger on the element: hover,
			// once in view, or a loop while visible. 'none' (or no trigger)
			// binds nothing, leaving that channel at rest.
			bindTrigger: function ( el, channel, trigger, duration, period ) {
				var self = this;
				var fx = this.fx;
				if ( ! trigger || 'none' === trigger || 'same' === trigger ) {
					return;
				}
				duration = Math.max( 200, duration );
				var ease = elastic( period || SPRING_PERIOD.normal );

				if ( 'hover' === trigger ) {
					var enter = function () {
						self.animate( channel, 1, duration, ease );
					};
					var leave = function () {
						self.animate( channel, 0, duration, ease );
					};
					el.addEventListener( 'mouseenter', enter );
					el.addEventListener( 'mouseleave', leave );
					fx.cleanup.push( function () {
						el.removeEventListener( 'mouseenter', enter );
						el.removeEventListener( 'mouseleave', leave );
					} );
					return;
				}

				if ( ! ( 'IntersectionObserver' in window ) ) {
					return;
				}

				var observer = new IntersectionObserver( function ( entries ) {
					entries.forEach( function ( entry ) {
						if ( 'inview' === trigger ) {
							if ( entry.isIntersecting ) {
								self.animate( channel, 1, duration, ease );
								observer.disconnect();
							}
						} else if ( entry.isIntersecting ) {
							self.startLoop( channel, duration );
						} else {
							self.stopLoop( channel );
						}
					} );
				}, { threshold: 0.35 } );
				observer.observe( el );
				fx.cleanup.push( function () {
					observer.disconnect();
				} );
			},

			animate: function ( channel, target, duration, ease ) {
				var self = this;
				var ch = this.fx.channels[ channel ];
				var from = ch.value;
				var start = null;
				cancelAnimationFrame( ch.raf );

				var step = function ( now ) {
					if ( null === start ) {
						start = now;
					}
					var t = Math.min( 1, ( now - start ) / duration );
					ch.value = from + ( target - from ) * ease( t );
					self.render();
					if ( t < 1 ) {
						ch.raf = requestAnimationFrame( step );
					} else {
						ch.value = target;
					}
				};
				ch.raf = requestAnimationFrame( step );
			},

			startLoop: function ( channel, duration ) {
				var self = this;
				var ch = this.fx.channels[ channel ];
				if ( ch.looping ) {
					return;
				}
				ch.looping = true;
				var go = function ( target ) {
					if ( ! ch.looping ) {
						return;
					}
					self.animate( channel, target, duration, easeInOutSine );
					ch.loopTimer = setTimeout( function () {
						go( target ? 0 : 1 );
					}, duration );
				};
				go( ch.value >= 0.5 ? 0 : 1 );
			},

			stopLoop: function ( channel ) {
				var ch = this.fx.channels[ channel ];
				ch.looping = false;
				clearTimeout( ch.loopTimer );
				cancelAnimationFrame( ch.raf );
			},

			render: function () {
				var fx = this.fx;
				var value = fx.channels.main.value;
				fx.parts.forEach( function ( part ) {
					if ( part.pair.rest === part.pair.hover ) {
						// A static shape (Custom: rest and hover are the same
						// parsed path). blendPath's NUMBER tokenizer would mangle
						// packed arc flags (e.g. "a10 10 0 0110 10" becomes
						// "a10.00 10.00 0.00 110.00 10.00") and round every number
						// to 2 decimals, faceting tiny viewBox units. Use the
						// original string untouched, and only once.
						if ( part.path.getAttribute( 'd' ) !== part.pair.rest.d ) {
							part.path.setAttribute( 'd', part.pair.rest.d );
						}
					} else {
						part.path.setAttribute( 'd', blendPath( part.pair.rest, part.pair.hover, fx.channels[ part.channel ].value ) );
					}
				} );
				if ( fx.deco && fx.deco.rotate ) {
					// A CSS turn on the deco svg: it rotates in pixel space, so it
					// never shears the way a rotation inside the stretched 0-100
					// box would.
					var turn = fx.deco.rotate * fx.channels[ fx.deco.channel ].value;
					fx.deco.svg.style.transform = turn ? 'rotate(' + turn + 'deg)' : '';
				}
				if ( fx.gentle ) {
					// Gentle custom motion lives in the inner transform, shared by
					// the clip and by a container's deco path.
					fx.inner = gentleTransform( fx.gentle, value, fx.custom.box, fx.aspect );
					if ( fx.deco && ! fx.deco.prefix ) {
						fx.deco.path.setAttribute( 'transform', fx.inner );
					}
				}
				if ( fx.clip && fx.clip.box ) {
					var zoom = fx.img ? 1 + fx.zoom * Math.max( 0, value ) : 1;
					if ( fx.img ) {
						fx.img.style.transform = 1 === zoom ? '' : 'scale(' + zoom + ')';
					}
					fx.clip.path.setAttribute( 'transform', clipTransform( fx.clip.box, fx.inner, zoom, fx.clip.origin ) );
				}
			},

			teardown: function () {
				var fx = this.fx;
				if ( ! fx ) {
					return;
				}
				Object.keys( fx.channels ).forEach( function ( name ) {
					var ch = fx.channels[ name ];
					ch.looping = false;
					clearTimeout( ch.loopTimer );
					cancelAnimationFrame( ch.raf );
				} );
				fx.cleanup.forEach( function ( fn ) {
					fn();
				} );
				this.fx = null;
			}
```

The deco svg is removed on teardown (existing cleanup), so its inline transform needs no separate reset.

Run: `node --check assets/framify-elementor.js`, then Grep `assets/framify-elementor.js` for `fx\.value|fx\.raf|fx\.loopTimer|fx\.looping|render\( [a-z]`. Expected: node prints nothing, and Grep finds no matches.

- [ ] **Step 4: Browser test elements**

In the editor:

```js
async () => {
  const doc = elementor.$preview[ 0 ].contentDocument;
  const outline = elementor.getContainer( doc.getElementById( 'fo-dm-outline' ).dataset.id );
  await $e.run( 'document/elements/settings', { container: outline, settings: { framify_org_deco_trigger: 'loop', framify_org_deco_rotate: { unit: 'px', size: 8, sizes: [] }, framify_org_deco_duration: { unit: 'px', size: 2000, sizes: [] } } } );
  const img = elementor.getContainer( 'fo00003' ).settings.get( 'image' );
  const wrap = elementor.getContainer( doc.getElementById( 'fo-gr-wrap' ).dataset.id );
  const add = ( cssId, extra ) => $e.run( 'document/elements/create', { container: wrap, model: { elType: 'widget', widgetType: 'image', settings: Object.assign( { image: img, _element_id: cssId, framify_org_enable: 'yes', framify_org_shape: 'pebble', framify_org_trigger: 'hover', framify_org_deco: 'yes', framify_org_deco_shape: 'cloud' }, extra ) } } );
  add( 'fo-dm-same', {} );
  add( 'fo-dm-none', { framify_org_deco_trigger: 'none' } );
  await $e.run( 'document/save/draft' );
  return 'updated';
}
```

- [ ] **Step 5: Verify in the preview**

Navigate to `wp_preview` at 1280x900 and run:

```js
async () => {
  const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
  document.documentElement.style.scrollBehavior = 'auto';
  const clipD = ( id ) => {
    const img = document.getElementById( id ).querySelector( 'img' );
    return document.getElementById( ( img.style.clipPath.match( /#([\w-]+)/ ) || [] )[ 1 ] ).querySelector( 'path' ).getAttribute( 'd' );
  };
  const decoSvg = ( id ) => document.getElementById( id ).querySelector( '.framify-organic__deco' );
  const out = {};
  const o = document.getElementById( 'fo-dm-outline' );
  o.scrollIntoView( { block: 'center', behavior: 'instant' } );
  await wait( 300 );
  const c1 = clipD( 'fo-dm-outline' ), d1 = decoSvg( 'fo-dm-outline' ).querySelector( 'path' ).getAttribute( 'd' );
  await wait( 1200 );
  out.decoLoopsAlone = d1 !== decoSvg( 'fo-dm-outline' ).querySelector( 'path' ).getAttribute( 'd' ) && c1 === clipD( 'fo-dm-outline' );
  out.decoRotates = /rotate\(/.test( decoSvg( 'fo-dm-outline' ).style.transform );
  o.dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 3500 );
  out.imageStillHovers = c1 !== clipD( 'fo-dm-outline' );
  o.dispatchEvent( new MouseEvent( 'mouseleave' ) );

  const s = document.getElementById( 'fo-dm-same' );
  const sd1 = decoSvg( 'fo-dm-same' ).querySelector( 'path' ).getAttribute( 'd' );
  s.dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 3500 );
  out.sameFollowsImage = sd1 !== decoSvg( 'fo-dm-same' ).querySelector( 'path' ).getAttribute( 'd' );

  const n = document.getElementById( 'fo-dm-none' );
  const nd1 = decoSvg( 'fo-dm-none' ).querySelector( 'path' ).getAttribute( 'd' );
  const nc1 = clipD( 'fo-dm-none' );
  n.dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 3500 );
  out.noneStaysStill = nd1 === decoSvg( 'fo-dm-none' ).querySelector( 'path' ).getAttribute( 'd' ) && nc1 !== clipD( 'fo-dm-none' );
  return out;
}
```

Expected: every value `true`. The console shows no errors.

Then check reduced motion: run `browser_emulate_media` with `{ reducedMotion: 'reduce' }`, reload `wp_preview`, wait 2 s, and confirm that `#fo-dm-outline`'s deco svg `style.transform` is `''` and its deco `d` doesn't change over 1.5 s. Reset the emulation afterwards.

- [ ] **Step 6: ASCII check**

Use the Grep tool with `[^\x00-\x7F]` on the PHP and JS files. Expected: no matches.

---

### Task 4: Docs, editor pass and reference composition

**Files:**
- Modify: `CLAUDE.md` (the "### Elementor module" section)
- Modify: `assets/framify-elementor.js` (file docblock)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Docs**

Use Read to see the "### Elementor module" section of `CLAUDE.md`, then append these bullets:

```markdown
- **Grain section** (`register_grain_controls`, its own panel section): `framify_org_deco_grain` / `framify_org_clip_grain` (ids unchanged, moved here), `framify_org_grain_amount` (0-100, colour-matrix cut = 1.11 - 0.0066 * amount; 50 = the original 0.78) and `framify_org_grain_pattern` (0 = per-element seed from `elementSeed()`, a hash of the element's `data-id`, stable across reloads; else a fixed seed). `grainOptions()` feeds `buildGrainFilter( filterId, specksOnly, frequency, grain )`.
- **Deco style** (`framify_org_deco_style` solid | outline): `decoLook()` + `buildDeco( id, d, look )`. Outline = stroke with `vector-effect: non-scaling-stroke` (the deco svg is stretched with `preserveAspectRatio="none"`), no grain.
- **Two animation channels** (`fx.channels.main` / `.deco`): every render part has a `channel`; the Image widget's deco uses `deco` when `framify_org_deco_trigger` isn't `same`, with its own duration/spring and `framify_org_deco_rotate` applied as a CSS rotate on the deco svg (pixel space, no shear). Container deco mode always follows `main` (the deco is the shape).
```

In the JS file docblock, add one sentence: the Image widget's deco blob can be solid or outlined and can move on its own timeline (trigger, timing and rotation), separate from the image.

Check both files with the Grep tool, pattern `[^\x00-\x7F]`: the JS file must be clean, and so must the new `CLAUDE.md` lines.

- [ ] **Step 2: Editor pass (real clicks, nothing saved)**

Select `fo-dm-outline` in the editor and open the Framify tab (use `browser_snapshot` for refs). Check:
1. A separate "Grain" section exists below "Organic Shape".
2. In the Organic Shape section, with Deco Style = Outline, "Outline color" and "Outline width" show and "Color" hides. In the Grain section, "Grain on deco blob" hides.
3. Set Style to Solid: the reverse happens.
4. Deco trigger "Same as image" hides Deco duration and Deco spring. "Continuous gentle loop" shows duration but hides spring. "None" hides Rotate.
5. The console shows no errors.

Undo everything and leave without saving (accept beforeunload). If the permission system denies anything, stop and report it.

- [ ] **Step 3: Reference composition (frontend-design)**

Build a four-card row in the style of the user's reference: `C:/Users/Admin/AppData/Local/Temp/claude/d--Local-Sites-aberdeen-taxi-knowledge-app-public-wp-content/50e79500-63e0-4288-b81a-6d7cce9413df/images/72.png` (Read it first).

- **Structure:** one root container `fo-cards` (row), holding four "card" containers. Create one element per create call.
- **Each card container:**
  - about 240x240 px, Framify on, mode `deco`, Style Solid, grain on (amount about 60, pattern 0)
  - its own shape: pebble, bean, cloud, splash
  - its own colour: `#FF5A44`, `#2BBF6E`, `#FBB942`, `#FF5A44`
- **Inside each card:** one child container that fills the card (width 100%, min-height equal to the card).
  - Framify on, mode `deco`, Style Outline, width 2, colour `#1E1E1E`
  - a different shape from its card
  - Placement width and height 112
  - Trigger "Continuous gentle loop"
  - So the outline morphs on its own timeline around the static solid blob.
- **Screenshots:** save `fo-cards` (from the `wp_preview`) at rest, and one about 1 s later.

Judge it against the reference:
- the outline weight
- the speckle differing per card
- the solid blob overlapping the outline ring as in the reference
- the motion reading as calm

Describe any mismatch. Change code only if something is clearly broken, and report any change. Save the test elements (`document/save/draft`). Copy the screenshots to the scratchpad and delete the wp-content PNGs.

- [ ] **Step 4: Final checks**

Run `php dev/tests/elementor-shapes-test.php` (expect ALL PASSED) and `node --check assets/framify-elementor.js` (expect no output).

---

## Self-review notes (plan author)

- **Spec coverage:**
  - Grain section, amount, pattern and element seed: Task 1.
  - Outline style and conditions: Task 2.
  - Deco trigger, duration, spring and rotate, the channels, the "same" behaviour, "none" and reduced motion: Task 3.
  - Docs and the frontend-design check: Task 4.
  - The spec's test table is spread across Tasks 1-3; the four-card check is Task 4.
- **Names used across tasks:** `grainOptions`, `elementSeed`, `buildGrainFilter( ..., grain )`, `buildGrainLayer( id, grain )` (Task 1); `decoLook`, `buildDeco( id, d, look )` (Task 2); `fx.channels`, `part.channel`, `fx.deco.channel` / `.rotate`, `bindTrigger( el, channel, trigger, duration, period )`, `animate( channel, ... )`, `render()` (Task 3).
