<?php
/**
 * Framify - Gutenberg Sidebar & Widget Library
 * Include from framify.php:
 *   require_once FRAMIFY_PLUGIN_DIR . 'framify-gutenberg.php';
 *
 * File: framify-gutenberg.php
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Framify_Gutenberg {

    public function __construct() {
        add_action( 'enqueue_block_editor_assets',  array( $this, 'enqueue_gutenberg_assets' ) );
        add_action( 'init',                          array( $this, 'register_accordion_block' ) );
        add_action( 'wp_enqueue_scripts',            array( $this, 'enqueue_frontend_assets'  ) );
        add_action( 'wp_ajax_framify_get_widget_block', array( $this, 'ajax_get_widget_block' ) );
    }

    /* ------------------------------------------------------------------
       Enqueue editor-side JS + CSS
    ------------------------------------------------------------------ */
    public function enqueue_gutenberg_assets() {
        if ( ! current_user_can( 'edit_posts' ) ) return;

        // Dashicons are always loaded in the editor; make sure on frontend too
        wp_enqueue_style( 'dashicons' );

        wp_enqueue_script(
            'framify-gutenberg-plugin',
            FRAMIFY_PLUGIN_URL . 'assets/framify-gutenberg.js',
            array( 'wp-plugins', 'wp-edit-post', 'wp-element', 'wp-components',
                   'wp-blocks', 'wp-i18n', 'wp-block-editor', 'wp-data', 'wp-compose' ),
            FRAMIFY_VERSION,
            true
        );

        wp_enqueue_style(
            'framify-gutenberg-css',
            FRAMIFY_PLUGIN_URL . 'assets/framify-gutenberg.css',
            array( 'dashicons' ),
            FRAMIFY_VERSION
        );

        wp_localize_script( 'framify-gutenberg-plugin', 'framifyGutenberg', array(
            'ajax_url'   => admin_url( 'admin-ajax.php' ),
            'nonce'      => wp_create_nonce( 'framify_nonce' ),
            'plugin_url' => FRAMIFY_PLUGIN_URL,
        ) );
    }

    /* ------------------------------------------------------------------
       Enqueue dashicons on the frontend (needed for icon rendering)
    ------------------------------------------------------------------ */
    public function enqueue_frontend_assets() {
        if ( has_blocks() ) {
            wp_enqueue_style( 'dashicons' );
        }
    }

    /* ------------------------------------------------------------------
       Register block with EVERY attribute the JS editor uses
    ------------------------------------------------------------------ */
    public function register_accordion_block() {
        if ( ! function_exists( 'register_block_type' ) ) return;

        register_block_type( 'framify/accordion', array(
            'editor_script'   => 'framify-gutenberg-plugin',
            'editor_style'    => 'framify-gutenberg-css',
            'render_callback' => array( $this, 'render_accordion_block' ),
            'attributes'      => array(

                /* CONTENT */
                'items' => array(
                    'type'    => 'array',
                    'default' => array(
                        array( 'title' => 'Accordion Item 1', 'content' => 'Add your content here.', 'icon' => '', 'open' => true  ),
                        array( 'title' => 'Accordion Item 2', 'content' => 'Add your content here.', 'icon' => '', 'open' => false ),
                        array( 'title' => 'Accordion Item 3', 'content' => 'Add your content here.', 'icon' => '', 'open' => false ),
                    ),
                    'items' => array( 'type' => 'object' ),
                ),
                'allowMultiple'    => array( 'type' => 'boolean', 'default' => false ),
                'defaultOpenAll'   => array( 'type' => 'boolean', 'default' => false ),

                /* STYLE — Header */
                'headerBg'          => array( 'type' => 'string',  'default' => '#f8f9fa' ),
                'headerBgActive'    => array( 'type' => 'string',  'default' => '#667eea' ),
                'headerColor'       => array( 'type' => 'string',  'default' => '#1a1a1a' ),
                'headerColorActive' => array( 'type' => 'string',  'default' => '#ffffff' ),
                'headerTag'         => array( 'type' => 'string',  'default' => 'button'  ),
                'headerTypography'  => array(
                    'type'    => 'object',
                    'default' => array( 'fontSize' => 15, 'fontWeight' => '600', 'lineHeight' => 1.5, 'letterSpacing' => 0, 'textTransform' => 'none' ),
                ),
                'headerPadding'     => array(
                    'type'    => 'object',
                    'default' => array( 'top' => 16, 'right' => 20, 'bottom' => 16, 'left' => 20 ),
                ),

                /* STYLE — Content */
                'contentBg'          => array( 'type' => 'string',  'default' => '#ffffff' ),
                'contentColor'       => array( 'type' => 'string',  'default' => '#555555' ),
                'contentTypography'  => array(
                    'type'    => 'object',
                    'default' => array( 'fontSize' => 14, 'fontWeight' => '400', 'lineHeight' => 1.7, 'letterSpacing' => 0, 'textTransform' => 'none' ),
                ),
                'contentPadding'     => array(
                    'type'    => 'object',
                    'default' => array( 'top' => 16, 'right' => 20, 'bottom' => 16, 'left' => 20 ),
                ),

                /* STYLE — Border / Layout */
                'borderColor'    => array( 'type' => 'string',  'default' => '#e0e0e0' ),
                'borderWidth'    => array( 'type' => 'number',  'default' => 1 ),
                'borderRadius'   => array( 'type' => 'number',  'default' => 8 ),
                'accordionStyle' => array( 'type' => 'string',  'default' => 'default' ),
                'itemSpacing'    => array( 'type' => 'number',  'default' => 0 ),

                /* STYLE — Icon */
                'iconType'         => array( 'type' => 'string',  'default' => 'svg'       ),  // 'svg' | 'dashicon'
                'iconStyle'        => array( 'type' => 'string',  'default' => 'plus'      ),  // svg variant
                'iconDashicon'     => array( 'type' => 'string',  'default' => 'arrow-down-alt2' ), // dashicon slug
                'iconDashiconActive' => array( 'type' => 'string', 'default' => 'arrow-up-alt2'  ),
                'iconColor'        => array( 'type' => 'string',  'default' => '#667eea'   ),
                'iconColorActive'  => array( 'type' => 'string',  'default' => '#ffffff'   ),
                'iconSize'         => array( 'type' => 'number',  'default' => 16          ),
                'iconPosition'     => array( 'type' => 'string',  'default' => 'right'     ),

                /* ADVANCED */
                'customClass'     => array( 'type' => 'string',  'default' => '' ),
                'customId'        => array( 'type' => 'string',  'default' => '' ),
                'motionEffect'    => array( 'type' => 'string',  'default' => 'none' ),
                'cssTransitionMs' => array( 'type' => 'number',  'default' => 300 ),
                'marginBlock'     => array( 'type' => 'object',  'default' => array( 'top' => 0, 'right' => 0, 'bottom' => 0, 'left' => 0 ) ),
                'paddingBlock'    => array( 'type' => 'object',  'default' => array( 'top' => 0, 'right' => 0, 'bottom' => 0, 'left' => 0 ) ),
                'zIndex'          => array( 'type' => 'number',  'default' => 0 ),
                'hideOnDesktop'   => array( 'type' => 'boolean', 'default' => false ),
                'hideOnTablet'    => array( 'type' => 'boolean', 'default' => false ),
                'hideOnMobile'    => array( 'type' => 'boolean', 'default' => false ),
            ),
        ) );
    }

    /* ------------------------------------------------------------------
       Helper: safely get a number attribute
    ------------------------------------------------------------------ */
    private function num( $attr, $key, $default ) {
        return isset( $attr[ $key ] ) ? floatval( $attr[ $key ] ) : $default;
    }

    /* ------------------------------------------------------------------
       Helper: safely get a string attribute
    ------------------------------------------------------------------ */
    private function str( $attr, $key, $default = '' ) {
        return isset( $attr[ $key ] ) ? (string) $attr[ $key ] : $default;
    }

    /* ------------------------------------------------------------------
       Helper: safely get a typography / padding object
    ------------------------------------------------------------------ */
    private function obj( $attr, $key, $default ) {
        $v = isset( $attr[ $key ] ) && is_array( $attr[ $key ] ) ? $attr[ $key ] : array();
        return array_merge( $default, $v );
    }

    /* ------------------------------------------------------------------
       Helper: build a CSS padding string from a padding object
    ------------------------------------------------------------------ */
    private function padding_css( $pad ) {
        $t = floatval( $pad['top']    ?? 0 );
        $r = floatval( $pad['right']  ?? 0 );
        $b = floatval( $pad['bottom'] ?? 0 );
        $l = floatval( $pad['left']   ?? 0 );
        return "{$t}px {$r}px {$b}px {$l}px";
    }

    /* ------------------------------------------------------------------
       Helper: icon markup (SVG variant OR dashicon span)
    ------------------------------------------------------------------ */
    private function icon_markup( $icon_type, $icon_style, $dashicon_slug, $size, $color, $transition_ms ) {
        if ( $icon_type === 'dashicon' ) {
            $slug = sanitize_html_class( $dashicon_slug );
            return sprintf(
                '<span class="dashicons dashicons-%s framify-acc-icon" style="font-size:%dpx;width:%dpx;height:%dpx;color:%s;transition:transform %dms ease;"></span>',
                esc_attr( $slug ),
                $size, $size, $size,
                esc_attr( $color ),
                intval( $transition_ms )
            );
        }

        // SVG icons
        $paths = array(
            'plus'    => 'M8 3v10M3 8h10',
            'arrow'   => 'M4 6l4 4 4-4',
            'chevron' => 'M3 5.5l5 5 5-5',
        );
        $path = $paths[ $icon_style ] ?? $paths['plus'];
        return sprintf(
            '<svg class="framify-acc-icon" width="%1$d" height="%1$d" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="color:%2$s;transition:transform %3$dms ease;flex-shrink:0;">'
            . '<path d="%4$s" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            intval( $size ),
            esc_attr( $color ),
            intval( $transition_ms ),
            esc_attr( $path )
        );
    }

    /* ------------------------------------------------------------------
       Frontend render callback — uses ALL attributes
    ------------------------------------------------------------------ */
    public function render_accordion_block( $attr ) {

        /* ---- Read every attribute ---- */
        $items           = isset( $attr['items'] ) && is_array( $attr['items'] ) ? $attr['items'] : array();
        $allow_multiple  = ! empty( $attr['allowMultiple'] );
        $default_open_all = ! empty( $attr['defaultOpenAll'] );

        // Header
        $header_bg          = $this->str( $attr, 'headerBg',          '#f8f9fa' );
        $header_bg_active   = $this->str( $attr, 'headerBgActive',    '#667eea' );
        $header_color       = $this->str( $attr, 'headerColor',       '#1a1a1a' );
        $header_color_active = $this->str( $attr, 'headerColorActive', '#ffffff' );
        $header_tag         = in_array( $this->str( $attr, 'headerTag', 'button' ), array( 'button','h2','h3','h4','h5','p','div' ), true )
                              ? $this->str( $attr, 'headerTag', 'button' ) : 'button';
        $header_typo        = $this->obj( $attr, 'headerTypography', array( 'fontSize' => 15, 'fontWeight' => '600', 'lineHeight' => 1.5, 'letterSpacing' => 0, 'textTransform' => 'none' ) );
        $header_padding     = $this->obj( $attr, 'headerPadding',    array( 'top' => 16, 'right' => 20, 'bottom' => 16, 'left' => 20 ) );

        // Content
        $content_bg         = $this->str( $attr, 'contentBg',    '#ffffff' );
        $content_color      = $this->str( $attr, 'contentColor', '#555555' );
        $content_typo       = $this->obj( $attr, 'contentTypography', array( 'fontSize' => 14, 'fontWeight' => '400', 'lineHeight' => 1.7, 'letterSpacing' => 0, 'textTransform' => 'none' ) );
        $content_padding    = $this->obj( $attr, 'contentPadding', array( 'top' => 16, 'right' => 20, 'bottom' => 16, 'left' => 20 ) );

        // Border / Layout
        $border_color    = $this->str( $attr, 'borderColor',    '#e0e0e0' );
        $border_width    = $this->num( $attr, 'borderWidth',    1 );
        $border_radius   = $this->num( $attr, 'borderRadius',   8 );
        $accordion_style = $this->str( $attr, 'accordionStyle', 'default' );
        $item_spacing    = $this->num( $attr, 'itemSpacing',    0 );

        // Icon
        $icon_type           = $this->str( $attr, 'iconType',          'svg'             );
        $icon_style_key      = $this->str( $attr, 'iconStyle',         'plus'            );
        $icon_dashicon       = $this->str( $attr, 'iconDashicon',      'arrow-down-alt2' );
        $icon_dashicon_active = $this->str( $attr, 'iconDashiconActive', 'arrow-up-alt2' );
        $icon_color          = $this->str( $attr, 'iconColor',         '#667eea'         );
        $icon_color_active   = $this->str( $attr, 'iconColorActive',   '#ffffff'         );
        $icon_size           = $this->num( $attr, 'iconSize',          16                );
        $icon_position       = $this->str( $attr, 'iconPosition',      'right'           );

        // Advanced
        $custom_class    = sanitize_html_class( $this->str( $attr, 'customClass', '' ) );
        $custom_id       = sanitize_html_class( $this->str( $attr, 'customId',    '' ) );
        $motion_effect   = $this->str( $attr, 'motionEffect',   'none' );
        $transition_ms   = $this->num( $attr, 'cssTransitionMs', 300 );
        $margin          = $this->obj( $attr, 'marginBlock',  array( 'top' => 0, 'right' => 0, 'bottom' => 0, 'left' => 0 ) );
        $padding_block   = $this->obj( $attr, 'paddingBlock', array( 'top' => 0, 'right' => 0, 'bottom' => 0, 'left' => 0 ) );
        $z_index         = intval( $this->num( $attr, 'zIndex', 0 ) );
        $hide_desktop    = ! empty( $attr['hideOnDesktop'] );
        $hide_tablet     = ! empty( $attr['hideOnTablet']  );
        $hide_mobile     = ! empty( $attr['hideOnMobile']  );

        /* ---- Unique ID for scoping CSS ---- */
        $uid = 'frmacc-' . substr( md5( serialize( $attr ) . microtime() ), 0, 8 );

        /* ---- Build wrapper classes ---- */
        $wrapper_classes = array_filter( array(
            'framify-accordion',
            'framify-accordion--' . sanitize_html_class( $accordion_style ),
            $custom_class ?: '',
            $hide_desktop ? 'frm-hide-desktop' : '',
            $hide_tablet  ? 'frm-hide-tablet'  : '',
            $hide_mobile  ? 'frm-hide-mobile'  : '',
            $motion_effect !== 'none' ? 'frm-motion-' . sanitize_html_class( $motion_effect ) : '',
        ) );

        /* ---- Build wrapper inline style ---- */
        $wrapper_style_parts = array(
            'margin:'  . floatval( $margin['top'] ) . 'px ' . floatval( $margin['right'] ) . 'px ' . floatval( $margin['bottom'] ) . 'px ' . floatval( $margin['left'] ) . 'px',
            'padding:' . $this->padding_css( $padding_block ),
        );
        if ( $z_index > 0 ) {
            $wrapper_style_parts[] = 'z-index:' . $z_index;
        }

        /* ---- Header / Content typography shorthand CSS ---- */
        $header_typo_css = implode( ';', array(
            'font-size:'      . floatval( $header_typo['fontSize']     ?? 15  ) . 'px',
            'font-weight:'    . esc_attr( $header_typo['fontWeight']   ?? '600' ),
            'line-height:'    . floatval( $header_typo['lineHeight']   ?? 1.5 ),
            'letter-spacing:' . floatval( $header_typo['letterSpacing'] ?? 0  ) . 'px',
            'text-transform:' . esc_attr( $header_typo['textTransform'] ?? 'none' ),
        ) );

        $content_typo_css = implode( ';', array(
            'font-size:'      . floatval( $content_typo['fontSize']     ?? 14  ) . 'px',
            'font-weight:'    . esc_attr( $content_typo['fontWeight']   ?? '400' ),
            'line-height:'    . floatval( $content_typo['lineHeight']   ?? 1.7 ),
            'letter-spacing:' . floatval( $content_typo['letterSpacing'] ?? 0  ) . 'px',
            'text-transform:' . esc_attr( $content_typo['textTransform'] ?? 'none' ),
        ) );

        ob_start();
        ?>
        <div
            id="<?php echo $custom_id ? esc_attr( $custom_id ) : esc_attr( $uid ); ?>"
            data-frm-uid="<?php echo esc_attr( $uid ); ?>"
            class="<?php echo esc_attr( implode( ' ', $wrapper_classes ) ); ?>"
            data-allow-multiple="<?php echo $allow_multiple ? 'true' : 'false'; ?>"
            style="<?php echo esc_attr( implode( ';', $wrapper_style_parts ) ); ?>"
        >
            <?php foreach ( $items as $index => $item ) :
                $is_open      = $default_open_all || ( isset( $item['open'] ) && $item['open'] );
                $item_title   = isset( $item['title']   ) ? $item['title']   : '';
                $item_content = isset( $item['content'] ) ? $item['content'] : '';
                $item_icon    = isset( $item['icon']    ) ? $item['icon']    : '';

                /* Icon markup (normal vs active) */
                $icon_normal = $icon_type === 'dashicon'
                    ? $this->icon_markup( 'dashicon', '', $icon_dashicon, $icon_size, $icon_color, $transition_ms )
                    : $this->icon_markup( 'svg', $icon_style_key, '', $icon_size, $icon_color, $transition_ms );

                $icon_active = $icon_type === 'dashicon'
                    ? $this->icon_markup( 'dashicon', '', $icon_dashicon_active, $icon_size, $icon_color_active, $transition_ms )
                    : $this->icon_markup( 'svg', $icon_style_key, '', $icon_size, $icon_color_active, $transition_ms );

                /* Header element — button by default, or any heading tag */
                $h_tag           = $header_tag;
                $h_extra_attrs   = '';
                $inner_tag       = $h_tag; // for non-button headings, wrap a button inside
                $use_inner_btn   = ( $h_tag !== 'button' );

                $item_classes = 'framify-accordion__item' . ( $is_open ? ' is-open' : '' );
            ?>
            <div class="<?php echo esc_attr( $item_classes ); ?>">

                <?php if ( $use_inner_btn ) : ?>
                <<?php echo esc_attr( $h_tag ); ?> class="framify-accordion__heading" style="margin:0;padding:0;">
                    <button
                        class="framify-accordion__header"
                        aria-expanded="<?php echo $is_open ? 'true' : 'false'; ?>"
                        aria-controls="<?php echo esc_attr( $uid . '-panel-' . $index ); ?>"
                        style="
                            flex-direction: <?php echo $icon_position === 'left' ? 'row-reverse' : 'row'; ?>;
                            padding: <?php echo esc_attr( $this->padding_css( $header_padding ) ); ?>;
                            <?php echo esc_attr( $header_typo_css ); ?>;
                        "
                    >
                <?php else : ?>
                <button
                    class="framify-accordion__header"
                    aria-expanded="<?php echo $is_open ? 'true' : 'false'; ?>"
                    aria-controls="<?php echo esc_attr( $uid . '-panel-' . $index ); ?>"
                    style="
                        flex-direction: <?php echo $icon_position === 'left' ? 'row-reverse' : 'row'; ?>;
                        padding: <?php echo esc_attr( $this->padding_css( $header_padding ) ); ?>;
                        <?php echo esc_attr( $header_typo_css ); ?>;
                    "
                >
                <?php endif; ?>

                    <span class="framify-accordion__title-wrap" style="display:flex;align-items:center;gap:8px;">
                        <?php if ( $item_icon ) : ?>
                            <span class="framify-accordion__item-icon" aria-hidden="true"><?php echo esc_html( $item_icon ); ?></span>
                        <?php endif; ?>
                        <span class="framify-accordion__title"><?php echo wp_kses_post( $item_title ); ?></span>
                    </span>

                    <span class="framify-accordion__icon-wrap" aria-hidden="true">
                        <span class="frm-icon-normal" style="display:<?php echo $is_open ? 'none' : 'flex'; ?>;align-items:center;">
                            <?php echo $icon_normal; // phpcs:ignore WordPress.Security.EscapeOutput ?>
                        </span>
                        <span class="frm-icon-active" style="display:<?php echo $is_open ? 'flex' : 'none'; ?>;align-items:center;">
                            <?php echo $icon_active; // phpcs:ignore WordPress.Security.EscapeOutput ?>
                        </span>
                    </span>

                <?php if ( $use_inner_btn ) : ?>
                    </button>
                </<?php echo esc_attr( $h_tag ); ?>>
                <?php else : ?>
                </button>
                <?php endif; ?>

                <div
                    class="framify-accordion__panel-outer"
                    id="<?php echo esc_attr( $uid . '-panel-' . $index ); ?>"
                    role="region"
                    aria-labelledby="<?php echo esc_attr( $uid . '-btn-' . $index ); ?>"
                    data-open="<?php echo $is_open ? '1' : '0'; ?>"
                    style="
                        display: grid;
                        grid-template-rows: <?php echo $is_open ? '1fr' : '0fr'; ?>;
                        transition: grid-template-rows <?php echo intval( $transition_ms ); ?>ms cubic-bezier(0.4,0,0.2,1);
                    "
                >
                    <div class="framify-accordion__panel" style="
                        overflow: hidden;
                        background: <?php echo esc_attr( $content_bg ); ?>;
                        color: <?php echo esc_attr( $content_color ); ?>;
                        <?php echo esc_attr( $content_typo_css ); ?>;
                    ">
                        <div class="framify-accordion__content" style="padding:<?php echo esc_attr( $this->padding_css( $content_padding ) ); ?>;">
                            <?php echo wp_kses_post( $item_content ); ?>
                        </div>
                    </div>
                </div>

            </div>
            <?php endforeach; ?>
        </div>

        <!-- Framify Accordion: scoped styles -->
        <style>
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] {
            <?php if ( $accordion_style !== 'bordered' && $accordion_style !== 'shadow' ) : ?>
            border: <?php echo intval($border_width); ?>px solid <?php echo esc_attr($border_color); ?>;
            border-radius: <?php echo intval($border_radius); ?>px;
            overflow: hidden;
            <?php else : ?>
            border: none;
            background: transparent;
            <?php endif; ?>
        }

        /* joined default: item separators */
        [data-frm-uid="<?php echo esc_attr($uid); ?>"].framify-accordion--default .framify-accordion__item + .framify-accordion__item,
        [data-frm-uid="<?php echo esc_attr($uid); ?>"].framify-accordion--minimal  .framify-accordion__item + .framify-accordion__item {
            border-top: <?php echo intval($border_width); ?>px solid <?php echo esc_attr($border_color); ?>;
        }

        /* bordered / shadow: each item is its own card */
        [data-frm-uid="<?php echo esc_attr($uid); ?>"].framify-accordion--bordered .framify-accordion__item,
        [data-frm-uid="<?php echo esc_attr($uid); ?>"].framify-accordion--shadow   .framify-accordion__item {
            border: <?php echo intval($border_width); ?>px solid <?php echo esc_attr($border_color); ?>;
            border-radius: <?php echo intval($border_radius); ?>px;
            overflow: hidden;
            margin-bottom: <?php echo intval($item_spacing); ?>px;
        }

        [data-frm-uid="<?php echo esc_attr($uid); ?>"].framify-accordion--shadow .framify-accordion__item {
            box-shadow: 0 2px 14px rgba(0,0,0,0.07);
        }

        /* default / minimal item spacing */
        [data-frm-uid="<?php echo esc_attr($uid); ?>"].framify-accordion--default .framify-accordion__item,
        [data-frm-uid="<?php echo esc_attr($uid); ?>"].framify-accordion--minimal  .framify-accordion__item {
            margin-bottom: <?php echo intval($item_spacing); ?>px;
        }

        /* minimal: no outer border, transparent header */
        [data-frm-uid="<?php echo esc_attr($uid); ?>"].framify-accordion--minimal {
            border: none !important;
        }
        [data-frm-uid="<?php echo esc_attr($uid); ?>"].framify-accordion--minimal .framify-accordion__header {
            background: transparent !important;
            border-bottom: <?php echo intval($border_width); ?>px solid <?php echo esc_attr($border_color); ?> !important;
            color: <?php echo esc_attr($header_color); ?> !important;
        }

        /* header default colour — driven by CSS only, not inline */
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] .framify-accordion__header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            border: none;
            cursor: pointer;
            text-align: left;
            gap: 8px;
            background: <?php echo esc_attr($header_bg); ?>;
            color: <?php echo esc_attr($header_color); ?>;
            transition: background <?php echo intval($transition_ms); ?>ms ease,
                        color      <?php echo intval($transition_ms); ?>ms ease;
        }

        /* active header — only when parent item has .is-open */
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] .framify-accordion__item.is-open > .framify-accordion__header,
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] .framify-accordion__item.is-open .framify-accordion__heading .framify-accordion__header {
            background: <?php echo esc_attr($header_bg_active); ?>;
            color: <?php echo esc_attr($header_color_active); ?>;
        }

        /* heading wrapper */
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] .framify-accordion__heading .framify-accordion__header {
            width: 100%;
        }

        /* panel — grid-template-rows animation (smooth, no max-height hack) */
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] .framify-accordion__panel-outer {
            display: grid;
            transition: grid-template-rows <?php echo intval($transition_ms); ?>ms cubic-bezier(0.4,0,0.2,1);
        }
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] .framify-accordion__panel-outer[data-open="0"] {
            grid-template-rows: 0fr;
        }
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] .framify-accordion__panel-outer[data-open="1"] {
            grid-template-rows: 1fr;
        }
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] .framify-accordion__panel {
            overflow: hidden;
        }

        /* SVG icon rotate (for plus/arrow/chevron) */
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] .framify-accordion__item.is-open .frm-icon-normal .framify-acc-icon {
            transform: rotate(45deg);
        }

        /* responsive visibility */
        <?php if ( $hide_desktop ) : ?>
        @media (min-width: 1025px) { [data-frm-uid="<?php echo esc_attr($uid); ?>"] { display: none !important; } }
        <?php endif; ?>
        <?php if ( $hide_tablet ) : ?>
        @media (min-width: 768px) and (max-width: 1024px) { [data-frm-uid="<?php echo esc_attr($uid); ?>"] { display: none !important; } }
        <?php endif; ?>
        <?php if ( $hide_mobile ) : ?>
        @media (max-width: 767px) { [data-frm-uid="<?php echo esc_attr($uid); ?>"] { display: none !important; } }
        <?php endif; ?>

        /* motion entrance */
        <?php if ( $motion_effect !== 'none' ) : ?>
        @keyframes frm-fade    { from { opacity:0 }              to { opacity:1 } }
        @keyframes frm-slideUp { from { opacity:0;transform:translateY(24px) } to { opacity:1;transform:none } }
        @keyframes frm-slideDown { from { opacity:0;transform:translateY(-24px) } to { opacity:1;transform:none } }
        @keyframes frm-zoomIn  { from { opacity:0;transform:scale(0.92) } to { opacity:1;transform:none } }
        [data-frm-uid="<?php echo esc_attr($uid); ?>"] {
            animation: frm-<?php echo esc_attr($motion_effect); ?> 0.5s ease both;
        }
        <?php endif; ?>
        </style>

        <!-- Framify Accordion: JS -->
        <script>
        (function() {
            var uid  = '<?php echo esc_js($uid); ?>';
            var wrap = document.querySelector('[data-frm-uid="' + uid + '"]');
            if (!wrap) return;

            var allowMultiple = wrap.dataset.allowMultiple === 'true';

            function openItem(item) {
                var btn   = item.querySelector('.framify-accordion__header');
                var panel = document.getElementById(btn.getAttribute('aria-controls'));
                if (!panel) return;
                item.classList.add('is-open');
                btn.setAttribute('aria-expanded', 'true');
                panel.setAttribute('data-open', '1');
                panel.style.gridTemplateRows = '1fr';
                var ni = item.querySelector('.frm-icon-normal');
                var ai = item.querySelector('.frm-icon-active');
                if (ni) ni.style.display = 'none';
                if (ai) ai.style.display = 'flex';
            }

            function closeItem(item) {
                var btn   = item.querySelector('.framify-accordion__header');
                var panel = document.getElementById(btn.getAttribute('aria-controls'));
                if (!panel) return;
                item.classList.remove('is-open');
                btn.setAttribute('aria-expanded', 'false');
                panel.setAttribute('data-open', '0');
                panel.style.gridTemplateRows = '0fr';
                var ni = item.querySelector('.frm-icon-normal');
                var ai = item.querySelector('.frm-icon-active');
                if (ni) ni.style.display = 'flex';
                if (ai) ai.style.display = 'none';
            }

            wrap.querySelectorAll('.framify-accordion__header').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var item = btn.closest('.framify-accordion__item');
                    if (!item) return;
                    var isOpen = item.classList.contains('is-open');

                    if (!allowMultiple) {
                        wrap.querySelectorAll('.framify-accordion__item.is-open').forEach(function(other) {
                            if (other !== item) closeItem(other);
                        });
                    }

                    isOpen ? closeItem(item) : openItem(item);
                });
            });
        })();
        </script>
        <?php
        return ob_get_clean();
    }

    /* ------------------------------------------------------------------
       AJAX helper
    ------------------------------------------------------------------ */
    public function ajax_get_widget_block() {
        check_ajax_referer( 'framify_nonce', 'nonce' );
        $widget = sanitize_text_field( $_POST['widget'] ?? '' );
        $blocks = array( 'accordion' => '<!-- wp:framify/accordion /-->' );
        isset( $blocks[ $widget ] )
            ? wp_send_json_success( array( 'block' => $blocks[ $widget ] ) )
            : wp_send_json_error( 'Widget not found' );
    }
}

new Framify_Gutenberg();