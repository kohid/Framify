<?php
/**
 * Page loader: settings sanitising, URL rules, the CSS / markup / script it
 * prints. Plain PHP, no WordPress: php dev/tests/loader-test.php
 * --dump-html writes dev/tests/loader/*.html for the browser test.
 */
define( 'ABSPATH', __DIR__ . '/' );

function add_action() {}
function add_filter() {}
function apply_filters( $tag, $value ) { return $value; }
function get_option( $name, $default = false ) { return $default; }
function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function esc_url_raw( $v ) { return preg_replace( '/[^a-z0-9\-~+_.?#=!&;,\/:%@$\|*\'()\[\]\x80-\xff]/i', '', (string) $v ); }
function esc_url( $v ) { return esc_url_raw( $v ); }
function home_url( $p = '' ) { return 'https://site.test/blog' . $p; }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function wp_unslash( $v ) { return $v; }
function esc_html( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }

require dirname( __DIR__, 2 ) . '/framify-loader.php';

$fails = 0;
function check( $name, $ok ) {
    global $fails;
    echo ( $ok ? 'PASS ' : 'FAIL ' ) . $name . "\n";
    if ( ! $ok ) { $fails++; }
}

$d = Framify_Loader::sanitize( array() );
check( 'defaults: off, whole site, white ring, 15 second limit', 0 === $d['enabled'] && 'all' === $d['scope'] && '#ffffff' === $d['bg_color'] && 'ring' === $d['spinner'] && 15 === $d['max_seconds'] && 400 === $d['fade'] );
check( 'sanitise: junk input becomes the defaults', Framify_Loader::sanitize( 'nope' ) === $d && Framify_Loader::sanitize( null ) === $d );
$s = Framify_Loader::sanitize( array( 'enabled' => '1', 'scope' => 'weird', 'bg_color' => 'red; background:url(x)', 'spinner_color' => '#ABC', 'spinner_size' => 9999, 'fade' => -5, 'max_seconds' => 1, 'overlay_opacity' => 400, 'spinner' => 'nonsense', 'bg_size' => 'zoom', 'bg_position' => 'x y' ) );
check( 'sanitise: scope, colours, ranges and choices are clamped to safe values', 1 === $s['enabled'] && 'all' === $s['scope'] && '#ffffff' === $s['bg_color'] && '#abc' === $s['spinner_color'] && 240 === $s['spinner_size'] && 0 === $s['fade'] && 3 === $s['max_seconds'] && 100 === $s['overlay_opacity'] && 'ring' === $s['spinner'] && 'cover' === $s['bg_size'] && 'center center' === $s['bg_position'] );
check( 'sanitise: rgba colours with numbers are kept, anything else is not', 'rgba(1, 2, 3, 0.5)' === Framify_Loader::clean_color( 'rgba(1, 2, 3, 0.5)', '#000' ) && '#000' === Framify_Loader::clean_color( 'rgba(1,2,3);x', '#000' ) && '#000' === Framify_Loader::clean_color( 'url(x)', '#000' ) );
check( 'sanitise: the image spinner without an image falls back to the ring', 'ring' === Framify_Loader::sanitize( array( 'spinner' => 'image' ) )['spinner'] && 'image' === Framify_Loader::sanitize( array( 'spinner' => 'image', 'spinner_image' => 'https://x.test/a.gif' ) )['spinner'] );
$r = Framify_Loader::sanitize( array( 'rules' => array(
    array( 'type' => 'contains', 'value' => ' /shop ' ),
    array( 'type' => 'contains', 'value' => '' ),
    array( 'type' => 'bogus', 'value' => 'x' ),
    array( 'type' => 'first-page', 'value' => 'ignored' ),
    'not an array',
) ) )['rules'];
check( 'sanitise: rules keep known types, trim values, drop empty and unknown ones, and the homepage rule has no value', array( array( 'type' => 'contains', 'value' => '/shop' ), array( 'type' => 'first-page', 'value' => '' ) ) === $r );
$many = array();
for ( $i = 0; $i < 60; $i++ ) { $many[] = array( 'type' => 'contains', 'value' => 'x' . $i ); }
check( 'sanitise: at most 30 rules', 30 === count( Framify_Loader::sanitize( array( 'rules' => $many ) )['rules'] ) );
check( 'sanitise: the text is plain and short', 'Hi' === Framify_Loader::sanitize( array( 'text' => '<b>Hi</b>' ) )['text'] && 120 === strlen( Framify_Loader::sanitize( array( 'text' => str_repeat( 'a', 300 ) ) )['text'] ) );

$url = 'https://site.test/shop/item-5/?x=1';
$t   = function ( $rules ) { return Framify_Loader::sanitize( array( 'scope' => 'target', 'rules' => $rules ) ); };
check( 'rules: scope "all" always matches', Framify_Loader::matches( Framify_Loader::sanitize( array( 'scope' => 'all' ) ), $url, false ) );
check( 'rules: target pages with no rule matches nothing', ! Framify_Loader::matches( $t( array() ), $url, true ) );
check( 'rules: homepage', Framify_Loader::matches( $t( array( array( 'type' => 'first-page' ) ) ), $url, true ) && ! Framify_Loader::matches( $t( array( array( 'type' => 'first-page' ) ) ), $url, false ) );
check( 'rules: URL contains / not contains', Framify_Loader::matches( $t( array( array( 'type' => 'contains', 'value' => '/shop/' ) ) ), $url, false ) && ! Framify_Loader::matches( $t( array( array( 'type' => 'contains', 'value' => '/blog/' ) ) ), $url, false ) && Framify_Loader::matches( $t( array( array( 'type' => 'not-contains', 'value' => '/blog/' ) ) ), $url, false ) && ! Framify_Loader::matches( $t( array( array( 'type' => 'not-contains', 'value' => '/shop/' ) ) ), $url, false ) );
check( 'rules: URL equal / not equal', Framify_Loader::matches( $t( array( array( 'type' => 'equal-to', 'value' => $url ) ) ), $url, false ) && ! Framify_Loader::matches( $t( array( array( 'type' => 'equal-to', 'value' => 'https://site.test/' ) ) ), $url, false ) && Framify_Loader::matches( $t( array( array( 'type' => 'not-equal-to', 'value' => 'https://site.test/' ) ) ), $url, false ) );
check( 'rules: URL starts with / ends by', Framify_Loader::matches( $t( array( array( 'type' => 'begins-with', 'value' => 'https://site.test/shop' ) ) ), $url, false ) && ! Framify_Loader::matches( $t( array( array( 'type' => 'begins-with', 'value' => '/shop' ) ) ), $url, false ) && Framify_Loader::matches( $t( array( array( 'type' => 'ends-by', 'value' => 'x=1' ) ) ), $url, false ) && ! Framify_Loader::matches( $t( array( array( 'type' => 'ends-by', 'value' => 'x=2' ) ) ), $url, false ) );
check( 'rules: any one matching rule is enough', Framify_Loader::matches( $t( array( array( 'type' => 'contains', 'value' => '/blog/' ), array( 'type' => 'ends-by', 'value' => 'x=1' ) ) ), $url, false ) );

$_SERVER['REQUEST_URI'] = '/blog/about/?x=1';
check( 'current URL: the install folder is not doubled', 'https://site.test/blog/about/?x=1' === Framify_Loader::current_url() );
$_SERVER['REQUEST_URI'] = '/other/';
check( 'current URL: a path outside the folder is appended to the home URL', 'https://site.test/blog/other/' === Framify_Loader::current_url() );

// Output.
$s   = Framify_Loader::sanitize( array( 'enabled' => 1, 'bg_color' => '#102030', 'bg_image' => 'https://x.test/a.jpg', 'spinner' => 'dots', 'spinner_color' => '#ff0000', 'spinner_size' => 64, 'fade' => 700, 'max_seconds' => 20, 'text' => 'Loading & wait' ) );
$css = Framify_Loader::css( $s );
check( 'css: covers the screen above everything, hidden until the script switches it on', false !== strpos( $css, '#framify-loader{position:fixed;inset:0;z-index:2147483647;display:none;}' ) && false !== strpos( $css, 'html.framify-loading #framify-loader' ) && false !== strpos( $css, 'html.framify-loading:has(#framify-loader)' ) );
check( 'css: the colours, image, size and fade are in', false !== strpos( $css, 'background-color:#102030' ) && false !== strpos( $css, 'url("https://x.test/a.jpg")' ) && false !== strpos( $css, '--fl-c:#ff0000' ) && false !== strpos( $css, '--fl-s:64px' ) && false !== strpos( $css, 'opacity ' . 700 . 'ms' ) );
$evil = Framify_Loader::css( array_merge( $s, array( 'bg_image' => 'https://x.test/a"</style><script>alert(1)</script>.jpg' ) ) );
check( 'css: an image URL cannot close the style tag or the url()', false === strpos( $evil, '</style>' ) && false === strpos( $evil, '<script' ) );
check( 'css: reduced motion stops the spinners and the fade', false !== strpos( $css, 'prefers-reduced-motion' ) );
check( 'css: the settings preview is drawn statically', false === strpos( Framify_Loader::css( $s, '.fr-loader-preview', true ), 'position:fixed' ) );
$inner = Framify_Loader::inner( $s );
check( 'markup: the chosen spinner and the text, escaped', false !== strpos( $inner, 'fl-dots' ) && false !== strpos( $inner, 'Loading &amp; wait' ) );
check( 'markup: the image spinner is an img with empty alt', false !== strpos( Framify_Loader::inner( Framify_Loader::sanitize( array( 'spinner' => 'image', 'spinner_image' => 'https://x.test/a.gif' ) ) ), '<img class="fl-spin fl-img" src="https://x.test/a.gif" alt=""' ) );
$js = Framify_Loader::script( $s );
check( 'script: waits for load, fonts and pending shapes, and gives up after the limit', false !== strpos( $js, 'data-framify-shape="pending"' ) && false !== strpos( $js, 'Date.now()-t0>=20000' ) && false !== strpos( $js, 'd.fonts.ready' ) && false !== strpos( $js, 'setTimeout(hide,20000)' ) );

if ( in_array( '--dump-html', $argv, true ) ) {
    $dir = __DIR__ . '/loader/';
    if ( ! is_dir( $dir ) ) { mkdir( $dir ); }
    $page = function ( $settings, $body ) {
        return '<!doctype html><html><head><meta charset="utf-8"><style id="framify-loader-css">' . Framify_Loader::css( $settings ) . '</style><script>' . Framify_Loader::script( $settings ) . '</script></head><body><div id="framify-loader" role="status">' . Framify_Loader::inner( $settings ) . '</div>' . $body . '</body></html>';
    };
    $fast = Framify_Loader::sanitize( array( 'enabled' => 1, 'fade' => 200, 'max_seconds' => 3 ) );
    file_put_contents( $dir . 'plain.html', $page( $fast, '<main>Hello</main>' ) );
    file_put_contents( $dir . 'shape.html', $page( $fast, '<main data-framify-shape="pending" id="m">Hello</main>' ) );
    echo "dumped\n";
}

echo $fails ? "\n$fails FAILED\n" : "\nALL PASSED\n";
exit( $fails ? 1 : 0 );
