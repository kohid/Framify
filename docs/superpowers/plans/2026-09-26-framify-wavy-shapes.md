# Framify Wavy Shapes, Placement and Float Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Always collaborate with /feature-dev:feature-dev (workflow + review) and /frontend-design:frontend-design (every visual judgement).

**Goal:** Add a Wavy shape family with a Flat edge, a responsive Placement group, a static trigger, and a Float effect to Framify's Elementor module.

**Architecture:**
- **PHP:** generates every shape server-side with an identical rest/hover path structure, so the existing number-blending morph keeps working.
  - Wavy shapes come in two variants: anchored (straight right edge) and free.
- **JS (Flat edge):** turns the anchored edge to any side with an SVG transform.
- **Placement:** stored as responsive Elementor controls that write CSS custom properties. The JS reads the computed values, so each breakpoint gets its own placement.
- **Float:** pure CSS on the individual `translate` / `rotate` properties.

**Tech Stack:** WordPress plugin PHP (no build), Elementor 4.2.4 controls API, vanilla JS (ES5 style, IIFE), SVG clipPath, CSS custom properties and keyframes. Tests: plain PHP CLI script (`php` 8.2 on PATH) and Playwright checks in the browser.

**Spec:** `docs/superpowers/specs/2026-09-26-framify-wavy-shapes-design.md`

## Global Constraints

**Plugin location and version control**
- Plugin root: `c:/Users/Admin/Local Sites/business-directory/app/public/wp-content/plugins/framify/`. All paths below are relative to it.
- Not a git repo: there are **no commit steps**. The checkpoint after each task is the passing verification.

**Code rules (from Framify's `CLAUDE.md`)**
- Source files are pure ASCII. Check with `grep -nP '[^\x00-\x7F]' <file>`, which must print nothing.
- Never round-trip files through PowerShell `Get-Content` / `Set-Content`. Edit with the editor tools only.
- JS: `var`, one IIFE, `'use strict'`, no modules.
- Text domain `'framify'`.
- Assets are versioned by `filemtime()` already, so do not bump `FRAMIFY_VERSION` for asset changes.

**Naming**
- Control ids start with `framify_org_` (organic shape) or `framify_float` (Float).
- CSS custom properties start with `--framify-`.
- Do not copy Bold Themes' SVG paths; all shapes are generated.

**Test environment**
- Aberdeen local, which loads this plugin through the junction `D:/Local Sites/aberdeen-taxi-knowledge/app/public/wp-content/plugins/framify`.
- Draft page 145 "Framify Organic Test" and image attachment 144 are available.
- Playwright is already logged in as `claude`.
- Editor URL: `http://aberdeen-taxi-knowledge.local/wp-admin/post.php?post=145&action=elementor`
- Preview URL: `http://aberdeen-taxi-knowledge.local/?page_id=145&preview=true`

**Compatibility:** the module has not been deployed outside that test page, so the old controls `framify_org_deco_size`, `framify_org_deco_x` and `framify_org_deco_y` are removed without migration.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `framify-elementor.php` | Modify | Shape geometry (Blobs + Wavy), all controls (organic + Float), asset enqueue |
| `assets/framify-elementor.js` | Replace | Frontend/editor handler: shape pairs, flat edge, placement reading, clip/deco, triggers |
| `assets/framify-elementor.css` | Modify | Deco positioning (no centring transform), Float keyframes, reduced motion |
| `dev/tests/elementor-shapes-test.php` | Create | CLI-only geometry checks, Blob baseline snapshot, visual preview page |
| `CLAUDE.md` | Modify | Document the new module behaviour |

---

### Task 1: Wavy shape geometry (PHP)

**Files:**
- Create: `dev/tests/elementor-shapes-test.php`
- Modify: `framify-elementor.php`, around lines 38-137: the preset library, `build_path`, `shape_paths` and `shape_options`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `Framify_Elementor::shape_paths()` returns `array( id => array( 'family' => 'blob'|'wavy', 'rest' => string, 'hover' => string [, 'free' => array( 'rest' => string, 'hover' => string )] ) )`
  - `Framify_Elementor::wavy_ids()` returns `string[]`
  - Wavy ids: `tide`, `ripple`, `dune`, `current`, `swell`, `shore`
  - The JSON sent to the page (`window.framifyOrganic.shapes`) has the same shape, and Task 2 relies on it.

- [ ] **Step 1: Write the test script**

Create `dev/tests/elementor-shapes-test.php`:

```php
<?php
/**
 * Dev-only geometry checks for framify-elementor.php. CLI only; WordPress
 * never loads this file.
 *
 *   php dev/tests/elementor-shapes-test.php --baseline   snapshot Blob paths before a refactor
 *   php dev/tests/elementor-shapes-test.php --preview    write dev/tests/shapes-preview.html
 *   php dev/tests/elementor-shapes-test.php              run the checks
 */
if ( 'cli' !== PHP_SAPI ) {
    exit;
}

define( 'ABSPATH', __DIR__ . '/' );
function add_action() {}
function __( $text ) { return $text; }
function esc_html__( $text ) { return $text; }

require dirname( __DIR__, 2 ) . '/framify-elementor.php';

$module = new Framify_Elementor();

function framify_call( $module, $method ) {
    $m = new ReflectionMethod( $module, $method );
    $m->setAccessible( true );
    return $m->invoke( $module );
}

$paths    = framify_call( $module, 'shape_paths' );
$baseline = __DIR__ . '/blob-baseline.json';

if ( in_array( '--baseline', $argv, true ) ) {
    $blobs = array();
    foreach ( $paths as $id => $p ) {
        $blobs[ $id ] = array( 'rest' => $p['rest'], 'hover' => $p['hover'] );
    }
    file_put_contents( $baseline, json_encode( $blobs, JSON_PRETTY_PRINT ) );
    echo 'Baseline written: ' . count( $blobs ) . " shapes\n";
    exit;
}

if ( in_array( '--preview', $argv, true ) ) {
    $out = '<!doctype html><title>Framify shapes</title><body style="font:14px sans-serif;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:16px">';
    foreach ( $paths as $id => $p ) {
        $variants = array( ( isset( $p['free'] ) ? 'anchored' : 'blob' ) => $p );
        if ( isset( $p['free'] ) ) {
            $variants['free'] = $p['free'];
        }
        foreach ( $variants as $label => $v ) {
            $out .= '<figure style="margin:0"><svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:160px;background:#eee">'
                . '<path d="' . $v['rest'] . '" fill="#F2C53D"/>'
                . '<path d="' . $v['hover'] . '" fill="none" stroke="#263238" stroke-width="1" vector-effect="non-scaling-stroke"/>'
                . '</svg><figcaption>' . $id . ' (' . $label . ')</figcaption></figure>';
        }
    }
    file_put_contents( __DIR__ . '/shapes-preview.html', $out );
    echo "Preview written\n";
    exit;
}

$failures = 0;
function check( $label, $ok ) {
    global $failures;
    echo ( $ok ? 'PASS ' : 'FAIL ' ) . $label . "\n";
    if ( ! $ok ) {
        $failures++;
    }
}
function nums( $d ) {
    preg_match_all( '/-?\d*\.?\d+/', $d, $m );
    return array_map( 'floatval', $m[0] );
}
function skeleton( $d ) {
    return preg_replace( '/[-\d.]+/', '', $d );
}

// 1. Blobs are byte-identical to the 1.7.0 output.
foreach ( json_decode( file_get_contents( $baseline ), true ) as $id => $p ) {
    check( "blob $id unchanged",
        isset( $paths[ $id ]['family'] ) && 'blob' === $paths[ $id ]['family']
        && $paths[ $id ]['rest'] === $p['rest'] && $paths[ $id ]['hover'] === $p['hover'] );
}

// 2. Wavy presets.
$wavy_ids = array( 'tide', 'ripple', 'dune', 'current', 'swell', 'shore' );
check( 'wavy_ids() lists the six wavy shapes', method_exists( $module, 'wavy_ids' ) && $wavy_ids === framify_call( $module, 'wavy_ids' ) );
$presets = method_exists( $module, 'wavy_presets' ) ? framify_call( $module, 'wavy_presets' ) : array();
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

// 3. The picker lists every shape; wavy thumbnails are drawn wide.
$options = framify_call( $module, 'shape_options' );
check( 'picker has 14 shapes', 14 === count( $options ) );
check( 'wavy thumbnail is drawn wide', isset( $options['tide'] ) && false !== strpos( rawurldecode( $options['tide']['image'] ), 'scale(1 0.7)' ) );

echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit( $failures ? 1 : 0 );
```

- [ ] **Step 2: Snapshot the Blob paths from the unmodified module**

Run: `php dev/tests/elementor-shapes-test.php --baseline`
Expected: `Baseline written: 8 shapes`. The file `dev/tests/blob-baseline.json` now exists.

- [ ] **Step 3: Run the checks to confirm they fail**

Run: `php dev/tests/elementor-shapes-test.php`
Expected: exit code 1, with these failures:
- `FAIL blob pebble unchanged`, because there is no `family` key yet
- `FAIL wavy_ids() lists the six wavy shapes`
- `FAIL tide exists as wavy`
- `FAIL picker has 14 shapes`

- [ ] **Step 4: Implement the geometry**

In `framify-elementor.php`, replace everything from the comment block `/* Preset blob library` down to the end of `shape_options()` with:

```php
    /* ------------------------------------------------------------------
       Preset blob library
       Each shape is a circle with two gentle ripples on its edge: a 2-lobe
       and a 3-lobe wave, as array( base radius, 2-lobe amp, 2-lobe phase deg,
       3-lobe amp, 3-lobe phase deg ) in a 0-100 box. The hover shape of a
       preset is the same radius with shifted phases/amps, so the blob
       visibly "flows" into it.

       Low-order waves are what keep these organic: hand-typed radii that
       alternate in/out between neighbours produce lemon-like points (tried
       first, rejected on screen). base + both amps stays <= 48 so the
       smoothed curve stays inside the box.

       Both rings go through the same sampler and smoothing builder, so every
       rest/hover pair has an identical path structure - which is what lets
       the frontend morph by blending numbers, with no path-matching library.
    ------------------------------------------------------------------ */
    const RING_POINTS = 12;

    private function presets() {
        return array(
            'pebble'  => array( 'title' => __( 'Pebble', 'framify' ),  'rest' => array( 43, 3.0, 0,   2.5, 20 ),  'hover' => array( 43, 3.5, 60,  2.0, 90 ) ),
            'bean'    => array( 'title' => __( 'Bean', 'framify' ),    'rest' => array( 41, 5.0, 30,  2.0, 0 ),   'hover' => array( 41, 4.0, 80,  3.0, 50 ) ),
            'cloud'   => array( 'title' => __( 'Cloud', 'framify' ),   'rest' => array( 42, 2.0, 0,   4.0, 10 ),  'hover' => array( 42, 3.0, 45,  3.5, 70 ) ),
            'splash'  => array( 'title' => __( 'Splash', 'framify' ),  'rest' => array( 41, 3.0, 10,  4.5, 40 ),  'hover' => array( 41, 4.5, 70,  3.0, 100 ) ),
            'puddle'  => array( 'title' => __( 'Puddle', 'framify' ),  'rest' => array( 41, 6.0, 0,   1.5, 60 ),  'hover' => array( 41, 5.0, 50,  2.5, 20 ) ),
            'petal'   => array( 'title' => __( 'Petal', 'framify' ),   'rest' => array( 42, 1.5, 0,   5.0, 0 ),   'hover' => array( 42, 3.0, 40,  4.0, 60 ) ),
            'drift'   => array( 'title' => __( 'Drift', 'framify' ),   'rest' => array( 42, 4.0, 110, 3.0, 200 ), 'hover' => array( 42, 3.0, 170, 4.0, 260 ) ),
            'cushion' => array( 'title' => __( 'Cushion', 'framify' ), 'rest' => array( 45, 2.0, 45,  1.0, 30 ),  'hover' => array( 45, 1.5, 100, 2.0, 80 ) ),
        );
    }

    /* ------------------------------------------------------------------
       Wavy library
       Wide shapes for photos and backdrops, drawn with one straight side
       (the "flat edge", canonical = right) so an image can run off the page
       edge; the frontend turns that edge to any side with a transform.
       The outline is a superellipse (a squared-off ellipse that fills the
       box like a photo) pushed inward by two low-frequency waves:
       array( inset, amp 1, freq 1, phase 1 deg, amp 2, freq 2, phase 2 deg ).
       inset >= both amps keeps the outline inside the box. Frequencies are
       whole numbers so the free (no flat edge) loop closes seamlessly.
    ------------------------------------------------------------------ */
    const WAVE_POINTS = 16;
    const SUPER_EXP   = 4;

    private function wavy_presets() {
        return array(
            'tide'    => array( 'title' => __( 'Tide', 'framify' ),    'rest' => array( 9, 5, 1, 0, 3, 3, 30 ),    'hover' => array( 9, 5, 1, 60, 3, 3, 110 ) ),
            'ripple'  => array( 'title' => __( 'Ripple', 'framify' ),  'rest' => array( 8, 3, 2, 20, 4, 3, 0 ),    'hover' => array( 8, 4, 2, 80, 3, 3, 70 ) ),
            'dune'    => array( 'title' => __( 'Dune', 'framify' ),    'rest' => array( 10, 7, 1, 90, 2, 2, 0 ),   'hover' => array( 10, 6, 1, 150, 3, 2, 60 ) ),
            'current' => array( 'title' => __( 'Current', 'framify' ), 'rest' => array( 9, 4, 2, 180, 4, 3, 90 ),  'hover' => array( 9, 5, 2, 240, 3, 3, 150 ) ),
            'swell'   => array( 'title' => __( 'Swell', 'framify' ),   'rest' => array( 7, 5, 1, 270, 2, 2, 45 ),  'hover' => array( 7, 4, 1, 320, 3, 2, 100 ) ),
            'shore'   => array( 'title' => __( 'Shore', 'framify' ),   'rest' => array( 9, 3, 1, 45, 5, 3, 200 ),  'hover' => array( 9, 4, 1, 100, 4, 3, 260 ) ),
        );
    }

    public function wavy_ids() {
        return array_keys( $this->wavy_presets() );
    }

    /** Samples a wave definition into RING_POINTS radii. */
    private function ring( array $wave ) {
        list( $base, $a2, $p2, $a3, $p3 ) = $wave;
        $radii = array();
        for ( $i = 0; $i < self::RING_POINTS; $i++ ) {
            $theta   = 2 * M_PI * $i / self::RING_POINTS;
            $radii[] = $base + $a2 * sin( 2 * $theta + deg2rad( $p2 ) ) + $a3 * sin( 3 * $theta + deg2rad( $p3 ) );
        }
        return $radii;
    }

    /** Blob outline: a closed smooth path through a ring of radii. */
    private function build_path( array $radii ) {
        $count  = count( $radii );
        $points = array();
        foreach ( $radii as $i => $r ) {
            $angle    = 2 * M_PI * $i / $count;
            $points[] = array( 50 + $r * cos( $angle ), 50 + $r * sin( $angle ) );
        }
        return $this->smooth_path( $points, true );
    }

    /** Inward push (in % of the radius) of a Wavy outline at position $s (0-1). */
    private function wave_offset( array $wave, $s ) {
        list( $inset, $a1, $f1, $p1, $a2, $f2, $p2 ) = $wave;
        return $inset + $a1 * sin( 2 * M_PI * $f1 * $s + deg2rad( $p1 ) ) + $a2 * sin( 2 * M_PI * $f2 * $s + deg2rad( $p2 ) );
    }

    /** Point on a superellipse at angle $phi, radius scaled by $k. */
    private function superellipse( $cx, $cy, $rx, $ry, $phi, $k ) {
        $c = cos( $phi );
        $s = sin( $phi );
        $e = 2 / self::SUPER_EXP;
        return array(
            $cx + $rx * $k * ( $c < 0 ? -1 : 1 ) * pow( abs( $c ), $e ),
            $cy + $ry * $k * ( $s < 0 ? -1 : 1 ) * pow( abs( $s ), $e ),
        );
    }

    /**
     * Wavy outline with a straight right edge: the left half of a
     * superellipse centred on the right edge, from the top-right corner round
     * to the bottom-right corner. sin(pi*s) fades the waves (and inset) out at
     * both ends, pinning them to the corners; Z closes with the straight edge.
     */
    private function wavy_anchored( array $wave ) {
        $points = array();
        for ( $i = 0; $i <= self::WAVE_POINTS; $i++ ) {
            $s        = $i / self::WAVE_POINTS;
            $k        = 1 - sin( M_PI * $s ) * $this->wave_offset( $wave, $s ) / 100;
            $points[] = $this->superellipse( 100, 50, 100, 50, -M_PI / 2 - M_PI * $s, $k );
        }
        return $this->smooth_path( $points, false );
    }

    /** Wavy outline with no flat edge: a full, closed superellipse. */
    private function wavy_free( array $wave ) {
        $points = array();
        for ( $i = 0; $i < self::WAVE_POINTS; $i++ ) {
            $s        = $i / self::WAVE_POINTS;
            // Radius 50 here vs 100 above, so double the offset for the same inset.
            $points[] = $this->superellipse( 50, 50, 50, 50, 2 * M_PI * $s, 1 - 2 * $this->wave_offset( $wave, $s ) / 100 );
        }
        return $this->smooth_path( $points, true );
    }

    /**
     * Smooth path through points (Catmull-Rom converted to cubic Beziers), in
     * 0-100 box units. Open paths repeat their end points as neighbours and
     * are closed by Z with a straight line.
     */
    private function smooth_path( array $points, $closed ) {
        $count = count( $points );
        $at    = function ( $i ) use ( $points, $count, $closed ) {
            return $closed ? $points[ ( $i % $count + $count ) % $count ] : $points[ max( 0, min( $count - 1, $i ) ) ];
        };
        $fmt = function ( $n ) {
            return number_format( $n, 2, '.', '' );
        };

        $d        = 'M' . $fmt( $points[0][0] ) . ' ' . $fmt( $points[0][1] );
        $segments = $closed ? $count : $count - 1;
        for ( $i = 0; $i < $segments; $i++ ) {
            $p0 = $at( $i - 1 );
            $p1 = $at( $i );
            $p2 = $at( $i + 1 );
            $p3 = $at( $i + 2 );

            $d .= 'C' . $fmt( $p1[0] + ( $p2[0] - $p0[0] ) / 6 ) . ' ' . $fmt( $p1[1] + ( $p2[1] - $p0[1] ) / 6 )
                . ' ' . $fmt( $p2[0] - ( $p3[0] - $p1[0] ) / 6 ) . ' ' . $fmt( $p2[1] - ( $p3[1] - $p1[1] ) / 6 )
                . ' ' . $fmt( $p2[0] ) . ' ' . $fmt( $p2[1] );
        }
        return $d . 'Z';
    }

    /** Rest + hover path strings per shape, as sent to the frontend. */
    private function shape_paths() {
        $paths = array();
        foreach ( $this->presets() as $id => $preset ) {
            $paths[ $id ] = array(
                'family' => 'blob',
                'rest'   => $this->build_path( $this->ring( $preset['rest'] ) ),
                'hover'  => $this->build_path( $this->ring( $preset['hover'] ) ),
            );
        }
        foreach ( $this->wavy_presets() as $id => $preset ) {
            $paths[ $id ] = array(
                'family' => 'wavy',
                'rest'   => $this->wavy_anchored( $preset['rest'] ),
                'hover'  => $this->wavy_anchored( $preset['hover'] ),
                'free'   => array(
                    'rest'  => $this->wavy_free( $preset['rest'] ),
                    'hover' => $this->wavy_free( $preset['hover'] ),
                ),
            );
        }
        return $paths;
    }

    /**
     * VISUAL_CHOICE options: each shape's rest outline as an inline SVG
     * thumbnail, matching the look of Elementor's own Mask shape picker.
     * Wavy thumbnails are squashed wide, like the photos they crop.
     */
    private function shape_options() {
        $all     = $this->presets() + $this->wavy_presets();
        $options = array();
        foreach ( $this->shape_paths() as $id => $shape ) {
            $path = '<path fill="#69727d" d="' . $shape['rest'] . '"/>';
            if ( 'wavy' === $shape['family'] ) {
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

- [ ] **Step 5: Run the checks to confirm they pass**

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`
Expected: `No syntax errors detected`, every line `PASS`, and `ALL PASSED` (exit code 0).

- [ ] **Step 6: Visual check of the shapes (frontend-design)**

Run: `php dev/tests/elementor-shapes-test.php --preview`, then open `dev/tests/shapes-preview.html` in Playwright (use a `file:///` URL) and take a full-page screenshot.

What to look for:
- Yellow fills are the rest shapes and the dark outline is the hover shape.
- Every anchored Wavy shape has a perfectly straight, full-height right edge.
- There are no pointed "lemon" tips, and the corners are rounded.
- Each Wavy shape is visibly different from the others, and the hover outline differs from rest without jumping sides.

If a preset looks wrong, adjust only its numbers in `wavy_presets()`, keeping `inset >= amp1 + amp2`. Re-run Steps 5 and 6.

- [ ] **Step 7: ASCII check**

Run: `grep -nP '[^\x00-\x7F]' framify-elementor.php dev/tests/elementor-shapes-test.php`
Expected: no output.

---

### Task 2: Flat edge, Placement and the static trigger (controls, JS and CSS)

**Files:**
- Modify: `framify-elementor.php`: `register_controls()`, `register_deco_controls()`, plus the new `register_placement_controls()`
- Replace: `assets/framify-elementor.js`
- Modify: `assets/framify-elementor.css`

**Interfaces:**
- Consumes (from Task 1):
  - `window.framifyOrganic.shapes[id] = { family, rest, hover, free? }`
  - `Framify_Elementor::wavy_ids()`
- Produces: element settings and CSS variables that Tasks 3 and 4 rely on.
  - **Settings:**
    - `framify_org_edge` (auto|none|left|right|top|bottom)
    - `framify_org_trigger` (auto|none|hover|inview|loop)
  - **Responsive controls:**
    - `framify_org_{align_x,align_y,width,height,offset_x,offset_y}`
    - `framify_org_deco_{align_x,align_y,width,height,offset_x,offset_y}`
  - **CSS vars on the element wrapper:**
    - `--framify-{ax,ay,w,h,ox,oy}`
    - `--framify-deco-{ax,ay,w,h,ox,oy}`
    - Values are unitless: ax/ay are 0 | 0.5 | 1; w/h/ox/oy are percent numbers.

- [ ] **Step 1: Confirm Elementor supports negated array conditions**

Run: `grep -n "is_negative_condition\|in_array" "D:/Local Sites/aberdeen-taxi-knowledge/app/public/wp-content/plugins/elementor/includes/conditions.php"`

Expected: `Conditions::check` uses `in_array` for array values and flips the result for keys ending in `!`, so `'framify_org_trigger!' => array( 'none', 'loop' )` means "not none and not loop".
If it does not, use `'conditions' => array( 'terms' => array( array( 'name' => 'framify_org_enable', 'value' => 'yes' ), array( 'name' => 'framify_org_trigger', 'operator' => '!in', 'value' => array( 'none', 'loop' ) ) ) )` instead of `condition` for Spring.

- [ ] **Step 2: Add the Flat edge, Placement and Trigger controls**

In `register_controls()`, directly after the `framify_org_shape` control, insert:

```php
        $element->add_control( 'framify_org_edge', $this->live( array(
            'label'       => esc_html__( 'Flat edge', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => 'auto',
            'options'     => array(
                'auto'   => esc_html__( 'Auto (follows position)', 'framify' ),
                'none'   => esc_html__( 'None', 'framify' ),
                'left'   => esc_html__( 'Left', 'framify' ),
                'right'  => esc_html__( 'Right', 'framify' ),
                'top'    => esc_html__( 'Top', 'framify' ),
                'bottom' => esc_html__( 'Bottom', 'framify' ),
            ),
            'description' => esc_html__( 'The straight side of a Wavy shape, flush with the element edge so it can run off the page.', 'framify' ),
            'condition'   => $on + array( 'framify_org_shape' => $this->wavy_ids() ),
        ) ) );

        $element->add_control( 'framify_org_placement_heading', array(
            'label'     => esc_html__( 'Placement', 'framify' ),
            'type'      => $cm::HEADING,
            'separator' => 'before',
            'condition' => $on,
        ) );

        $this->register_placement_controls( $element, '', array( 'w' => 100, 'h' => 100, 'ox' => 0, 'oy' => 0 ), $on );
```

Replace the existing `framify_org_trigger`, `framify_org_duration` and `framify_org_spring` controls, and the `framify_org_zoom` block, with:

```php
        $element->add_control( 'framify_org_trigger', $this->live( array(
            'label'       => esc_html__( 'Trigger', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => 'auto',
            'options'     => array(
                'auto'   => esc_html__( 'Auto (blobs on hover, wavy static)', 'framify' ),
                'none'   => esc_html__( 'None (static)', 'framify' ),
                'hover'  => esc_html__( 'On hover', 'framify' ),
                'inview' => esc_html__( 'Once, when scrolled into view', 'framify' ),
                'loop'   => esc_html__( 'Continuous gentle loop', 'framify' ),
            ),
            'description' => esc_html__( 'Static shapes ignore the motion settings below.', 'framify' ),
            'condition'   => $on,
        ) ) );

        $element->add_control( 'framify_org_duration', $this->live( array(
            'label'      => esc_html__( 'Duration (ms)', 'framify' ),
            'type'       => $cm::SLIDER,
            'size_units' => array( 'px' ),
            'range'      => array( 'px' => array( 'min' => 400, 'max' => 5000, 'step' => 100 ) ),
            'default'    => array( 'unit' => 'px', 'size' => 1500 ),
            'condition'  => $on + array( 'framify_org_trigger!' => 'none' ),
        ) ) );

        $element->add_control( 'framify_org_spring', $this->live( array(
            'label'     => esc_html__( 'Spring', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'normal',
            'options'   => array(
                'subtle' => esc_html__( 'Subtle', 'framify' ),
                'normal' => esc_html__( 'Normal', 'framify' ),
                'bouncy' => esc_html__( 'Bouncy', 'framify' ),
            ),
            'condition' => $on + array( 'framify_org_trigger!' => array( 'none', 'loop' ) ),
        ) ) );

        if ( ! $is_container ) {
            $element->add_control( 'framify_org_zoom', $this->live( array(
                'label'      => esc_html__( 'Image zoom (%)', 'framify' ),
                'type'       => $cm::SLIDER,
                'size_units' => array( 'px' ),
                'range'      => array( 'px' => array( 'min' => 0, 'max' => 20, 'step' => 1 ) ),
                'default'    => array( 'unit' => 'px', 'size' => 10 ),
                'condition'  => $on + array( 'framify_org_trigger!' => 'none' ),
            ) ) );
        }
```

- [ ] **Step 3: Add `register_placement_controls()` and use it for the deco**

In `register_deco_controls()`, delete the `$sliders = array( 'framify_org_deco_size' ...` block and its `foreach` loop. In their place (after the colour control, before grain), insert:

```php
        // Container "deco" mode positions the deco with the main Placement.
        if ( ! $is_container ) {
            $this->register_placement_controls( $element, 'deco_', array( 'w' => 108, 'h' => 108, 'ox' => 6, 'oy' => 6 ), $deco_on );
        }
```

Add this method after `register_deco_controls()`:

```php
    /**
     * Placement: where the shape sits in the element and how big it is.
     * Responsive, and written as CSS custom properties on the element rather
     * than JS settings: Elementor then resolves the value for the current
     * breakpoint, the JS reads it from computed style, and the editor preview
     * updates without re-rendering.
     */
    private function register_placement_controls( $element, $prefix, array $defaults, array $condition ) {
        $cm  = 'Elementor\Controls_Manager';
        $id  = 'framify_org_' . $prefix;
        $var = '--framify-' . str_replace( '_', '-', $prefix );

        $element->add_responsive_control( $id . 'align_x', array(
            'label'                => esc_html__( 'Horizontal position', 'framify' ),
            'type'                 => $cm::CHOOSE,
            'options'              => array(
                'left'   => array( 'title' => esc_html__( 'Left', 'framify' ),   'icon' => 'eicon-h-align-left' ),
                'center' => array( 'title' => esc_html__( 'Center', 'framify' ), 'icon' => 'eicon-h-align-center' ),
                'right'  => array( 'title' => esc_html__( 'Right', 'framify' ),  'icon' => 'eicon-h-align-right' ),
            ),
            'default'              => 'center',
            'toggle'               => false,
            'selectors_dictionary' => array( 'left' => '0', 'center' => '0.5', 'right' => '1' ),
            'selectors'            => array( '{{WRAPPER}}' => $var . 'ax: {{VALUE}};' ),
            'render_type'          => 'ui',
            'condition'            => $condition,
        ) );

        $element->add_responsive_control( $id . 'align_y', array(
            'label'                => esc_html__( 'Vertical position', 'framify' ),
            'type'                 => $cm::CHOOSE,
            'options'              => array(
                'top'    => array( 'title' => esc_html__( 'Top', 'framify' ),    'icon' => 'eicon-v-align-top' ),
                'middle' => array( 'title' => esc_html__( 'Middle', 'framify' ), 'icon' => 'eicon-v-align-middle' ),
                'bottom' => array( 'title' => esc_html__( 'Bottom', 'framify' ), 'icon' => 'eicon-v-align-bottom' ),
            ),
            'default'              => 'middle',
            'toggle'               => false,
            'selectors_dictionary' => array( 'top' => '0', 'middle' => '0.5', 'bottom' => '1' ),
            'selectors'            => array( '{{WRAPPER}}' => $var . 'ay: {{VALUE}};' ),
            'render_type'          => 'ui',
            'condition'            => $condition,
        ) );

        $sliders = array(
            'width'    => array( esc_html__( 'Width (%)', 'framify' ),    'w',  20,  150, $defaults['w'] ),
            'height'   => array( esc_html__( 'Height (%)', 'framify' ),   'h',  20,  150, $defaults['h'] ),
            'offset_x' => array( esc_html__( 'Offset X (%)', 'framify' ), 'ox', -50, 50,  $defaults['ox'] ),
            'offset_y' => array( esc_html__( 'Offset Y (%)', 'framify' ), 'oy', -50, 50,  $defaults['oy'] ),
        );
        foreach ( $sliders as $key => $s ) {
            $element->add_responsive_control( $id . $key, array(
                'label'       => $s[0],
                'type'        => $cm::SLIDER,
                'size_units'  => array( '%' ),
                'range'       => array( '%' => array( 'min' => $s[2], 'max' => $s[3], 'step' => 1 ) ),
                'default'     => array( 'unit' => '%', 'size' => $s[4] ),
                'selectors'   => array( '{{WRAPPER}}' => $var . $s[1] . ': {{SIZE}};' ),
                'render_type' => 'ui',
                'condition'   => $condition,
            ) );
        }
    }
```

Run: `php -l framify-elementor.php && php dev/tests/elementor-shapes-test.php`
Expected: `No syntax errors detected` and `ALL PASSED`.

- [ ] **Step 4: Replace the frontend script**

Replace the whole of `assets/framify-elementor.js` with:

```js
/**
 * Framify - Elementor Organic Shape (frontend + editor preview)
 *
 * Image widget: clips the real <img> (srcset, alt, lazy-load, links all
 * intact) to an SVG <clipPath> in objectBoundingBox units, so the shape
 * scales with any image size. Container: either clips the whole container
 * the same way, or puts a coloured shape behind its children.
 *
 * Two shape families come from the server: round Blobs, and wide Wavy
 * shapes with one straight side (the "flat edge", drawn on the right and
 * turned to any side here with an SVG transform). Placement - position,
 * size, offset - is written by Elementor as CSS custom properties per
 * breakpoint and read back from computed style, so each device gets its
 * own placement.
 *
 * Every rest/hover pair is generated server-side with an identical path
 * structure, so morphing is just blending the numbers in the two path
 * strings, driven by a small spring (elastic) animator. Reduced-motion
 * visitors only ever see the rest shape.
 *
 * File: assets/framify-elementor.js
 */
( function () {
	'use strict';

	var CONFIG = window.framifyOrganic || { shapes: {}, defaultShape: 'pebble' };
	var SVG_NS = 'http://www.w3.org/2000/svg';
	var NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
	var SPRING_PERIOD = { subtle: 0.75, normal: 0.45, bouncy: 0.3 };
	var REDUCE_MOTION = !! ( window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches );
	// Wavy shapes are drawn with a straight right edge. These turn that edge to
	// the chosen side inside the 0-100 box, which is still square at that
	// point (objectBoundingBox / preserveAspectRatio="none" stretch it later).
	var EDGE_TRANSFORM = { right: '', left: 'translate(100 0) scale(-1 1)', top: 'rotate(-90 50 50)', bottom: 'rotate(90 50 50)' };
	// Placement defaults, mirroring the PHP control defaults.
	var MAIN_BOX = { w: 100, h: 100, ox: 0, oy: 0 };
	var DECO_BOX = { w: 108, h: 108, ox: 6, oy: 6 };
	var uid = 0;

	/* ---------- path morphing ---------- */

	function parsePath( d ) {
		return { d: d, parts: d.split( NUMBER ), nums: ( d.match( NUMBER ) || [] ).map( Number ) };
	}

	function blendPath( a, b, t ) {
		var out = a.parts[ 0 ];
		for ( var i = 0; i < a.nums.length; i++ ) {
			out += ( a.nums[ i ] + ( b.nums[ i ] - a.nums[ i ] ) * t ).toFixed( 2 ) + a.parts[ i + 1 ];
		}
		return out;
	}

	/* ---------- shapes ---------- */

	// Published pages omit settings left at their default, so callers pass
	// the control's own default as the fallback.
	function shapeData( id, fallback ) {
		return CONFIG.shapes[ id ] || CONFIG.shapes[ fallback || CONFIG.defaultShape ] || null;
	}

	function familyOf( id, fallback ) {
		var shape = shapeData( id, fallback );
		return shape && shape.family ? shape.family : 'blob';
	}

	// A Wavy shape with no flat edge uses its free-standing variant.
	function shapePair( id, fallback, edge ) {
		var shape = shapeData( id, fallback );
		if ( ! shape ) {
			return null;
		}
		var source = 'none' === edge && shape.free ? shape.free : shape;
		return { rest: parsePath( source.rest ), hover: parsePath( source.hover ) };
	}

	// Blobs have no flat edge; a Wavy "auto" edge follows the horizontal position.
	function resolveEdge( family, setting, ax ) {
		if ( 'wavy' !== family ) {
			return 'none';
		}
		if ( setting && 'auto' !== setting ) {
			return setting;
		}
		if ( ax < 0.25 ) {
			return 'left';
		}
		return ax > 0.75 ? 'right' : 'none';
	}

	function edgeTransform( edge ) {
		return EDGE_TRANSFORM[ edge ] || '';
	}

	// Grain defaults to on: absent means default, '' means switched off.
	function grainOn( s ) {
		return undefined === s.framify_org_deco_grain || 'yes' === s.framify_org_deco_grain;
	}

	/* ---------- easing ---------- */

	// Elastic ease-out; a smaller period = more, faster wobbles.
	function elastic( period ) {
		return function ( t ) {
			if ( t <= 0 ) {
				return 0;
			}
			if ( t >= 1 ) {
				return 1;
			}
			return Math.pow( 2, -10 * t ) * Math.sin( ( t - period / 4 ) * ( 2 * Math.PI ) / period ) + 1;
		};
	}

	function easeInOutSine( t ) {
		return -( Math.cos( Math.PI * t ) - 1 ) / 2;
	}

	/* ---------- helpers ---------- */

	// Elementor slider settings arrive as { unit, size }.
	function number( setting, fallback ) {
		if ( setting && 'object' === typeof setting ) {
			setting = setting.size;
		}
		var n = parseFloat( setting );
		return isNaN( n ) ? fallback : n;
	}

	function svgEl( name, attrs ) {
		var el = document.createElementNS( SVG_NS, name );
		Object.keys( attrs || {} ).forEach( function ( key ) {
			el.setAttribute( key, attrs[ key ] );
		} );
		return el;
	}

	/* ---------- placement ---------- */

	// The shape's box in fractions of the element (or image) box, from the
	// CSS custom properties Elementor writes for the current breakpoint.
	function readBox( el, prefix, defaults ) {
		var style = window.getComputedStyle( el );
		var read = function ( name, fallback ) {
			var n = parseFloat( style.getPropertyValue( '--framify-' + prefix + name ) );
			return isNaN( n ) ? fallback : n;
		};
		var w = read( 'w', defaults.w ) / 100;
		var h = read( 'h', defaults.h ) / 100;
		var ax = read( 'ax', 0.5 );
		var ay = read( 'ay', 0.5 );
		return {
			x: ( 1 - w ) * ax + read( 'ox', defaults.ox ) / 100,
			y: ( 1 - h ) * ay + read( 'oy', defaults.oy ) / 100,
			w: w,
			h: h,
			ax: ax
		};
	}

	// The point the image zooms around: the middle of the flat edge, so no
	// gap opens along it; otherwise the centre of the shape.
	function zoomOrigin( box, edge ) {
		var x = box.x + box.w / 2;
		var y = box.y + box.h / 2;
		if ( 'left' === edge ) {
			x = box.x;
		} else if ( 'right' === edge ) {
			x = box.x + box.w;
		} else if ( 'top' === edge ) {
			y = box.y;
		} else if ( 'bottom' === edge ) {
			y = box.y + box.h;
		}
		return { x: x, y: y };
	}

	// Clip paths live in 0-100 units; this maps one into the placement box in
	// objectBoundingBox units (0-1). zoom > 1 shrinks the clip around `origin`
	// by the factor the image is scaled up, so the photo zooms inside a
	// shape that stays put.
	function clipTransform( box, edge, zoom, origin ) {
		var t = '';
		if ( zoom && 1 !== zoom ) {
			t = 'translate(' + origin.x + ' ' + origin.y + ') scale(' + ( 1 / zoom ) + ') translate(' + ( -origin.x ) + ' ' + ( -origin.y ) + ') ';
		}
		t += 'translate(' + box.x + ' ' + box.y + ') scale(' + ( box.w / 100 ) + ' ' + ( box.h / 100 ) + ')';
		return edgeTransform( edge ) ? t + ' ' + edgeTransform( edge ) : t;
	}

	// Image widget: against the <img> layout box (offset*, which ignore the
	// zoom transform). Container: against the container, in percent.
	function positionDeco( svg, box, img ) {
		if ( img ) {
			svg.style.left = ( img.offsetLeft + img.offsetWidth * box.x ) + 'px';
			svg.style.top = ( img.offsetTop + img.offsetHeight * box.y ) + 'px';
			svg.style.width = ( img.offsetWidth * box.w ) + 'px';
			svg.style.height = ( img.offsetHeight * box.h ) + 'px';
			return;
		}
		svg.style.left = ( box.x * 100 ) + '%';
		svg.style.top = ( box.y * 100 ) + '%';
		svg.style.width = ( box.w * 100 ) + '%';
		svg.style.height = ( box.h * 100 ) + '%';
	}

	function buildClip( id, d ) {
		var svg = svgEl( 'svg', { 'class': 'framify-organic__defs', width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false' } );
		var clip = svgEl( 'clipPath', { id: id, clipPathUnits: 'objectBoundingBox' } );
		var path = svgEl( 'path', { d: d } );
		clip.appendChild( path );
		svg.appendChild( clip );
		return { svg: svg, path: path };
	}

	function buildDeco( id, d, color, grain ) {
		var svg = svgEl( 'svg', { 'class': 'framify-organic__deco', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' } );
		var path = svgEl( 'path', { d: d, fill: color || '#F2C53D' } );

		if ( grain ) {
			// Chalky speckle: fractal noise thresholded into soft white specks,
			// kept inside the shape, laid over the flat fill.
			var filterId = id + '-grain';
			var defs = svgEl( 'defs' );
			var filter = svgEl( 'filter', { id: filterId, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' } );
			// Low frequency + soft alpha ramp = broad chalky patches, like a
			// dry-brushed print; higher frequency read as sharp sprinkles.
			filter.appendChild( svgEl( 'feTurbulence', { type: 'fractalNoise', baseFrequency: '0.45', numOctaves: '3', seed: '7', result: 'noise' } ) );
			filter.appendChild( svgEl( 'feColorMatrix', { 'in': 'noise', type: 'matrix', values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.6 0 0 0 -0.78', result: 'specks' } ) );
			filter.appendChild( svgEl( 'feComposite', { 'in': 'specks', in2: 'SourceGraphic', operator: 'in', result: 'specksIn' } ) );
			var merge = svgEl( 'feMerge' );
			merge.appendChild( svgEl( 'feMergeNode', { 'in': 'SourceGraphic' } ) );
			merge.appendChild( svgEl( 'feMergeNode', { 'in': 'specksIn' } ) );
			filter.appendChild( merge );
			defs.appendChild( filter );
			svg.appendChild( defs );
			path.setAttribute( 'filter', 'url(#' + filterId + ')' );
		}

		svg.appendChild( path );
		return { svg: svg, path: path };
	}

	/* ---------- Elementor handler ---------- */

	window.addEventListener( 'elementor/frontend/init', function () {
		var Base = elementorModules.frontend.handlers.Base;

		var OrganicShape = Base.extend( {

			// Explicit ID so this handler never collides with another
			// extend()-built handler on the same element in the editor.
			getConstructorID: function () {
				return 'FramifyOrganicShape';
			},

			onInit: function () {
				Base.prototype.onInit.apply( this, arguments );
				this.setup();
			},

			onElementChange: function ( name ) {
				if ( 0 !== name.indexOf( 'framify_org_' ) ) {
					return;
				}
				var self = this;
				clearTimeout( this.rebuildTimer );
				// Placement controls change CSS rather than settings; give the
				// preview time to apply it before reading it back.
				this.rebuildTimer = setTimeout( function () {
					self.rebuild();
				}, 120 );
			},

			onDestroy: function () {
				clearTimeout( this.rebuildTimer );
				this.teardown();
				Base.prototype.onDestroy.apply( this, arguments );
			},

			rebuild: function () {
				clearTimeout( this.rebuildTimer );
				this.teardown();
				this.setup();
			},

			setup: function () {
				var s = this.getElementSettings();
				if ( 'yes' !== s.framify_org_enable || ! shapeData( s.framify_org_shape ) ) {
					return;
				}

				var el = this.$element[ 0 ];
				var id = 'framify-org-' + ( ++uid );
				var fx = this.fx = {
					el: el,
					value: 0,
					raf: 0,
					loopTimer: 0,
					looping: false,
					parts: [],
					cleanup: [],
					family: familyOf( s.framify_org_shape ),
					edgeSetting: s.framify_org_edge || 'auto',
					edge: 'none',
					img: null,
					clip: null,
					deco: null,
					zoom: 0
				};
				fx.edge = resolveEdge( fx.family, fx.edgeSetting, readBox( el, '', MAIN_BOX ).ax );

				if ( 'container' === this.getElementType() ) {
					this.setupContainer( el, id, s );
				} else {
					this.setupImage( el, id, s );
				}

				if ( ! fx.parts.length ) {
					return;
				}
				this.observeLayout();
				this.place();
				if ( ! REDUCE_MOTION ) {
					this.bindTrigger( el, s );
				}
			},

			setupImage: function ( el, id, s ) {
				var fx = this.fx;
				var img = el.querySelector( 'img' );
				if ( ! img ) {
					return;
				}

				var main = shapePair( s.framify_org_shape, null, fx.edge );
				var clip = buildClip( id, main.rest.d );
				el.appendChild( clip.svg );
				el.classList.add( 'framify-organic' );
				img.style.clipPath = 'url(#' + id + ')';
				img.style.webkitClipPath = 'url(#' + id + ')';

				fx.img = img;
				fx.clip = { path: clip.path, box: null, origin: null };
				fx.zoom = number( s.framify_org_zoom, 10 ) / 100;
				fx.parts.push( { pair: main, path: clip.path } );
				fx.cleanup.push( function () {
					clip.svg.remove();
					img.style.clipPath = '';
					img.style.webkitClipPath = '';
					img.style.transform = '';
					img.style.transformOrigin = '';
					el.classList.remove( 'framify-organic' );
				} );

				if ( 'yes' !== s.framify_org_deco ) {
					return;
				}
				// The deco has its own shape and placement; a Wavy deco's flat
				// edge always follows its own horizontal position.
				var decoFamily = familyOf( s.framify_org_deco_shape, 'splash' );
				var decoEdge = resolveEdge( decoFamily, 'auto', readBox( el, 'deco-', DECO_BOX ).ax );
				var decoPair = shapePair( s.framify_org_deco_shape, 'splash', decoEdge );
				var deco = buildDeco( id, decoPair.rest.d, s.framify_org_deco_color, grainOn( s ) );
				deco.path.setAttribute( 'transform', edgeTransform( decoEdge ) );
				el.insertBefore( deco.svg, el.firstChild );

				fx.deco = { svg: deco.svg, prefix: 'deco-', defaults: DECO_BOX, family: decoFamily, edge: decoEdge, anchor: img };
				fx.parts.push( { pair: decoPair, path: deco.path } );
				fx.cleanup.push( function () {
					deco.svg.remove();
				} );
			},

			setupContainer: function ( el, id, s ) {
				var fx = this.fx;
				var main = shapePair( s.framify_org_shape, null, fx.edge );

				if ( 'clip' === s.framify_org_mode ) {
					var clip = buildClip( id, main.rest.d );
					el.appendChild( clip.svg );
					el.style.clipPath = 'url(#' + id + ')';
					el.style.webkitClipPath = 'url(#' + id + ')';
					fx.clip = { path: clip.path, box: null, origin: null };
					fx.parts.push( { pair: main, path: clip.path } );
					fx.cleanup.push( function () {
						clip.svg.remove();
						el.style.clipPath = '';
						el.style.webkitClipPath = '';
					} );
					return;
				}

				var deco = buildDeco( id, main.rest.d, s.framify_org_deco_color, grainOn( s ) );
				deco.path.setAttribute( 'transform', edgeTransform( fx.edge ) );

				var madeRelative = 'static' === window.getComputedStyle( el ).position;
				if ( madeRelative ) {
					el.style.position = 'relative';
				}
				el.classList.add( 'framify-organic-container' );
				el.insertBefore( deco.svg, el.firstChild );

				// In deco mode the deco IS the shape, so it uses the main placement.
				fx.deco = { svg: deco.svg, prefix: '', defaults: MAIN_BOX, family: fx.family, edge: fx.edge, anchor: null };
				fx.parts.push( { pair: main, path: deco.path } );
				fx.cleanup.push( function () {
					deco.svg.remove();
					el.classList.remove( 'framify-organic-container' );
					if ( madeRelative ) {
						el.style.position = '';
					}
				} );
			},

			// Placement can change with no settings change: a window resize, an
			// editor device switch, a breakpoint, the image loading.
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
				window.addEventListener( 'resize', place );
				if ( fx.img ) {
					fx.img.addEventListener( 'load', place );
				}
				fx.cleanup.push( function () {
					if ( observer ) {
						observer.disconnect();
					}
					window.removeEventListener( 'resize', place );
					if ( fx.img ) {
						fx.img.removeEventListener( 'load', place );
					}
				} );
			},

			// Applies the current placement. A different flat edge needs a
			// different path, so that case rebuilds instead.
			place: function () {
				var fx = this.fx;
				if ( ! fx ) {
					return;
				}
				var box = readBox( fx.el, '', MAIN_BOX );
				if ( resolveEdge( fx.family, fx.edgeSetting, box.ax ) !== fx.edge ) {
					this.rebuild();
					return;
				}

				if ( fx.deco ) {
					var deco = fx.deco;
					var decoBox = deco.prefix ? readBox( fx.el, deco.prefix, deco.defaults ) : box;
					if ( deco.prefix && resolveEdge( deco.family, 'auto', decoBox.ax ) !== deco.edge ) {
						this.rebuild();
						return;
					}
					positionDeco( deco.svg, decoBox, deco.anchor );
				}

				if ( fx.clip ) {
					fx.clip.box = box;
					fx.clip.origin = zoomOrigin( box, fx.edge );
					if ( fx.img ) {
						fx.img.style.transformOrigin = ( fx.clip.origin.x * 100 ) + '% ' + ( fx.clip.origin.y * 100 ) + '%';
					}
				}
				this.render( fx.value );
			},

			bindTrigger: function ( el, s ) {
				var self = this;
				var fx = this.fx;
				var trigger = s.framify_org_trigger || 'auto';
				if ( 'auto' === trigger ) {
					trigger = 'wavy' === fx.family ? 'none' : 'hover';
				}
				if ( 'none' === trigger ) {
					return;
				}
				var duration = Math.max( 200, number( s.framify_org_duration, 1500 ) );
				var ease = elastic( SPRING_PERIOD[ s.framify_org_spring ] || SPRING_PERIOD.normal );

				if ( 'hover' === trigger ) {
					var enter = function () {
						self.animate( 1, duration, ease );
					};
					var leave = function () {
						self.animate( 0, duration, ease );
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
								self.animate( 1, duration, ease );
								observer.disconnect();
							}
						} else if ( entry.isIntersecting ) {
							self.startLoop( duration );
						} else {
							self.stopLoop();
						}
					} );
				}, { threshold: 0.35 } );
				observer.observe( el );
				fx.cleanup.push( function () {
					observer.disconnect();
				} );
			},

			animate: function ( target, duration, ease ) {
				var self = this;
				var fx = this.fx;
				var from = fx.value;
				var start = null;
				cancelAnimationFrame( fx.raf );

				var step = function ( now ) {
					if ( null === start ) {
						start = now;
					}
					var t = Math.min( 1, ( now - start ) / duration );
					fx.value = from + ( target - from ) * ease( t );
					self.render( fx.value );
					if ( t < 1 ) {
						fx.raf = requestAnimationFrame( step );
					} else {
						fx.value = target;
					}
				};
				fx.raf = requestAnimationFrame( step );
			},

			startLoop: function ( duration ) {
				var self = this;
				var fx = this.fx;
				if ( fx.looping ) {
					return;
				}
				fx.looping = true;
				var go = function ( target ) {
					if ( ! fx.looping ) {
						return;
					}
					self.animate( target, duration, easeInOutSine );
					fx.loopTimer = setTimeout( function () {
						go( target ? 0 : 1 );
					}, duration );
				};
				go( fx.value >= 0.5 ? 0 : 1 );
			},

			stopLoop: function () {
				var fx = this.fx;
				fx.looping = false;
				clearTimeout( fx.loopTimer );
				cancelAnimationFrame( fx.raf );
			},

			render: function ( value ) {
				var fx = this.fx;
				fx.parts.forEach( function ( part ) {
					part.path.setAttribute( 'd', blendPath( part.pair.rest, part.pair.hover, value ) );
				} );
				if ( fx.clip && fx.clip.box ) {
					var zoom = fx.img ? 1 + fx.zoom * Math.max( 0, value ) : 1;
					if ( fx.img ) {
						fx.img.style.transform = 1 === zoom ? '' : 'scale(' + zoom + ')';
					}
					fx.clip.path.setAttribute( 'transform', clipTransform( fx.clip.box, fx.edge, zoom, fx.clip.origin ) );
				}
			},

			teardown: function () {
				var fx = this.fx;
				if ( ! fx ) {
					return;
				}
				fx.looping = false;
				clearTimeout( fx.loopTimer );
				cancelAnimationFrame( fx.raf );
				fx.cleanup.forEach( function ( fn ) {
					fn();
				} );
				this.fx = null;
			}
		} );

		elementorFrontend.elementsHandler.attachHandler( 'image', OrganicShape );
		// null skin: containers fire "frontend/element_ready/container", not "container.default".
		elementorFrontend.elementsHandler.attachHandler( 'container', OrganicShape, null );
	} );
}() );
```

Run: `node --check assets/framify-elementor.js && grep -nP '[^\x00-\x7F]' assets/framify-elementor.js framify-elementor.php`
Expected: no output from either command.

- [ ] **Step 5: Update the stylesheet**

In `assets/framify-elementor.css`, the deco no longer needs a centring transform, since JS sets its left, top, width and height. Replace the `.framify-organic__deco` rule with:

```css
/* Positioned and sized from the Placement controls by the script. */
.framify-organic__deco {
	position: absolute;
	z-index: 0;
	pointer-events: none;
	overflow: visible;
}
```

The file needs no other changes in this task.

- [ ] **Step 6: Build the test cases in the editor**

1. Open the editor URL with Playwright.
2. If a "Take Over" dialog appears, it is our own stale lock, so take over.
3. Run this with `browser_evaluate`:

```js
async () => {
  const img = elementor.getContainer( 'fo00003' ).settings.get( 'image' );
  const pct = ( n ) => ( { unit: '%', size: n, sizes: [] } );
  const image = ( cssId, extra ) => ( { elType: 'widget', widgetType: 'image', settings: Object.assign( { image: img, _element_id: cssId, framify_org_enable: 'yes', framify_org_shape: 'tide' }, extra ) } );
  const row = ( children ) => ( { elType: 'container', settings: { flex_direction: 'row', flex_wrap: 'wrap' }, elements: children } );
  const doc = elementor.getPreviewContainer();
  $e.run( 'document/elements/create', { container: doc, model: row( [
    image( 'fo-wr', { framify_org_align_x: 'right', framify_org_trigger: 'hover' } ),
    image( 'fo-wa', { framify_org_align_x: 'right', framify_org_align_x_mobile: 'center' } ),
    image( 'fo-wn', { framify_org_edge: 'none' } ),
    image( 'fo-wl', { framify_org_edge: 'left' } ),
    image( 'fo-wt', { framify_org_edge: 'top' } ),
    image( 'fo-wb', { framify_org_edge: 'bottom' } ),
    image( 'fo-deco', { framify_org_shape: 'pebble', framify_org_deco: 'yes', framify_org_deco_shape: 'dune', framify_org_deco_align_x: 'right', framify_org_deco_align_y: 'bottom', framify_org_deco_width: pct( 80 ), framify_org_deco_height: pct( 80 ) } )
  ] ) } );
  $e.run( 'document/elements/create', { container: doc, model: {
    elType: 'container',
    settings: { _element_id: 'fo-yellow', min_height: { unit: 'px', size: 420, sizes: [] }, framify_org_enable: 'yes', framify_org_mode: 'deco', framify_org_shape: 'swell', framify_org_deco_color: '#F2C53D', framify_org_align_x: 'right', framify_org_width: pct( 90 ), framify_org_height: pct( 110 ) },
    elements: [ image( 'fo-nest', { framify_org_shape: 'pebble' } ) ]
  } } );
  await $e.run( 'document/save/draft' );
  return 'created';
}
```

Expected: `"created"`, and the editor shows the new elements.

- [ ] **Step 7: Verify in the preview**

Navigate to the preview URL at a viewport of 1280x900 and run:

```js
async () => {
  const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
  const q = ( id ) => document.getElementById( id );
  const parts = ( id ) => {
    const img = q( id ).querySelector( 'img' );
    const clipId = ( img.style.clipPath.match( /#([\w-]+)/ ) || [] )[ 1 ];
    return { img, path: clipId && document.getElementById( clipId ).querySelector( 'path' ) };
  };
  const hit = ( img, x, y ) => document.elementFromPoint( x, y ) === img;
  const out = {};

  const wr = parts( 'fo-wr' );
  wr.img.scrollIntoView( { block: 'center' } );
  await wait( 200 );
  const r = wr.img.getBoundingClientRect();
  out.wrAnchored = wr.path.getAttribute( 'd' ).startsWith( 'M100.00 0.00' );
  out.wrRightFlush = hit( wr.img, r.right - 2, r.top + r.height * 0.5 ) && hit( wr.img, r.right - 2, r.top + 4 ) && hit( wr.img, r.right - 2, r.bottom - 4 );
  out.wrLeftCut = ! hit( wr.img, r.left + 2, r.top + 4 );
  q( 'fo-wr' ).dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 1700 );
  out.wrZoomed = /scale\(1\.1\)/.test( wr.img.style.transform );
  out.wrRightFlushZoomed = hit( wr.img, r.right - 2, r.top + r.height * 0.5 );
  q( 'fo-wr' ).dispatchEvent( new MouseEvent( 'mouseleave' ) );

  const wa = parts( 'fo-wa' );
  const before = wa.path.getAttribute( 'd' );
  q( 'fo-wa' ).dispatchEvent( new MouseEvent( 'mouseenter' ) );
  await wait( 600 );
  out.autoWavyStatic = before === wa.path.getAttribute( 'd' );

  out.noneIsFree = ! parts( 'fo-wn' ).path.getAttribute( 'd' ).startsWith( 'M100.00 0.00' );
  out.edgeLeft = parts( 'fo-wl' ).path.getAttribute( 'transform' ).endsWith( 'translate(100 0) scale(-1 1)' );
  out.edgeTop = parts( 'fo-wt' ).path.getAttribute( 'transform' ).endsWith( 'rotate(-90 50 50)' );
  out.edgeBottom = parts( 'fo-wb' ).path.getAttribute( 'transform' ).endsWith( 'rotate(90 50 50)' );

  const dImg = q( 'fo-deco' ).querySelector( 'img' );
  const dSvg = q( 'fo-deco' ).querySelector( '.framify-organic__deco' );
  const near = ( a, b ) => Math.abs( a - b ) < 1.5;
  out.decoPlaced = near( parseFloat( dSvg.style.left ), dImg.offsetLeft + dImg.offsetWidth * 0.26 )
    && near( parseFloat( dSvg.style.top ), dImg.offsetTop + dImg.offsetHeight * 0.26 )
    && near( parseFloat( dSvg.style.width ), dImg.offsetWidth * 0.8 );
  out.decoWavyEdgeRight = '' === dSvg.querySelector( 'path' ).getAttribute( 'transform' );

  const ySvg = q( 'fo-yellow' ).querySelector( ':scope > .framify-organic__deco' );
  out.yellowPlaced = Math.round( parseFloat( ySvg.style.left ) ) === 10 && Math.round( parseFloat( ySvg.style.top ) ) === -5 && Math.round( parseFloat( ySvg.style.width ) ) === 90;
  out.nestedUsesOwnBox = parts( 'fo-nest' ).path.getAttribute( 'transform' ).startsWith( 'translate(0 0) scale(0.01 0.01)' );
  return out;
}
```

Expected: every value is `true`.

Then check the responsive placement:
1. Resize the viewport to 375x800, wait 400 ms, and evaluate `document.querySelector('#fo-wa img').style.clipPath` → the referenced path `d` must **not** start with `M100.00 0.00`: mobile is centred, so the edge is `none` and the free variant is used.
2. Resize back to 1280x900: it starts with `M100.00 0.00` again.
3. Check `browser_console_messages` for errors: expect none.

- [ ] **Step 8: Visual check (frontend-design)**

Take a full-page screenshot of the preview at 1280 and at 375 wide.

Review it with the frontend-design eye:
- The wavy crops read as intentional and hand-drawn, not as ellipses.
- The flat edges sit exactly on the element edge.
- The yellow grainy shape behind `fo-yellow` looks like the reference backdrop.

If a shape looks wrong, tune its numbers in `wavy_presets()` and rerun Task 1 Step 5.

---

### Task 3: Float effect

**Files:**
- Modify: `framify-elementor.php` (constructor, plus the new `register_float_controls()`)
- Modify: `assets/framify-elementor.css`

**Interfaces:**
- Consumes: the `self::TAB` Framify tab from `register_tab()`.
- Produces:
  - Setting `framify_float` ('yes' or ''), with prefix class `framify-float-yes` on the widget wrapper
  - CSS vars `--framify-float-d` (px), `--framify-float-t` (s), `--framify-float-delay` (s), `--framify-float-r` (deg)

- [ ] **Step 1: Write the failing check**

On the preview page, run:

```js
() => {
  const el = document.getElementById( 'fo-nest' );
  return { cls: el.classList.contains( 'framify-float-yes' ), anim: getComputedStyle( el ).animationName };
}
```

Expected now: `{ cls: false, anim: "none" }`. The target after Step 5 is `{ cls: true, anim: "framify-float" }`.

- [ ] **Step 2: Register the controls**

In the constructor, after the two `register_*_controls` hooks, add:

```php
        // Float goes on every widget. Elementor builds the shared widget
        // controls from "common", or "common-optimized" when the Optimized
        // Markup feature is on, so hook both.
        add_action( 'elementor/element/common/_section_responsive/after_section_end', array( $this, 'register_float_controls' ) );
        add_action( 'elementor/element/common-optimized/_section_responsive/after_section_end', array( $this, 'register_float_controls' ) );
```

Add this method after `register_placement_controls()`:

```php
    /**
     * Float: a gentle bob for any widget, all CSS (see framify-elementor.css).
     * Controls write custom properties and a prefix class, so the editor
     * preview updates without re-rendering and no script is involved.
     */
    public function register_float_controls( $element ) {
        $cm = 'Elementor\Controls_Manager';
        $on = array( 'framify_float' => 'yes' );

        $element->start_controls_section( 'framify_float_section', array(
            'label' => esc_html__( 'Float', 'framify' ),
            'tab'   => self::TAB,
        ) );

        $element->add_control( 'framify_float', array(
            'label'        => esc_html__( 'Float', 'framify' ),
            'type'         => $cm::SWITCHER,
            'label_on'     => esc_html__( 'On', 'framify' ),
            'label_off'    => esc_html__( 'Off', 'framify' ),
            'default'      => '',
            'prefix_class' => 'framify-float-',
            'render_type'  => 'ui',
        ) );

        $sliders = array(
            'framify_float_distance' => array( esc_html__( 'Distance', 'framify' ), 'px',  2, 60, 1,   12, '--framify-float-d' ),
            'framify_float_duration' => array( esc_html__( 'Duration', 'framify' ), 's',   1, 12, 0.5, 4,  '--framify-float-t' ),
            'framify_float_delay'    => array( esc_html__( 'Delay', 'framify' ),    's',   0, 5,  0.1, 0,  '--framify-float-delay' ),
            'framify_float_rotate'   => array( esc_html__( 'Rotate', 'framify' ),   'deg', 0, 15, 1,   0,  '--framify-float-r' ),
        );
        foreach ( $sliders as $id => $s ) {
            $element->add_control( $id, array(
                'label'       => $s[0],
                'type'        => $cm::SLIDER,
                'size_units'  => array( $s[1] ),
                'range'       => array( $s[1] => array( 'min' => $s[2], 'max' => $s[3], 'step' => $s[4] ) ),
                'default'     => array( 'unit' => $s[1], 'size' => $s[5] ),
                'selectors'   => array( '{{WRAPPER}}' => $s[6] . ': {{SIZE}}{{UNIT}};' ),
                'render_type' => 'ui',
                'condition'   => $on,
            ) );
        }

        $element->end_controls_section();
    }
```

Run: `php -l framify-elementor.php`
Expected: `No syntax errors detected`.

- [ ] **Step 3: Add the Float CSS**

Append to `assets/framify-elementor.css`:

```css
/* Float: a gentle bob on any widget. Animates the individual translate and
   rotate properties, not transform, so it adds to Elementor's own Transform
   and Motion Effects instead of replacing them. */
.elementor-element.framify-float-yes {
	animation: framify-float var(--framify-float-t, 4s) ease-in-out var(--framify-float-delay, 0s) infinite alternate;
}

@keyframes framify-float {
	from {
		translate: 0 0;
		rotate: 0deg;
	}
	to {
		translate: 0 calc(-1 * var(--framify-float-d, 12px));
		rotate: var(--framify-float-r, 0deg);
	}
}

@media (prefers-reduced-motion: reduce) {
	.elementor-element.framify-float-yes {
		animation: none;
	}
}
```

Known limit: an Elementor Entrance Animation on the same widget also sets `animation`, and the more specific rule wins. Recommend one or the other; this goes in `CLAUDE.md` in Task 4.

- [ ] **Step 4: Turn Float on for the test children**

In the editor, run:

```js
async () => {
  $e.run( 'document/elements/settings', { container: elementor.getContainer( elementor.$preview[0].contentDocument.getElementById( 'fo-nest' ).dataset.id ), settings: { framify_float: 'yes', framify_float_rotate: { unit: 'deg', size: 4, sizes: [] } }, options: { external: true } } );
  const yellow = elementor.getContainer( elementor.$preview[0].contentDocument.getElementById( 'fo-yellow' ).dataset.id );
  const img = elementor.getContainer( 'fo00003' ).settings.get( 'image' );
  $e.run( 'document/elements/create', { container: yellow, model: { elType: 'widget', widgetType: 'image', settings: { image: img, _element_id: 'fo-float2', framify_float: 'yes', framify_float_delay: { unit: 's', size: 1.5, sizes: [] }, width: { unit: '%', size: 30, sizes: [] } } } } );
  await $e.run( 'document/save/draft' );
  return 'ok';
}
```

Expected: `"ok"`.

- [ ] **Step 5: Verify**

Reload the preview and run:

```js
() => ['fo-nest', 'fo-float2'].map( ( id ) => {
  const el = document.getElementById( id );
  const cs = getComputedStyle( el );
  return { id, cls: el.classList.contains( 'framify-float-yes' ), anim: cs.animationName, delay: cs.animationDelay };
} )
```

Expected:
- `fo-nest`: `{ cls: true, anim: "framify-float", delay: "0s" }`
- `fo-float2`: `{ cls: true, anim: "framify-float", delay: "1.5s" }`

Then run `browser_emulate_media` with `reducedMotion: 'reduce'`, reload, and rerun. Expected: `anim: "none"` for both, and also `autoWavyStatic` / no morph. Reset the emulation afterwards.

- [ ] **Step 6: Editor live check**

In the editor, select any Heading widget and open the Framify tab: expect a "Float" section. Turn Float on with a real click on the switch. Within 500 ms the element in the preview iframe has the class `framify-float-yes`, with no reload. Undo with Ctrl+Z; don't save that change.

Run: `grep -nP '[^\x00-\x7F]' framify-elementor.php assets/framify-elementor.css`
Expected: no output.

---

### Task 4: Editor verification, docs and review

**Files:**
- Modify: `CLAUDE.md` (the "Elementor module" section)
- Modify: `framify-elementor.php` (file docblock, lines 2-13)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation and review sign-off.

- [ ] **Step 1: Editor placement checks with real UI clicks**

In the editor, click the `fo-wa` image, open the Framify tab, and use `browser_snapshot` to find the controls. Then:
1. Click "Center" under **Horizontal position**. Within 300 ms, the preview `#fo-wa` clip path `d` no longer starts with `M100.00 0.00`: the Auto edge becomes `none`.
2. Click "Right" again. It starts with `M100.00 0.00` again.
3. Drag or type **Width (%)** = 60. The clip `transform` contains `scale(0.006 `.
4. Switch the editor's device mode to Mobile. The shape shows centred (mobile value), and back on Desktop it's right-aligned.
5. Select a Blob shape (Pebble). The **Flat edge** control disappears.
6. Set Trigger to "None (static)". Duration, Spring and Zoom disappear.

Also check `browser_console_messages`: expect no errors.
Do not save these UI experiments; undo them or reload without saving.

- [ ] **Step 2: Update the docs**

Replace the file docblock in `framify-elementor.php` with:

```php
/**
 * Framify - Elementor module
 *
 * Adds a "Framify" tab to Elementor's panel.
 * - Organic Shape (Image widget + Containers): clip to, or place behind, a
 *   Blob or a Wavy shape (one straight "flat edge" for bleeding off the
 *   page), with responsive Placement and optional spring motion on hover /
 *   scroll-in / loop, plus an optional coloured, grainy deco shape.
 * - Float (every widget): a gentle CSS-only bob.
 *
 * Loaded from framify.php. Entirely inert unless Elementor is active.
 *
 * File: framify-elementor.php
 */
```

In `CLAUDE.md`, in the "### Elementor module" section, add these bullets after the existing ones:

```markdown
- **Two shape families.** Blobs (radial ring, `build_path`) and Wavy (`wavy_anchored` / `wavy_free`: superellipse pushed in by two whole-number-frequency waves). Wavy is drawn with a straight *right* edge; the JS turns it to left/top/bottom with an SVG transform (`EDGE_TRANSFORM`) and uses the `free` variant for "none". Keep `inset >= amp1 + amp2` or the outline leaves the box.
- **Placement is CSS, not settings.** Responsive controls write `--framify-*` / `--framify-deco-*` custom properties on the wrapper; `readBox()` reads computed style, so breakpoints work with no JS plumbing. Anything that changes the flat edge (e.g. Auto edge + a new horizontal position) rebuilds the element, because the path itself changes.
- **Trigger "auto"** = hover for Blobs, static for Wavy (Elementor can't vary one control's default by another).
- **Float** (`register_float_controls`, hooked on both `common` and `common-optimized`) is pure CSS animating `translate`/`rotate`, so it composes with Elementor's Transform/Motion Effects. It conflicts with an Entrance Animation on the same widget (both set `animation`).
- **Geometry tests:** `php dev/tests/elementor-shapes-test.php` (CLI only). Run `--baseline` before touching Blob geometry, `--preview` to eyeball shapes.
```

Run: `grep -nP '[^\x00-\x7F]' CLAUDE.md framify-elementor.php`
Expected: no new matches. `CLAUDE.md` may already contain arrows elsewhere; only the new lines must be ASCII.

- [ ] **Step 3: Quality review (feature-dev)**

Dispatch 3 `feature-dev:code-reviewer` agents in parallel on the changed files, each with a different focus:
1. Bugs and functional correctness. Include: the omitted-default `data-settings` behaviour; CSS-var inheritance into nested elements; rebuild loops from `place()`; teardown completeness.
2. Simplicity, DRY and elegance.
3. Framify conventions (`CLAUDE.md`).

Fix confirmed issues and rerun Task 1 Step 5 and Task 2 Step 7.

- [ ] **Step 4: Final visual review (frontend-design)**

Take preview screenshots at 1280, 768 and 375 wide, and one mid-hover frame of `fo-wr`. Judge them against the two reference screenshots: the wavy dog-photo crop and the yellow grainy backdrop with floating objects. Tune presets or defaults only if the result fails that comparison.

- [ ] **Step 5: Report**

Summarise for the user:
- the new controls and where they are
- the test page ids (`fo-*` on page 145) to delete when done
- deployment: live still runs Framify 1.6.0, so it needs the whole plugin folder, excluding `dev/`
```
