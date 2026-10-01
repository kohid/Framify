<?php
/**
 * Framify shape library.
 *
 * Two sources, merged into one list for the Organic Shape / Deco Blob
 * "Uploaded" tab:
 *   - assets/shapes/*.svg   shipped with the plugin (wiped by a plugin update,
 *                           so this is where finished shapes are committed);
 *   - uploads/framify-shapes/*.svg  shapes made in the editor (upload or
 *                           freehand scribble); they survive plugin updates.
 *
 * Nothing the user sends is ever stored as given: only the path data
 * (character-whitelisted) and a numeric viewBox are kept, and the file is
 * regenerated as a plain <svg><path/></svg>.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Framify_Shape_Library {

    const MAX_BYTES = 50000;
    const MAX_FILES = 200;
    const MAX_USER  = 100;
    const ACTION_SAVE   = 'framify_shape_save';
    const ACTION_DELETE = 'framify_shape_delete';

    private static $cache = null;

    public static function init() {
        add_action('wp_ajax_' . self::ACTION_SAVE, function () {
            Framify_Shape_Library::ajax_save();
        });
        add_action('wp_ajax_' . self::ACTION_DELETE, function () {
            Framify_Shape_Library::ajax_delete();
        });
    }

    /* ---------- sanitising ---------- */

    /** Path data allowed to be stored: path commands, numbers, separators. */
    public static function clean_d($d) {
        $d = trim(preg_replace('/\s+/', ' ', (string) $d));
        if ('' === $d || strlen($d) > self::MAX_BYTES || preg_match('/[^MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]/', $d)) {
            return '';
        }
        return $d;
    }

    /** "x y w h" from four numbers, else the 100 x 100 default. */
    public static function clean_viewbox($vb) {
        if (preg_match('/^\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*$/', (string) $vb, $m) && (float) $m[3] > 0 && (float) $m[4] > 0) {
            return $m[1] . ' ' . $m[2] . ' ' . $m[3] . ' ' . $m[4];
        }
        return '0 0 100 100';
    }

    /** SVG text -> array( d, vb ) from its path d attributes and viewBox, or null. */
    public static function parse($svg) {
        if (!is_string($svg) || strlen($svg) > self::MAX_BYTES || false === stripos($svg, '<svg')) {
            return null;
        }
        preg_match_all('/\sd\s*=\s*(?:"([^"]*)"|\'([^\']*)\')/', $svg, $m);
        $d = self::clean_d(implode(' ', array_filter(array_merge($m[1], $m[2]))));
        if ('' === $d) {
            return null;
        }
        $vb = '0 0 100 100';
        if (preg_match('/viewBox\s*=\s*"([^"]*)"/i', $svg, $v)) {
            $vb = self::clean_viewbox($v[1]);
        }
        return array('d' => $d, 'vb' => $vb);
    }

    public static function build_svg($d, $vb) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' . $vb . '"><path d="' . $d . '"/></svg>';
    }

    /* ---------- reading ---------- */

    public static function user_dir() {
        if (!function_exists('wp_upload_dir')) {
            return '';
        }
        $u = wp_upload_dir();
        if (!empty($u['error'])) {
            return '';
        }
        return trailingslashit($u['basedir']) . 'framify-shapes/';
    }

    /** id => array( title, svg, thumb, source (plugin|user) ). */
    public static function all() {
        if (null !== self::$cache) {
            return self::$cache;
        }
        self::$cache = array();
        $sources = array('plugin' => FRAMIFY_PLUGIN_DIR . 'assets/shapes/', 'user' => self::user_dir());
        foreach ($sources as $source => $dir) {
            if (!$dir) {
                continue;
            }
            $files = glob($dir . '*.svg');
            if (!$files) {
                continue;
            }
            sort($files);
            foreach (array_slice($files, 0, self::MAX_FILES) as $file) {
                $svg = (filesize($file) <= self::MAX_BYTES) ? file_get_contents($file) : false;
                $p   = $svg ? self::parse($svg) : null;
                if (!$p) {
                    continue;
                }
                $name  = pathinfo($file, PATHINFO_FILENAME);
                $id    = 'lib_' . ('user' === $source ? 'u_' : '') . sanitize_key($name);
                $thumb = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' . $p['vb'] . '"><path fill="#69727d" d="' . $p['d'] . '"/></svg>';
                self::$cache[$id] = array(
                    'title'  => ucwords(trim(preg_replace('/[-_]+/', ' ', $name))),
                    'svg'    => $svg,
                    'thumb'  => 'data:image/svg+xml,' . rawurlencode($thumb),
                    'source' => $source,
                );
            }
        }
        return self::$cache;
    }

    public static function reset() {
        self::$cache = null;
    }

    /* ---------- writing (editor, AJAX) ---------- */

    private static function guard() {
        check_ajax_referer('framify_shapes', 'nonce');
        if (!current_user_can('upload_files')) {
            wp_send_json_error(array('message' => 'You are not allowed to manage shapes.'), 403);
        }
    }

    public static function ajax_save() {
        self::guard();
        $name = isset($_POST['name']) ? sanitize_text_field(wp_unslash($_POST['name'])) : '';
        $slug = sanitize_title($name);
        if ('' === $slug) {
            wp_send_json_error(array('message' => 'Give the shape a name.'), 400);
        }

        // Either a freehand scribble (d + viewBox) or an uploaded SVG's text.
        if (isset($_POST['d'])) {
            $d  = self::clean_d(wp_unslash($_POST['d']));
            $vb = self::clean_viewbox(isset($_POST['vb']) ? wp_unslash($_POST['vb']) : '');
            $p  = '' === $d ? null : array('d' => $d, 'vb' => $vb);
        } else {
            $p = self::parse(isset($_POST['svg']) ? wp_unslash($_POST['svg']) : '');
        }
        if (!$p) {
            wp_send_json_error(array('message' => 'No usable path found. Use an SVG made of <path> elements (convert shapes and strokes to paths first).'), 400);
        }

        $dir = self::user_dir();
        if (!$dir || !wp_mkdir_p($dir)) {
            wp_send_json_error(array('message' => 'The uploads folder is not writable.'), 500);
        }
        if (count(glob($dir . '*.svg') ?: array()) >= self::MAX_USER) {
            wp_send_json_error(array('message' => 'Shape limit reached. Delete one first.'), 400);
        }
        $file = $dir . $slug . '.svg';
        for ($i = 2; file_exists($file); $i++) {
            $file = $dir . $slug . '-' . $i . '.svg';
        }
        if (false === file_put_contents($file, self::build_svg($p['d'], $p['vb']))) {
            wp_send_json_error(array('message' => 'Could not write the file.'), 500);
        }
        self::reset();
        wp_send_json_success(array('id' => 'lib_u_' . sanitize_key(pathinfo($file, PATHINFO_FILENAME))));
    }

    public static function ajax_delete() {
        self::guard();
        $id  = isset($_POST['id']) ? sanitize_key(wp_unslash($_POST['id'])) : '';
        $all = self::all();
        if (0 !== strpos($id, 'lib_u_') || empty($all[$id]) || 'user' !== $all[$id]['source']) {
            wp_send_json_error(array('message' => 'Only shapes made in the editor can be deleted here.'), 400);
        }
        $file = self::user_dir() . substr($id, strlen('lib_u_')) . '.svg';
        if (is_file($file)) {
            unlink($file);
        }
        self::reset();
        wp_send_json_success();
    }
}

Framify_Shape_Library::init();
