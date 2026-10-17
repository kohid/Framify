<?php
/**
 * Framify - Elementor Background Effects
 *
 * Adds a "Background Effects" section to the Framify panel tab of Containers
 * and legacy Sections: up to three independent animated layers, each a
 * cloud, smoke or flames effect with its own settings, drawn on a canvas
 * either under Elementor's Background Overlay (so the overlay tints it) or
 * above the overlay, always below the content.
 *
 * PHP only declares controls. Every control is frontend_available with
 * render_type none, and assets/framify-effects.js draws the layers from the
 * settings, in the editor preview and on the live site alike (the same model
 * as Floating Shapes). The control table below mirrors SPEC in
 * assets/framify-effects-core.js; dev/tests/elementor-shapes-test.php checks
 * the two agree.
 *
 * Loaded from framify.php after framify-elementor.php (whose Framify tab it
 * reuses) and framify-elementor-shapes.php (whose script supplies the shared
 * helpers). Entirely inert unless Elementor is active.
 *
 * File: framify-elementor-effects.php
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Framify_Elementor_Effects {

    const PREFIX = 'framify_ef_';
    const LAYERS = 3;

    public function __construct() {
        // The tab is registered by Framify_Elementor and the script needs the
        // helpers of Framify_Elementor_Shapes (a missing script dependency
        // makes WordPress drop the script silently).
        if ( ! class_exists( 'Framify_Elementor' ) || ! class_exists( 'Framify_Elementor_Shapes' ) ) {
            return;
        }

        // Priority 60: 10 Organic Shape / Grain, 20 Floating Shapes, 30
        // Floating Text, 40 Float, 50 Shape Divider. Legacy Sections end with
        // the same _section_responsive section as Containers.
        add_action( 'elementor/element/container/_section_responsive/after_section_end', array( $this, 'register_controls' ), 60 );
        add_action( 'elementor/element/section/_section_responsive/after_section_end', array( $this, 'register_controls' ), 60 );

        add_action( 'elementor/frontend/after_enqueue_scripts', array( $this, 'enqueue_frontend_assets' ) );
    }

    /** Effect ids => labels. The JS draws exactly these ids. */
    public function type_options() {
        return array(
            'cloud'  => esc_html__( 'Cloud', 'framify' ),
            'smoke'  => esc_html__( 'Smoke', 'framify' ),
            'flames' => esc_html__( 'Flames', 'framify' ),
        );
    }

    /**
     * The per-layer controls, in panel order. `types` lists the effects that
     * use the control; `unit` '%' shows a percent slider, '' a plain number.
     */
    public function params() {
        $all = array_keys( $this->type_options() );
        return array(
            'opacity' => array( 'kind' => 'slider', 'label' => esc_html__( 'Opacity', 'framify' ), 'unit' => '', 'min' => 0.05, 'max' => 1, 'step' => 0.05, 'def' => 0.7, 'types' => $all ),
            'speed'   => array( 'kind' => 'slider', 'label' => esc_html__( 'Speed', 'framify' ), 'unit' => '', 'min' => 0.2, 'max' => 3, 'step' => 0.05, 'def' => 1, 'types' => $all ),
            'density' => array( 'kind' => 'slider', 'label' => esc_html__( 'Density', 'framify' ), 'unit' => '%', 'min' => 0, 'max' => 100, 'step' => 1, 'def' => 50, 'types' => $all, 'responsive' => true,
                'description' => esc_html__( 'How many particles. Phones can use fewer: set it per device.', 'framify' ) ),
            'size'    => array( 'kind' => 'slider', 'label' => esc_html__( 'Size', 'framify' ), 'unit' => '%', 'min' => 40, 'max' => 250, 'step' => 1, 'def' => 100, 'types' => $all ),
            'c1'      => array( 'kind' => 'color', 'label' => esc_html__( 'Colour 1', 'framify' ), 'types' => $all, 'separator' => 'before',
                'description' => esc_html__( 'Leave empty for the effect\'s own colour. Cloud: body. Smoke: fresh smoke. Flames: the hot core.', 'framify' ) ),
            'c2'      => array( 'kind' => 'color', 'label' => esc_html__( 'Colour 2', 'framify' ), 'types' => $all,
                'description' => esc_html__( 'Cloud: shaded underside. Smoke: aged smoke. Flames: the middle of the flame.', 'framify' ) ),
            'c3'      => array( 'kind' => 'color', 'label' => esc_html__( 'Colour 3', 'framify' ), 'types' => array( 'flames' ),
                'description' => esc_html__( 'The outer tip of the flames.', 'framify' ) ),
            'dir'     => array( 'kind' => 'select', 'label' => esc_html__( 'Drift direction', 'framify' ), 'types' => array( 'cloud' ), 'def' => 'right', 'separator' => 'before',
                'options' => array( 'right' => esc_html__( 'Right', 'framify' ), 'left' => esc_html__( 'Left', 'framify' ) ) ),
            'softness' => array( 'kind' => 'slider', 'label' => esc_html__( 'Softness', 'framify' ), 'unit' => '%', 'min' => 0, 'max' => 100, 'step' => 1, 'def' => 60, 'types' => array( 'cloud' ) ),
            'band'    => array( 'kind' => 'slider', 'label' => esc_html__( 'Band position (from top)', 'framify' ), 'unit' => '%', 'min' => 0, 'max' => 100, 'step' => 1, 'def' => 35, 'types' => array( 'cloud' ) ),
            'spread'  => array( 'kind' => 'slider', 'label' => esc_html__( 'Band height', 'framify' ), 'unit' => '%', 'min' => 10, 'max' => 100, 'step' => 1, 'def' => 60, 'types' => array( 'cloud' ) ),
            'rise'    => array( 'kind' => 'slider', 'label' => esc_html__( 'Rise height', 'framify' ), 'unit' => '%', 'min' => 20, 'max' => 100, 'step' => 1, 'def' => 70, 'types' => array( 'smoke' ), 'separator' => 'before' ),
            'turb'    => array( 'kind' => 'slider', 'label' => esc_html__( 'Turbulence', 'framify' ), 'unit' => '%', 'min' => 0, 'max' => 100, 'step' => 1, 'def' => 50, 'types' => array( 'smoke' ) ),
            'flame_h' => array( 'kind' => 'slider', 'label' => esc_html__( 'Flame height', 'framify' ), 'unit' => '%', 'min' => 10, 'max' => 100, 'step' => 1, 'def' => 45, 'types' => array( 'flames' ), 'separator' => 'before' ),
            'flicker' => array( 'kind' => 'slider', 'label' => esc_html__( 'Flicker', 'framify' ), 'unit' => '%', 'min' => 0, 'max' => 100, 'step' => 1, 'def' => 60, 'types' => array( 'flames' ) ),
            'ox'      => array( 'kind' => 'slider', 'label' => esc_html__( 'Source position', 'framify' ), 'unit' => '%', 'min' => 0, 'max' => 100, 'step' => 1, 'def' => 50, 'types' => array( 'smoke', 'flames' ),
                'description' => esc_html__( 'Where along the bottom edge it rises from.', 'framify' ) ),
            'ew'      => array( 'kind' => 'slider', 'label' => esc_html__( 'Source width', 'framify' ), 'unit' => '%', 'min' => 5, 'max' => 100, 'step' => 1, 'def' => 40, 'types' => array( 'smoke', 'flames' ) ),
            'wind'    => array( 'kind' => 'slider', 'label' => esc_html__( 'Wind', 'framify' ), 'unit' => '', 'min' => -100, 'max' => 100, 'step' => 1, 'def' => 0, 'types' => array( 'smoke', 'flames' ),
                'description' => esc_html__( 'Negative leans left, positive leans right.', 'framify' ) ),
        );
    }

    /** Shared control args: live in JS, no element re-render. */
    private function live( array $args ) {
        return $args + array( 'frontend_available' => true, 'render_type' => 'none' );
    }

    public function register_controls( $element ) {
        $cm = 'Elementor\Controls_Manager';

        $element->start_controls_section( 'framify_ef_section', array(
            'label' => esc_html__( 'Background Effects', 'framify' ),
            'tab'   => Framify_Elementor::TAB,
        ) );

        $element->add_control( 'framify_ef_stack', $this->live( array(
            'label'       => esc_html__( 'Stacking', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => 'under',
            'options'     => array(
                'under' => esc_html__( 'Under the background overlay', 'framify' ),
                'above' => esc_html__( 'Above the background overlay', 'framify' ),
            ),
            'description' => esc_html__( 'Under: your Background Overlay colour tints the effect. Above: the effect is never tinted. Both stay below the content. A background video or slideshow hides an effect placed under the overlay; use Above there.', 'framify' ),
        ) ) );

        $element->add_control( 'framify_ef_quality', $this->live( array(
            'label'       => esc_html__( 'Quality', 'framify' ),
            'type'        => $cm::SELECT,
            'default'     => 'medium',
            'options'     => array(
                'low'    => esc_html__( 'Low (lightest)', 'framify' ),
                'medium' => esc_html__( 'Medium', 'framify' ),
                'high'   => esc_html__( 'High (sharpest, 60 fps)', 'framify' ),
            ),
            'description' => esc_html__( 'The effect is drawn at reduced resolution and steps itself down on slow devices. It pauses off-screen and stands still with "reduce motion".', 'framify' ),
        ) ) );

        $element->start_controls_tabs( 'framify_ef_tabs' );
        for ( $n = 1; $n <= self::LAYERS; $n++ ) {
            $element->start_controls_tab( 'framify_ef_tab_' . $n, array(
                /* translators: %d: layer number */
                'label' => sprintf( esc_html__( 'Layer %d', 'framify' ), $n ),
            ) );
            $this->layer_controls( $element, $n );
            $element->end_controls_tab();
        }
        $element->end_controls_tabs();

        $element->end_controls_section();
    }

    /** One layer's controls, ids framify_ef_{n}_{key}. */
    private function layer_controls( $element, $n ) {
        $cm   = 'Elementor\Controls_Manager';
        $type = self::PREFIX . $n . '_type';

        $element->add_control( $type, $this->live( array(
            'label'   => esc_html__( 'Effect', 'framify' ),
            'type'    => $cm::SELECT,
            'default' => 'off',
            'options' => array( 'off' => esc_html__( 'Off', 'framify' ) ) + $this->type_options(),
        ) ) );

        foreach ( $this->params() as $key => $spec ) {
            $id   = self::PREFIX . $n . '_' . $key;
            $args = array(
                'label'     => $spec['label'],
                'condition' => array( $type => $spec['types'] ),
            );
            if ( ! empty( $spec['description'] ) ) {
                $args['description'] = $spec['description'];
            }
            if ( ! empty( $spec['separator'] ) ) {
                $args['separator'] = $spec['separator'];
            }
            if ( 'color' === $spec['kind'] ) {
                // Global Colours stay on: framify-colors.js resolves them.
                $args += array( 'type' => $cm::COLOR, 'default' => '' );
            } elseif ( 'select' === $spec['kind'] ) {
                $args += array( 'type' => $cm::SELECT, 'default' => $spec['def'], 'options' => $spec['options'] );
            } else {
                $unit = '' === $spec['unit'] ? 'px' : $spec['unit'];
                $args += array(
                    'type'    => $cm::SLIDER,
                    'range'   => array( $unit => array( 'min' => $spec['min'], 'max' => $spec['max'], 'step' => $spec['step'] ) ),
                    'default' => array( 'size' => $spec['def'] ),
                );
                // A plain number shows no unit switcher; a percentage does.
                if ( '' !== $spec['unit'] ) {
                    $args['size_units'] = array( $unit );
                    $args['default']['unit'] = $unit;
                }
            }
            if ( ! empty( $spec['responsive'] ) ) {
                $element->add_responsive_control( $id, $this->live( $args ) );
            } else {
                $element->add_control( $id, $this->live( $args ) );
            }
        }
    }

    /* ------------------------------------------------------------------
       Front-end assets. Versioned by file time, like the other modules.
       Loaded on every Elementor page: the files are a few KB and the
       handler does nothing unless a layer is switched on.
    ------------------------------------------------------------------ */
    private function asset_version( $file ) {
        $path = FRAMIFY_PLUGIN_DIR . 'assets/' . $file;
        return file_exists( $path ) ? (string) filemtime( $path ) : FRAMIFY_VERSION;
    }

    public function enqueue_frontend_assets() {
        // framify-shapes supplies .framify-fs-host (the isolation that keeps
        // z-index -1 inside the element) as well as the shared script helpers.
        wp_enqueue_style(
            'framify-effects',
            FRAMIFY_PLUGIN_URL . 'assets/framify-effects.css',
            array( 'framify-shapes' ),
            $this->asset_version( 'framify-effects.css' )
        );
        Framify_Elementor::enqueue_colors_script();
        wp_enqueue_script(
            'framify-effects-core',
            FRAMIFY_PLUGIN_URL . 'assets/framify-effects-core.js',
            array(),
            $this->asset_version( 'framify-effects-core.js' ),
            true
        );
        wp_enqueue_script(
            'framify-effects',
            FRAMIFY_PLUGIN_URL . 'assets/framify-effects.js',
            array( 'elementor-frontend', 'framify-colors', 'framify-shapes', 'framify-effects-core' ),
            $this->asset_version( 'framify-effects.js' ),
            true
        );
    }
}

new Framify_Elementor_Effects();
