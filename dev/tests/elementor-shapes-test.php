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
define( 'FRAMIFY_PLUGIN_DIR', dirname( __DIR__, 2 ) . '/' );
$framify_actions = array();
function add_action( $hook, $callback, $priority = 10 ) {
    $GLOBALS['framify_actions'][] = array( 'hook' => $hook, 'callback' => $callback, 'priority' => $priority );
}
/**
 * Registered callbacks for one hook, as array( priority, object, method ),
 * one per class + method + priority: each module file instantiates itself
 * and this test builds its own instance too, so every hook is added twice.
 */
function framify_hooked( $hook ) {
    $out = array();
    foreach ( $GLOBALS['framify_actions'] as $a ) {
        if ( $hook === $a['hook'] && is_array( $a['callback'] ) ) {
            $key         = get_class( $a['callback'][0] ) . '::' . $a['callback'][1] . '@' . $a['priority'];
            $out[ $key ] = array( $a['priority'], $a['callback'][0], $a['callback'][1] );
        }
    }
    return array_values( $out );
}
function __( $text ) { return $text; }
function esc_html__( $text ) { return $text; }
function framify_shape_ids( $control ) {
    if ( isset( $control['condition']['framify_org_shape'] ) ) {
        return (array) $control['condition']['framify_org_shape'];
    }
    foreach ( $control['conditions']['terms'] ?? array() as $t ) {
        if ( isset( $t['relation'] ) ) {
            foreach ( $t['terms'] as $u ) {
                if ( 'framify_org_shape' === $u['name'] ) {
                    return (array) $u['value'];
                }
            }
        }
    }
    return null;
}
function sanitize_key( $k ) { return strtolower( preg_replace( '/[^a-z0-9_\-]/i', '', (string) $k ) ); }
function wp_list_pluck( $list, $field ) { $out = array(); foreach ( $list as $k => $v ) { $out[ $k ] = $v[ $field ]; } return $out; }

require dirname( __DIR__, 2 ) . '/framify-elementor.php';

$module = new Framify_Elementor();

function framify_call( $module, $method ) {
    $m = new ReflectionMethod( $module, $method );
    $m->setAccessible( true );
    return $m->invokeArgs( $module, array_slice( func_get_args(), 2 ) );
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

// --dump-config: the window.framifyOrganic object the front end gets, for the
// browser fixture in dev/tests/organic/.
if ( in_array( '--dump-config', $argv, true ) ) {
    $dir = __DIR__ . '/organic';
    if ( ! is_dir( $dir ) ) {
        mkdir( $dir );
    }
    file_put_contents( $dir . '/config.json', json_encode( array(
        'shapes'       => $paths,
        'defaultShape' => Framify_Elementor::DEFAULT_SHAPE,
        'library'      => (object) framify_call( $module, 'library_svgs' ),
    ) ) );
    echo "Config written\n";
    exit;
}

if ( in_array( '--preview', $argv, true ) ) {
    $out = '<!doctype html><title>Framify shapes</title><body style="font:14px sans-serif;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:16px">';
    foreach ( $paths as $id => $p ) {
        $variants = array( ( 'wavy' === $p['family'] ? 'anchored' : $p['family'] ) => $p );
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

// 2. Wavy presets (ids derived from the module, so a new preset is tested automatically).
$presets  = framify_call( $module, 'wavy_presets' );
$wavy_ids = array_keys( $presets );
check( 'wavy_ids() matches wavy_presets() keys', $wavy_ids === framify_call( $module, 'wavy_ids' ) );
check( 'six wavy shapes', 6 === count( $wavy_ids ) );
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

// 3. Flow presets: hand-placed anchors from the top-right corner round to the bottom-right corner.
$flow = framify_call( $module, 'flow_presets' );
check( 'flow_ids() matches flow_presets() keys', array_keys( $flow ) === framify_call( $module, 'flow_ids' ) );
check( 'six flow shapes', 6 === count( $flow ) );
foreach ( $flow as $id => $preset ) {
    $p = isset( $paths[ $id ] ) ? $paths[ $id ] : null;
    check( "$id exists as flow", $p && 'flow' === $p['family'] && ! isset( $p['free'] ) );
    if ( ! $p ) {
        continue;
    }
    foreach ( array( 'rest', 'hover' ) as $state ) {
        $pts    = $preset[ $state ];
        $inside = true;
        foreach ( $pts as $pt ) {
            if ( $pt[0] < 0 || $pt[0] > 100 || $pt[1] < 0 || $pt[1] > 100 ) {
                $inside = false;
            }
        }
        check( "$id $state has 8-14 anchors inside the box", count( $pts ) >= 8 && count( $pts ) <= 14 && $inside );
        check( "$id $state is pinned to the right-hand corners", array( 100, 0 ) == $pts[0] && array( 100, 100 ) == $pts[ count( $pts ) - 1 ] );
    }
    check( "$id rest/hover have the same anchor count", count( $preset['rest'] ) === count( $preset['hover'] ) );
    $drift = 0;
    foreach ( $preset['rest'] as $i => $pt ) {
        $drift = max( $drift, abs( $pt[0] - $preset['hover'][ $i ][0] ), abs( $pt[1] - $preset['hover'][ $i ][1] ) );
    }
    check( "$id hover drifts at most 6 units", $drift <= 6 );
    check( "$id rest/hover morphable", skeleton( $p['rest'] ) === skeleton( $p['hover'] ) );
    check( "$id starts at the top-right corner", 0 === strpos( $p['rest'], 'M100.00 0.00' ) );
    $n = nums( $p['rest'] );
    check( "$id ends at the bottom-right corner", array( 100.0, 100.0 ) === array_slice( $n, -2 ) );
    check( "$id stays near the box", min( $n ) >= -3 && max( $n ) <= 103 );
}

// 4. The pickers list every shape; wide families have wide thumbnails.
$options = framify_call( $module, 'shape_options' );
check( 'deco picker has 20 shapes (no custom)', 20 === count( $options ) && ! isset( $options['custom'] ) );
check( 'wavy thumbnail is drawn wide', isset( $options['tide'] ) && false !== strpos( rawurldecode( $options['tide']['image'] ), 'scale(1 0.7)' ) );
check( 'flow thumbnail is drawn wide', isset( $options['brook'] ) && false !== strpos( rawurldecode( $options['brook']['image'] ), 'scale(1 0.7)' ) );

$main = framify_call( $module, 'shape_options', true );
check( 'main picker has 21 shapes ending with custom', 21 === count( $main ) && 'custom' === array_key_last( $main ) );
check( 'custom thumbnail is a dashed outline', isset( $main['custom'] ) && false !== strpos( rawurldecode( $main['custom']['image'] ), 'stroke-dasharray' ) );

// 5. Floating Shapes (framify-elementor-shapes.php): control ids, tab, live flags, defaults.
class Framify_Test_Controls_Manager {
    const SWITCHER = 'switcher';
    const SELECT   = 'select';
    const SELECT2  = 'select2';
    const SLIDER   = 'slider';
    const COLOR    = 'color';
    const CHOOSE   = 'choose';
    const BUTTON   = 'button';
    const HEADING  = 'heading';
    const RAW_HTML = 'raw_html';
    const NUMBER   = 'number';
    const TEXTAREA = 'textarea';
    const VISUAL_CHOICE = 'visual_choice';
    const DIMENSIONS = 'dimensions';
    const MEDIA    = 'media';
}
class_alias( 'Framify_Test_Controls_Manager', 'Elementor\Controls_Manager' );
class Framify_Test_Element {
    public $name     = '';
    public function __construct( $name = '' ) { $this->name = $name; }
    public function get_name() { return $this->name; }
    public $sections = array();
    public $controls = array();
    public $open     = 0;
    public $current    = null;
    public $section_of = array();
    public function start_controls_section( $id, $args ) { $this->sections[ $id ] = $args; $this->open++; $this->current = $id; }
    public function end_controls_section() { $this->open--; $this->current = null; }
    public $order    = array();
    public function add_control( $id, $args ) { $this->controls[ $id ] = $args; $this->order[] = $id; $this->section_of[ $id ] = $this->current; $this->tab_of[ $id ] = $this->tab; }
    public function add_responsive_control( $id, $args ) { $this->controls[ $id ] = $args + array( 'responsive' => true ); $this->order[] = $id; $this->section_of[ $id ] = $this->current; $this->tab_of[ $id ] = $this->tab; }
    public $groups = array();
    public function add_group_control( $type, $args ) { $this->groups[ $args['name'] ] = $args + array( 'group_type' => $type ); $this->order[] = $args['name']; }
    public $tabs    = array();
    public $tab_of  = array();
    public $tab     = null;
    public function start_controls_tabs( $id ) { $this->tabs[ $id ] = array(); $this->order[] = $id; }
    public function end_controls_tabs() {}
    public function start_controls_tab( $id, $args ) { $this->tab = $id; $this->tabs[ key( array_slice( $this->tabs, -1, 1, true ) ) ][ $id ] = $args; }
    public function end_controls_tab() { $this->tab = null; }
}
class Framify_Test_Group_Control_Typography {
    public static function get_type() { return 'typography'; }
}
class_alias( 'Framify_Test_Group_Control_Typography', 'Elementor\Group_Control_Typography' );
class Framify_Test_Group_Control_Border {
    public static function get_type() { return 'border'; }
}
class_alias( 'Framify_Test_Group_Control_Border', 'Elementor\Group_Control_Border' );
class Framify_Test_Group_Control_Text_Shadow {
    public static function get_type() { return 'text-shadow'; }
}
class_alias( 'Framify_Test_Group_Control_Text_Shadow', 'Elementor\Group_Control_Text_Shadow' );
require dirname( __DIR__, 2 ) . '/framify-elementor-shapes.php';
$fs_module = new Framify_Elementor_Shapes();
$fs_el     = new Framify_Test_Element();
$fs_module->register_controls( $fs_el );
check( 'fs: one section framify_fs_section in the Framify tab', array( 'framify_fs_section' ) === array_keys( $fs_el->sections ) && Framify_Elementor::TAB === $fs_el->sections['framify_fs_section']['tab'] && 0 === $fs_el->open );
$fs_prefixed = true;
$fs_live     = true;
foreach ( $fs_el->controls as $id => $args ) {
    $fs_prefixed = $fs_prefixed && 0 === strpos( $id, 'framify_fs_' );
    $fs_live     = $fs_live && ! empty( $args['frontend_available'] ) && 'none' === $args['render_type'];
}
check( 'fs: every control id starts with framify_fs_', $fs_prefixed );
check( 'fs: every control is frontend_available + render_type none', $fs_live );
$fs_expect = array(
    'enable' => '', 'layer' => 'background', 'style' => 'mix', 'color_mode' => 'palette', 'area' => 'full',
    'direction' => 'up', 'speed' => 'normal', 'spin' => 'yes', 'color_1' => '#F69216', 'color_2' => '#263238', 'color_5' => '',
);
foreach ( $fs_expect as $key => $value ) {
    check( "fs: $key defaults to '$value'", isset( $fs_el->controls[ 'framify_fs_' . $key ] ) && $value === $fs_el->controls[ 'framify_fs_' . $key ]['default'] );
}
$fs_sizes = array( 'stroke' => 2, 'saturation' => 70, 'lightness' => 60, 'area_width' => 35, 'count' => 18, 'size' => 48, 'opacity' => 0.8 );
foreach ( $fs_sizes as $key => $value ) {
    check( "fs: $key defaults to $value", isset( $fs_el->controls[ 'framify_fs_' . $key ] ) && $value == $fs_el->controls[ 'framify_fs_' . $key ]['default']['size'] );
}
check( 'fs: count is responsive and capped at 60', ! empty( $fs_el->controls['framify_fs_count']['responsive'] ) && 60 === $fs_el->controls['framify_fs_count']['range']['px']['max'] );
check( 'fs: all eight shapes offered and on by default', array( 'square', 'circle', 'triangle', 'star', 'diagonal', 'plus', 'x', 'hexagon' ) === $fs_el->controls['framify_fs_shapes']['default'] && $fs_el->controls['framify_fs_shapes']['default'] === array_keys( $fs_el->controls['framify_fs_shapes']['options'] ) );
check( 'fs: eight shapes total', 8 === count( $fs_el->controls['framify_fs_shapes']['options'] ) );
$fs_js = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-shapes.js' );
check( 'fs: JS draws the same shape ids', false !== strpos( $fs_js, "[ 'square', 'circle', 'triangle', 'star', 'diagonal', 'plus', 'x', 'hexagon' ]" ) );
check( 'fs: speed offers custom', isset( $fs_el->controls['framify_fs_speed']['options']['custom'] ) );
check( 'fs: duration is responsive, defaults to 12s, range 2-60 step 0.5', ! empty( $fs_el->controls['framify_fs_duration']['responsive'] )
    && 12 === $fs_el->controls['framify_fs_duration']['default']['size'] && 's' === $fs_el->controls['framify_fs_duration']['default']['unit']
    && 2 === $fs_el->controls['framify_fs_duration']['range']['s']['min'] && 60 === $fs_el->controls['framify_fs_duration']['range']['s']['max']
    && 0.5 === $fs_el->controls['framify_fs_duration']['range']['s']['step'] );
check( 'fs: duration only shows when speed is custom', array( 'framify_fs_enable' => 'yes', 'framify_fs_speed' => 'custom' ) === $fs_el->controls['framify_fs_duration']['condition'] );
// __globals__ never reaches the JS, so a global-linked slot could not be read.
$fs_no_global = true;
for ( $i = 1; $i <= 5; $i++ ) {
    $fs_no_global = $fs_no_global && ! isset( $fs_el->controls[ 'framify_fs_color_' . $i ]['global'] );
}
check( 'fs: colour slots keep the Global Colour picker (resolved by framify-colors.js)', $fs_no_global );
check( 'fs: JS publishes the shared FramifyFx helpers', false !== strpos( $fs_js, 'window.FramifyFx = {' ) );

// 5b. Floating Text (framify-elementor-text.php): ids, tab, live flags, defaults, animation list.
require dirname( __DIR__, 2 ) . '/framify-elementor-text.php';
$ft_module = new Framify_Elementor_Text();
$ft_el     = new Framify_Test_Element();
$ft_module->register_controls( $ft_el );
check( 'ft: one section framify_ft_section in the Framify tab', array( 'framify_ft_section' ) === array_keys( $ft_el->sections ) && Framify_Elementor::TAB === $ft_el->sections['framify_ft_section']['tab'] && 0 === $ft_el->open );
$ft_prefixed = true;
$ft_live     = true;
$ft_css      = array( 'framify_ft_bg_color', 'framify_ft_bg_opacity', 'framify_ft_radius', 'framify_ft_padding' );
$ft_css_ok   = true;
foreach ( $ft_el->controls as $id => $args ) {
    $ft_prefixed = $ft_prefixed && 0 === strpos( $id, 'framify_ft_' );
    if ( in_array( $id, $ft_css, true ) ) {
        $ft_css_ok = $ft_css_ok && 'ui' === $args['render_type'] && empty( $args['frontend_available'] ) && ! empty( $args['selectors'] );
    } elseif ( 'heading' !== $args['type'] ) {
        $ft_live = $ft_live && ! empty( $args['frontend_available'] ) && 'none' === $args['render_type'];
    }
}
check( 'ft: every control id starts with framify_ft_', $ft_prefixed );
check( 'ft: every plain control except the CSS-only ones is frontend_available + render_type none', $ft_live );
check( 'ft: CSS-only Word Style controls are render_type ui with selectors, not frontend_available', $ft_css_ok );
$ft_typo = isset( $ft_el->groups['framify_ft_typography'] ) ? $ft_el->groups['framify_ft_typography'] : null;
check( 'ft: typography group targets the words, 28px / 600 by default, not live', $ft_typo
    && '{{WRAPPER}} > .framify-ft .framify-ft__word' === $ft_typo['selector']
    && 28 === $ft_typo['fields_options']['font_size']['default']['size'] && '600' === $ft_typo['fields_options']['font_weight']['default']
    && empty( $ft_typo['frontend_available'] ) );
$ft_expect = array(
    'enable' => '', 'words' => '', 'layer' => 'background', 'area' => 'full', 'style' => 'solid', 'color_mode' => 'palette',
    'color_1' => '#F69216', 'color_2' => '#263238', 'color_3' => '', 'color_5' => '', 'tilt' => 'none', 'animation' => 'fade',
    'direction' => 'up', 'speed' => 'normal',
);
foreach ( $ft_expect as $key => $value ) {
    check( "ft: $key defaults to '$value'", isset( $ft_el->controls[ 'framify_ft_' . $key ] ) && $value === $ft_el->controls[ 'framify_ft_' . $key ]['default'] );
}
$ft_sizes = array( 'area_width' => 35, 'count' => 5, 'stroke' => 1, 'saturation' => 70, 'lightness' => 60, 'opacity' => 0.35, 'hold' => 2.5, 'duration' => 1.2, 'gap' => 0.6 );
foreach ( $ft_sizes as $key => $value ) {
    check( "ft: $key defaults to $value", isset( $ft_el->controls[ 'framify_ft_' . $key ] ) && $value == $ft_el->controls[ 'framify_ft_' . $key ]['default']['size'] );
}
check( 'ft: count is responsive, 1-20', ! empty( $ft_el->controls['framify_ft_count']['responsive'] ) && 1 === $ft_el->controls['framify_ft_count']['range']['px']['min'] && 20 === $ft_el->controls['framify_ft_count']['range']['px']['max'] );
check( 'ft: duration is responsive, 0.3-10 s, only for custom speed', ! empty( $ft_el->controls['framify_ft_duration']['responsive'] )
    && 0.3 === $ft_el->controls['framify_ft_duration']['range']['s']['min'] && 10 === $ft_el->controls['framify_ft_duration']['range']['s']['max']
    && array( 'framify_ft_enable' => 'yes', 'framify_ft_speed' => 'custom' ) === $ft_el->controls['framify_ft_duration']['condition'] );
check( 'ft: words textarea, 6 rows, AI off', 'textarea' === $ft_el->controls['framify_ft_words']['type'] && 6 === $ft_el->controls['framify_ft_words']['rows'] && false === $ft_el->controls['framify_ft_words']['ai']['active'] );
check( 'ft: outline width hidden for solid', array( 'framify_ft_enable' => 'yes', 'framify_ft_style!' => 'solid' ) === $ft_el->controls['framify_ft_stroke']['condition'] );
check( 'ft: direction shows for drift and random', array( 'drift', 'random' ) === $ft_el->controls['framify_ft_direction']['condition']['framify_ft_animation'] );
$ft_no_global = true;
for ( $i = 1; $i <= 5; $i++ ) {
    $ft_no_global = $ft_no_global && ! isset( $ft_el->controls[ 'framify_ft_color_' . $i ]['global'] );
}
check( 'ft: colour slots keep the Global Colour picker (resolved by framify-colors.js)', $ft_no_global );
$ft_anims = array_keys( $ft_el->controls['framify_ft_animation']['options'] );
check( 'ft: animation list is random + ten', 'random' === $ft_anims[0] && 11 === count( $ft_anims ) );
$ft_js = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-text.js' );
check( 'ft: JS runs the same animation ids', false !== strpos( $ft_js, "var ANIMATIONS = [ '" . implode( "', '", array_slice( $ft_anims, 1 ) ) . "' ];" ) );
check( 'ft: JS never writes innerHTML', false === strpos( $ft_js, 'innerHTML' ) );
$ft_ids = array_keys( $ft_el->controls );
check( 'ft: controls follow the approved order', array_search( 'framify_ft_enable', $ft_ids, true ) < array_search( 'framify_ft_words', $ft_ids, true )
    && array_search( 'framify_ft_hold', $ft_ids, true ) < array_search( 'framify_ft_speed', $ft_ids, true ) );

// 5c. Floating Text Word Style: chip controls, defaults, conditions, CSS-only keys.
$ft_c  = $ft_el->controls;
$ft_on = array( 'framify_ft_enable' => 'yes' );
$ft_o  = $ft_el->order;
$ft_at = array_search( 'framify_ft_typography', $ft_o, true );
check( 'ftws: Word Style heading directly after Typography, then the style controls in order', false !== $ft_at
    && array( 'framify_ft_word_style', 'framify_ft_min_size', 'framify_ft_bg_mode', 'framify_ft_bg_color', 'framify_ft_bg_opacity', 'framify_ft_border', 'framify_ft_radius', 'framify_ft_text_shadow', 'framify_ft_padding', 'framify_ft_style' ) === array_slice( $ft_o, $ft_at + 1, 10 )
    && 'heading' === $ft_c['framify_ft_word_style']['type'] && $ft_on === $ft_c['framify_ft_word_style']['condition'] );
check( 'ftws: size variation and max size controls are gone', ! isset( $ft_c['framify_ft_size_var'] ) && ! isset( $ft_c['framify_ft_max_size'] ) );
$ft_min = isset( $ft_c['framify_ft_min_size'] ) ? $ft_c['framify_ft_min_size'] : null;
check( 'ftws: min size is a responsive px slider 6-200, empty by default, live (JS-read), no selectors', $ft_min && 'slider' === $ft_min['type']
    && 'Min font size (px)' === $ft_min['label'] && ! empty( $ft_min['responsive'] ) && array( 'px' ) === $ft_min['size_units']
    && array( 'unit' => 'px', 'size' => '' ) === $ft_min['default']
    && 6 === $ft_min['range']['px']['min'] && 200 === $ft_min['range']['px']['max']
    && ! empty( $ft_min['frontend_available'] ) && 'none' === $ft_min['render_type'] && ! isset( $ft_min['selectors'] ) && $ft_on === $ft_min['condition'] );
check( 'ftws: bg mode none|fixed|palette, default none, live (JS-read)', 'select' === $ft_c['framify_ft_bg_mode']['type'] && 'none' === $ft_c['framify_ft_bg_mode']['default']
    && array( 'none', 'fixed', 'palette' ) === array_keys( $ft_c['framify_ft_bg_mode']['options'] )
    && ! empty( $ft_c['framify_ft_bg_mode']['frontend_available'] ) && 'none' === $ft_c['framify_ft_bg_mode']['render_type'] && $ft_on === $ft_c['framify_ft_bg_mode']['condition'] );
check( 'ftws: bg colour is CSS-only (--ft-bg on the chip), fixed only, global picker left on', 'color' === $ft_c['framify_ft_bg_color']['type']
    && array( '{{WRAPPER}} > .framify-ft .framify-ft__word' => '--ft-bg: {{VALUE}};' ) === $ft_c['framify_ft_bg_color']['selectors']
    && $ft_on + array( 'framify_ft_bg_mode' => 'fixed' ) === $ft_c['framify_ft_bg_color']['condition'] && ! isset( $ft_c['framify_ft_bg_color']['global'] ) );
check( 'ftws: bg opacity 0-1 step 0.05, default 1, fixed + palette', 1 == $ft_c['framify_ft_bg_opacity']['default']['size']
    && 0 === $ft_c['framify_ft_bg_opacity']['range']['px']['min'] && 1 === $ft_c['framify_ft_bg_opacity']['range']['px']['max'] && 0.05 === $ft_c['framify_ft_bg_opacity']['range']['px']['step']
    && $ft_on + array( 'framify_ft_bg_mode!' => 'none' ) === $ft_c['framify_ft_bg_opacity']['condition'] );
check( 'ftws: border group on the chip, ui', isset( $ft_el->groups['framify_ft_border'] ) && 'border' === $ft_el->groups['framify_ft_border']['group_type']
    && '{{WRAPPER}} > .framify-ft .framify-ft__word' === $ft_el->groups['framify_ft_border']['selector'] && 'ui' === $ft_el->groups['framify_ft_border']['fields_options']['__all']['render_type'] );
check( 'ftws: text shadow group on the text span, ui', isset( $ft_el->groups['framify_ft_text_shadow'] ) && 'text-shadow' === $ft_el->groups['framify_ft_text_shadow']['group_type']
    && '{{WRAPPER}} > .framify-ft .framify-ft__text' === $ft_el->groups['framify_ft_text_shadow']['selector'] && 'ui' === $ft_el->groups['framify_ft_text_shadow']['fields_options']['__all']['render_type'] );
foreach ( array( 'radius' => array( 'border-radius', array( 'px', '%', 'em' ) ), 'padding' => array( 'padding', array( 'px', 'em', '%' ) ) ) as $key => $spec ) {
    $ctl = $ft_c[ 'framify_ft_' . $key ];
    check( "ftws: $key is responsive DIMENSIONS on the chip, empty by default", 'dimensions' === $ctl['type'] && ! empty( $ctl['responsive'] ) && ! isset( $ctl['default'] )
        && $spec[1] === $ctl['size_units'] && 0 === strpos( $ctl['selectors']['{{WRAPPER}} > .framify-ft .framify-ft__word'], $spec[0] . ':' ) );
}
// The JS ignore list must cover every CSS-only control (typography included), or a style edit would rebuild the layer.
preg_match( '/var CSS_KEYS = \[([^\]]*)\];/', $ft_js, $ft_m );
$ft_keys  = isset( $ft_m[1] ) ? array_map( function ( $k ) { return trim( $k, " '" ); }, explode( ',', $ft_m[1] ) ) : array();
$ft_want  = array_merge( array( 'framify_ft_typography', 'framify_ft_border', 'framify_ft_text_shadow' ), $ft_css );
sort( $ft_want );
$ft_sorted = $ft_keys;
sort( $ft_sorted );
check( 'ftws: JS CSS_KEYS = typography + border + text shadow groups + the CSS-only controls, not bg_mode', $ft_want === $ft_sorted );
check( 'ftws: JS ignore list has neither max_size nor min_size (min size is JS-read, so it rebuilds)', ! in_array( 'framify_ft_max_size', $ft_keys, true ) && ! in_array( 'framify_ft_min_size', $ft_keys, true ) );
check( 'ftws: JS reads min_size responsively and writes the final size on the word (chip), not the text or mask', false !== strpos( $ft_js, "Fx.readResponsive( this, PREFIX + 'min_size', NaN, 6, 200 )" )
    && false !== strpos( $ft_js, 'word.style.fontSize = wordSize( maxPx, fx.minPx )' )
    && false === strpos( $ft_js, 'text.style.fontSize' ) && false === strpos( $ft_js, 'mask.style.fontSize' ) && false === strpos( $ft_js, 'size_var' ) );
check( 'ftws: Max opacity on the mask, moved to the whole chip when dressed', false !== strpos( $ft_js, 'mask.style.opacity = w.alpha;' )
    && false !== strpos( $ft_js, 'w.el.style.opacity = w.alpha;' ) && false === strpos( $ft_js, 'CONTRAST_AT' ) );
$ft_css_src = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-text.css' );
check( 'ftws: CSS has no --ft-max cap or --ft-scale sizing any more (the mask inherits the word size)', false === strpos( $ft_css_src, '--ft-max' ) && false === strpos( $ft_css_src, '--ft-scale' ) );

// 6. Organic Shape: Flat edge for Custom, Flip for every shape, Rotate for Custom.
foreach ( array( 'image' => false, 'container' => true ) as $type => $is_container ) {
    $org = new Framify_Test_Element();
    framify_call( $module, 'register_controls', $org, $is_container );
    $c    = $org->controls;
    $ids  = array_keys( $c );
    $edge = array_search( 'framify_org_edge', $ids, true );
    check( "org $type: flat edge offered for wavy + flow + custom", isset( $c['framify_org_edge'] )
        && array_merge( framify_call( $module, 'wavy_ids' ), framify_call( $module, 'flow_ids' ), array( 'custom' ) ) === framify_shape_ids( $c['framify_org_edge'] ) );
    check( "org $type: flip + rotate follow the flat edge control", false !== $edge
        && array( 'framify_org_flip_h', 'framify_org_flip_v', 'framify_org_custom_rotate' ) === array_slice( $ids, $edge + 1, 3 ) );
    foreach ( array( 'flip_h', 'flip_v' ) as $key ) {
        check( "org $type: $key is an off switch for every shape", isset( $c[ 'framify_org_' . $key ] ) && 'switcher' === $c[ 'framify_org_' . $key ]['type']
            && '' === $c[ 'framify_org_' . $key ]['default'] && array( 'framify_org_enable' => 'yes' ) === $c[ 'framify_org_' . $key ]['condition']
            && ! empty( $c[ 'framify_org_' . $key ]['frontend_available'] ) && 'none' === $c[ 'framify_org_' . $key ]['render_type'] );
    }
    $rot = isset( $c['framify_org_custom_rotate'] ) ? $c['framify_org_custom_rotate'] : null;
    check( "org $type: custom rotate 0/90/180/270, default 0, custom only", $rot && 'select' === $rot['type'] && '0' === $rot['default']
        && array( '0', '90', '180', '270' ) === array_map( 'strval', array_keys( $rot['options'] ) )
        && array( 'custom' ) === framify_shape_ids( $rot )
        && ! empty( $rot['frontend_available'] ) && 'none' === $rot['render_type'] );
}

// 7. Spacer support: all three modules hook the Spacer's only section
//    (section_spacer, elementor/includes/widgets/spacer.php) in tab order.
$sp_hook  = 'elementor/element/spacer/section_spacer/after_section_end';
$sp_calls = framify_hooked( $sp_hook );
$sp_by    = array();
foreach ( $sp_calls as $call ) {
    $sp_by[ get_class( $call[1] ) ] = $call;
}
check( 'spacer: exactly three callbacks on ' . $sp_hook, 3 === count( $sp_calls ) );
check( 'spacer: Organic Shape at 10 via register_spacer_controls', isset( $sp_by['Framify_Elementor'] )
    && 10 === $sp_by['Framify_Elementor'][0] && 'register_spacer_controls' === $sp_by['Framify_Elementor'][2] );
check( 'spacer: Floating Shapes at 20 via register_controls', isset( $sp_by['Framify_Elementor_Shapes'] )
    && 20 === $sp_by['Framify_Elementor_Shapes'][0] && 'register_controls' === $sp_by['Framify_Elementor_Shapes'][2] );
check( 'spacer: Floating Text at 30 via register_spacer_controls', isset( $sp_by['Framify_Elementor_Text'] )
    && 30 === $sp_by['Framify_Elementor_Text'][0] && 'register_spacer_controls' === $sp_by['Framify_Elementor_Text'][2] );
check( 'spacer: no other hook mentions the spacer', count( array_filter( $GLOBALS['framify_actions'], function ( $a ) use ( $sp_hook ) {
    return false !== strpos( $a['hook'], 'spacer' ) && $sp_hook !== $a['hook'];
} ) ) === 0 );
$con_prio = array_map( function ( $c ) { return $c[0] . ' ' . $c[2]; }, framify_hooked( 'elementor/element/container/_section_responsive/after_section_end' ) );
sort( $con_prio );
check( 'spacer: container hooks unchanged (10 / 20 / 30, plus Float at 40)', array( '10 register_container_controls', '20 register_controls', '30 register_controls', '40 register_float_controls' ) === $con_prio );

// Organic Shape: the container set, except that the deco controls move to
// an Image-widget-style Deco Blob section (same ids as the Image widget's),
// whose extra blob only exists in Clip mode.
$sp_org  = new Framify_Test_Element();
$con_org = new Framify_Test_Element();
$img_org = new Framify_Test_Element();
call_user_func( array( $sp_by['Framify_Elementor'][1], $sp_by['Framify_Elementor'][2] ), $sp_org );
$module->register_container_controls( $con_org );
$module->register_image_controls( $img_org );

// --controls-baseline: freeze every Organic Shape / Deco Blob / Grain control
// (type, default, option keys, label, conditions) so a refactor can prove it
// only added controls and loosened Deco Blob conditions.
if ( in_array( '--controls-baseline', $argv, true ) ) {
    $dump = array();
    foreach ( array( 'container' => $con_org, 'spacer' => $sp_org, 'image' => $img_org ) as $kind => $el ) {
        foreach ( $el->controls as $id => $args ) {
            $dump[ $kind ][ $id ] = array(
                'section'    => $el->section_of[ $id ],
                'type'       => isset( $args['type'] ) ? $args['type'] : null,
                'default'    => isset( $args['default'] ) ? $args['default'] : null,
                'options'    => isset( $args['options'] ) && is_array( $args['options'] ) ? array_keys( $args['options'] ) : null,
                'label'      => isset( $args['label'] ) ? $args['label'] : null,
                'condition'  => isset( $args['condition'] ) ? $args['condition'] : null,
                'conditions' => isset( $args['conditions'] ) ? $args['conditions'] : null,
            );
        }
        $dump[ $kind . '_sections' ] = array_keys( $el->sections );
    }
    file_put_contents( __DIR__ . '/organic-controls-baseline.json', json_encode( $dump, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) );
    echo 'Controls baseline written: ' . count( $dump['container'] ) . ' container / ' . count( $dump['spacer'] ) . ' spacer / ' . count( $dump['image'] ) . " image controls\n";
    exit;
}
$in_section = function ( $el, $section ) {
    return array_keys( array_filter( $el->section_of, function ( $s ) use ( $section ) { return $section === $s; } ) );
};
$sp_c      = $sp_org->controls;
$sp_on     = array( 'framify_org_enable' => 'yes' );
$sp_either = array( 'relation' => 'or', 'terms' => array(
    array( 'name' => 'framify_org_mode', 'operator' => '===', 'value' => 'deco' ),
    array( 'relation' => 'and', 'terms' => array(
        array( 'name' => 'framify_org_mode', 'operator' => '===', 'value' => 'clip' ),
        array( 'name' => 'framify_org_deco', 'operator' => '===', 'value' => 'yes' ),
    ) ),
) );
check( 'spacer: organic sections are Organic Shape, Deco Blob, Grain', array( 'framify_org_section', 'framify_deco_section', 'framify_grain_section' ) === array_keys( $sp_org->sections ) && 0 === $sp_org->open );
check( 'spacer: the Deco Blob section has no condition, so it shows with Organic Shape on or off', ! isset( $sp_org->sections['framify_deco_section']['condition'] ) && ! isset( $sp_org->sections['framify_deco_section']['conditions'] ) );
check( 'spacer: Organic Shape section = the container one', $in_section( $con_org, 'framify_org_section' ) === $in_section( $sp_org, 'framify_org_section' ) );
$sp_same = true;
foreach ( $in_section( $sp_org, 'framify_org_section' ) as $id ) {
    $sp_same = $sp_same && $con_org->controls[ $id ] === $sp_c[ $id ];
}
check( 'spacer: Organic Shape control args equal the container ones (Mode clip / behind content kept)', $sp_same && isset( $sp_c['framify_org_mode'] ) );
$sp_deco_ids  = $in_section( $sp_org, 'framify_deco_section' );
$img_deco_ids = $in_section( $img_org, 'framify_deco_section' );
check( 'spacer: Deco Blob ids equal the container ones; the Image widget has the same minus the container-only note and grain switch, in order',
    $sp_deco_ids === $in_section( $con_org, 'framify_deco_section' )
    && array_values( array_diff( $sp_deco_ids, array( 'framify_org_deco_note_shared', 'framify_org_deco_grain' ) ) ) === $img_deco_ids && count( $sp_deco_ids ) > 30 );
check( 'spacer: the deco switch has no condition (Mode and Organic Shape do not hide it), default off', ! isset( $sp_c['framify_org_deco']['condition'] ) && '' === $sp_c['framify_org_deco']['default'] );
$sp_look = array( 'framify_org_deco_style', 'framify_org_deco_outline_color', 'framify_org_deco_outline_width', 'framify_org_deco_color' );
$sp_free = true;
foreach ( $sp_deco_ids as $id ) {
    if ( 'framify_org_deco_note_shared' === $id ) {
        continue;
    }
    $c    = $sp_c[ $id ];
    $json = json_encode( array( isset( $c['condition'] ) ? $c['condition'] : array(), isset( $c['conditions'] ) ? $c['conditions'] : array() ) );
    $sp_free = $sp_free && false === strpos( $json, 'framify_org_mode' ) && false === strpos( $json, '"framify_org_deco"' ) && ! isset( $c['condition']['framify_org_enable'] );
}
check( 'spacer: no Deco Blob control depends on Mode, the deco switch or the Organic Shape switch (every one is always visible; only intrinsic terms remain)', $sp_free );
$sp_args_ok = true;
foreach ( $sp_deco_ids as $id ) {
    if ( ! isset( $img_org->controls[ $id ] ) ) {
        continue;
    }
    $a = $sp_c[ $id ];
    $b = $img_org->controls[ $id ];
    unset( $a['condition'], $a['conditions'], $a['description'], $b['condition'], $b['conditions'], $b['description'] );
    if ( 'framify_org_deco_trigger' === $id ) {
        unset( $a['options']['same'], $b['options']['same'] );
    }
    $sp_args_ok = $sp_args_ok && $a === $b;
}
check( 'spacer: deco control args equal the Image widget ones (bar conditions and the image/shape wording)', $sp_args_ok );
check( 'spacer: grain keeps both container switches (saved values carry over); the blob\'s now sits in the Deco Blob section; no image target or zoom', isset( $sp_c['framify_org_deco_grain'], $sp_c['framify_org_clip_grain'] )
    && 'yes' === $sp_c['framify_org_deco_grain']['default'] && '' === $sp_c['framify_org_clip_grain']['default']
    && 'framify_deco_section' === $sp_org->section_of['framify_org_deco_grain'] && array( 'framify_org_deco_style!' => 'outline' ) === $sp_c['framify_org_deco_grain']['condition']
    && $sp_on + array( 'framify_org_mode' => array( 'clip', 'bg' ) ) === $sp_c['framify_org_clip_grain']['condition']
    && ! isset( $sp_c['framify_org_zoom'] ) && ! isset( $sp_c['framify_org_grain_target'] ) );
check( 'spacer: no control outside the container + image sets', array() === array_diff( array_keys( $sp_c ), array_keys( $con_org->controls ), array_keys( $img_org->controls ) ) );

// Containers get the Spacer's Deco Blob section (Clip-mode extra blob; the
// look controls also style Behind content mode); the Image widget keeps its own.
$con_c = $con_org->controls;
check( 'container: sections Organic Shape, Deco Blob, Grain', array( 'framify_org_section', 'framify_deco_section', 'framify_grain_section' ) === array_keys( $con_org->sections ) && 0 === $con_org->open );
check( 'container: the Deco Blob section has no condition, same ids as the Spacer, in order', ! isset( $con_org->sections['framify_deco_section']['condition'] ) && ! isset( $con_org->sections['framify_deco_section']['conditions'] )
    && $in_section( $sp_org, 'framify_deco_section' ) === $in_section( $con_org, 'framify_deco_section' ) );
check( 'container + spacer: Clip background only has colour + overlay + opacity, CSS only (no frontend_available), mode bg', isset( $con_c['framify_orgbg_color'], $con_c['framify_orgbg_overlay'], $con_c['framify_orgbg_overlay_opacity'], $sp_c['framify_orgbg_color'] )
    && 'bg' === $con_c['framify_orgbg_color']['condition']['framify_org_mode'] && empty( $con_c['framify_orgbg_color']['frontend_available'] ) && isset( $con_c['framify_org_mode']['options']['bg'] ) && ! isset( $con_c['framify_orgbg_color']['global'] ) );
check( 'container: deco switch registered without a condition', ! isset( $con_c['framify_org_deco']['condition'] ) && '' === $con_c['framify_org_deco']['default'] );
$con_deco_same = true;
foreach ( $in_section( $con_org, 'framify_deco_section' ) as $id ) {
    $con_deco_same = $con_deco_same && $sp_c[ $id ] === $con_c[ $id ];
}
check( 'container: Deco Blob control args equal the Spacer ones (Same as shape wording)', $con_deco_same && 'Same as shape' === $con_c['framify_org_deco_trigger']['options']['same'] );
check( 'container: no deco heading left in Organic Shape', ! isset( $con_c['framify_org_deco_heading'] ) && ! isset( $sp_c['framify_org_deco_heading'] ) );
check( 'container: grain = the Spacer switches, own fill wording', $sp_c['framify_org_deco_grain'] === $con_c['framify_org_deco_grain']
    && $sp_on + array( 'framify_org_mode' => array( 'clip', 'bg' ) ) === $con_c['framify_org_clip_grain']['condition'] && 'Grain on container fill' === $con_c['framify_org_clip_grain']['label'] && '' === $con_c['framify_org_clip_grain']['default'] );
check( 'container: no image-only controls', ! isset( $con_c['framify_org_zoom'] ) && ! isset( $con_c['framify_org_grain_target'] ) );
$img_look_ok = true;
foreach ( $sp_look as $id ) {
    $img_look_ok = $img_look_ok && ! isset( $img_org->controls[ $id ]['conditions'] ) && ! isset( $img_org->controls[ $id ]['condition']['framify_org_deco'] ) && ! isset( $img_org->controls[ $id ]['condition']['framify_org_enable'] );
}
check( 'image: the deco look controls depend only on the style, and the switch has no condition', $img_look_ok && ! isset( $img_org->controls['framify_org_deco']['condition'] ) );
check( 'image: deco trigger still says Same as image', 'Same as image' === $img_org->controls['framify_org_deco_trigger']['options']['same'] );

// Floating Shapes / Text: same ids; Text scopes its CSS to the Spacer's layer as a descendant.
$sp_fs = new Framify_Test_Element();
call_user_func( array( $sp_by['Framify_Elementor_Shapes'][1], $sp_by['Framify_Elementor_Shapes'][2] ), $sp_fs );
check( 'spacer: floating shapes controls equal the container ones', $fs_el->controls === $sp_fs->controls && $fs_el->sections === $sp_fs->sections );
$sp_ft = new Framify_Test_Element();
call_user_func( array( $sp_by['Framify_Elementor_Text'][1], $sp_by['Framify_Elementor_Text'][2] ), $sp_ft );
check( 'spacer: floating text control ids equal the container ones', array_keys( $ft_el->controls ) === array_keys( $sp_ft->controls ) && array_keys( $ft_el->groups ) === array_keys( $sp_ft->groups ) );
$sp_sel_ok = '{{WRAPPER}} .framify-ft .framify-ft__word' === $sp_ft->groups['framify_ft_typography']['selector']
    && '{{WRAPPER}} .framify-ft .framify-ft__text' === $sp_ft->groups['framify_ft_text_shadow']['selector']
    && isset( $sp_ft->controls['framify_ft_padding']['selectors']['{{WRAPPER}} .framify-ft .framify-ft__word'] );
check( 'spacer: floating text CSS targets the layer as a descendant (it sits in .elementor-widget-container)', $sp_sel_ok );
$sp_leak = false;
foreach ( array_merge( $ft_el->controls, $ft_el->groups ) as $args ) {
    $sels = array_merge( isset( $args['selectors'] ) ? array_keys( $args['selectors'] ) : array(), isset( $args['selector'] ) ? array( $args['selector'] ) : array() );
    foreach ( $sels as $sel ) {
        $sp_leak = $sp_leak || 0 !== strpos( $sel, '{{WRAPPER}} > .framify-ft' );
    }
}
check( 'spacer: container floating text selectors still use the direct-child layer', ! $sp_leak );

// The whole Spacer panel, all hooked callbacks in priority order on one stub.
$sp_all   = new Framify_Test_Element();
$sp_sorted = $sp_calls;
usort( $sp_sorted, function ( $a, $b ) { return $a[0] - $b[0]; } );
foreach ( $sp_sorted as $call ) {
    call_user_func( array( $call[1], $call[2] ), $sp_all );
}
check( 'spacer: Framify sections in order Organic Shape, Deco Blob, Grain, Floating Shapes, Floating Text',
    array( 'framify_org_section', 'framify_deco_section', 'framify_grain_section', 'framify_fs_section', 'framify_ft_section' ) === array_keys( $sp_all->sections ) );

// JS: the handlers attach to the spacer widget and pick the painting host.
$org_js = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-elementor.js' );
check( 'spacer: JS attaches all three handlers to the spacer (default skin)', false !== strpos( $org_js, "attachHandler( 'spacer', OrganicShape );" )
    && false !== strpos( $fs_js, "attachHandler( 'spacer', FloatingShapes );" ) && false !== strpos( $ft_js, "attachHandler( 'spacer', FloatingText );" ) );
check( 'spacer: organic routes the spacer to setupContainer on its painting host', false !== strpos( $org_js, "if ( spacer || 'container' === this.getElementType() ) {" )
    && false !== strpos( $org_js, 'paintHost( this.$element[ 0 ] )' ) );
check( 'spacer + container: Clip mode with the deco on clips a fill layer carrying the copied background, not the host', false !== strpos( $org_js, "if ( 'bg' === s.framify_org_mode || ( 'clip' === s.framify_org_mode && 'yes' === s.framify_org_deco ) ) {" )
    && false !== strpos( $org_js, "fill.className = 'framify-organic__fill';" ) && false !== strpos( $org_js, "el.style.setProperty( 'background', 'none', 'important' );" ) );
check( 'spacer: Clip mode without the deco keeps the host clip (setupContainer)', 1 === preg_match( "/this\\.setupFill\\( el, id, s \\);\\s*\\} else \\{.*?this\\.setupContainer\\( el, id, s \\);/s", $org_js ) );
check( 'spacer: background and border changes rebuild the fill (not Space: CSS insets follow the height)', false !== strpos( $org_js, "var FILL_KEYS = [ '_background_', '_border_' ];" )
    && false !== strpos( $org_js, "return 'spacer' === this.getWidgetType() ? FILL_KEYS : CONTAINER_FILL_KEYS;" ) && false !== strpos( $org_js, "fillKey( keys[ i ], FILL_KEYS )" ) );
check( 'container: its own background / border keys rebuild a fill', false !== strpos( $org_js, "var CONTAINER_FILL_KEYS = [ 'background_', 'border_' ];" ) );
check( 'spacer: the fill re-copies on a breakpoint or margin change', false !== strpos( $org_js, 'if ( device === fx.fillDevice && marginKey( margin ) === marginKey( fx.fillMargin ) ) {' ) && false !== strpos( $org_js, 'fx.taken = takeBackground( fx.el, fx.fill, margin );' ) );
check( 'spacer: the fill reaches a margin (20% of the larger side, max 200 px) past the host box', false !== strpos( $org_js, 'var FILL_MARGIN_RATIO = 0.2;' ) && false !== strpos( $org_js, 'var FILL_MARGIN_MAX = 200;' )
    && false !== strpos( $org_js, "fill.style.top = -( ( parseFloat( cs.borderTopWidth ) || 0 ) + m.top ) + 'px';" ) && false !== strpos( $org_js, 'fx.taken = takeBackground( el, null, fx.fillMargin );' )
    && false !== strpos( $org_js, "return 'spacer' === this.getWidgetType() ? m : fillSides( el, m );" ) );
check( 'container: the fill margin stops at the page\'s left / right edge (no horizontal scrollbar)', false !== strpos( $org_js, 'right: Math.max( 0, Math.min( m, Math.floor( room ) ) ),' ) && false !== strpos( $org_js, 'left: Math.max( 0, Math.min( m, Math.floor( left ) ) )' ) );
check( 'spacer: the fill clip maps the shape back into the host box', false !== strpos( $org_js, 'x: ( s.left + box.x * w ) / fw,' ) && false !== strpos( $org_js, 'w: box.w * w / fw,' )
    && false !== strpos( $org_js, 'var clipBox = fx.fill && ! fx.bleed ? fillBox( box, hostW, hostH, fx.fillMargin ) : box;' ) && false !== strpos( $org_js, 'fx.clip.origin = zoomOrigin( clipBox, fx.zoomSide );' ) );
// A0: bleed only for a Container in Clip mode with a moving custom shape.
check( 'organic: bg mode always takes the fill path, and the Deco Blob is drawn there whenever its switch is on', false !== strpos( $org_js, "'bg' === s.framify_org_mode ||" )
    && false === strpos( $org_js, "'bg' !== s.framify_org_mode" ) && 1 === preg_match( "/Own id: the clip grain above already uses id \+ '-grain'\..*?if \( 'yes' === s\.framify_org_deco \) \{\s*var extra = this\.ownDeco\(/s", $org_js ) );
$lib = framify_call( new Framify_Elementor(), 'library_shapes' );
check( 'library: assets/shapes svgs are listed as lib_* with a title and a thumbnail built from path data only', isset( $lib['lib_soft-leaf'] ) && 'Soft Leaf' === $lib['lib_soft-leaf']['title']
    && 0 === strpos( $lib['lib_soft-leaf']['thumb'], 'data:image/svg+xml,' ) && false === strpos( rawurldecode( $lib['lib_soft-leaf']['thumb'] ), 'script' ) );
check( 'library: Built-in | Uploaded tab + uploaded picker on the Organic Shape and Deco Blob, picker hidden unless the Uploaded tab is on', isset( $con_c['framify_org_shape_source'], $con_c['framify_org_shape_lib'], $con_c['framify_org_deco_shape_source'], $con_c['framify_org_deco_shape_lib'] )
    && 'builtin' === $con_c['framify_org_shape_source']['default'] && 'library' === $con_c['framify_org_shape_lib']['condition']['framify_org_shape_source']
    && 'library' === $con_c['framify_org_shape']['condition']['framify_org_shape_source!'] && isset( $con_c['framify_org_shape_lib']['options']['lib_soft-leaf'] ) );
check( 'library: uploaded shapes reach the script and run through the Custom pipeline (library svg -> custom paste), for the shape and the Deco Blob', false !== strpos( $org_js, 'out.framify_org_custom_svg = svg;' )
    && false !== strpos( $org_js, "var s = libraryShape( window.FramifyColor.settings( this ) );" ) && false !== strpos( $org_js, 'return libraryShape( out );' ) );
$sl = 'Framify_Shape_Library';
check( 'library sanitiser: the path limit leaves room for the svg wrapper (a max-size path still saves under MAX_BYTES)', '' !== $sl::clean_d( str_repeat( 'M0 0 ', 9800 ) ) && '' === $sl::clean_d( str_repeat( 'M0 0 ', 9801 ) ) && strlen( $sl::build_svg( substr( str_repeat( 'M0 0 ', 9800 ), 0, $sl::MAX_D ), '0 0 1000 1000' ) ) < $sl::MAX_BYTES );
check( 'library sanitiser: path data keeps only path characters; markup, script and url() are refused', 'M0 0 L10 10 Z' === $sl::clean_d( "M0 0\nL10  10 Z" ) && '' === $sl::clean_d( 'M0 0 <script>alert(1)</script>' ) && '' === $sl::clean_d( 'url(#x)' ) && '' === $sl::clean_d( '' ) );
check( 'library sanitiser: viewBox must be four numbers (else 0 0 100 100); parse keeps only d + viewBox', '0 0 100 100' === $sl::clean_viewbox( '0 0 100 x' ) && '0 0 200 50' === $sl::clean_viewbox( '0,0,200,50' )
    && array( 'd' => 'M0 0L9 9Z', 'vb' => '0 0 40 30' ) === $sl::parse( '<svg viewBox="0 0 40 30" onload="x()"><script>1</script><path d="M0 0L9 9Z" fill="red"/></svg>' )
    && null === $sl::parse( '<svg><circle r="4"/></svg>' ) && null === $sl::parse( 'not svg' ) );
check( 'library: a saved file is regenerated as a plain svg > path (no attributes from the input)', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><path d="M0 0L9 9Z"/></svg>' === $sl::build_svg( 'M0 0L9 9Z', '0 0 40 30' ) );
check( 'library: save / delete are nonce + capability guarded; user shapes live in uploads, delete only touches user shapes', false !== strpos( file_get_contents( dirname( __DIR__, 2 ) . '/framify-shape-library.php' ), "check_ajax_referer('framify_shapes', 'nonce')" )
    && false !== strpos( file_get_contents( dirname( __DIR__, 2 ) . '/framify-shape-library.php' ), "current_user_can('upload_files')" ) && false !== strpos( file_get_contents( dirname( __DIR__, 2 ) . '/framify-shape-library.php' ), "'user' !== \$all[\$id]['source']" ) );
check( 'bleed: gate = container, Clip mode, custom shape, moving (Liquid / Gentle), deco off', false !== strpos( $org_js, "fx.bleed = ! spacer && 'clip' === s.framify_org_mode && !! custom && !! fx.motion;" )
    && 1 === preg_match( "/if \\( 'bg' === s\\.framify_org_mode \\|\\| \\( 'clip' === s\\.framify_org_mode && 'yes' === s\\.framify_org_deco \\) \\) \\{\\s*this\\.setupFill\\( el, id, s \\);\\s*\\} else \\{.*?fx\\.bleed = /s", $org_js ) );
check( 'bleed: the host keeps its clip and handle rect; the fill is not clipped; grain goes inside it', 1 === preg_match( "/el\\.style\\.clipPath = 'url\\(#' \\+ id \\+ '\\)';.*?this\\.keepHandle\\( el, clip\\.path\\.parentNode \\);\\s*\\}\\s*if \\( fx\\.bleed \\) \\{.*?this\\.bleedLayers\\( el, id, s \\);\\s*return;/s", $org_js )
    && 1 === preg_match( '/bleedLayers: function \( el, id, s \) \{(?:(?!clipPath).)*?fill\.appendChild\( buildGrainLayer\( id, grainOptions\( s, el \) \) \);(?:(?!clipPath).)*?this\.spill\( el \);/s', $org_js ) );
check( 'bleed: the fill re-copies on refill and rewrites the overlay vars', 1 === preg_match( '/fx\.taken = takeBackground\( fx\.el, fx\.fill, margin \);\s*if \( fx\.bleed \) \{\s*this\.bleedVars\(\);/', $org_js )
    && false !== strpos( $org_js, "var BLEED_VARS = [ '--framify-bleed-t', '--framify-bleed-r', '--framify-bleed-b', '--framify-bleed-l', '--framify-bleed-tl', '--framify-bleed-tr', '--framify-bleed-br', '--framify-bleed-bl' ];" ) );
check( 'bleed: a lazy-loaded background re-copies when e-lazyloaded arrives (containers only)', false !== strpos( $org_js, "'spacer' !== this.getWidgetType() && el.closest ? el.closest( '.e-con.e-parent:not(.e-lazyloaded)' ) : null;" ) );
$bleed_css = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-elementor.css' );
check( 'bleed CSS: overlay ::before, slideshow and video layers reach the per-side margins with the grown radii', 1 === preg_match( '/\.e-con\.framify-organic-bleed::before,\s*\.e-con\.framify-organic-bleed > \.elementor-background-slideshow,\s*:is\(\.e-con\.framify-organic-bleed, \.e-con\.framify-organic-bleed > \.e-con-inner\) > \.elementor-background-video-container \{([^}]*)\}/', $bleed_css, $bleed_m )
    && false !== strpos( $bleed_m[1], 'top: calc(0px - var(--border-top-width, 0px) - var(--framify-bleed-t, 0px));' )
    && false !== strpos( $bleed_m[1], 'left: calc(0px - var(--border-left-width, 0px) - var(--framify-bleed-l, 0px));' )
    && false !== strpos( $bleed_m[1], '+ var(--framify-bleed-l, 0px) + var(--framify-bleed-r, 0px));' ) && false !== strpos( $bleed_m[1], '+ var(--framify-bleed-t, 0px) + var(--framify-bleed-b, 0px));' )
    && false !== strpos( $bleed_m[1], 'border-top-left-radius: var(--framify-bleed-tl, 0px);' ) );
check( 'editor: the handle rect is editor-only and only on the element owning the overlay', false !== strpos( $org_js, "if ( elementorFrontend.isEditMode() && el === this.\$element[ 0 ] ) {\n\t\t\t\t\t\tthis.keepHandle( el, clip.path.parentNode );" )
    && 1 === substr_count( $org_js, 'this.keepHandle(' ) && false !== strpos( $org_js, "el.classList.contains( 'elementor-element-editable' )" ) );
// Image widget: a moving custom shape is inset by the reach the zoom does not cover.
check( 'image inset: motionInset / motionReach / insetBox exist and read the real motion amounts', false !== strpos( $org_js, 'function motionInset( box, side, motion, aspect, zoom, over ) {' )
    && false !== strpos( $org_js, 'function motionReach( motion, v, aspect ) {' ) && false !== strpos( $org_js, 'function insetBox( box, inset ) {' )
    && false !== strpos( $org_js, 'fx.motion = { ripple: CUSTOM_AMOUNT[ amount ].ripple };' ) && false !== strpos( $org_js, 'fx.motion = fx.gentle;' ) );
check( 'image inset: applied in place() only for fx.img with a custom motion, before zoomOrigin', 1 === preg_match( '/if \( fx\.img && fx\.motion \) \{.*?clipBox = shapeBox = insetBox\( box, motionInset\( box, fx\.zoomSide, fx\.motion, reachAspect, fx\.zoom, fx\.over \) \);\s*\}\s*fx\.clip\.box = clipBox;\s*fx\.clip\.origin = zoomOrigin\( clipBox, fx\.zoomSide \);/s', $org_js ) );
check( 'image inset: the flat side (zoomSide) is never inset; nothing moving = the same box', false !== strpos( $org_js, "left: 'left' === side ? 0 :" ) && false !== strpos( $org_js, "right: 'right' === side ? 0 :" )
    && false !== strpos( $org_js, "top: 'top' === side ? 0 :" ) && false !== strpos( $org_js, "bottom: 'bottom' === side ? 0 :" )
    && 1 === preg_match( '/if \( ! \( inset\.left \|\| inset\.right \|\| inset\.top \|\| inset\.bottom \) \) \{\s*return box;/', $org_js ) );
check( 'spacer: shapes + text use FramifyFx.hostOf', false !== strpos( $fs_js, 'var el = hostOf( this );' ) && false !== strpos( $ft_js, 'var el = Fx.hostOf( this );' ) );

// 8. Image widget: Floating Shapes / Text on the Framify tab, in a photo frame.
$im_hook  = 'elementor/element/image/section_style_caption/after_section_end';
$im_prio  = array_map( function ( $c ) { return $c[0] . ' ' . get_class( $c[1] ) . '::' . $c[2]; }, framify_hooked( $im_hook ) );
sort( $im_prio );
check( 'image: Organic at 10, Floating Shapes at 20, Floating Text at 30 (same registration functions)', array(
    '10 Framify_Elementor::register_image_controls', '20 Framify_Elementor_Shapes::register_controls', '30 Framify_Elementor_Text::register_spacer_controls',
) === $im_prio );
$im_all = new Framify_Test_Element( 'image' );
$im_sorted = framify_hooked( $im_hook );
usort( $im_sorted, function ( $a, $b ) { return $a[0] - $b[0]; } );
foreach ( $im_sorted as $call ) {
    call_user_func( array( $call[1], $call[2] ), $im_all );
}
check( 'image: Framify sections in order Organic Shape, Deco Blob, Grain, Floating Shapes, Floating Text',
    array( 'framify_org_section', 'framify_deco_section', 'framify_grain_section', 'framify_fs_section', 'framify_ft_section' ) === array_keys( $im_all->sections ) );
$im_fs = new Framify_Test_Element( 'image' );
$fs_module->register_controls( $im_fs );
$im_ft = new Framify_Test_Element( 'image' );
$ft_module->register_spacer_controls( $im_ft );
$im_note = 'Behind content is hidden by an opaque photo unless Organic Shape cuts it.';
check( 'image: same Floating Shapes / Text control ids as containers', array_keys( $fs_el->controls ) === array_keys( $im_fs->controls ) && array_keys( $ft_el->controls ) === array_keys( $im_ft->controls ) );
check( 'image: Layer controls carry the opaque-photo note (image only)', $im_note === $im_fs->controls['framify_fs_layer']['description'] && $im_note === $im_ft->controls['framify_ft_layer']['description']
    && ! isset( $fs_el->controls['framify_fs_layer']['description'] ) && ! isset( $ft_el->controls['framify_ft_layer']['description'] ) && ! isset( $sp_fs->controls['framify_fs_layer']['description'] ) );
$im_fs_rest = $im_fs->controls;
unset( $im_fs_rest['framify_fs_layer']['description'] );
check( 'image: Floating Shapes args otherwise equal the container ones', $fs_el->controls === $im_fs_rest );
check( 'image: JS attaches Floating Shapes and Floating Text to the image widget', false !== strpos( $fs_js, "attachHandler( 'image', FloatingShapes );" ) && false !== strpos( $ft_js, "attachHandler( 'image', FloatingText );" ) );
check( 'image: FramifyFx publishes the shared photo frame helper, used by both handlers', false !== strpos( $fs_js, 'photoFrame: photoFrame,' ) && false !== strpos( $fs_js, 'function photoFrame( handler, over ) {' )
    && false !== strpos( $fs_js, "var frame = photoFrame( this, 'overlay' === o.layer );" ) && false !== strpos( $ft_js, "var frame = Fx.photoFrame( this, 'overlay' === o.layer );" )
    && 2 === substr_count( $fs_js . $ft_js, 'frame.release();' ) );
check( 'image: the frame follows the img box (offset chain, ResizeObserver on the img, load, resize)', false !== strpos( $fs_js, 'function offsetIn( node, host ) {' ) && false !== strpos( $fs_js, 'observer.observe( img );' )
    && false !== strpos( $fs_js, "img.addEventListener( 'load', onChange );" ) && false !== strpos( $fs_js, "window.addEventListener( 'resize', onChange );" ) );
check( 'image: the Over frame copies the img clip, transform and origin; Organic notifies it on render and teardown', false !== strpos( $fs_js, 'to.clipPath = clip;' ) && false !== strpos( $fs_js, 'to.transform = from.transform;' )
    && false !== strpos( $fs_js, 'to.transformOrigin = from.transformOrigin;' ) && 1 === preg_match( '/function syncPhoto\( el \) \{\s*if \( el && el\.framifyFxPhoto \) \{\s*el\.framifyFxPhoto\.sync\(\);/', $org_js )
    && 2 === substr_count( $org_js, 'syncPhoto( fx.el );' ) );
$fs_css = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-shapes.css' );
check( 'image: frames are pointer-events none, Behind 0 under the img (1), Over 3', 1 === preg_match( '/\.framify-fx-photo > \.framify-fx-frame \{[^}]*z-index: 0;[^}]*pointer-events: none;/', $fs_css )
    && 1 === preg_match( '/\.framify-fx-photo img \{[^}]*position: relative;[^}]*z-index: 1;/', $fs_css ) && 1 === preg_match( '/\.framify-fx-frame--over \{\s*z-index: 3;/', $fs_css ) );
check( 'image: the Behind frame goes after the Organic deco blob; the Over frame last', false !== strpos( $fs_js, "var PHOTO_AFTER = '.framify-organic__deco';" ) && false !== strpos( $fs_js, 'insertLayer( host, f.node, false, PHOTO_AFTER );' ) && false !== strpos( $fs_js, 'host.appendChild( f.node );' ) );
check( 'image: containers / sections / spacer attachments unchanged', false !== strpos( $fs_js, "attachHandler( 'container', FloatingShapes, null );" ) && false !== strpos( $ft_js, "attachHandler( 'section', FloatingText, null );" ) );

// 9. Float on nested Containers: same registration function at 40, CSS gate on .e-child, editor-only panel hiding.
$con_hook  = 'elementor/element/container/_section_responsive/after_section_end';
$fl_hooked = array_values( array_filter( framify_hooked( $con_hook ), function ( $c ) { return 'register_float_controls' === $c[2]; } ) );
check( 'float: hooked on the container at 40 via Framify_Elementor::register_float_controls', 1 === count( $fl_hooked ) && 40 === $fl_hooked[0][0] && 'Framify_Elementor' === get_class( $fl_hooked[0][1] ) );
foreach ( array( 'common', 'common-optimized' ) as $w ) {
    $w_hooked = framify_hooked( 'elementor/element/' . $w . '/_section_responsive/after_section_end' );
    check( "float: widgets ($w) still hooked at the default 10", 1 === count( $w_hooked ) && 10 === $w_hooked[0][0] && 'register_float_controls' === $w_hooked[0][2] );
}
$con_all    = new Framify_Test_Element( 'container' );
$con_sorted = framify_hooked( $con_hook );
usort( $con_sorted, function ( $a, $b ) { return $a[0] - $b[0]; } );
foreach ( $con_sorted as $call ) {
    call_user_func( array( $call[1], $call[2] ), $con_all );
}
check( 'float: container Framify sections Organic Shape, Deco Blob, Grain, Floating Shapes, Floating Text, Float',
    array( 'framify_org_section', 'framify_deco_section', 'framify_grain_section', 'framify_fs_section', 'framify_ft_section', 'framify_float_section' ) === array_keys( $con_all->sections )
    && Framify_Elementor::TAB === $con_all->sections['framify_float_section']['tab'] && 0 === $con_all->open );
$fl_w = new Framify_Test_Element( 'common' );
$module->register_float_controls( $fl_w );
$fl_c = new Framify_Test_Element( 'container' );
$module->register_float_controls( $fl_c );
$fl_note = 'Float works on containers placed inside another container. It replaces an Entrance Animation on the same container.';
check( 'float: container carries the nested-only note on the switch; widgets have none', $fl_note === $fl_c->controls['framify_float']['description'] && ! isset( $fl_w->controls['framify_float']['description'] ) );
$fl_c_rest = $fl_c->controls;
unset( $fl_c_rest['framify_float']['description'] );
check( 'float: container controls otherwise equal the widget ones (ids, prefix class, {{WRAPPER}} selectors)', $fl_w->controls === $fl_c_rest && $fl_w->sections === $fl_c->sections
    && array( 'framify_float', 'framify_float_distance', 'framify_float_duration', 'framify_float_delay', 'framify_float_rotate' ) === array_keys( $fl_w->controls )
    && 'framify-float-' === $fl_w->controls['framify_float']['prefix_class'] && array( '{{WRAPPER}}' => '--framify-float-d: {{SIZE}}{{UNIT}};' ) === $fl_w->controls['framify_float_distance']['selectors'] );
$el_css = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-elementor.css' );
check( 'float: widget CSS rule unchanged', 1 === preg_match( '/\n\.elementor-element\.framify-float-yes \{\s*animation: framify-float var\(--framify-float-t, 4s\) ease-in-out var\(--framify-float-delay, 0s\) infinite alternate;\s*\}/', $el_css ) );
check( 'float: e-child gate - a top-level container never animates', 1 === preg_match( '/\n\.e-con\.framify-float-yes:not\(\.e-child\) \{\s*animation: none;\s*\}/', $el_css ) );
$ed_js  = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-elementor-editor.js' );
$ed_css = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-elementor-editor.css' );
$fl_en  = framify_hooked( 'elementor/editor/after_enqueue_scripts' );
check( 'float: editor script enqueued on elementor/editor/after_enqueue_scripts', 1 === count( $fl_en ) && 'enqueue_editor_scripts' === $fl_en[0][2] );
check( 'float: editor hook on panel/open_editor/container toggles framify-float-off on the panel from isInner / e-child', false !== strpos( $ed_js, "elementor.hooks.addAction( 'panel/open_editor/container', onOpen );" )
    && false !== strpos( $ed_js, "model.get( 'isInner' )" ) && false !== strpos( $ed_js, "view.\$el.hasClass( 'e-child' )" )
    && false !== strpos( $ed_js, "setOff( ! isNested( model, view ) );" ) && false !== strpos( $ed_js, "panel.\$el.toggleClass( 'framify-float-off', off );" ) );
check( 'float: opening a widget / section / column clears the class (widgets keep Float)', false !== strpos( $ed_js, "var OTHER_TYPES = [ 'widget', 'section', 'column' ];" )
    && false !== strpos( $ed_js, "elementor.hooks.addAction( 'panel/open_editor/' + OTHER_TYPES[ i ], onOther );" ) );
check( 'float: editor CSS hides the Float section and its controls under framify-float-off', false !== strpos( $ed_css, '.framify-float-off [class*="elementor-control-framify_float"] {' ) );

// 10. Shape Divider (framify-elementor-divider.php): top-level Containers only, last on the Framify tab.
require dirname( __DIR__, 2 ) . '/framify-elementor-divider.php';
$dv_hooked = array_values( array_filter( framify_hooked( $con_hook ), function ( $c ) { return 'Framify_Elementor_Divider' === get_class( $c[1] ); } ) );
check( 'divider: hooked on the container at 50 via register_controls', 1 === count( $dv_hooked ) && 50 === $dv_hooked[0][0] && 'register_controls' === $dv_hooked[0][2] );
$dv_elsewhere = array_filter( $GLOBALS['framify_actions'], function ( $a ) { return is_array( $a['callback'] ) && 'Framify_Elementor_Divider' === get_class( $a['callback'][0] ) && 0 === strpos( $a['hook'], 'elementor/element/' ) && false === strpos( $a['hook'], '/container/' ); } );
check( 'divider: no section / spacer / image / widget hook', 0 === count( $dv_elsewhere ) );
$dv_all    = new Framify_Test_Element( 'container' );
$dv_sorted = framify_hooked( $con_hook );
usort( $dv_sorted, function ( $a, $b ) { return $a[0] - $b[0]; } );
foreach ( $dv_sorted as $call ) {
    call_user_func( array( $call[1], $call[2] ), $dv_all );
}
check( 'divider: container Framify sections ... Float, then Shape Divider last',
    array( 'framify_org_section', 'framify_deco_section', 'framify_grain_section', 'framify_fs_section', 'framify_ft_section', 'framify_float_section', 'framify_org_dv_section' ) === array_keys( $dv_all->sections )
    && Framify_Elementor::TAB === $dv_all->sections['framify_org_dv_section']['tab'] && 'Shape Divider' === $dv_all->sections['framify_org_dv_section']['label'] && 0 === $dv_all->open );
$dv_el = new Framify_Test_Element( 'container' );
$dv_module = new Framify_Elementor_Divider();
$dv_module->register_controls( $dv_el );
$dv_side_ids = array( 'source', 'svg', 'media', 'color', 'width', 'height', 'flip', 'upside', 'front', 'motion', 'trigger', 'amount' );
$dv_expect   = array();
foreach ( array( 'top', 'bottom' ) as $side ) {
    foreach ( $dv_side_ids as $id ) {
        $dv_expect[] = 'framify_org_dv_' . $side . '_' . $id;
    }
}
check( 'divider: Top / Bottom controls tabs, same ids per side, in order', array( 'framify_org_dv_tabs' => array( 'framify_org_dv_tab_top' => array( 'label' => 'Top' ), 'framify_org_dv_tab_bottom' => array( 'label' => 'Bottom' ) ) ) === $dv_el->tabs
    && $dv_expect === array_keys( $dv_el->controls )
    && 'framify_org_dv_tab_top' === $dv_el->tab_of['framify_org_dv_top_amount'] && 'framify_org_dv_tab_bottom' === $dv_el->tab_of['framify_org_dv_bottom_source'] );
check( 'divider: every id (section, tabs, controls) starts with framify_org_dv_', 0 === count( array_filter( array_merge( array_keys( $dv_el->sections ), array_keys( $dv_el->controls ), array_keys( $dv_el->tabs['framify_org_dv_tabs'] ) ), function ( $id ) { return 0 !== strpos( $id, 'framify_org_dv_' ); } ) ) );
$dv_ok_live = true;
$dv_ok_css  = true;
foreach ( $dv_el->controls as $id => $c ) {
    if ( preg_match( '/_(width|height)$/', $id ) ) {
        $side = false !== strpos( $id, '_top_' ) ? 'top' : 'bottom';
        $dv_ok_css = $dv_ok_css && ! empty( $c['responsive'] ) && 'ui' === $c['render_type'] && empty( $c['frontend_available'] )
            && array( '{{WRAPPER}} > .framify-dv--' . $side . ' > svg' ) === array_keys( $c['selectors'] );
    } else {
        $dv_ok_live = $dv_ok_live && true === $c['frontend_available'] && 'none' === $c['render_type'];
    }
}
check( 'divider: all controls live (frontend_available, render_type none) except Width / Height', $dv_ok_live );
check( 'divider: Width / Height are responsive CSS on {{WRAPPER}} > .framify-dv--side > svg', $dv_ok_css
    && 'width: calc({{SIZE}}% + 1.3px);' === $dv_el->controls['framify_org_dv_top_width']['selectors']['{{WRAPPER}} > .framify-dv--top > svg']
    && array( '%' => array( 'min' => 100, 'max' => 300, 'step' => 1 ) ) === $dv_el->controls['framify_org_dv_bottom_width']['range']
    && 'height: {{SIZE}}px;' === $dv_el->controls['framify_org_dv_bottom_height']['selectors']['{{WRAPPER}} > .framify-dv--bottom > svg'] );
$dvc = $dv_el->controls;
check( 'divider: Source None | code | media, default None (empty, dropped from data-settings)', '' === $dvc['framify_org_dv_top_source']['default'] && array( '', 'code', 'media' ) === array_keys( $dvc['framify_org_dv_top_source']['options'] ) );
check( 'divider: code textarea / SVG-only media with the unfiltered-uploads note, each on its source', 'textarea' === $dvc['framify_org_dv_top_svg']['type'] && array( 'framify_org_dv_top_source' => 'code' ) === $dvc['framify_org_dv_top_svg']['condition']
    && 'media' === $dvc['framify_org_dv_top_media']['type'] && array( 'svg' ) === $dvc['framify_org_dv_top_media']['media_types'] && array( 'framify_org_dv_top_source' => 'media' ) === $dvc['framify_org_dv_top_media']['condition']
    && false !== strpos( $dvc['framify_org_dv_top_media']['description'], 'Enable Unfiltered File Uploads' ) );
check( 'divider: colour white with the Global Colour picker on; switches default off', 'color' === $dvc['framify_org_dv_top_color']['type'] && '#FFFFFF' === $dvc['framify_org_dv_top_color']['default'] && ! isset( $dvc['framify_org_dv_top_color']['global'] )
    && '' === $dvc['framify_org_dv_top_flip']['default'] && '' === $dvc['framify_org_dv_top_upside']['default'] && '' === $dvc['framify_org_dv_top_front']['default'] );
check( 'divider: Motion static | liquid; trigger loop | inview | hover and amount only for Liquid', array( 'static', 'liquid' ) === array_keys( $dvc['framify_org_dv_top_motion']['options'] ) && 'static' === $dvc['framify_org_dv_top_motion']['default']
    && array( 'loop', 'inview', 'hover' ) === array_keys( $dvc['framify_org_dv_top_trigger']['options'] ) && array( 'subtle', 'normal', 'strong' ) === array_keys( $dvc['framify_org_dv_top_amount']['options'] )
    && 'liquid' === $dvc['framify_org_dv_top_trigger']['condition']['framify_org_dv_top_motion'] && 'liquid' === $dvc['framify_org_dv_top_amount']['condition']['framify_org_dv_top_motion'] );
$dv_php = file_get_contents( dirname( __DIR__, 2 ) . '/framify-elementor-divider.php' );
$dv_js  = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-divider.js' );
$dv_css = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-divider.css' );
$main_php = file_get_contents( dirname( __DIR__, 2 ) . '/framify.php' );
check( 'divider: loaded from framify.php after the text module, behind a file_exists guard', 1 === preg_match( "/framify-elementor-text\.php';\s*\}.*if \( file_exists\( FRAMIFY_PLUGIN_DIR \. 'framify-elementor-divider\.php' \) \) \{\s*require_once FRAMIFY_PLUGIN_DIR \. 'framify-elementor-divider\.php';/s", $main_php ) );
check( 'divider: script depends on the organic (parser) and shapes (FramifyFx) handles; style on shapes', false !== strpos( $dv_php, "array( 'elementor-frontend', 'framify-elementor', 'framify-shapes', 'framify-colors' )," ) && false !== strpos( $dv_php, "FRAMIFY_PLUGIN_URL . 'assets/framify-divider.css',\n            array( 'framify-shapes' )," ) );
check( 'divider: no editor enqueue of its own (the shared editor script does the hiding)', 1 === count( framify_hooked( 'elementor/editor/after_enqueue_scripts' ) ) );
preg_match( '/var CSS_KEYS = \[([^\]]*)\];/', $dv_js, $dv_m );
$dv_css_keys = isset( $dv_m[1] ) ? array_map( function ( $k ) { return str_replace( array( "PREFIX + '", "'" ), array( 'framify_org_dv_', '' ), trim( $k ) ); }, explode( ',', $dv_m[1] ) ) : array();
$dv_css_ids  = array_keys( array_filter( $dvc, function ( $c ) { return ! empty( $c['selectors'] ); } ) );
sort( $dv_css_keys );
sort( $dv_css_ids );
check( 'divider: the JS ignore list = exactly the CSS-only controls (no rebuild for Width / Height)', $dv_css_ids === $dv_css_keys && 4 === count( $dv_css_keys ) );
check( 'divider: runtime gate - a nested container (.e-child) is ignored', false !== strpos( $dv_js, "if ( el.classList.contains( 'e-child' ) ) {\n\t\t\t\t\treturn;" ) );
check( 'divider: attached to containers only (null skin), editor sync via FramifyFx.editorMixin', 1 === substr_count( $dv_js, 'attachHandler(' ) && false !== strpos( $dv_js, "elementorFrontend.elementsHandler.attachHandler( 'container', ShapeDivider, null );" )
    && false !== strpos( $dv_js, 'Fx.editorMixin( Base, PREFIX, CSS_KEYS )' ) && false !== strpos( $dv_js, 'this.watchModel();' ) );
check( 'divider: switches read as yes, settings from getElementSettings', 3 === preg_match_all( "/: 'yes' === s\[ k \+ '(flip|upside|front)' \],/", $dv_js ) );
check( 'divider: Liquid pins the container-edge side (top, bottom when upside down) and both ends', false !== strpos( $dv_js, "Shape.traceCustom( shape, shape.box, o.amount, [ o.upside ? 'bottom' : 'top', 'left', 'right' ] )" ) );
check( 'divider: reduced motion = static', false !== strpos( $dv_js, "if ( o.liquid && ! ( reduceQuery && reduceQuery.matches ) ) {" ) );
check( 'divider: media only when same-origin (checked before and after the fetch)', false !== strpos( $dv_js, 'return u.origin === window.location.origin' ) && false !== strpos( $dv_js, 'r.ok && sameOrigin( r.url || url ) ? r.text()' ) );
check( 'divider: the SVG goes only through parseSvgShape; nothing is inserted as markup', false !== strpos( $dv_js, 'Shape.parseSvgShape( text )' )
    && 0 === preg_match( '/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|importNode|adoptNode|\.src\s*=|createContextualFragment/', $dv_js ) );
check( 'divider: CSS - absolute strip, pointer-events none, z 0 / front 2, bottom turned round, flips on the svg', 1 === preg_match( '/\.framify-dv \{[^}]*position: absolute;[^}]*z-index: 0;[^}]*pointer-events: none;/', $dv_css )
    && 1 === preg_match( '/\.framify-dv--front \{\s*z-index: 2;/', $dv_css ) && 1 === preg_match( '/\.framify-dv--bottom \{[^}]*transform: rotate\(180deg\);/', $dv_css )
    && false !== strpos( $dv_css, '.framify-dv--flip > svg {' ) && false !== strpos( $dv_css, '.framify-dv--upside > svg {' ) );
// Editor: the inverse of Float, on the same hook, without touching Float's toggle.
$ed_js  = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-elementor-editor.js' );
$ed_css = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-elementor-editor.css' );
check( 'divider: editor panel gets framify-divider-off for a NESTED container, cleared for other elements', false !== strpos( $ed_js, "setDividerOff( isNested( model, view ) );" ) && false !== strpos( $ed_js, "panel.\$el.toggleClass( 'framify-divider-off', off );" )
    && 1 === preg_match( '/function onOther\(\) \{\s*setOff\( false \);\s*setDividerOff\( false \);/', $ed_js ) );
check( 'divider: editor CSS hides every framify_org_dv_ control (section, tabs) under framify-divider-off', false !== strpos( $ed_css, '.framify-divider-off [class*="elementor-control-framify_org_dv_"] {' ) );
// Shared sanitiser in framify-elementor.js.
$org_js = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-elementor.js' );
check( 'sanitiser: exposed on window.FramifyOrganicShape (parser, tracer, morph helpers)', 1 === preg_match( '/window\.FramifyOrganicShape = \{[^}]*parseSvgShape: parseSvgShape,[^}]*svgGeometry: svgGeometry,[^}]*traceCustom: traceCustom,[^}]*blendPath: blendPath,/', $org_js ) );
check( 'sanitiser: geometry whitelist path / rect / circle / ellipse / line / polyline / polygon; walks only g / a / svg', false !== strpos( $org_js, 'var SVG_GEOMETRY = { path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1 };' )
    && false !== strpos( $org_js, 'var SVG_GROUPS = { g: 1, a: 1, svg: 1 };' ) );
check( 'sanitiser: DOMParser image/svg+xml on a detached document, parser errors refused', false !== strpos( $org_js, "new window.DOMParser().parseFromString( text, 'image/svg+xml' )" ) && false !== strpos( $org_js, "doc.getElementsByTagName( 'parsererror' ).length" ) );
check( 'sanitiser: no markup API anywhere in the organic script', 0 === preg_match( '/innerHTML|outerHTML|insertAdjacentHTML|importNode|adoptNode|createContextualFragment/', $org_js ) );
check( 'sanitiser: built path data re-checked against PATH_CHARS; path d validated before parsing', false !== strpos( $org_js, "return /\\d/.test( s ) && PATH_CHARS.test( s ) ? s : '';" ) && false !== strpos( $org_js, "return PATH_CHARS.test( d ) ? d : '';" ) );
check( 'sanitiser: pinDistance takes a list of sides (divider); Organic still passes one', false !== strpos( $org_js, 'if ( Array.isArray( side ) ) {' ) && false !== strpos( $org_js, "'none' === fx.edge ? null : fx.custom.straight" ) );
check( 'organic: divider controls (framify_org_dv_) never rebuild the Organic Shape', false !== strpos( $org_js, "var DIVIDER_PREFIX = 'framify_org_dv_';" ) && false !== strpos( $org_js, "if ( '__globals__' !== name && ( 0 !== name.indexOf( 'framify_org_' ) || 0 === name.indexOf( DIVIDER_PREFIX ) ) ) {" ) );
// The node unit test of svgGeometry (DOMParser stand-in), when node is on the PATH.
$node_out = array();
$node_rc  = -1;
@exec( 'node ' . escapeshellarg( __DIR__ . '/divider-sanitiser-test.js' ) . ' 2>&1', $node_out, $node_rc );
if ( 127 === $node_rc || ( 1 === $node_rc && ! preg_grep( '/^(PASS|FAIL) /', $node_out ) ) ) {
    echo "SKIP sanitiser node test: node not found\n";
} else {
    check( 'sanitiser: node dev/tests/divider-sanitiser-test.js ALL PASSED (' . count( preg_grep( '/^PASS /', $node_out ) ) . ' checks)', 0 === $node_rc && in_array( 'ALL PASSED', $node_out, true ) );
}

// 11. Dots motion + Generate tab (dot-grid shapes).
$dot_php    = file_get_contents( dirname( __DIR__, 2 ) . '/framify-elementor.php' );
$dot_studio = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-shape-studio.js' );
$dot_gen_js = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-dot-shapes.js' );
$dot_css    = file_get_contents( dirname( __DIR__, 2 ) . '/assets/framify-elementor-editor.css' );
check( 'dots: Custom motion offers liquid, gentle and dots (default liquid)', array( 'liquid', 'gentle', 'dots' ) === array_keys( $con_c['framify_org_custom_motion']['options'] ) && 'liquid' === $con_c['framify_org_custom_motion']['default'] );
$dot_style = $con_c['framify_org_dot_style'];
$dot_terms = array();
array_walk_recursive( $dot_style['conditions'], function ( $v, $k ) use ( &$dot_terms ) { $dot_terms[] = $k . '=' . ( is_array( $v ) ? implode( ',', $v ) : $v ); } );
check( 'dots: framify_org_dot_style is breathe / twinkle / wave / drift (default breathe), live, only with Dots chosen', array( 'breathe', 'twinkle', 'wave', 'drift' ) === array_keys( $dot_style['options'] ) && 'breathe' === $dot_style['default'] && ! empty( $dot_style['frontend_available'] )
    && in_array( 'value=dots', $dot_terms, true ) && in_array( 'name=framify_org_custom_motion', $dot_terms, true ) );
check( 'dots: the generator is enqueued (asset_version) and the studio depends on it', false !== strpos( $dot_php, "'framify-dot-shapes'," ) && false !== strpos( $dot_php, "\$this->asset_version( 'framify-dot-shapes.js' )" ) && false !== strpos( $dot_php, "array( 'elementor-editor', 'framify-dot-shapes' )" ) );
check( 'dots: the studio gets the shape quota from the server (maxUser = MAX_USER)', false !== strpos( $dot_php, "'maxUser' => Framify_Shape_Library::MAX_USER" ) );
check( 'dots: studio registers the Generate tab only when the generator is loaded', false !== strpos( $dot_studio, "if ( window.FramifyDotShapes ) {" ) && false !== strpos( $dot_studio, "[ 'Generate', generateTab ]" ) );
check( 'dots: generator has no DOM and no innerHTML, and exposes window.FramifyDotShapes', false === strpos( $dot_gen_js, 'document' ) && false === strpos( $dot_gen_js, 'innerHTML' ) && false !== strpos( $dot_gen_js, 'window.FramifyDotShapes = {' ) );
check( 'dots: the Dots branch leaves fx.motion alone (no Image inset, no Container bleed) and render() has a dots blend hook', 1 === preg_match( "/if \\( field && \\( 'dots' === s\\.framify_org_custom_motion[^}]*?fx\\.dots = dotPair\\([^}]*?return;/s", $org_js ) && false !== strpos( $org_js, 'part.pair.blend' )
    && 1 === preg_match( "/fx\\.dots = dotPair\\(([^;]*);\\s*return;/", $org_js ) && false === strpos( substr( $org_js, strpos( $org_js, 'fx.dots = dotPair(' ), 120 ), 'fx.motion' ) );
check( 'dots: Generate tab styles exist in the editor stylesheet', false !== strpos( $dot_css, '.framify-studio__variant {' ) && false !== strpos( $dot_css, '.framify-studio__draw--gen {' ) );

$node_out = array();
$node_rc  = -1;
@exec( 'node ' . escapeshellarg( __DIR__ . '/dot-shapes-test.js' ) . ' 2>&1', $node_out, $node_rc );
if ( 127 === $node_rc || ( 1 === $node_rc && ! preg_grep( '/^(PASS|FAIL) /', $node_out ) ) ) {
    echo "SKIP dots node test: node not found\n";
} else {
    check( 'dots: node dev/tests/dot-shapes-test.js ALL PASSED (' . count( preg_grep( '/^PASS /', $node_out ) ) . ' checks)', 0 === $node_rc && in_array( 'ALL PASSED', $node_out, true ) );
}

// 12. Background Effects (framify-elementor-effects.php): hooks, ids, live flags, defaults, JS parity.
require dirname( __DIR__, 2 ) . '/framify-elementor-effects.php';
$ef_module = new Framify_Elementor_Effects();
$ef_hooks  = array();
foreach ( array( 'container', 'section' ) as $ef_w ) {
    foreach ( framify_hooked( 'elementor/element/' . $ef_w . '/_section_responsive/after_section_end' ) as $hook ) {
        if ( 'Framify_Elementor_Effects' === get_class( $hook[1] ) && 'register_controls' === $hook[2] ) {
            $ef_hooks[ $ef_w ] = $hook[0];
        }
    }
}
$ef_elsewhere = array();
foreach ( array( 'spacer/section_spacer', 'image/section_style_caption', 'common/_section_style', 'column/_section_responsive' ) as $ef_h ) {
    foreach ( framify_hooked( 'elementor/element/' . $ef_h . '/after_section_end' ) as $hook ) {
        if ( 'Framify_Elementor_Effects' === get_class( $hook[1] ) ) {
            $ef_elsewhere[] = $ef_h;
        }
    }
}
check( 'effects: hooked on containers and sections at priority 60 (after Organic 10, Shapes 20, Text 30, Float 40, Divider 50), nowhere else', array( 'container' => 60, 'section' => 60 ) === $ef_hooks && 0 === count( $ef_elsewhere ) );
$ef_el = new Framify_Test_Element( 'container' );
$ef_module->register_controls( $ef_el );
check( 'effects: one section framify_ef_section "Background Effects" in the Framify tab', array( 'framify_ef_section' ) === array_keys( $ef_el->sections ) && Framify_Elementor::TAB === $ef_el->sections['framify_ef_section']['tab'] && 'Background Effects' === $ef_el->sections['framify_ef_section']['label'] && 0 === $ef_el->open );
$ef_params = $ef_module->params();
$ef_expect = array( 'framify_ef_stack', 'framify_ef_quality' );
for ( $n = 1; $n <= 3; $n++ ) {
    $ef_expect[] = 'framify_ef_' . $n . '_type';
    foreach ( array_keys( $ef_params ) as $k ) {
        $ef_expect[] = 'framify_ef_' . $n . '_' . $k;
    }
}
check( 'effects: stack, quality, then three layers of type + the same controls, in order', $ef_expect === array_keys( $ef_el->controls ) );
$ef_bad = array();
foreach ( array_merge( array_keys( $ef_el->sections ), array_keys( $ef_el->controls ), array_keys( $ef_el->tabs['framify_ef_tabs'] ) ) as $id ) {
    if ( 0 !== strpos( $id, 'framify_ef_' ) ) {
        $ef_bad[] = $id;
    }
}
check( 'effects: every section, tab and control id starts with framify_ef_ (no other handler reacts to them)', ! $ef_bad );
$ef_live = true;
foreach ( $ef_el->controls as $args ) {
    $ef_live = $ef_live && ! empty( $args['frontend_available'] ) && 'none' === $args['render_type'];
}
check( 'effects: every control is frontend_available with render_type none', $ef_live );
check( 'effects: three Layer tabs, controls filed under their own layer', array( 'framify_ef_tab_1', 'framify_ef_tab_2', 'framify_ef_tab_3' ) === array_keys( $ef_el->tabs['framify_ef_tabs'] )
    && 'framify_ef_tab_2' === $ef_el->tab_of['framify_ef_2_speed'] && 'framify_ef_tab_3' === $ef_el->tab_of['framify_ef_3_type'] && null === $ef_el->tab_of['framify_ef_stack'] );
check( 'effects: stack defaults to under, quality to medium', 'under' === $ef_el->controls['framify_ef_stack']['default'] && array( 'under', 'above' ) === array_keys( $ef_el->controls['framify_ef_stack']['options'] ) && 'medium' === $ef_el->controls['framify_ef_quality']['default'] );
check( 'effects: each layer starts Off and offers off / cloud / smoke / flames', 'off' === $ef_el->controls['framify_ef_1_type']['default'] && array( 'off', 'cloud', 'smoke', 'flames' ) === array_keys( $ef_el->controls['framify_ef_3_type']['options'] ) );
$ef_cond = true;
$ef_col  = true;
foreach ( $ef_params as $key => $spec ) {
    $c = $ef_el->controls[ 'framify_ef_2_' . $key ];
    $ef_cond = $ef_cond && array( 'framify_ef_2_type' => $spec['types'] ) === $c['condition'];
    if ( 'color' === $spec['kind'] ) {
        $ef_col = $ef_col && 'color' === $c['type'] && '' === $c['default'] && ! isset( $c['global'] );
    }
}
check( 'effects: every layer control only shows for the effects that use it', $ef_cond );
check( 'effects: colours are empty by default (the effect\'s own colour) and keep the Global Colour picker', $ef_col );
check( 'effects: density is the one responsive control', ! empty( $ef_el->controls['framify_ef_1_density']['responsive'] ) && empty( $ef_el->controls['framify_ef_1_speed']['responsive'] ) );

// The PHP table and SPEC in framify-effects-core.js must agree.
$ef_out = array();
$ef_rc  = -1;
@exec( 'node ' . escapeshellarg( __DIR__ . '/effects-core-test.js' ) . ' --schema 2>&1', $ef_out, $ef_rc );
$ef_schema = 0 === $ef_rc ? json_decode( implode( "\n", $ef_out ), true ) : null;
if ( 127 === $ef_rc ) {
    echo "SKIP effects schema parity: node not found\n";
} elseif ( ! $ef_schema ) {
    check( 'effects: node dev/tests/effects-core-test.js --schema prints the control table', false );
} else {
    $ef_same = array_keys( $ef_params ) === array_column( $ef_schema['spec'], 'key' ) && array_keys( $ef_module->type_options() ) === $ef_schema['types'];
    foreach ( $ef_schema['spec'] as $row ) {
        $php = isset( $ef_params[ $row['key'] ] ) ? $ef_params[ $row['key'] ] : null;
        if ( ! $php || $php['kind'] !== $row['kind'] || $php['types'] !== $row['types'] ) {
            $ef_same = false;
            continue;
        }
        if ( 'slider' === $row['kind'] ) {
            $ef_same = $ef_same && (float) $php['min'] === (float) $row['min'] && (float) $php['max'] === (float) $row['max'] && (float) $php['step'] === (float) $row['step'] && (float) $php['def'] === (float) $row['def'];
        } elseif ( 'select' === $row['kind'] ) {
            $ef_same = $ef_same && array_keys( $php['options'] ) === $row['options'] && $php['def'] === $row['def'];
        }
    }
    check( 'effects: PHP control table equals SPEC in framify-effects-core.js (keys, kinds, types, ranges, defaults)', $ef_same );
    check( 'effects: the quality options are the ones the core knows', array_keys( $ef_el->controls['framify_ef_quality']['options'] ) === $ef_schema['qualities'] );
}
$ef_dir = dirname( __DIR__, 2 ) . '/assets/';
$ef_php = file_get_contents( dirname( __DIR__, 2 ) . '/framify-elementor-effects.php' );
check( 'effects: scripts depend on framify-shapes, framify-colors and the core; style on framify-shapes; versioned by file time',
    false !== strpos( $ef_php, "array( 'elementor-frontend', 'framify-colors', 'framify-shapes', 'framify-effects-core' )" )
    && false !== strpos( $ef_php, "array( 'framify-shapes' )" ) && false !== strpos( $ef_php, "\$this->asset_version( 'framify-effects.js' )" ) && false !== strpos( $ef_php, "\$this->asset_version( 'framify-effects-core.js' )" ) );
check( 'effects: inert without the Framify tab or the Floating Shapes helpers', false !== strpos( $ef_php, "! class_exists( 'Framify_Elementor' ) || ! class_exists( 'Framify_Elementor_Shapes' )" ) );
check( 'effects: loaded from framify.php after the divider, behind a file_exists guard', 1 === preg_match( "/framify-elementor-divider\.php';\s*\}.*if \( file_exists\( FRAMIFY_PLUGIN_DIR \. 'framify-elementor-effects\.php' \) \) \{\s*require_once FRAMIFY_PLUGIN_DIR \. 'framify-elementor-effects\.php';/s", $main_php ) );
$ef_js   = file_get_contents( $ef_dir . 'framify-effects.js' );
$ef_core = file_get_contents( $ef_dir . 'framify-effects-core.js' );
$ef_css  = file_get_contents( $ef_dir . 'framify-effects.css' );
$sh_js   = file_get_contents( $ef_dir . 'framify-shapes.js' );
check( 'effects: the handler attaches to containers and sections with the null skin and its own constructor id', false !== strpos( $ef_js, "attachHandler( 'container', BackgroundEffects, null );" ) && false !== strpos( $ef_js, "attachHandler( 'section', BackgroundEffects, null );" ) && false !== strpos( $ef_js, "return 'FramifyBackgroundEffects';" ) );
check( 'effects: Floating Shapes / Text / Divider skip the effect canvas when inserting (BACKGROUND_CHILD has .framify-ef)', 1 === preg_match( "/var BACKGROUND_CHILD = '[^']*\.framify-ef';/", $sh_js ) );
check( 'effects: stacking CSS puts Under at z-index -1 and Above at 0, clicks pass through', 1 === preg_match( '/\.framify-ef--under \{\s*z-index: -1;/', $ef_css ) && 1 === preg_match( '/\.framify-ef--above \{\s*z-index: 0;/', $ef_css ) && false !== strpos( $ef_css, 'pointer-events: none;' ) );
$ef_es5 = true;
foreach ( array( $ef_js, $ef_core ) as $src ) {
    $code = preg_replace( array( '#/\*.*?\*/#s', '#^\s*//.*$#m' ), '', $src );
    if ( preg_match( '/=>|`|\blet\s|\bconst\s|\bclass\s+\w|\.includes\(|Object\.assign|\.\.\./', $code ) || preg_match( '/^ +\S/m', $code ) ) {
        $ef_es5 = false;
    }
}
check( 'effects: JS syntax guard (no arrows, template literals, let / const / class, spread, space indentation)', $ef_es5 );
check( 'effects: no settings string reaches markup (no innerHTML, insertAdjacentHTML or eval)', ! preg_match( '/innerHTML|insertAdjacentHTML|\beval\(|new Function/', $ef_js . $ef_core ) );

$ef_node = array();
$ef_nrc  = -1;
@exec( 'node ' . escapeshellarg( __DIR__ . '/effects-core-test.js' ) . ' 2>&1', $ef_node, $ef_nrc );
if ( 127 === $ef_nrc || ( 1 === $ef_nrc && ! preg_grep( '/^(PASS|FAIL) /', $ef_node ) ) ) {
    echo "SKIP effects node test: node not found\n";
} else {
    check( 'effects: node dev/tests/effects-core-test.js ALL PASSED (' . count( preg_grep( '/^PASS /', $ef_node ) ) . ' checks)', 0 === $ef_nrc && in_array( 'ALL PASSED', $ef_node, true ) );
}

// 13. Deco Blob parity + free Angle (1.18.0).
$dp_kinds = array( 'container' => $con_org->controls, 'spacer' => $sp_org->controls, 'image' => $img_org->controls );
$dp_suffix = array( 'shape_source', 'shape', 'shape_lib', 'edge', 'flip_h', 'flip_v', 'custom_rotate', 'angle', 'angle_fit', 'custom_svg', 'custom_motion', 'dot_style', 'custom_amount' );
// Documented differences between a setting and its Deco Blob twin.
$dp_alike = function ( $main, $deco, $suffix ) {
    unset( $main['condition'], $main['conditions'], $deco['condition'], $deco['conditions'], $main['description'], $deco['description'], $main['classes'], $deco['classes'], $main['separator'], $deco['separator'] );
    if ( 'shape' === $suffix ) {
        unset( $main['default'], $deco['default'], $main['label'], $deco['label'] );
    }
    if ( 'shape_source' === $suffix ) {
        unset( $main['label'], $deco['label'] );
    }
    if ( 'custom_motion' === $suffix ) {
        unset( $deco['options']['static'], $main['default'], $deco['default'] );
    }
    return $main === $deco;
};
foreach ( $dp_kinds as $kind => $controls ) {
    $miss = array();
    $diff = array();
    foreach ( $dp_suffix as $suffix ) {
        $m = 'framify_org_' . ( in_array( $suffix, array( 'shape_source', 'shape', 'shape_lib' ), true ) ? '' : '' ) . ( 'shape_source' === $suffix || 'shape' === $suffix || 'shape_lib' === $suffix ? $suffix : $suffix );
        $d = 'framify_org_deco_' . $suffix;
        if ( ! isset( $controls[ $m ], $controls[ $d ] ) ) {
            $miss[] = $suffix;
        } elseif ( ! $dp_alike( $controls[ $m ], $controls[ $d ], $suffix ) ) {
            $diff[] = $suffix;
        }
    }
    check( 'deco parity (' . $kind . '): every Organic Shape setting has a Deco Blob twin of the same type, options and defaults' . ( $miss || $diff ? ' [' . implode( ',', array_merge( $miss, $diff ) ) . ']' : '' ), ! $miss && ! $diff );
}
check( 'deco parity: the Deco Blob\'s Custom motion adds Static and defaults to it; the shape keeps Liquid', 'static' === $con_c['framify_org_deco_custom_motion']['default'] && 'liquid' === $con_c['framify_org_custom_motion']['default']
    && array( 'static', 'liquid', 'gentle', 'dots' ) === array_keys( $con_c['framify_org_deco_custom_motion']['options'] ) );
check( 'deco parity: the Deco Blob picker offers Custom (21 shapes) and keeps its splash default', 21 === count( $con_c['framify_org_deco_shape']['options'] ) && isset( $con_c['framify_org_deco_shape']['options']['custom'] ) && 'splash' === $con_c['framify_org_deco_shape']['default'] );
check( 'deco parity: ids that existed before keep their name, type and default (frozen in organic-controls-baseline.json)', ( function () use ( $dp_kinds ) {
    $base = json_decode( file_get_contents( __DIR__ . '/organic-controls-baseline.json' ), true );
    $ok   = true;
    foreach ( $dp_kinds as $kind => $controls ) {
        foreach ( $base[ $kind ] as $id => $was ) {
            if ( ! isset( $controls[ $id ] ) || $controls[ $id ]['type'] !== $was['type'] || ( isset( $controls[ $id ]['default'] ) ? $controls[ $id ]['default'] : null ) !== $was['default'] ) {
                echo "  changed: $kind $id\n";
                $ok = false;
            }
        }
    }
    return $ok;
} )() );
check( 'deco parity: the Organic Shape section keeps every frozen condition (only Angle and Shape look were added there)', ( function () use ( $dp_kinds, $in_section, $con_org, $sp_org, $img_org ) {
    $base = json_decode( file_get_contents( __DIR__ . '/organic-controls-baseline.json' ), true );
    $els  = array( 'container' => $con_org, 'spacer' => $sp_org, 'image' => $img_org );
    $ok   = true;
    foreach ( $dp_kinds as $kind => $controls ) {
        foreach ( $base[ $kind ] as $id => $was ) {
            if ( 'framify_org_section' !== $was['section'] ) {
                continue;
            }
            $now = array(
                'condition'  => isset( $controls[ $id ]['condition'] ) ? $controls[ $id ]['condition'] : null,
                'conditions' => isset( $controls[ $id ]['conditions'] ) ? $controls[ $id ]['conditions'] : null,
            );
            if ( $now !== array( 'condition' => $was['condition'], 'conditions' => $was['conditions'] ) ) {
                echo "  condition changed: $kind $id\n";
                $ok = false;
            }
        }
    }
    return $ok;
} )() );

// Angle (any angle, every shape) on both layers.
$ang_ok = true;
foreach ( $dp_kinds as $controls ) {
    foreach ( array( 'framify_org_angle' => $sp_on, 'framify_org_deco_angle' => null ) as $id => $cond ) {
        $a = $controls[ $id ];
        $ang_ok = $ang_ok && 'slider' === $a['type'] && array( 'deg' ) === $a['size_units'] && 0 === $a['range']['deg']['min'] && 360 === $a['range']['deg']['max'] && 'deg' === $a['default']['unit'] && 0 === $a['default']['size']
            && ! empty( $a['frontend_available'] ) && 'none' === $a['render_type'] && ( null === $cond ? ! isset( $a['condition'] ) : $cond === $a['condition'] );
    }
    $ang_ok = $ang_ok && 'switcher' === $controls['framify_org_angle_fit']['type'] && '' === $controls['framify_org_angle_fit']['default'] && 'switcher' === $controls['framify_org_deco_angle_fit']['type'];
}
check( 'angle: a 0-360 degree slider and a Keep inside the box switch on the Organic Shape and the Deco Blob of every element, JS-read, unconditioned by shape', $ang_ok );
$ang_order = $in_section( $con_org, 'framify_org_section' );
check( 'angle: it follows the legacy quarter turn, which keeps its id, options 0/90/180/270 and Custom-only condition', array_search( 'framify_org_angle', $ang_order ) === array_search( 'framify_org_custom_rotate', $ang_order ) + 1
    && array( 0, 90, 180, 270 ) === array_keys( $con_c['framify_org_custom_rotate']['options'] ) && '0' === $con_c['framify_org_custom_rotate']['default'] );

// Shape look: the shape's own look in Behind content mode when the Deco Blob is on.
$look_ids = array( 'framify_org_look', 'framify_org_look_style', 'framify_org_look_color', 'framify_org_look_outline_color', 'framify_org_look_outline_width' );
$look_ok  = true;
foreach ( $look_ids as $id ) {
    $look_ok = $look_ok && isset( $con_c[ $id ], $sp_c[ $id ] ) && ! isset( $img_org->controls[ $id ] ) && 'yes' === $con_c[ $id ]['condition']['framify_org_deco'] && 'deco' === $con_c[ $id ]['condition']['framify_org_mode'] && 'framify_org_section' === $con_org->section_of[ $id ];
}
check( 'shape look: containers and the Spacer (not the Image widget) can give the shape its own look, only in Behind content mode with the Deco Blob on', $look_ok
    && 'deco' === $con_c['framify_org_look']['default'] && array( 'deco', 'own' ) === array_keys( $con_c['framify_org_look']['options'] ) && 'own' === $con_c['framify_org_look_style']['condition']['framify_org_look'] );

// The blob's own background colour and overlay: CSS only, outside the framify_org_ prefix.
$bg_ok = true;
foreach ( $dp_kinds as $controls ) {
    foreach ( array( 'framify_decobg_color', 'framify_decobg_overlay', 'framify_decobg_overlay_opacity' ) as $id ) {
        $c = $controls[ $id ];
        $sels = array_keys( $c['selectors'] );
        $bg_ok = $bg_ok && 'ui' === $c['render_type'] && empty( $c['frontend_available'] ) && ! isset( $c['global'] ) && 0 !== strpos( $id, 'framify_org_' )
            && 2 === count( $sels ) && false !== strpos( $sels[0], '> .framify-organic__deco--extra' ) && false !== strpos( $sels[1], '> .elementor-widget-container > .framify-organic__deco--extra' );
    }
    $bg_ok = $bg_ok && array( 'framify_org_deco_style!' => 'outline' ) === $controls['framify_decobg_overlay']['condition'] && ! isset( $controls['framify_decobg_color']['condition'] );
}
check( 'deco background: Background colour (overrides the fill, also inside an outline), Overlay colour and opacity, CSS only, Spacer selector included, overlay hidden for Outline', $bg_ok );
check( 'deco section: the Grain section shows when Organic Shape OR the Deco Blob is on, with no condition left on amount / pattern', ( function () use ( $con_org ) {
    $sec = $con_org->sections['framify_grain_section'];
    $or  = $sec['conditions'];
    $names = array_map( function ( $t ) { return $t['name']; }, $or['terms'] );
    return 'or' === $or['relation'] && array( 'framify_org_enable', 'framify_org_deco' ) === $names
        && ! isset( $con_org->controls['framify_org_grain_amount']['condition'] ) && ! isset( $con_org->controls['framify_org_grain_pattern']['condition'] );
} )() );
$note_js = preg_match( "/var DECO_SETTINGS = \[ ([^\]]*) \];/", $org_js, $note_m ) ? array_map( function ( $x ) { return trim( $x, " '" ); }, explode( ',', $note_m[1] ) ) : array();
sort( $note_js );
$dp_sorted = $dp_suffix;
sort( $dp_sorted );
check( 'deco parity: the script maps exactly the settings the PHP registers twice (DECO_SETTINGS = the parity list)', $note_js === $dp_sorted );
check( 'deco parity: the script exposes the Angle maths for tests', false !== strpos( $org_js, 'poseTransform: poseTransform,' ) && false !== strpos( $org_js, 'fitScale: fitScale,' ) && false !== strpos( $org_js, 'decoShapeSettings: decoShapeSettings,' ) );
check( 'deco parity: Organic Shape off does not stop the Deco Blob (setup hands over to setupDecoOnly)', 1 === preg_match( "/'yes' !== s\.framify_org_enable \) \{.*?if \( 'yes' === s\.framify_org_deco \) \{\s*this\.setupDecoOnly\( s \);/s", $org_js ) );

echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit( $failures ? 1 : 0 );
