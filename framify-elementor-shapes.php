<?php
/**
 * Framify - Elementor Floating Shapes
 *
 * Adds a "Floating Shapes" section to the Framify panel tab of Containers,
 * legacy Sections, the Spacer widget and the Image widget (framed to the photo): small SVG shapes (square, circle, triangle, star,
 * diagonal, plus, x, hexagon) drifting slowly across the element like calm
 * confetti, either behind the content or over it with clicks passing
 * through.
 *
 * PHP only declares controls. Every control is frontend_available with
 * render_type none, and assets/framify-shapes.js builds and animates the
 * layer from the settings, in the editor preview and on the live site alike
 * (the same model as the Organic Shape module).
 *
 * Loaded from framify.php after framify-elementor.php, whose Framify tab it
 * reuses. Entirely inert unless Elementor is active.
 *
 * File: framify-elementor-shapes.php
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Framify_Elementor_Shapes {

    const PREFIX = 'framify_fs_';

    public function __construct() {
        // The tab is registered by Framify_Elementor; without it the section
        // would have nowhere to go.
        if ( ! class_exists( 'Framify_Elementor' ) ) {
            return;
        }

        // Priority 20: Framify_Elementor adds Organic Shape and Grain on the
        // same container hook at 10, and sections list in registration order,
        // so this lands after them. Legacy Sections end with the same
        // _section_responsive section (includes/elements/section.php).
        add_action( 'elementor/element/container/_section_responsive/after_section_end', array( $this, 'register_controls' ), 20 );
        add_action( 'elementor/element/section/_section_responsive/after_section_end', array( $this, 'register_controls' ), 20 );
        // Spacer (a standalone decor block): its only section, after Organic
        // Shape / Grain at 10. The JS hosts the layer on the element that
        // paints the Spacer's background (FramifyFx.hostOf).
        add_action( 'elementor/element/spacer/section_spacer/after_section_end', array( $this, 'register_controls' ), 20 );
        // Image widget: after its Organic Shape / Deco Blob / Grain sections
        // (10 on the same hook). The JS puts the layer in a frame matching
        // the img's box (FramifyFx.photoFrame), not the whole widget.
        add_action( 'elementor/element/image/section_style_caption/after_section_end', array( $this, 'register_controls' ), 20 );

        add_action( 'elementor/frontend/after_enqueue_scripts', array( $this, 'enqueue_frontend_assets' ) );
    }

    /** Shape ids => labels. The JS draws exactly these ids. */
    public function shape_options() {
        return array(
            'square'   => esc_html__( 'Square', 'framify' ),
            'circle'   => esc_html__( 'Circle', 'framify' ),
            'triangle' => esc_html__( 'Triangle', 'framify' ),
            'star'     => esc_html__( 'Star', 'framify' ),
            'diagonal' => esc_html__( 'Diagonal', 'framify' ),
            'plus'     => esc_html__( 'Plus', 'framify' ),
            'x'        => esc_html__( 'X', 'framify' ),
            'hexagon'  => esc_html__( 'Hexagon', 'framify' ),
        );
    }

    /** Shared control args: live in JS, no element re-render. */
    private function live( array $args ) {
        return $args + array( 'frontend_available' => true, 'render_type' => 'none' );
    }

    /** A single-unit slider. */
    private function slider( $label, $unit, $min, $max, $step, $default, array $condition ) {
        return $this->live( array(
            'label'      => $label,
            'type'       => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( $unit ),
            'range'      => array( $unit => array( 'min' => $min, 'max' => $max, 'step' => $step ) ),
            'default'    => array( 'unit' => $unit, 'size' => $default ),
            'condition'  => $condition,
        ) );
    }

    public function register_controls( $element ) {
        $cm = 'Elementor\Controls_Manager';
        $on = array( 'framify_fs_enable' => 'yes' );

        $element->start_controls_section( 'framify_fs_section', array(
            'label' => esc_html__( 'Floating Shapes', 'framify' ),
            'tab'   => Framify_Elementor::TAB,
        ) );

        $element->add_control( 'framify_fs_enable', $this->live( array(
            'label'     => esc_html__( 'Floating Shapes', 'framify' ),
            'type'      => $cm::SWITCHER,
            'label_on'  => esc_html__( 'On', 'framify' ),
            'label_off' => esc_html__( 'Off', 'framify' ),
            'default'   => '',
        ) ) );

        $layer = array(
            'label'     => esc_html__( 'Layer', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'background',
            'options'   => array(
                'background' => esc_html__( 'Background (behind content)', 'framify' ),
                'overlay'    => esc_html__( 'Overlay (above content, clicks pass through)', 'framify' ),
            ),
            'condition' => $on,
        );
        if ( 'image' === $element->get_name() ) {
            $layer['description'] = Framify_Elementor::image_layer_note();
        }
        $element->add_control( 'framify_fs_layer', $this->live( $layer ) );

        $element->add_control( 'framify_fs_shapes', $this->live( array(
            'label'       => esc_html__( 'Shapes', 'framify' ),
            'type'        => $cm::SELECT2,
            'multiple'    => true,
            'label_block' => true,
            'options'     => $this->shape_options(),
            'default'     => array_keys( $this->shape_options() ),
            'condition'   => $on,
        ) ) );

        $element->add_control( 'framify_fs_style', $this->live( array(
            'label'     => esc_html__( 'Style', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'mix',
            'options'   => array(
                'mix'     => esc_html__( 'Random mix', 'framify' ),
                'solid'   => esc_html__( 'Solid only', 'framify' ),
                'outline' => esc_html__( 'Outlined only', 'framify' ),
            ),
            'condition' => $on,
        ) ) );

        $element->add_control( 'framify_fs_stroke', $this->slider(
            esc_html__( 'Outline width', 'framify' ), 'px', 1, 8, 0.5, 2,
            $on + array( 'framify_fs_style!' => 'solid' )
        ) );

        $element->add_control( 'framify_fs_color_mode', $this->live( array(
            'label'     => esc_html__( 'Colours', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'palette',
            'options'   => array(
                'palette' => esc_html__( 'Palette', 'framify' ),
                'random'  => esc_html__( 'Random hues', 'framify' ),
            ),
            'separator' => 'before',
            'condition' => $on,
        ) ) );

        // Five slots, empty ones are skipped: a palette is usually two or
        // three brand colours, and a repeater would be heavy for that.
        // Global Colours work: a linked value lives only in __globals__, so
        // assets/framify-colors.js resolves it back into the settings.
        $palette = array( '#F69216', '#263238', '', '', '' );
        foreach ( $palette as $i => $default ) {
            $element->add_control( 'framify_fs_color_' . ( $i + 1 ), $this->live( array(
                /* translators: %d: palette slot number, 1-5. */
                'label'     => sprintf( esc_html__( 'Colour %d', 'framify' ), $i + 1 ),
                'type'      => $cm::COLOR,
                'default'   => $default,
                'condition' => $on + array( 'framify_fs_color_mode' => 'palette' ),
            ) ) );
        }

        $random = $on + array( 'framify_fs_color_mode' => 'random' );
        $element->add_control( 'framify_fs_saturation', $this->slider( esc_html__( 'Saturation', 'framify' ), '%', 0, 100, 1, 70, $random ) );
        $element->add_control( 'framify_fs_lightness', $this->slider( esc_html__( 'Lightness', 'framify' ), '%', 0, 100, 1, 60, $random ) );

        $element->add_control( 'framify_fs_area', $this->live( array(
            'label'     => esc_html__( 'Area', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'full',
            'options'   => array(
                'full'  => esc_html__( 'Whole element', 'framify' ),
                'left'  => esc_html__( 'Left band', 'framify' ),
                'right' => esc_html__( 'Right band', 'framify' ),
            ),
            'separator' => 'before',
            'condition' => $on,
        ) ) );

        $element->add_control( 'framify_fs_area_width', $this->slider(
            esc_html__( 'Band width', 'framify' ), '%', 10, 90, 1, 35,
            $on + array( 'framify_fs_area!' => 'full' )
        ) );

        // Responsive so a phone can carry fewer shapes; the JS picks the
        // value for the current device.
        $element->add_responsive_control( 'framify_fs_count', $this->live( array(
            'label'      => esc_html__( 'Count', 'framify' ),
            'type'       => $cm::SLIDER,
            'size_units' => array( 'px' ),
            'range'      => array( 'px' => array( 'min' => 1, 'max' => 60, 'step' => 1 ) ),
            'default'    => array( 'unit' => 'px', 'size' => 18 ),
            'condition'  => $on,
        ) ) );

        $element->add_control( 'framify_fs_size', $this->slider( esc_html__( 'Max size', 'framify' ), 'px', 8, 200, 1, 48, $on ) );
        $element->add_control( 'framify_fs_opacity', $this->live( array(
            'label'     => esc_html__( 'Max opacity', 'framify' ),
            'type'      => $cm::SLIDER,
            'range'     => array( 'px' => array( 'min' => 0.1, 'max' => 1, 'step' => 0.05 ) ),
            'default'   => array( 'size' => 0.8 ),
            'condition' => $on,
        ) ) );

        $element->add_control( 'framify_fs_direction', $this->live( array(
            'label'     => esc_html__( 'Direction', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'up',
            'options'   => array(
                'up'     => esc_html__( 'Up', 'framify' ),
                'down'   => esc_html__( 'Down', 'framify' ),
                'left'   => esc_html__( 'Left', 'framify' ),
                'right'  => esc_html__( 'Right', 'framify' ),
                'random' => esc_html__( 'Random', 'framify' ),
            ),
            'separator' => 'before',
            'condition' => $on,
        ) ) );

        $element->add_control( 'framify_fs_speed', $this->live( array(
            'label'     => esc_html__( 'Speed', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'normal',
            'options'   => array(
                'slow'   => esc_html__( 'Slow', 'framify' ),
                'normal' => esc_html__( 'Normal', 'framify' ),
                'fast'   => esc_html__( 'Fast', 'framify' ),
                'custom' => esc_html__( 'Custom', 'framify' ),
            ),
            'condition' => $on,
        ) ) );

        // Responsive so a phone can drift slower/faster than desktop, same
        // pattern as Count: the JS reads it with the same fallback chain
        // (readDuration(), mirroring readCount()). Only meaningful when
        // Speed is Custom.
        $element->add_responsive_control( 'framify_fs_duration', $this->live( array(
            'label'       => esc_html__( 'Seconds per pass', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 's' ),
            'range'       => array( 's' => array( 'min' => 2, 'max' => 60, 'step' => 0.5 ) ),
            'default'     => array( 'unit' => 's', 'size' => 12 ),
            'description' => esc_html__( 'How long one shape takes to drift across the area. Lower is faster.', 'framify' ),
            'condition'   => $on + array( 'framify_fs_speed' => 'custom' ),
        ) ) );

        $element->add_control( 'framify_fs_spin', $this->live( array(
            'label'     => esc_html__( 'Spin', 'framify' ),
            'type'      => $cm::SWITCHER,
            'label_on'  => esc_html__( 'On', 'framify' ),
            'label_off' => esc_html__( 'Off', 'framify' ),
            'default'   => 'yes',
            'condition' => $on,
        ) ) );

        $element->end_controls_section();
    }

    /* ------------------------------------------------------------------
       Assets: versioned by filemtime() for the reason given in
       framify-elementor.php (public pages sit behind caches and CDNs).
       Loaded on every Elementor page, like the Organic Shape bundle: the
       files are a few KB and the handler does nothing unless switched on.
    ------------------------------------------------------------------ */
    private function asset_version( $file ) {
        $path = FRAMIFY_PLUGIN_DIR . 'assets/' . $file;
        return file_exists( $path ) ? (string) filemtime( $path ) : FRAMIFY_VERSION;
    }

    public function enqueue_frontend_assets() {
        wp_enqueue_style(
            'framify-shapes',
            FRAMIFY_PLUGIN_URL . 'assets/framify-shapes.css',
            array(),
            $this->asset_version( 'framify-shapes.css' )
        );
        if ( class_exists( 'Framify_Elementor' ) ) {
            Framify_Elementor::enqueue_colors_script();
        }
        wp_enqueue_script(
            'framify-shapes',
            FRAMIFY_PLUGIN_URL . 'assets/framify-shapes.js',
            array( 'elementor-frontend', 'framify-colors' ),
            $this->asset_version( 'framify-shapes.js' ),
            true
        );
    }
}

new Framify_Elementor_Shapes();
