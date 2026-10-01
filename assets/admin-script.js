/**
 * Framify Admin JavaScript
 */

(function($) {
    'use strict';

    let codeEditor;
    let urlRulesData = [];

    const Framify = {
        init: function() {
            const currentPage = framifyData.current_page;
            
            if (currentPage === 'framify') {
                this.initAllCodesPage();
            } else if (currentPage === 'framify-add') {
                this.initAddCodePage();
            }
        },

        // ALL CODES PAGE
        initAllCodesPage: function() {
            this.bindAllCodesEvents();
        },

        bindAllCodesEvents: function() {
            // Select all checkboxes
            $('#cb-select-all, #cb-select-all-2').on('change', function() {
                $('.framify-checkbox').prop('checked', $(this).prop('checked'));
            });

            // Toggle active status
            $(document).on('click', '.framify-toggle-active', function(e) {
                e.preventDefault();
                const id = $(this).data('id');
                const currentActive = $(this).data('active');
                const newActive = currentActive == 1 ? 0 : 1;
                
                Framify.toggleActive(id, newActive);
            });

            // Delete code
            $(document).on('click', '.framify-delete', function(e) {
                e.preventDefault();
                if (!confirm('Are you sure you want to delete this code?')) return;
                
                const id = $(this).data('id');
                Framify.deleteCode(id);
            });

            // Bulk actions
            $('#framify-bulk-apply').on('click', function() {
                const action = $('#bulk-action-selector').val();
                if (action === '-1') {
                    alert('Please select an action');
                    return;
                }

                const selectedIds = [];
                $('.framify-checkbox:checked').each(function() {
                    selectedIds.push($(this).val());
                });

                if (selectedIds.length === 0) {
                    alert('Please select at least one item');
                    return;
                }

                if (action === 'delete') {
                    if (!confirm('Are you sure you want to delete ' + selectedIds.length + ' item(s)?')) {
                        return;
                    }
                }

                Framify.bulkAction(action, selectedIds);
            });
        },

        toggleActive: function(id, isActive) {
            $.ajax({
                url: framifyData.ajax_url,
                type: 'POST',
                data: {
                    action: 'framify_toggle_active',
                    nonce: framifyData.nonce,
                    id: id,
                    is_active: isActive
                },
                success: function(response) {
                    if (response.success) {
                        location.reload();
                    }
                }
            });
        },

        deleteCode: function(id) {
            $.ajax({
                url: framifyData.ajax_url,
                type: 'POST',
                data: {
                    action: 'framify_delete_code',
                    nonce: framifyData.nonce,
                    id: id
                },
                success: function(response) {
                    if (response.success) {
                        location.reload();
                    }
                }
            });
        },

        bulkAction: function(action, ids) {
            $.ajax({
                url: framifyData.ajax_url,
                type: 'POST',
                data: {
                    action: 'framify_bulk_action',
                    nonce: framifyData.nonce,
                    bulk_action: action,
                    ids: ids
                },
                success: function(response) {
                    if (response.success) {
                        location.reload();
                    } else {
                        alert(response.data);
                    }
                }
            });
        },

        // ADD/EDIT CODE PAGE
        initAddCodePage: function() {
            this.initCodeEditor();
            this.initURLRules();
            this.initRevisions();
            this.bindAddCodeEvents();
        },

        initCodeEditor: function() {
            const codeType = $('#code_type').val();
            let mode = 'css';
            
            if (codeType === 'js' || codeType === 'jquery') {
                mode = 'javascript';
            } else if (codeType === 'php') {
                mode = 'application/x-httpd-php';
            }

            codeEditor = CodeMirror.fromTextArea(document.getElementById('code_editor'), {
                mode: mode,
                theme: 'monokai',
                lineNumbers: true,
                autoCloseBrackets: true,
                autoCloseTags: true,
                matchBrackets: true,
                matchTags: true,
                indentUnit: 4,
                tabSize: 4,
                lineWrapping: true,
                extraKeys: {
                    "Ctrl-Space": "autocomplete"
                }
            });
        },

        initURLRules: function() {
            const rulesJson = $('#url_rules').val();
            try {
                urlRulesData = JSON.parse(rulesJson);
            } catch(e) {
                urlRulesData = [{ value: '', type: 'all', index: 1 }];
            }
            
            this.renderURLRules();
        },

        renderURLRules: function() {
            const container = $('#url-rules-list');
            container.empty();

            urlRulesData.forEach((rule, index) => {
                const typeLabel = this.getURLRuleTypeLabel(rule.type);
                const valueDisplay = rule.value ? ': ' + rule.value : '';
                
                container.append(`
                    <div class="url-rule-item">
                        <span class="rule-type">${typeLabel}</span>
                        <span class="rule-value">${valueDisplay}</span>
                        <a href="#" class="rule-remove" data-index="${index}">✕</a>
                    </div>
                `);
            });

            // Update hidden field
            $('#url_rules').val(JSON.stringify(urlRulesData));
        },

        getURLRuleTypeLabel: function(type) {
            const labels = {
                'all': 'All Website',
                'first-page': 'Homepage',
                'contains': 'URL contains',
                'not-contains': 'URL not contains',
                'equal-to': 'URL is equal to',
                'not-equal-to': 'URL not equal to',
                'begins-with': 'URL starts with',
                'ends-by': 'URL ends by'
            };
            return labels[type] || type;
        },

        initRevisions: function() {
            const codeId = $('#code_id').val();
            if (!codeId) return;

            $.ajax({
                url: framifyData.ajax_url,
                type: 'POST',
                data: {
                    action: 'framify_get_revisions',
                    nonce: framifyData.nonce,
                    code_id: codeId
                },
                success: function(response) {
                    if (response.success) {
                        Framify.renderRevisions(response.data);
                    }
                }
            });
        },

        renderRevisions: function(revisions) {
            const container = $('#revisions-list');
            
            if (!revisions || revisions.length === 0) {
                container.html('<p>No revisions found.</p>');
                return;
            }

            container.empty();
            revisions.forEach(revision => {
                const date = new Date(revision.created_at).toLocaleString();
                container.append(`
                    <div class="revision-item">
                        <div>
                            <div class="revision-date">${date}</div>
                        </div>
                        <div class="revision-actions">
                            <a href="#" class="button button-small framify-restore-revision" data-id="${revision.id}">Restore</a>
                            <a href="#" class="button button-small framify-delete-revision" data-id="${revision.id}">Delete</a>
                        </div>
                    </div>
                `);
            });
        },

        bindAddCodeEvents: function() {
            // URL Rule type change
            $('#new-rule-type').on('change', function() {
                const type = $(this).val();
                if (type === 'all' || type === 'first-page') {
                    $('#new-rule-value').hide();
                } else {
                    $('#new-rule-value').show();
                }
            });

            // Add URL rule
            $('#add-url-rule').on('click', function() {
                const type = $('#new-rule-type').val();
                const value = $('#new-rule-value').val();
                
                if ((type !== 'all' && type !== 'first-page') && !value.trim()) {
                    alert('Please enter a URL pattern');
                    return;
                }

                // Remove "all" rule if exists and adding specific rule
                if (type !== 'all') {
                    urlRulesData = urlRulesData.filter(r => r.type !== 'all');
                } else {
                    // If adding "all", remove other rules
                    urlRulesData = [];
                }

                urlRulesData.push({
                    type: type,
                    value: value,
                    index: urlRulesData.length + 1
                });

                $('#new-rule-value').val('');
                Framify.renderURLRules();
            });

            // Remove URL rule
            $(document).on('click', '.rule-remove', function(e) {
                e.preventDefault();
                const index = $(this).data('index');
                urlRulesData.splice(index, 1);
                Framify.renderURLRules();
            });

            // Form submit
            $('#framify-code-form').on('submit', function(e) {
                e.preventDefault();
                Framify.saveCode();
            });

            // Delete code
            $('#framify-delete-code').on('click', function(e) {
                e.preventDefault();
                if (!confirm('Are you sure you want to delete this code?')) return;
                
                const id = $('#code_id').val();
                $.ajax({
                    url: framifyData.ajax_url,
                    type: 'POST',
                    data: {
                        action: 'framify_delete_code',
                        nonce: framifyData.nonce,
                        id: id
                    },
                    success: function(response) {
                        if (response.success) {
                            window.location.href = framifyData.site_url + '/wp-admin/admin.php?page=framify';
                        }
                    }
                });
            });

            // Restore revision
            $(document).on('click', '.framify-restore-revision', function(e) {
                e.preventDefault();
                if (!confirm('Restore this revision? Current code will be overwritten.')) return;
                
                const revisionId = $(this).data('id');
                $.ajax({
                    url: framifyData.ajax_url,
                    type: 'POST',
                    data: {
                        action: 'framify_restore_revision',
                        nonce: framifyData.nonce,
                        revision_id: revisionId
                    },
                    success: function(response) {
                        if (response.success) {
                            location.reload();
                        }
                    }
                });
            });

            // Delete revision
            $(document).on('click', '.framify-delete-revision', function(e) {
                e.preventDefault();
                if (!confirm('Delete this revision?')) return;
                
                const revisionId = $(this).data('id');
                $.ajax({
                    url: framifyData.ajax_url,
                    type: 'POST',
                    data: {
                        action: 'framify_delete_revision',
                        nonce: framifyData.nonce,
                        revision_id: revisionId
                    },
                    success: function(response) {
                        if (response.success) {
                            Framify.initRevisions();
                        }
                    }
                });
            });
        },

        saveCode: function() {
            const data = {
                action: 'framify_save_code',
                nonce: framifyData.nonce,
                id: $('#code_id').val(),
                title: $('#title').val(),
                code_type: $('#code_type').val(),
                code_content: codeEditor.getValue(),
                linking_type: $('#linking_type').val(),
                where_on_page: $('#where_on_page').val(),
                where_in_site: $('#where_in_site').val(),
                minify_code: $('#minify_code').is(':checked') ? 1 : 0,
                priority: $('#priority').val(),
                url_rules: $('#url_rules').val(),
                is_active: $('#is_active').is(':checked') ? 1 : 0,
                create_file: 1
            };

            $('#publish').prop('disabled', true).text('Saving...');

            $.ajax({
                url: framifyData.ajax_url,
                type: 'POST',
                data: data,
                success: function(response) {
                    if (response.success) {
                        alert(response.data.message);
                        window.location.href = framifyData.site_url + '/wp-admin/admin.php?page=framify';
                    } else {
                        alert('Error: ' + response.data);
                        $('#publish').prop('disabled', false).text('Update');
                    }
                },
                error: function() {
                    alert('An error occurred while saving');
                    $('#publish').prop('disabled', false).text('Update');
                }
            });
        }
    };

    // Initialize on document ready
    $(document).ready(function() {
        Framify.init();
    });

})(jQuery);