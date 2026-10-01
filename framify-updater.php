<?php
/**
 * Framify GitHub updater.
 *
 * Shows new GitHub Releases on the Plugins screen and installs them with the
 * normal "update now" flow. Release tag (v1.7.1 or 1.7.1) is the version.
 *
 * Private repo: define FRAMIFY_GITHUB_TOKEN in wp-config.php with a
 * fine-grained token (this repo, Contents: read-only).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Framify_Updater {

    const REPO      = 'kohid/Framify';
    const CACHE_KEY = 'framify_github_release';
    const CACHE_TTL = 6 * HOUR_IN_SECONDS;

    private $basename;
    private $slug = 'framify';

    public function __construct() {
        $this->basename = plugin_basename(FRAMIFY_PLUGIN_DIR . 'framify.php');

        add_filter('pre_set_site_transient_update_plugins', array($this, 'inject_update'));
        add_filter('plugins_api', array($this, 'plugin_info'), 20, 3);
        add_filter('upgrader_source_selection', array($this, 'fix_folder_name'), 10, 4);
        add_filter('http_request_args', array($this, 'authorize_download'), 10, 2);
        add_filter('plugin_action_links_' . $this->basename, array($this, 'action_links'));
        add_action('admin_init', array($this, 'handle_manual_check'));
        add_action('admin_notices', array($this, 'check_notice'));
        add_action('upgrader_process_complete', array($this, 'clear_cache'), 10, 0);
    }

    private function token() {
        return defined('FRAMIFY_GITHUB_TOKEN') ? FRAMIFY_GITHUB_TOKEN : '';
    }

    private function api_headers($accept = 'application/vnd.github+json') {
        $headers = array('Accept' => $accept, 'User-Agent' => 'Framify-Updater');
        if ($this->token()) {
            $headers['Authorization'] = 'Bearer ' . $this->token();
        }
        return $headers;
    }

    /**
     * Latest release, normalised, cached. Returns null on any failure.
     */
    private function latest_release() {
        $cached = get_site_transient(self::CACHE_KEY);
        if (is_array($cached)) {
            return $cached ?: null;
        }

        $res = wp_remote_get(
            'https://api.github.com/repos/' . self::REPO . '/releases/latest',
            array('timeout' => 10, 'headers' => $this->api_headers())
        );
        if (is_wp_error($res) || 200 !== wp_remote_retrieve_response_code($res)) {
            $code = is_wp_error($res) ? $res->get_error_message() : 'HTTP ' . wp_remote_retrieve_response_code($res);
            update_site_option('framify_github_last', ($this->token() ? 'token set' : 'NO TOKEN (FRAMIFY_GITHUB_TOKEN not defined)') . ' - GitHub said: ' . $code);
            // Cache the failure briefly so a down/unauthorised API isn't hit on every admin load.
            set_site_transient(self::CACHE_KEY, array(), 15 * MINUTE_IN_SECONDS);
            return null;
        }

        $r = json_decode(wp_remote_retrieve_body($res), true);
        if (empty($r['tag_name'])) {
            update_site_option('framify_github_last', 'GitHub answered but no release tag found.');
            return null;
        }
        update_site_option('framify_github_last', 'OK - latest release on GitHub is ' . ltrim($r['tag_name'], 'vV') . '; installed is ' . FRAMIFY_VERSION . '.');

        // Prefer an uploaded framify.zip asset; fall back to the auto-generated zipball.
        $package = $r['zipball_url'];
        foreach ((array) ($r['assets'] ?? array()) as $asset) {
            if ('framify.zip' === $asset['name']) {
                $package = $this->token() ? $asset['url'] : $asset['browser_download_url'];
                break;
            }
        }

        $release = array(
            'version' => ltrim($r['tag_name'], 'vV'),
            'package' => $package,
            'url'     => $r['html_url'],
            'notes'   => (string) ($r['body'] ?? ''),
            'date'    => (string) ($r['published_at'] ?? ''),
        );
        set_site_transient(self::CACHE_KEY, $release, self::CACHE_TTL);
        return $release;
    }

    public function inject_update($transient) {
        if (!is_object($transient)) {
            return $transient;
        }
        $release = $this->latest_release();
        if (!$release || !version_compare($release['version'], FRAMIFY_VERSION, '>')) {
            return $transient;
        }
        $transient->response[$this->basename] = (object) array(
            'id'          => 'github.com/' . self::REPO,
            'slug'        => $this->slug,
            'plugin'      => $this->basename,
            'new_version' => $release['version'],
            'url'         => $release['url'],
            'package'     => $release['package'],
        );
        return $transient;
    }

    /** "View details" popup. */
    public function plugin_info($result, $action, $args) {
        if ('plugin_information' !== $action || empty($args->slug) || $this->slug !== $args->slug) {
            return $result;
        }
        $release = $this->latest_release();
        if (!$release) {
            return $result;
        }
        return (object) array(
            'name'          => 'Framify',
            'slug'          => $this->slug,
            'version'       => $release['version'],
            'author'        => 'Jay Miralles',
            'homepage'      => 'https://github.com/' . self::REPO,
            'download_link' => $release['package'],
            'last_updated'  => $release['date'],
            'sections'      => array(
                'description' => 'Responsive live floating code editor with CSS, jQuery, and PHP snippets.',
                'changelog'   => nl2br(esc_html($release['notes'] ?: 'See the GitHub release.')),
            ),
        );
    }

    /**
     * GitHub zipballs unpack to "owner-repo-hash/". Rename to "framify/" so the
     * update replaces the installed folder instead of installing a second copy.
     */
    public function fix_folder_name($source, $remote_source, $upgrader, $hook_extra) {
        global $wp_filesystem;
        if (empty($hook_extra['plugin']) || $hook_extra['plugin'] !== $this->basename) {
            return $source;
        }
        $wanted = trailingslashit($remote_source) . $this->slug . '/';
        if (trailingslashit($source) === $wanted) {
            return $source;
        }
        if ($wp_filesystem->move($source, $wanted, true)) {
            return $wanted;
        }
        return new WP_Error('framify_rename_failed', 'Framify: could not rename the update folder.');
    }

    /**
     * Private-repo downloads need the token. Only the release asset download
     * wants the octet-stream Accept header; the release lookup must keep JSON
     * (octet-stream there makes GitHub answer 415).
     */
    public function authorize_download($args, $url) {
        $base = 'https://api.github.com/repos/' . self::REPO . '/';
        if (!$this->token() || 0 !== strpos($url, $base)) {
            return $args;
        }
        if (false !== strpos($url, '/releases/assets/')) {
            $accept = 'application/octet-stream';
        } elseif (false !== strpos($url, '/zipball/')) {
            $accept = 'application/vnd.github+json';
        } else {
            return $args;
        }
        $args['headers'] = array_merge(
            isset($args['headers']) ? (array) $args['headers'] : array(),
            $this->api_headers($accept)
        );
        return $args;
    }

    public function action_links($links) {
        if (current_user_can('update_plugins')) {
            $url = wp_nonce_url(admin_url('plugins.php?framify_check_update=1'), 'framify_check_update');
            $links[] = '<a href="' . esc_url($url) . '">Check for updates</a>';
        }
        return $links;
    }

    public function handle_manual_check() {
        if (empty($_GET['framify_check_update']) || !current_user_can('update_plugins')
            || !wp_verify_nonce(isset($_GET['_wpnonce']) ? $_GET['_wpnonce'] : '', 'framify_check_update')) {
            return;
        }
        $this->clear_cache();
        // WordPress skips its own re-check for up to 12 h unless this is gone.
        delete_site_transient('update_plugins');
        wp_update_plugins();
        wp_safe_redirect(admin_url('plugins.php?framify_checked=1'));
        exit;
    }

    /** After "Check for updates": say what GitHub answered. */
    public function check_notice() {
        if (empty($_GET['framify_checked']) || !current_user_can('update_plugins')) {
            return;
        }
        $msg = get_site_option('framify_github_last', 'No answer recorded.');
        $ok  = 0 === strpos($msg, 'OK');
        printf('<div class="notice notice-%s is-dismissible"><p><strong>Framify updater:</strong> %s</p></div>',
            $ok ? 'info' : 'error', esc_html($msg));
    }

    public function clear_cache() {
        delete_site_transient(self::CACHE_KEY);
    }
}

new Framify_Updater();
