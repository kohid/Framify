<?php
/**
 * Framify - Elementor Floating Text
 *
 * Adds a "Floating Text" section to the Framify panel tab of Containers,
 * legacy Sections, the Spacer widget and the Image widget (framed to the photo): words and short phrases from a list appear one at a time
 * in quiet, non-overlapping spots, hold, and leave again, behind the
 * content or over it with clicks passing through.
 *
 * PHP only declares controls. Every behaviour control is frontend_available
 * with render_type none, and assets/framify-text.js builds and animates the
 * layer from the settings, in the editor preview and on the live site alike
 * (the Floating Shapes model). The exceptions are Typography and the CSS
 * parts of Word Style (background colour / opacity, border, radius, text
 * shadow, padding): plain CSS that Elementor applies itself.
 *
 * Loaded from framify.php after framify-elementor-shapes.php; reuses the
 * Framify tab and the shared helpers the shapes script publishes
 * (window.FramifyFx). Entirely inert unless Elementor is active.
 *
 * File: framify-elementor-text.php
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Framify_Elementor_Text {

    const PREFIX = 'framify_ft_';

    public function __construct() {
        // The tab is registered by Framify_Elementor; without it the section
        // would have nowhere to go.
        if ( ! class_exists( 'Framify_Elementor' ) ) {
            return;
        }

        // Priority 30: Floating Shapes registers on the same hooks at 20,
        // and sections list in registration order, so this lands after it.
        add_action( 'elementor/element/container/_section_responsive/after_section_end', array( $this, 'register_controls' ), 30 );
        add_action( 'elementor/element/section/_section_responsive/after_section_end', array( $this, 'register_controls' ), 30 );
        // Spacer: after Floating Shapes (20) on its only section.
        add_action( 'elementor/element/spacer/section_spacer/after_section_end', array( $this, 'register_spacer_controls' ), 30 );
        // Image widget: after Floating Shapes (20). Same descendant selectors
        // as the Spacer: the layer sits in a photo frame inside the widget,
        // and an Image widget has no child elements either.
        add_action( 'elementor/element/image/section_style_caption/after_section_end', array( $this, 'register_spacer_controls' ), 30 );

        add_action( 'elementor/frontend/after_enqueue_scripts', array( $this, 'enqueue_frontend_assets' ) );
    }

    /** Animation ids => labels. The JS runs exactly these ids ('random' picks one per word). */
    public function animation_options() {
        return array(
            'random'     => esc_html__( 'Random mix', 'framify' ),
            'fade'       => esc_html__( 'Fade', 'framify' ),
            'drift'      => esc_html__( 'Drift', 'framify' ),
            'typewriter' => esc_html__( 'Typewriter', 'framify' ),
            'blur'       => esc_html__( 'Blur in', 'framify' ),
            'pop'        => esc_html__( 'Pop', 'framify' ),
            'rise'       => esc_html__( 'Rise (masked)', 'framify' ),
            'cascade'    => esc_html__( 'Letter cascade', 'framify' ),
            'flip'       => esc_html__( 'Flip', 'framify' ),
            'wave'       => esc_html__( 'Wave', 'framify' ),
            'scramble'   => esc_html__( 'Scramble', 'framify' ),
        );
    }

    /** Shared control args: live in JS, no element re-render. */
    private function live( array $args ) {
        return $args + array( 'frontend_available' => true, 'render_type' => 'none' );
    }

    /**
     * CSS-only control args: Elementor writes the CSS itself and the JS
     * never reads the value (its editor sync skips these keys, see CSS_KEYS
     * in assets/framify-text.js, and only re-measures the holding words).
     */
    private function css( array $args ) {
        return $args + array( 'render_type' => 'ui' );
    }

    /** A single-unit slider. */
    private function slider( $label, $unit, $min, $max, $step, $default, array $condition, array $extra = array() ) {
        return $this->live( $extra + array(
            'label'      => $label,
            'type'       => \Elementor\Controls_Manager::SLIDER,
            'size_units' => array( $unit ),
            'range'      => array( $unit => array( 'min' => $min, 'max' => $max, 'step' => $step ) ),
            'default'    => array( 'unit' => $unit, 'size' => $default ),
            'condition'  => $condition,
        ) );
    }

    /** Containers and legacy Sections: the layer is the element's own child. */
    public function register_controls( $element ) {
        $this->register_section( $element, '{{WRAPPER}} > .framify-ft' );
    }

    /**
     * Spacer: the same controls, but the layer lives in the element that
     * paints the Spacer's background, which is .elementor-widget-container
     * unless Optimized Markup drops it, so the CSS selectors match it as a
     * descendant. Safe here and only here: a Spacer has no child elements,
     * so no nested layer can match (the reason containers use ">").
     */
    public function register_spacer_controls( $element ) {
        $this->register_section( $element, '{{WRAPPER}} .framify-ft' );
    }

    /** $layer: selector of this element's own .framify-ft layer. */
    private function register_section( $element, $layer ) {
        $cm = 'Elementor\Controls_Manager';
        $on = array( 'framify_ft_enable' => 'yes' );

        $element->start_controls_section( 'framify_ft_section', array(
            'label' => esc_html__( 'Floating Text', 'framify' ),
            'tab'   => Framify_Elementor::TAB,
        ) );

        $element->add_control( 'framify_ft_enable', $this->live( array(
            'label'     => esc_html__( 'Floating Text', 'framify' ),
            'type'      => $cm::SWITCHER,
            'label_on'  => esc_html__( 'On', 'framify' ),
            'label_off' => esc_html__( 'Off', 'framify' ),
            'default'   => '',
        ) ) );

        // Rendered with textContent only, never parsed as markup. AI is off:
        // these are brand words, not copy to be rewritten.
        $element->add_control( 'framify_ft_words', $this->live( array(
            'label'       => esc_html__( 'Words and phrases', 'framify' ),
            'type'        => $cm::TEXTAREA,
            'rows'        => 6,
            'default'     => '',
            'placeholder' => "Pass the Knowledge\nAberdeen\nRoutes",
            'description' => esc_html__( 'One per line. Each appears at random; the same line is never shown twice at once.', 'framify' ),
            'ai'          => array( 'active' => false ),
            'condition'   => $on,
        ) ) );

        $layer_control = array(
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
            $layer_control['description'] = Framify_Elementor::image_layer_note();
        }
        $element->add_control( 'framify_ft_layer', $this->live( $layer_control ) );

        $element->add_control( 'framify_ft_area', $this->live( array(
            'label'     => esc_html__( 'Area', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'full',
            'options'   => array(
                'full'  => esc_html__( 'Whole element', 'framify' ),
                'left'  => esc_html__( 'Left band', 'framify' ),
                'right' => esc_html__( 'Right band', 'framify' ),
            ),
            'condition' => $on,
        ) ) );

        $element->add_control( 'framify_ft_area_width', $this->slider(
            esc_html__( 'Band width', 'framify' ), '%', 10, 90, 1, 35,
            $on + array( 'framify_ft_area!' => 'full' )
        ) );

        // Responsive so a phone can carry fewer words; the JS picks the
        // value for the current device (FramifyFx.readResponsive).
        $element->add_responsive_control( 'framify_ft_count', $this->live( array(
            'label'      => esc_html__( 'Words on screen at once', 'framify' ),
            'type'       => $cm::SLIDER,
            'size_units' => array( 'px' ),
            'range'      => array( 'px' => array( 'min' => 1, 'max' => 20, 'step' => 1 ) ),
            'default'    => array( 'unit' => 'px', 'size' => 5 ),
            'condition'  => $on,
        ) ) );

        // Plain CSS, applied by Elementor (no JS rebuild; the JS ignores
        // these keys). Scoped to this element's own layer so a nested
        // container's Floating Text keeps its own typography. Font size is
        // the MAXIMUM: each word picks a size between Min font size and it
        // (the JS reads it from the word's computed style per word).
        if ( class_exists( '\Elementor\Group_Control_Typography' ) ) {
            $element->add_group_control( \Elementor\Group_Control_Typography::get_type(), array(
                'name'           => 'framify_ft_typography',
                'selector'       => $layer . ' .framify-ft__word',
                'separator'      => 'before',
                'condition'      => $on,
                'fields_options' => array(
                    'typography'  => array( 'default' => 'custom' ),
                    'font_size'   => array(
                        'default'        => array( 'unit' => 'px', 'size' => 28 ),
                        'tablet_default' => array( 'unit' => 'px', 'size' => 24 ),
                        'mobile_default' => array( 'unit' => 'px', 'size' => 20 ),
                    ),
                    'font_weight' => array( 'default' => '600' ),
                ),
            ) );
        }

        $this->register_word_style( $element, $on, $layer );

        $element->add_control( 'framify_ft_style', $this->live( array(
            'label'     => esc_html__( 'Style', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'solid',
            'options'   => array(
                'solid'   => esc_html__( 'Solid', 'framify' ),
                'outline' => esc_html__( 'Outline', 'framify' ),
                'mix'     => esc_html__( 'Random mix', 'framify' ),
            ),
            'condition' => $on,
        ) ) );

        $element->add_control( 'framify_ft_stroke', $this->slider(
            esc_html__( 'Outline width', 'framify' ), 'px', 0.5, 4, 0.5, 1,
            $on + array( 'framify_ft_style!' => 'solid' )
        ) );

        $element->add_control( 'framify_ft_color_mode', $this->live( array(
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

        // Same five slots and the same Global Colour rule as Floating
        // Shapes: a global-linked value lives only in __globals__, which
        // never reaches the JS, so the picker is disabled.
        $palette = array( '#F69216', '#263238', '', '', '' );
        foreach ( $palette as $i => $default ) {
            $element->add_control( 'framify_ft_color_' . ( $i + 1 ), $this->live( array(
                /* translators: %d: palette slot number, 1-5. */
                'label'     => sprintf( esc_html__( 'Colour %d', 'framify' ), $i + 1 ),
                'type'      => $cm::COLOR,
                'default'   => $default,
                'global'    => array( 'active' => false ),
                'condition' => $on + array( 'framify_ft_color_mode' => 'palette' ),
            ) ) );
        }

        $random = $on + array( 'framify_ft_color_mode' => 'random' );
        $element->add_control( 'framify_ft_saturation', $this->slider( esc_html__( 'Saturation', 'framify' ), '%', 0, 100, 1, 70, $random ) );
        $element->add_control( 'framify_ft_lightness', $this->slider( esc_html__( 'Lightness', 'framify' ), '%', 0, 100, 1, 60, $random ) );

        // Low by default so the words sit quietly behind real content.
        $element->add_control( 'framify_ft_opacity', $this->live( array(
            'label'       => esc_html__( 'Max opacity', 'framify' ),
            'type'        => $cm::SLIDER,
            'description' => esc_html__( 'With a background, Max opacity fades the whole chip; otherwise just the text.', 'framify' ),
            'range'     => array( 'px' => array( 'min' => 0.1, 'max' => 1, 'step' => 0.05 ) ),
            'default'   => array( 'size' => 0.35 ),
            'condition' => $on,
        ) ) );

        $element->add_control( 'framify_ft_tilt', $this->live( array(
            'label'     => esc_html__( 'Tilt', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'none',
            'options'   => array(
                'none'     => esc_html__( 'None', 'framify' ),
                'slight'   => esc_html__( 'Slight', 'framify' ),
                'vertical' => esc_html__( 'Some vertical', 'framify' ),
            ),
            'condition' => $on,
        ) ) );

        $element->add_control( 'framify_ft_animation', $this->live( array(
            'label'     => esc_html__( 'Animation', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'fade',
            'options'   => $this->animation_options(),
            'separator' => 'before',
            'condition' => $on,
        ) ) );

        $element->add_control( 'framify_ft_direction', $this->live( array(
            'label'     => esc_html__( 'Drift direction', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'up',
            'options'   => array(
                'up'     => esc_html__( 'Up', 'framify' ),
                'down'   => esc_html__( 'Down', 'framify' ),
                'left'   => esc_html__( 'Left', 'framify' ),
                'right'  => esc_html__( 'Right', 'framify' ),
                'random' => esc_html__( 'Random', 'framify' ),
            ),
            'condition' => $on + array( 'framify_ft_animation' => array( 'drift', 'random' ) ),
        ) ) );

        $element->add_control( 'framify_ft_hold', $this->slider( esc_html__( 'Hold time', 'framify' ), 's', 0.5, 10, 0.5, 2.5, $on ) );

        $element->add_control( 'framify_ft_speed', $this->live( array(
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

        // Responsive, read with the same fallback chain as Count.
        $element->add_responsive_control( 'framify_ft_duration', $this->live( array(
            'label'       => esc_html__( 'Transition seconds', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 's' ),
            'range'       => array( 's' => array( 'min' => 0.3, 'max' => 10, 'step' => 0.1 ) ),
            'default'     => array( 'unit' => 's', 'size' => 1.2 ),
            'description' => esc_html__( 'Length of each word\'s way in and way out.', 'framify' ),
            'condition'   => $on + array( 'framify_ft_speed' => 'custom' ),
        ) ) );

        $element->add_control( 'framify_ft_gap', $this->slider(
            esc_html__( 'Gap between words', 'framify' ), 's', 0, 5, 0.1, 0.6, $on,
            array( 'description' => esc_html__( 'Pause before a freed spot shows its next word.', 'framify' ) )
        ) );

        $element->end_controls_section();
    }

    /**
     * Word Style: dresses each word as a chip. The word element is the
     * chip (it is also the box the JS measures and positions, so padding
     * and border count in the overlap rules, and it carries each word's
     * final font size, so em padding / radius scale with the word); the
     * text inside it carries the text opacity and the in/out animation.
     *
     * Everything here is CSS-only except Min font size and the Background
     * mode, which the JS reads (min size sets each word's random size
     * range; the mode switches chip mode on and, for From palette, gives
     * each chip its word's colour plus an automatic contrast text colour).
     * With the defaults nothing is written: no chip, no border, no shadow,
     * no padding.
     */
    private function register_word_style( $element, array $on, $layer ) {
        $cm    = 'Elementor\Controls_Manager';
        $chip  = $layer . ' .framify-ft__word';

        $element->add_control( 'framify_ft_word_style', array(
            'label'     => esc_html__( 'Word Style', 'framify' ),
            'type'      => $cm::HEADING,
            'separator' => 'before',
            'condition' => $on,
        ) );

        // The low end of each word's size range; the Typography size is the
        // high end. JS-read (FramifyFx.readResponsive for the current
        // device), so a change rebuilds. Empty = 75% of the Typography size
        // (close to the old +-25% Size variation look); a min above the
        // Typography size is capped to it (words never exceed Typography;
        // tablet / mobile inherit a desktop min). Supersedes the
        // removed Size variation and Max font size controls, whose saved
        // values are simply ignored.
        $element->add_responsive_control( 'framify_ft_min_size', $this->live( array(
            'label'       => esc_html__( 'Min font size (px)', 'framify' ),
            'type'        => $cm::SLIDER,
            'size_units'  => array( 'px' ),
            'range'       => array( 'px' => array( 'min' => 6, 'max' => 200, 'step' => 1 ) ),
            'default'     => array( 'unit' => 'px', 'size' => '' ),
            'description' => esc_html__( 'Each word picks a random size between this and the Typography size. Empty = down to 75% of the Typography size. If it is larger than the Typography size, words use the Typography size.', 'framify' ),
            'condition'   => $on,
        ) ) );

        $element->add_control( 'framify_ft_bg_mode', $this->live( array(
            'label'     => esc_html__( 'Background', 'framify' ),
            'type'      => $cm::SELECT,
            'default'   => 'none',
            'options'   => array(
                'none'    => esc_html__( 'None', 'framify' ),
                'fixed'   => esc_html__( 'Fixed colour', 'framify' ),
                'palette' => esc_html__( 'From palette', 'framify' ),
            ),
            'description' => esc_html__( 'With a background, Max opacity fades the whole chip. From palette: each chip takes its word\'s colour and the text switches to dark or white, whichever contrasts more.', 'framify' ),
            'condition'   => $on,
        ) ) );

        // CSS-only (a custom property on the chip), so the Global Colour
        // picker can stay: Elementor resolves a global into the CSS var.
        $element->add_control( 'framify_ft_bg_color', $this->css( array(
            'label'     => esc_html__( 'Background colour', 'framify' ),
            'type'      => $cm::COLOR,
            'default'   => '#FFFFFF',
            'selectors' => array( $chip => '--ft-bg: {{VALUE}};' ),
            'condition' => $on + array( 'framify_ft_bg_mode' => 'fixed' ),
        ) ) );

        // The chip background's own alpha, relative to the chip; Max
        // opacity then fades the whole chip (text at full strength inside).
        $element->add_control( 'framify_ft_bg_opacity', $this->css( array(
            'label'     => esc_html__( 'Background opacity', 'framify' ),
            'type'      => $cm::SLIDER,
            'range'     => array( 'px' => array( 'min' => 0, 'max' => 1, 'step' => 0.05 ) ),
            'default'   => array( 'size' => 1 ),
            'selectors' => array( $layer => '--ft-bg-a: {{SIZE}};' ),
            'condition' => $on + array( 'framify_ft_bg_mode!' => 'none' ),
        ) ) );

        if ( class_exists( '\Elementor\Group_Control_Border' ) ) {
            $element->add_group_control( \Elementor\Group_Control_Border::get_type(), array(
                'name'           => 'framify_ft_border',
                'selector'       => $chip,
                'condition'      => $on,
                'fields_options' => array( '__all' => array( 'render_type' => 'ui' ) ),
            ) );
        }

        $element->add_responsive_control( 'framify_ft_radius', $this->css( array(
            'label'       => esc_html__( 'Border radius', 'framify' ),
            'type'        => $cm::DIMENSIONS,
            'size_units'  => array( 'px', '%', 'em' ),
            'description' => esc_html__( 'Empty = a pill when a background is on.', 'framify' ),
            'selectors'   => array( $chip => 'border-radius: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};' ),
            'condition'   => $on,
        ) ) );

        // On the text span, so the letter spans of the per-letter
        // animations inherit it.
        if ( class_exists( '\Elementor\Group_Control_Text_Shadow' ) ) {
            $element->add_group_control( \Elementor\Group_Control_Text_Shadow::get_type(), array(
                'name'           => 'framify_ft_text_shadow',
                'selector'       => $layer . ' .framify-ft__text',
                'condition'      => $on,
                'fields_options' => array( '__all' => array( 'render_type' => 'ui' ) ),
            ) );
        }

        $element->add_responsive_control( 'framify_ft_padding', $this->css( array(
            'label'       => esc_html__( 'Padding', 'framify' ),
            'type'        => $cm::DIMENSIONS,
            'size_units'  => array( 'px', 'em', '%' ),
            'description' => esc_html__( 'Empty = balanced pill padding when a background is on.', 'framify' ),
            'selectors'   => array( $chip => 'padding: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};' ),
            'condition'   => $on,
        ) ) );
    }

    /* ------------------------------------------------------------------
       Assets: filemtime-versioned like Floating Shapes. The script and
       style depend on the shapes handles: the script reuses
       window.FramifyFx, the style reuses .framify-fs-host (isolation).
    ------------------------------------------------------------------ */
    private function asset_version( $file ) {
        $path = FRAMIFY_PLUGIN_DIR . 'assets/' . $file;
        return file_exists( $path ) ? (string) filemtime( $path ) : FRAMIFY_VERSION;
    }

    public function enqueue_frontend_assets() {
        wp_enqueue_style(
            'framify-text',
            FRAMIFY_PLUGIN_URL . 'assets/framify-text.css',
            array( 'framify-shapes' ),
            $this->asset_version( 'framify-text.css' )
        );
        wp_enqueue_script(
            'framify-text',
            FRAMIFY_PLUGIN_URL . 'assets/framify-text.js',
            array( 'elementor-frontend', 'framify-shapes' ),
            $this->asset_version( 'framify-text.js' ),
            true
        );
    }
}

new Framify_Elementor_Text();
