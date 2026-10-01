<?php
/**
 * Framify SEO Analyzer
 * Handles the SEO endpoint, AJAX analysis, and page render.
 * Auto-loaded from framify.php
 */
if ( ! defined( 'ABSPATH' ) ) exit;

class Framify_SEO {

    public function __construct() {
        add_action( 'init',              array( $this, 'register_seo_endpoint' ) );
        // Priority 1: the buffer has to wrap the whole response.
        add_action( 'template_redirect', array( $this, 'start_alt_filter' ), 1 );
        add_action( 'template_redirect', array( $this, 'handle_seo_page'       ) );
        add_action( 'wp_ajax_framify_seo_analyse',      array( $this, 'ajax_seo_analyse'     ) );
        add_action( 'wp_ajax_framify_seo_fix_alt',      array( $this, 'ajax_fix_alt'         ) );
        add_action( 'wp_ajax_framify_seo_fix_alt_bulk', array( $this, 'ajax_fix_alt_bulk'    ) );
        add_action( 'wp_ajax_framify_seo_save_schema',  array( $this, 'ajax_save_schema'     ) );
    }

    /* ------------------------------------------------------------------
       Endpoint registration
    ------------------------------------------------------------------ */
    public function register_seo_endpoint() {
        if ( isset( $_GET['framify_seo'] ) && $_GET['framify_seo'] === '1' ) {
            add_filter( 'show_admin_bar', '__return_false' );
        }
    }

    public function handle_seo_page() {
        if ( ! isset( $_GET['framify_seo'] ) || $_GET['framify_seo'] !== '1' ) return;
        if ( ! isset( $_GET['token'] ) || ! wp_verify_nonce( $_GET['token'], 'framify_seo' ) ) wp_die( 'Invalid token' );
        if ( ! current_user_can( 'manage_options' ) ) wp_die( 'Unauthorized' );
        $this->render_seo_page();
        exit;
    }

    /* ------------------------------------------------------------------
       AJAX: fetch URL + analyse all SEO signals
    ------------------------------------------------------------------ */
    public function ajax_seo_analyse() {
        check_ajax_referer( 'framify_nonce', 'nonce' );
        if ( ! current_user_can( 'manage_options' ) ) wp_send_json_error( 'Unauthorized' );

        $url = isset( $_POST['url'] ) ? esc_url_raw( wp_unslash( $_POST['url'] ) ) : home_url( '/' );

        /* The browser can send the page as it currently stands in the preview
           frame, after its scripts have run. That is the only way to see markup
           that does not exist in the server's response - infinite scroll, a
           "load more" button, anything rendered client-side.

           The request below still happens either way: status, HTTPS and the
           response headers are properties of the response, not of the DOM, and
           dropping them would make the two modes score differently for reasons
           that have nothing to do with the page. Only the source of the markup
           changes. */
        $posted_html = isset( $_POST['html'] ) ? wp_unslash( $_POST['html'] ) : '';
        $rendered    = ( trim( $posted_html ) !== '' );

        $device = isset( $_POST['device'] ) ? sanitize_key( $_POST['device'] ) : 'desktop';

        if ( ! in_array( $device, array( 'desktop', 'tablet', 'mobile' ), true ) ) {
            $device = 'desktop';
        }

        $response = wp_remote_get( $url, array(
            'timeout'   => 15,
            'sslverify' => false,
            'headers'   => array( 'User-Agent' => $this->user_agent_for( $device ) ),
        ) );

        if ( is_wp_error( $response ) ) {
            wp_send_json_error( 'Fetch failed: ' . $response->get_error_message() );
        }

        $html    = $rendered ? $posted_html : wp_remote_retrieve_body( $response );
        $code    = wp_remote_retrieve_response_code( $response );
        $headers = wp_remote_retrieve_headers( $response );

        // Parse DOM
        $dom = new DOMDocument();
        libxml_use_internal_errors( true );
        // DOMDocument reads its input as ISO-8859-1 unless the markup says
        // otherwise, so anything above ASCII has to arrive pre-escaped or every
        // accent, CJK character and emoji comes back mangled - in titles, alt
        // text and hrefs alike. mb_convert_encoding(..., 'HTML-ENTITIES', ...)
        // did that until PHP 8.2 deprecated the encoding; this is its documented
        // replacement and parses identically.
        $dom->loadHTML( mb_encode_numericentity( $html, array( 0x80, 0x10FFFF, 0, 0x1FFFFF ), 'UTF-8' ) );
        libxml_clear_errors();
        $xp = new DOMXPath( $dom );

        // Title
        $title_node = $xp->query( '//title' );
        $title      = $title_node->length ? trim( $title_node->item(0)->textContent ) : '';

        // Meta description
        $meta_desc = '';
        foreach ( $xp->query( '//meta[@name="description"]/@content' ) as $n ) $meta_desc = trim( $n->nodeValue );

        // Meta robots
        $meta_robots = '';
        foreach ( $xp->query( '//meta[@name="robots"]/@content' ) as $n ) $meta_robots = trim( $n->nodeValue );

        // Canonical
        $canonical = '';
        foreach ( $xp->query( '//link[@rel="canonical"]/@href' ) as $n ) $canonical = trim( $n->nodeValue );

        // OG / Twitter
        $og = array();
        foreach ( $xp->query( '//meta[@property or @name]' ) as $n ) {
            $prop = $n->getAttribute('property') ?: $n->getAttribute('name');
            if ( strpos( $prop, 'og:' ) === 0 || strpos( $prop, 'twitter:' ) === 0 ) {
                $og[ $prop ] = trim( $n->getAttribute('content') );
            }
        }

        // H1s
        $h1s = array();
        foreach ( $xp->query( '//h1' ) as $n ) $h1s[] = trim( $n->textContent );

        // All headings in order
        $headings = array();
        foreach ( $xp->query( '//*[self::h1 or self::h2 or self::h3 or self::h4 or self::h5 or self::h6]' ) as $n ) {
            $headings[] = array(
                'tag'  => strtoupper( $n->nodeName ),
                'text' => trim( $n->textContent ),
                'len'  => mb_strlen( trim( $n->textContent ) ),
            );
        }

        // Images
        $img_total = 0; $img_no_alt = array(); $img_empty_alt = array();
        foreach ( $xp->query( '//img' ) as $n ) {
            $img_total++;
            $src = $this->image_src( $n );
            if ( ! $n->hasAttribute('alt') )       $img_no_alt[]    = $src;
            elseif ( trim($n->getAttribute('alt')) === '' ) $img_empty_alt[] = $src;
        }

        // Links — collect full details
        $int_links_data = array(); $ext_links_data = array(); $nofollow = 0;
        $host = wp_parse_url( home_url(), PHP_URL_HOST );
        foreach ( $xp->query( '//a[@href]' ) as $n ) {
            $href = trim( $n->getAttribute('href') );
            $text = trim( $n->textContent );
            $rel  = strtolower( $n->getAttribute('rel') );
            if ( empty($href) || $href === '#' ) continue;
            if ( strpos( $rel, 'nofollow' ) !== false ) $nofollow++;
            $link_host = wp_parse_url( $href, PHP_URL_HOST );
            $entry = array( 'href' => $href, 'text' => mb_substr($text,0,60), 'nofollow' => strpos($rel,'nofollow')!==false );
            if ( $link_host && $link_host !== $host ) $ext_links_data[] = $entry;
            else $int_links_data[] = $entry;
        }
        // Deduplicate by href
        $seen = array();
        $int_links_data = array_values( array_filter( $int_links_data, function($l) use (&$seen){ if(in_array($l['href'],$seen)) return false; $seen[]=$l['href']; return true; } ) );
        $seen = array();
        $ext_links_data = array_values( array_filter( $ext_links_data, function($l) use (&$seen){ if(in_array($l['href'],$seen)) return false; $seen[]=$l['href']; return true; } ) );

        // Word count
        $body = $xp->query( '//body' );
        $body_text = $body->length ? preg_replace('/\s+/', ' ', strip_tags( $body->item(0)->textContent ) ) : '';
        $word_count = str_word_count( trim( $body_text ) );

        // Structured data
        $schema = array();
        foreach ( $xp->query( '//script[@type="application/ld+json"]' ) as $n ) {
            $j = json_decode( $n->textContent, true );
            if ( is_array( $j ) ) {
                $schema = array_merge( $schema, $this->collect_schema_types( $j ) );
            }
        }
        foreach ( $xp->query( '//*[@itemtype]' ) as $n ) $schema[] = $n->getAttribute('itemtype');

        // Viewport meta
        $has_viewport = false;
        foreach ( $xp->query( '//meta[@name="viewport"]' ) as $n ) $has_viewport = true;

        // HTTPS: judge the URL we actually ended up on. wp_remote_get follows
        // redirects, so a site that correctly sends http -> https would other-
        // wise score "HTTP 200" and "not using HTTPS" at the same time.
        $final_url = $this->final_url( $response, $url );
        $is_https  = ( stripos( $final_url, 'https://' ) === 0 );

        // Content-type / X-Robots
        $content_type = isset( $headers['content-type'] ) ? $headers['content-type'] : '';
        $x_robots     = isset( $headers['x-robots-tag'] )  ? $headers['x-robots-tag']  : '';

        wp_send_json_success( array(
            'mode'              => $rendered ? 'rendered' : 'served',
            'device'            => $device,
            'url'               => $url,
            'final_url'         => $final_url,
            'http_code'         => (int) $code,
            'is_https'          => $is_https,
            'content_type'      => $content_type,
            'x_robots'          => $x_robots,
            'title'             => $title,
            'title_len'         => mb_strlen( $title ),
            'meta_desc'         => $meta_desc,
            'meta_desc_len'     => mb_strlen( $meta_desc ),
            'meta_robots'       => $meta_robots,
            'canonical'         => $canonical,
            'og'                => $og,
            'h1s'               => $h1s,
            'h1_count'          => count( $h1s ),
            'headings'          => $headings,
            'img_total'         => $img_total,
            'img_no_alt'        => $img_no_alt,
            'img_empty_alt'     => $img_empty_alt,
            'int_links'         => count( $int_links_data ),
            'ext_links'         => count( $ext_links_data ),
            'nofollow'          => $nofollow,
            'int_links_data'    => $int_links_data,
            'ext_links_data'    => $ext_links_data,
            'word_count'        => $word_count,
            'schema'            => array_unique( $schema ),
            'has_viewport'      => $has_viewport,
        ) );
    }

    /**
     * Every @type in a JSON-LD block.
     *
     * Yoast and Rank Math - between them most WordPress sites - wrap everything
     * in {"@context":..,"@graph":[..]}, and a plain array of nodes is also
     * common. Reading @type off the root object alone misses both, which is why
     * pages with perfectly good schema were reported as having none.
     *
     * @param array $node Decoded JSON-LD, at any depth.
     * @return array Flat list of type strings.
     */
    private function collect_schema_types( $node ) {
        $types = array();

        if ( ! is_array( $node ) ) {
            return $types;
        }

        if ( isset( $node['@type'] ) ) {
            // @type is itself allowed to be a list.
            foreach ( (array) $node['@type'] as $type ) {
                if ( is_string( $type ) ) $types[] = $type;
            }
        }

        if ( isset( $node['@graph'] ) && is_array( $node['@graph'] ) ) {
            foreach ( $node['@graph'] as $child ) {
                $types = array_merge( $types, $this->collect_schema_types( $child ) );
            }
        }

        // A root-level array of nodes: [{...},{...}]
        if ( ! isset( $node['@type'] ) && ! isset( $node['@graph'] ) ) {
            foreach ( $node as $child ) {
                if ( is_array( $child ) ) {
                    $types = array_merge( $types, $this->collect_schema_types( $child ) );
                }
            }
        }

        return $types;
    }

    /**
     * The URL the fetch actually landed on, following any redirects.
     */
    private function final_url( $response, $requested_url ) {
        if ( isset( $response['http_response'] ) && is_object( $response['http_response'] ) ) {
            $wp_response = $response['http_response'];

            if ( method_exists( $wp_response, 'get_response_object' ) ) {
                $raw = $wp_response->get_response_object();
                if ( isset( $raw->url ) && $raw->url ) {
                    return $raw->url;
                }
            }
        }

        return $requested_url;
    }

    /* ------------------------------------------------------------------
       AJAX: Fix alt text on a media library image
    ------------------------------------------------------------------ */
    public function ajax_fix_alt() {
        check_ajax_referer( 'framify_nonce', 'nonce' );

        // Matches the capability gating the analyser page itself. `upload_files`
        // let any Author rewrite alt text on attachments they do not own,
        // reachable directly because AJAX hooks bypass the page's token gate.
        if ( ! current_user_can( 'manage_options' ) ) wp_send_json_error( 'Unauthorized' );

        $src = isset( $_POST['src'] ) ? esc_url_raw( wp_unslash( $_POST['src'] ) ) : '';
        $alt = isset( $_POST['alt'] ) ? sanitize_text_field( wp_unslash( $_POST['alt'] ) ) : '';

        if ( ! $src ) wp_send_json_error( 'No image URL provided.' );

        $attachment_id = $this->resolve_attachment_id( $src );

        if ( $attachment_id ) {
            update_post_meta( $attachment_id, '_wp_attachment_image_alt', $alt );
        } else {
            // Hotlinked from somewhere else, so there is no attachment to hang
            // this on. Framify keeps it and fills it in on the way out instead.
            $this->remember_alt( $src, $alt );
        }

        $this->flush_alt_lookup();

        wp_send_json_success( array(
            'id'      => $attachment_id,
            'alt'     => $alt,
            'stored'  => $attachment_id ? 'library' : 'framify',
        ) );
    }

    /**
     * The User-Agent to fetch a page as, for a given device.
     *
     * A responsive site returns the same HTML either way and nothing changes.
     * A site with a separate mobile theme, or one doing dynamic serving, returns
     * different markup entirely - and the mobile version is the one Google
     * indexes. Resizing the preview cannot reveal that, because the server
     * fetch has no viewport; only the User-Agent can.
     *
     * These identify a real device so the usual mobile detection fires
     * (wp_is_mobile() looks for the Android and Mobile tokens), while still
     * naming Framify so the request is recognisable in an access log. They
     * deliberately do not claim to be Googlebot.
     */
    private function user_agent_for( $device ) {
        switch ( $device ) {
            case 'mobile':
                return 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) '
                     . 'Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; FramifySEOBot/1.0)';

            case 'tablet':
                return 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
                     . 'Version/17.0 Mobile/15E148 Safari/604.1 (compatible; FramifySEOBot/1.0)';

            default:
                return 'FramifySEOBot/1.0';
        }
    }

    /**
     * The real URL of an image, looking past a lazy-loader's placeholder.
     *
     * A lazy image carries an inline data: URI in src until it scrolls into
     * view, with the true file in one of the data-* attributes. Recording the
     * placeholder would give a row nothing to match against the media library,
     * so prefer the first attribute holding an actual URL.
     */
    private function image_src( $node ) {
        foreach ( array( 'src', 'data-src', 'data-lazy-src', 'data-original' ) as $attr ) {
            $value = trim( $node->getAttribute( $attr ) );

            if ( $value !== '' && stripos( $value, 'data:' ) !== 0 ) {
                return $value;
            }
        }

        return trim( $node->getAttribute( 'src' ) );
    }

    /**
     * The media library ID behind a rendered <img src>, or 0.
     *
     * Shared by the single and bulk fixers so the two can never disagree about
     * which images are editable.
     */
    private function resolve_attachment_id( $src ) {
        // Strip query strings for lookup
        $clean_src = preg_replace('/\?.*$/', '', $src );

        $attachment_id = attachment_url_to_postid( $clean_src );

        // Try without size suffix (e.g. image-300x200.jpg → image.jpg)
        if ( ! $attachment_id ) {
            $clean_src_no_size = preg_replace('/-\d+x\d+(\.[a-z]+)$/i', '$1', $clean_src );
            $attachment_id = attachment_url_to_postid( $clean_src_no_size );
        }

        return $attachment_id;
    }

    /* ------------------------------------------------------------------
       AJAX: Fix alt text on many images at once
    ------------------------------------------------------------------ */
    public function ajax_fix_alt_bulk() {
        check_ajax_referer( 'framify_nonce', 'nonce' );
        if ( ! current_user_can( 'manage_options' ) ) wp_send_json_error( 'Unauthorized' );

        $items = json_decode( isset( $_POST['items'] ) ? wp_unslash( $_POST['items'] ) : '', true );

        if ( ! is_array( $items ) || empty( $items ) ) {
            wp_send_json_error( 'No images sent.' );
        }

        // The client already sends this in chunks. The cap is a backstop so one
        // request cannot sit in attachment_url_to_postid long enough to time out.
        if ( count( $items ) > 50 ) {
            $items = array_slice( $items, 0, 50 );
        }

        // Results come back as positions in the array that was sent, not as
        // URLs: esc_url_raw can normalise a src, and a caller matching on the
        // returned string would then read a saved image as a failure.
        $saved  = array();
        $failed = array();

        foreach ( $items as $i => $item ) {
            $src = isset( $item['src'] ) ? esc_url_raw( $item['src'] ) : '';
            $alt = isset( $item['alt'] ) ? sanitize_text_field( $item['alt'] ) : '';

            if ( ! $src || $alt === '' ) {
                $failed[] = (int) $i;
                continue;
            }

            $attachment_id = $this->resolve_attachment_id( $src );

            if ( $attachment_id ) {
                update_post_meta( $attachment_id, '_wp_attachment_image_alt', $alt );
            } else {
                // No attachment to hang it on - Framify keeps this one itself
                // and fills it in as the page is sent.
                $this->remember_alt( $src, $alt );
            }

            $saved[] = (int) $i;
        }

        $this->flush_alt_lookup();

        wp_send_json_success( array( 'saved' => $saved, 'failed' => $failed ) );
    }

    /* ------------------------------------------------------------------
       AJAX: Save structured data JSON-LD via Framify codes table
    ------------------------------------------------------------------ */
    public function ajax_save_schema() {
        check_ajax_referer( 'framify_nonce', 'nonce' );
        if ( ! current_user_can( 'manage_options' ) ) wp_send_json_error( 'Unauthorized' );

        $page_url  = isset( $_POST['page_url']  ) ? esc_url_raw( wp_unslash( $_POST['page_url'] ) ) : '';
        $json_ld   = isset( $_POST['json_ld']   ) ? wp_unslash( $_POST['json_ld'] ) : '';
        $schema_type = isset( $_POST['schema_type'] ) ? sanitize_text_field( $_POST['schema_type'] ) : 'Custom';

        if ( ! $json_ld ) wp_send_json_error( 'No JSON-LD provided.' );

        // Validate JSON
        $decoded = json_decode( $json_ld );
        if ( json_last_error() !== JSON_ERROR_NONE ) {
            wp_send_json_error( 'Invalid JSON: ' . json_last_error_msg() );
        }

        // Re-encode from the decoded value rather than trusting the submitted
        // string. This block is injected into the live front-end <head> for
        // every visitor, and a "</script>" inside any string value would break
        // out of the tag. JSON_HEX_TAG escapes < and > to < / >,
        // which JSON-LD parsers read identically.
        $json_ld = wp_json_encode( $decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG );

        if ( false === $json_ld ) {
            wp_send_json_error( 'Could not re-encode the JSON-LD safely.' );
        }

        $code_content = '<script type="application/ld+json">' . "\n" . $json_ld . "\n" . '</script>';

        global $wpdb;
        $table = $wpdb->prefix . 'framify_codes';

        $url_rule = $this->schema_url_rule( $page_url );

        $title = 'Schema: ' . $schema_type . ( $page_url ? ' — ' . wp_parse_url( $page_url, PHP_URL_PATH ) : '' );

        $inserted = $wpdb->insert( $table, array(
            'title'         => $title,
            'code_type'     => 'html',
            'code_content'  => $code_content,
            'where_on_page' => 'header',
            'where_in_site' => 'frontend',
            'url_rules'     => $url_rule,
            'is_active'     => 1,
            'author_id'     => get_current_user_id(),
        ) );

        if ( ! $inserted ) wp_send_json_error( 'Database error: ' . $wpdb->last_error );

        // Every other write path announces itself; this one used not to, so a
        // saved schema stayed invisible behind a page cache until something
        // else happened to purge it.
        do_action( 'framify_code_changed', $wpdb->insert_id );

        wp_send_json_success( array( 'id' => $wpdb->insert_id, 'title' => $title ) );
    }

    /* ------------------------------------------------------------------
       ALT TEXT AT OUTPUT

       Saving alt text to the media library only reaches the page for images
       WordPress itself renders. Divi's et_pb_image keeps alt in its own module
       settings, and a plugin printing its own tag keeps whatever it hardcoded -
       community-business-directory.php emits alt="" as a literal. In both cases
       the value is stored correctly and never seen, which is why re-analysing
       still reports every image as missing alt.

       These fill an empty alt as the page is sent: from the media library where
       the image is in it, and from a small Framify-kept map where it is not, so
       an image hotlinked from another site has somewhere to live. One query per
       page, cached in a transient, then plain array lookups.
    ------------------------------------------------------------------ */

    const ALT_MAP_OPTION   = 'framify_alt_overrides';
    const ALT_CACHE_KEY    = 'framify_alt_lookup';

    public function alt_fill_enabled() {
        return (bool) get_option( 'framify_fill_alt', 1 );
    }

    /**
     * Opens the buffer that fills alt attributes on the way out.
     *
     * Priority 1 so the buffer wraps the whole response, but Framify's own
     * framed pages are skipped: they exit inside template_redirect, and the
     * analyser reading its own filled output would be circular.
     */
    public function start_alt_filter() {
        if ( is_admin() || is_feed() || is_embed() ) {
            return;
        }
        if ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) {
            return;
        }
        if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
            return;
        }
        if ( isset( $_GET['framify_seo'] ) || isset( $_GET['framify_preview'] ) ) {
            return;
        }
        if ( ! $this->alt_fill_enabled() ) {
            return;
        }

        ob_start( array( $this, 'fill_alt_attributes' ) );
    }

    /**
     * Fills every empty or absent alt attribute it has a value for.
     *
     * An alt that already says something is never touched - this only supplies
     * what is missing.
     */
    public function fill_alt_attributes( $html ) {
        if ( ! is_string( $html ) || stripos( $html, '<img' ) === false ) {
            return $html;
        }

        $lookup = $this->alt_lookup();

        if ( empty( $lookup ) ) {
            return $html;
        }

        return preg_replace_callback( '/<img\s[^>]*>/i', function ( $match ) use ( $lookup ) {
            $tag = $match[0];

            // A real alt wins. Only an empty one, or none at all, is filled.
            if ( preg_match( '/\salt\s*=\s*(["\'])(.*?)\1/is', $tag, $existing ) && trim( $existing[2] ) !== '' ) {
                return $tag;
            }

            if ( ! preg_match( '/\ssrc\s*=\s*(["\'])(.*?)\1/is', $tag, $src ) ) {
                return $tag;
            }

            $key = $this->alt_key( $src[2] );

            if ( $key === '' || ! isset( $lookup[ $key ] ) ) {
                return $tag;
            }

            // $ and \ are meaningful in a preg replacement, and alt text is
            // arbitrary user input.
            $value       = ' alt="' . esc_attr( $lookup[ $key ] ) . '"';
            $replacement = str_replace( array( '\\', '$' ), array( '\\\\', '\\$' ), $value );

            if ( preg_match( '/\salt\s*=\s*(["\']).*?\1/is', $tag ) ) {
                return preg_replace( '/\salt\s*=\s*(["\']).*?\1/is', $replacement, $tag, 1 );
            }

            // A bare `alt` with no value at all, which is how Divi prints it.
            if ( preg_match( '/\salt(?=[\s\/>])/i', $tag ) ) {
                return preg_replace( '/\salt(?=[\s\/>])/i', $replacement, $tag, 1 );
            }

            return preg_replace( '/^<img/i', '<img' . $replacement, $tag, 1 );
        }, $html );
    }

    /**
     * Image path => alt text, for everything on the site that has one.
     *
     * Built in a single query rather than per image: a directory page can carry
     * hundreds of images, and resolving each one through
     * attachment_url_to_postid() at render time would be a query apiece.
     */
    public function alt_lookup() {
        $cached = get_transient( self::ALT_CACHE_KEY );

        if ( is_array( $cached ) ) {
            return $cached;
        }

        global $wpdb;

        $rows = $wpdb->get_results(
            "SELECT f.meta_value AS file, a.meta_value AS alt
             FROM {$wpdb->postmeta} a
             INNER JOIN {$wpdb->postmeta} f
                     ON f.post_id = a.post_id AND f.meta_key = '_wp_attached_file'
             WHERE a.meta_key = '_wp_attachment_image_alt'
               AND a.meta_value <> ''"
        );

        $lookup = array();

        foreach ( $rows as $row ) {
            // _wp_attached_file is already uploads-relative, which is the key
            // alt_key() produces for an image served from this site.
            $key = strtolower( ltrim( $row->file, '/' ) );

            // Collapse a scaled original onto the name the page actually uses.
            $key = preg_replace( '/-scaled(\.[a-z0-9]+)$/i', '$1', $key );

            $lookup[ $key ] = $row->alt;
        }

        // Images that live on another domain have no attachment to hang meta
        // on, so Framify keeps their alt text itself.
        $overrides = get_option( self::ALT_MAP_OPTION, array() );

        if ( is_array( $overrides ) ) {
            $lookup = array_merge( $lookup, $overrides );
        }

        set_transient( self::ALT_CACHE_KEY, $lookup, DAY_IN_SECONDS );

        return $lookup;
    }

    public function flush_alt_lookup() {
        delete_transient( self::ALT_CACHE_KEY );
    }

    /**
     * The lookup key for an image URL.
     *
     * Own-site images key on their uploads-relative path, so the map survives a
     * domain or protocol change and matches _wp_attached_file directly.
     * Anything else keeps its host, or two sites' /photo-123.jpg would collide.
     *
     * Resized variants and scaled originals collapse onto the same key:
     * a page can request -480x720.jpg while the library stores the full file.
     */
    private function alt_key( $url ) {
        $url = trim( (string) $url );

        if ( $url === '' || stripos( $url, 'data:' ) === 0 ) {
            return '';
        }

        $url   = strtok( $url, '?' );
        $parts = wp_parse_url( $url );
        $path  = isset( $parts['path'] ) ? $parts['path'] : '';

        if ( $path === '' ) {
            return '';
        }

        $path = preg_replace( '/-\d+x\d+(\.[a-z0-9]+)$/i', '$1', $path );
        $path = preg_replace( '/-scaled(\.[a-z0-9]+)$/i', '$1', $path );
        $path = strtolower( $path );

        $host = isset( $parts['host'] ) ? strtolower( $parts['host'] ) : '';
        $home = strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );

        if ( $host === '' || $host === $home ) {
            $uploads = wp_upload_dir();
            $base    = strtolower( (string) wp_parse_url( $uploads['baseurl'], PHP_URL_PATH ) );

            if ( $base !== '' && strpos( $path, $base . '/' ) === 0 ) {
                return ltrim( substr( $path, strlen( $base ) ), '/' );
            }

            return ltrim( $path, '/' );
        }

        return $host . $path;
    }

    /**
     * Remembers alt text for an image Framify could not attach to the library.
     */
    private function remember_alt( $src, $alt ) {
        $key = $this->alt_key( $src );

        if ( $key === '' ) {
            return;
        }

        $map = get_option( self::ALT_MAP_OPTION, array() );

        if ( ! is_array( $map ) ) {
            $map = array();
        }

        $map[ $key ] = $alt;

        update_option( self::ALT_MAP_OPTION, $map, false );
    }

    /**
     * The site's indexable URLs, chosen the way core's sitemap chooses them.
     *
     * Deliberately not read from wp-sitemap.xml. Fetching a sitemap index and
     * then each child sitemap means several HTTP requests back into this same
     * site from inside a request, which is the worker deadlock this plugin
     * already had to fix once. It would also return nothing on a site with
     * "Discourage search engines" set, because core disables sitemaps entirely
     * when blog_public is 0 - true of most staging and local installs.
     *
     * The selection rules are core's own: public post types minus attachments,
     * passed through `wp_sitemaps_post_types` so anything that customises the
     * sitemap customises this list too, published and not password-protected.
     *
     * @param int $limit Most URLs to return.
     * @return array{urls: array<int, array{url: string, label: string}>, capped: bool}
     */
    private function sitemap_urls( $limit = 1000 ) {
        $types = get_post_types( array( 'public' => true ), 'objects' );
        unset( $types['attachment'] );

        /** This filter is core's; honouring it keeps the two lists in step. */
        $types = apply_filters( 'wp_sitemaps_post_types', $types );

        // The front page first. It is the most common thing to audit, and on a
        // static front page it is also the one URL that might not be reachable
        // by walking post types at all.
        $urls = array( array( 'url' => home_url( '/' ), 'label' => 'Front page' ) );

        if ( empty( $types ) ) {
            return array( 'urls' => $urls, 'capped' => false );
        }

        $query = new WP_Query( array(
            'post_type'              => array_keys( $types ),
            'post_status'            => 'publish',
            'has_password'           => false,
            'posts_per_page'         => $limit + 1,   // one over, so a cap is detectable
            'orderby'                => 'title',
            'order'                  => 'ASC',
            'ignore_sticky_posts'    => true,
            'no_found_rows'          => true,
            'update_post_meta_cache' => false,
            'update_post_term_cache' => false,
        ) );

        $capped = count( $query->posts ) > $limit;
        $posts  = $capped ? array_slice( $query->posts, 0, $limit ) : $query->posts;

        $front_id = (int) get_option( 'page_on_front' );
        $items    = array();

        foreach ( $posts as $post ) {
            if ( $front_id && (int) $post->ID === $front_id ) {
                continue;   // already at the top of the list
            }

            $title = $post->post_title !== '' ? $post->post_title : '(no title)';
            $name  = isset( $types[ $post->post_type ] )
                ? $types[ $post->post_type ]->labels->singular_name
                : $post->post_type;

            $items[] = array(
                // Pages, then posts, then everything else. On a directory site
                // the handful of real pages would otherwise be lost among
                // hundreds of listings in the unfiltered list.
                'rank'  => 'page' === $post->post_type ? 0 : ( 'post' === $post->post_type ? 1 : 2 ),
                'title' => $title,
                'url'   => get_permalink( $post ),
                'label' => $title . '  ·  ' . $name,
            );
        }

        usort( $items, function ( $a, $b ) {
            if ( $a['rank'] !== $b['rank'] ) {
                return $a['rank'] - $b['rank'];
            }
            return strcasecmp( $a['title'], $b['title'] );
        } );

        foreach ( $items as $item ) {
            $urls[] = array( 'url' => $item['url'], 'label' => $item['label'] );
        }

        return array( 'urls' => $urls, 'capped' => $capped );
    }

    /**
     * The URL rule scoping a schema snippet to the one page it describes.
     *
     * `contains <path>` is not a page match, which is what this used to build.
     * The front page's path is "/" and every URL on the site contains it, so a
     * front-page schema was printed site-wide; "/about" likewise matched
     * "/about-us-2024". A page URL with no path at all parsed to null, and
     * strpos( $url, '' ) returns 0, so that matched everything too.
     *
     * Two rules, because should_display_code() passes a snippet when any rule
     * matches: the URL exactly, or the same URL carrying a query string. That
     * second rule is what keeps the schema present for a visitor arriving with
     * tracking parameters, while still excluding child pages - "/about/team/"
     * neither equals "/about/" nor begins with "/about/?".
     *
     * @param string $page_url The page the schema describes.
     * @return string JSON rule set, or '' to leave the snippet unscoped.
     */
    private function schema_url_rule( $page_url ) {
        if ( ! $page_url ) {
            return '';
        }

        $path = wp_parse_url( $page_url, PHP_URL_PATH );
        $path = is_string( $path ) && $path !== '' ? $path : '/';

        // The front page gets the rule built for it. Matching it by URL is the
        // exact trap described above, and is_front_page() is also right when
        // the front page is a static page rather than the posts index.
        if ( $path === '/' ) {
            return wp_json_encode( array( array( 'type' => 'first-page', 'value' => '' ) ) );
        }

        // Built the same way should_display_code() builds the URL it compares
        // against, so the two agree even on a subdirectory install.
        $full = home_url( $path );

        return wp_json_encode( array(
            array( 'type' => 'equal-to',    'value' => $full ),
            array( 'type' => 'begins-with', 'value' => $full . '?' ),
        ) );
    }

    /* ------------------------------------------------------------------
       Render the SEO page shell (JS handles all rendering)
    ------------------------------------------------------------------ */
    public function render_seo_page() {
        $preview_url = isset( $_GET['preview_url'] ) ? esc_url_raw( urldecode( $_GET['preview_url'] ) ) : home_url( '/' );
        $nonce       = wp_create_nonce( 'framify_nonce' );
        $ajax_url    = admin_url( 'admin-ajax.php' );
        $themes_css  = FRAMIFY_PLUGIN_URL . 'assets/framify-themes.css?v=' . FRAMIFY_VERSION;
        $css_url     = FRAMIFY_PLUGIN_URL . 'assets/framify-seo.css?v=' . FRAMIFY_VERSION;
        $dash_css    = includes_url( 'css/dashicons.min.css' );

        // Same theme the code editor uses, from the same user meta. Rendered onto
        // <html> below so the analyser paints correctly on the first frame.
        $framify_themes = framify_ui_themes();
        $framify_theme  = framify_get_user_theme();

        $page_list  = $this->sitemap_urls();
        $list_note  = $page_list['capped']
            ? 'Showing the first ' . number_format_i18n( count( $page_list['urls'] ) ) . ' URLs on this site. Paste any other address directly.'
            : '';
        ?>
<!DOCTYPE html>
<html <?php language_attributes(); ?> data-framify-theme="<?php echo esc_attr($framify_theme); ?>">
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>SEO Analyzer — Framify</title>
<link rel="stylesheet" href="<?php echo esc_url($dash_css); ?>">
<!-- Theme tokens first, then the analyser chrome that consumes them. -->
<link rel="stylesheet" href="<?php echo esc_url($themes_css); ?>">
<link rel="stylesheet" href="<?php echo esc_url($css_url); ?>">
<?php framify_print_frame_guard(); ?>
</head>
<body class="fseo-body">

<div id="fseo-app">

    <!-- TOP BAR -->
    <header class="fseo-bar">
        <div class="fseo-bar-brand">
            <span class="dashicons dashicons-chart-line"></span>
            <span>Framify <strong>SEO</strong></span>
        </div>
        <div class="fseo-bar-url">
            <input id="fseo-url" type="url" list="fseo-page-list"
                   value="<?php echo esc_attr($preview_url); ?>"
                   placeholder="Type or pick a page…"
                   <?php if ( $list_note ) : ?>title="<?php echo esc_attr( $list_note ); ?>"<?php endif; ?>>
            <button id="fseo-run" class="fseo-btn">
                <span class="dashicons dashicons-search"></span> Analyse
            </button>
            <button id="fseo-run-rendered" class="fseo-btn fseo-btn--ghost"
                    title="Audit the page as it stands right now, including anything added by Load more or infinite scroll">
                <span class="dashicons dashicons-visibility"></span><span class="fseo-btn-label">On screen</span>
            </button>
        </div>
        <div class="fseo-bar-score">
            <div id="fseo-badge" class="fseo-badge">
                <svg viewBox="0 0 44 44" class="fseo-ring">
                    <circle class="fseo-ring-bg" cx="22" cy="22" r="18"/>
                    <circle class="fseo-ring-fg" cx="22" cy="22" r="18" id="fseo-ring-fg"/>
                </svg>
                <span id="fseo-score-num">—</span>
            </div>
            <span class="fseo-score-label">SEO Score</span>
        </div>
        <div class="fseo-bar-tools">
            <button type="button" class="settings-btn" id="open-settings-modal" title="Appearance" aria-label="Change the theme">
                <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" stroke="none"/></svg>
            </button>
        </div>
    </header>

    <!-- LAYOUT -->
    <div class="fseo-layout">

        <!-- LEFT: iframe -->
        <div class="fseo-preview">
            <div class="fseo-preview-bar">
                <span class="dashicons dashicons-visibility"></span> Preview
                <span id="fseo-http-pill" class="fseo-pill"></span>
                <span id="fseo-https-pill" class="fseo-pill"></span>
                <div class="fseo-devices" id="fseo-devices" role="group" aria-label="Preview width">
                    <button type="button" class="fseo-device is-on" data-device="desktop"
                            aria-pressed="true" title="Desktop — full width">
                        <span class="dashicons dashicons-desktop"></span>
                    </button>
                    <button type="button" class="fseo-device" data-device="tablet"
                            aria-pressed="false" title="Tablet — 768px, fetched as an iPad">
                        <span class="dashicons dashicons-tablet"></span>
                    </button>
                    <button type="button" class="fseo-device" data-device="mobile"
                            aria-pressed="false" title="Mobile — 412px, the width Google renders at, fetched as a phone">
                        <span class="dashicons dashicons-smartphone"></span>
                    </button>
                </div>
            </div>
            <iframe id="fseo-iframe" src="<?php echo esc_url($preview_url); ?>"></iframe>
        </div>

        <!-- RIGHT: results -->
        <div class="fseo-panel">

            <div id="fseo-loading" class="fseo-loading" hidden>
                <div class="fseo-spinner"></div><span id="fseo-loading-msg">Analysing…</span>
            </div>

            <div id="fseo-empty" class="fseo-placeholder">
                <span class="dashicons dashicons-chart-line"></span>
                <p>Click <strong>Analyse</strong> to audit this page.</p>
            </div>

            <div id="fseo-stale" class="fseo-stale" hidden>
                <span class="dashicons dashicons-update"></span>
                <p>You moved to <strong id="fseo-stale-url"></strong>. The results below are for the previous page.</p>
                <button type="button" id="fseo-stale-run" class="fseo-btn">Analyse this page</button>
            </div>

            <div id="fseo-results" hidden>

                <!-- Which reading produced these numbers. Never decorative:
                     the two modes can legitimately disagree. -->
                <div id="fseo-mode" class="fseo-mode"></div>

                <!-- Score breakdown -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-awards"></span> Score Breakdown</div>
                    <div id="r-score"></div>
                </div>

                <!-- Title & Meta -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-tag"></span> Title & Meta</div>
                    <div id="r-meta"></div>
                </div>

                <!-- Headings -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-editor-paragraph"></span> Headings</div>
                    <div id="r-headings"></div>
                </div>

                <!-- Heading tree -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-list-view"></span> Heading Structure</div>
                    <div id="r-tree"></div>
                </div>

                <!-- Images -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-format-image"></span> Images</div>
                    <div id="r-images"></div>
                </div>

                <!-- Links -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-admin-links"></span> Links</div>
                    <div id="r-links"></div>
                </div>

                <!-- Content -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-text"></span> Content</div>
                    <div id="r-content"></div>
                </div>

                <!-- Open Graph -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-share"></span> Open Graph / Social</div>
                    <div id="r-og"></div>
                </div>

                <!-- Structured data -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-networking"></span> Structured Data</div>
                    <div id="r-schema"></div>
                </div>

                <!-- Technical -->
                <div class="fseo-section">
                    <div class="fseo-section-title"><span class="dashicons dashicons-admin-tools"></span> Technical</div>
                    <div id="r-tech"></div>
                </div>

            </div><!-- /results -->
        </div>
    </div>
</div>

<!-- Pages the URL field can autocomplete. A datalist is display:none, so it
     sits out here rather than inside the bar: several hundred options would
     otherwise bury the markup of the controls around it. -->
<datalist id="fseo-page-list">
<?php foreach ( $page_list['urls'] as $fseo_entry ) : ?>
    <option value="<?php echo esc_url( $fseo_entry['url'] ); ?>"><?php echo esc_html( $fseo_entry['label'] ); ?></option>
<?php endforeach; ?>
</datalist>

<!-- Appearance: the same picker the code editor uses, on the same user meta. -->
<div id="framify-settings-modal" aria-hidden="true">
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="framify-theme-title">
        <div class="modal-header">
            <h2 id="framify-theme-title">Appearance</h2>
            <button type="button" class="modal-close" id="close-settings-modal" aria-label="Close">&times;</button>
        </div>

        <div class="modal-body">
            <span class="fr-eyebrow">Theme</span>
            <p class="fr-theme-intro">Sets the analyser and the code editor together. Your choice is saved to your account, so it follows you to every site you work on.</p>

            <div class="fr-theme-grid" role="radiogroup" aria-labelledby="framify-theme-title" id="framify-theme-grid">
                <?php foreach ( $framify_themes as $framify_slug => $framify_meta ): ?>
                <button type="button"
                        class="fr-theme"
                        role="radio"
                        data-theme="<?php echo esc_attr($framify_slug); ?>"
                        data-preview-theme="<?php echo esc_attr($framify_slug); ?>"
                        aria-checked="<?php echo $framify_slug === $framify_theme ? 'true' : 'false'; ?>"
                        tabindex="<?php echo $framify_slug === $framify_theme ? '0' : '-1'; ?>">
                    <span class="fr-theme__bar" aria-hidden="true">
                        <span class="fr-theme__dot"></span>
                        <span class="fr-theme__dot"></span>
                        <span class="fr-theme__dot"></span>
                    </span>
                    <span class="fr-theme__tabs" aria-hidden="true">
                        <span class="is-on">CSS</span><span>jQuery</span><span>PHP</span>
                    </span>
                    <span class="fr-theme__code" aria-hidden="true"><span class="fr-theme__ln">1</span><span class="t-com">/* preview */</span>
<span class="fr-theme__ln">2</span><span class="t-sel">.card</span><span class="t-punc"> {</span>
<span class="fr-theme__ln">3</span><span class="t-prop">  padding</span><span class="t-punc">:</span><span class="t-val"> 24px</span><span class="t-punc">;</span>
<span class="fr-theme__ln">4</span><span class="t-punc">}</span></span>
                    <span class="fr-theme__meta">
                        <span>
                            <span class="fr-theme__name"><?php echo esc_html($framify_meta['label']); ?></span>
                            <span class="fr-theme__blurb"><?php echo esc_html($framify_meta['blurb']); ?></span>
                        </span>
                        <span class="fr-theme__check" aria-hidden="true">
                            <svg viewBox="0 0 12 12"><path d="M2.5 6.2 4.8 8.6 9.5 3.6"/></svg>
                        </span>
                    </span>
                </button>
                <?php endforeach; ?>
            </div>
        </div>

        <div class="modal-footer">
            <span class="fr-theme-status" id="framify-theme-status" role="status">Saved to your account</span>
            <button type="button" class="btn-cancel" id="settings-done">Done</button>
        </div>
    </div>
</div>

<script>
(function(){
'use strict';
var AJAX  = <?php echo json_encode( $ajax_url ); ?>;
var NONCE = <?php echo json_encode( $nonce ); ?>;

var $url     = document.getElementById('fseo-url');
var $run     = document.getElementById('fseo-run');
var $runRendered = document.getElementById('fseo-run-rendered');
var $devices = document.getElementById('fseo-devices');
var $iframe  = document.getElementById('fseo-iframe');
var $loading = document.getElementById('fseo-loading');
var $empty   = document.getElementById('fseo-empty');
var $results = document.getElementById('fseo-results');
var $stale    = document.getElementById('fseo-stale');
var $staleUrl = document.getElementById('fseo-stale-url');
var $staleRun = document.getElementById('fseo-stale-run');

// The page the visible results describe, and the one a running audit is for.
var analysedUrl = '';
var pendingUrl  = '';

/* Preview width, and the device an audit is run as.

   The width only reaches the on-screen audit: at 412px srcset picks different
   image files, and anything that adds or removes content by width changes the
   DOM. The served audit has no viewport at all, so the device rides along as a
   User-Agent instead - the only thing that can make a site with a separate
   mobile theme hand back its mobile HTML, which is what Google indexes. */
var DEVICE_WIDTHS = { desktop: '', tablet: '768px', mobile: '412px' };
var device = 'desktop';

function setDevice(name){
    if(!DEVICE_WIDTHS.hasOwnProperty(name)) return;

    device = name;

    var preview = document.querySelector('.fseo-preview');
    var width   = DEVICE_WIDTHS[name];

    if(preview){
        preview.style.setProperty('--fseo-frame-width', width || '100%');
        preview.classList.toggle('is-narrow', width !== '');
    }

    $devices.querySelectorAll('.fseo-device').forEach(function(btn){
        var on = btn.getAttribute('data-device') === name;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

if($devices){
    $devices.addEventListener('click', function(e){
        var btn = e.target && e.target.closest ? e.target.closest('.fseo-device') : null;
        if(btn) setDevice(btn.getAttribute('data-device'));
    });
}

/* One analysis at a time.

   The server handler audits this page by asking WordPress for it over HTTP,
   from inside a request WordPress is already serving. That needs a second PHP
   worker. A local WordPress typically runs two, so two overlapping runs take
   both workers and then each waits for a third that can never free up: every
   inner request sits unanswered until cURL gives up at 15 seconds, and the
   panel shows a spinner the whole time.

   Guarding entry is the fix. Re-analysing is still fine - just not on top of
   a run already in flight. */
var running    = false;
var slowTimer  = null;
var $loadingMsg = document.getElementById('fseo-loading-msg');

function setBusy(on){
    running = on;
    $run.disabled = on;
    if($runRendered) $runRendered.disabled = on;
    if($staleRun) $staleRun.disabled = on;

    if(slowTimer){ clearTimeout(slowTimer); slowTimer = null; }

    if(on){
        $loadingMsg.textContent = 'Analysing…';
        // Say something true before the silence gets suspicious. A healthy run
        // on this site takes about two seconds.
        slowTimer = setTimeout(function(){
            $loadingMsg.textContent = 'Still working. Large pages take a few seconds.';
        }, 6000);
    }
}

/* Turns a transport failure into something the reader can act on. */
function fetchErrorMessage(raw){
    var text = String(raw === undefined || raw === null ? '' : raw);
    if(/timed out|cURL error 28/i.test(text)){
        return 'The page did not respond within 15 seconds. Only one analysis can run at a time — if another was already going, let it finish and try again. A page that is slow to load on its own will do this too.';
    }
    return text || 'The request failed.';
}

$run.addEventListener('click', run);
$runRendered.addEventListener('click', function(){ startRun(true); });
$staleRun.addEventListener('click', run);
$url.addEventListener('keydown', function(e){ if(e.key==='Enter') run(); });
setTimeout(run, 400);

/* Ignore a trailing slash and any #fragment when comparing two page URLs. */
function samePage(a, b){
    function norm(u){ return String(u).replace(/#.*$/, '').replace(/\/+$/, ''); }
    return norm(a) === norm(b);
}

function shortPath(u){
    try { var p = new URL(u); return p.pathname + p.search; } catch(e){ return u; }
}

/*
 * Follow the preview as you click around inside it. The iframe is same-origin
 * so its location is readable; an external link throws on access, and we then
 * leave the URL box alone rather than guessing.
 */
$iframe.addEventListener('load', function(){
    var here;
    try { here = $iframe.contentWindow.location.href; } catch(e){ return; }
    if (!here || here === 'about:blank') return;

    $url.value = here;

    // A load caused by run() itself is not a user navigation.
    if (pendingUrl && samePage(here, pendingUrl)) { $stale.hidden = true; return; }

    var showingOtherPage = analysedUrl && !samePage(here, analysedUrl);
    $staleUrl.textContent = shortPath(here);
    $stale.hidden = !(showingOtherPage && !$results.hidden);
});

/* Ceiling on what we will post back. Generous for a page, but a runaway DOM
   should fail with a sentence rather than a rejected request: the stock PHP
   post_max_size is 8M and the failure there is silent and baffling. */
var MAX_HTML = 6 * 1024 * 1024;

/* The preview frame's document, or null when the browser will not let us read
   it. That happens only when the preview has been pointed at another origin -
   the one case the on-screen audit genuinely cannot serve. */
function previewDocument(){
    try {
        var doc = $iframe.contentDocument || $iframe.contentWindow.document;
        return (doc && doc.documentElement) ? doc : null;
    } catch(e){
        return null;
    }
}

/* Scrolls the preview end to end so lazy images swap their placeholder for the
   real file, then returns to the top.

   Without this, every image below the fold still carries a data: URI in src,
   which matches nothing in the media library - so they would be counted as
   missing alt text and then be unfixable. */
function loadLazyImages(done){
    var win = $iframe.contentWindow;
    var doc = previewDocument();
    if(!win || !doc){ done(); return; }

    var step   = Math.max((win.innerHeight || 600) * 0.9, 400);
    var height = doc.documentElement.scrollHeight;
    var y      = 0;
    var steps  = 0;
    var MAX_STEPS = 60;  // even a very long page finishes in about eight seconds

    (function next(){
        if(y >= height || steps >= MAX_STEPS){
            win.scrollTo(0, 0);
            setTimeout(done, 250);
            return;
        }
        win.scrollTo(0, y);
        y += step;
        steps++;
        // Re-measure: loading content as we go makes the page taller.
        height = doc.documentElement.scrollHeight;
        setTimeout(next, 120);
    })();
}

function showFailure(message){
    $loading.hidden = true;
    pendingUrl = '';
    setBusy(false);
    $empty.innerHTML = '<span class="dashicons dashicons-warning"></span><p>'+esc(message)+'</p>';
    $empty.hidden = false;
}

function run(){ startRun(false); }

function startRun(useRendered){
    if(running) return;
    var url = $url.value.trim();
    if(!url) return;

    if(useRendered){
        if(!previewDocument()){
            $loading.hidden = true;
            $results.hidden = true;
            $empty.innerHTML = '<span class="dashicons dashicons-warning"></span><p>'
                + esc('The preview is showing a different site, so Framify cannot read it. Point the preview at a page on this site and try again.')
                + '</p>';
            $empty.hidden = false;
            return;
        }

        // Audit the page that is actually on screen, not whatever the field
        // says. The two drift apart the moment you click a link inside the
        // preview, and reading one page's DOM under another page's URL would
        // report headers and content that never belonged together.
        var showing = '';
        try { showing = $iframe.contentWindow.location.href; } catch(e){}
        if(showing){
            url = showing;
            $url.value = url;
        }
    }

    setBusy(true);
    pendingUrl = url;
    $stale.hidden = true;
    $loading.hidden = false;
    $results.hidden = true;
    $empty.hidden   = true;

    if(!useRendered){
        // The preview is only a picture, and loading it competes for the same
        // two PHP workers the audit needs. The handler fetches this site over
        // HTTP from inside a request, so it holds one worker while waiting on a
        // second; add a frame load on top and one click wants three at once.
        // Refresh the picture after the audit has let go of the pool.
        send(url, '', true);
        return;
    }

    // Deliberately no reload here: reloading would discard the extra posts that
    // are the entire reason for reading the frame instead of fetching the page.
    $loadingMsg.textContent = 'Loading every image…';

    loadLazyImages(function(){
        var doc  = previewDocument();
        var html = doc ? doc.documentElement.outerHTML : '';

        if(!html){
            showFailure('Could not read the preview. Reload it and try again.');
            return;
        }

        if(html.length > MAX_HTML){
            showFailure('This page is about ' + Math.round(html.length / 1048576)
                + ' MB once rendered, which is too large to send back. Use Analyse instead.');
            return;
        }

        $loadingMsg.textContent = 'Analysing…';
        send(url, html);
    });
}

/* Points the preview at the page that was audited, now that the audit has
   finished with the worker pool. No-op when the frame is already there.

   Never called for an on-screen audit: reloading would throw away the very
   content that mode exists to measure. */
function syncPreview(target){
    var at = '';
    try { at = $iframe.contentWindow.location.href; } catch(e){}
    if(!at || !samePage(at, target)) $iframe.src = target;
}

function send(url, html, syncAfter){
    var fd = new FormData();
    fd.append('action','framify_seo_analyse');
    fd.append('nonce', NONCE);
    fd.append('url',   url);
    fd.append('device', device);
    if(html) fd.append('html', html);

    fetch(AJAX,{method:'POST',body:fd})
        .then(function(r){return r.json();})
        .then(function(res){
            $loading.hidden = true;
            pendingUrl = '';
            setBusy(false);
            if(res.success){
                analysedUrl = res.data.final_url || url;
                $stale.hidden = true;
                render(res.data);
                $results.hidden = false;
            }
            else{ $empty.innerHTML='<span class="dashicons dashicons-warning"></span><p>'+esc(fetchErrorMessage(res.data))+'</p>'; $empty.hidden=false; }

            // After the results, not before: the frame load is the third
            // demand on a two-worker pool. Follow the URL the audit actually
            // landed on so a redirect does not read as a stale preview.
            if(syncAfter) syncPreview(res.success ? (analysedUrl || url) : url);
        })
        .catch(function(){
            $loading.hidden=true;
            pendingUrl='';
            setBusy(false);
            $empty.innerHTML='<span class="dashicons dashicons-warning"></span><p>'+esc(fetchErrorMessage('The request failed before it reached WordPress.'))+'</p>';
            $empty.hidden=false;
            if(syncAfter) syncPreview(url);
        });
}

/* ===== AJAX HELPERS ===== */
function doAjax(action, extra, cb){
    var fd = new FormData();
    fd.append('action', action);
    fd.append('nonce', NONCE);
    Object.keys(extra).forEach(function(k){ fd.append(k, extra[k]); });
    fetch(AJAX,{method:'POST',body:fd})
        .then(function(r){return r.json();})
        .then(cb)
        .catch(function(){ cb({success:false,data:'Request failed'}); });
}

/* ===== SCORING ===== */
function score(d){
    var items=[],earned=0,total=0;
    function chk(label,pts,status,msg){
        total+=pts;
        var e = status==='pass'?pts:status==='warn'?Math.round(pts/2):0;
        earned+=e;
        items.push({label:label,pts:pts,earned:e,status:status,msg:msg});
    }
    var tl=d.title_len, ml=d.meta_desc_len;
    chk('Page Title',10, tl>=50&&tl<=60?'pass':tl>0?'warn':'fail', tl===0?'No title tag!':'Title is '+tl+' chars — ideal 50–60.');
    chk('Meta Description',10, ml>=140&&ml<=160?'pass':ml>0?'warn':'fail', ml===0?'No meta description!':'Meta description is '+ml+' chars — ideal 140–160.');
    chk('Single H1',15, d.h1_count===1?'pass':'fail', d.h1_count===0?'No H1 found.':d.h1_count===1?'H1: "'+d.h1s[0]+'"':'Multiple H1s ('+d.h1_count+') — use exactly one.');
    var hl=d.h1_count>0?d.h1s[0].length:0;
    chk('H1 Length',5, d.h1_count===0?'fail':hl>=20&&hl<=70?'pass':'warn', d.h1_count===0?'No H1.':'H1 is '+hl+' chars — ideal 20–70.');
    // Missing and empty alt are different problems. alt="" is the correct
    // markup for a decorative image, so say which one we actually found
    // instead of calling them all "missing".
    var noAlt=d.img_no_alt.length, emptyAlt=d.img_empty_alt.length, needsAlt=noAlt+emptyAlt;
    var altMsg;
    if(needsAlt===0){ altMsg='All '+d.img_total+' images have alt text.'; }
    else if(noAlt&&emptyAlt){ altMsg=noAlt+' image(s) have no alt attribute, '+emptyAlt+' have an empty one.'; }
    else if(noAlt){ altMsg=noAlt+' image(s) have no alt attribute.'; }
    else { altMsg=emptyAlt+' image(s) have an empty alt — fine if decorative, otherwise describe them.'; }
    chk('Alt Text',10, needsAlt===0?'pass':(noAlt===0?'warn':'fail'), altMsg);
    chk('Canonical',5, d.canonical?'pass':'fail', d.canonical?'Canonical set.':'No canonical tag.');
    chk('HTTPS',5, d.is_https?'pass':'fail', d.is_https?'Page served over HTTPS.':'Not using HTTPS!');
    chk('Viewport',5, d.has_viewport?'pass':'fail', d.has_viewport?'Viewport meta found.':'No viewport meta tag.');
    chk('Word Count',10, d.word_count>=300?'pass':d.word_count>=150?'warn':'fail', d.word_count+' words'+(d.word_count>=300?' — good.':(d.word_count>=150?' — aim for 300+.':' — thin content!')));
    chk('Open Graph',10, d.og['og:title']&&d.og['og:description']&&d.og['og:image']?'pass':d.og['og:title']?'warn':'fail', 'OG title/description/image '+(d.og['og:title']&&d.og['og:description']&&d.og['og:image']?'all set.':'incomplete.'));
    chk('Structured Data',10, d.schema.length>0?'pass':'fail', d.schema.length>0?'Schema: '+d.schema.join(', '):'No structured data found.');
    chk('Internal Links',5, d.int_links>=3?'pass':d.int_links>=1?'warn':'fail', d.int_links+' internal link(s).');
    chk('HTTP Status',5, d.http_code===200?'pass':'fail', 'HTTP '+d.http_code);
    return {pct: total>0?Math.round(earned/total*100):0, items:items};
}

/* ===== RENDER ===== */
function render(d){
    var sc=score(d);
    renderMode(d.mode, d.device);
    renderBadge(sc.pct);
    renderPills(d);
    renderScoreItems(sc.items);
    renderMeta(d);
    renderHeadings(d);
    renderTree(d);
    renderImages(d);
    renderLinks(d);
    renderContent(d);
    renderOG(d);
    renderSchema(d);
    renderTech(d);
}

function renderBadge(pct){
    var num=document.getElementById('fseo-score-num');
    var fill=document.getElementById('fseo-ring-fg');
    var badge=document.getElementById('fseo-badge');
    num.textContent=pct;
    badge.className='fseo-badge '+(pct>=80?'is-good':pct>=50?'is-ok':'is-bad');
    var circ=2*Math.PI*18;
    fill.style.strokeDasharray=circ;
    fill.style.strokeDashoffset=circ-(circ*pct/100);
    fill.style.transition='stroke-dashoffset 0.9s ease';
}

function renderPills(d){
    var hp=document.getElementById('fseo-http-pill');
    var sp=document.getElementById('fseo-https-pill');
    hp.textContent='HTTP '+d.http_code; hp.className='fseo-pill '+(d.http_code===200?'is-good':'is-bad');
    sp.textContent=d.is_https?'HTTPS ✓':'HTTP ✗'; sp.className='fseo-pill '+(d.is_https?'is-good':'is-bad');
}

function renderScoreItems(items){
    document.getElementById('r-score').innerHTML=items.map(function(it){
        return '<div class="fseo-check fseo-check--'+it.status+'">'
            +'<span class="fseo-check-icon dashicons dashicons-'+(it.status==='pass'?'yes':'warning')+'"></span>'
            +'<div class="fseo-check-body"><strong>'+esc(it.label)+'</strong><span>'+esc(it.msg)+'</span></div>'
            +'<span class="fseo-check-pts">'+it.earned+'/'+it.pts+'</span></div>';
    }).join('');
}

/* Says which reading produced the numbers below, because the two can disagree
   and the difference is itself worth knowing: anything the served HTML lacks
   is invisible to a crawler that does not run scripts. */
function renderMode(mode, dev){
    var el = document.getElementById('fseo-mode');
    if(!el) return;

    var width = { tablet: 'tablet', mobile: 'mobile' }[dev] || '';
    var asWho = { tablet: 'a tablet', mobile: 'a phone' }[dev] || '';

    if(mode === 'rendered'){
        el.className = 'fseo-mode is-rendered';
        el.innerHTML = '<span class="dashicons dashicons-visibility"></span>'
            + '<span>Read from the page on screen'
            + (width ? ' at ' + width + ' width' : '')
            + ', after its scripts ran.</span>';
    } else {
        el.className = 'fseo-mode';
        el.innerHTML = '<span class="dashicons dashicons-search"></span>'
            + '<span>Read from the server’s response'
            + (asWho ? ', requested as ' + asWho : '')
            + ' — what a crawler sees before running scripts.</span>';
    }
}

function row(label,val,status,note){
    var s=status?'<span class="fseo-pill is-'+status[0]+'">'+esc(status[1])+'</span>':'';
    var n=note?'<span class="fseo-row-note">'+esc(note)+'</span>':'';
    // Compared against empty rather than truthiness: a legitimate count of 0
    // is falsy, and used to render as "not set".
    var shown=(val===undefined||val===null||val==='')?'<em>not set</em>':esc(val);
    return '<div class="fseo-row"><span class="fseo-row-label">'+esc(label)+'</span>'
          +'<span class="fseo-row-val">'+shown+'</span>'+s+n+'</div>';
}

function renderMeta(d){
    var tl=d.title_len,ml=d.meta_desc_len;
    document.getElementById('r-meta').innerHTML=
        row('Title',d.title,tl>=50&&tl<=60?['good','✓']:tl>0?['ok','~']:['bad','✗'],tl+' chars (50–60 ideal)')
       +row('Meta Desc',d.meta_desc,ml>=140&&ml<=160?['good','✓']:ml>0?['ok','~']:['bad','✗'],ml+' chars (140–160 ideal)')
       +row('Canonical',d.canonical||null,d.canonical?['good','✓']:['bad','✗'])
       +row('Meta Robots',d.meta_robots||'(default: index, follow)',['good','ℹ']);
}

function renderHeadings(d){
    var html=row('H1 Count',d.h1_count,d.h1_count===1?['good','✓']:['bad','✗']);
    d.h1s.forEach(function(h,i){
        var l=h.length;
        html+=row('H1 #'+(i+1),h,l>=20&&l<=70?['good','✓']:['ok','~'],l+' chars (20–70 ideal)');
    });
    var longs=d.headings.filter(function(h){return h.len>70;});
    if(longs.length){
        html+='<div class="fseo-sub-label">⚠ '+longs.length+' heading(s) over 70 chars</div>';
        longs.forEach(function(h){ html+=row(h.tag,h.text.substring(0,80)+(h.text.length>80?'…':''),['ok','~'],h.len+' chars'); });
    }
    document.getElementById('r-headings').innerHTML=html;
}

function renderTree(d){
    if(!d.headings.length){ document.getElementById('r-tree').innerHTML='<div class="fseo-empty-msg">No headings found.</div>'; return; }
    document.getElementById('r-tree').innerHTML='<div class="fseo-tree">'+d.headings.map(function(h){
        var lvl=parseInt(h.tag[1]);
        return '<div class="fseo-tree-row" style="padding-left:'+((lvl-1)*16)+'px">'
           +'<span class="fseo-tree-tag fseo-tree-'+h.tag.toLowerCase()+'">'+h.tag+'</span>'
           +'<span class="fseo-tree-text">'+esc(h.text.substring(0,90))+(h.text.length>90?'…':'')+'</span>'
           +'<span class="fseo-tree-len'+(h.len>70?' is-long':'')+'">'+h.len+'</span></div>';
    }).join('')+'</div>';
}

/* ===== IMAGES with inline alt-fix =====

   The list is behind an accordion because a page like this one carries 283
   rows, and rendering them open buries every section below Images. The bulk
   control sits outside the accordion: it acts on both groups, so it cannot
   live inside either one.
*/

/* The best alt text a file name can carry.
   logo.webp -> "Logo"; flutter-svgrepo-com-1-150x150.png -> "Flutter svgrepo com 1" */
function altFromFilename(src){
    var name=String(src).split('#')[0].split('?')[0].split('/').pop()||'';
    try { name=decodeURIComponent(name); } catch(e){}
    name=name.replace(/\.[a-z0-9]+$/i,'');   // extension
    name=name.replace(/-\d+x\d+$/i,'');      // WordPress size suffix
    name=name.replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
    if(!name) return '';
    return name.charAt(0).toUpperCase()+name.slice(1);
}

/* True when any word in the name is a long run of hex or carries no vowel -
   the shape of an upload hash, which describes nothing. Judged per word, not
   over the whole string, or "img_26a809f0edf" passes on the strength of "img".

   Writing a hash as alt text makes this audit score better and the page
   worse, so the row says so rather than letting it pass as a fix. */
function weakAltName(text){
    if(!text) return true;
    return text.toLowerCase().split(' ').some(function(w){
        return w.length>=8 && (/^[0-9a-f]+$/.test(w) || !/[aeiou]/.test(w));
    });
}

/* Above this many rows an alt list starts folded. Below it, showing the file
   names outright is more useful than a tidy header. */
var ALT_LIST_OPEN_MAX = 25;

function renderImages(d){
    var bad=d.img_no_alt.length+d.img_empty_alt.length;
    var html=row('Total Images',d.img_total)
        +row('Missing Alt',bad,bad===0?['good','✓']:['bad','✗'],bad+' need alt text');

    if(bad){
        html+='<div class="fseo-bulk">'
            +'<button class="fseo-btn fseo-btn--full" id="fseo-alt-fill">Fill and save all ('+bad+')</button>'
            +'<div class="fseo-bulk-meter" id="fseo-alt-meter" hidden><span id="fseo-alt-bar"></span></div>'
            +'<p class="fseo-bulk-note" id="fseo-alt-bulk-status">Alt text comes from each file name. Rows marked <span class="fseo-pill is-ok">check</span> have a name that describes nothing — edit those by hand.</p>'
            +'</div>';
    }

    var uid=0;

    function altRow(src){
        var fname=esc(src.split('?')[0].split('/').pop()||src);
        var id='alt-'+(uid++);
        var proposed=altFromFilename(src);
        var flag=weakAltName(proposed)
            ? '<span class="fseo-pill is-ok" title="This file name does not describe the image">check</span>'
            : '';
        return '<div class="fseo-alt-row" id="wrap-'+id+'" data-src="'+esc(src)+'">'
            +'<span class="fseo-alt-head">'
            +'<span class="fseo-alt-src" title="'+esc(src)+'">'+fname+'</span>'+flag
            +'</span>'
            +'<div class="fseo-alt-edit">'
            +'<input type="text" class="fseo-alt-input" placeholder="Enter alt text…" data-src="'+esc(src)+'" id="inp-'+id+'">'
            +'<button class="fseo-alt-save fseo-btn-small" data-uid="'+id+'" data-src="'+esc(src)+'">Save</button>'
            +'</div>'
            +'<span class="fseo-alt-status" id="st-'+id+'"></span>'
            +'</div>';
    }

    function altAccordion(accId, label, list){
        if(!list||!list.length) return '';

        // Open when the list is short enough to read at a glance. The whole
        // point of this section is to say *which* images need attention, and a
        // folded list of three answers nothing. Long lists still start folded
        // so they do not push Links, Content and Schema off the panel - the
        // body scrolls within 420px either way, so nothing overflows.
        var open = list.length <= ALT_LIST_OPEN_MAX;

        return '<div class="fseo-acc" id="acc-'+accId+'">'
            +'<button class="fseo-acc-toggle" data-acc="'+accId+'" aria-expanded="'+(open?'true':'false')+'">'
            +'<span>'+label+' ('+list.length+')</span>'
            +'<span class="fseo-acc-caret">'+(open?'▴':'▾')+'</span></button>'
            +'<div class="fseo-acc-body"'+(open?'':' hidden')+'>'
            +list.map(altRow).join('')
            +'</div></div>';
    }

    html+=altAccordion('noalt','No alt attribute',d.img_no_alt);
    html+=altAccordion('emptyalt','Empty alt=""',d.img_empty_alt);

    var wrap=document.getElementById('r-images');
    wrap.innerHTML=html;

    wrap.querySelectorAll('.fseo-acc-toggle').forEach(function(btn){
        btn.addEventListener('click',function(){
            var body=btn.nextElementSibling;
            var wasOpen=!body.hidden;
            body.hidden=wasOpen;
            btn.setAttribute('aria-expanded', wasOpen?'false':'true');
            btn.querySelector('.fseo-acc-caret').textContent=wasOpen?'▾':'▴';
        });
    });

    // Bind save buttons
    wrap.querySelectorAll('.fseo-alt-save').forEach(function(btn){
        btn.addEventListener('click',function(){
            var id=btn.dataset.uid;
            var src=btn.dataset.src;
            var inp=document.getElementById('inp-'+id);
            var st=document.getElementById('st-'+id);
            var alt=inp.value.trim();
            if(!alt){ st.textContent='Enter alt text first.'; st.className='fseo-alt-status is-bad'; return; }
            btn.disabled=true; btn.textContent='…';
            doAjax('framify_seo_fix_alt',{src:src,alt:alt},function(res){
                btn.disabled=false; btn.textContent='Save';
                if(res.success){
                    st.textContent='✓ Saved'; st.className='fseo-alt-status is-good';
                    document.getElementById('wrap-'+id).classList.add('is-fixed');
                } else {
                    st.textContent='✗ '+res.data; st.className='fseo-alt-status is-bad';
                }
            });
        });
    });

    var fillBtn=document.getElementById('fseo-alt-fill');
    if(fillBtn) fillBtn.addEventListener('click',function(){ bulkFillAlt(wrap); });
}

/* Fills every outstanding row from its file name and saves in chunks.

   Chunked rather than one request because a page can carry hundreds of images
   and every one costs an attachment_url_to_postid lookup; 25 at a time keeps
   each request short and gives the meter something honest to report. */
function bulkFillAlt(wrap){
    var btn=document.getElementById('fseo-alt-fill');
    var meter=document.getElementById('fseo-alt-meter');
    var bar=document.getElementById('fseo-alt-bar');
    var note=document.getElementById('fseo-alt-bulk-status');

    // Fill the inputs before sending, so what is being written is on screen
    // rather than only in the request.
    var queue=[];
    wrap.querySelectorAll('.fseo-alt-row:not(.is-fixed)').forEach(function(rowEl){
        var src=rowEl.dataset.src;
        var inp=rowEl.querySelector('.fseo-alt-input');
        var alt=inp.value.trim()||altFromFilename(src);
        if(!alt) return;
        inp.value=alt;
        queue.push({src:src,alt:alt,el:rowEl});
    });

    if(!queue.length){ note.textContent='No file names to work from.'; return; }

    var total=queue.length, saved=0, failed=0;
    var CHUNK=25;

    btn.disabled=true;
    meter.hidden=false;

    function finish(){
        bar.style.width='100%';
        btn.textContent = saved===total
            ? 'All '+saved+' saved'
            : 'Saved '+saved+' of '+total;
        note.textContent = failed
            ? 'Saved '+saved+'. '+failed+' had no file name to work from.'
            : 'Saved '+saved+' image'+(saved===1?'':'s')+'. Re-run Analyse to confirm.';
    }

    function step(i){
        if(i>=total){ finish(); return; }

        var slice=queue.slice(i,i+CHUNK);
        btn.textContent='Saving '+Math.min(i+CHUNK,total)+' of '+total;

        doAjax('framify_seo_fix_alt_bulk',{
            items: JSON.stringify(slice.map(function(q){ return {src:q.src,alt:q.alt}; }))
        },function(res){
            var ok={};
            if(res.success && res.data && res.data.saved){
                res.data.saved.forEach(function(idx){ ok[idx]=1; });
            }

            slice.forEach(function(q,idx){
                var st=q.el.querySelector('.fseo-alt-status');
                if(ok[idx]){
                    saved++;
                    st.textContent='✓ Saved'; st.className='fseo-alt-status is-good';
                    q.el.classList.add('is-fixed');
                } else {
                    failed++;
                    st.textContent='✗ '+(res.success?'Could not save':(res.data||'Failed'));
                    st.className='fseo-alt-status is-bad';
                }
            });

            bar.style.width=Math.round(Math.min(i+CHUNK,total)/total*100)+'%';
            step(i+CHUNK);
        });
    }

    step(0);
}

/* ===== LINKS ACCORDION ===== */
function renderLinks(d){
    var html='';
    html+=row('Internal Links',d.int_links,d.int_links>=3?['good','✓']:['ok','~']);
    html+=row('External Links',d.ext_links,null);
    html+=row('Nofollow Links',d.nofollow,null);

    function linkAccordion(id, label, links, cls){
        if(!links||!links.length) return '';
        return '<div class="fseo-acc" id="acc-'+id+'">'
            +'<button class="fseo-acc-toggle" data-acc="'+id+'">'
            +'<span>'+label+' ('+links.length+')</span>'
            +'<span class="fseo-acc-caret">▾</span></button>'
            +'<div class="fseo-acc-body" hidden>'
            +links.map(function(l){
                var rel=l.nofollow?'<span class="fseo-pill is-ok" style="font-size:9px;">nofollow</span>':'';
                return '<div class="fseo-link-row">'
                    +'<a href="'+esc(l.href)+'" target="_blank" class="fseo-link-href '+cls+'">'+esc(l.href.replace(/^https?:\/\//,''))+'</a>'
                    +(l.text?'<span class="fseo-link-text">'+esc(l.text)+'</span>':'')
                    +rel+'</div>';
            }).join('')
            +'</div></div>';
    }

    html+=linkAccordion('int', 'Internal Links', d.int_links_data, 'is-int');
    html+=linkAccordion('ext', 'External Links', d.ext_links_data, 'is-ext');

    document.getElementById('r-links').innerHTML=html;

    document.getElementById('r-links').querySelectorAll('.fseo-acc-toggle').forEach(function(btn){
        btn.addEventListener('click',function(){
            var body=btn.nextElementSibling;
            var open=!body.hidden;
            body.hidden=open;
            btn.querySelector('.fseo-acc-caret').textContent=open?'▾':'▴';
        });
    });
}

function renderContent(d){
    document.getElementById('r-content').innerHTML=
        row('Word Count',d.word_count+' words',d.word_count>=300?['good','✓']:d.word_count>=150?['ok','~']:['bad','✗'],'Recommended 300+');
}

function renderOG(d){
    var keys=['og:title','og:description','og:image','og:url','og:type','og:site_name','twitter:card','twitter:title','twitter:description','twitter:image'];
    document.getElementById('r-og').innerHTML=keys.map(function(k){
        return row(k,d.og[k]||null,d.og[k]?['good','✓']:['bad','✗']);
    }).join('');
}

/* ===== STRUCTURED DATA with builder ===== */
var SCHEMA_TYPES = {
    'Article':      {name:'Article', fields:['headline','description','author','datePublished','dateModified','image','url']},
    'LocalBusiness':{name:'Local Business', fields:['name','description','telephone','email','address','url','image','openingHours']},
    'Product':      {name:'Product', fields:['name','description','brand','sku','price','priceCurrency','availability','image','url']},
    'FAQPage':      {name:'FAQ Page', fields:['faq_pairs']},
    'BreadcrumbList':{name:'Breadcrumb List', fields:['breadcrumbs']},
    'WebSite':      {name:'WebSite', fields:['name','url','description','potentialAction_target']},
    'Organization': {name:'Organization', fields:['name','url','logo','telephone','email','address','sameAs']},
    'Person':       {name:'Person', fields:['name','url','image','jobTitle','email','sameAs']},
};

var FIELD_LABELS = {
    headline:'Headline',description:'Description',author:'Author Name',
    datePublished:'Date Published (ISO)',dateModified:'Date Modified (ISO)',
    image:'Image URL',url:'Page URL',openingHours:'Opening Hours',
    telephone:'Phone',email:'Email',address:'Address (street, city, country)',
    name:'Name',brand:'Brand',sku:'SKU',price:'Price (number)',
    priceCurrency:'Currency (e.g. USD)',availability:'Availability URL',
    potentialAction_target:'Search URL template',
    logo:'Logo URL',sameAs:'Same As URLs (comma-separated)',
    jobTitle:'Job Title',faq_pairs:'FAQ Items',breadcrumbs:'Breadcrumb Items',
};

function renderSchema(d){
    var existing='';
    if(d.schema.length){
        existing='<div class="fseo-sub-label">Detected on page</div>'
            +d.schema.map(function(t){ return '<div class="fseo-code-line"><span class="fseo-pill is-good">✓</span> '+esc(t)+'</div>'; }).join('');
    } else {
        existing='<div class="fseo-empty-msg"><span class="fseo-pill is-bad">✗</span> No structured data detected.</div>';
    }

    var builder='<div class="fseo-schema-builder">'
        +'<div class="fseo-sub-label">➕ Add Structured Data</div>'
        +'<div class="fseo-schema-type-row">'
        +'<select id="schema-type-sel" class="fseo-select">'
        +Object.keys(SCHEMA_TYPES).map(function(k){ return '<option value="'+k+'">'+SCHEMA_TYPES[k].name+'</option>'; }).join('')
        +'</select>'
        +'<button id="schema-build-btn" class="fseo-btn-small">Build</button>'
        +'</div>'
        +'<div id="schema-fields"></div>'
        +'<div id="schema-preview-wrap" hidden>'
        +'<div class="fseo-sub-label">JSON-LD Preview</div>'
        +'<pre id="schema-preview" class="fseo-json-preview"></pre>'
        +'<button id="schema-save-btn" class="fseo-btn fseo-btn--full">💾 Save to This Page</button>'
        +'<div id="schema-save-status"></div>'
        +'</div>'
        +'</div>';

    document.getElementById('r-schema').innerHTML=existing+builder;

    document.getElementById('schema-build-btn').addEventListener('click', buildSchemaFields);
    document.getElementById('schema-type-sel').addEventListener('change', buildSchemaFields);
    buildSchemaFields();
}

function buildSchemaFields(){
    var type=document.getElementById('schema-type-sel').value;
    var def=SCHEMA_TYPES[type];
    if(!def) return;
    var fields=def.fields;
    var html='<div class="fseo-schema-fields">';

    fields.forEach(function(f){
        var label=FIELD_LABELS[f]||f;
        if(f==='faq_pairs'){
            html+='<div class="fseo-schema-field">'
                +'<label>FAQ Items <button type="button" class="fseo-btn-tiny" onclick="addFaqRow()">+ Add Q&A</button></label>'
                +'<div id="faq-rows"></div></div>';
        } else if(f==='breadcrumbs'){
            html+='<div class="fseo-schema-field">'
                +'<label>Breadcrumbs <button type="button" class="fseo-btn-tiny" onclick="addBreadcrumbRow()">+ Add Item</button></label>'
                +'<div id="bc-rows"></div></div>';
        } else {
            var ph=f.indexOf('date')!==-1?'e.g. 2024-01-15':f==='url'?window.location.href:'';
            html+='<div class="fseo-schema-field">'
                +'<label>'+esc(label)+'</label>'
                +'<input type="text" class="fseo-schema-input" data-field="'+esc(f)+'" placeholder="'+esc(ph)+'"></div>';
        }
    });
    html+='</div>'
        +'<button class="fseo-btn fseo-btn--outline" id="schema-gen-btn">Generate JSON-LD</button>';

    document.getElementById('schema-fields').innerHTML=html;
    document.getElementById('schema-preview-wrap').hidden=true;

    if(def.fields.includes('faq_pairs')) addFaqRow();
    if(def.fields.includes('breadcrumbs')){ addBreadcrumbRow(); addBreadcrumbRow(); }

    document.getElementById('schema-gen-btn').addEventListener('click', generateSchema);
}

window.addFaqRow=function(){
    var c=document.getElementById('faq-rows');
    var d=document.createElement('div'); d.className='fseo-faq-row';
    d.innerHTML='<input type="text" class="fseo-schema-input" placeholder="Question" data-faq="q">'
        +'<textarea class="fseo-schema-textarea" placeholder="Answer" data-faq="a"></textarea>'
        +'<button type="button" class="fseo-btn-tiny is-bad" onclick="this.parentNode.remove()">✕</button>';
    c.appendChild(d);
};

window.addBreadcrumbRow=function(){
    var c=document.getElementById('bc-rows');
    var idx=c.children.length+1;
    var d=document.createElement('div'); d.className='fseo-bc-row';
    d.innerHTML='<input type="text" class="fseo-schema-input" placeholder="Label (e.g. Home)" data-bc="name">'
        +'<input type="text" class="fseo-schema-input" placeholder="URL" data-bc="url">'
        +'<button type="button" class="fseo-btn-tiny is-bad" onclick="this.parentNode.remove()">✕</button>';
    c.appendChild(d);
};

function generateSchema(){
    var type=document.getElementById('schema-type-sel').value;
    var inputs=document.querySelectorAll('#schema-fields .fseo-schema-input[data-field]');
    var vals={};
    inputs.forEach(function(i){ if(i.value.trim()) vals[i.dataset.field]=i.value.trim(); });

    var obj={'@context':'https://schema.org','@type':type};

    if(type==='FAQPage'){
        var pairs=[];
        document.querySelectorAll('#faq-rows .fseo-faq-row').forEach(function(row){
            var q=row.querySelector('[data-faq="q"]').value.trim();
            var a=row.querySelector('[data-faq="a"]').value.trim();
            if(q&&a) pairs.push({'@type':'Question',name:q,acceptedAnswer:{'@type':'Answer',text:a}});
        });
        obj.mainEntity=pairs;
    } else if(type==='BreadcrumbList'){
        var items=[];
        document.querySelectorAll('#bc-rows .fseo-bc-row').forEach(function(row,i){
            var n=row.querySelector('[data-bc="name"]').value.trim();
            var u=row.querySelector('[data-bc="url"]').value.trim();
            if(n) items.push({'@type':'ListItem',position:i+1,name:n,item:u||undefined});
        });
        obj.itemListElement=items;
    } else if(type==='LocalBusiness'||type==='Organization'){
        if(vals.address) obj.address={'@type':'PostalAddress',streetAddress:vals.address};
        if(vals.sameAs) obj.sameAs=vals.sameAs.split(',').map(function(s){return s.trim();});
        Object.keys(vals).forEach(function(k){ if(k!=='address'&&k!=='sameAs') obj[k]=vals[k]; });
    } else if(type==='Product'){
        if(vals.price) obj.offers={'@type':'Offer',price:vals.price,priceCurrency:vals.priceCurrency||'USD',availability:vals.availability||'https://schema.org/InStock'};
        Object.keys(vals).forEach(function(k){ if(k!=='price'&&k!=='priceCurrency'&&k!=='availability') obj[k]=vals[k]; });
    } else if(type==='Article'){
        if(vals.author) obj.author={'@type':'Person',name:vals.author};
        Object.keys(vals).forEach(function(k){ if(k!=='author') obj[k]=vals[k]; });
    } else if(type==='WebSite'){
        if(vals.potentialAction_target) obj.potentialAction={'@type':'SearchAction',target:{query:'required',url:vals.potentialAction_target}};
        Object.keys(vals).forEach(function(k){ if(k!=='potentialAction_target') obj[k]=vals[k]; });
    } else {
        Object.keys(vals).forEach(function(k){ obj[k]=vals[k]; });
    }

    var json=JSON.stringify(obj,null,2);
    document.getElementById('schema-preview').textContent=json;
    document.getElementById('schema-preview-wrap').hidden=false;

    document.getElementById('schema-save-btn').onclick=function(){
        var st=document.getElementById('schema-save-status');
        this.disabled=true; this.textContent='Saving…';
        var self=this;
        doAjax('framify_seo_save_schema',{
            json_ld:json,
            // The URL the audit actually landed on, so a schema saved after a
            // redirect is scoped to the page that was really read.
            page_url: analysedUrl || document.getElementById('fseo-url').value,
            schema_type:type
        },function(res){
            self.disabled=false; self.textContent='💾 Save to This Page';
            if(res.success){
                st.innerHTML='<span class="fseo-pill is-good">✓ Saved as "'+esc(res.data.title)+'" in Framify</span>';
            } else {
                st.innerHTML='<span class="fseo-pill is-bad">✗ '+esc(res.data)+'</span>';
            }
        });
    };
}

function renderTech(d){
    document.getElementById('r-tech').innerHTML=
        row('HTTP Status',d.http_code,d.http_code===200?['good','200 OK']:['bad',d.http_code])
       +row('HTTPS',d.is_https?'Yes':'No',d.is_https?['good','✓']:['bad','✗'])
       +row('Viewport',d.has_viewport?'Yes':'No',d.has_viewport?['good','✓']:['bad','✗'])
       +row('Content-Type',d.content_type||'—')
       +row('X-Robots-Tag',d.x_robots||'(none)');
}

function esc(s){ if(s===null||s===undefined) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

})();

/* ============================================================
   Theme picker

   A theme is a set of CSS custom properties keyed off
   data-framify-theme on <html>, so applying one is a single
   attribute swap. Stored on the WordPress account under the same
   meta key the code editor reads, which is what keeps the two
   apps in step. Vanilla JS - this page loads no jQuery.
   ============================================================ */
(function(){
'use strict';

var AJAX   = <?php echo json_encode( $ajax_url ); ?>;
var NONCE  = <?php echo json_encode( $nonce ); ?>;

var modal  = document.getElementById('framify-settings-modal');
var grid   = document.getElementById('framify-theme-grid');
var opener = document.getElementById('open-settings-modal');
if (!modal || !grid || !opener) return;

var cards  = Array.prototype.slice.call(grid.querySelectorAll('.fr-theme'));
var status = document.getElementById('framify-theme-status');
var root   = document.documentElement;
var themeTimer = null;

function setStatus(message, state){
    if (!status) return;
    status.textContent = message;
    status.className = 'fr-theme-status' + (state ? ' ' + state : '');
}

function applyTheme(theme){
    // Let colours cross-fade for the length of the swap, then stop paying for it.
    root.classList.add('fr-theming');
    if (themeTimer) clearTimeout(themeTimer);
    themeTimer = setTimeout(function(){ root.classList.remove('fr-theming'); }, 350);

    root.setAttribute('data-framify-theme', theme);

    cards.forEach(function(card){
        var chosen = card.getAttribute('data-theme') === theme;
        card.setAttribute('aria-checked', chosen ? 'true' : 'false');
        card.setAttribute('tabindex', chosen ? '0' : '-1');
    });
}

function saveTheme(theme){
    setStatus('Saving');

    var fd = new FormData();
    fd.append('action', 'framify_save_ui_theme');
    fd.append('nonce', NONCE);
    fd.append('theme', theme);

    fetch(AJAX, {method: 'POST', body: fd})
      .then(function(r){ return r.json(); })
      .then(function(json){
          if (json && json.success) {
              setStatus('Saved to your account', 'is-saved');
          } else {
              setStatus('Server rejected the theme', 'is-error');
          }
      })
      .catch(function(){
          setStatus('Not saved - check your connection', 'is-error');
      });
}

function chooseTheme(theme){
    if (!theme) return;
    applyTheme(theme);
    saveTheme(theme);
}

function openModal(){
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    setStatus('Saved to your account');
    var current = grid.querySelector('.fr-theme[aria-checked="true"]');
    if (current) current.focus();
}

function closeModal(){
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    opener.focus();
}

cards.forEach(function(card){
    card.addEventListener('click', function(){
        chooseTheme(card.getAttribute('data-theme'));
    });
});

// Arrow keys move through the group, as a radio group should.
grid.addEventListener('keydown', function(e){
    var keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (keys.indexOf(e.key) === -1) return;

    var card = e.target.closest ? e.target.closest('.fr-theme') : null;
    var from = cards.indexOf(card);
    if (from === -1) return;

    e.preventDefault();
    var step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
    var next = (from + step + cards.length) % cards.length;

    cards[next].focus();
    chooseTheme(cards[next].getAttribute('data-theme'));
});

opener.addEventListener('click', openModal);
document.getElementById('close-settings-modal').addEventListener('click', closeModal);
document.getElementById('settings-done').addEventListener('click', closeModal);

modal.addEventListener('click', function(e){
    if (e.target === modal) closeModal();
});

document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
});

})();
</script>
</body>
</html>
        <?php
    }
}

new Framify_SEO();