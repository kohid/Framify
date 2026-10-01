/**
 * Framify - Live Preview Frontend JavaScript
 * Version: 1.0.0
 */

(function($) {
    'use strict';
    
    console.log('Framify: Script file loading...');
    
    // Variables
    var cssEditor, jqueryEditor, phpEditor, htmlEditor;
    var isDragging = false;
    var isResizing = false;
    var resizeDirection = '';
    var startX, startY, startWidth, startHeight, startLeft, startTop;
    var modalUrlRules = [{ value: '', type: 'all', index: 1 }];
    var currentCodeType = 'css';
    var currentLoadedCodeId = { css: null, jquery: null, php: null, html: null };
    var currentLoadedUrlRules = { css: '', jquery: '', php: '', html: '' };
    var searchMatches = { css: [], jquery: [], php: [], html: [] };
    var currentMatchIndex = { css: 0, jquery: 0, php: 0, html: 0 };

    var FR_ICON_COLLAPSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8"/></svg>';
    var FR_ICON_EXPAND = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4v8M4 8h8"/></svg>';

    // Syntax theme that matches the interface theme saved on this user's account.
    function framifyStartupCmTheme() {
        var data = window.framifyLiveData || {};
        var map = data.cm_themes || {};
        return map[data.theme] || 'material-darker';
    }
    
    // Initialize on document ready
    $(document).ready(function() {
        console.log('Framify: Document ready, initializing...');
        initializeEditors();
        setupEventHandlers();
        setupResize();

        // No appearance bootstrap needed: the theme is a data-framify-theme
        // attribute rendered onto <html> server-side, so it is already applied
        // before this script runs.
        console.log('Framify: Initialization complete!');
        handleIframeAdminBar();
        
        // Re-apply live CSS and HTML after any iframe reload (e.g. cache-bust)
        var previewFrame = document.getElementById('framify-preview-frame');
        if (previewFrame) {
            previewFrame.addEventListener('load', function() {
                setTimeout(function() {
                    if (currentLoadedCodeId.css) applyCSSToPreview();
                    if (currentLoadedCodeId.html) applyHTMLToPreview();
                }, 150);
            });
        }
    });
    
    /**
     * Handle Admin Bar visibility in iframe based on settings
     */
    function handleIframeAdminBar() {
        var iframe = document.getElementById('framify-preview-frame');
        if (!iframe) {
            console.log('Framify: Iframe not found, retrying...');
            setTimeout(handleIframeAdminBar, 500);
            return;
        }
        
        // Wait for iframe to load
        iframe.addEventListener('load', function() {
            try {
                var iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                if (!iframeDoc) {
                    console.log('Framify: Cannot access iframe document');
                    return;
                }
                
                var adminBar = iframeDoc.getElementById('wpadminbar');
                
                if (adminBar) {
                    if (framifyLiveData.show_admin_bar) {
                        adminBar.style.display = '';
                        console.log('Framify: Admin bar shown in iframe');
                    } else {
                        adminBar.style.display = 'none';
                        console.log('Framify: Admin bar hidden in iframe');
                        
                        // Remove the admin-bar-inline-css style tag that adds html margin-top
                        var adminBarInlineCSS = iframeDoc.getElementById('admin-bar-inline-css');
                        if (adminBarInlineCSS) {
                            adminBarInlineCSS.remove();
                            console.log('Framify: Removed admin-bar-inline-css');
                        }
                        
                        // Also set html margin-top to 0 with !important
                        var htmlEl = iframeDoc.querySelector('html');
                        if (htmlEl) {
                            htmlEl.style.setProperty('margin-top', '0', 'important');
                            console.log('Framify: Set html margin-top to 0');
                        }
                    }
                } else {
                    console.log('Framify: Admin bar not found in iframe');
                }
            } catch(e) {
                console.error('Framify: Error accessing iframe:', e);
            }
        });
        
        // Trigger on initial load if already loaded
        if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
            iframe.dispatchEvent(new Event('load'));
        }
    }
    
    /**
     * Tab finishes the property or value you are part-way through typing.
     * Everywhere else it stays the indent key, so it never fights the editor:
     * an empty line, whitespace, or a selection all fall through to indent.
     */
    function completeCssOnTab(cm) {
        if (cm.getOption('readOnly') || cm.somethingSelected()) {
            return CodeMirror.Pass;
        }

        var cursor = cm.getCursor();
        var beforeCursor = cm.getLine(cursor.line).slice(0, cursor.ch);

        // Nothing part-typed under the cursor - let Tab indent as usual.
        if (!/[\w-]$/.test(beforeCursor)) {
            return CodeMirror.Pass;
        }

        cm.showHint({
            hint: CodeMirror.hint.css,
            // Tab means "finish this", so a single match lands without a menu.
            completeSingle: true,
            closeOnUnfocus: true
        });
    }

    function initializeEditors() {
        console.log('Framify: Initializing editors...');
        
        cssEditor = CodeMirror.fromTextArea(document.getElementById('live-css-editor'), {
            mode: 'css',
            theme: framifyStartupCmTheme(),
            lineNumbers: true,
            lineWrapping: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            readOnly: true,  // Start as read-only
            cursorBlinkRate: -1,  // Hide cursor initially
            hintOptions: {
                completeSingle: false,
                closeOnUnfocus: true
            },
            extraKeys: {
                "Tab": completeCssOnTab,
                "Shift-Tab": "indentLess",
                "Ctrl-Space": "autocomplete",
                "Ctrl-S": function(cm) {
                    saveCurrentCode('css');
                    return false;
                },
                "Ctrl-F": function(cm) {
                    showSearchBox('css');
                    return false;
                },
                "Ctrl-H": function(cm) {
                    showSearchBox('css', true);
                    return false;
                },
                "Ctrl-/": function(cm) {
                    toggleComment(cm);
                    return false;
                }
            }
        });
        
        jqueryEditor = CodeMirror.fromTextArea(document.getElementById('live-jquery-editor'), {
            mode: 'javascript',
            theme: framifyStartupCmTheme(),
            lineNumbers: true,
            lineWrapping: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            readOnly: true,  // Start as read-only
            cursorBlinkRate: -1,  // Hide cursor initially
            extraKeys: {
                "Ctrl-S": function(cm) {
                    saveCurrentCode('jquery');
                    return false;
                },
                "Ctrl-F": function(cm) {
                    showSearchBox('jquery');
                    return false;
                },
                "Ctrl-H": function(cm) {
                    showSearchBox('jquery', true);
                    return false;
                },
                "Ctrl-/": function(cm) {
                    toggleComment(cm);
                    return false;
                }
            }
        });
        
        phpEditor = CodeMirror.fromTextArea(document.getElementById('live-php-editor'), {
            mode: 'application/x-httpd-php',
            theme: framifyStartupCmTheme(),
            lineNumbers: true,
            lineWrapping: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            readOnly: true,  // Start as read-only
            cursorBlinkRate: -1,  // Hide cursor initially
            extraKeys: {
                "Ctrl-S": function(cm) {
                    saveCurrentCode('php');
                    return false;
                },
                "Ctrl-F": function(cm) {
                    showSearchBox('php');
                    return false;
                },
                "Ctrl-H": function(cm) {
                    showSearchBox('php', true);
                    return false;
                },
                "Ctrl-/": function(cm) {
                    toggleComment(cm);
                    return false;
                }
            }
        });
        
        htmlEditor = CodeMirror.fromTextArea(document.getElementById('live-html-editor'), {
            mode: 'htmlmixed',
            theme: framifyStartupCmTheme(),
            lineNumbers: true,
            lineWrapping: true,
            autoCloseBrackets: true,
            matchBrackets: true,
            readOnly: true,
            cursorBlinkRate: -1,
            extraKeys: {
                "Ctrl-S": function(cm) {
                    saveCurrentCode('html');
                    return false;
                },
                "Ctrl-F": function(cm) {
                    showSearchBox('html');
                    return false;
                },
                "Ctrl-H": function(cm) {
                    showSearchBox('html', true);
                    return false;
                },
                "Ctrl-/": function(cm) {
                    toggleComment(cm);
                    return false;
                }
            }
        });
        
        // Add disabled class initially
        $(cssEditor.getWrapperElement()).addClass('CodeMirror-disabled');
        $(jqueryEditor.getWrapperElement()).addClass('CodeMirror-disabled');
        $(phpEditor.getWrapperElement()).addClass('CodeMirror-disabled');
        $(htmlEditor.getWrapperElement()).addClass('CodeMirror-disabled');
        
        // CSS Live Preview - updates as you type
        cssEditor.on('change', function() {
            applyCSSToPreview();
        });
        
        cssEditor.on('inputRead', function() {
            applyCSSToPreview();
        });
        
        // HTML Live Preview - updates as you type
        htmlEditor.on('change', function() {
            applyHTMLToPreview();
        });
        
        htmlEditor.on('inputRead', function() {
            applyHTMLToPreview();
        });
        
        // CSS Autocomplete - trigger on typing (skip comments)
        cssEditor.on('inputRead', function(cm, change) {
            if (change.text[0] && /^[a-zA-Z-]$/.test(change.text[0])) {
                var cursor = cm.getCursor();
                var token = cm.getTokenAt(cursor);
                
                // Don't trigger autocomplete inside comments
                if (token.type && token.type.indexOf('comment') !== -1) {
                    return;
                }
                
                // Auto-trigger autocomplete when typing letters or hyphens
                CodeMirror.commands.autocomplete(cm, null, {completeSingle: false});
            }
        });
        
        console.log('Framify: Editors initialized with live preview');
    }
    
    function showSearchBox(type, showReplace) {
        var searchBox = $('#search-box-' + type);
        var replaceRow = searchBox.find('.replace-row');
        var toggleBtn = searchBox.find('.toggle-replace');
        
        if (searchBox.is(':visible')) {
            searchBox.hide();
            replaceRow.hide();
            toggleBtn.removeClass('active');
            $('#search-input-' + type).val('');
            $('#replace-input-' + type).val('');
        } else {
            // Hide all other search boxes
            $('.search-box').hide();
            $('.replace-row').hide();
            $('.toggle-replace').removeClass('active');
            
            searchBox.show();
            
            if (showReplace) {
                replaceRow.show();
                toggleBtn.addClass('active');
                $('#replace-input-' + type).focus();
            } else {
                $('#search-input-' + type).focus();
            }
        }
    }
    
    function toggleComment(cm) {
        var mode = cm.getMode().name;
        var commentStart, commentEnd, lineComment;
        
        // Determine comment style based on mode
        if (mode === 'css') {
            commentStart = '/* ';
            commentEnd = ' */';
        } else if (mode === 'javascript') {
            lineComment = '// ';
        } else if (mode === 'php' || mode === 'application/x-httpd-php') {
            lineComment = '// ';
        }
        
        var selection = cm.getSelection();
        var cursor = cm.getCursor();
        
        if (selection) {
            // Toggle comment for selection
            var trimmed = selection.trim();
            
            if (commentStart && commentEnd) {
                // Block comment (CSS)
                if (trimmed.indexOf(commentStart) === 0 && trimmed.lastIndexOf(commentEnd) === trimmed.length - commentEnd.length) {
                    // Uncomment
                    var uncommented = trimmed.substring(commentStart.length, trimmed.length - commentEnd.length);
                    cm.replaceSelection(uncommented);
                } else {
                    // Comment
                    cm.replaceSelection(commentStart + selection + commentEnd);
                }
            } else if (lineComment) {
                // Line comment (JavaScript/PHP)
                var lines = selection.split('\n');
                var allCommented = lines.every(function(line) {
                    return line.trim().indexOf(lineComment) === 0 || line.trim() === '';
                });
                
                if (allCommented) {
                    // Uncomment - properly remove line comment
                    var uncommented = lines.map(function(line) {
                        var trimmed = line.trim();
                        if (trimmed.indexOf(lineComment) === 0) {
                            // Find and remove first occurrence of lineComment
                            var commentIndex = line.indexOf(lineComment);
                            if (commentIndex !== -1) {
                                return line.substring(0, commentIndex) + line.substring(commentIndex + lineComment.length);
                            }
                        }
                        return line;
                    }).join('\n');
                    cm.replaceSelection(uncommented);
                } else {
                    // Comment - preserve indentation
                    var commented = lines.map(function(line) {
                        if (line.trim()) {
                            var indentMatch = line.match(/^(\s*)/);
                            var indent = indentMatch ? indentMatch[1] : '';
                            return indent + lineComment + line.substring(indent.length);
                        }
                        return line;
                    }).join('\n');
                    cm.replaceSelection(commented);
                }
            }
        } else {
            // Toggle comment for current line
            var line = cm.getLine(cursor.line);
            var trimmed = line.trim();
            
            if (lineComment) {
                if (trimmed.indexOf(lineComment) === 0) {
                    // Uncomment
                    var uncommented = line.replace(lineComment, '');
                    cm.replaceRange(uncommented, {line: cursor.line, ch: 0}, {line: cursor.line, ch: line.length});
                } else {
                    // Comment
                    var indentMatch = line.match(/^(\s*)/);
                    var indent = indentMatch ? indentMatch[1] : '';
                    var commented = indent + lineComment + line.substring(indent.length);
                    cm.replaceRange(commented, {line: cursor.line, ch: 0}, {line: cursor.line, ch: line.length});
                }
            } else if (commentStart && commentEnd) {
                // CSS block comment for single line
                if (trimmed.indexOf(commentStart) === 0 && trimmed.lastIndexOf(commentEnd) === trimmed.length - commentEnd.length) {
                    // Uncomment
                    var uncommented = line.replace(commentStart, '').replace(commentEnd, '');
                    cm.replaceRange(uncommented, {line: cursor.line, ch: 0}, {line: cursor.line, ch: line.length});
                } else {
                    // Comment
                    var commented = commentStart + line + commentEnd;
                    cm.replaceRange(commented, {line: cursor.line, ch: 0}, {line: cursor.line, ch: line.length});
                }
            }
        }
    }
    
    /**
     * Mutes the saved copy of a stylesheet the server already printed into the
     * frame, so the editor is the only thing styling that snippet while you
     * work on it.
     *
     * Without this, deleting a declaration looks like it does nothing: the
     * editor's copy is appended alongside the saved one, and an empty rule
     * cannot un-declare what the saved copy already set.
     *
     * @param {Document}    iframeDoc
     * @param {number|null} codeId Snippet being edited, or null to unmute all.
     */
    function muteSavedStyle(iframeDoc, codeId) {
        var saved = iframeDoc.querySelectorAll('style[data-framify]');

        for (var i = 0; i < saved.length; i++) {
            saved[i].disabled = false;
        }

        if (!codeId) return;

        var current = iframeDoc.querySelector('style[data-framify="css-' + codeId + '"]');
        if (current) current.disabled = true;
    }

    function applyCSSToPreview() {
        var iframe = document.getElementById('framify-preview-frame');
        if (!iframe) return;

        try {
            var iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc) return;

            muteSavedStyle(iframeDoc, currentLoadedCodeId.css);

            var oldStyle = iframeDoc.getElementById('framify-live-css');
            if (oldStyle) oldStyle.remove();

            if (!currentLoadedCodeId.css) return;

            var cssCode = cssEditor.getValue();
            if (!cssCode || cssCode.trim() === '' || cssCode.trim() === '/* Enter your CSS code here */') {
                return;
            }

            var currentUrlRules = currentLoadedUrlRules.css;
            if (currentUrlRules && currentUrlRules.trim() !== '') {
                if (!checkURLRules(currentUrlRules)) return;
            }
            
            var styleEl = iframeDoc.createElement('style');
            styleEl.id = 'framify-live-css';
            styleEl.textContent = cssCode;
            iframeDoc.head.appendChild(styleEl);
        } catch(e) {
            console.error('Error applying CSS:', e);
        }
    }
    
    function reloadPreviewIframe() {
        var iframe = document.getElementById('framify-preview-frame');
        if (!iframe) return;
        try {
            // Get current src from attribute (more reliable than contentWindow.location)
            var currentSrc = iframe.getAttribute('src') || '';
            if (!currentSrc) {
                try { currentSrc = iframe.contentWindow.location.href; } catch(e) {}
            }
            if (!currentSrc) return;
            // Strip any existing _fvcache param
            currentSrc = currentSrc.replace(/[?&]_fvcache=[^&]*/g, '').replace(/[?&]$/, '');
            var sep = currentSrc.indexOf('?') !== -1 ? '&' : '?';
            iframe.src = currentSrc + sep + '_fvcache=' + Date.now();
        } catch(e) {
            console.error('Framify: Error reloading iframe:', e);
        }
    }
    
    /**
     * The elements of a saved HTML snippet the server printed into the frame.
     * They sit between <!--framify-html-ID--> and <!--/framify-html-ID-->
     * rather than inside a wrapper, so walk the siblings between the markers.
     */
    function savedHtmlElements(iframeDoc, codeId) {
        var walker = iframeDoc.createTreeWalker(iframeDoc.documentElement, NodeFilter.SHOW_COMMENT, null, false);
        var openMarker = 'framify-html-' + codeId;
        var closeMarker = '/framify-html-' + codeId;
        var found = [];
        var start = null;
        var node;

        while ((node = walker.nextNode())) {
            if (node.nodeValue === openMarker) {
                start = node;
                break;
            }
        }

        if (!start) return found;

        var sibling = start.nextSibling;
        while (sibling && !(sibling.nodeType === 8 && sibling.nodeValue === closeMarker)) {
            if (sibling.nodeType === 1) found.push(sibling);
            sibling = sibling.nextSibling;
        }

        return found;
    }

    /**
     * Hides the saved copy of an HTML snippet while its editor is open, for the
     * same reason CSS gets muted: otherwise the saved copy stays on the page and
     * you see your edits duplicated instead of replaced.
     */
    function hideSavedHtml(iframeDoc, codeId) {
        var previous = hideSavedHtml.hidden || [];

        // Restore whatever was hidden last time before hiding anything new.
        for (var i = 0; i < previous.length; i++) {
            previous[i].el.style.display = previous[i].display;
        }

        var nowHidden = [];

        if (codeId) {
            var elements = savedHtmlElements(iframeDoc, codeId);
            for (var j = 0; j < elements.length; j++) {
                nowHidden.push({ el: elements[j], display: elements[j].style.display });
                elements[j].style.display = 'none';
            }
        }

        hideSavedHtml.hidden = nowHidden;
    }

    function applyHTMLToPreview() {
        var iframe = document.getElementById('framify-preview-frame');
        if (!iframe) return;

        try {
            var iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc || !iframeDoc.body) return;

            hideSavedHtml(iframeDoc, currentLoadedCodeId.html);

            if (!currentLoadedCodeId.html) {
                var stale = iframeDoc.getElementById('framify-live-html');
                if (stale) stale.remove();
                return;
            }

            var htmlCode = htmlEditor.getValue();
            if (!htmlCode || htmlCode.trim() === '' || htmlCode.trim() === '<!-- Enter your HTML code here -->') {
                var old = iframeDoc.getElementById('framify-live-html');
                if (old) old.remove();
                return;
            }
            
            var currentUrlRules = currentLoadedUrlRules.html;
            if (currentUrlRules && currentUrlRules.trim() !== '') {
                if (!checkURLRules(currentUrlRules)) return;
            }
            
            // Remove old injected container
            var old = iframeDoc.getElementById('framify-live-html');
            if (old) old.remove();
            
            // Create a container and inject HTML
            var container = iframeDoc.createElement('div');
            container.id = 'framify-live-html';
            iframeDoc.body.appendChild(container);
            
            // Use innerHTML for non-script HTML; re-create script tags so they execute
            var tempDiv = iframeDoc.createElement('div');
            tempDiv.innerHTML = htmlCode;
            
            var nodes = tempDiv.childNodes;
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                if (node.nodeName === 'SCRIPT') {
                    // Re-create script so browser executes it
                    var script = iframeDoc.createElement('script');
                    if (node.src) {
                        script.src = node.src;
                    } else {
                        script.textContent = node.textContent;
                    }
                    script.type = node.type || 'text/javascript';
                    container.appendChild(script);
                } else {
                    container.appendChild(node.cloneNode(true));
                }
            }
        } catch(e) {
            console.error('Framify: Error applying HTML preview:', e);
        }
    }
    
    function setupResize() {
        var editor = document.getElementById('framify-floating-editor');
        var handles = editor.querySelectorAll('.resize-handle');
        
        handles.forEach(function(handle) {
            handle.addEventListener('mousedown', function(e) {
                if (e.button !== 0) return;
                if (editor.classList.contains('collapsed')) return;
                
                e.preventDefault();
                e.stopPropagation();
                
                isResizing = true;
                
                if (handle.classList.contains('resize-handle-n')) resizeDirection = 'n';
                else if (handle.classList.contains('resize-handle-s')) resizeDirection = 's';
                else if (handle.classList.contains('resize-handle-e')) resizeDirection = 'e';
                else if (handle.classList.contains('resize-handle-w')) resizeDirection = 'w';
                else if (handle.classList.contains('resize-handle-ne')) resizeDirection = 'ne';
                else if (handle.classList.contains('resize-handle-nw')) resizeDirection = 'nw';
                else if (handle.classList.contains('resize-handle-se')) resizeDirection = 'se';
                else if (handle.classList.contains('resize-handle-sw')) resizeDirection = 'sw';
                
                startX = e.clientX;
                startY = e.clientY;
                
                var rect = editor.getBoundingClientRect();
                startWidth = rect.width;
                startHeight = rect.height;
                startLeft = rect.left;
                startTop = rect.top;
                
                editor.classList.add('resizing');
                
                var iframe = document.getElementById('framify-preview-frame');
                if (iframe) iframe.style.pointerEvents = 'none';
                
                document.body.style.userSelect = 'none';
                document.body.style.cursor = getComputedStyle(handle).cursor;
            });
        });
        
        document.addEventListener('mousemove', function(e) {
            if (!isResizing) return;
            
            e.preventDefault();
            
            var editor = document.getElementById('framify-floating-editor');
            var deltaX = e.clientX - startX;
            var deltaY = e.clientY - startY;
            
            var newWidth = startWidth;
            var newHeight = startHeight;
            var newLeft = startLeft;
            var newTop = startTop;
            
            var minWidth = 350;
            var minHeight = 400;
            var maxWidth = window.innerWidth * 0.9;
            var maxHeight = window.innerHeight * 0.9;
            
            switch(resizeDirection) {
                case 'e':
                    newWidth = Math.max(minWidth, Math.min(startWidth + deltaX, maxWidth));
                    break;
                case 'w':
                    var proposedWidthW = startWidth - deltaX;
                    if (proposedWidthW >= minWidth && proposedWidthW <= maxWidth) {
                        newWidth = proposedWidthW;
                        newLeft = startLeft + deltaX;
                        if (newLeft < 0) {
                            newLeft = 0;
                            newWidth = startLeft + startWidth;
                        }
                    }
                    break;
                case 's':
                    newHeight = Math.max(minHeight, Math.min(startHeight + deltaY, maxHeight));
                    break;
                case 'n':
                    var proposedHeightN = startHeight - deltaY;
                    if (proposedHeightN >= minHeight && proposedHeightN <= maxHeight) {
                        newHeight = proposedHeightN;
                        newTop = startTop + deltaY;
                        if (newTop < 0) {
                            newTop = 0;
                            newHeight = startTop + startHeight;
                        }
                    }
                    break;
                case 'se':
                    newWidth = Math.max(minWidth, Math.min(startWidth + deltaX, maxWidth));
                    newHeight = Math.max(minHeight, Math.min(startHeight + deltaY, maxHeight));
                    break;
                case 'sw':
                    var proposedWidthSW = startWidth - deltaX;
                    if (proposedWidthSW >= minWidth && proposedWidthSW <= maxWidth) {
                        newWidth = proposedWidthSW;
                        newLeft = startLeft + deltaX;
                        if (newLeft < 0) {
                            newLeft = 0;
                            newWidth = startLeft + startWidth;
                        }
                    }
                    newHeight = Math.max(minHeight, Math.min(startHeight + deltaY, maxHeight));
                    break;
                case 'ne':
                    newWidth = Math.max(minWidth, Math.min(startWidth + deltaX, maxWidth));
                    var proposedHeightNE = startHeight - deltaY;
                    if (proposedHeightNE >= minHeight && proposedHeightNE <= maxHeight) {
                        newHeight = proposedHeightNE;
                        newTop = startTop + deltaY;
                        if (newTop < 0) {
                            newTop = 0;
                            newHeight = startTop + startHeight;
                        }
                    }
                    break;
                case 'nw':
                    var proposedWidthNW = startWidth - deltaX;
                    if (proposedWidthNW >= minWidth && proposedWidthNW <= maxWidth) {
                        newWidth = proposedWidthNW;
                        newLeft = startLeft + deltaX;
                        if (newLeft < 0) {
                            newLeft = 0;
                            newWidth = startLeft + startWidth;
                        }
                    }
                    var proposedHeightNW = startHeight - deltaY;
                    if (proposedHeightNW >= minHeight && proposedHeightNW <= maxHeight) {
                        newHeight = proposedHeightNW;
                        newTop = startTop + deltaY;
                        if (newTop < 0) {
                            newTop = 0;
                            newHeight = startTop + startHeight;
                        }
                    }
                    break;
            }
            
            var maxAllowedLeft = window.innerWidth - newWidth;
            var maxAllowedTop = window.innerHeight - newHeight;
            
            newLeft = Math.max(0, Math.min(newLeft, maxAllowedLeft));
            newTop = Math.max(0, Math.min(newTop, maxAllowedTop));
            
            editor.style.width = newWidth + 'px';
            editor.style.height = newHeight + 'px';
            
            if (resizeDirection.indexOf('w') !== -1 || resizeDirection.indexOf('e') !== -1) {
                editor.style.left = newLeft + 'px';
                editor.style.right = 'auto';
            }
            if (resizeDirection.indexOf('n') !== -1 || resizeDirection.indexOf('s') !== -1) {
                editor.style.top = newTop + 'px';
                editor.style.bottom = 'auto';
            }
        });
        
        document.addEventListener('mouseup', function() {
            if (isResizing) {
                isResizing = false;
                resizeDirection = '';
                
                var editor = document.getElementById('framify-floating-editor');
                editor.classList.remove('resizing');
                
                var iframe = document.getElementById('framify-preview-frame');
                if (iframe) iframe.style.pointerEvents = 'auto';
                
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                
                setTimeout(function() {
                    cssEditor.refresh();
                    jqueryEditor.refresh();
                    phpEditor.refresh();
                }, 50);
            }
        });
    }
    
    function setupEventHandlers() {
        var editor = document.getElementById('framify-floating-editor');
        var header = editor.querySelector('.editor-header');
        
        // Tab switching
        $('.editor-tab').on('click', function() {
            var tab = $(this).data('tab');
            $('.editor-tab').removeClass('active');
            $(this).addClass('active');
            $('.editor-pane').removeClass('active');
            $('#pane-' + tab).addClass('active');
            
            setTimeout(function() {
                if (tab === 'css') cssEditor.refresh();
                else if (tab === 'jquery') jqueryEditor.refresh();
                else if (tab === 'php') phpEditor.refresh();
                else if (tab === 'html') htmlEditor.refresh();
            }, 50);
        });
        
        // Collapse
        $('.toggle-collapse').on('click', function() {
            editor.classList.toggle('collapsed');
            $(this).html(editor.classList.contains('collapsed') ? FR_ICON_EXPAND : FR_ICON_COLLAPSE);
            
            if (!editor.classList.contains('collapsed')) {
                setTimeout(function() {
                    cssEditor.refresh();
                    jqueryEditor.refresh();
                    phpEditor.refresh();
                    htmlEditor.refresh();
                }, 100);
            }
        });




        /* ============================================
        FRAMIFY DOCK & RESIZE SYSTEM - FIXED VERSION
        Replace the dock section in live-preview-script.js
        ============================================ */

        // Dock position buttons
        $('.dock-position-btn').on('click', function() {
            var position = $(this).data('position');
            var editor = document.getElementById('framify-floating-editor');
            var previewContainer = document.getElementById('framify-preview-container');
            
            // Remove all dock classes
            editor.classList.remove('dock-float', 'dock-left', 'dock-right', 'dock-bottom');
            
            // Add new dock class
            editor.classList.add('dock-' + position);
            
            // CRITICAL: Reset ALL inline styles on preview container
            previewContainer.style.position = '';
            previewContainer.style.left = '';
            previewContainer.style.right = '';
            previewContainer.style.top = '';
            previewContainer.style.bottom = '';
            previewContainer.style.width = '';
            previewContainer.style.height = '';
            previewContainer.style.margin = '';
            previewContainer.style.padding = '';
            
            // Reset inline styles when docking
            if (position !== 'float') {
                editor.style.width = '';
                editor.style.height = '';
                editor.style.left = '';
                editor.style.right = '';
                editor.style.top = '';
                editor.style.bottom = '';
            } else {
                // Return to default float position
                editor.style.width = '450px';
                editor.style.height = '600px';
                editor.style.right = '20px';
                editor.style.bottom = '20px';
                editor.style.left = 'auto';
                editor.style.top = 'auto';
            }
            
            // Refresh editors after position change
            setTimeout(function() {
                cssEditor.refresh();
                jqueryEditor.refresh();
                phpEditor.refresh();
            }, 100);
            
            console.log('Framify: Switched to ' + position + ' mode');
        });

        // ============================================
        // DOCK RESIZE FUNCTIONALITY - FIXED
        // ============================================

        var isDockResizing = false;
        var dockStartX, dockStartY, dockStartWidth, dockStartHeight;

        // Setup dock resize handle
        $('.dock-resize-handle').on('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            isDockResizing = true;
            var editor = document.getElementById('framify-floating-editor');
            var rect = editor.getBoundingClientRect();
            
            dockStartX = e.clientX;
            dockStartY = e.clientY;
            dockStartWidth = rect.width;
            dockStartHeight = rect.height;
            
            document.body.style.userSelect = 'none';
            document.body.style.cursor = editor.classList.contains('dock-bottom') ? 'ns-resize' : 'ew-resize';
            
            // Disable iframe pointer events during resize
            var iframe = document.getElementById('framify-preview-frame');
            if (iframe) iframe.style.pointerEvents = 'none';
        });

        $(document).on('mousemove', function(e) {
            if (!isDockResizing) return;
            
            e.preventDefault();
            
            var editor = document.getElementById('framify-floating-editor');
            var previewContainer = document.getElementById('framify-preview-container');
            
            if (editor.classList.contains('dock-left')) {
                // Resize width for dock-left
                var deltaX = e.clientX - dockStartX;
                var newWidth = Math.max(300, Math.min(dockStartWidth + deltaX, window.innerWidth * 0.8));
                editor.style.width = newWidth + 'px';
                
                // Use setProperty with priority 'important' to override CSS
                previewContainer.style.setProperty('left', newWidth + 'px', 'important');
                
                console.log('Dock left resize:', newWidth + 'px');
                
            } else if (editor.classList.contains('dock-right')) {
                // Resize width for dock-right
                var deltaX = e.clientX - dockStartX;
                var newWidth = Math.max(300, Math.min(dockStartWidth - deltaX, window.innerWidth * 0.8));
                editor.style.width = newWidth + 'px';
                
                // Use setProperty with priority 'important' to override CSS
                previewContainer.style.setProperty('right', newWidth + 'px', 'important');
                
                console.log('Dock right resize:', newWidth + 'px');
                
            } else if (editor.classList.contains('dock-bottom')) {
                // Resize height for dock-bottom
                var deltaY = e.clientY - dockStartY;
                var newHeight = Math.max(200, Math.min(dockStartHeight - deltaY, window.innerHeight * 0.8));
                editor.style.height = newHeight + 'px';
                
                // Use setProperty with priority 'important' to override CSS
                previewContainer.style.setProperty('bottom', newHeight + 'px', 'important');
                
                console.log('Dock bottom resize:', newHeight + 'px');
            }
        });

        $(document).on('mouseup', function(e) {
            if (isDockResizing) {
                isDockResizing = false;
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                
                // Re-enable iframe pointer events
                var iframe = document.getElementById('framify-preview-frame');
                if (iframe) iframe.style.pointerEvents = 'auto';
                
                // Refresh editors after resize
                setTimeout(function() {
                    cssEditor.refresh();
                    jqueryEditor.refresh();
                    phpEditor.refresh();
                }, 50);
            }
        });



        
        // Dragging - works even when collapsed
        header.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            if (e.target.closest('.editor-controls') || e.target.closest('.resize-handle')) return;
            
            if (editor.classList.contains('collapsed')) {
                isDragging = true;
                var rect = editor.getBoundingClientRect();
                startX = e.clientX - rect.left;
                startY = e.clientY - rect.top;
                
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'move';
                
                e.preventDefault();
                return;
            }
            
            isDragging = true;
            var rect = editor.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;
            
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'move';
            
            e.preventDefault();
        });
        
        // Double-click to expand when collapsed
        header.addEventListener('dblclick', function(e) {
            if (editor.classList.contains('collapsed')) {
                editor.classList.remove('collapsed');
                $('.toggle-collapse').html(FR_ICON_COLLAPSE);
                setTimeout(function() {
                    cssEditor.refresh();
                    jqueryEditor.refresh();
                    phpEditor.refresh();
                }, 100);
            }
        });
        
        document.addEventListener('mousemove', function(e) {
            if (isDragging) {
                var x = e.clientX - startX;
                var y = e.clientY - startY;
                editor.style.right = 'auto';
                editor.style.bottom = 'auto';
                editor.style.left = Math.max(0, Math.min(x, window.innerWidth - editor.offsetWidth)) + 'px';
                editor.style.top = Math.max(0, Math.min(y, window.innerHeight - 60)) + 'px';
            }
        });
        
        document.addEventListener('mouseup', function(e) {
            if (isDragging) {
                isDragging = false;
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
            }
        });
        
        setupCodeHandlers();
        setupModalHandlers();
    }
    
    function setupCodeHandlers() {
        $('#viewport-width').on('change', function() {
            var value = $(this).val();
            var iframe = document.getElementById('framify-preview-frame');
            var editor = document.getElementById('framify-floating-editor');
            var dockButtons = $('.dock-position-btn');
            
            if (value === '100%') {
                // Full Width mode
                // Use setProperty with !important to override CSS
                iframe.style.setProperty('width', '100%', 'important');
                iframe.style.setProperty('height', '100%', 'important');
                iframe.style.setProperty('max-width', '100%', 'important');
                
                // Show dock buttons
                dockButtons.show();
                
                console.log('Framify: Full width mode - dock buttons enabled');
                
            } else {
                // Mobile/Tablet mode - specific width
                var width = parseInt(value);
                
                // Auto-undock to float mode
                if (!editor.classList.contains('dock-float')) {
                    console.log('Framify: Auto-undocking for mobile viewport');
                    
                    // Remove all dock classes
                    editor.classList.remove('dock-left', 'dock-right', 'dock-bottom');
                    editor.classList.add('dock-float');
                    
                    // Reset preview container
                    var previewContainer = document.getElementById('framify-preview-container');
                    previewContainer.style.position = '';
                    previewContainer.style.left = '';
                    previewContainer.style.right = '';
                    previewContainer.style.top = '';
                    previewContainer.style.bottom = '';
                    previewContainer.style.width = '';
                    previewContainer.style.height = '';
                    previewContainer.style.margin = '';
                    previewContainer.style.padding = '';
                    
                    // Set editor to default float position
                    editor.style.width = '450px';
                    editor.style.height = '600px';
                    editor.style.right = '20px';
                    editor.style.bottom = '20px';
                    editor.style.left = 'auto';
                    editor.style.top = 'auto';
                    
                    // Refresh editors
                    setTimeout(function() {
                        cssEditor.refresh();
                        jqueryEditor.refresh();
                        phpEditor.refresh();
                    }, 100);
                }
                
                // Hide dock buttons in mobile mode
                dockButtons.hide();
                
                // Set iframe to specific mobile width using setProperty with !important
                iframe.style.setProperty('width', width + 'px', 'important');
                iframe.style.setProperty('height', '98%', 'important');
                iframe.style.setProperty('max-width', width + 'px', 'important');
                iframe.style.setProperty('border-radius', '20px', 'important');
                
                console.log('Framify: Mobile viewport ' + width + 'px - iframe resized - dock buttons hidden');
            }
        });
        
        // ==========================================
        // CRITICAL: LOAD CODE WITH ENABLE/DISABLE
        // ==========================================
        $('#load-saved-css-code, #load-saved-jquery-code, #load-saved-php-code, #load-saved-html-code').on('change', function() {
            var codeId = $(this).val();
            var type = $(this).attr('id').indexOf('css') !== -1 ? 'css' : 
                    ($(this).attr('id').indexOf('jquery') !== -1 ? 'jquery' : 
                    ($(this).attr('id').indexOf('php') !== -1 ? 'php' : 'html'));
            
            var editor = type === 'css' ? cssEditor : (type === 'jquery' ? jqueryEditor : (type === 'php' ? phpEditor : htmlEditor));
            
            if (!codeId) {
                // NO FILE SELECTED - DISABLE EDITOR
                currentLoadedCodeId[type] = null;
                currentLoadedUrlRules[type] = '';
                
                editor.setValue('');  // Clear content
                editor.setOption('readOnly', true);
                editor.setOption('cursorBlinkRate', -1);
                $(editor.getWrapperElement()).addClass('CodeMirror-disabled');
                
                // Hide edit and save buttons
                if (type === 'css') {
                    $('#edit-css-code-btn').hide();
                    $('#css_save_button').css('display', 'none');
                } else if (type === 'jquery') {
                    $('#edit-jquery-code-btn').hide();
                    $('#jquery_save_button').css('display', 'none');
                } else if (type === 'php') {
                    $('#edit-php-code-btn').hide();
                    $('#php_save_button').css('display', 'none');
                } else if (type === 'html') {
                    $('#edit-html-code-btn').hide();
                    $('#html_save_button').css('display', 'none');
                }
                
                // Nothing is being edited now, so hand the page back its saved
                // copy - otherwise it stays muted and the snippet looks deleted.
                if (type === 'css') applyCSSToPreview();
                if (type === 'html') applyHTMLToPreview();

                console.log('Framify: Editor disabled for ' + type);
                return;
            }
            
            // FILE SELECTED - ENABLE EDITOR
            editor.setOption('readOnly', false);
            editor.setOption('cursorBlinkRate', 530);
            $(editor.getWrapperElement()).removeClass('CodeMirror-disabled');
            
            // Show save button
            if (type === 'css') $('#css_save_button').css('display', 'inline-block');
            else if (type === 'jquery') $('#jquery_save_button').css('display', 'inline-block');
            else if (type === 'php') $('#php_save_button').css('display', 'inline-block');
            else if (type === 'html') $('#html_save_button').css('display', 'inline-block');
            
            currentLoadedCodeId[type] = codeId;
            loadCodeById(codeId, type);
            
            console.log('Framify: Editor enabled for ' + type);
        });
        
        $('#css_save_button, #jquery_save_button, #php_save_button, #html_save_button').on('click', function() {
            var type = $(this).attr('id').indexOf('css') !== -1 ? 'css' : ($(this).attr('id').indexOf('jquery') !== -1 ? 'jquery' : ($(this).attr('id').indexOf('php') !== -1 ? 'php' : 'html'));
            saveCurrentCode(type);
        });
        
        // Edit button handlers
        $('#edit-css-code-btn, #edit-jquery-code-btn, #edit-php-code-btn, #edit-html-code-btn').on('click', function() {
            var btnId = $(this).attr('id');
            var codeId = null;
            var type = '';
            
            if (btnId.indexOf('css') !== -1) {
                codeId = currentLoadedCodeId.css;
                type = 'css';
            } else if (btnId.indexOf('jquery') !== -1) {
                codeId = currentLoadedCodeId.jquery;
                type = 'jquery';
            } else if (btnId.indexOf('php') !== -1) {
                codeId = currentLoadedCodeId.php;
                type = 'php';
            } else if (btnId.indexOf('html') !== -1) {
                codeId = currentLoadedCodeId.html;
                type = 'html';
            }
            
            if (codeId) {
                loadCodeForEditing(codeId, type);
            }
        });
        
        
        // Search functionality
        $('#search-input-css, #search-input-jquery, #search-input-php, #search-input-html').on('input', function() {
            var type = $(this).attr('id').replace('search-input-', '');
            var searchTerm = $(this).val();
            performSearch(type, searchTerm);
        });
        
        $('#search-input-css, #search-input-jquery, #search-input-php, #search-input-html').on('keydown', function(e) {
            var type = $(this).attr('id').replace('search-input-', '');
            
            if (e.key === 'Escape') {
                var searchBox = $(this).closest('.search-box');
                searchBox.hide();
                searchBox.find('.replace-row').hide();
                searchBox.find('.toggle-replace').removeClass('active');
                searchBox.find('input').val('');
                $('#search-counter-' + type).text('0 of 0');
                
                var editor = type === 'css' ? cssEditor : (type === 'jquery' ? jqueryEditor : (type === 'php' ? phpEditor : htmlEditor));
                editor.getAllMarks().forEach(function(mark) {
                    mark.clear();
                });
                searchMatches[type] = [];
                currentMatchIndex[type] = 0;
                editor.focus();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                findNext(type, e.shiftKey);
                // Keep focus on search input - don't let it transfer
                return false;
            }
        });
        
        // Search navigation buttons
        $('.search-prev').on('click', function() {
            var searchBox = $(this).closest('.search-box');
            var type = searchBox.attr('id').replace('search-box-', '');
            findNext(type, true); // true = reverse
        });
        
        $('.search-next').on('click', function() {
            var searchBox = $(this).closest('.search-box');
            var type = searchBox.attr('id').replace('search-box-', '');
            findNext(type, false);
        });
        
        // Toggle replace
        $('.toggle-replace').on('click', function() {
            var searchBox = $(this).closest('.search-box');
            var replaceRow = searchBox.find('.replace-row');
            
            if (replaceRow.is(':visible')) {
                replaceRow.hide();
                $(this).removeClass('active');
            } else {
                replaceRow.show();
                $(this).addClass('active');
                replaceRow.find('input').focus();
            }
        });
        
        // Close search box
        $('.search-close').on('click', function() {
            var searchBox = $(this).closest('.search-box');
            var type = searchBox.attr('id').replace('search-box-', '');
            var editor = type === 'css' ? cssEditor : (type === 'jquery' ? jqueryEditor : (type === 'php' ? phpEditor : htmlEditor));
            
            searchBox.hide();
            searchBox.find('.replace-row').hide();
            searchBox.find('.toggle-replace').removeClass('active');
            searchBox.find('input').val('');
            $('#search-counter-' + type).text('0 of 0');
            
            // Clear highlights
            editor.getAllMarks().forEach(function(mark) {
                mark.clear();
            });
            
            searchMatches[type] = [];
            currentMatchIndex[type] = 0;
            editor.focus();
        });
        
        // Replace one
        $('.replace-one').on('click', function() {
            var searchBox = $(this).closest('.search-box');
            var type = searchBox.attr('id').replace('search-box-', '');
            var searchTerm = $('#search-input-' + type).val();
            var replaceTerm = $('#replace-input-' + type).val();
            
            if (!searchTerm || searchMatches[type].length === 0) {
                return;
            }
            
            replaceOne(type, searchTerm, replaceTerm);
        });
        
        // Replace all
        $('.replace-all').on('click', function() {
            var searchBox = $(this).closest('.search-box');
            var type = searchBox.attr('id').replace('search-box-', '');
            var searchTerm = $('#search-input-' + type).val();
            var replaceTerm = $('#replace-input-' + type).val();
            
            if (!searchTerm || searchMatches[type].length === 0) {
                return;
            }
            
            if (confirm('Replace ' + searchMatches[type].length + ' occurrence(s)?')) {
                replaceAll(type, searchTerm, replaceTerm);
            }
        });
        
        // Replace input enter key
        $('#replace-input-css, #replace-input-jquery, #replace-input-php').on('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                $(this).closest('.search-box').find('.replace-one').click();
                return false;
            }
        });
    }
    
    function performSearch(type, searchTerm) {
        var editor = type === 'css' ? cssEditor : (type === 'jquery' ? jqueryEditor : (type === 'php' ? phpEditor : htmlEditor));
        var counter = $('#search-counter-' + type);
        
        // Clear previous highlights
        editor.getAllMarks().forEach(function(mark) {
            mark.clear();
        });
        
        searchMatches[type] = [];
        currentMatchIndex[type] = 0;
        
        if (!searchTerm) {
            counter.text('0 of 0');
            return;
        }
        
        // Get all content from editor
        var content = editor.getValue();
        var searchLower = searchTerm.toLowerCase();
        var contentLower = content.toLowerCase();
        
        // Find all matches manually
        var matchCount = 0;
        var index = 0;
        
        while ((index = contentLower.indexOf(searchLower, index)) !== -1) {
            matchCount++;
            
            // Convert string index to CodeMirror position
            var from = editor.posFromIndex(index);
            var to = editor.posFromIndex(index + searchTerm.length);
            
            searchMatches[type].push({ from: from, to: to });
            
            // Highlight match
            editor.markText(from, to, {
                className: 'search-highlight'
            });
            
            index += searchTerm.length;
        }
        
        console.log('Found', matchCount, 'matches for "' + searchTerm + '"');
        
        // Update counter and select first match
        if (matchCount > 0) {
            currentMatchIndex[type] = 1;
            counter.text('1 of ' + matchCount);
            
            // Select and scroll to first match
            var firstMatch = searchMatches[type][0];
            editor.setSelection(firstMatch.from, firstMatch.to);
            editor.scrollIntoView(firstMatch.from, 100);
            // editor.focus(); // Don't steal focus from search input while typing
        } else {
            counter.text('0 of 0');
            console.log('No matches found for "' + searchTerm + '"');
        }
    }
    
    function findNext(type, reverse) {
        var editor = type === 'css' ? cssEditor : (type === 'jquery' ? jqueryEditor : (type === 'php' ? phpEditor : htmlEditor));
        var counter = $('#search-counter-' + type);
        var matches = searchMatches[type];
        
        if (matches.length === 0) {
            console.log('No matches to navigate');
            return;
        }
        
        if (reverse) {
            currentMatchIndex[type]--;
            if (currentMatchIndex[type] < 1) {
                currentMatchIndex[type] = matches.length;
            }
        } else {
            currentMatchIndex[type]++;
            if (currentMatchIndex[type] > matches.length) {
                currentMatchIndex[type] = 1;
            }
        }
        
        var currentMatch = matches[currentMatchIndex[type] - 1];
        editor.setSelection(currentMatch.from, currentMatch.to);
        editor.scrollIntoView(currentMatch.from, 100);
        // DON't call editor.focus() - keep focus on search input
        
        counter.text(currentMatchIndex[type] + ' of ' + matches.length);
        console.log('Navigated to match', currentMatchIndex[type], 'of', matches.length);
    }
    
    function replaceOne(type, searchTerm, replaceTerm) {
        var editor = type === 'css' ? cssEditor : (type === 'jquery' ? jqueryEditor : (type === 'php' ? phpEditor : htmlEditor));
        var matches = searchMatches[type];
        
        if (matches.length === 0 || currentMatchIndex[type] === 0) {
            return;
        }
        
        // Get current match
        var currentMatch = matches[currentMatchIndex[type] - 1];
        
        // Replace the text
        editor.replaceRange(replaceTerm, currentMatch.from, currentMatch.to);
        
        // Update search to reflect the change
        var searchInput = $('#search-input-' + type);
        performSearch(type, searchTerm);
        
        // Move to next match if available
        if (searchMatches[type].length > 0) {
            if (currentMatchIndex[type] > searchMatches[type].length) {
                currentMatchIndex[type] = searchMatches[type].length;
            }
            findNext(type, false);
        }
        
        // Keep focus on replace input
        $('#replace-input-' + type).focus();
    }
    
    function replaceAll(type, searchTerm, replaceTerm) {
        var editor = type === 'css' ? cssEditor : (type === 'jquery' ? jqueryEditor : (type === 'php' ? phpEditor : htmlEditor));
        var content = editor.getValue();
        
        // Use global case-insensitive replace
        var searchRegex = new RegExp(escapeRegex(searchTerm), 'gi');
        var newContent = content.replace(searchRegex, replaceTerm);
        
        // Set the new content
        editor.setValue(newContent);
        
        // Clear search
        searchMatches[type] = [];
        currentMatchIndex[type] = 0;
        $('#search-counter-' + type).text('0 of 0');
        
        // Re-search to show results
        setTimeout(function() {
            var searchInput = $('#search-input-' + type);
            performSearch(type, searchTerm);
        }, 100);
        
        // Keep focus on replace input
        $('#replace-input-' + type).focus();
    }
    
    function escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    
    function setupModalHandlers() {
        $('#open-add-modal').on('click', function() {
            resetModalForm();
            $('#framify-add-modal').addClass('active').attr('aria-hidden', 'false');
        });
        
        $('#close-add-modal, #modal-cancel').on('click', function() {
            $('#framify-add-modal').removeClass('active').attr('aria-hidden', 'true');
        });
        
        $('.code-type-btn').on('click', function() {
            $('.code-type-btn').removeClass('active');
            $(this).addClass('active');
            currentCodeType = $(this).data('type');
            updateAlwaysRunVisibility();
        });
        
        $('.accordion-header').on('click', function() {
            $(this).parent('.modal-accordion').toggleClass('active');
        });
        
        $('#modal-new-rule-type').on('change', function() {
            var type = $(this).val();
            if (type === 'all' || type === 'first-page') {
                $('#modal-new-rule-value').hide();
            } else {
                $('#modal-new-rule-value').show();
            }
        });
        
        $('#modal-add-url-rule').on('click', function() {
            var type = $('#modal-new-rule-type').val();
            var value = $('#modal-new-rule-value').val();
            
            if ((type !== 'all' && type !== 'first-page') && !value.trim()) {
                alert('Please enter a URL pattern');
                return;
            }
            
            if (type !== 'all') {
                modalUrlRules = modalUrlRules.filter(function(r) { return r.type !== 'all'; });
            } else {
                modalUrlRules = [];
            }
            
            modalUrlRules.push({
                type: type,
                value: value,
                index: modalUrlRules.length + 1
            });
            
            $('#modal-new-rule-value').val('');
            renderModalUrlRules();
        });
        
        $(document).on('click', '.rule-remove', function(e) {
            e.preventDefault();
            var index = $(this).data('index');
            modalUrlRules.splice(index, 1);
            
            if (modalUrlRules.length === 0) {
                modalUrlRules = [{ value: '', type: 'all', index: 1 }];
            }
            
            renderModalUrlRules();
        });
        
        $('#modal-delete').on('click', function() {
            if (!confirm('Are you sure you want to delete this code? This cannot be undone.')) {
                return;
            }
            
            var codeId = $('#modal-code-id').val();
            if (!codeId) return;
            
            $.post(framifyLiveData.ajax_url, {
                action: 'framify_delete_code',
                nonce: framifyLiveData.nonce,
                id: codeId
            }, function(response) {
                if (response.success) {
                    var dropdown = currentCodeType === 'css' ? '#load-saved-css-code' : 
                                    (currentCodeType === 'jquery' ? '#load-saved-jquery-code' : 
                                    (currentCodeType === 'php' ? '#load-saved-php-code' : '#load-saved-html-code'));
                    $(dropdown + ' option[value="' + codeId + '"]').remove();
                    $(dropdown).val('').trigger('change');
                    
                    $('#framify-add-modal').removeClass('active').attr('aria-hidden', 'true');
                    alert('Code deleted successfully!');
                } else {
                    alert('Error deleting code: ' + response.data);
                }
            }).fail(function() {
                alert('Failed to delete code');
            });
        });
        
        
        $('#modal-save').on('click', function() {
            var title = $('#modal-code-title').val().trim();
            if (!title) {
                alert('Please enter a title');
                return;
            }
            
            var codeId = $('#modal-code-id').val();
            var codeContent = '';
            
            // Only get content from editor if we're EDITING an existing code
            // For NEW codes, save default placeholder with jQuery wrapper
            if (codeId) {
                // Editing existing code - get content from editor
                if (currentCodeType === 'css') codeContent = cssEditor.getValue();
                else if (currentCodeType === 'jquery') codeContent = jqueryEditor.getValue();
                else if (currentCodeType === 'php') codeContent = phpEditor.getValue();
                else if (currentCodeType === 'html') codeContent = htmlEditor.getValue();
            } else {
                // Creating NEW code - use placeholder with jQuery wrapper for new jQuery files
                if (currentCodeType === 'css') {
                    codeContent = '/* Enter your CSS code here */';
                } else if (currentCodeType === 'jquery') {
                    codeContent = 'jQuery(document).ready(function($) {\n    // Enter your jQuery code here\n    // Note: jQuery changes require saving and page refresh to take effect\n});';
                } else if (currentCodeType === 'php') {
                    codeContent = '<?php\n// Enter your PHP code here\n// Note: PHP changes require saving and page refresh to take effect\n?>';
                } else if (currentCodeType === 'html') {
                    codeContent = '<!-- Enter your HTML code here -->';
                }
            }
            
            var data = {
                action: 'framify_save_code',
                nonce: framifyLiveData.nonce,
                id: codeId,
                title: title,
                code_type: currentCodeType,
                code_content: codeContent,
                linking_type: $('#modal-linking-type').val(),
                where_on_page: $('#modal-where-page').val(),
                where_in_site: $('#modal-where-site').val(),
                minify_code: $('#modal-minify').is(':checked') ? 1 : 0,
                priority: $('#modal-priority').val(),
                url_rules: $('#modal-url-rules').val(),
                is_active: $('#modal-is-active').is(':checked') ? 1 : 0,
                always_run: $('#modal-always-run').is(':checked') ? 1 : 0,
                create_file: 1
            };
            
            $.post(framifyLiveData.ajax_url, data, function(response) {
                if (response.success) {
                    var savedId = response.data.id;
                    var isActive = data.is_active;
                    var optionLabel = title + (isActive ? '' : ' (inactive)');
                    var dropdown = currentCodeType === 'css' ? '#load-saved-css-code' : 
                                    (currentCodeType === 'jquery' ? '#load-saved-jquery-code' : 
                                    (currentCodeType === 'php' ? '#load-saved-php-code' : '#load-saved-html-code'));
                    
                    if (!$(dropdown + ' option[value="' + savedId + '"]').length) {
                        $(dropdown).append($('<option></option>').val(savedId).attr('data-active', isActive).text(optionLabel));
                    } else {
                        $(dropdown + ' option[value="' + savedId + '"]').attr('data-active', isActive).text(optionLabel);
                    }
                    
                    $(dropdown).val(savedId).trigger('change');
                    
                    $('#framify-add-modal').removeClass('active').attr('aria-hidden', 'true');
                    
                    // Reload iframe to reflect new code / settings changes
                    if (currentCodeType === 'css') {
                        applyCSSToPreview();
                    } else if (currentCodeType === 'html') {
                        applyHTMLToPreview();
                        reloadPreviewIframe();
                    } else {
                        reloadPreviewIframe();
                    }
                    
                    alert('Code saved successfully!');
                } else {
                    alert('Error saving code: ' + response.data);
                }
            }).fail(function() {
                alert('Failed to save code');
            });
        });
    }
    
    function loadCodeById(codeId, type) {
        $.post(framifyLiveData.ajax_url, {
            action: 'framify_get_code',
            nonce: framifyLiveData.nonce,
            id: codeId
        }, function(response) {
            if (response.success) {
                var code = response.data;
                currentLoadedUrlRules[type] = code.url_rules || '';
                
                if (type === 'css') {
                    console.log('Loading CSS code:', code.title);
                    cssEditor.setValue(code.code_content);
                    $('.editor-tab[data-tab="css"]').trigger('click');
                    $('#edit-css-code-btn').show();
                    
                    setTimeout(function() {
                        cssEditor.refresh();
                        console.log('Applying initial CSS preview');
                        applyCSSToPreview();
                    }, 150);
                } else if (type === 'jquery') {
                    jqueryEditor.setValue(code.code_content);
                    $('.editor-tab[data-tab="jquery"]').trigger('click');
                    jqueryEditor.refresh();
                    $('#edit-jquery-code-btn').show();
                } else if (type === 'php') {
                    phpEditor.setValue(code.code_content);
                    $('.editor-tab[data-tab="php"]').trigger('click');
                    phpEditor.refresh();
                    $('#edit-php-code-btn').show();
                } else if (type === 'html') {
                    htmlEditor.setValue(code.code_content);
                    $('.editor-tab[data-tab="html"]').trigger('click');
                    htmlEditor.refresh();
                    $('#edit-html-code-btn').show();
                    setTimeout(function() {
                        applyHTMLToPreview();
                    }, 150);
                }
            }
        });
    }
    
    function loadCodeForEditing(codeId, type) {
        $.post(framifyLiveData.ajax_url, {
            action: 'framify_get_code',
            nonce: framifyLiveData.nonce,
            id: codeId
        }, function(response) {
            if (response.success) {
                var code = response.data;
                
                $('#modal-code-id').val(code.id);
                $('#modal-code-title').val(code.title);
                
                $('.code-type-btn').removeClass('active');
                $('.code-type-btn[data-type="' + code.code_type + '"]').addClass('active');
                currentCodeType = code.code_type;
                
                $('#modal-linking-type').val(code.linking_type || 'internal');
                $('#modal-where-page').val(code.where_on_page || 'header');
                $('#modal-where-site').val(code.where_in_site || 'frontend');
                $('#modal-minify').prop('checked', code.minify_code == 1);
                $('#modal-priority').val(code.priority || 5);
                $('#modal-is-active').prop('checked', code.is_active == 1);
                $('#modal-always-run').prop('checked', code.always_run == 1);
                updateAlwaysRunVisibility();
                
                if (code.url_rules) {
                    try {
                        modalUrlRules = JSON.parse(code.url_rules);
                        renderModalUrlRules();
                    } catch(e) {
                        modalUrlRules = [{ value: '', type: 'all', index: 1 }];
                    }
                } else {
                    modalUrlRules = [{ value: '', type: 'all', index: 1 }];
                    renderModalUrlRules();
                }
                
                $('#framify-code-modal-title').text('Edit Custom Code');
                $('#modal-delete').show();
                $('#framify-add-modal').addClass('active').attr('aria-hidden', 'false');
            } else {
                alert('Error loading code: ' + response.data);
            }
        }).fail(function() {
            alert('Failed to load code data');
        });
    }
    
    function saveCurrentCode(type) {
        var codeId = currentLoadedCodeId[type];
        if (!codeId) {
            var btn = type === 'css' ? '#css_save_button' : (type === 'jquery' ? '#jquery_save_button' : (type === 'php' ? '#php_save_button' : '#html_save_button'));
            var originalText = $(btn).text();
            $(btn).text('Load code first!').css('background', 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)');
            setTimeout(function() {
                $(btn).text(originalText).css('background', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)');
            }, 2000);
            return;
        }
        
        var content = '';
        if (type === 'css') content = cssEditor.getValue();
        else if (type === 'jquery') content = jqueryEditor.getValue();
        else if (type === 'php') content = phpEditor.getValue();
        else if (type === 'html') content = htmlEditor.getValue();
        
        var btn = type === 'css' ? '#css_save_button' : (type === 'jquery' ? '#jquery_save_button' : (type === 'php' ? '#php_save_button' : '#html_save_button'));
        var originalText = $(btn).text();
        $(btn).text('Saving...').prop('disabled', true);
        
        $.post(framifyLiveData.ajax_url, {
            action: 'framify_save_code',
            nonce: framifyLiveData.nonce,
            id: codeId,
            code_content: content,
            quick_save: 1,
            create_file: 1
        }, function(response) {
            if (response.success) {
                $(btn).text('Saved!').css('background', 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)');
                setTimeout(function() {
                    $(btn).text(originalText).css('background', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)').prop('disabled', false);
                }, 1500);
                // Live-apply CSS/HTML; reload iframe for jQuery/PHP
                if (type === 'css') {
                    applyCSSToPreview();
                } else if (type === 'html') {
                    applyHTMLToPreview();
                    reloadPreviewIframe();
                } else {
                    reloadPreviewIframe();
                }
            } else {
                $(btn).text('Error!').css('background', 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)');
                setTimeout(function() {
                    $(btn).text(originalText).css('background', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)').prop('disabled', false);
                }, 2000);
            }
        }).fail(function() {
            $(btn).text('Error!').css('background', 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)');
            setTimeout(function() {
                $(btn).text(originalText).css('background', 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)').prop('disabled', false);
            }, 2000);
        });
    }
    
    function checkURLRules(urlRulesJson) {
        if (!urlRulesJson) return true;
        
        try {
            var rules = JSON.parse(urlRulesJson);
            if (!Array.isArray(rules) || rules.length === 0) return true;
            
            var iframe = document.getElementById('framify-preview-frame');
            var currentURL = iframe.contentWindow.location.href;
            var homeURL = framifyLiveData.home_url;
            
            for (var i = 0; i < rules.length; i++) {
                var rule = rules[i];
                var type = rule.type;
                var value = rule.value || '';
                
                if (type === 'all') return true;
                if (type === 'first-page' && (currentURL === homeURL || currentURL === homeURL + '/')) return true;
                if (type === 'contains' && currentURL.indexOf(value) !== -1) return true;
                if (type === 'not-contains' && currentURL.indexOf(value) === -1) return true;
                if (type === 'equal-to' && currentURL === value) return true;
                if (type === 'not-equal-to' && currentURL !== value) return true;
                if (type === 'begins-with' && currentURL.indexOf(value) === 0) return true;
                if (type === 'ends-by' && currentURL.substr(currentURL.length - value.length) === value) return true;
            }
            
            return false;
        } catch(e) {
            return true;
        }
    }
    
    function renderModalUrlRules() {
        var container = $('#modal-url-rules-list');
        container.empty();
        
        if (!modalUrlRules || modalUrlRules.length === 0) {
            modalUrlRules = [{ value: '', type: 'all', index: 1 }];
        }
        
        for (var i = 0; i < modalUrlRules.length; i++) {
            var rule = modalUrlRules[i];
            var typeLabel = getURLRuleTypeLabel(rule.type);
            var valueDisplay = rule.value ? ': ' + rule.value : '';
            
            container.append(
                '<div class="url-rule-item">' +
                '<span class="rule-type">' + typeLabel + '</span>' +
                '<span class="rule-value">' + valueDisplay + '</span>' +
                '<a href="#" class="rule-remove" data-index="' + i + '">&times;</a>' +
                '</div>'
            );
        }
        
        $('#modal-url-rules').val(JSON.stringify(modalUrlRules));
    }
    
    function getURLRuleTypeLabel(type) {
        var labels = {
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
    }
    
    /**
     * "Always run" only means anything for PHP, which is the only type that
     * executes at request time. Hiding it elsewhere keeps the option honest.
     */
    function updateAlwaysRunVisibility() {
        $('#modal-always-run-row').toggle(currentCodeType === 'php');
    }

    function resetModalForm() {
        $('#modal-code-id').val('');
        $('#modal-code-title').val('');
        $('.code-type-btn').removeClass('active');
        $('.code-type-btn[data-type="css"]').addClass('active');
        currentCodeType = 'css';
        $('#modal-linking-type').val('internal');
        $('#modal-where-page').val('header');
        $('#modal-where-site').val('frontend');
        $('#modal-minify').prop('checked', false);
        $('#modal-is-active').prop('checked', true);
        $('#modal-always-run').prop('checked', false);
        updateAlwaysRunVisibility();
        $('#modal-priority').val('5');
        modalUrlRules = [{ value: '', type: 'all', index: 1 }];
        renderModalUrlRules();
        $('#framify-code-modal-title').text('Add Custom Code');
        $('#modal-delete').hide();
    }
    
    // Export to global scope
    window.FramifyLive = {
        test: function() {
            console.log('=== Framify Test ===');
            console.log('CSS Editor:', !!cssEditor);
            console.log('Code loaded:', currentLoadedCodeId.css);
            console.log('Iframe:', !!document.getElementById('framify-preview-frame'));
            if (cssEditor && currentLoadedCodeId.css) {
                console.log('Triggering preview...');
                applyCSSToPreview();
            }
            return true;
        },
        applyCSSToPreview: applyCSSToPreview
    };
    
    console.log('Framify: Global object created');


// ============================================================
// Theme picker
//
// A theme is a set of CSS custom properties keyed off
// data-framify-theme on <html>, so applying one is a single
// attribute swap. The choice is stored on the user's WordPress
// account, and the template renders it server-side on load.
// ============================================================

$(function () {
    var $grid = $('#framify-theme-grid');
    if (!$grid.length) return;

    var $cards = $grid.find('.fr-theme');
    var $status = $('#framify-theme-status');
    var cmThemes = (window.framifyLiveData && framifyLiveData.cm_themes) || {};
    var statusTimer = null;

    function setStatus(message, state) {
        $status.text(message)
               .removeClass('is-saved is-error')
               .addClass(state || '');
    }

    function syntaxThemeFor(theme) {
        return cmThemes[theme] || 'material-darker';
    }

    function applyTheme(theme) {
        var $html = $('html');

        // Let colours cross-fade for the length of the swap, then stop paying for it.
        $html.addClass('fr-theming');
        if (statusTimer) clearTimeout(statusTimer);
        statusTimer = setTimeout(function () {
            $html.removeClass('fr-theming');
        }, 350);

        $html.attr('data-framify-theme', theme);

        // Keep the syntax colours in step with the chrome.
        var cmTheme = syntaxThemeFor(theme);
        [cssEditor, jqueryEditor, phpEditor, htmlEditor].forEach(function (editor) {
            if (editor) editor.setOption('theme', cmTheme);
        });

        $cards.each(function () {
            var isChosen = $(this).data('theme') === theme;
            $(this).attr('aria-checked', isChosen ? 'true' : 'false')
                   .attr('tabindex', isChosen ? '0' : '-1');
        });
    }

    function saveTheme(theme) {
        setStatus('Saving');

        $.ajax({
            url: framifyLiveData.ajax_url,
            type: 'POST',
            data: {
                action: 'framify_save_ui_theme',
                nonce: framifyLiveData.nonce,
                theme: theme
            }
        }).done(function (response) {
            if (response && response.success) {
                framifyLiveData.theme = theme;
                setStatus('Saved to your account', 'is-saved');
            } else {
                setStatus('Server rejected the theme', 'is-error');
            }
        }).fail(function () {
            setStatus('Not saved - check your connection', 'is-error');
        });
    }

    function chooseTheme(theme) {
        if (!theme) return;
        applyTheme(theme);
        saveTheme(theme);
    }

    $cards.on('click', function () {
        chooseTheme($(this).data('theme'));
    });

    // Arrow keys move through the group, as a radio group should.
    $grid.on('keydown', '.fr-theme', function (e) {
        var keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
        if (keys.indexOf(e.key) === -1) return;

        e.preventDefault();
        var step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
        var next = ($cards.index(this) + step + $cards.length) % $cards.length;

        $cards.eq(next).trigger('focus');
        chooseTheme($cards.eq(next).data('theme'));
    });

    // Open / close
    $('#open-settings-modal').on('click', function () {
        $('#framify-settings-modal').addClass('active').attr('aria-hidden', 'false');
        setStatus('Saved to your account');
        $cards.filter('[aria-checked="true"]').trigger('focus');
    });

    $('#close-settings-modal, #settings-done').on('click', function () {
        $('#framify-settings-modal').removeClass('active').attr('aria-hidden', 'true');
        $('#open-settings-modal').trigger('focus');
    });

    $('#framify-settings-modal').on('click', function (e) {
        if (e.target === this) {
            $(this).removeClass('active').attr('aria-hidden', 'true');
        }
    });

    $(document).on('keydown', function (e) {
        if (e.key === 'Escape' && $('#framify-settings-modal').hasClass('active')) {
            $('#framify-settings-modal').removeClass('active').attr('aria-hidden', 'true');
            $('#open-settings-modal').trigger('focus');
        }
    });
});
})(jQuery);
