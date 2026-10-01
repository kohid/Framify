<?php
/**
 * Plugin Name: Framify
 * Description: Responsive live floating code editor with CSS, jQuery, and PHP snippets. Features multiple viewport previews and advanced instance management.
 * Version: 1.12.0
 * Author: Jay Miralles
 * License: GPL v2 or later
 * Text Domain: framify
 */

if (!defined('ABSPATH')) {
    exit;
}

define('FRAMIFY_VERSION', '1.12.0');
// Unchanged: the schema did not move in 1.2.1, so no migration should run.
define('FRAMIFY_DB_VERSION', '1.2.0');
define('FRAMIFY_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('FRAMIFY_PLUGIN_URL', plugin_dir_url(__FILE__));

define('FRAMIFY_THEME_META_KEY', 'framify_ui_theme');
define('FRAMIFY_DEFAULT_THEME', 'graphite');

/**
 * The interface themes a user can pick from.
 * Each maps the Framify chrome to a matching CodeMirror syntax theme.
 */
function framify_ui_themes() {
    return array(
        'daylight'  => array('label' => 'Daylight',  'blurb' => 'Cool paper, indigo accent',   'cm' => 'neo'),
        'graphite'  => array('label' => 'Graphite',  'blurb' => 'Neutral dark, blue accent',   'cm' => 'material-darker'),
        'ember'     => array('label' => 'Ember',     'blurb' => 'Warm dark, amber accent',     'cm' => 'gruvbox-dark'),
        'blueprint' => array('label' => 'Blueprint', 'blurb' => 'Deep navy, cyan accent',      'cm' => 'cobalt'),
        'contrast'  => array('label' => 'Contrast',  'blurb' => 'Maximum legibility',          'cm' => 'eclipse'),
    );
}

/**
 * The theme saved on the current user's account, falling back to the default.
 */
function framify_get_user_theme($user_id = 0) {
    $user_id = $user_id ? $user_id : get_current_user_id();
    $theme = $user_id ? get_user_meta($user_id, FRAMIFY_THEME_META_KEY, true) : '';

    return array_key_exists($theme, framify_ui_themes()) ? $theme : FRAMIFY_DEFAULT_THEME;
}

/**
 * Guards Framify's framed pages against scripts that assume the parent window
 * is the Elementor editor.
 *
 * Elementor Pro's Notes module ends with an unguarded
 * `window.top.$e.components.register(...)`. On an ordinary page window.top is
 * the page itself, so `$e` is there. Inside Framify's iframe window.top is this
 * page, which carries no Elementor runtime, and the call throws a TypeError.
 *
 * A no-op `$e` lets those registrations complete harmlessly. This cannot fool a
 * script into thinking it is in the editor: Elementor detects that with
 * `window.elementor` on its own window, never with the truthiness of
 * `window.top.$e`. Must be printed before the iframe is parsed.
 */
function framify_print_frame_guard() {
    ?>
    <script>
    window.$e = window.$e || {
        components: {
            register: function () {},
            // Shaped to survive the chained reads Notes makes: `.config.urls`
            // and destructuring `{ actions }`.
            get: function () { return { config: { urls: {} }, actions: {} }; }
        },
        run: function () {},
        route: function () {},
        extras: { hashCommands: { runOnce: function () {} } }
    };
    </script>
    <?php
}

class Framify {

    private $table_name;
    private $revisions_table;
    
    public function __construct() {
        global $wpdb;
        $this->table_name = $wpdb->prefix . 'framify_codes';
        $this->revisions_table = $wpdb->prefix . 'framify_revisions';
        
        register_activation_hook(__FILE__, array($this, 'activate'));
        add_action('plugins_loaded', array($this, 'maybe_upgrade_db'));
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_scripts'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_frontend_scripts'));
        
        // AJAX handlers
        add_action('wp_ajax_framify_save_code', array($this, 'ajax_save_code'));
        add_action('wp_ajax_framify_get_codes', array($this, 'ajax_get_codes'));
        add_action('wp_ajax_framify_get_code', array($this, 'ajax_get_code'));
        add_action('wp_ajax_framify_delete_code', array($this, 'ajax_delete_code'));
        add_action('wp_ajax_framify_toggle_active', array($this, 'ajax_toggle_active'));
        add_action('wp_ajax_framify_get_revisions', array($this, 'ajax_get_revisions'));
        add_action('wp_ajax_framify_restore_revision', array($this, 'ajax_restore_revision'));
        add_action('wp_ajax_framify_delete_revision', array($this, 'ajax_delete_revision'));
        add_action('wp_ajax_framify_bulk_action', array($this, 'ajax_bulk_action'));
        add_action('wp_ajax_framify_save_ui_theme', array($this, 'ajax_save_ui_theme'));
        
        // Output custom code
        add_action('wp_head', array($this, 'output_head_code'), 999);
        add_action('wp_body_open', array($this, 'output_body_code'), 1);
        add_action('wp_footer', array($this, 'output_footer_code'), 999);
        add_action('admin_head', array($this, 'output_admin_head_code'), 999);
        add_action('admin_footer', array($this, 'output_admin_footer_code'), 999);
        add_action('login_head', array($this, 'output_login_code'));
        add_action('init', array($this, 'execute_php_snippets'));

        // Hooked on `wp`, not earlier: the `first-page` URL rule calls
        // is_front_page(), which needs the main query parsed.
        add_action('wp', array($this, 'maybe_force_nocache'));
        add_action('framify_code_changed', array($this, 'flush_always_run_cache'));
        
        // Register live preview page
        add_action('init', array($this, 'register_live_preview_endpoint'));
        add_action('template_redirect', array($this, 'handle_live_preview_page'));
        
        // Add Framify button to admin bar
        add_action('admin_bar_menu', array($this, 'add_framify_admin_bar_button'), 999);
        
    }
    
    /**
     * The canonical schema. Single source of truth for both a fresh install and
     * every later migration, so the two can never drift apart.
     */
    private function get_schema_sql() {
        global $wpdb;
        $charset_collate = $wpdb->get_charset_collate();

        // No IF NOT EXISTS: dbDelta parses the table name with
        // /CREATE (TEMPORARY )?TABLE ([^ ]*)/ and would read it as "IF",
        // silently diffing against a table that does not exist. dbDelta
        // already creates the table when it is missing.
        $codes = "CREATE TABLE {$this->table_name} (
            id mediumint(9) NOT NULL AUTO_INCREMENT,
            title varchar(255) NOT NULL,
            code_type varchar(20) NOT NULL DEFAULT 'css',
            code_content longtext,
            linking_type varchar(20) DEFAULT 'internal',
            where_on_page varchar(20) DEFAULT 'header',
            where_in_site varchar(50) DEFAULT 'frontend',
            minify_code tinyint(1) DEFAULT 0,
            priority int(3) DEFAULT 5,
            url_rules longtext,
            is_active tinyint(1) DEFAULT 1,
            always_run tinyint(1) DEFAULT 0,
            author_id bigint(20),
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY  (id)
        ) $charset_collate;";

        $revisions = "CREATE TABLE {$this->revisions_table} (
            id mediumint(9) NOT NULL AUTO_INCREMENT,
            code_id mediumint(9) NOT NULL,
            code_content longtext,
            created_at datetime DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY code_id (code_id)
        ) $charset_collate;";

        return array($codes, $revisions);
    }

    public function activate() {
        $this->run_schema_migration();
        $this->ensure_upload_dir();
    }

    /**
     * Applies the schema and records the version, but only claims success once
     * the columns are verifiably present. dbDelta reports nothing when an
     * ALTER TABLE fails (insufficient privileges, strict mode), so writing the
     * version option optimistically would leave a half-migrated install that
     * never retries.
     */
    private function run_schema_migration() {
        global $wpdb;

        require_once(ABSPATH . 'wp-admin/includes/upgrade.php');

        foreach ($this->get_schema_sql() as $sql) {
            dbDelta($sql);
        }

        if ($this->schema_is_current()) {
            update_option('framify_db_version', FRAMIFY_DB_VERSION);
            return true;
        }

        delete_option('framify_db_version');
        error_log('Framify: schema migration did not complete - the always_run column is missing from ' . $this->table_name . '. Check database privileges.');

        return false;
    }

    /**
     * Confirms the newest column actually exists, rather than trusting dbDelta.
     */
    private function schema_is_current() {
        global $wpdb;

        $column = $wpdb->get_var($wpdb->prepare(
            "SHOW COLUMNS FROM {$this->table_name} LIKE %s",
            'always_run'
        ));

        return !empty($column);
    }

    /**
     * Runs on every request but costs one autoloaded option read once migrated.
     * Needed because register_activation_hook does not fire when plugin files
     * are replaced in place, which is how most updates actually land.
     */
    public function maybe_upgrade_db() {
        if (get_option('framify_db_version') === FRAMIFY_DB_VERSION) {
            return;
        }

        $this->run_schema_migration();
        $this->ensure_upload_dir();
    }

    /**
     * Creates the snippet-file directory and its PHP-execution guard if needed.
     * The single owner of that .htaccess content - both activation and the file
     * writer call through here so the two can't drift apart.
     *
     * @return string Absolute path to the directory.
     */
    private function ensure_upload_dir() {
        $upload_dir = wp_upload_dir();
        $framify_dir = $upload_dir['basedir'] . '/framify-files';

        if (!file_exists($framify_dir)) {
            wp_mkdir_p($framify_dir);

            // Stop the .php snippet files being executed directly.
            $htaccess_content = "# Protect Framify files\n";
            $htaccess_content .= "<FilesMatch \"\\.php$\">\n";
            $htaccess_content .= "    Order Deny,Allow\n";
            $htaccess_content .= "    Deny from all\n";
            $htaccess_content .= "</FilesMatch>\n";
            file_put_contents($framify_dir . '/.htaccess', $htaccess_content);
        }

        return $framify_dir;
    }
    
    public function add_admin_menu() {
        // Main menu - redirects to Live Preview
        add_menu_page(
            'Framify',
            'Framify',
            'manage_options',
            'framify',
            array($this, 'render_live_preview_page'),
            'dashicons-editor-code',
            80
        );
        
        // Submenu items
        add_submenu_page(
            'framify',
            'Live Preview',
            'Live Preview',
            'manage_options',
            'framify',
            array($this, 'render_live_preview_page')
        );
        
        add_submenu_page(
            'framify',
            'Settings',
            'Settings',
            'manage_options',
            'framify-settings',
            array($this, 'render_settings_page')
        );
        
        // Hidden pages (no menu items, but accessible via URL)
        add_submenu_page(
            null, // null parent = hidden from menu
            'All Custom Code',
            'All Custom Code',
            'manage_options',
            'framify-all',
            array($this, 'render_all_codes_page')
        );
        
        add_submenu_page(
            null, // null parent = hidden from menu
            'Add Custom Code',
            'Add Custom Code',
            'manage_options',
            'framify-add',
            array($this, 'render_add_code_page')
        );
    }
    
    public function enqueue_admin_scripts($hook) {
        if (strpos($hook, 'framify') === false) {
            return;
        }
        
        // CodeMirror core
        wp_enqueue_style('codemirror-css', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css');
        wp_enqueue_style('codemirror-theme-monokai', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/monokai.min.css');
        wp_enqueue_style('codemirror-hint', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.css');
        
        wp_enqueue_script('codemirror-js', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js', array('jquery'), null, true);
        
        // Language modes
        wp_enqueue_script('codemirror-css-mode', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/css/css.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-javascript-mode', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-php-mode', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/php/php.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-clike-mode', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/clike/clike.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-xml-mode', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/xml/xml.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-htmlmixed-mode', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/htmlmixed/htmlmixed.min.js', array('codemirror-js'), null, true);
        
        // Editing addons
        wp_enqueue_script('codemirror-closebrackets', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/closebrackets.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-closetag', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/closetag.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-matchbrackets', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchbrackets.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-matchtags', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchtags.min.js', array('codemirror-js'), null, true);
        
        // Hint/autocomplete addons
        wp_enqueue_script('codemirror-show-hint', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-css-hint', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/css-hint.min.js', array('codemirror-js'), null, true);
        wp_enqueue_script('codemirror-javascript-hint', 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/javascript-hint.min.js', array('codemirror-js'), null, true);
        
        wp_enqueue_style('framify-themes-css', FRAMIFY_PLUGIN_URL . 'assets/framify-themes.css', array(), FRAMIFY_VERSION);
        wp_enqueue_style('framify-admin-css', FRAMIFY_PLUGIN_URL . 'assets/admin-style.css', array('framify-themes-css'), FRAMIFY_VERSION);
        wp_enqueue_script('framify-admin-js', FRAMIFY_PLUGIN_URL . 'assets/admin-script.js', array('jquery', 'codemirror-js'), FRAMIFY_VERSION, true);
        
        wp_localize_script('framify-admin-js', 'framifyData', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('framify_nonce'),
            'site_url' => home_url(),
            'plugin_url' => FRAMIFY_PLUGIN_URL,
            'current_page' => isset($_GET['page']) ? $_GET['page'] : ''
        ));
    }
    
    public function enqueue_frontend_scripts() {
        wp_enqueue_script('jquery');
    }
    
    public function render_all_codes_page() {
        $template = FRAMIFY_PLUGIN_DIR . 'templates' . DIRECTORY_SEPARATOR . 'all-codes.php';
        if (file_exists($template)) {
            include $template;
        } else {
            echo '<div class="wrap"><h1>Template not found</h1>';
            echo '<p>Expected location: ' . esc_html($template) . '</p>';
            echo '<p>Plugin directory: ' . esc_html(FRAMIFY_PLUGIN_DIR) . '</p>';
            echo '<p>Please ensure the templates folder and files exist.</p></div>';
        }
    }
    
    public function render_add_code_page() {
        $template = FRAMIFY_PLUGIN_DIR . 'templates' . DIRECTORY_SEPARATOR . 'add-code.php';
        if (file_exists($template)) {
            include $template;
        } else {
            echo '<div class="wrap"><h1>Template not found</h1>';
            echo '<p>Expected location: ' . esc_html($template) . '</p>';
            echo '<p>Plugin directory: ' . esc_html(FRAMIFY_PLUGIN_DIR) . '</p>';
            echo '<p>Please ensure the templates folder and files exist.</p></div>';
        }
    }
    
    public function render_live_preview_page() {
        // Redirect to the unique live preview URL
        $preview_url = add_query_arg(array(
            'framify_preview' => '1',
            'token' => wp_create_nonce('framify_preview')
        ), home_url('/'));
        
        wp_redirect($preview_url);
        exit;
    }
    
    /**
     * Add Framify button to WordPress admin bar
     */
    public function add_framify_admin_bar_button($wp_admin_bar) {
        if (!current_user_can('manage_options')) {
            return;
        }

        if (is_admin()) {
            $current_url = home_url('/');
        } else {
            global $wp;
            $current_url = home_url(add_query_arg(array(), $wp->request));
            if (empty($current_url) || $current_url === home_url()) {
                $current_url = home_url('/');
            }
        }

        $code_url = add_query_arg(array(
            'framify_preview' => '1',
            'token'           => wp_create_nonce('framify_preview'),
            'preview_url'     => urlencode($current_url),
        ), home_url('/'));

        $seo_url = add_query_arg(array(
            'framify_seo'  => '1',
            'token'        => wp_create_nonce('framify_seo'),
            'preview_url'  => urlencode($current_url),
        ), home_url('/'));

        // Parent node
        $wp_admin_bar->add_node(array(
            'id'    => 'framify-root',
            'title' => '<span class="ab-icon dashicons dashicons-editor-code"></span><span class="ab-label">Framify</span>',
            'href'  => false,
            'meta'  => array('class' => 'framify-admin-bar-button'),
        ));

        // Code Editor child
        $wp_admin_bar->add_node(array(
            'id'     => 'framify-live-preview',
            'parent' => 'framify-root',
            'title'  => '<span class="dashicons dashicons-code-standards"></span> Code Editor',
            'href'   => $code_url,
            'meta'   => array('title' => 'Open Framify Code Editor', 'target' => '_blank'),
        ));

        // SEO Analyzer child
        $wp_admin_bar->add_node(array(
            'id'     => 'framify-seo',
            'parent' => 'framify-root',
            'title'  => '<span class="dashicons dashicons-chart-line"></span> SEO Analyzer',
            'href'   => $seo_url,
            'meta'   => array('title' => 'Open Framify SEO Analyzer', 'target' => '_blank'),
        ));
    }
    
    public function register_live_preview_endpoint() {
        // This allows us to intercept the preview page request
        if (isset($_GET['framify_preview']) && $_GET['framify_preview'] === '1') {
            add_filter('show_admin_bar', '__return_false');
        }
    }
    
    public function handle_live_preview_page() {
        if (isset($_GET['framify_preview']) && $_GET['framify_preview'] === '1') {
            // Verify nonce
            if (!isset($_GET['token']) || !wp_verify_nonce($_GET['token'], 'framify_preview')) {
                wp_die('Invalid preview token');
            }
            
            // Check user capability
            if (!current_user_can('manage_options')) {
                wp_die('You do not have permission to access this page');
            }
            
            // Load the live preview template
            $this->render_live_preview_template();
            exit;
        }
    }
    
    public function render_live_preview_template() {
        global $wpdb;
        $table_name = $wpdb->prefix . 'framify_codes';
        // Fetch ALL codes (active and inactive) so inactive ones still appear in the editor dropdowns
        $codes = $wpdb->get_results("SELECT id, title, code_type, is_active FROM {$table_name} ORDER BY title ASC");
        
        // Disable admin bar
        show_admin_bar(false);
        
        include FRAMIFY_PLUGIN_DIR . 'templates' . DIRECTORY_SEPARATOR . 'live-preview-frontend.php';
    }
    
    public function render_settings_page() {
        $template = FRAMIFY_PLUGIN_DIR . 'templates' . DIRECTORY_SEPARATOR . 'settings.php';
        if (file_exists($template)) {
            include $template;
        } else {
            echo '<div class="wrap"><h1>Template not found</h1>';
            echo '<p>Expected location: ' . esc_html($template) . '</p>';
            echo '<p>Plugin directory: ' . esc_html(FRAMIFY_PLUGIN_DIR) . '</p>';
            echo '<p>Please ensure the templates folder and files exist.</p></div>';
        }
    }
    
    // AJAX: Save code
    public function ajax_save_code() {
        check_ajax_referer('framify_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        
        $id = isset($_POST['id']) ? intval($_POST['id']) : 0;
        $title = isset($_POST['title']) ? sanitize_text_field($_POST['title']) : '';
        $code_type = isset($_POST['code_type']) ? sanitize_text_field($_POST['code_type']) : 'css';
        $code_content = isset($_POST['code_content']) ? wp_unslash($_POST['code_content']) : '';
        $linking_type = isset($_POST['linking_type']) ? sanitize_text_field($_POST['linking_type']) : 'internal';
        $where_on_page = isset($_POST['where_on_page']) ? sanitize_text_field($_POST['where_on_page']) : 'header';
        $where_in_site = isset($_POST['where_in_site']) ? sanitize_text_field($_POST['where_in_site']) : 'frontend';
        $minify_code = isset($_POST['minify_code']) ? 1 : 0;
        // The field is min=1 max=999, but that only binds on native form submit -
        // this posts via AJAX, so clamp here. An emptied field would otherwise
        // save as 0 and silently jump the snippet to the front of the queue.
        $priority = isset($_POST['priority']) ? intval($_POST['priority']) : 5;
        $priority = max(1, min(999, $priority));
        $url_rules = isset($_POST['url_rules']) ? wp_unslash($_POST['url_rules']) : '';
        $is_active = isset($_POST['is_active']) ? intval($_POST['is_active']) : 0;
        $always_run = isset($_POST['always_run']) ? intval($_POST['always_run']) : 0;
        $create_file = isset($_POST['create_file']) ? true : false;
        $quick_save = isset($_POST['quick_save']) ? true : false;
        
        // Handle quick save (only update code_content)
        if ($quick_save && $id > 0) {
            $wpdb->update($this->table_name, array('code_content' => $code_content), array('id' => $id));
            
            // Update physical file if it exists
            if ($create_file) {
                $code_data = $wpdb->get_row($wpdb->prepare("SELECT title, code_type FROM {$this->table_name} WHERE id = %d", $id));
                if ($code_data) {
                    $this->create_physical_file($id, $code_data->title, $code_data->code_type, $code_content);
                }
            }
            
            do_action('framify_code_changed', $id);
            wp_send_json_success(array('message' => 'Code updated successfully', 'id' => $id));
            return;
        }
        
        $data = array(
            'title' => $title,
            'code_type' => $code_type,
            'code_content' => $code_content,
            'linking_type' => $linking_type,
            'where_on_page' => $where_on_page,
            'where_in_site' => $where_in_site,
            'minify_code' => $minify_code,
            'priority' => $priority,
            'url_rules' => $url_rules,
            'is_active' => $is_active,
            'always_run' => $always_run,
            'author_id' => get_current_user_id()
        );
        
        if ($id > 0) {
            // Save revision before updating
            $old_code = $wpdb->get_row($wpdb->prepare("SELECT code_content FROM {$this->table_name} WHERE id = %d", $id));
            if ($old_code) {
                $wpdb->insert($this->revisions_table, array(
                    'code_id' => $id,
                    'code_content' => $old_code->code_content
                ));
            }
            
            $wpdb->update($this->table_name, $data, array('id' => $id));
            
            // Create/update physical file
            $file_result = array('file_created' => false);
            if ($create_file) {
                $file_result = $this->create_physical_file($id, $title, $code_type, $code_content);
            }
            
            do_action('framify_code_changed', $id);

            wp_send_json_success(array(
                'message' => 'Code updated successfully',
                'id' => $id,
                'file_created' => $file_result['file_created'],
                'file_path' => isset($file_result['file_path']) ? $file_result['file_path'] : ''
            ));
        } else {
            $wpdb->insert($this->table_name, $data);
            $new_id = $wpdb->insert_id;
            do_action('framify_code_changed', $new_id);
            
            // Save initial revision
            $wpdb->insert($this->revisions_table, array(
                'code_id' => $new_id,
                'code_content' => $code_content
            ));
            
            // Create physical file
            $file_result = array('file_created' => false);
            if ($create_file) {
                $file_result = $this->create_physical_file($new_id, $title, $code_type, $code_content);
            }
            
            wp_send_json_success(array(
                'message' => 'Code created successfully',
                'id' => $new_id,
                'file_created' => $file_result['file_created'],
                'file_path' => isset($file_result['file_path']) ? $file_result['file_path'] : ''
            ));
        }
    }
    
    /**
     * Create physical CSS/JS/PHP file
     */
    private function create_physical_file($id, $title, $code_type, $content) {
        $upload_dir = wp_upload_dir();
        $framify_dir = $this->ensure_upload_dir();

        // Sanitize filename
        $filename = sanitize_file_name(str_replace(' ', '-', strtolower($title)));
        $filename = preg_replace('/[^a-z0-9\-_]/', '', $filename);
        $filename = $id . '-' . $filename;
        
        // Determine file extension
        $extension = '';
        switch ($code_type) {
            case 'css':
                $extension = 'css';
                break;
            case 'js':
            case 'jquery':
                $extension = 'js';
                break;
            case 'php':
                $extension = 'php';
                // Ensure PHP content has proper opening tag
                if (strpos(trim($content), '<?php') !== 0) {
                    $content = "<?php\n" . $content;
                }
                break;
            case 'html':
                $extension = 'html';
                break;
            default:
                $extension = 'txt';
        }
        
        $file_path = $framify_dir . '/' . $filename . '.' . $extension;
        
        // Write file
        $result = file_put_contents($file_path, $content);
        
        if ($result !== false) {
            return array(
                'file_created' => true,
                'file_path' => str_replace($upload_dir['basedir'], $upload_dir['baseurl'], $file_path),
                'file_name' => $filename . '.' . $extension
            );
        }
        
        return array('file_created' => false);
    }
    
    // AJAX: Get all codes
    public function ajax_get_codes() {
        check_ajax_referer('framify_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        $codes = $wpdb->get_results("SELECT * FROM {$this->table_name} ORDER BY updated_at DESC");
        wp_send_json_success($codes);
    }
    
    // AJAX: Get single code
    public function ajax_get_code() {
        check_ajax_referer('framify_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        $id = intval($_POST['id']);
        $code = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$this->table_name} WHERE id = %d", $id));
        
        if ($code) {
            wp_send_json_success($code);
        } else {
            wp_send_json_error('Code not found');
        }
    }
    
    // AJAX: Delete code
    public function ajax_delete_code() {
        check_ajax_referer('framify_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        $id = intval($_POST['id']);
        
        // Get code info before deleting
        $code = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$this->table_name} WHERE id = %d", $id));
        
        // Delete physical file if exists
        if ($code) {
            $upload_dir = wp_upload_dir();
            $framify_dir = $upload_dir['basedir'] . '/framify-files';
            $filename = sanitize_file_name(str_replace(' ', '-', strtolower($code->title)));
            $filename = preg_replace('/[^a-z0-9\-_]/', '', $filename);
            $filename = $id . '-' . $filename;
            
            $extensions = array('css', 'js', 'php', 'txt');
            foreach ($extensions as $ext) {
                $file_path = $framify_dir . '/' . $filename . '.' . $ext;
                if (file_exists($file_path)) {
                    unlink($file_path);
                }
            }
        }
        
        // Delete revisions first
        $wpdb->delete($this->revisions_table, array('code_id' => $id));
        
        // Delete code
        $deleted = $wpdb->delete($this->table_name, array('id' => $id));
        
        if ($deleted) {
            do_action('framify_code_changed', $id);
            wp_send_json_success('Code deleted successfully');
        } else {
            wp_send_json_error('Failed to delete code');
        }
    }
    
    // AJAX: Toggle active status
    public function ajax_toggle_active() {
        check_ajax_referer('framify_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        $id = intval($_POST['id']);
        $is_active = intval($_POST['is_active']);
        
        $wpdb->update($this->table_name, array('is_active' => $is_active), array('id' => $id));
        do_action('framify_code_changed', $id);
        wp_send_json_success('Status updated');
    }
    
    // AJAX: Get revisions
    public function ajax_get_revisions() {
        check_ajax_referer('framify_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        $code_id = intval($_POST['code_id']);
        $revisions = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$this->revisions_table} WHERE code_id = %d ORDER BY created_at DESC",
            $code_id
        ));
        
        wp_send_json_success($revisions);
    }
    
    // AJAX: Restore revision
    public function ajax_restore_revision() {
        check_ajax_referer('framify_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        $revision_id = intval($_POST['revision_id']);
        $revision = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$this->revisions_table} WHERE id = %d", $revision_id));
        
        if ($revision) {
            $wpdb->update($this->table_name, 
                array('code_content' => $revision->code_content),
                array('id' => $revision->code_id)
            );
            do_action('framify_code_changed', $revision->code_id);
            wp_send_json_success('Revision restored successfully');
        } else {
            wp_send_json_error('Revision not found');
        }
    }
    
    // AJAX: Delete revision
    public function ajax_delete_revision() {
        check_ajax_referer('framify_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        $revision_id = intval($_POST['revision_id']);
        $wpdb->delete($this->revisions_table, array('id' => $revision_id));
        wp_send_json_success('Revision deleted');
    }
    
    // AJAX: Save the interface theme on the current user's account
    public function ajax_save_ui_theme() {
        check_ajax_referer('framify_nonce', 'nonce');

        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }

        $theme = isset($_POST['theme']) ? sanitize_key($_POST['theme']) : '';

        if (!array_key_exists($theme, framify_ui_themes())) {
            wp_send_json_error('Unknown theme');
        }

        update_user_meta(get_current_user_id(), FRAMIFY_THEME_META_KEY, $theme);
        wp_send_json_success(array('theme' => $theme));
    }

    // AJAX: Bulk actions
    public function ajax_bulk_action() {
        check_ajax_referer('framify_nonce', 'nonce');
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        
        global $wpdb;
        $action = sanitize_text_field($_POST['bulk_action']);
        $ids = array_map('intval', $_POST['ids']);
        
        if (empty($ids)) {
            wp_send_json_error('No items selected');
        }
        
        $ids_string = implode(',', $ids);
        
        switch ($action) {
            case 'delete':
                $wpdb->query("DELETE FROM {$this->table_name} WHERE id IN ($ids_string)");
                $wpdb->query("DELETE FROM {$this->revisions_table} WHERE code_id IN ($ids_string)");
                do_action('framify_code_changed', 0);
                wp_send_json_success('Items deleted');
                break;
            case 'activate':
                $wpdb->query("UPDATE {$this->table_name} SET is_active = 1 WHERE id IN ($ids_string)");
                do_action('framify_code_changed', 0);
                wp_send_json_success('Items activated');
                break;
            case 'deactivate':
                $wpdb->query("UPDATE {$this->table_name} SET is_active = 0 WHERE id IN ($ids_string)");
                do_action('framify_code_changed', 0);
                wp_send_json_success('Items deactivated');
                break;
        }
    }
    
    // Output code functions
    public function output_head_code() {
        $this->output_code('header', 'frontend');
    }
    
    public function output_body_code() {
        $this->output_code('body', 'frontend');
    }
    
    public function output_footer_code() {
        $this->output_code('footer', 'frontend');
    }
    
    public function output_admin_head_code() {
        $this->output_code('header', 'admin');
    }
    
    public function output_admin_footer_code() {
        $this->output_code('footer', 'admin');
    }
    
    public function output_login_code() {
        $this->output_code('header', 'login');
    }
    
    private function output_code($position, $location) {
        global $wpdb;
        
        $codes = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$this->table_name} 
            WHERE is_active = 1 
            AND where_on_page = %s 
            AND (where_in_site = %s OR where_in_site LIKE %s)
            ORDER BY priority ASC, id ASC",
            $position,
            $location,
            '%' . $location . '%'
        ));
        
        foreach ($codes as $code) {
            if ($this->should_display_code($code)) {
                // Marks the tag so caching plugins skip minify/combine/defer/delay.
                $attrs = function_exists('framify_cache_exclusion_attrs')
                    ? framify_cache_exclusion_attrs($code->code_type === 'css' ? 'css' : 'js', $code->id)
                    : '';

                if ($code->code_type === 'css') {
                    echo "\n<!-- Framify CSS: {$code->title} -->\n<style type=\"text/css\"{$attrs}>\n";
                    echo $code->minify_code ? $this->minify_css($code->code_content) : $code->code_content;
                    echo "\n</style>\n";
                } elseif ($code->code_type === 'js' || $code->code_type === 'jquery') {
                    echo "\n<!-- Framify JS: {$code->title} -->\n<script type=\"text/javascript\"{$attrs}>\n";
                    echo $code->minify_code ? $this->minify_js($code->code_content) : $code->code_content;
                    echo "\n</script>\n";
                } elseif ($code->code_type === 'html') {
                    // Delimited with comments rather than wrapped in an element:
                    // the live editor needs to find this block to hide it while
                    // you edit, and comments leave the rendered DOM untouched,
                    // so existing snippets keep their structure and selectors.
                    echo "\n<!-- Framify HTML: {$code->title} -->\n";
                    echo "<!--framify-html-{$code->id}-->";
                    echo $code->code_content;
                    echo "<!--/framify-html-{$code->id}-->\n";
                }
            }
        }
    }
    
    public function execute_php_snippets() {
        global $wpdb;
        
        // Same priority ordering the head/body/footer output uses, so a PHP
        // snippet set to run first actually does.
        $codes = $wpdb->get_results("SELECT * FROM {$this->table_name} WHERE is_active = 1 AND code_type = 'php' ORDER BY priority ASC, id ASC");
        
        foreach ($codes as $code) {
            if ($this->should_display_code($code)) {
                try {
                    eval('?>' . $code->code_content);
                } catch (Exception $e) {
                    if (current_user_can('manage_options')) {
                        error_log('Framify PHP Error: ' . $e->getMessage());
                    }
                }
            }
        }
    }
    
    /**
     * Marks the current request uncacheable when a PHP snippet flagged
     * `always_run` applies to this URL.
     *
     * PHP never executes on a full-page cache hit, so a snippet doing
     * per-request work (redirects, cookies, per-visitor output) would silently
     * do nothing. Flagging it trades caching on those URLs for correctness.
     *
     * The "any flagged snippets at all" answer is cached, so the usual case
     * costs one autoloaded option read rather than a query per pageview.
     */
    public function maybe_force_nocache() {
        if (is_admin() || !function_exists('framify_force_nocache')) {
            return;
        }

        $codes = $this->get_always_run_codes();

        if (empty($codes)) {
            return;
        }

        foreach ($codes as $code) {
            if ($this->should_display_code($code)) {
                framify_force_nocache();
                return;
            }
        }
    }

    /**
     * Forgets the cached "are there any always_run snippets" answer, so the
     * next front-end request re-checks.
     */
    public function flush_always_run_cache() {
        delete_option('framify_has_always_run');
    }

    /**
     * Active PHP snippets flagged `always_run`, or an empty array when none
     * exist. The empty case is remembered so the common path skips the query.
     */
    private function get_always_run_codes() {
        $cached = get_option('framify_has_always_run', null);

        if ($cached === '0') {
            return array();
        }

        global $wpdb;

        $codes = $wpdb->get_results(
            "SELECT * FROM {$this->table_name}
            WHERE is_active = 1 AND always_run = 1 AND code_type = 'php'"
        );

        if (empty($codes)) {
            update_option('framify_has_always_run', '0');
            return array();
        }

        update_option('framify_has_always_run', '1');

        return $codes;
    }

    private function should_display_code($code) {
        if (empty($code->url_rules)) {
            return true;
        }
        
        $rules = json_decode($code->url_rules, true);
        if (!is_array($rules) || empty($rules)) {
            return true;
        }
        
        $current_url = home_url($_SERVER['REQUEST_URI']);
        
        foreach ($rules as $rule) {
            $type = $rule['type'];
            $value = isset($rule['value']) ? $rule['value'] : '';
            
            switch ($type) {
                case 'all':
                    return true;
                case 'first-page':
                    if (is_front_page()) return true;
                    break;
                case 'contains':
                    if (strpos($current_url, $value) !== false) return true;
                    break;
                case 'not-contains':
                    if (strpos($current_url, $value) === false) return true;
                    break;
                case 'equal-to':
                    if ($current_url === $value) return true;
                    break;
                case 'not-equal-to':
                    if ($current_url !== $value) return true;
                    break;
                case 'begins-with':
                    if (strpos($current_url, $value) === 0) return true;
                    break;
                case 'ends-by':
                    if (substr($current_url, -strlen($value)) === $value) return true;
                    break;
            }
        }
        
        return false;
    }
    
    private function minify_css($css) {
        $css = preg_replace('!/\*[^*]*\*+([^/][^*]*\*+)*/!', '', $css);
        $css = str_replace(array("\r\n", "\r", "\n", "\t", '  ', '    ', '    '), '', $css);
        return $css;
    }
    
    private function minify_js($js) {
        // Remove block comments /* */
        $js = preg_replace('!/\*.*?\*/!s', '', $js);
        
        // Remove line comments // but keep the newline to prevent breaking code
        $js = preg_replace('!//.*?(\r?\n)!', '$1', $js);
        
        // Replace multiple spaces/tabs with single space, but preserve newlines
        $js = preg_replace('/[ \t]+/', ' ', $js);
        
        // Remove extra blank lines (more than one consecutive newline)
        $js = preg_replace('/(\r?\n){2,}/', "\n", $js);
        
        // Trim whitespace from start and end of each line
        $lines = explode("\n", $js);
        $lines = array_map('trim', $lines);
        $js = implode("\n", $lines);
        
        return $js;
    }
}

new Framify();

// Load GitHub release updater
if ( file_exists( FRAMIFY_PLUGIN_DIR . 'framify-updater.php' ) ) {
    require_once FRAMIFY_PLUGIN_DIR . 'framify-updater.php';
}

// Load cache-compatibility module
if ( file_exists( FRAMIFY_PLUGIN_DIR . 'framify-cache.php' ) ) {
    require_once FRAMIFY_PLUGIN_DIR . 'framify-cache.php';
}

// Load SEO module
if ( file_exists( FRAMIFY_PLUGIN_DIR . 'framify-seo.php' ) ) {
    require_once FRAMIFY_PLUGIN_DIR . 'framify-seo.php';
}

// Load shortcodes ([framify_code] / [framify_seo])
if ( file_exists( FRAMIFY_PLUGIN_DIR . 'framify-shortcodes.php' ) ) {
    require_once FRAMIFY_PLUGIN_DIR . 'framify-shortcodes.php';
}

// Load Elementor module: "Framify" panel tab (inert unless Elementor is active)
if ( file_exists( FRAMIFY_PLUGIN_DIR . 'framify-elementor.php' ) ) {
    require_once FRAMIFY_PLUGIN_DIR . 'framify-elementor.php';
}

// Load Elementor Floating Shapes: a section in the Framify tab above
// (inert unless Elementor is active)
if ( file_exists( FRAMIFY_PLUGIN_DIR . 'framify-elementor-shapes.php' ) ) {
    require_once FRAMIFY_PLUGIN_DIR . 'framify-elementor-shapes.php';
}

// Load Elementor Floating Text: a section after Floating Shapes, reusing
// its shared helpers (inert unless Elementor is active)
if ( file_exists( FRAMIFY_PLUGIN_DIR . 'framify-elementor-text.php' ) ) {
    require_once FRAMIFY_PLUGIN_DIR . 'framify-elementor-text.php';
}

// Load Elementor Shape Divider: a section after Float on top-level
// Containers, reusing the Organic Shape parser (inert unless Elementor is
// active)
if ( file_exists( FRAMIFY_PLUGIN_DIR . 'framify-elementor-divider.php' ) ) {
    require_once FRAMIFY_PLUGIN_DIR . 'framify-elementor-divider.php';
}
