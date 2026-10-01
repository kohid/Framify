<?php
/**
 * Framify - Elementor Shape Divider
 *
 * Adds a "Shape Divider" section to the Framify panel tab of Containers:
 * a Top and a Bottom divider, each drawn from pasted SVG code / path data
 * or an SVG file from the Media Library, filled with one colour, static or
 * with the Organic Shape module's Liquid ripple (the side touching the
 * container edge stays pinned).
 *
 * Top-level containers only: assets/framify-divider.js ignores a nested
 * container (.e-child), and the editor script hides this section for one
 * (the inverse of Float, see assets/framify-elementor-editor.js).
 *
 * Safety: nothing from the SVG is ever inserted. The JS reads geometry only
 * (path, rect, circle, ellipse, line, polyline, polygon, with their
 * transforms and the root viewBox baked into path data it builds itself)
 * through FramifyOrganicShape.parseSvgShape in framify-elementor.js, and a
 * Media Library file is fetched only when it is same-origin.
 *
 * PHP only declares controls. Width and Height are CSS (selectors), every
 * other control is frontend_available with render_type none, and the JS
 * builds the layer from the settings, in the editor preview and on the live
 * site alike (the same model as the other Framify modules).
 *
 * Loaded from framify.php after framify-elementor-text.php. Entirely inert
 * unless Elementor is active.
 *
 * File: framify-elementor-divider.php
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Framify_Elementor_Divider {

    const PREFIX = 'framify_org_dv_';

    public function __construct() {
        // The tab and the shared parser live in Framify_Elementor.
        if ( ! class_exists( 'Framify_Elementor' ) ) {
            return;
        }

        // Priority 50: after Organic Shape / Deco Blob / Grain (10),
        // Floating Shapes (20), Floating Text (30) and Float (40) on the same
        // hook, so the section lands last on the Framify tab.
        add_action( 'elementor/element/container/_section_responsive/after_section_end', array( $this, 'register_controls' ), 50 );

        add_action( 'elementor/frontend/after_enqueue_scripts', array( $this, 'enqueue_frontend_assets' ) );
    }

    /** Shared control args: live in JS, no element re-render. */
    private function live( array $args ) {
        return $args + array( 'frontend_available' => true, 'render_type' => 'none' );
    }

    private function switcher( $label, array $condition ) {
        return $this->live( array(
            'label'     => $label,
            'type'      => \Elementor\Controls_Manager::SWITCHER,
            'label_on'  => esc_html__( 'Yes', 'framify' ),
            'label_off' => esc_html__( 'No', 'framify' ),
            'default'   => '',
            'condition' => $condition,
        ) );
    }

    public function register_controls( $element ) {
        $element->start_controls_section( self::PREFIX . 'section', array(
            'label' => esc_html__( 'Shape Divider', 'framify' ),
            'tab'   => Framify_Elementor::TAB,
        ) );

        $element->start_controls_tabs( self::PREFIX . 'tabs' );
        foreach ( array( 'top' => esc_html__( 'Top', 'framify' ), 'bottom' => esc_html__( 'Bottom', 'framify' ) ) as $side => $label ) {
            $element->start_controls_tab( self::PREFIX . 'tab_' . $side, array( 'label' => $label ) );
            $this->register_side( $element, $side );
            $element->end_controls_tab();
        }
        $element->end_controls_tabs();

        $element->end_controls_section();
    }

    private function register_side( $element, $side ) {
        $cm  = 'Elementor\Controls_Manager';
        $k   = self::PREFIX . $side . '_';
        $on  = array( $k . 'source!' => '' );
        $svg = '{{WRAPPER}} > .framify-dv--' . $side . ' > svg';

        $element->add_control( $k . 'source', $this->live( array(
            'label'   => esc_html__( 'Source', 'framify' ),
            'type'    => $cm::SELECT,
            'default' => '',
            'options' => array(
                ''      => esc_html__( 'None', 'framify' ),
                'code'  => esc_html__( 'SVG code or path', 'framify' ),
                'media' => esc_html__( 'Media Library (SVG)', 'framify' ),
            ),
        ) ) );

        // Parsed in the browser: only geometry is read and rebuilt as path
        // data, so pasted markup can never inject.
        $element->add_control( $k . 'svg', $this->live( array(
            'label'       => esc_html__( 'SVG code or path', 'framify' ),
            'type'        => $cm::TEXTAREA,
            'rows'        => 6,
            'placeholder' => '<svg viewBox="0 0 1000 100"><path d="..."/></svg>',
            'description' => esc_html__( 'Paste an SVG drawn for the top edge (Bottom turns it round), or just its path data. Only its shapes are used, with their transforms and viewBox, filled with the colour below.', 'framify' ),
            'ai'          => array( 'active' => false ),
            'condition'   => array( $k . 'source' => 'code' ),
        ) ) );

        $element->add_control( $k . 'media', $this->live( array(
            'label'       => esc_html__( 'SVG file', 'framify' ),
            'type'        => $cm::MEDIA,
            'media_types' => array( 'svg' ),
            'ai'          => array( 'active' => false ),
            'description' => esc_html__( 'Uploading SVG files needs Elementor > Settings > Advanced > Enable Unfiltered File Uploads. Only the shapes in the file are used.', 'framify' ),
            'condition'   => array( $k . 'source' => 'media' ),
        ) ) );

        // Global Colours stay off: a linked value lives only in __globals__,
        // which never reaches the JS (see "How settings reach the JS").
        $element->add_control( $k . 'color', $this->live( array(
            'label'     => esc_html__( 'Colour', 'framify' ),
            'type'      => $cm::COLOR,
            'default'   => '#FFFFFF',
            'global'    => array( 'active' => false ),
            'condition' => $on,
        ) ) );

        // CSS, not JS: each breakpoint gets its own size with no plumbing,
        // and the svg stretches (preserveAspectRatio none) with no rebuild.
        $element->add_responsive_control( $k . 'width', array(
            'label'       => esc_html__( 'Width (%)', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( '%' ),
            'range'       => array( '%' => array( 'min' => 100, 'max' => 300, 'step' => 1 ) ),
            'default'     => array( 'unit' => '%', 'size' => 100 ),
            'selectors'   => array( $svg => 'width: calc({{SIZE}}% + 1.3px);' ),
            'render_type' => 'ui',
            'condition'   => $on,
        ) );

        $element->add_responsive_control( $k . 'height', array(
            'label'       => esc_html__( 'Height (px)', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 'px' ),
            'range'       => array( 'px' => array( 'min' => 1, 'max' => 500, 'step' => 1 ) ),
            'default'     => array( 'unit' => 'px', 'size' => 80 ),
            'selectors'   => array( $svg => 'height: {{SIZE}}px;' ),
            'render_type' => 'ui',
            'condition'   => $on,
        ) );

        $element->add_control( $k . 'flip', $this->switcher( esc_html__( 'Flip horizontally', 'framify' ), $on ) );
        $element->add_control( $k . 'upside', $this->switcher( esc_html__( 'Upside down', 'framify' ), $on ) );
        $element->add_control( $k . 'front', $this->switcher( esc_html__( 'Bring to front', 'framify' ), $on ) );

        $element->add_control( $k . 'motion', $this->live( array(
            'label'       => esc_html__( 'Motion', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => 'static',
            'options'     => array(
                'static' => esc_html__( 'Static', 'framify' ),
                'liquid' => esc_html__( 'Liquid ripple', 'framify' ),
            ),
            'description' => esc_html__( 'Liquid traces the shape and ripples its edge; the side on the container edge stays put.', 'framify' ),
            'separator'   => 'before',
            'condition'   => $on,
        ) ) );

        $moving = $on + array( $k . 'motion' => 'liquid' );
        $element->add_control( $k . 'trigger', $this->live( array(
            'label'     => esc_html__( 'Trigger', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'loop',
            'options'   => array(
                'loop'   => esc_html__( 'Continuous loop', 'framify' ),
                'inview' => esc_html__( 'Once, when scrolled into view', 'framify' ),
                'hover'  => esc_html__( 'On hover', 'framify' ),
            ),
            'condition' => $moving,
        ) ) );

        $element->add_control( $k . 'amount', $this->live( array(
            'label'     => esc_html__( 'Motion amount', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'normal',
            'options'   => array(
                'subtle' => esc_html__( 'Subtle', 'framify' ),
                'normal' => esc_html__( 'Normal', 'framify' ),
                'strong' => esc_html__( 'Strong', 'framify' ),
            ),
            'condition' => $moving,
        ) ) );
    }

    /* ------------------------------------------------------------------
       Assets: versioned by filemtime() for the reason given in
       framify-elementor.php. The script depends on the Organic Shape
       script (window.FramifyOrganicShape: the SVG parser and Liquid
       tracer) and the Floating Shapes one (window.FramifyFx: host claim,
       layer order, editor sync).
    ------------------------------------------------------------------ */
    private function asset_version( $file ) {
        $path = FRAMIFY_PLUGIN_DIR . 'assets/' . $file;
        return file_exists( $path ) ? (string) filemtime( $path ) : FRAMIFY_VERSION;
    }

    public function enqueue_frontend_assets() {
        wp_enqueue_style(
            'framify-divider',
            FRAMIFY_PLUGIN_URL . 'assets/framify-divider.css',
            array( 'framify-shapes' ),
            $this->asset_version( 'framify-divider.css' )
        );
        wp_enqueue_script(
            'framify-divider',
            FRAMIFY_PLUGIN_URL . 'assets/framify-divider.js',
            array( 'elementor-frontend', 'framify-elementor', 'framify-shapes' ),
            $this->asset_version( 'framify-divider.js' ),
            true
        );
    }
}

new Framify_Elementor_Divider();
