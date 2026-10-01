# Framify Custom Shape Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Always collaborate with /feature-dev:feature-dev (workflow + review) and /frontend-design:frontend-design (every visual judgement).

**Goal:** When a Custom (pasted SVG) shape has a Hover, In view or Loop trigger, its outline moves too. The element chooses between two modes:
- **Liquid:** the shape is traced and its edge ripples.
- **Gentle:** the exact shape tilts and swells as a whole.

**Architecture:**
- **Gentle** keeps the raw pasted path and animates the element's inner transform (`fx.inner`) around the centre of the 0-100 box on every render.
- **Liquid** traces the validated path in the browser into evenly spaced points, one set per part, normalised to the 0-100 box. It builds a rest pose and a rippled hover pose with the same Catmull-Rom smoothing, so the existing number-blend morph animates them.
- Liquid falls back to Gentle when a paste can't be traced.

**Tech Stack:** WordPress plugin PHP (Elementor 4.2.4 controls API) and vanilla JS (ES5 style, IIFE). SVG geometry uses `getTotalLength` / `getPointAtLength`. Tests are the PHP CLI script plus Playwright browser checks.

**Spec:** `docs/superpowers/specs/2026-09-27-framify-custom-motion-design.md`

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
- Security rule (unchanged): only path data validated by `PATH_CHARS` may reach the DOM, and only through `setAttribute( 'd', ... )`. Traced paths are generated from numbers, never from pasted text.

**Test site (Aberdeen local)**
- It loads this plugin through a junction. Playwright is logged in as the local admin. Do not start or stop the Local app.
- Editor: `http://aberdeen-taxi-knowledge.local/wp-admin/post.php?post=145&action=elementor`. Take over a stale lock if asked.
- Page 145 is published. For previews use `elementor.config.document.urls.wp_preview`, evaluated in the editor.
- Saving test elements with `$e.run( 'document/save/draft' )` is part of these steps. If the permission system denies it, stop and report BLOCKED: do not work around it.
- Never publish. Never save UI experiments. Leaving the editor may raise a beforeunload dialog; accepting it (leaving without saving) is fine.
- On this install, a **widget** cannot be created directly at the document root.
  - Create a container at the root first, then create widgets inside it, with one element per `document/elements/create` call.
  - `elementor.getContainer( id )` takes Elementor's internal id (the preview element's `data-id`), not the CSS `_element_id`.
- The image setting for test widgets comes from `elementor.getContainer( 'fo00003' ).settings.get( 'image' )`. If that container is missing, use the image setting of the widget whose preview element id is `fo-nest`.
- Test paths are our own samples only (below). Never use the user's reference SVGs.
  - `PATH = 'M60 120 C 260 -40 520 200 760 90 S 1180 60 1150 380 C 1120 700 820 780 560 700 C 300 620 80 780 40 520 C 0 300 -20 200 60 120 Z'` (use with `viewBox="0 0 1200 800"`)
  - `TWO = 'M10 10h30v30h-30z M60 60h30v30h-30z'` (use with `viewBox="0 0 100 100"`)
- Before scroll-dependent checks, set `document.documentElement.style.scrollBehavior = 'auto'`. Wait at least 3 s for a 1.5 s animation.
- Screenshots save only under `d:/Local Sites/aberdeen-taxi-knowledge/app/public/wp-content/`. Copy the ones you keep to `C:/Users/Admin/AppData/Local/Temp/claude/d--Local-Sites-aberdeen-taxi-knowledge-app-public-wp-content/50e79500-63e0-4288-b81a-6d7cce9413df/scratchpad/sdd3/`, then delete the PNGs you created in wp-content.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `framify-elementor.php` | Modify | Two new Motion controls |
| `assets/framify-elementor.js` | Modify | Trigger resolution helper, Gentle transform, Liquid tracing, fallback |
| `CLAUDE.md` | Modify | Document the new behaviour |

---

### Task 1: Controls, trigger helper and Gentle motion

**Files:**
- Modify: `framify-elementor.php`: after the `framify_org_spring` control, which ends at about line 466
- Modify: `assets/framify-elementor.js`:
  - constants near the top (after `SPRING_PERIOD`)
  - new helpers after `customTransform()` (about line 209)
  - handler: `setup()` (about 457-508), `setupContainer()` deco branch (about 578-585), `bindTrigger()` (about 657-667), `render()` (about 760-784)
  - a new handler method `setupCustomMotion` after `warnCustom`

**Interfaces:**
- Consumes: `fx.custom = { d, box }`, `customTransform( box )`, `clipTransform( box, inner, zoom, origin )`, `render()`'s static-pair branch, and `REDUCE_MOTION`.
- Produces:
  - Settings: `framify_org_custom_motion` (`'liquid'` | `'gentle'`) and `framify_org_custom_amount` (`'subtle'` | `'normal'` | `'strong'`).
  - JS constant `CUSTOM_AMOUNT[ amount ] = { ripple, rotate, scale }`.
  - JS functions `resolveTrigger( setting, family )` (returns `'none'` | `'hover'` | `'inview'` | `'loop'`) and `gentleTransform( motion, v, box )` (returns a string).
  - Handler fields `fx.gentle` (a `CUSTOM_AMOUNT` entry or `null`) and `fx.liquid` (a pair or `null`; Task 2 sets it).
  - `fx.deco.path` in container deco mode.
  - Handler method `setupCustomMotion( s )`, which Task 2 replaces.

- [ ] **Step 1: PHP controls**

In `framify-elementor.php`, directly after the closing `) ) );` of the `framify_org_spring` control and before `if ( ! $is_container ) {` (the zoom control), insert:

```php
        // Custom shapes only move when a real trigger is chosen (Auto keeps
        // them static), so these only appear then.
        $custom_moving = $on + array(
            'framify_org_shape'    => 'custom',
            'framify_org_trigger!' => array( 'auto', 'none' ),
        );

        $element->add_control( 'framify_org_custom_motion', $this->live( array(
            'label'       => esc_html__( 'Custom motion', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => 'liquid',
            'options'     => array(
                'liquid' => esc_html__( 'Liquid (traced, rippling edge)', 'framify' ),
                'gentle' => esc_html__( 'Gentle (exact shape, tilt and swell)', 'framify' ),
            ),
            'description' => esc_html__( 'Liquid traces your shape and ripples its edge, softening sharp corners. Gentle keeps it exact and moves it as a whole; use it for logos and icons.', 'framify' ),
            'condition'   => $custom_moving,
        ) ) );

        $element->add_control( 'framify_org_custom_amount', $this->live( array(
            'label'     => esc_html__( 'Motion amount', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'normal',
            'options'   => array(
                'subtle' => esc_html__( 'Subtle', 'framify' ),
                'normal' => esc_html__( 'Normal', 'framify' ),
                'strong' => esc_html__( 'Strong', 'framify' ),
            ),
            'condition' => $custom_moving,
        ) ) );
```

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`
Expected: `No syntax errors detected`, then `ALL PASSED`.

- [ ] **Step 2: JS constants and helpers**

In `assets/framify-elementor.js`, directly after the line that defines `SPRING_PERIOD`, insert:

```js
	// Custom shape motion per "Motion amount": ripple = Liquid edge push in
	// 0-100 box units; rotate (deg) and scale = Gentle tilt and swell.
	var CUSTOM_AMOUNT = {
		subtle: { ripple: 2, rotate: 1.5, scale: 1.02 },
		normal: { ripple: 3.5, rotate: 3, scale: 1.04 },
		strong: { ripple: 5, rotate: 5, scale: 1.07 }
	};
```

Directly after the `customTransform` function, insert:

```js
	// Gentle motion: the exact pasted shape tilts and swells around the
	// centre of the 0-100 box. v is the animation value (it springs past 1).
	function gentleTransform( motion, v, box ) {
		return 'translate(50 50) rotate(' + ( motion.rotate * v ) + ') scale(' + ( 1 + ( motion.scale - 1 ) * v ) + ') translate(-50 -50) ' + customTransform( box );
	}

	// The trigger actually in effect: Auto springs Blobs on hover and leaves
	// every other family (Wavy, Flow, Custom) static.
	function resolveTrigger( setting, family ) {
		var trigger = setting || 'auto';
		if ( 'auto' === trigger ) {
			return 'blob' === family ? 'hover' : 'none';
		}
		return trigger;
	}
```

- [ ] **Step 3: Handler wiring**

In `setup()`, in the `fx` object literal, add these two lines directly after `inner: '',`:

```js
					gentle: null,
					liquid: null,
```

Directly after the line `fx.inner = custom ? customTransform( custom.box ) : edgeTransform( fx.edge );`, insert:

```js
				if ( custom && ! REDUCE_MOTION && 'none' !== resolveTrigger( s.framify_org_trigger, fx.family ) ) {
					this.setupCustomMotion( s );
				}
```

Add this method directly after `warnCustom`:

```js
			// Custom shapes only move when a real trigger is set. Gentle keeps the
			// raw path and animates fx.inner in render().
			setupCustomMotion: function ( s ) {
				var amount = CUSTOM_AMOUNT[ s.framify_org_custom_amount ] ? s.framify_org_custom_amount : 'normal';
				this.fx.gentle = CUSTOM_AMOUNT[ amount ];
			},
```

In `setupContainer()`, deco branch, replace:

```js
				fx.deco = { svg: deco.svg, prefix: '', defaults: MAIN_BOX, family: fx.family, edge: fx.edge, anchor: null };
```

with:

```js
				fx.deco = { svg: deco.svg, path: deco.path, prefix: '', defaults: MAIN_BOX, family: fx.family, edge: fx.edge, anchor: null };
```

In `bindTrigger()`, replace the block:

```js
				var trigger = s.framify_org_trigger || 'auto';
				if ( 'auto' === trigger ) {
					// Only Blobs spring on hover by default; wide and custom shapes are static.
					trigger = 'blob' === fx.family ? 'hover' : 'none';
				}
				if ( 'none' === trigger ) {
```

with:

```js
				var trigger = resolveTrigger( s.framify_org_trigger, fx.family );
				if ( 'none' === trigger ) {
```

In `render()`, directly before the line `if ( fx.clip && fx.clip.box ) {`, insert:

```js
				if ( fx.gentle ) {
					// Gentle custom motion lives in the inner transform, shared by
					// the clip and by a container's deco path.
					fx.inner = gentleTransform( fx.gentle, value, fx.custom.box );
					if ( fx.deco && ! fx.deco.prefix ) {
						fx.deco.path.setAttribute( 'transform', fx.inner );
					}
				}
```

Run: `node --check assets/framify-elementor.js`
Expected: no output.

- [ ] **Step 4: Create the Gentle test elements**

In the editor, run with `browser_evaluate`:

```js
async () => {
  const img = elementor.getContainer( 'fo00003' ).settings.get( 'image' );
  const PATH = 'M60 120 C 260 -40 520 200 760 90 S 1180 60 1150 380 C 1120 700 820 780 560 700 C 300 620 80 780 40 520 C 0 300 -20 200 60 120 Z';
  const SVG = '<svg viewBox="0 0 1200 800"><path d="' + PATH + '"/></svg>';
  await $e.run( 'document/elements/create', { container: elementor.getPreviewContainer(), model: { elType: 'container', settings: { _element_id: 'fo-cm-wrap', flex_direction: 'row', flex_wrap: 'wrap' } } } );
  const wrap = elementor.getContainer( elementor.$preview[ 0 ].contentDocument.getElementById( 'fo-cm-wrap' ).dataset.id );
  const add = ( cssId, extra ) => $e.run( 'document/elements/create', { container: wrap, model: { elType: 'widget', widgetType: 'image', settings: Object.assign( { image: img, _element_id: cssId, framify_org_enable: 'yes', framify_org_shape: 'custom', framify_org_custom_svg: SVG }, extra ) } } );
  add( 'fo-cm-gentle', { framify_org_trigger: 'hover', framify_org_custom_motion: 'gentle', framify_org_custom_amount: 'strong', framify_org_zoom: { unit: 'px', size: 0, sizes: [] } } );
  add( 'fo-cm-static', {} );
  $e.run( 'document/elements/create', { container: elementor.getPreviewContainer(), model: { elType: 'container', settings: { _element_id: 'fo-cm-deco', min_height: { unit: 'px', size: 300, sizes: [] }, framify_org_enable: 'yes', framify_org_mode: 'deco', framify_org_shape: 'custom', framify_org_custom_svg: SVG, framify_org_trigger: 'loop', framify_org_custom_motion: 'gentle' } } } );
  await $e.run( 'document/save/draft' );
  return 'created';
}
```

The zoom is set to 0 on `fo-cm-gentle` so that only the Gentle transform changes the clip.

- [ ] **Step 5: Verify Gentle in the preview**

Navigate to `wp_preview` at 1280x900 and run:

```js
async () => {
  const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
  document.documentElement.style.scrollBehavior = 'auto';
  const PATH = 'M60 120 C 260 -40 520 200 760 90 S 1180 60 1150 380 C 1120 700 820 780 560 700 C 300 620 80 780 40 520 C 0 300 -20 200 60 120 Z';
  const clipOf = ( id ) => {
    const img = document.getElementById( id ).querySelector( 'img' );
    const cid = ( img.style.clipPath.match( /#([\w-]+)/ ) || [] )[ 1 ];
    return document.getElementById( cid ).querySelector( 'path' );
  };
  const out = {};
  const g = clipOf( 'fo-cm-gentle' );
  document.getElementById( 'fo-cm-gentle' ).scrollIntoView( { block: 'center', behavior: 'instant' } );
  await wait( 400 );
  out.gentleRestRaw = g.getAttribute( 'd' ) === PATH;
  out.gentleRestUntilted = /rotate\(0\) scale\(1\)/.test( g.getAttribute( 'transform' ) );
  document.getElementById( 'fo-cm-gentle' ).dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 3500 );
  out.gentleHoverTilted = /rotate\(5\)/.test( g.getAttribute( 'transform' ) ) && /scale\(1\.07/.test( g.getAttribute( 'transform' ) );
  out.gentleHoverStillRaw = g.getAttribute( 'd' ) === PATH;
  document.getElementById( 'fo-cm-gentle' ).dispatchEvent( new MouseEvent( 'mouseleave' ) );
  const s = clipOf( 'fo-cm-static' );
  document.getElementById( 'fo-cm-static' ).dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 1500 );
  out.staticUnchanged = s.getAttribute( 'd' ) === PATH && ! /rotate\(/.test( s.getAttribute( 'transform' ) );
  const decoPath = document.getElementById( 'fo-cm-deco' ).querySelector( ':scope > .framify-organic__deco path' );
  document.getElementById( 'fo-cm-deco' ).scrollIntoView( { block: 'center', behavior: 'instant' } );
  const t1 = decoPath.getAttribute( 'transform' );
  await wait( 900 );
  out.decoLoopMoves = /rotate\(/.test( t1 ) && t1 !== decoPath.getAttribute( 'transform' );
  return out;
}
```

Expected: every value `true`. `browser_console_messages` shows no errors.

- [ ] **Step 6: Reduced motion**

Run `browser_emulate_media` with `{ reducedMotion: 'reduce' }`, reload the `wp_preview` URL and run:

```js
async () => {
  const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
  const img = document.querySelector( '#fo-cm-gentle img' );
  const p = document.getElementById( ( img.style.clipPath.match( /#([\w-]+)/ ) || [] )[ 1 ] ).querySelector( 'path' );
  document.getElementById( 'fo-cm-gentle' ).dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 2000 );
  return ! /rotate\(/.test( p.getAttribute( 'transform' ) );
}
```

Expected: `true`. Then reset the emulation with `{ reducedMotion: 'no-preference' }`.

- [ ] **Step 7: ASCII check**

Use the Grep tool with pattern `[^\x00-\x7F]` on `framify-elementor.php` and `assets/framify-elementor.js`. Expected: no matches.

---

### Task 2: Liquid tracing and fallback

**Files:**
- Modify: `assets/framify-elementor.js`: new tracing functions after `resolveTrigger()`; handler `setupCustomMotion` (replace), `mainPair` (modify), plus a new `warnTrace`

**Interfaces:**
- Consumes (from Task 1):
  - `CUSTOM_AMOUNT`
  - `fx.gentle`, `fx.liquid`
  - `setupCustomMotion( s )`, called from `setup()` before `setupImage` / `setupContainer`
  - `fx.custom = { d, box }`
  - `svgEl()`
- Produces:
  - `traceCustom( custom, amount )` returns `{ rest: string, hover: string }` in the 0-100 box, or `null`.
  - `fx.liquid = { rest: parsedPath, hover: parsedPath }`, with `fx.inner = ''` when Liquid is active.

- [ ] **Step 1: Tracing functions**

Directly after the `resolveTrigger` function, insert:

```js
	/* ---------- custom shape: liquid tracing ---------- */

	var TRACE_SAMPLES = 400;
	var TRACE_POINTS = 96;
	var traceCache = null;

	// Evenly spaced points along a custom path, split into its separate parts
	// (a jump between neighbouring samples means a moveto), normalised into
	// the 0-100 box. Returns an array of point arrays, or null.
	function tracePoints( custom ) {
		var svg = svgEl( 'svg', { width: '0', height: '0', 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0;overflow:hidden' } );
		var path = svgEl( 'path', { d: custom.d } );
		svg.appendChild( path );
		document.body.appendChild( svg );
		var total = 0;
		var samples = [];
		try {
			total = path.getTotalLength();
			if ( total > 0 && isFinite( total ) ) {
				for ( var i = 0; i <= TRACE_SAMPLES; i++ ) {
					var pt = path.getPointAtLength( total * i / TRACE_SAMPLES );
					samples.push( { x: pt.x, y: pt.y } );
				}
			}
		} catch ( e ) {
			samples = [];
		}
		svg.remove();
		if ( samples.length < 2 ) {
			return null;
		}

		var step = total / TRACE_SAMPLES;
		var chains = [];
		var chain = [ samples[ 0 ] ];
		for ( var j = 1; j < samples.length; j++ ) {
			var a = samples[ j - 1 ];
			var b = samples[ j ];
			if ( Math.sqrt( ( b.x - a.x ) * ( b.x - a.x ) + ( b.y - a.y ) * ( b.y - a.y ) ) > 3 * step ) {
				chains.push( chain );
				chain = [];
			}
			chain.push( b );
		}
		chains.push( chain );

		var kept = [];
		var sum = 0;
		chains.forEach( function ( c ) {
			var len = polylineLength( c );
			if ( c.length > 1 && len >= 0.01 * total ) {
				kept.push( { points: c, len: len } );
				sum += len;
			}
		} );
		if ( ! kept.length ) {
			return null;
		}
		var box = custom.box;
		return kept.map( function ( k ) {
			var n = Math.max( 8, Math.round( TRACE_POINTS * k.len / sum ) );
			return resample( k.points, k.len, n ).map( function ( p ) {
				return { x: ( p.x - box.x ) * 100 / box.w, y: ( p.y - box.y ) * 100 / box.h };
			} );
		} );
	}

	function polylineLength( pts ) {
		var len = 0;
		for ( var i = 1; i < pts.length; i++ ) {
			len += Math.sqrt( ( pts[ i ].x - pts[ i - 1 ].x ) * ( pts[ i ].x - pts[ i - 1 ].x ) + ( pts[ i ].y - pts[ i - 1 ].y ) * ( pts[ i ].y - pts[ i - 1 ].y ) );
		}
		return len;
	}

	// n points at equal distances along a polyline of length len.
	function resample( pts, len, n ) {
		var out = [];
		var seg = 0;
		var walked = 0;
		for ( var i = 0; i < n; i++ ) {
			var target = len * i / n;
			while ( seg < pts.length - 2 ) {
				var sl = Math.sqrt( ( pts[ seg + 1 ].x - pts[ seg ].x ) * ( pts[ seg + 1 ].x - pts[ seg ].x ) + ( pts[ seg + 1 ].y - pts[ seg ].y ) * ( pts[ seg + 1 ].y - pts[ seg ].y ) );
				if ( walked + sl >= target ) {
					break;
				}
				walked += sl;
				seg++;
			}
			var p0 = pts[ seg ];
			var p1 = pts[ seg + 1 ];
			var l = Math.sqrt( ( p1.x - p0.x ) * ( p1.x - p0.x ) + ( p1.y - p0.y ) * ( p1.y - p0.y ) ) || 1;
			var t = Math.max( 0, Math.min( 1, ( target - walked ) / l ) );
			out.push( { x: p0.x + ( p1.x - p0.x ) * t, y: p0.y + ( p1.y - p0.y ) * t } );
		}
		return out;
	}

	// Pushes each point along its normal by a 2- and 3-lobe wave: the hover
	// pose's ripple. Fixed phases per part, so it never looks random.
	function ripplePoints( pts, amp, index ) {
		var n = pts.length;
		var ph1 = 0.9 + 1.7 * index;
		var ph2 = 2.1 + 1.3 * index;
		return pts.map( function ( p, i ) {
			var prev = pts[ ( i - 1 + n ) % n ];
			var next = pts[ ( i + 1 ) % n ];
			var tx = next.x - prev.x;
			var ty = next.y - prev.y;
			var tl = Math.sqrt( tx * tx + ty * ty ) || 1;
			var s = i / n;
			var k = amp * ( 0.6 * Math.sin( 2 * Math.PI * 2 * s + ph1 ) + 0.4 * Math.sin( 2 * Math.PI * 3 * s + ph2 ) );
			return { x: p.x - ty / tl * k, y: p.y + tx / tl * k };
		} );
	}

	// Closed Catmull-Rom path through points: the same maths and 2-decimal
	// format as the PHP smooth_path( $points, true ), so rest and hover share
	// one structure and the number blend morphs them.
	function smoothClosed( pts ) {
		var n = pts.length;
		var f = function ( v ) {
			return v.toFixed( 2 );
		};
		var d = 'M' + f( pts[ 0 ].x ) + ' ' + f( pts[ 0 ].y );
		for ( var i = 0; i < n; i++ ) {
			var p0 = pts[ ( i - 1 + n ) % n ];
			var p1 = pts[ i ];
			var p2 = pts[ ( i + 1 ) % n ];
			var p3 = pts[ ( i + 2 ) % n ];
			d += 'C' + f( p1.x + ( p2.x - p0.x ) / 6 ) + ' ' + f( p1.y + ( p2.y - p0.y ) / 6 )
				+ ' ' + f( p2.x - ( p3.x - p1.x ) / 6 ) + ' ' + f( p2.y - ( p3.y - p1.y ) / 6 )
				+ ' ' + f( p2.x ) + ' ' + f( p2.y );
		}
		return d + 'Z';
	}

	// Liquid motion for a custom shape: { rest, hover } path strings in the
	// 0-100 box, or null when the paste can't be traced. Single-entry memo,
	// like parseCustom.
	function traceCustom( custom, amount ) {
		var key = custom.d + '|' + amount;
		if ( traceCache && traceCache.key === key ) {
			return traceCache.result;
		}
		var parts = tracePoints( custom );
		var result = null;
		if ( parts ) {
			var amp = CUSTOM_AMOUNT[ amount ].ripple;
			result = {
				rest: parts.map( function ( pts ) {
					return smoothClosed( pts );
				} ).join( ' ' ),
				hover: parts.map( function ( pts, i ) {
					return smoothClosed( ripplePoints( pts, amp, i ) );
				} ).join( ' ' )
			};
		}
		traceCache = { key: key, result: result };
		return result;
	}
```

- [ ] **Step 2: Handler, Liquid first with a Gentle fallback**

Replace the whole `setupCustomMotion` method (from Task 1) with:

```js
			// Custom shapes only move when a real trigger is set. Liquid swaps in
			// a traced, rippling pair (already in 0-100 units, so no inner
			// transform); Gentle keeps the raw path and animates fx.inner in
			// render(). Liquid falls back to Gentle when the paste can't be traced.
			setupCustomMotion: function ( s ) {
				var fx = this.fx;
				var amount = CUSTOM_AMOUNT[ s.framify_org_custom_amount ] ? s.framify_org_custom_amount : 'normal';
				if ( 'gentle' !== s.framify_org_custom_motion ) {
					var traced = traceCustom( fx.custom, amount );
					if ( traced ) {
						fx.liquid = { rest: parsePath( traced.rest ), hover: parsePath( traced.hover ) };
						fx.inner = '';
						return;
					}
					this.warnTrace( fx.custom.d );
				}
				fx.gentle = CUSTOM_AMOUNT[ amount ];
			},

			// Editor only, once per distinct path: say why Liquid became Gentle.
			warnTrace: function ( d ) {
				if ( elementorFrontend.isEditMode() && this.warnedTrace !== d ) {
					this.warnedTrace = d;
					window.console.warn( 'Framify: custom shape could not be traced; using Gentle motion.' );
				}
			},
```

In `mainPair`, replace:

```js
				if ( fx.custom ) {
					var path = parsePath( fx.custom.d );
					return { rest: path, hover: path };
				}
```

with:

```js
				if ( fx.custom ) {
					if ( fx.liquid ) {
						return fx.liquid;
					}
					var path = parsePath( fx.custom.d );
					return { rest: path, hover: path };
				}
```

Update the comment above `mainPair` to read:

```js
			// The element's own shape as a rest/hover pair. A static or Gentle
			// custom shape never morphs, so both poses are the same raw path;
			// Liquid uses its traced pair.
```

Run: `node --check assets/framify-elementor.js`. Expected: no output.

- [ ] **Step 3: Create the Liquid test elements**

In the editor, add these widgets to the existing `fo-cm-wrap` container:

```js
async () => {
  const img = elementor.getContainer( 'fo00003' ).settings.get( 'image' );
  const PATH = 'M60 120 C 260 -40 520 200 760 90 S 1180 60 1150 380 C 1120 700 820 780 560 700 C 300 620 80 780 40 520 C 0 300 -20 200 60 120 Z';
  const wrap = elementor.getContainer( elementor.$preview[ 0 ].contentDocument.getElementById( 'fo-cm-wrap' ).dataset.id );
  const add = ( cssId, extra ) => $e.run( 'document/elements/create', { container: wrap, model: { elType: 'widget', widgetType: 'image', settings: Object.assign( { image: img, _element_id: cssId, framify_org_enable: 'yes', framify_org_shape: 'custom', framify_org_zoom: { unit: 'px', size: 0, sizes: [] } }, extra ) } } );
  add( 'fo-cm-liquid', { framify_org_custom_svg: '<svg viewBox="0 0 1200 800"><path d="' + PATH + '"/></svg>', framify_org_trigger: 'hover' } );
  add( 'fo-cm-two', { framify_org_custom_svg: '<svg viewBox="0 0 100 100"><path d="M10 10h30v30h-30z M60 60h30v30h-30z"/></svg>', framify_org_trigger: 'loop' } );
  await $e.run( 'document/save/draft' );
  return 'created';
}
```

- [ ] **Step 4: Verify Liquid in the preview**

Navigate to `wp_preview` at 1280x900 and run:

```js
async () => {
  const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
  document.documentElement.style.scrollBehavior = 'auto';
  const clipOf = ( id ) => {
    const img = document.getElementById( id ).querySelector( 'img' );
    const cid = ( img.style.clipPath.match( /#([\w-]+)/ ) || [] )[ 1 ];
    return cid ? document.getElementById( cid ).querySelector( 'path' ) : null;
  };
  const skeleton = ( d ) => d.replace( /[-\d.]+/g, '' );
  const out = {};
  const l = clipOf( 'fo-cm-liquid' );
  document.getElementById( 'fo-cm-liquid' ).scrollIntoView( { block: 'center', behavior: 'instant' } );
  await wait( 400 );
  const rest = l.getAttribute( 'd' );
  out.liquidTraced = /^M/.test( rest ) && 96 === ( rest.match( /C/g ) || [] ).length;
  out.liquidNoInner = / scale\(0\.01 0\.01\)$/.test( l.getAttribute( 'transform' ) );
  document.getElementById( 'fo-cm-liquid' ).dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 3500 );
  const hover = l.getAttribute( 'd' );
  out.liquidMorphs = hover !== rest && skeleton( hover ) === skeleton( rest );
  document.getElementById( 'fo-cm-liquid' ).dispatchEvent( new MouseEvent( 'mouseleave' ) );
  const two = clipOf( 'fo-cm-two' );
  out.twoParts = 2 === ( two.getAttribute( 'd' ).match( /M/g ) || [] ).length;
  return out;
}
```

Expected: every value `true`. `browser_console_messages` shows no errors.

- [ ] **Step 5: Verify the fallback**

`traceCustom` is private to the IIFE, so this checks the fallback through the same browser API it relies on:

```js
() => {
  const svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
  document.body.appendChild( svg );
  const p = document.createElementNS( 'http://www.w3.org/2000/svg', 'path' );
  p.setAttribute( 'd', 'M10 10' );
  svg.appendChild( p );
  const len = p.getTotalLength();
  svg.remove();
  return len;
}
```

Expected: `0`. This shows that a moveto-only path, which passes `PATH_CHARS`, gives `tracePoints` a total length of 0, so it returns `null`.

Then **read `setupCustomMotion`** and confirm by inspection:
- A `null` trace calls `warnTrace` and sets `fx.gentle`.
- The Gentle path is exercised by Task 1's `fo-cm-gentle`.

Record both in the report. (`parseCustom` rejects a moveto-only paste before it reaches tracing, because its bounding box is empty, so the fallback is a defensive guard.)

- [ ] **Step 6: Reduced motion**

Run `browser_emulate_media` with `{ reducedMotion: 'reduce' }`, reload `wp_preview` and run:

```js
async () => {
  const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
  const img = document.querySelector( '#fo-cm-liquid img' );
  const p = document.getElementById( ( img.style.clipPath.match( /#([\w-]+)/ ) || [] )[ 1 ] ).querySelector( 'path' );
  const PATH = 'M60 120 C 260 -40 520 200 760 90 S 1180 60 1150 380 C 1120 700 820 780 560 700 C 300 620 80 780 40 520 C 0 300 -20 200 60 120 Z';
  const before = p.getAttribute( 'd' );
  document.getElementById( 'fo-cm-liquid' ).dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 2000 );
  return before === PATH && p.getAttribute( 'd' ) === PATH;
}
```

Expected: `true`. Under reduced motion no tracing happens, so the raw path is shown. Then reset the emulation.

- [ ] **Step 7: Visual check (frontend-design)**

Screenshot `fo-cm-liquid` at rest and at about 0.7 s after `mouseenter` (the middle of the spring), and `fo-cm-gentle` at about 0.7 s after `mouseenter`.

Judge:
- Liquid should read as a liquid ripple in the spirit of the built-in shapes, not jitter.
- Gentle should read as a calm breathe, not a wobble.
- The traced rest shape should stay faithful to the pasted outline, only slightly softened.

The spec allows tuning `CUSTOM_AMOUNT` values (ripple, rotate, scale), and nothing else. If you tune, record old -> new values and re-run Steps 4 and 5 of Task 1 and Step 4 of this task (update the Gentle `rotate(5)` / `scale(1.07` expectations to the new strong values). Copy screenshots to the scratchpad and delete the wp-content PNGs.

- [ ] **Step 8: ASCII check**

Use the Grep tool with pattern `[^\x00-\x7F]` on `assets/framify-elementor.js`. Expected: no matches.

---

### Task 3: Docs and editor pass

**Files:**
- Modify: `CLAUDE.md`: the "### Elementor module" section, Custom shape bullet
- Modify: `assets/framify-elementor.js`: file docblock

**Interfaces:**
- Consumes: everything above.
- Produces: documentation.

- [ ] **Step 1: Docs**

Use Read to see the current Custom shape bullet in `CLAUDE.md`, then append this sentence at the end of that bullet:

```
Motion (only with a Hover / In view / Loop trigger; Auto stays static): `framify_org_custom_motion` Liquid (`traceCustom`: 400 samples split into parts at movetos, 96 points shared by length, normal-wave hover pose, same Catmull-Rom as PHP `smooth_path`; identity inner transform) or Gentle (raw `d` kept, `fx.inner` animated by `gentleTransform` around the box centre); amounts in `CUSTOM_AMOUNT`; Liquid falls back to Gentle when tracing fails.
```

In the file docblock of `assets/framify-elementor.js`, change the sentence that says a Custom shape never morphs, so that it says: Custom shapes stay static unless a trigger is set, then move in one of two modes: Liquid (traced and rippled, morphed like the built-ins) or Gentle (the exact path, tilted and swelled via its transform).

Check both files with the Grep tool, pattern `[^\x00-\x7F]`: the JS file must be clean, and so must the lines you changed in `CLAUDE.md`.

- [ ] **Step 2: Editor pass (real UI clicks, nothing saved)**

In the editor, select `fo-cm-liquid` and open the Framify tab (use `browser_snapshot` for refs). Check:
1. "Custom motion" and "Motion amount" appear in the Motion group, after Spring.
2. Set Trigger to "Auto (blobs on hover, wavy static)": both new controls hide. Set it back to "On hover": they show.
3. Switch Custom motion to "Gentle": within 500 ms the preview clip `d` becomes the raw paste (starts with `M60 120`). Switch back to "Liquid": it is traced again (starts with `M` followed by decimals).
4. Select Shape "Brook": both new controls hide.
5. `browser_console_messages` shows no errors.

Undo every change and leave without saving (accept beforeunload). If a save or leave is denied by the permission system, stop and report it; don't work around it.

- [ ] **Step 3: Final checks**

Run: `php dev/tests/elementor-shapes-test.php` (expect ALL PASSED) and `node --check assets/framify-elementor.js` (expect no output).

---

## Self-review notes (plan author)

- **Spec coverage:**
  - The controls and their conditions: Task 1, Step 1.
  - Mode resolution and the defaults for missing settings (`framify_org_custom_motion` treated as liquid via `'gentle' !==`, and amount treated as normal): Task 1, Step 3 and Task 2, Step 2.
  - Gentle transform and its amounts: Task 1.
  - Liquid tracing, parts, 96 points, normalisation, rest and hover poses, and the memo: Task 2, Step 1.
  - Fallback and its warning: Task 2, Steps 2 and 5.
  - Reduced motion: Task 1 Step 6 and Task 2 Step 6.
  - Container deco with Gentle (`fo-cm-deco`): Task 1.
  - Docs: Task 3.
- **Names used across tasks:** `CUSTOM_AMOUNT`, `resolveTrigger`, `gentleTransform`, `setupCustomMotion`, `fx.gentle`, `fx.liquid`, `fx.deco.path` (Task 1); `tracePoints`, `polylineLength`, `resample`, `ripplePoints`, `smoothClosed`, `traceCustom`, `warnTrace` (Task 2).
