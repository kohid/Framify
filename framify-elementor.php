<?php
/**
 * Framify - Elementor module
 *
 * Adds a "Framify" tab to Elementor's panel.
 * - Organic Shape (Image widget, Containers, Spacer): clip to, or place behind, a
 *   Blob, a Wavy or a hand-placed Flow shape (Wavy and Flow keep one
 *   straight "flat edge" for bleeding off the page), or a pasted Custom SVG,
 *   with responsive Placement, optional spring motion on hover / scroll-in /
 *   loop, a coloured grainy deco shape, and grain in Container Clip mode.
 * - Float (every widget, nested Containers): a gentle CSS-only bob.
 *
 * Loaded from framify.php. Entirely inert unless Elementor is active.
 *
 * File: framify-elementor.php
 */

if ( ! defined( 'ABSPATH' ) ) exit;

require_once __DIR__ . '/framify-shape-library.php';

class Framify_Elementor {

    const TAB           = 'framify';
    const DEFAULT_SHAPE = 'pebble';

    public function __construct() {
        add_action( 'elementor/init', array( $this, 'register_tab' ) );

        // Tabs appear in the order their first control is registered, so hook
        // after each element's last section to put the Framify tab at the end.
        add_action( 'elementor/element/image/section_style_caption/after_section_end', array( $this, 'register_image_controls' ) );
        add_action( 'elementor/element/container/_section_responsive/after_section_end', array( $this, 'register_container_controls' ) );
        // Spacer: a standalone "decor block" with the container control set
        // (same ids, same JS path) plus the Image widget's Deco Blob section
        // for Clip mode. section_spacer is its only section, so the Framify
        // tab lands after Content and before Advanced (the common controls,
        // tabs included, are merged after the widget's own).
        add_action( 'elementor/element/spacer/section_spacer/after_section_end', array( $this, 'register_spacer_controls' ) );

        // Float goes on every widget. Elementor builds the shared widget
        // controls from "common", or "common-optimized" when the Optimized
        // Markup feature is on, so hook both.
        add_action( 'elementor/element/common/_section_responsive/after_section_end', array( $this, 'register_float_controls' ) );
        add_action( 'elementor/element/common-optimized/_section_responsive/after_section_end', array( $this, 'register_float_controls' ) );
        // Containers too, after Organic Shape / Grain (10), Floating Shapes
        // (20) and Floating Text (30). Float only runs on a nested container
        // (.e-child, see framify-elementor.css); the editor script hides the
        // section for a top-level one.
        add_action( 'elementor/element/container/_section_responsive/after_section_end', array( $this, 'register_float_controls' ), 40 );

        add_action( 'elementor/frontend/before_render', array( $this, 'globals_attribute' ) );
        add_action( 'elementor/frontend/after_enqueue_scripts', array( $this, 'enqueue_frontend_assets' ) );
        add_action( 'elementor/editor/after_enqueue_styles',    array( $this, 'enqueue_editor_assets' ) );
        add_action( 'elementor/editor/after_enqueue_scripts',   array( $this, 'enqueue_editor_scripts' ) );
    }

    public function register_tab() {
        \Elementor\Controls_Manager::add_tab( self::TAB, esc_html__( 'Framify', 'framify' ) );
    }

    /**
     * Panel note for the Layer control of Floating Shapes / Text on the
     * Image widget (both modules use it, so the wording stays in one place):
     * their Behind layer sits under the img, so only the parts Organic
     * Shape cuts away show it.
     */
    public static function image_layer_note() {
        return esc_html__( 'Behind content is hidden by an opaque photo unless Organic Shape cuts it.', 'framify' );
    }

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
    const WAVE_POINTS = 24;
    const SUPER_EXP   = 2.7;

    private function wavy_presets() {
        return array(
            'tide'    => array( 'title' => __( 'Tide', 'framify' ),    'rest' => array( 15, 8, 3, 310, 7, 1, 60 ),   'hover' => array( 15, 7, 3, 10, 8, 1, 125 ) ),
            'ripple'  => array( 'title' => __( 'Ripple', 'framify' ),  'rest' => array( 15, 10, 2, 4, 5, 3, 0 ),     'hover' => array( 15, 9, 2, 60, 6, 3, 70 ) ),
            'dune'    => array( 'title' => __( 'Dune', 'framify' ),    'rest' => array( 15, 8, 1, 25, 7, 2, 320 ),   'hover' => array( 15, 9, 1, 80, 6, 2, 20 ) ),
            'current' => array( 'title' => __( 'Current', 'framify' ), 'rest' => array( 14, 6, 3, 234, 8, 2, 198 ), 'hover' => array( 14, 5, 3, 290, 9, 2, 250 ) ),
            'swell'   => array( 'title' => __( 'Swell', 'framify' ),   'rest' => array( 15, 9, 2, 198, 6, 1, 144 ), 'hover' => array( 15, 8, 2, 250, 7, 1, 210 ) ),
            'shore'   => array( 'title' => __( 'Shore', 'framify' ),   'rest' => array( 15, 7, 3, 340, 8, 2, 18 ),   'hover' => array( 15, 6, 3, 40, 9, 2, 80 ) ),
        );
    }

    public function wavy_ids() {
        return array_keys( $this->wavy_presets() );
    }

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
                'rest'  => array( array( 100, 0 ), array( 80, 6 ), array( 60, 24 ), array( 46, 12 ), array( 26, 8 ), array( 10, 26 ), array( 4, 60 ), array( 12, 88 ), array( 38, 96 ), array( 64, 88 ), array( 84, 97 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 82, 8 ), array( 57, 28 ), array( 42, 14 ), array( 22, 7 ), array( 8, 24 ), array( 5, 56 ), array( 10, 86 ), array( 36, 97 ), array( 60, 91 ), array( 82, 94 ), array( 100, 100 ) ),
            ),
            'breeze' => array(
                'title' => __( 'Breeze', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 80, 10 ), array( 58, 3 ), array( 34, 6 ), array( 14, 14 ), array( 5, 30 ), array( 14, 50 ), array( 4, 72 ), array( 16, 92 ), array( 44, 98 ), array( 74, 90 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 82, 13 ), array( 60, 5 ), array( 36, 4 ), array( 16, 12 ), array( 6, 28 ), array( 18, 48 ), array( 5, 70 ), array( 18, 90 ), array( 46, 96 ), array( 76, 88 ), array( 100, 100 ) ),
            ),
            'meadow' => array(
                'title' => __( 'Meadow', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 84, 6 ), array( 66, 24 ), array( 50, 26 ), array( 36, 10 ), array( 16, 4 ), array( 4, 22 ), array( 3, 58 ), array( 12, 88 ), array( 34, 98 ), array( 58, 90 ), array( 80, 94 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 86, 8 ), array( 68, 20 ), array( 52, 28 ), array( 38, 12 ), array( 18, 6 ), array( 5, 20 ), array( 4, 55 ), array( 10, 86 ), array( 32, 96 ), array( 56, 92 ), array( 78, 90 ), array( 100, 100 ) ),
            ),
            'lagoon' => array(
                'title' => __( 'Lagoon', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 74, 4 ), array( 48, 8 ), array( 26, 20 ), array( 8, 32 ), array( 3, 60 ), array( 10, 86 ), array( 26, 96 ), array( 44, 78 ), array( 58, 76 ), array( 72, 94 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 76, 6 ), array( 50, 6 ), array( 28, 18 ), array( 9, 29 ), array( 4, 56 ), array( 12, 83 ), array( 29, 95 ), array( 46, 82 ), array( 60, 73 ), array( 74, 92 ), array( 100, 100 ) ),
            ),
            'harbor' => array(
                'title' => __( 'Harbor', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 86, 12 ), array( 74, 6 ), array( 60, 24 ), array( 44, 14 ), array( 28, 6 ), array( 12, 12 ), array( 2, 40 ), array( 4, 72 ), array( 16, 92 ), array( 40, 98 ), array( 70, 92 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 88, 10 ), array( 76, 8 ), array( 62, 20 ), array( 46, 16 ), array( 30, 5 ), array( 13, 10 ), array( 3, 38 ), array( 5, 70 ), array( 18, 90 ), array( 42, 96 ), array( 72, 88 ), array( 100, 100 ) ),
            ),
            'glade'  => array(
                'title' => __( 'Glade', 'framify' ),
                'rest'  => array( array( 100, 0 ), array( 90, 14 ), array( 78, 4 ), array( 66, 6 ), array( 54, 20 ), array( 40, 6 ), array( 26, 3 ), array( 10, 12 ), array( 3, 40 ), array( 6, 76 ), array( 18, 94 ), array( 44, 92 ), array( 72, 98 ), array( 100, 100 ) ),
                'hover' => array( array( 100, 0 ), array( 92, 12 ), array( 80, 6 ), array( 68, 4 ), array( 56, 17 ), array( 42, 4 ), array( 28, 5 ), array( 11, 10 ), array( 4, 36 ), array( 5, 72 ), array( 16, 92 ), array( 42, 95 ), array( 70, 95 ), array( 100, 100 ) ),
            ),
        );
    }

    public function flow_ids() {
        return array_keys( $this->flow_presets() );
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
     * to the bottom-right corner. The envelope sin(pi*s) * (2 - 1.2 sin^2)
     * fades the waves (and inset) out at both ends, pinning them to the
     * corners, and boosts the top and bottom edges (radius 50) over the far
     * side (radius 100) so dips read as deep there too; Z closes with the
     * straight edge.
     */
    private function wavy_anchored( array $wave ) {
        $points = array();
        for ( $i = 0; $i <= self::WAVE_POINTS; $i++ ) {
            $s        = $i / self::WAVE_POINTS;
            $fade     = sin( M_PI * $s );
            $k        = 1 - $fade * ( 2 - 1.2 * $fade * $fade ) * $this->wave_offset( $wave, $s ) / 100;
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
        foreach ( $this->flow_presets() as $id => $preset ) {
            $paths[ $id ] = array(
                'family' => 'flow',
                'rest'   => $this->smooth_path( $preset['rest'], false ),
                'hover'  => $this->smooth_path( $preset['hover'], false ),
            );
        }
        return $paths;
    }

    /**
     * The shape library: assets/shapes/*.svg shipped with the plugin plus the
     * shapes made in the editor (uploads/framify-shapes), see
     * Framify_Shape_Library. id => array( title, svg, thumb, source ).
     */
    public function library_shapes() {
        return Framify_Shape_Library::all();
    }

    /** VISUAL_CHOICE options for the uploaded (library) tab. */
    private function library_options() {
        $options = array();
        foreach ( $this->library_shapes() as $id => $shape ) {
            $options[ $id ] = array( 'title' => $shape['title'], 'image' => $shape['thumb'] );
        }
        return $options;
    }

    /** id => svg text, as sent to the frontend. */
    private function library_svgs() {
        return wp_list_pluck( $this->library_shapes(), 'svg' );
    }

    /**
     * Built-in | Uploaded tab for a Shape picker (a CHOOSE styled as tabs by
     * the editor stylesheet), plus the button that opens the shape studio
     * (upload an SVG / draw freehand / manage saved shapes).
     */
    private function register_shape_tabs( $element, $prefix, $label, $condition ) {
        $cm = 'Elementor\Controls_Manager';
        $element->add_control( $prefix . '_source', $this->live( array(
            'label'       => $label,
            'type'        => $cm::CHOOSE,
            'toggle'      => false,
            'label_block' => true,
            'default'     => 'builtin',
            'options'     => array(
                'builtin' => array( 'title' => esc_html__( 'Built-in', 'framify' ), 'icon' => 'eicon-shape' ),
                'library' => array( 'title' => esc_html__( 'Uploaded', 'framify' ), 'icon' => 'eicon-upload' ),
            ),
            'condition'   => $condition,
            'classes'     => 'framify-shape-tabs',
        ) ) );
        $element->add_control( $prefix . '_studio', array(
            'type'        => $cm::BUTTON,
            'label_block' => true,
            'text'        => esc_html__( 'Draw or upload a shape', 'framify' ),
            'event'       => 'framify:shapeStudio:' . $prefix,
            'condition'   => $condition + array( $prefix . '_source' => 'library' ),
        ) );
    }

    /**
     * Condition for controls that apply to Custom-like shapes (and Wavy /
     * Flow): the picked built-in is in $ids, OR the Uploaded tab is active
     * (an uploaded shape runs through the Custom pipeline). $on is the plain
     * condition map; $extra_terms are more AND terms; $p is the id prefix of
     * the layer (framify_org_ for the shape, framify_org_deco_ for the blob).
     */
    private function shape_condition( array $on, array $ids, array $extra_terms = array(), $p = 'framify_org_' ) {
        $terms = array();
        foreach ( $on as $name => $value ) {
            $terms[] = array( 'name' => $name, 'operator' => '===', 'value' => $value );
        }
        foreach ( $extra_terms as $t ) {
            $terms[] = $t;
        }
        $terms[] = array(
            'relation' => 'or',
            'terms'    => array(
                array( 'name' => $p . 'shape_source', 'operator' => '===', 'value' => 'library' ),
                array( 'name' => $p . 'shape', 'operator' => 'in', 'value' => $ids ),
            ),
        );
        return array( 'conditions' => array( 'relation' => 'and', 'terms' => $terms ) );
    }

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
        if ( $with_custom ) {
            $svg                = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="12" y="24" width="76" height="52" rx="16" fill="none" stroke="#69727d" stroke-width="4" stroke-dasharray="8 6"/></svg>';
            $options['custom'] = array(
                'title' => __( 'Custom', 'framify' ),
                'image' => 'data:image/svg+xml,' . rawurlencode( $svg ),
            );
        }
        return $options;
    }

    /* ------------------------------------------------------------------
       Controls
       All frontend_available (read by the JS handler in the editor preview
       and on the live site) and render_type 'none': the handler re-applies
       itself on each change, so the preview updates without a re-render.
    ------------------------------------------------------------------ */
    public function register_image_controls( $element ) {
        $this->register_controls( $element, false );
    }

    public function register_container_controls( $element ) {
        $this->register_controls( $element, true );
    }

    public function register_spacer_controls( $element ) {
        $this->register_controls( $element, true, true );
    }

    /** Shared control args: live in JS, no element re-render. */
    private function live( array $args ) {
        return $args + array( 'frontend_available' => true, 'render_type' => 'none' );
    }

    private function register_controls( $element, $is_container, $is_spacer = false ) {
        $cm = 'Elementor\Controls_Manager';
        $on = array( 'framify_org_enable' => 'yes' );

        $element->start_controls_section( 'framify_org_section', array(
            'label' => esc_html__( 'Organic Shape', 'framify' ),
            'tab'   => self::TAB,
        ) );

        $element->add_control( 'framify_org_enable', $this->live( array(
            'label'     => esc_html__( 'Organic Shape', 'framify' ),
            'type'      => $cm::SWITCHER,
            'label_on'  => esc_html__( 'On', 'framify' ),
            'label_off' => esc_html__( 'Off', 'framify' ),
            'default'   => '',
        ) ) );

        if ( $is_container ) {
            $element->add_control( 'framify_org_mode', $this->live( array(
                'label'     => esc_html__( 'Mode', 'framify' ),
                'type'      => $cm::SELECT,
                'default'   => 'deco',
                'options'   => array(
                    'deco' => esc_html__( 'Deco blob behind content', 'framify' ),
                    'clip' => esc_html__( 'Clip whole container', 'framify' ),
                    'bg'   => esc_html__( 'Clip background only', 'framify' ),
                ),
                'condition' => $on,
            ) ) );

            // Clip background only: a plain colour for the clipped area (so
            // a shape works with no image) and an overlay on top of the
            // background. CSS only (ids outside the framify_org_ prefix, so
            // the script never rebuilds for them); Global Colours work
            // because Elementor resolves them into the CSS. The colour is
            // !important because the script copies the host's computed
            // background onto the fill as inline longhands.
            $bg = $on + array( 'framify_org_mode' => 'bg' );
            $fill = '{{WRAPPER}} > .framify-organic__fill';
            $fill_spacer = '{{WRAPPER}} > .elementor-widget-container > .framify-organic__fill';
            $element->add_control( 'framify_orgbg_color', array(
                'label'     => esc_html__( 'Background color', 'framify' ),
                'type'      => $cm::COLOR,
                'selectors' => array(
                    $fill        => 'background-color: {{VALUE}} !important;',
                    $fill_spacer => 'background-color: {{VALUE}} !important;',
                ),
                'render_type' => 'ui',
                'condition' => $bg,
            ) );
            $element->add_control( 'framify_orgbg_overlay', array(
                'label'     => esc_html__( 'Overlay color', 'framify' ),
                'type'      => $cm::COLOR,
                'selectors' => array( '{{WRAPPER}}' => '--framify-bg-overlay: {{VALUE}};' ),
                'render_type' => 'ui',
                'description' => esc_html__( 'Tints the clipped area, over the background and under the grain.', 'framify' ),
                'condition' => $bg,
            ) );
            $element->add_control( 'framify_orgbg_overlay_opacity', array(
                'label'      => esc_html__( 'Overlay opacity', 'framify' ),
                'type'       => $cm::SLIDER,
                'size_units' => array( 'px' ),
                'range'      => array( 'px' => array( 'min' => 0, 'max' => 1, 'step' => 0.05 ) ),
                'default'    => array( 'unit' => 'px', 'size' => 1 ),
                'selectors'  => array( '{{WRAPPER}}' => '--framify-bg-overlay-o: {{SIZE}};' ),
                'render_type' => 'ui',
                'condition'  => $bg,
            ) );
        }

        $this->register_shape_group( $element, 'framify_org_', $on, array(
            'tabs_label'  => esc_html__( 'Shape', 'framify' ),
            'default'     => self::DEFAULT_SHAPE,
            'lib_note'    => esc_html__( 'Shapes in the plugin folder assets/shapes. Add an .svg there and it shows up here on every site the plugin is installed on.', 'framify' ),
        ) );

        $element->add_control( 'framify_org_placement_heading', array(
            'label'     => esc_html__( 'Placement', 'framify' ),
            'type'      => $cm::HEADING,
            'separator' => 'before',
            'condition' => $on,
        ) );

        $this->register_placement_controls( $element, '', array( 'w' => 100, 'h' => 100, 'ox' => 0, 'oy' => 0 ), $on );

        $element->add_control( 'framify_org_motion_heading', array(
            'label'     => esc_html__( 'Motion', 'framify' ),
            'type'      => $cm::HEADING,
            'separator' => 'before',
            'condition' => $on,
        ) );

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

        // Custom shapes only move when a real trigger is chosen (Auto keeps
        // them static), so these only appear then.
        $this->register_custom_motion_group( $element, 'framify_org_', $on, array( 'name' => 'framify_org_trigger', 'operator' => '!in', 'value' => array( 'auto', 'none' ) ) );

        $this->register_anim_controls( $element, 'framify_org_', $on );

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

        if ( $is_container ) {
            // Behind content mode: the shape IS a blob, dressed by the Deco
            // Blob section's look controls. With the Deco Blob switched on
            // that look styles the extra blob instead, so the shape can
            // either keep sharing it (the default: nothing changes) or get
            // its own.
            $shape_look = $on + array( 'framify_org_mode' => 'deco', 'framify_org_deco' => 'yes' );
            $own_look   = $shape_look + array( 'framify_org_look' => 'own' );
            $element->add_control( 'framify_org_look_heading', array(
                'label'     => esc_html__( 'Shape look', 'framify' ),
                'type'      => $cm::HEADING,
                'separator' => 'before',
                'condition' => $shape_look,
            ) );
            $element->add_control( 'framify_org_look', $this->live( array(
                'label'       => esc_html__( 'Shape look', 'framify' ),
                'type'        => $cm::SELECT,
                'default'     => 'deco',
                'options'     => array(
                    'deco' => esc_html__( 'Same as Deco Blob', 'framify' ),
                    'own'  => esc_html__( 'Own', 'framify' ),
                ),
                'description' => esc_html__( 'The Deco Blob below is an extra blob. Same as Deco Blob gives the shape its look; Own lets the shape have a different one.', 'framify' ),
                'condition'   => $shape_look,
            ) ) );
            $element->add_control( 'framify_org_look_style', $this->live( array(
                'label'     => esc_html__( 'Style', 'framify' ),
                'type'      => $cm::SELECT,
                'default'   => 'solid',
                'options'   => array(
                    'solid'   => esc_html__( 'Solid', 'framify' ),
                    'outline' => esc_html__( 'Outline', 'framify' ),
                ),
                'condition' => $own_look,
            ) ) );
            $element->add_control( 'framify_org_look_outline_color', $this->live( array(
                'label'     => esc_html__( 'Outline color', 'framify' ),
                'type'      => $cm::COLOR,
                'default'   => '#1E1E1E',
                'condition' => $own_look + array( 'framify_org_look_style' => 'outline' ),
            ) ) );
            $element->add_control( 'framify_org_look_outline_width', $this->live( array(
                'label'      => esc_html__( 'Outline width (px)', 'framify' ),
                'type'       => $cm::SLIDER,
                'size_units' => array( 'px' ),
                'range'      => array( 'px' => array( 'min' => 1, 'max' => 10, 'step' => 0.5 ) ),
                'default'    => array( 'unit' => 'px', 'size' => 2 ),
                'condition'  => $own_look + array( 'framify_org_look_style' => 'outline' ),
            ) ) );
            $element->add_control( 'framify_org_look_color', $this->live( array(
                'label'     => esc_html__( 'Color', 'framify' ),
                'type'      => $cm::COLOR,
                'default'   => '#F2C53D',
                'condition' => $own_look + array( 'framify_org_look_style!' => 'outline' ),
            ) ) );
        }

        $element->end_controls_section();

        // Image widget: an extra blob with its own shape, placement and
        // motion. Spacer and Containers: the same extra blob in Clip mode,
        // plus the look of the shape itself in Behind content mode (where
        // the deco IS the shape), in one section (see register_deco_controls).
        $element->start_controls_section( 'framify_deco_section', array(
            'label' => esc_html__( 'Deco Blob', 'framify' ),
            'tab'   => self::TAB,
        ) );
        $this->register_deco_controls( $element, $is_container );
        $element->end_controls_section();

        $this->register_grain_controls( $element, $is_container, $is_spacer );
    }

    /**
     * The shape controls of one layer, ids {$p}shape_source, _studio, shape,
     * shape_lib, edge, flip_h, flip_v, custom_rotate, custom_svg. $p is
     * framify_org_ for the Organic Shape and framify_org_deco_ for the Deco
     * Blob, so the two sections cannot drift apart. $on is the plain
     * condition map every control carries (empty for the Deco Blob, whose
     * controls are always visible).
     */
    private function register_shape_group( $element, $p, array $on, array $o ) {
        $cm   = 'Elementor\Controls_Manager';
        $cond = function ( array $terms ) {
            return $terms ? array( 'condition' => $terms ) : array();
        };

        $this->register_shape_tabs( $element, $p . 'shape', $o['tabs_label'], $on );
        $shape_on = $on + array( $p . 'shape_source!' => 'library' );
        $element->add_control( $p . 'shape', $this->live( array(
            'label'       => esc_html__( 'Built-in shapes', 'framify' ),
            'type'        => $cm::VISUAL_CHOICE,
            'label_block' => true,
            'columns'     => 4,
            'options'     => $this->shape_options( true ),
            'default'     => $o['default'],
        ) + $cond( $shape_on ) ) );

        $lib_ids = array_keys( $this->library_shapes() );
        $lib     = array(
            'label'       => esc_html__( 'Uploaded shapes', 'framify' ),
            'type'        => $cm::VISUAL_CHOICE,
            'label_block' => true,
            'columns'     => 4,
            'options'     => $this->library_options(),
            'default'     => $lib_ids ? $lib_ids[0] : '',
        );
        if ( ! empty( $o['lib_note'] ) ) {
            $lib['description'] = $o['lib_note'];
        }
        $element->add_control( $p . 'shape_lib', $this->live( $lib + $cond( $on + array( $p . 'shape_source' => 'library' ) ) ) );

        $element->add_control( $p . 'edge', $this->live( array(
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
            'description' => esc_html__( 'The straight side of a Wavy or Flow shape, flush with the element edge so it can run off the page. Flow shapes always keep one straight side. For Custom, Framify detects which side of your SVG is straight: Auto and None keep your SVG as pasted; Left/Right/Top/Bottom turn its straight side there (a paste with no straight side ignores this setting).', 'framify' ),
        ) + $this->shape_condition( $on, array_merge( $this->wavy_ids(), $this->flow_ids(), array( 'custom' ) ), array(), $p ) ) );

        // Applied last inside the shape box (after the Flat edge turn), so
        // they mirror whatever the shape and edge settings produced.
        $element->add_control( $p . 'flip_h', $this->live( array(
            'label'     => esc_html__( 'Flip horizontal', 'framify' ),
            'type'      => $cm::SWITCHER,
            'label_on'  => esc_html__( 'Yes', 'framify' ),
            'label_off' => esc_html__( 'No', 'framify' ),
            'default'   => '',
        ) + $cond( $on ) ) );

        $element->add_control( $p . 'flip_v', $this->live( array(
            'label'     => esc_html__( 'Flip vertical', 'framify' ),
            'type'      => $cm::SWITCHER,
            'label_on'  => esc_html__( 'Yes', 'framify' ),
            'label_off' => esc_html__( 'No', 'framify' ),
            'default'   => '',
        ) + $cond( $on ) ) );

        // The original Rotate: it turns the artwork inside its box in 90
        // degree steps, so it always fills the box (Custom and uploaded
        // shapes). Kept as it was so saved values mean what they did.
        $element->add_control( $p . 'custom_rotate', $this->live( array(
            'label'       => esc_html__( 'Quarter turn (fits the box)', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => '0',
            'options'     => array(
                '0'   => esc_html__( '0 deg', 'framify' ),
                '90'  => esc_html__( '90 deg', 'framify' ),
                '180' => esc_html__( '180 deg', 'framify' ),
                '270' => esc_html__( '270 deg', 'framify' ),
            ),
            'description' => esc_html__( 'Turns a Custom or uploaded shape inside its box in 90 degree steps, always filling the box. For any other angle, and for blobs, Wavy and Flow shapes, use Angle.', 'framify' ),
        ) + $this->shape_condition( $on, array( 'custom' ), array(), $p ) ) );

        // Any angle, every shape. A true rotation about the shape's centre
        // that never stretches or skews, whatever the element's proportions.
        $element->add_control( $p . 'angle', $this->live( array(
            'label'       => esc_html__( 'Angle (deg)', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 'deg' ),
            'range'       => array( 'deg' => array( 'min' => 0, 'max' => 360, 'step' => 1 ) ),
            'default'     => array( 'unit' => 'deg', 'size' => 0 ),
            'description' => esc_html__( 'Turns the whole shape around its centre, for any shape. With a flat edge the straight side turns with the shape, so it no longer sits flush with the element edge. A turned shape can reach past the element and be cropped: lower Width / Height in Placement, or switch on Keep inside the box.', 'framify' ),
        ) + $cond( $on ) ) );

        $element->add_control( $p . 'angle_fit', $this->live( array(
            'label'       => esc_html__( 'Keep inside the box', 'framify' ),
            'type'        => $cm::SWITCHER,
            'label_on'    => esc_html__( 'Yes', 'framify' ),
            'label_off'   => esc_html__( 'No', 'framify' ),
            'default'     => '',
            'description' => esc_html__( 'Shrinks a turned shape just enough that no part of it leaves its box.', 'framify' ),
        ) + $cond( $on ) ) );

        // Parsed in the browser: only validated path data is used, and only
        // ever through setAttribute('d'), so pasted markup can't inject.
        $element->add_control( $p . 'custom_svg', $this->live( array(
            'label'       => esc_html__( 'SVG code or path', 'framify' ),
            'type'        => $cm::TEXTAREA,
            'rows'        => 6,
            'placeholder' => '<svg viewBox="0 0 1200 800"><path d="..."/></svg>',
            'description' => esc_html__( 'Paste an SVG from any design tool, or just its path data. Every path in it is merged into one shape (including any inside defs or masks); transforms inside the SVG are ignored.', 'framify' ),
            'ai'          => array( 'active' => false ),
            'condition'   => $on + array( $p . 'shape' => 'custom', $p . 'shape_source!' => 'library' ),
        ) ) );
    }

    /**
     * Custom motion, Dots style and Motion amount of one layer (ids
     * {$p}custom_motion, {$p}dot_style, {$p}custom_amount). They only show
     * for Custom-like shapes with a trigger that moves; $moving is that
     * trigger term (a plain term or an OR group). The Deco Blob gets an
     * extra first option, Static, and defaults to it, so a saved uploaded
     * blob that never moved stays still when its trigger is Same as shape.
     */
    private function register_custom_motion_group( $element, $p, array $on, array $moving, $deco = false ) {
        $cm            = 'Elementor\Controls_Manager';
        $custom_moving = $this->shape_condition( $on, array( 'custom' ), array( $moving ), $p );
        $options       = array(
            'liquid' => esc_html__( 'Liquid (traced, rippling edge)', 'framify' ),
            'gentle' => esc_html__( 'Gentle (exact shape, tilt and swell)', 'framify' ),
            'dots'   => esc_html__( 'Dots (particle patterns: breathe, twinkle, wave, drift)', 'framify' ),
        );
        if ( $deco ) {
            $options = array( 'static' => esc_html__( 'Static (no custom motion)', 'framify' ) ) + $options;
        }

        $element->add_control( $p . 'custom_motion', $this->live( array(
            'label'       => esc_html__( 'Custom motion', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => $deco ? 'static' : 'liquid',
            'options'     => $options,
            'description' => esc_html__( 'Liquid traces your shape and ripples its edge, softening sharp corners. Gentle keeps it exact and moves it as a whole; use it for logos and icons. Dots animates each circle of a pattern made in the Shape studio Generate tab and lets you pick its style. Liquid switches to Dots (Breathe) on a Dispersion pattern or a dot pattern with more than 24 dots.', 'framify' ),
        ) + $custom_moving ) );

        // Only offered with Dots chosen explicitly. Elementor leaves hidden
        // controls out of a published page, so when Liquid hands a big dot
        // pattern to Dots the style is always Breathe (the script ignores
        // this value unless Dots was chosen, so the editor shows the same).
        $element->add_control( $p . 'dot_style', $this->live( array(
            'label'   => esc_html__( 'Dots style', 'framify' ),
            'type'    => $cm::SELECT,
            'default' => 'breathe',
            'options' => array(
                'breathe' => esc_html__( 'Breathe (all dots swell together)', 'framify' ),
                'twinkle' => esc_html__( 'Twinkle (each dot its own size)', 'framify' ),
                'wave'    => esc_html__( 'Wave (a sweep across the pattern)', 'framify' ),
                'drift'   => esc_html__( 'Drift (particles move away from the mass)', 'framify' ),
            ),
        ) + $this->shape_condition(
            $on,
            array( 'custom' ),
            array( $moving, array( 'name' => $p . 'custom_motion', 'operator' => '===', 'value' => 'dots' ) ),
            $p
        ) ) );

        $element->add_control( $p . 'custom_amount', $this->live( array(
            'label'     => esc_html__( 'Motion amount', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'normal',
            'options'   => array(
                'subtle' => esc_html__( 'Subtle', 'framify' ),
                'normal' => esc_html__( 'Normal', 'framify' ),
                'strong' => esc_html__( 'Strong', 'framify' ),
            ),
        ) + $custom_moving ) );
    }

    /**
     * Shape animation, for the Organic Shape (prefix framify_org_) and the
     * Deco Blob (framify_org_deco_): a motion that replaces Custom motion.
     * Spin / Sway / Pulse / Jelly / Float / Drift move the shape as a whole
     * (the pose); Morph turns it into another built-in shape. They run on the
     * layer's own trigger (Auto means on hover for an animation).
     */
    private function register_anim_controls( $element, $p, array $on ) {
        $cm      = 'Elementor\Controls_Manager';
        $targets = array();
        foreach ( $this->shape_options() as $id => $opt ) {
            $targets[ $id ] = $opt['title'];
        }
        $poses = array( 'spin', 'sway', 'pulse', 'jelly', 'float', 'drift' );

        $element->add_control( $p . 'anim', $this->live( array(
            'label'       => esc_html__( 'Shape animation', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => 'none',
            'options'     => array(
                'none'  => esc_html__( 'None', 'framify' ),
                'spin'  => esc_html__( 'Spin', 'framify' ),
                'sway'  => esc_html__( 'Sway', 'framify' ),
                'pulse' => esc_html__( 'Pulse', 'framify' ),
                'jelly' => esc_html__( 'Jelly', 'framify' ),
                'float' => esc_html__( 'Float', 'framify' ),
                'drift' => esc_html__( 'Drift', 'framify' ),
                'morph' => esc_html__( 'Morph into another shape', 'framify' ),
            ),
            'description' => esc_html__( 'Replaces Custom motion and the blob hover morph. It runs on the trigger above (Auto = on hover); Morph needs a built-in shape.', 'framify' ),
        ) + ( $on ? array( 'condition' => $on ) : array() ) ) );

        $element->add_control( $p . 'anim_to', $this->live( array(
            'label'     => esc_html__( 'Morph into', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'pebble',
            'options'   => $targets,
            'condition' => $on + array( $p . 'anim' => 'morph' ),
        ) ) );

        $element->add_control( $p . 'anim_amount', $this->live( array(
            'label'      => esc_html__( 'Animation amount', 'framify' ),
            'type'       => $cm::SLIDER,
            'size_units' => array( 'px' ),
            'range'      => array( 'px' => array( 'min' => 0, 'max' => 100, 'step' => 1 ) ),
            'default'    => array( 'unit' => 'px', 'size' => 50 ),
            'condition'  => $on + array( $p . 'anim' => $poses ),
        ) ) );
    }

    /**
     * Grain: its own section, so texture is set in one place for whatever
     * is filled (the deco blob, the photo, or a container's clip fill). The
     * container switch ids are unchanged from when they lived in the Organic
     * Shape section, so saved values carry over; the Image widget picks a
     * target instead (framify_org_grain_target).
     */
    private function register_grain_controls( $element, $is_container, $is_spacer = false ) {
        $cm = 'Elementor\Controls_Manager';
        $on = array( 'framify_org_enable' => 'yes' );

        // Grain texture applies to whatever is drawn, so it shows when the
        // Organic Shape or the Deco Blob is on (the blob can be used alone).
        $any_on = array(
            'relation' => 'or',
            'terms'    => array(
                array( 'name' => 'framify_org_enable', 'operator' => '===', 'value' => 'yes' ),
                array( 'name' => 'framify_org_deco', 'operator' => '===', 'value' => 'yes' ),
            ),
        );
        $element->start_controls_section( 'framify_grain_section', array(
            'label'      => esc_html__( 'Grain', 'framify' ),
            'tab'        => self::TAB,
            'conditions' => $any_on,
        ) );

        if ( ! $is_container ) {
            // Image widget: grain can go on the deco blob, the photo, or both.
            // The deco part only shows on a Solid deco that is switched on.
            $element->add_control( 'framify_org_grain_target', $this->live( array(
                'label'   => esc_html__( 'Grain on', 'framify' ),
                'type'    => $cm::SELECT,
                'default' => 'deco',
                'options' => array(
                    'deco'  => esc_html__( 'Deco blob', 'framify' ),
                    'image' => esc_html__( 'Image', 'framify' ),
                    'both'  => esc_html__( 'Deco blob and image', 'framify' ),
                    'none'  => esc_html__( 'None', 'framify' ),
                ),
            ) ) );
        } else {
            // Spacer and Containers: the blob's grain switch lives in the
            // Deco Blob section; here the clip fill's, rather than the Image
            // widget's target select. Ids and defaults are unchanged, so
            // saved values carry over.
            // Off by default: speckle over a container's background photo is
            // rarely wanted.
            $element->add_control( 'framify_org_clip_grain', $this->live( array(
                'label'       => $is_spacer ? esc_html__( 'Grain on shape fill', 'framify' ) : esc_html__( 'Grain on container fill', 'framify' ),
                'type'        => $cm::SWITCHER,
                'default'     => '',
                'description' => $is_spacer ? esc_html__( 'Chalky speckle over the Spacer background, clipped with it.', 'framify' ) : esc_html__( 'Chalky speckle over the container background, under its content.', 'framify' ),
                'condition'   => $on + array( 'framify_org_mode' => array( 'clip', 'bg' ) ),
            ) ) );
        }

        $element->add_control( 'framify_org_grain_texture', $this->live( array(
            'label'       => esc_html__( 'Texture', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => 'speckle',
            'options'     => array(
                'speckle'  => esc_html__( 'Speckle (classic)', 'framify' ),
                'chalk'    => esc_html__( 'Distressed chalk', 'framify' ),
                'brush'    => esc_html__( 'Dry brush', 'framify' ),
                'fibre'    => esc_html__( 'Paper fibre', 'framify' ),
                'film'     => esc_html__( 'Film grain', 'framify' ),
                'halftone' => esc_html__( 'Halftone dots', 'framify' ),
            ),
            'description' => esc_html__( 'Distressed chalk is the worn, powdery print look.', 'framify' ),
        ) ) );

        $element->add_control( 'framify_org_grain_color', $this->live( array(
            'label'   => esc_html__( 'Grain colour', 'framify' ),
            'type'    => $cm::COLOR,
            'default' => '#FFFFFF',
            'global'  => array( 'active' => false ),
        ) ) );

        $element->add_control( 'framify_org_grain_amount', $this->live( array(
            'label'       => esc_html__( 'Grain amount', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 'px' ),
            'range'       => array( 'px' => array( 'min' => 0, 'max' => 100, 'step' => 1 ) ),
            'default'     => array( 'unit' => 'px', 'size' => 50 ),
            'description' => esc_html__( 'Applies wherever grain is on.', 'framify' ),
        ) ) );

        $element->add_control( 'framify_org_grain_size', $this->live( array(
            'label'       => esc_html__( 'Grain size', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 'px' ),
            'range'       => array( 'px' => array( 'min' => 1, 'max' => 100, 'step' => 1 ) ),
            'default'     => array( 'unit' => 'px', 'size' => 50 ),
            'description' => esc_html__( 'Higher = coarser patches, lower = finer.', 'framify' ),
        ) ) );

        $element->add_control( 'framify_org_grain_pattern', $this->live( array(
            'label'       => esc_html__( 'Pattern', 'framify' ),
            'type'        => $cm::NUMBER,
            'min'         => 0,
            'max'         => 999,
            'step'        => 1,
            'default'     => 0,
            'description' => esc_html__( '0 gives every element its own random speckle. Any other number fixes the pattern.', 'framify' ),
        ) ) );

        $element->end_controls_section();
    }

    /**
     * The Deco Blob section: an extra blob with its own shape, look,
     * placement and motion, for every mode and element. Every control is
     * visible whenever the section is (no Mode or switch conditions): the
     * "Deco blob behind" switch only decides whether the blob is drawn, so
     * it can be set up before it is turned on. It is also drawn when Organic
     * Shape itself is off, so nothing here depends on that switch.
     *
     * Containers and the Spacer also use the look controls (style, colours,
     * outline, grain) for the Organic Shape itself in Behind content mode,
     * where the shape IS a blob, until the switch is on and Shape look is
     * set to Own (see register_controls).
     */
    private function register_deco_controls( $element, $is_container ) {
        $cm = 'Elementor\Controls_Manager';
        $p  = 'framify_org_deco_';

        $element->add_control( 'framify_org_deco', $this->live( array(
            'label'       => esc_html__( 'Deco blob behind', 'framify' ),
            'type'        => $cm::SWITCHER,
            'default'     => '',
            'description' => esc_html__( 'Draws an extra blob with the settings below, behind the content, in every mode. Off: nothing is drawn yet, but your settings are kept.', 'framify' ),
        ) ) );

        $element->add_control( 'framify_org_deco_layer', $this->live( array(
            'label'       => esc_html__( 'Blob position', 'framify' ),
            'type'        => $cm::CHOOSE,
            'default'     => 'behind',
            'toggle'      => false,
            'options'     => array(
                'behind' => array( 'title' => esc_html__( 'Behind the shape', 'framify' ), 'icon' => 'eicon-arrow-down' ),
                'above'  => array( 'title' => esc_html__( 'Above the shape', 'framify' ), 'icon' => 'eicon-arrow-up' ),
            ),
            'description' => esc_html__( 'Above the shape puts the blob over the shape or photo, still under the content.', 'framify' ),
        ) ) );

        if ( $is_container ) {
            $element->add_control( 'framify_org_deco_note_shared', array(
                'type'            => $cm::RAW_HTML,
                'raw'             => esc_html__( 'In Behind content mode the Style, Color, Outline and Grain below also dress the Organic Shape itself, until the switch above is on and Shape look (in Organic Shape) is set to Own.', 'framify' ),
                'content_classes' => 'elementor-descriptor',
                'condition'       => array( 'framify_org_enable' => 'yes', 'framify_org_mode' => 'deco' ),
            ) );
        }

        $this->register_shape_group( $element, $p, array(), array(
            'tabs_label' => esc_html__( 'Deco shape', 'framify' ),
            'default'    => 'splash',
        ) );

        $element->add_control( 'framify_org_deco_style', $this->live( array(
            'label'     => esc_html__( 'Style', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'solid',
            'options'   => array(
                'solid'   => esc_html__( 'Solid', 'framify' ),
                'outline' => esc_html__( 'Outline', 'framify' ),
            ),
            'separator' => 'before',
        ) ) );

        $outline_on = array( 'framify_org_deco_style' => 'outline' );

        // Both deco colours accept Global Colours: a linked value lives only
        // in __globals__, so assets/framify-colors.js puts it back into the
        // settings the script reads.
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

        $element->add_control( 'framify_org_deco_color', $this->live( array(
            'label'     => esc_html__( 'Color', 'framify' ),
            'type'      => $cm::COLOR,
            'default'   => '#F2C53D',
            'condition' => array( 'framify_org_deco_style!' => 'outline' ),
        ) ) );

        // The blob's own background and overlay, mirroring the Organic
        // Shape's (framify_orgbg_*): CSS only, so ids outside the
        // framify_org_ prefix (the script never rebuilds for them) and
        // Global Colours work because Elementor resolves them into the CSS.
        // On an Outline blob the background fills the inside of the outline.
        $blob       = '{{WRAPPER}} > .framify-organic__deco--extra';
        $blob_inner = '{{WRAPPER}} > .elementor-widget-container > .framify-organic__deco--extra';
        $element->add_control( 'framify_decobg_color', array(
            'label'       => esc_html__( 'Background color', 'framify' ),
            'type'        => $cm::COLOR,
            'selectors'   => array(
                $blob . ' > path:not(.framify-organic__overlay)'       => 'fill: {{VALUE}} !important;',
                $blob_inner . ' > path:not(.framify-organic__overlay)' => 'fill: {{VALUE}} !important;',
            ),
            'render_type' => 'ui',
            'description' => esc_html__( 'Overrides Color. On an Outline blob it fills the inside of the outline.', 'framify' ),
        ) );
        $element->add_control( 'framify_decobg_overlay', array(
            'label'       => esc_html__( 'Overlay color', 'framify' ),
            'type'        => $cm::COLOR,
            'selectors'   => array(
                $blob       => '--framify-deco-overlay: {{VALUE}};',
                $blob_inner => '--framify-deco-overlay: {{VALUE}};',
            ),
            'render_type' => 'ui',
            'description' => esc_html__( 'Tints a Solid blob, over its color and under the grain.', 'framify' ),
            'condition'   => array( 'framify_org_deco_style!' => 'outline' ),
        ) );
        $element->add_control( 'framify_decobg_overlay_opacity', array(
            'label'       => esc_html__( 'Overlay opacity', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 'px' ),
            'range'       => array( 'px' => array( 'min' => 0, 'max' => 1, 'step' => 0.05 ) ),
            'default'     => array( 'unit' => 'px', 'size' => 1 ),
            'selectors'   => array(
                $blob       => '--framify-deco-overlay-o: {{SIZE}};',
                $blob_inner => '--framify-deco-overlay-o: {{SIZE}};',
            ),
            'render_type' => 'ui',
            'condition'   => array( 'framify_org_deco_style!' => 'outline' ),
        ) );

        if ( $is_container ) {
            // Spacer and Containers: one switch for the blob's grain (the id
            // and default are unchanged from when it lived in the Grain
            // section). Grain on a thin outline is invisible, so it is only
            // offered for Solid.
            $element->add_control( 'framify_org_deco_grain', $this->live( array(
                'label'     => esc_html__( 'Grain on deco blob', 'framify' ),
                'type'      => $cm::SWITCHER,
                'default'   => 'yes',
                'condition' => array( 'framify_org_deco_style!' => 'outline' ),
            ) ) );
        }

        $element->add_control( 'framify_org_deco_placement_heading', array(
            'label'     => esc_html__( 'Placement', 'framify' ),
            'type'      => $cm::HEADING,
            'separator' => 'before',
        ) );
        $this->register_placement_controls( $element, 'deco_', array( 'w' => 108, 'h' => 108, 'ox' => 6, 'oy' => 6 ), array() );

        $this->register_deco_motion_controls( $element, $is_container );
    }

    /**
     * Deco motion: its own trigger, timing, a turn and Custom motion, so the
     * deco blob can move differently from the image (or the shape). Same as
     * image / shape (the default) follows the main shape's motion; with
     * Organic Shape off there is none to follow, so the blob stays still.
     */
    private function register_deco_motion_controls( $element, $shape_wording ) {
        $cm = 'Elementor\Controls_Manager';

        $element->add_control( 'framify_org_deco_motion_heading', array(
            'label'     => esc_html__( 'Deco motion', 'framify' ),
            'type'      => $cm::HEADING,
            'separator' => 'before',
        ) );

        $element->add_control( 'framify_org_deco_trigger', $this->live( array(
            'label'   => esc_html__( 'Deco trigger', 'framify' ),
            'type'    => $cm::SELECT,
            'default' => 'same',
            'options' => array(
                'same'   => $shape_wording ? esc_html__( 'Same as shape', 'framify' ) : esc_html__( 'Same as image', 'framify' ),
                'none'   => esc_html__( 'None (static)', 'framify' ),
                'hover'  => esc_html__( 'On hover', 'framify' ),
                'inview' => esc_html__( 'Once, when scrolled into view', 'framify' ),
                'loop'   => esc_html__( 'Continuous gentle loop', 'framify' ),
            ),
        ) ) );

        $element->add_control( 'framify_org_deco_duration', $this->live( array(
            'label'      => esc_html__( 'Deco duration (ms)', 'framify' ),
            'type'       => $cm::SLIDER,
            'size_units' => array( 'px' ),
            'range'      => array( 'px' => array( 'min' => 400, 'max' => 5000, 'step' => 100 ) ),
            'default'    => array( 'unit' => 'px', 'size' => 2400 ),
            'condition'  => array( 'framify_org_deco_trigger!' => array( 'same', 'none' ) ),
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
            'condition' => array( 'framify_org_deco_trigger!' => array( 'same', 'none', 'loop' ) ),
        ) ) );

        $element->add_control( 'framify_org_deco_rotate', $this->live( array(
            'label'       => esc_html__( 'Turn while moving (deg)', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 'px' ),
            'range'       => array( 'px' => array( 'min' => 0, 'max' => 45, 'step' => 1 ) ),
            'default'     => array( 'unit' => 'px', 'size' => 0 ),
            'description' => $shape_wording ? esc_html__( 'Turns the deco blob as it moves, so it reads differently from the shape. For a fixed angle use Angle above.', 'framify' ) : esc_html__( 'Turns the deco blob as it moves, so it reads differently from the image. For a fixed angle use Angle above.', 'framify' ),
            'condition'   => array( 'framify_org_deco_trigger!' => 'none' ),
        ) ) );

        // Custom motion moves only when a trigger does: the blob's own, or
        // the main shape's when the blob follows it (Organic Shape on).
        $this->register_custom_motion_group( $element, 'framify_org_deco_', array(), array(
            'relation' => 'or',
            'terms'    => array(
                array( 'name' => 'framify_org_deco_trigger', 'operator' => 'in', 'value' => array( 'hover', 'inview', 'loop' ) ),
                array(
                    'relation' => 'and',
                    'terms'    => array(
                        array( 'name' => 'framify_org_deco_trigger', 'operator' => '===', 'value' => 'same' ),
                        array( 'name' => 'framify_org_enable', 'operator' => '===', 'value' => 'yes' ),
                        array( 'name' => 'framify_org_trigger', 'operator' => '!in', 'value' => array( 'auto', 'none' ) ),
                    ),
                ),
            ),
        ), true );

        $this->register_anim_controls( $element, 'framify_org_deco_', array() );
    }

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

        $condition = $condition ? array( 'condition' => $condition ) : array();

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
        ) + $condition );

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
        ) + $condition );

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
            ) + $condition );
        }
    }

    /**
     * Float: a gentle bob for any widget, all CSS (see framify-elementor.css).
     * Controls write custom properties and a prefix class, so the editor
     * preview updates without re-rendering and no script is involved.
     * Containers get the same controls; the CSS only animates a nested one
     * (.e-child), and the panel note says so for when the editor script
     * cannot hide the section on a top-level container.
     */
    public function register_float_controls( $element ) {
        $cm = 'Elementor\Controls_Manager';
        $on = array( 'framify_float' => 'yes' );

        $element->start_controls_section( 'framify_float_section', array(
            'label' => esc_html__( 'Float', 'framify' ),
            'tab'   => self::TAB,
        ) );

        $switch = array(
            'label'        => esc_html__( 'Float', 'framify' ),
            'type'         => $cm::SWITCHER,
            'label_on'     => esc_html__( 'On', 'framify' ),
            'label_off'    => esc_html__( 'Off', 'framify' ),
            'default'      => '',
            'prefix_class' => 'framify-float-',
            'render_type'  => 'ui',
        );
        if ( 'container' === $element->get_name() ) {
            $switch['description'] = esc_html__( 'Float works on containers placed inside another container. It replaces an Entrance Animation on the same container.', 'framify' );
        }
        $element->add_control( 'framify_float', $switch );

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

    /* ------------------------------------------------------------------
       Assets. The frontend bundle also runs inside the editor's preview
       iframe, which is what makes the preview live.

       Versioned by filemtime() rather than FRAMIFY_VERSION on purpose: these
       files load on the public site behind page caches and CDNs, where a
       forgotten version bump would serve a stale copy for days. filemtime()
       changes the URL on every edit, with nothing to remember.
    ------------------------------------------------------------------ */
    private function asset_version( $file ) {
        $path = FRAMIFY_PLUGIN_DIR . 'assets/' . $file;
        return file_exists( $path ) ? (string) filemtime( $path ) : FRAMIFY_VERSION;
    }

    // Loaded on every Elementor page: the assets are a few KB, and detecting
    // usage would mean walking each page's full element tree.
    public function enqueue_frontend_assets() {
        wp_enqueue_style(
            'framify-elementor',
            FRAMIFY_PLUGIN_URL . 'assets/framify-elementor.css',
            array(),
            $this->asset_version( 'framify-elementor.css' )
        );
        self::enqueue_colors_script();
        wp_enqueue_script(
            'framify-elementor',
            FRAMIFY_PLUGIN_URL . 'assets/framify-elementor.js',
            array( 'elementor-frontend', 'framify-colors' ),
            $this->asset_version( 'framify-elementor.js' ),
            true
        );
        wp_add_inline_script(
            'framify-elementor',
            'window.framifyOrganic = ' . wp_json_encode( array(
                'shapes'       => $this->shape_paths(),
                'defaultShape' => self::DEFAULT_SHAPE,
                'library'      => (object) $this->library_svgs(),
            ) ) . ';',
            'before'
        );
    }

    /**
     * The Global Colour resolver every Framify Elementor script depends on.
     * Safe to call from each module's enqueue; WordPress de-duplicates.
     */
    public static function enqueue_colors_script() {
        wp_enqueue_script(
            'framify-colors',
            FRAMIFY_PLUGIN_URL . 'assets/framify-colors.js',
            array( 'elementor-frontend' ),
            file_exists( FRAMIFY_PLUGIN_DIR . 'assets/framify-colors.js' ) ? (string) filemtime( FRAMIFY_PLUGIN_DIR . 'assets/framify-colors.js' ) : FRAMIFY_VERSION,
            true
        );
    }

    /**
     * Published pages: the Global Colour a Framify colour control is linked
     * to lives only in __globals__, which never reaches data-settings. Hand
     * the control -> global id map to the script (framify-colors.js).
     */
    public function globals_attribute( $element ) {
        $globals = $element->get_settings( '__globals__' );
        if ( empty( $globals ) || ! is_array( $globals ) ) {
            return;
        }
        $map = array();
        foreach ( $globals as $key => $ref ) {
            if ( 0 === strpos( (string) $key, 'framify_' ) && is_string( $ref ) && preg_match( '/[?&]id=([\w-]+)/', $ref, $m ) ) {
                $map[ $key ] = $m[1];
            }
        }
        if ( $map ) {
            $element->add_render_attribute( '_wrapper', 'data-framify-globals', wp_json_encode( $map ) );
        }
    }

    public function enqueue_editor_assets() {
        wp_enqueue_style(
            'framify-elementor-editor',
            FRAMIFY_PLUGIN_URL . 'assets/framify-elementor-editor.css',
            array(),
            $this->asset_version( 'framify-elementor-editor.css' )
        );
    }

    // Editor panel only (not the preview iframe): hides the Float section on
    // a top-level container, see assets/framify-elementor-editor.js.
    public function enqueue_editor_scripts() {
        wp_enqueue_script(
            'framify-elementor-editor',
            FRAMIFY_PLUGIN_URL . 'assets/framify-elementor-editor.js',
            array( 'elementor-editor' ),
            $this->asset_version( 'framify-elementor-editor.js' ),
            true
        );

        // The dot-grid generator (pure, no DOM) behind the studio's Generate tab.
        wp_enqueue_script(
            'framify-dot-shapes',
            FRAMIFY_PLUGIN_URL . 'assets/framify-dot-shapes.js',
            array(),
            $this->asset_version( 'framify-dot-shapes.js' ),
            true
        );

        // Shape studio (Uploaded tab): upload an SVG, draw freehand, generate
        // dot patterns, manage the shapes saved in uploads/framify-shapes.
        wp_enqueue_script(
            'framify-shape-studio',
            FRAMIFY_PLUGIN_URL . 'assets/framify-shape-studio.js',
            array( 'elementor-editor', 'framify-dot-shapes' ),
            $this->asset_version( 'framify-shape-studio.js' ),
            true
        );
        $mine = array();
        foreach ( $this->library_shapes() as $id => $shape ) {
            $mine[] = array(
                'id'     => $id,
                'title'  => $shape['title'],
                'thumb'  => $shape['thumb'],
                'svg'    => $shape['svg'],
                'source' => $shape['source'],
            );
        }
        wp_localize_script( 'framify-shape-studio', 'framifyShapeStudio', array(
            'ajaxUrl' => admin_url( 'admin-ajax.php' ),
            'nonce'   => wp_create_nonce( 'framify_shapes' ),
            'maxUser' => Framify_Shape_Library::MAX_USER,
            'shapes'  => $mine,
        ) );
    }
}

new Framify_Elementor();
