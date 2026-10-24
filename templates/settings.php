<?php
/**
 * Framify - Settings Page
 */
if (!defined('ABSPATH')) exit;

if (isset($_POST['framify_save_settings'])) {
    check_admin_referer('framify_settings_nonce');

    update_option('framify_show_admin_bar', isset($_POST['show_admin_bar']) ? 1 : 0);
    update_option('framify_auto_purge_cache', isset($_POST['auto_purge_cache']) ? 1 : 0);
    update_option('framify_fill_alt', isset($_POST['fill_alt']) ? 1 : 0);

    if (class_exists('Framify_Loader')) {
        update_option(Framify_Loader::OPTION, Framify_Loader::sanitize(isset($_POST['loader']) ? wp_unslash($_POST['loader']) : array()));
    }

    echo '<div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>';
}

$show_admin_bar   = get_option('framify_show_admin_bar', 1);
$auto_purge_cache = get_option('framify_auto_purge_cache', 1);
$fill_alt         = get_option('framify_fill_alt', 1);
$detected_caches  = function_exists('framify_detected_cache_plugins') ? framify_detected_cache_plugins() : array();
$loader = class_exists('Framify_Loader') ? Framify_Loader::settings() : array();
if ($loader) {
    wp_enqueue_media();
    wp_enqueue_style('wp-color-picker');
    wp_enqueue_script('wp-color-picker');
}
$framify_themes = framify_ui_themes();
$framify_theme  = framify_get_user_theme();
?>

<div class="wrap framify-settings">
    <h1>Framify Settings</h1>

    <h2>Theme</h2>
    <p class="description framify-theme-lede">
        Sets the editor chrome and the syntax colours together. This is saved to your account, so it follows you to every site you work on and loads again next time you sign in.
    </p>

    <div class="fr-theme-grid" role="radiogroup" aria-label="Editor theme" id="framify-theme-grid">
        <?php foreach ($framify_themes as $framify_slug => $framify_meta): ?>
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

    <p class="fr-theme-status" id="framify-theme-status" role="status">Saved to your account</p>

    <form method="post" action="">
        <?php wp_nonce_field('framify_settings_nonce'); ?>

        <h2>Preview</h2>
        <table class="form-table">
            <tbody>
                <tr>
                    <th scope="row"><label for="show_admin_bar">Admin bar</label></th>
                    <td>
                        <label>
                            <input type="checkbox" name="show_admin_bar" id="show_admin_bar" value="1" <?php checked($show_admin_bar, 1); ?>>
                            Show the WordPress admin bar inside the preview frame
                        </label>
                        <p class="description">Turn this off for a preview that matches what visitors see.</p>
                    </td>
                </tr>
            </tbody>
        </table>

        <h2>Images</h2>
        <table class="form-table">
            <tbody>
                <tr>
                    <th scope="row"><label for="fill_alt">Alt text</label></th>
                    <td>
                        <label>
                            <input type="checkbox" name="fill_alt" id="fill_alt" value="1" <?php checked($fill_alt, 1); ?>>
                            Fill in empty alt text as pages are sent
                        </label>
                        <p class="description">
                            Page builders and plugins print their own <code>&lt;img&gt;</code> tags and keep alt text
                            in their own settings, so alt text saved to the Media Library never appears on those
                            images. With this on, Framify fills an empty alt from what you have saved &mdash; whoever
                            rendered the image. Alt text that already says something is never changed.
                        </p>
                    </td>
                </tr>
            </tbody>
        </table>

        <?php if ($loader): ?>
        <h2>Page loader</h2>
        <p class="description" style="max-width:62ch;">
            A cover with a spinner that stays over the page until it has fully loaded, fonts and Organic Shapes included,
            so visitors never see pictures jump into their shapes. It never shows in the Elementor editor, the admin
            or the live preview.
        </p>
        <style><?php echo Framify_Loader::css($loader, '.fr-loader-preview', true); ?></style>
        <table class="form-table fr-loader-table">
            <tbody>
                <tr>
                    <th scope="row"><label for="loader_enabled">Page loader</label></th>
                    <td>
                        <label>
                            <input type="checkbox" name="loader[enabled]" id="loader_enabled" value="1" <?php checked($loader['enabled'], 1); ?>>
                            Show a loading screen on the front end
                        </label>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Show on</th>
                    <td>
                        <label><input type="radio" name="loader[scope]" value="all" <?php checked($loader['scope'], 'all'); ?>> Entire site</label><br>
                        <label><input type="radio" name="loader[scope]" value="target" <?php checked($loader['scope'], 'target'); ?>> Target pages</label>
                        <div id="fr-loader-rules-wrap" style="margin-top:10px;max-width:640px;">
                            <p class="description">Shows on a page when <strong>any</strong> rule matches its full URL.</p>
                            <div id="fr-loader-rules">
                                <?php foreach ($loader['rules'] as $i => $rule): ?>
                                <div class="fr-loader-rule" style="display:flex;gap:6px;margin:6px 0;">
                                    <select name="loader[rules][<?php echo (int) $i; ?>][type]" class="fr-rule-type">
                                        <?php foreach (Framify_Loader::$rule_types as $slug => $label): ?>
                                        <option value="<?php echo esc_attr($slug); ?>" <?php selected($rule['type'], $slug); ?>><?php echo esc_html($label); ?></option>
                                        <?php endforeach; ?>
                                    </select>
                                    <input type="text" class="regular-text fr-rule-value" name="loader[rules][<?php echo (int) $i; ?>][value]" value="<?php echo esc_attr($rule['value']); ?>">
                                    <button type="button" class="button fr-rule-remove" aria-label="Remove rule">&times;</button>
                                </div>
                                <?php endforeach; ?>
                            </div>
                            <button type="button" class="button" id="fr-loader-add-rule">Add rule</button>
                        </div>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Background</th>
                    <td>
                        <p><label>Colour<br><input type="text" class="fr-loader-color" name="loader[bg_color]" value="<?php echo esc_attr($loader['bg_color']); ?>" data-default-color="#ffffff"></label></p>
                        <p>
                            <label>Image<br>
                                <input type="url" class="regular-text" name="loader[bg_image]" id="loader_bg_image" value="<?php echo esc_attr($loader['bg_image']); ?>" placeholder="Optional">
                            </label>
                            <button type="button" class="button fr-loader-media" data-target="#loader_bg_image">Choose</button>
                        </p>
                        <p>
                            <label>Size
                                <select name="loader[bg_size]">
                                    <?php foreach (array('cover' => 'Cover', 'contain' => 'Contain', 'auto' => 'Original size') as $v => $l): ?>
                                    <option value="<?php echo esc_attr($v); ?>" <?php selected($loader['bg_size'], $v); ?>><?php echo esc_html($l); ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </label>
                            <label style="margin-left:12px;">Position
                                <select name="loader[bg_position]">
                                    <?php foreach (array('center center', 'top center', 'bottom center', 'left center', 'right center', 'top left', 'top right', 'bottom left', 'bottom right') as $v): ?>
                                    <option value="<?php echo esc_attr($v); ?>" <?php selected($loader['bg_position'], $v); ?>><?php echo esc_html(ucwords($v)); ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </label>
                        </p>
                        <p>
                            <label>Overlay colour<br><input type="text" class="fr-loader-color" name="loader[overlay_color]" value="<?php echo esc_attr($loader['overlay_color']); ?>" data-default-color="#ffffff"></label>
                        </p>
                        <p>
                            <label>Overlay strength
                                <input type="range" min="0" max="100" name="loader[overlay_opacity]" id="loader_overlay_opacity" value="<?php echo (int) $loader['overlay_opacity']; ?>">
                                <output id="loader_overlay_out"><?php echo (int) $loader['overlay_opacity']; ?></output>%
                            </label>
                        </p>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Spinner</th>
                    <td>
                        <p>
                            <select name="loader[spinner]" id="loader_spinner">
                                <?php foreach (Framify_Loader::$spinners as $v => $l): ?>
                                <option value="<?php echo esc_attr($v); ?>" <?php selected($loader['spinner'], $v); ?>><?php echo esc_html($l); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </p>
                        <p id="loader_image_row">
                            <input type="url" class="regular-text" name="loader[spinner_image]" id="loader_spinner_image" value="<?php echo esc_attr($loader['spinner_image']); ?>" placeholder="Image or animated GIF">
                            <button type="button" class="button fr-loader-media" data-target="#loader_spinner_image">Choose</button>
                        </p>
                        <p><label>Colour<br><input type="text" class="fr-loader-color" name="loader[spinner_color]" value="<?php echo esc_attr($loader['spinner_color']); ?>" data-default-color="#2a7de1"></label></p>
                        <p><label>Size (px) <input type="number" min="16" max="240" name="loader[spinner_size]" id="loader_spinner_size" value="<?php echo (int) $loader['spinner_size']; ?>" class="small-text"></label></p>
                        <p>
                            <label>Text under the spinner<br><input type="text" class="regular-text" name="loader[text]" id="loader_text" value="<?php echo esc_attr($loader['text']); ?>" maxlength="120" placeholder="Optional, for example Loading..."></label>
                        </p>
                        <p><label>Text colour<br><input type="text" class="fr-loader-color" name="loader[text_color]" value="<?php echo esc_attr($loader['text_color']); ?>" data-default-color="#334155"></label></p>
                        <div class="fr-loader-preview" id="fr-loader-preview" style="width:320px;height:180px;border:1px solid #c3c4c7;border-radius:6px;"><?php echo Framify_Loader::inner($loader); ?></div>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Timing</th>
                    <td>
                        <p><label>Fade out (ms) <input type="number" min="0" max="3000" step="50" name="loader[fade]" value="<?php echo (int) $loader['fade']; ?>" class="small-text"></label></p>
                        <p>
                            <label>Give up after (seconds) <input type="number" min="3" max="120" name="loader[max_seconds]" value="<?php echo (int) $loader['max_seconds']; ?>" class="small-text"></label>
                        </p>
                        <p class="description">The cover waits until the page has loaded perfectly. This is only a safety net: if something never finishes, the cover goes away after this time so visitors are never stuck behind it.</p>
                    </td>
                </tr>
            </tbody>
        </table>
        <?php endif; ?>

        <h2>Caching</h2>
        <table class="form-table">
            <tbody>
                <tr>
                    <th scope="row"><label for="auto_purge_cache">Clear caches</label></th>
                    <td>
                        <label>
                            <input type="checkbox" name="auto_purge_cache" id="auto_purge_cache" value="1" <?php checked($auto_purge_cache, 1); ?>>
                            Clear caches automatically when snippets change
                        </label>
                        <p class="description">
                            <?php if (!empty($detected_caches)): ?>
                                Framify clears these after every save: <strong><?php echo esc_html(implode(', ', $detected_caches)); ?></strong>.
                            <?php else: ?>
                                No caching plugin detected. Framify will clear one automatically if you install it later.
                            <?php endif; ?>
                        </p>
                    </td>
                </tr>
            </tbody>
        </table>

        <p class="submit">
            <input type="submit" name="framify_save_settings" class="button button-primary" value="Save changes">
        </p>
    </form>

    <h2>Shortcodes</h2>
    <p class="description" style="max-width:60ch;">
        Put either tool on an ordinary page. <strong>You</strong> get the working tool;
        everyone else gets a still of the interface. That split is deliberate &mdash; the
        code editor runs PHP, so an embed anyone could use would hand every visitor a
        way onto your server.
    </p>

    <table class="wp-list-table widefat fixed striped" style="max-width:760px;">
        <thead>
            <tr><th style="width:220px;">Shortcode</th><th>What it does</th></tr>
        </thead>
        <tbody>
            <tr>
                <td><code>[framify_code]</code></td>
                <td>The code editor with its live preview.</td>
            </tr>
            <tr>
                <td><code>[framify_seo]</code></td>
                <td>The SEO analyser.</td>
            </tr>
            <tr>
                <td><code>height="640"</code></td>
                <td>Height of the embedded tool in pixels. Minimum 240.</td>
            </tr>
            <tr>
                <td><code>url="https://&hellip;"</code></td>
                <td>The page to load in the preview. Defaults to your home page.</td>
            </tr>
            <tr>
                <td><code>demo="yes"</code></td>
                <td>Always show the still, even to you &mdash; use it to check what visitors see.</td>
            </tr>
        </tbody>
    </table>

    <p class="description" style="max-width:60ch;">
        Example: <code>[framify_seo height="720" url="<?php echo esc_html( home_url( '/' ) ); ?>"]</code>
    </p>

    <h2>Your code</h2>
    <?php
    global $wpdb;
    $table_name = $wpdb->prefix . 'framify_codes';
    $stats = $wpdb->get_results("
        SELECT
            code_type,
            COUNT(*) as count,
            SUM(is_active) as active_count
        FROM {$table_name}
        GROUP BY code_type
    ");
    ?>

    <table class="wp-list-table widefat fixed striped" style="max-width: 600px;">
        <thead>
            <tr>
                <th>Type</th>
                <th>Total</th>
                <th>Active</th>
                <th>Inactive</th>
            </tr>
        </thead>
        <tbody>
            <?php if ($stats): ?>
                <?php foreach ($stats as $stat): ?>
                <tr>
                    <td><strong><?php echo esc_html(strtoupper($stat->code_type)); ?></strong></td>
                    <td><?php echo intval($stat->count); ?></td>
                    <td><?php echo intval($stat->active_count); ?></td>
                    <td><?php echo intval($stat->count) - intval($stat->active_count); ?></td>
                </tr>
                <?php endforeach; ?>
            <?php else: ?>
                <tr>
                    <td colspan="4">No snippets yet. Open the code editor to write your first one.</td>
                </tr>
            <?php endif; ?>
        </tbody>
    </table>
</div>

<style>
.framify-settings .framify-theme-lede {
    max-width: 60ch;
    margin-bottom: 16px;
}

.framify-settings .fr-theme-grid {
    max-width: 760px;
}

/* The status line sits outside any theme scope, so give it admin-palette colours. */
.framify-settings .fr-theme-status {
    margin-top: 14px;
    color: #50575e;
}

.framify-settings .fr-theme-status.is-saved {
    color: #1d6f42;
}

.framify-settings .fr-theme-status.is-error {
    color: #b32d2e;
}
</style>

<?php if ($loader): ?>
<script>
jQuery(function($) {
    var types = <?php echo wp_json_encode(Framify_Loader::$rule_types); ?>;
    var $rules = $('#fr-loader-rules');

    function reindex() {
        $rules.children('.fr-loader-rule').each(function(i) {
            $(this).find('.fr-rule-type').attr('name', 'loader[rules][' + i + '][type]');
            $(this).find('.fr-rule-value').attr('name', 'loader[rules][' + i + '][value]');
        });
    }
    function syncRule($row) {
        var home = $row.find('.fr-rule-type').val() === 'first-page';
        $row.find('.fr-rule-value').toggle(!home);
    }
    $('#fr-loader-add-rule').on('click', function() {
        var $sel = $('<select class="fr-rule-type"></select>');
        $.each(types, function(slug, label) { $sel.append($('<option></option>').val(slug).text(label)); });
        var $row = $('<div class="fr-loader-rule" style="display:flex;gap:6px;margin:6px 0;"></div>')
            .append($sel)
            .append('<input type="text" class="regular-text fr-rule-value">')
            .append('<button type="button" class="button fr-rule-remove" aria-label="Remove rule">&times;</button>');
        $rules.append($row);
        reindex();
        syncRule($row);
    });
    $rules.on('click', '.fr-rule-remove', function() { $(this).closest('.fr-loader-rule').remove(); reindex(); });
    $rules.on('change', '.fr-rule-type', function() { syncRule($(this).closest('.fr-loader-rule')); });
    $rules.children('.fr-loader-rule').each(function() { syncRule($(this)); });

    function scope() { $('#fr-loader-rules-wrap').toggle($('input[name="loader[scope]"]:checked').val() === 'target'); }
    $('input[name="loader[scope]"]').on('change', scope);
    scope();

    var $prev = $('#fr-loader-preview');
    var spinners = {
        ring: '<span class="fl-spin fl-ring"></span>',
        dots: '<span class="fl-spin fl-dots"><i></i><i></i><i></i></span>',
        pulse: '<span class="fl-spin fl-pulse"></span>',
        bars: '<span class="fl-spin fl-bars"><i></i><i></i><i></i><i></i></span>'
    };
    function preview() {
        var kind = $('#loader_spinner').val();
        var img = $.trim($('#loader_spinner_image').val());
        $('#loader_image_row').toggle(kind === 'image');
        var $spin = kind === 'image' && img ? $('<img class="fl-spin fl-img" alt="">').attr('src', img) : $(spinners[kind] || spinners.ring);
        var text = $.trim($('#loader_text').val());
        $prev.empty().append($spin);
        if (text) { $prev.append($('<span class="fl-text"></span>').text(text)); }
        var bg = $('input[name="loader[bg_color]"]').val();
        var bgImg = $.trim($('#loader_bg_image').val());
        $prev.css({
            backgroundColor: bg,
            backgroundImage: bgImg ? 'url("' + bgImg.replace(/"/g, '%22') + '")' : 'none',
            backgroundSize: $('select[name="loader[bg_size]"]').val(),
            backgroundPosition: $('select[name="loader[bg_position]"]').val(),
            backgroundRepeat: 'no-repeat'
        })[0].style.setProperty('--fl-c', $('input[name="loader[spinner_color]"]').val());
        $prev[0].style.setProperty('--fl-s', ($('#loader_spinner_size').val() || 48) + 'px');
        $prev[0].style.setProperty('--fl-oc', $('input[name="loader[overlay_color]"]').val());
        $prev[0].style.setProperty('--fl-oo', ($('#loader_overlay_opacity').val() || 0) / 100);
        $prev.find('.fl-text').css('color', $('input[name="loader[text_color]"]').val());
        $('#loader_overlay_out').text($('#loader_overlay_opacity').val());
    }
    $('.fr-loader-color').wpColorPicker({ change: function() { setTimeout(preview, 0); }, clear: function() { setTimeout(preview, 0); } });
    $('#fr-loader-preview').closest('table').on('input change', 'input, select', preview);
    preview();

    $('.fr-loader-media').on('click', function(e) {
        e.preventDefault();
        var $target = $($(this).data('target'));
        var frame = wp.media({ title: 'Choose an image', button: { text: 'Use this image' }, multiple: false, library: { type: 'image' } });
        frame.on('select', function() {
            $target.val(frame.state().get('selection').first().toJSON().url).trigger('change');
        });
        frame.open();
    });
});
</script>
<?php endif; ?>
<script>
jQuery(document).ready(function($) {
    var $grid = $('#framify-theme-grid');
    var $cards = $grid.find('.fr-theme');
    var $status = $('#framify-theme-status');

    function setStatus(message, state) {
        $status.text(message).removeClass('is-saved is-error').addClass(state || '');
    }

    function chooseTheme(theme) {
        if (!theme) return;

        $cards.each(function() {
            var isChosen = $(this).data('theme') === theme;
            $(this).attr('aria-checked', isChosen ? 'true' : 'false')
                   .attr('tabindex', isChosen ? '0' : '-1');
        });

        setStatus('Saving');

        $.ajax({
            url: ajaxurl,
            type: 'POST',
            data: {
                action: 'framify_save_ui_theme',
                nonce: '<?php echo wp_create_nonce('framify_nonce'); ?>',
                theme: theme
            }
        }).done(function(response) {
            if (response && response.success) {
                setStatus('Saved to your account', 'is-saved');
            } else {
                setStatus('Server rejected the theme', 'is-error');
            }
        }).fail(function() {
            setStatus('Not saved - check your connection', 'is-error');
        });
    }

    $cards.on('click', function() {
        chooseTheme($(this).data('theme'));
    });

    $grid.on('keydown', '.fr-theme', function(e) {
        var keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
        if (keys.indexOf(e.key) === -1) return;

        e.preventDefault();
        var step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
        var next = ($cards.index(this) + step + $cards.length) % $cards.length;

        $cards.eq(next).trigger('focus');
        chooseTheme($cards.eq(next).data('theme'));
    });
});
</script>
