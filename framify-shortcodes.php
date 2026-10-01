<?php
/**
 * Framify - Shortcodes
 *
 * [framify_code] and [framify_seo] put either tool on an ordinary page.
 *
 * What a visitor gets is not what an administrator gets, and that is the point.
 * The code editor writes PHP snippets that framify.php runs through eval(), so
 * an embed anyone could use would hand every visitor a shell. The analyser is
 * milder but still fetches arbitrary URLs from the server and rewrites media
 * library alt text. The live tool therefore stays behind the same nonce and
 * manage_options gate it has always had, reached through an iframe; everyone
 * else is shown a demo that has no wiring behind it at all.
 *
 * The tools render whole HTML documents and exit, so an iframe is also the only
 * way to place them without nesting one document inside another.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class Framify_Shortcodes {

    public function __construct() {
        add_shortcode( 'framify_code', array( $this, 'render_code' ) );
        add_shortcode( 'framify_seo',  array( $this, 'render_seo' ) );

        add_action( 'wp_enqueue_scripts', array( $this, 'maybe_enqueue' ) );
    }

    /**
     * Loads the embed styles when the post content carries a shortcode.
     *
     * Page builders keep their content outside post_content, so this misses
     * Elementor and Divi layouts. The shortcode callbacks enqueue as well for
     * that case - later than ideal, but it is that or nothing there.
     */
    public function maybe_enqueue() {
        $post = get_post();

        if ( ! $post instanceof WP_Post ) {
            return;
        }

        if ( has_shortcode( $post->post_content, 'framify_code' )
          || has_shortcode( $post->post_content, 'framify_seo' ) ) {
            $this->enqueue_styles();
        }
    }

    private function enqueue_styles() {
        wp_enqueue_style(
            'framify-themes-css',
            FRAMIFY_PLUGIN_URL . 'assets/framify-themes.css',
            array(),
            FRAMIFY_VERSION
        );

        wp_enqueue_style(
            'framify-embed-css',
            FRAMIFY_PLUGIN_URL . 'assets/framify-embed.css',
            array( 'framify-themes-css' ),
            FRAMIFY_VERSION
        );
    }

    public function render_code( $atts ) {
        return $this->render( 'code', $atts );
    }

    public function render_seo( $atts ) {
        return $this->render( 'seo', $atts );
    }

    /**
     * @param string $tool  'code' or 'seo'
     * @param array  $atts  Shortcode attributes.
     */
    private function render( $tool, $atts ) {
        $atts = shortcode_atts( array(
            'height' => 640,
            'url'    => home_url( '/' ),
            // Lets an administrator see the visitor's view without logging out.
            'demo'   => 'no',
        ), $atts, 'framify_' . $tool );

        $this->enqueue_styles();

        $height = max( 240, (int) $atts['height'] );
        $forced = in_array( strtolower( (string) $atts['demo'] ), array( 'yes', 'true', '1' ), true );
        $live   = current_user_can( 'manage_options' ) && ! $forced;

        $theme = framify_get_user_theme();

        if ( ! $live ) {
            return $this->demo( $tool, $theme );
        }

        return $this->live( $tool, $theme, $height, esc_url_raw( $atts['url'] ) );
    }

    /**
     * The working tool, framed.
     */
    private function live( $tool, $theme, $height, $url ) {
        $action = 'code' === $tool ? 'framify_preview' : 'framify_seo';
        $flag   = 'code' === $tool ? 'framify_preview' : 'framify_seo';

        $src = add_query_arg( array(
            $flag         => '1',
            'token'       => wp_create_nonce( $action ),
            'preview_url' => rawurlencode( $url ),
        ), home_url( '/' ) );

        // The token is per-user and expires. Serving this page from a full-page
        // cache would hand everyone one stale nonce, so opt the page out.
        if ( function_exists( 'framify_force_nocache' ) ) {
            framify_force_nocache();
        }

        $label = 'code' === $tool ? 'Framify code editor' : 'Framify SEO analyser';

        return sprintf(
            '<div class="framify-embed" data-framify-theme="%1$s">'
            . '<iframe class="framify-embed__frame" src="%2$s" style="height:%3$dpx" title="%4$s" loading="lazy"></iframe>'
            . '</div>',
            esc_attr( $theme ),
            esc_url( $src ),
            $height,
            esc_attr( $label )
        );
    }

    /**
     * A still of the tool for everyone else.
     *
     * Deliberately inert - no iframe, no endpoint, no script. It is built from
     * the same --fr-* tokens the real interface uses, so it carries the theme
     * rather than being a screenshot that goes stale the next time the palette
     * changes.
     */
    private function demo( $tool, $theme ) {
        $body = 'code' === $tool ? $this->demo_code() : $this->demo_seo();

        return sprintf(
            '<div class="framify-embed framify-embed--demo" data-framify-theme="%1$s" role="img" aria-label="%2$s">%3$s</div>',
            esc_attr( $theme ),
            esc_attr( 'code' === $tool
                ? 'A preview of the Framify code editor interface'
                : 'A preview of the Framify SEO analyser interface' ),
            $body
        );
    }

    private function demo_code() {
        return '<div class="fr-demo">'
            . '<div class="fr-demo__bar">'
                . '<span class="fr-demo__dot"></span><span class="fr-demo__dot"></span><span class="fr-demo__dot"></span>'
                . '<span class="fr-demo__title">Framify Code Editor</span>'
            . '</div>'
            . '<div class="fr-demo__tabs"><span class="is-on">CSS</span><span>jQuery</span><span>PHP</span><span>HTML</span></div>'
            . '<pre class="fr-demo__code">'
                . '<span class="fr-demo__ln">1</span><span class="t-com">/* Edits paint straight onto the page */</span>' . "\n"
                . '<span class="fr-demo__ln">2</span><span class="t-sel">.listing-card</span><span class="t-punc"> {</span>' . "\n"
                . '<span class="fr-demo__ln">3</span><span class="t-prop">  padding</span><span class="t-punc">:</span><span class="t-val"> 24px</span><span class="t-punc">;</span>' . "\n"
                . '<span class="fr-demo__ln">4</span><span class="t-prop">  border-radius</span><span class="t-punc">:</span><span class="t-val"> 12px</span><span class="t-punc">;</span>' . "\n"
                . '<span class="fr-demo__ln">5</span><span class="t-punc">}</span>'
            . '</pre>'
            . '<div class="fr-demo__foot"><span>Viewport: Full width</span><span class="fr-demo__btn">Save</span></div>'
            . '</div>';
    }

    private function demo_seo() {
        $checks = array(
            array( 'pass', 'Title',            '58 characters' ),
            array( 'pass', 'Meta description', '152 characters' ),
            array( 'warn', 'Heading structure', 'One H1, two H2s' ),
            array( 'fail', 'Alt text',         '3 images need it' ),
        );

        $rows = '';
        foreach ( $checks as $check ) {
            $rows .= sprintf(
                '<div class="fr-demo__check is-%1$s"><span class="fr-demo__mark"></span>'
                . '<span class="fr-demo__label">%2$s</span><span class="fr-demo__value">%3$s</span></div>',
                esc_attr( $check[0] ),
                esc_html( $check[1] ),
                esc_html( $check[2] )
            );
        }

        return '<div class="fr-demo">'
            . '<div class="fr-demo__bar">'
                . '<span class="fr-demo__title">Framify <strong>SEO</strong></span>'
                . '<span class="fr-demo__score">82</span>'
            . '</div>'
            . '<div class="fr-demo__checks">' . $rows . '</div>'
            . '</div>';
    }
}

new Framify_Shortcodes();
