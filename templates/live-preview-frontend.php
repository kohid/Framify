<?php
/**
 * Framify - Live Preview Frontend Page
 * Unique generated page outside WordPress admin
 */
if (!defined('ABSPATH')) exit;

// Get codes from parent scope
global $wpdb;
$table_name = $wpdb->prefix . 'framify_codes';
$codes = $wpdb->get_results("SELECT id, title, code_type, is_active FROM {$table_name} ORDER BY title ASC");

// Get the preview URL from query parameter or default to home
$preview_url = isset($_GET['preview_url']) ? esc_url_raw(urldecode($_GET['preview_url'])) : home_url('/');

// Interface theme saved on this user's account. Rendered onto <html> below so
// the editor paints in the right theme on first frame, with no flash.
$framify_themes  = framify_ui_themes();
$framify_theme   = framify_get_user_theme();
$framify_cm_map  = wp_list_pluck($framify_themes, 'cm');
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?> data-framify-theme="<?php echo esc_attr($framify_theme); ?>">
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Framify Live Preview - <?php bloginfo('name'); ?></title>

    <!-- CodeMirror Core -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.css">

    <!-- One CodeMirror syntax theme per interface theme, preloaded so switching is instant -->
    <?php foreach (array_unique($framify_cm_map) as $cm_theme): ?>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/<?php echo esc_attr($cm_theme); ?>.min.css">
    <?php endforeach; ?>

    <!-- Framify Styles: theme tokens first, then the editor chrome that consumes them -->
    <link rel="stylesheet" href="<?php echo FRAMIFY_PLUGIN_URL; ?>assets/framify-themes.css?v=<?php echo FRAMIFY_VERSION; ?>">
    <link rel="stylesheet" href="<?php echo FRAMIFY_PLUGIN_URL; ?>assets/live-preview-styles.css?v=<?php echo FRAMIFY_VERSION; ?>">

    <?php framify_print_frame_guard(); ?>
</head>
<body>    
    <div id="framify-live-wrapper">
        <div id="framify-preview-container">
            <iframe id="framify-preview-frame" src="<?php echo esc_url($preview_url); ?>"></iframe>
        </div>
        
        <div id="framify-floating-editor" class="dock-float">
            <!-- Resize Handles (8 corners/edges for float mode) -->
            <div class="resize-handle resize-handle-n"></div>
            <div class="resize-handle resize-handle-s"></div>
            <div class="resize-handle resize-handle-e"></div>
            <div class="resize-handle resize-handle-w"></div>
            <div class="resize-handle resize-handle-ne"></div>
            <div class="resize-handle resize-handle-nw"></div>
            <div class="resize-handle resize-handle-se"></div>
            <div class="resize-handle resize-handle-sw"></div>
            
            <!-- Dock-specific resize handle (single edge) -->
            <div class="dock-resize-handle"></div>
            
            <div class="editor-header">
                <h3>Framify Code Editor</h3>
                <div class="editor-controls">
                    <button type="button" class="dock-position-btn" data-position="float" title="Float" aria-label="Float the editor">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4.5" width="9.5" height="8" rx="1.5"/><path d="M10 4.5V3.2a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1V9a1 1 0 0 0 1 1h1.3"/></svg>
                    </button>
                    <button type="button" class="dock-position-btn" data-position="left" title="Dock left" aria-label="Dock the editor to the left">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6.5 3v10"/></svg>
                    </button>
                    <button type="button" class="dock-position-btn" data-position="right" title="Dock right" aria-label="Dock the editor to the right">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M9.5 3v10"/></svg>
                    </button>
                    <button type="button" class="dock-position-btn" data-position="bottom" title="Dock bottom" aria-label="Dock the editor to the bottom">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 9.5h12"/></svg>
                    </button>
                    <button type="button" class="toggle-collapse" title="Collapse" aria-label="Collapse the editor">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8"/></svg>
                    </button>
                </div>
            </div>
            
            <div class="editor-body">
                <div class="editor-tabs">
                    <button type="button" class="editor-tab active" data-tab="css">CSS</button>
                    <button type="button" class="editor-tab" data-tab="jquery">jQuery</button>
                    <button type="button" class="editor-tab" data-tab="php">PHP</button>
                    <button type="button" class="editor-tab" data-tab="html">HTML</button>
                </div>
                
                <div class="editor-content">
                    <div class="editor-pane active" id="pane-css">
                        <div class="pane-selector">
                            <select id="load-saved-css-code">
                                <option value="">Load Saved Code...</option>
                                <?php if (!empty($codes)): ?>
                                    <?php foreach ($codes as $code): ?>
                                        <?php if ($code->code_type === 'css'): ?>
                                        <option value="<?php echo $code->id; ?>" data-active="<?php echo isset($code->is_active) ? intval($code->is_active) : 1; ?>">
                                            <?php echo esc_html($code->title) . (isset($code->is_active) && !$code->is_active ? ' (inactive)' : ''); ?>
                                        </option>
                                        <?php endif; ?>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </select>
                            <button type="button" class="edit-code-btn" id="edit-css-code-btn">Edit</button>
                            <div class="search-box" id="search-box-css">
                                <div class="search-row">
                                    <input type="text" id="search-input-css" placeholder="Find (Ctrl+F)">
                                    <button type="button" class="search-prev" title="Previous (Shift+Enter)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg></button>
                                    <button type="button" class="search-next" title="Next (Enter)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
                                    <span class="search-counter" id="search-counter-css">0 of 0</span>
                                    <button type="button" class="search-close" title="Close (Esc)">&times;</button>
                                    <button type="button" class="toggle-replace" title="Toggle Replace (Ctrl+H)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
                                </div>
                                <div class="replace-row" style="display: none;">
                                    <input type="text" id="replace-input-css" placeholder="Replace">
                                    <button type="button" class="replace-one" title="Replace (Ctrl+Shift+1)">Replace</button>
                                    <button type="button" class="replace-all" title="Replace All (Ctrl+Shift+Enter)">Replace All</button>
                                </div>
                            </div>
                        </div>
                        <textarea id="live-css-editor">/* Enter your CSS code here */</textarea>
                        <button type="button" class="css-save-btn" id="css_save_button">Save</button>
                    </div>
                    
                    <div class="editor-pane" id="pane-jquery">
                        <div class="pane-selector">
                            <select id="load-saved-jquery-code">
                                <option value="">Load Saved Code...</option>
                                <?php if (!empty($codes)): ?>
                                    <?php foreach ($codes as $code): ?>
                                        <?php if ($code->code_type === 'jquery' || $code->code_type === 'js'): ?>
                                        <option value="<?php echo $code->id; ?>" data-active="<?php echo isset($code->is_active) ? intval($code->is_active) : 1; ?>">
                                            <?php echo esc_html($code->title) . (isset($code->is_active) && !$code->is_active ? ' (inactive)' : ''); ?>
                                        </option>
                                        <?php endif; ?>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </select>
                            <button type="button" class="edit-code-btn" id="edit-jquery-code-btn">Edit</button>
                            <div class="search-box" id="search-box-jquery">
                                <div class="search-row">
                                    <input type="text" id="search-input-jquery" placeholder="Find (Ctrl+F)">
                                    <button type="button" class="search-prev" title="Previous (Shift+Enter)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg></button>
                                    <button type="button" class="search-next" title="Next (Enter)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
                                    <span class="search-counter" id="search-counter-jquery">0 of 0</span>
                                    <button type="button" class="search-close" title="Close (Esc)">&times;</button>
                                    <button type="button" class="toggle-replace" title="Toggle Replace (Ctrl+H)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
                                </div>
                                <div class="replace-row" style="display: none;">
                                    <input type="text" id="replace-input-jquery" placeholder="Replace">
                                    <button type="button" class="replace-one" title="Replace (Ctrl+Shift+1)">Replace</button>
                                    <button type="button" class="replace-all" title="Replace All (Ctrl+Shift+Enter)">Replace All</button>
                                </div>
                            </div>
                        </div>
                        <textarea id="live-jquery-editor">// Enter your jQuery code here</textarea>
                        <button type="button" class="jquery-save-btn" id="jquery_save_button">Save</button>
                    </div>
                    
                    <div class="editor-pane" id="pane-php">
                        <div class="pane-selector">
                            <select id="load-saved-php-code">
                                <option value="">Load Saved Code...</option>
                                <?php if (!empty($codes)): ?>
                                    <?php foreach ($codes as $code): ?>
                                        <?php if ($code->code_type === 'php'): ?>
                                        <option value="<?php echo $code->id; ?>" data-active="<?php echo isset($code->is_active) ? intval($code->is_active) : 1; ?>">
                                            <?php echo esc_html($code->title) . (isset($code->is_active) && !$code->is_active ? ' (inactive)' : ''); ?>
                                        </option>
                                        <?php endif; ?>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </select>
                            <button type="button" class="edit-code-btn" id="edit-php-code-btn">Edit</button>
                            <div class="search-box" id="search-box-php">
                                <div class="search-row">
                                    <input type="text" id="search-input-php" placeholder="Find (Ctrl+F)">
                                    <button type="button" class="search-prev" title="Previous (Shift+Enter)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg></button>
                                    <button type="button" class="search-next" title="Next (Enter)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
                                    <span class="search-counter" id="search-counter-php">0 of 0</span>
                                    <button type="button" class="search-close" title="Close (Esc)">&times;</button>
                                    <button type="button" class="toggle-replace" title="Toggle Replace (Ctrl+H)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
                                </div>
                                <div class="replace-row" style="display: none;">
                                    <input type="text" id="replace-input-php" placeholder="Replace">
                                    <button type="button" class="replace-one" title="Replace (Ctrl+Shift+1)">Replace</button>
                                    <button type="button" class="replace-all" title="Replace All (Ctrl+Shift+Enter)">Replace All</button>
                                </div>
                            </div>
                        </div>
                        <textarea id="live-php-editor"><?php echo htmlspecialchars('<?php
// Enter your PHP code here
// Note: PHP changes require saving and page refresh to take effect
?>'); ?></textarea>
                        <button type="button" class="php-save-btn" id="php_save_button">Save</button>
                    </div>
                    
                    <div class="editor-pane" id="pane-html">
                        <div class="pane-selector">
                            <select id="load-saved-html-code">
                                <option value="">Load Saved Code...</option>
                                <?php if (!empty($codes)): ?>
                                    <?php foreach ($codes as $code): ?>
                                        <?php if ($code->code_type === 'html'): ?>
                                        <option value="<?php echo $code->id; ?>" data-active="<?php echo isset($code->is_active) ? intval($code->is_active) : 1; ?>">
                                            <?php echo esc_html($code->title) . (isset($code->is_active) && !$code->is_active ? ' (inactive)' : ''); ?>
                                        </option>
                                        <?php endif; ?>
                                    <?php endforeach; ?>
                                <?php endif; ?>
                            </select>
                            <button type="button" class="edit-code-btn" id="edit-html-code-btn">Edit</button>
                            <div class="search-box" id="search-box-html">
                                <div class="search-row">
                                    <input type="text" id="search-input-html" placeholder="Find (Ctrl+F)">
                                    <button type="button" class="search-prev" title="Previous (Shift+Enter)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg></button>
                                    <button type="button" class="search-next" title="Next (Enter)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
                                    <span class="search-counter" id="search-counter-html">0 of 0</span>
                                    <button type="button" class="search-close" title="Close (Esc)">&times;</button>
                                    <button type="button" class="toggle-replace" title="Toggle Replace (Ctrl+H)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
                                </div>
                                <div class="replace-row" style="display: none;">
                                    <input type="text" id="replace-input-html" placeholder="Replace">
                                    <button type="button" class="replace-one" title="Replace (Ctrl+Shift+1)">Replace</button>
                                    <button type="button" class="replace-all" title="Replace All (Ctrl+Shift+Enter)">Replace All</button>
                                </div>
                            </div>
                        </div>
                        <textarea id="live-html-editor"><!-- Enter your HTML code here --></textarea>
                        <button type="button" class="html-save-btn" id="html_save_button">Save</button>
                    </div>
                </div>
            </div>
            
            <div class="editor-footer">
                <button type="button" class="settings-btn" id="open-settings-modal" title="Appearance" aria-label="Change the editor theme">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" stroke="none"/></svg>
                </button>
                <div class="viewport-selector">
                    <label>Viewport:</label>
                    <select id="viewport-width">
                        <option value="100%">Full Width</option>
                        <option value="1024">1024px</option>
                        <option value="820">820px</option>
                        <option value="768">768px</option>
                        <option value="480">480px</option>
                        <option value="430">430px</option>
                        <option value="393">393px</option>
                        <option value="375">375px</option>
                    </select>
                </div>
                <button type="button" class="add-code-floating" id="open-add-modal" title="Add Custom Code">+</button>
            </div>
        </div>
    </div>
    
    <!-- Add Custom Code Modal -->
    <div id="framify-add-modal" aria-hidden="true">
        <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="framify-code-modal-title">
            <div class="modal-header">
                <h2 id="framify-code-modal-title">Add Custom Code</h2>
                <button type="button" class="modal-close" id="close-add-modal" aria-label="Close">&times;</button>
            </div>

            <div class="code-type-selector">
                <div class="code-type-btn active" data-type="css">CSS</div>
                <div class="code-type-btn" data-type="jquery">jQuery</div>
                <div class="code-type-btn" data-type="php">PHP</div>
                <div class="code-type-btn" data-type="html">HTML</div>
            </div>

            <div class="modal-body">
                <input type="hidden" id="modal-code-id" value="">
                
                <div class="modal-field">
                    <label>Title *</label>
                    <input type="text" id="modal-code-title" placeholder="Enter code title..." required>
                </div>
                
                <div class="modal-accordion active">
                    <div class="accordion-header">
                        <h3>Code Options</h3>
                        <span class="accordion-toggle"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></span>
                    </div>
                    <div class="accordion-body">

                        <div class="framify-option-wrapper">
                            <div class="framify-option">
                                <label>
                                    <input type="checkbox" id="modal-is-active" checked>
                                    <strong>Active</strong>
                                </label>
                                <p class="description">Enable or disable this code</p>
                            </div>

                            <div class="framify-option">
                                <label>
                                    <strong>Priority:</strong>
                                    <input type="number" id="modal-priority" value="5" min="1" max="999">
                                </label>
                                <p class="description">Lower numbers = higher priority</p>
                            </div>
                        </div>

                        <div class="framify-option-wrapper" id="modal-always-run-row">
                            <div class="framify-option">
                                <label>
                                    <input type="checkbox" id="modal-always-run">
                                    <strong>Always run</strong>
                                </label>
                                <p class="description">Skips the page cache on URLs this snippet matches, so it runs on every visit. Only needed for PHP that redirects, sets cookies, or changes per visitor &mdash; it makes those pages slower.</p>
                            </div>
                        </div>

                        <div class="framify-option-wrapper">
                            <div class="framify-option">
                                <label><strong>Linking Type:</strong></label>
                                <select id="modal-linking-type">
                                    <option value="internal" selected>Internal</option>
                                    <option value="external">External File</option>
                                </select>
                            </div>

                            <div class="framify-option">
                                <label>
                                    <input type="checkbox" id="modal-minify">
                                    <strong>Minify the code</strong>
                                </label>
                            </div>
                        </div>
                        
                        <div class="framify-option-wrapper">                        
                            <div class="framify-option">
                                <label><strong>Where on page:</strong></label>
                                <select id="modal-where-page">
                                    <option value="header" selected>In the &lt;head&gt; element</option>
                                    <option value="body">After &lt;body&gt; start</option>
                                    <option value="footer">In the &lt;footer&gt; element</option>
                                </select>
                            </div>
                            
                            <div class="framify-option">
                                <label><strong>Where in site:</strong></label>
                                <select id="modal-where-site">
                                    <option value="frontend" selected>In Frontend</option>
                                    <option value="admin">In Admin</option>
                                    <option value="login">On Login Page</option>
                                    <option value="frontend,admin">Frontend &amp; Admin</option>
                                </select>
                            </div>
                        </div>
                        
                        


                        <div class="framify-option">
                            <label><strong>Apply only on these Pages</strong></label>
                            <input type="hidden" id="modal-url-rules" value='[{"value":"","type":"all","index":1}]'>
                            <div id="modal-url-rules-list">
                                <div class="url-rule-item">
                                    <span class="rule-type">All Website</span>
                                    <span class="rule-value"></span>
                                    <a href="#" class="rule-remove" data-index="0">&times;</a>
                                </div>
                            </div>
                            <div class="framify-url-rule-new">
                                <select id="modal-new-rule-type">
                                    <option value="all">All Website</option>
                                    <option value="first-page">Homepage</option>
                                    <option value="contains">URL contains ..</option>
                                    <option value="not-contains">URL not contains ..</option>
                                    <option value="equal-to">URL is equal to ..</option>
                                    <option value="not-equal-to">URL not equal to ..</option>
                                    <option value="begins-with">URL starts with ..</option>
                                    <option value="ends-by">URL ends by ..</option>
                                </select>
                                <input type="text" id="modal-new-rule-value" placeholder="Enter URL pattern" style="display: none;">
                                <button type="button" id="modal-add-url-rule">Add Rule</button>
                            </div>
                        </div>


                    </div>
                </div>
                
                
            </div>
            
            <div class="modal-footer">
                <button type="button" class="btn-delete" id="modal-delete" style="display: none; margin-right: auto;">Delete Code</button>
                <button type="button" class="btn-cancel" id="modal-cancel">Cancel</button>
                <button type="button" class="btn-save" id="modal-save">Save Code</button>
            </div>
        </div>
    </div>
    
    <!-- Appearance: pick an interface theme -->
    <div id="framify-settings-modal" aria-hidden="true">
        <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="framify-theme-title">
            <div class="modal-header">
                <h2 id="framify-theme-title">Appearance</h2>
                <button type="button" class="modal-close" id="close-settings-modal" aria-label="Close">&times;</button>
            </div>

            <div class="modal-body">
                <span class="fr-eyebrow">Theme</span>
                <p class="fr-theme-intro">Each theme sets the editor chrome and the syntax colours together. Pick one to see it applied right away.</p>

                <div class="fr-theme-grid" role="radiogroup" aria-labelledby="framify-theme-title" id="framify-theme-grid">
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
            </div>

            <div class="modal-footer">
                <span class="fr-theme-status" id="framify-theme-status" role="status">Saved to your account</span>
                <button type="button" class="btn-cancel" id="settings-done">Done</button>
            </div>
        </div>
    </div>

    
    <!-- jQuery -->
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    
    <!-- CodeMirror Core -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/css/css.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/xml/xml.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/htmlmixed/htmlmixed.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/clike/clike.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/php/php.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/closebrackets.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchbrackets.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/css-hint.min.js"></script>
    
    <!-- Localized Data -->
    <script>
        var framifyLiveData = {
            ajax_url: '<?php echo admin_url('admin-ajax.php'); ?>',
            nonce: '<?php echo wp_create_nonce('framify_nonce'); ?>',
            home_url: '<?php echo home_url('/'); ?>',
            admin_url: '<?php echo admin_url(); ?>',
            show_admin_bar: <?php echo get_option('framify_show_admin_bar', 1) ? 'true' : 'false'; ?>,
            theme: '<?php echo esc_js($framify_theme); ?>',
            cm_themes: <?php echo wp_json_encode($framify_cm_map); ?>
        };
        console.log('Framify data loaded:', framifyLiveData);
    </script>
    
    <!-- Framify Live Preview Script -->
    <script src="<?php echo FRAMIFY_PLUGIN_URL; ?>assets/live-preview-script.js?v=<?php echo FRAMIFY_VERSION; ?>"></script>
    <script>
        // Verify script loaded
        console.log('Checking FramifyLive object...', typeof FramifyLive);
        if (typeof FramifyLive === 'undefined') {
            console.error('FramifyLive not loaded! Check file path:', '<?php echo FRAMIFY_PLUGIN_URL; ?>assets/live-preview-script.js');
        } else {
            console.log('FramifyLive loaded successfully!');
        }
    </script>
</body>
</html>
