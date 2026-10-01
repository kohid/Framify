<?php
/**
 * Framify - Cache plugin compatibility
 *
 * Three jobs:
 *   1. Mark Framify's inline <style>/<script> so optimizers leave them alone.
 *   2. Purge every detected cache plugin whenever a snippet changes.
 *   3. Signal "do not cache this page" for snippets flagged `always_run`.
 *
 * Every integration is best-effort and fails open: if a cache plugin renames
 * its purge function, that one integration silently no-ops rather than fataling.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Attributes that tell optimizers to leave an inline tag alone.
 *
 * Only attributes actually documented by a plugin are emitted:
 *   data-no-optimize   WP Rocket, LiteSpeed
 *   data-noptimize     Autoptimize (deliberately a different spelling)
 *   data-cfasync       Cloudflare Rocket Loader, Autoptimize, WP Rocket
 *   data-no-defer      LiteSpeed ("Load JS Deferred" exclusion)
 *   nowprocket         WP Rocket ("Delay JavaScript Execution" exclusion)
 *
 * @param string $code_type 'css' or 'js'
 * @param int    $id        Snippet ID, used to build a stable marker.
 * @return string Leading-space attribute string, ready to splice into a tag.
 */
function framify_cache_exclusion_attrs($code_type, $id) {
    $attrs = array(
        'data-no-optimize' => '1',
        'data-noptimize'   => '1',
        'data-cfasync'     => 'false',
        'data-framify'     => $code_type . '-' . intval($id),
    );

    if ($code_type === 'js') {
        // Script-only: these have no meaning on a <style> tag.
        $attrs['data-no-defer'] = '1';
        $attrs['nowprocket']    = '';
    }

    $attrs = apply_filters('framify_cache_exclusion_attrs', $attrs, $code_type, $id);

    $out = '';
    foreach ($attrs as $name => $value) {
        $out .= $value === ''
            ? ' ' . esc_attr($name)
            : ' ' . esc_attr($name) . '="' . esc_attr($value) . '"';
    }

    return $out;
}

/**
 * Every cache plugin Framify knows how to purge.
 *
 * Declarative on purpose: adding a plugin is one array entry, and a vendor
 * renaming a function is a one-line fix. Third parties can add their own via
 * the `framify_cache_purgers` filter rather than editing this file.
 *
 * @return array<string, array{label: string, detect: callable, purge: callable}>
 */
function framify_cache_purgers() {
    $purgers = array(
        'wp-rocket' => array(
            'label'  => 'WP Rocket',
            'detect' => function () { return function_exists('rocket_clean_domain'); },
            'purge'  => function () {
                rocket_clean_domain();
                // Minified CSS/JS and the "used CSS" store are separate caches.
                if (function_exists('rocket_clean_minify')) {
                    rocket_clean_minify();
                }
                if (function_exists('rocket_clean_used_css')) {
                    rocket_clean_used_css();
                }
            },
        ),
        'litespeed' => array(
            'label'  => 'LiteSpeed Cache',
            'detect' => function () { return defined('LSCWP_V') || class_exists('\LiteSpeed\Purge'); },
            'purge'  => function () { do_action('litespeed_purge_all'); },
        ),
        'w3-total-cache' => array(
            'label'  => 'W3 Total Cache',
            'detect' => function () { return function_exists('w3tc_flush_all'); },
            'purge'  => function () { w3tc_flush_all(); },
        ),
        'wp-super-cache' => array(
            'label'  => 'WP Super Cache',
            'detect' => function () { return function_exists('wp_cache_clear_cache'); },
            'purge'  => function () { wp_cache_clear_cache(); },
        ),
        'wp-fastest-cache' => array(
            'label'  => 'WP Fastest Cache',
            'detect' => function () {
                return isset($GLOBALS['wp_fastest_cache'])
                    && is_object($GLOBALS['wp_fastest_cache'])
                    && method_exists($GLOBALS['wp_fastest_cache'], 'deleteCache');
            },
            'purge'  => function () { $GLOBALS['wp_fastest_cache']->deleteCache(true); },
        ),
        'autoptimize' => array(
            'label'  => 'Autoptimize',
            'detect' => function () { return class_exists('autoptimizeCache'); },
            'purge'  => function () { autoptimizeCache::clearall(); },
        ),
        'sg-optimizer' => array(
            'label'  => 'SG Optimizer',
            'detect' => function () { return function_exists('sg_cachepress_purge_cache'); },
            'purge'  => function () { sg_cachepress_purge_cache(); },
        ),
        'breeze' => array(
            'label'  => 'Breeze',
            'detect' => function () { return class_exists('Breeze_Admin'); },
            'purge'  => function () {
                do_action('breeze_clear_all_cache');
                do_action('breeze_clear_varnish');
            },
        ),
        'cache-enabler' => array(
            'label'  => 'Cache Enabler',
            'detect' => function () { return class_exists('Cache_Enabler'); },
            'purge'  => function () { do_action('cache_enabler_clear_complete_cache'); },
        ),
        'hummingbird' => array(
            'label'  => 'Hummingbird',
            'detect' => function () { return class_exists('\Hummingbird\Core\Filesystem'); },
            'purge'  => function () { do_action('wphb_clear_page_cache'); },
        ),
        'swift-performance' => array(
            'label'  => 'Swift Performance',
            'detect' => function () { return class_exists('Swift_Performance_Cache'); },
            'purge'  => function () { Swift_Performance_Cache::clear_all_cache(); },
        ),
        'nitropack' => array(
            'label'  => 'NitroPack',
            'detect' => function () { return function_exists('nitropack_sdk_purge'); },
            'purge'  => function () { nitropack_sdk_purge(); },
        ),
        'wp-engine' => array(
            'label'  => 'WP Engine',
            'detect' => function () {
                return class_exists('WpeCommon') && method_exists('WpeCommon', 'purge_varnish_cache');
            },
            'purge'  => function () { WpeCommon::purge_varnish_cache(); },
        ),
    );

    // Deliberately absent: a generic wp_cache_flush() purger. It would wipe the
    // whole object cache - post meta, transients, cart data - on every snippet
    // save, and buy nothing: snippets are read from the DB at render time, and
    // where a page cache lives in Redis its own purger above already covers it.

    return apply_filters('framify_cache_purgers', $purgers);
}

/**
 * Cache plugins Framify can currently see.
 *
 * @return array<string, string> id => label
 */
function framify_detected_cache_plugins() {
    $detected = array();

    foreach (framify_cache_purgers() as $id => $purger) {
        if (!empty($purger['detect']) && call_user_func($purger['detect'])) {
            $detected[$id] = $purger['label'];
        }
    }

    return $detected;
}

/**
 * Tells every cache layer that this response must not be stored.
 *
 * Note this cannot un-serve a page that is *already* cached - full-page caches
 * decide that in advanced-cache.php, long before any WordPress hook runs. It
 * stops the current response being written to cache; purging on save is what
 * clears whatever is already there.
 */
function framify_force_nocache() {
    // De-facto standard honoured by W3TC, WP Super Cache and others.
    if (!defined('DONOTCACHEPAGE')) {
        define('DONOTCACHEPAGE', true);
    }
    if (!defined('DONOTCACHEOBJECT')) {
        define('DONOTCACHEOBJECT', true);
    }
    if (!defined('DONOTCACHEDB')) {
        define('DONOTCACHEDB', true);
    }

    // LiteSpeed uses its own control API rather than the constant.
    do_action('litespeed_control_set_nocache', 'framify always_run snippet');

    // Cloudflare APO reads this response header at the edge.
    if (!headers_sent()) {
        header('cf-edge-cache: no-cache');
        nocache_headers();
    }

    do_action('framify_nocache_forced');
}

class Framify_Cache {

    /** @var int|null Code ID awaiting a purge, or null when none is pending. */
    private $pending_purge = null;

    public function __construct() {
        add_action('framify_code_changed', array($this, 'schedule_purge'));
        add_action('plugins_loaded', array($this, 'register_optimizer_exclusions'));
    }

    /**
     * Whether Framify should clear caches by itself.
     */
    public static function auto_purge_enabled() {
        return (bool) get_option('framify_auto_purge_cache', 1);
    }

    /**
     * Collapses every change in this request into one purge at shutdown.
     *
     * A bulk action fires framify_code_changed once per row, and purging each
     * time would be wasteful. Deferring also keeps this correct in long-running
     * WP-CLI processes: the purge lands after the last change rather than being
     * skipped, and the AJAX response returns before the purge work happens.
     */
    public function schedule_purge($code_id = 0) {
        if (!self::auto_purge_enabled()) {
            return;
        }

        if ($this->pending_purge === null) {
            add_action('shutdown', array($this, 'run_pending_purge'), 20);
        }

        $this->pending_purge = $code_id;
    }

    public function run_pending_purge() {
        if ($this->pending_purge === null) {
            return;
        }

        $code_id = $this->pending_purge;
        $this->pending_purge = null;

        $this->purge_all_caches($code_id);
    }

    /**
     * Purges every detected cache. Safe to call directly for an immediate purge.
     */
    public function purge_all_caches($code_id = 0) {
        do_action('framify_before_cache_purge', $code_id);

        $purged = array();

        foreach (framify_cache_purgers() as $id => $purger) {
            // detect() is inside the try too - it pokes at third-party globals
            // and must not be able to fatal the request.
            try {
                if (empty($purger['detect']) || !call_user_func($purger['detect'])) {
                    continue;
                }

                call_user_func($purger['purge']);
                $purged[] = $id;
            } catch (Throwable $e) {
                error_log('Framify: cache purge failed for ' . $id . ' - ' . $e->getMessage());
            }
        }

        do_action('framify_after_cache_purge', $purged, $code_id);
    }

    /**
     * Attribute-based exclusion is not honoured by every WP Rocket feature, so
     * register its PHP-side filters against our stable `data-framify` marker
     * as well. Harmless when WP Rocket is absent - the filters simply never run.
     */
    public function register_optimizer_exclusions() {
        $marker = 'data-framify';

        // Keep inline CSS out of "Remove Unused CSS".
        add_filter('rocket_rucss_inline_content_exclusions', function ($excluded) use ($marker) {
            $excluded[] = $marker;
            return $excluded;
        });

        // Keep inline JS out of "Delay JavaScript Execution".
        add_filter('rocket_defer_inline_exclusions', function ($excluded) use ($marker) {
            $excluded[] = $marker;
            return $excluded;
        });

        // Keep inline blocks out of minify/combine.
        add_filter('rocket_excluded_inline_js_content', function ($excluded) use ($marker) {
            $excluded[] = $marker;
            return $excluded;
        });

        add_filter('rocket_minify_excluded_inline_css', function ($excluded) use ($marker) {
            $excluded[] = $marker;
            return $excluded;
        });

        // Never let a cache plugin store Framify's own editor or analyser pages -
        // both embed a per-request nonce that would go stale.
        add_filter('rocket_cache_reject_uri', function ($uris) {
            $uris[] = '/(.*)framify_preview=1(.*)';
            $uris[] = '/(.*)framify_seo=1(.*)';
            return $uris;
        });
    }
}

new Framify_Cache();
