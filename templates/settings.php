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

    echo '<div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>';
}

$show_admin_bar   = get_option('framify_show_admin_bar', 1);
$auto_purge_cache = get_option('framify_auto_purge_cache', 1);
$fill_alt         = get_option('framify_fill_alt', 1);
$detected_caches  = function_exists('framify_detected_cache_plugins') ? framify_detected_cache_plugins() : array();
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
