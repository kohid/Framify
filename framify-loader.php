<?php
/**
 * Framify page loader.
 *
 * A full-screen cover printed at the very top of the page (inline CSS and a
 * small inline script, so it is there from the first paint) that goes away
 * once the page, the fonts and every Organic Shape on it have finished
 * loading. Settings live in Framify > Settings > Page loader (one option,
 * framify_loader); it can show on the whole site or only on pages matching
 * URL rules (the same rule types as the code snippets).
 *
 * Shape-ready signal: while the loader is active, Elementor elements that use
 * Organic Shape get data-framify-shape="pending"; assets/framify-elementor.js
 * sets it to "ready" once the effect is applied (or has nothing to do). The
 * inline script waits for no "pending" element left, with a hard time limit.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Framify_Loader {

    const OPTION = 'framify_loader';

    public static $spinners = array(
        'ring'  => 'Ring',
        'dots'  => 'Dots',
        'pulse' => 'Pulse',
        'bars'  => 'Bars',
        'image' => 'Your own image or GIF',
    );

    public static $rule_types = array(
        'first-page'   => 'Homepage',
        'contains'     => 'URL contains ..',
        'not-contains' => 'URL not contains ..',
        'equal-to'     => 'URL is equal to ..',
        'not-equal-to' => 'URL not equal to ..',
        'begins-with'  => 'URL starts with ..',
        'ends-by'      => 'URL ends by ..',
    );

    private static $active = null;

    public static function init() {
        add_action('wp_head', array(__CLASS__, 'output_head'), 1);
        add_action('wp_body_open', array(__CLASS__, 'output_cover'), 0);
        // A theme that never calls wp_body_open() still gets the cover, at the end of the page.
        add_action('wp_footer', array(__CLASS__, 'output_cover'), 0);
        add_action('elementor/frontend/before_render', array(__CLASS__, 'mark_element'));
    }

    /* ---------- settings ---------- */

    public static function defaults() {
        return array(
            'enabled'         => 0,
            'scope'           => 'all',
            'rules'           => array(),
            'bg_color'        => '#ffffff',
            'bg_image'        => '',
            'bg_size'         => 'cover',
            'bg_position'     => 'center center',
            'overlay_color'   => '#ffffff',
            'overlay_opacity' => 0,
            'spinner'         => 'ring',
            'spinner_image'   => '',
            'spinner_color'   => '#2a7de1',
            'spinner_size'    => 48,
            'text'            => '',
            'text_color'      => '#334155',
            'fade'            => 400,
            'max_seconds'     => 15,
        );
    }

    /** A colour: #rgb, #rrggbb or rgb()/rgba() with numbers only; else the fallback. */
    public static function clean_color($value, $fallback) {
        $value = trim((string) $value);
        if (preg_match('/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i', $value)) {
            return strtolower($value);
        }
        if (preg_match('/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i', $value)) {
            return $value;
        }
        return $fallback;
    }

    /** Anything that comes in (the option, $_POST) -> a complete, safe settings array. */
    public static function sanitize($in) {
        $d   = self::defaults();
        $in  = is_array($in) ? $in : array();
        $out = $d;

        $out['enabled'] = !empty($in['enabled']) ? 1 : 0;
        $out['scope']   = (isset($in['scope']) && 'target' === $in['scope']) ? 'target' : 'all';

        $rules = array();
        if (isset($in['rules']) && is_array($in['rules'])) {
            foreach ($in['rules'] as $rule) {
                if (!is_array($rule) || empty($rule['type']) || !isset(self::$rule_types[$rule['type']])) {
                    continue;
                }
                $value = isset($rule['value']) ? trim(sanitize_text_field((string) $rule['value'])) : '';
                if ('first-page' !== $rule['type'] && '' === $value) {
                    continue;
                }
                $rules[] = array('type' => $rule['type'], 'value' => 'first-page' === $rule['type'] ? '' : $value);
                if (count($rules) >= 30) {
                    break;
                }
            }
        }
        $out['rules'] = $rules;

        $out['bg_color']      = self::clean_color(isset($in['bg_color']) ? $in['bg_color'] : '', $d['bg_color']);
        $out['bg_image']      = isset($in['bg_image']) ? esc_url_raw((string) $in['bg_image']) : '';
        $out['bg_size']       = (isset($in['bg_size']) && in_array($in['bg_size'], array('cover', 'contain', 'auto'), true)) ? $in['bg_size'] : 'cover';
        $positions            = array('center center', 'top center', 'bottom center', 'left center', 'right center', 'top left', 'top right', 'bottom left', 'bottom right');
        $out['bg_position']   = (isset($in['bg_position']) && in_array($in['bg_position'], $positions, true)) ? $in['bg_position'] : 'center center';
        $out['overlay_color'] = self::clean_color(isset($in['overlay_color']) ? $in['overlay_color'] : '', $d['overlay_color']);
        $out['overlay_opacity'] = isset($in['overlay_opacity']) ? max(0, min(100, (int) $in['overlay_opacity'])) : 0;

        $out['spinner']       = (isset($in['spinner']) && isset(self::$spinners[$in['spinner']])) ? $in['spinner'] : 'ring';
        $out['spinner_image'] = isset($in['spinner_image']) ? esc_url_raw((string) $in['spinner_image']) : '';
        $out['spinner_color'] = self::clean_color(isset($in['spinner_color']) ? $in['spinner_color'] : '', $d['spinner_color']);
        $out['spinner_size']  = isset($in['spinner_size']) ? max(16, min(240, (int) $in['spinner_size'])) : $d['spinner_size'];
        $out['text']          = isset($in['text']) ? (function_exists('mb_substr') ? mb_substr(sanitize_text_field((string) $in['text']), 0, 120) : substr(sanitize_text_field((string) $in['text']), 0, 120)) : '';
        $out['text_color']    = self::clean_color(isset($in['text_color']) ? $in['text_color'] : '', $d['text_color']);
        $out['fade']          = isset($in['fade']) ? max(0, min(3000, (int) $in['fade'])) : $d['fade'];
        $out['max_seconds']   = isset($in['max_seconds']) ? max(3, min(120, (int) $in['max_seconds'])) : $d['max_seconds'];

        // The image spinner needs an image.
        if ('image' === $out['spinner'] && '' === $out['spinner_image']) {
            $out['spinner'] = 'ring';
        }
        return $out;
    }

    public static function settings() {
        return self::sanitize(get_option(self::OPTION, array()));
    }

    /* ---------- where it shows ---------- */

    /**
     * The same rule semantics as the code snippets' URL rules: the loader
     * shows when ANY rule matches. $url is the full current URL.
     */
    public static function matches(array $s, $url, $is_front) {
        if ('target' !== $s['scope']) {
            return true;
        }
        foreach ($s['rules'] as $rule) {
            $value = $rule['value'];
            switch ($rule['type']) {
                case 'first-page':
                    if ($is_front) { return true; }
                    break;
                case 'contains':
                    if ('' !== $value && false !== strpos($url, $value)) { return true; }
                    break;
                case 'not-contains':
                    if ('' !== $value && false === strpos($url, $value)) { return true; }
                    break;
                case 'equal-to':
                    if ($url === $value) { return true; }
                    break;
                case 'not-equal-to':
                    if ($url !== $value) { return true; }
                    break;
                case 'begins-with':
                    if ('' !== $value && 0 === strpos($url, $value)) { return true; }
                    break;
                case 'ends-by':
                    if ('' !== $value && substr($url, -strlen($value)) === $value) { return true; }
                    break;
            }
        }
        return false;
    }

    /**
     * The full URL of this request, built on the home URL without doubling
     * the install folder (REQUEST_URI already starts with it).
     */
    public static function current_url() {
        $uri  = isset($_SERVER['REQUEST_URI']) ? wp_unslash($_SERVER['REQUEST_URI']) : '/';
        $home = home_url('/');
        $base = (string) wp_parse_url($home, PHP_URL_PATH);
        if ('' !== $base && '/' !== $base && 0 === strpos($uri, $base)) {
            $uri = substr($uri, strlen($base));
        }
        return $home . ltrim($uri, '/');
    }

    /** Is the loader shown on this request? Cached for the request. */
    public static function active() {
        if (null !== self::$active) {
            return self::$active;
        }
        self::$active = false;
        $s = self::settings();
        if (!$s['enabled']) {
            return false;
        }
        if (is_admin() || is_feed() || is_embed() || is_customize_preview() || wp_doing_ajax()
            || (defined('REST_REQUEST') && REST_REQUEST) || isset($_GET['elementor-preview']) || isset($_GET['framify_preview'])) {
            return false;
        }
        if (class_exists('\Elementor\Plugin') && isset(\Elementor\Plugin::$instance)) {
            $el = \Elementor\Plugin::$instance;
            if (($el->editor && $el->editor->is_edit_mode()) || ($el->preview && $el->preview->is_preview_mode())) {
                return false;
            }
        }
        if (!self::matches($s, self::current_url(), is_front_page())) {
            return false;
        }
        self::$active = (bool) apply_filters('framify_loader_active', true, $s);
        return self::$active;
    }

    /* ---------- output ---------- */

    /**
     * The CSS. $root is the selector of the cover; $preview true draws it
     * statically (the settings-page preview) instead of hiding it until the
     * page script switches it on.
     */
    public static function css(array $s, $root = '#framify-loader', $preview = false) {
        $bg = 'background-color:' . $s['bg_color'] . ';';
        if ('' !== $s['bg_image']) {
            $bg .= 'background-image:url("' . str_replace(array('"', '\\', '<', '>', "\n", "\r"), array('%22', '%5C', '%3C', '%3E', '', ''), $s['bg_image']) . '");background-size:' . $s['bg_size'] . ';background-position:' . $s['bg_position'] . ';background-repeat:no-repeat;';
        }
        $size = (int) $s['spinner_size'];
        $c    = $s['spinner_color'];
        $css  = '';
        if ($preview) {
            $css .= $root . '{position:relative;overflow:hidden;display:flex;}';
        } else {
            $css .= 'html.framify-loading:has(' . $root . '),html.framify-loading:has(' . $root . ') body{overflow:hidden!important;}';
            $css .= $root . '{position:fixed;inset:0;z-index:2147483647;display:none;}';
            $css .= 'html.framify-loading ' . $root . ',html.framify-loaded ' . $root . '{display:flex;}';
            $css .= 'html.framify-loaded ' . $root . '{opacity:0;pointer-events:none;transition:opacity ' . (int) $s['fade'] . 'ms ease;}';
        }
        $css .= $root . '{' . $bg . 'align-items:center;justify-content:center;flex-direction:column;gap:16px;--fl-c:' . $c . ';--fl-s:' . $size . 'px;margin:0;}';
        $css .= $root . '::before{content:"";position:absolute;inset:0;background:var(--fl-oc,' . $s['overlay_color'] . ');opacity:var(--fl-oo,' . ((int) $s['overlay_opacity'] / 100) . ');}';
        $css .= $root . ' .fl-spin,' . $root . ' .fl-text{position:relative;}';
        $css .= $root . ' .fl-text{color:' . $s['text_color'] . ';font:500 15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;max-width:80vw;}';
        $css .= $root . ' .fl-ring{width:var(--fl-s);height:var(--fl-s);border:calc(var(--fl-s)/10) solid transparent;border-top-color:var(--fl-c);border-right-color:var(--fl-c);border-radius:50%;animation:fl-rot .8s linear infinite;box-sizing:border-box;}';
        $css .= $root . ' .fl-dots{display:flex;gap:calc(var(--fl-s)/6);height:var(--fl-s);align-items:center;}';
        $css .= $root . ' .fl-dots i{width:calc(var(--fl-s)/4);height:calc(var(--fl-s)/4);border-radius:50%;background:var(--fl-c);animation:fl-bounce 1s ease-in-out infinite;}';
        $css .= $root . ' .fl-dots i:nth-child(2){animation-delay:.15s;}' . $root . ' .fl-dots i:nth-child(3){animation-delay:.3s;}';
        $css .= $root . ' .fl-pulse{width:var(--fl-s);height:var(--fl-s);border-radius:50%;background:var(--fl-c);animation:fl-pulse 1.2s ease-in-out infinite;}';
        $css .= $root . ' .fl-bars{display:flex;gap:calc(var(--fl-s)/10);height:var(--fl-s);align-items:center;}';
        $css .= $root . ' .fl-bars i{width:calc(var(--fl-s)/7);height:100%;background:var(--fl-c);border-radius:2px;animation:fl-bar 1s ease-in-out infinite;}';
        $css .= $root . ' .fl-bars i:nth-child(2){animation-delay:.1s;}' . $root . ' .fl-bars i:nth-child(3){animation-delay:.2s;}' . $root . ' .fl-bars i:nth-child(4){animation-delay:.3s;}';
        $css .= $root . ' .fl-img{display:block;width:var(--fl-s);height:auto;max-width:60vw;}';
        $css .= '@keyframes fl-rot{to{transform:rotate(360deg);}}@keyframes fl-bounce{0%,80%,100%{transform:scale(.5);opacity:.5;}40%{transform:scale(1);opacity:1;}}@keyframes fl-pulse{0%{transform:scale(.5);opacity:.9;}100%{transform:scale(1.15);opacity:0;}}@keyframes fl-bar{0%,100%{transform:scaleY(.3);}50%{transform:scaleY(1);}}';
        $css .= '@media (prefers-reduced-motion:reduce){' . $root . ' .fl-ring,' . $root . ' .fl-dots i,' . $root . ' .fl-pulse,' . $root . ' .fl-bars i{animation:none;}html.framify-loaded ' . $root . '{transition:none;}}';
        return $css;
    }

    /** The spinner + text inside the cover. */
    public static function inner(array $s) {
        switch ($s['spinner']) {
            case 'dots':
                $spin = '<span class="fl-spin fl-dots"><i></i><i></i><i></i></span>';
                break;
            case 'pulse':
                $spin = '<span class="fl-spin fl-pulse"></span>';
                break;
            case 'bars':
                $spin = '<span class="fl-spin fl-bars"><i></i><i></i><i></i><i></i></span>';
                break;
            case 'image':
                $spin = '<img class="fl-spin fl-img" src="' . esc_url($s['spinner_image']) . '" alt="" decoding="async">';
                break;
            default:
                $spin = '<span class="fl-spin fl-ring"></span>';
        }
        $text = '' !== $s['text'] ? '<span class="fl-text">' . esc_html($s['text']) . '</span>' : '';
        return $spin . $text;
    }

    /** The inline script: shows the cover, then hides it when everything is ready or time is up. */
    public static function script(array $s) {
        $max  = (int) $s['max_seconds'] * 1000;
        $fade = (int) $s['fade'];
        return '(function(){var d=document,h=d.documentElement,w=window,over=false,loaded="complete"===d.readyState,fonts=true,t0=Date.now();'
            . 'h.classList.add("framify-loading");'
            . 'function hide(){if(over){return;}over=true;h.classList.remove("framify-loading");h.classList.add("framify-loaded");'
            . 'setTimeout(function(){var l=d.getElementById("framify-loader");if(l&&l.parentNode){l.parentNode.removeChild(l);}h.classList.remove("framify-loaded");'
            . 'try{w.dispatchEvent(new Event("framify:loader-done"));}catch(e){}},' . $fade . '+60);}'
            . 'function check(){if(over){return;}if(Date.now()-t0>=' . $max . '){hide();return;}'
            . 'if(loaded&&fonts&&!d.querySelector(\'[data-framify-shape="pending"]\')){w.requestAnimationFrame(function(){w.requestAnimationFrame(hide);});return;}'
            . 'setTimeout(check,50);}'
            . 'w.addEventListener("load",function(){loaded=true;});'
            . 'if(d.fonts&&d.fonts.ready){fonts=false;d.fonts.ready.then(function(){fonts=true;},function(){fonts=true;});}'
            . 'setTimeout(hide,' . $max . ');check();})();';
    }

    public static function output_head() {
        if (!self::active()) {
            return;
        }
        $s = self::settings();
        echo '<style id="framify-loader-css">' . self::css($s) . '</style>' . "\n";
        echo '<noscript><style>#framify-loader{display:none!important;}</style></noscript>' . "\n";
        echo '<script id="framify-loader-js" data-cfasync="false" data-no-optimize="1" data-no-defer="1" data-pagespeed-no-defer>' . self::script($s) . '</script>' . "\n";
    }

    public static function output_cover() {
        static $printed = false;
        if ($printed || !self::active()) {
            return;
        }
        $printed = true;
        echo '<div id="framify-loader" role="status" aria-live="polite" aria-label="Loading">' . self::inner(self::settings()) . '</div>' . "\n";
    }

    /** Elements with an Organic Shape wait for their effect before the cover lifts. */
    public static function mark_element($element) {
        if (!self::active() || !is_object($element) || !method_exists($element, 'get_settings')) {
            return;
        }
        if ('yes' === $element->get_settings('framify_org_enable') || 'yes' === $element->get_settings('framify_org_deco')) {
            $element->add_render_attribute('_wrapper', 'data-framify-shape', 'pending');
        }
    }
}

Framify_Loader::init();
