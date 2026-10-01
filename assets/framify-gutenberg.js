/**
 * Framify - Gutenberg Plugin Sidebar + Accordion Block
 * Elementor-style widget settings: Content / Style / Advanced tabs
 * File: assets/framify-gutenberg.js
 */

(function () {
    'use strict';

    const { registerPlugin }  = wp.plugins;
    const { PluginSidebarMoreMenuItem, PluginSidebar } = wp.editPost;
    const { TextControl, TextareaControl, ToggleControl, Draggable } = wp.components;
    const { useState, Fragment, createElement: el } = wp.element;
    const { registerBlockType } = wp.blocks;
    const { InspectorControls, useBlockProps } = wp.blockEditor;

    /* ============================================================
       SHARED UI HELPERS
    ============================================================ */

    function SectionLabel(label) {
        return el('div', { className: 'frm-section-label' }, label);
    }

    function ColorRow({ label, value, onChange }) {
        return el('div', { className: 'frm-control-row' },
            el('span', { className: 'frm-control-label' }, label),
            el('div', { className: 'frm-color-wrap' },
                el('input', { type: 'color', value: value, onChange: (e) => onChange(e.target.value), className: 'frm-color-swatch' }),
                el('input', { type: 'text', value: value, onChange: (e) => onChange(e.target.value), className: 'frm-color-text', maxLength: 9 }),
            )
        );
    }

    function SliderRow({ label, value, min, max, step = 1, unit = 'px', onChange }) {
        return el('div', { className: 'frm-control-row frm-slider-row' },
            el('span', { className: 'frm-control-label' }, label),
            el('div', { className: 'frm-slider-wrap' },
                el('input', { type: 'range', min, max, step, value, onChange: (e) => onChange(Number(e.target.value)), className: 'frm-slider' }),
                el('div', { className: 'frm-slider-number-wrap' },
                    el('input', { type: 'number', min, max, step, value, onChange: (e) => onChange(Number(e.target.value)), className: 'frm-slider-number' }),
                    unit && el('span', { className: 'frm-unit' }, unit),
                ),
            )
        );
    }

    function SegmentedRow({ label, value, options, onChange }) {
        return el('div', { className: 'frm-control-row' },
            el('span', { className: 'frm-control-label' }, label),
            el('select', {
                className: 'frm-select frm-segmented-select',
                value: value,
                onChange: (e) => onChange(e.target.value),
            },
                options.map(opt =>
                    el('option', { key: opt.value, value: opt.value }, opt.label || opt.icon)
                )
            )
        );
    }

    function DimensionsRow({ label, value, onChange }) {
        const [isLinked, setLinked] = useState(true);
        const sides = ['top', 'right', 'bottom', 'left'];
        const val = typeof value === 'object' ? value : { top: value, right: value, bottom: value, left: value };
        const update = (side, num) => {
            if (isLinked) onChange({ top: num, right: num, bottom: num, left: num });
            else onChange({ ...val, [side]: num });
        };
        return el('div', { className: 'frm-dims-block' },
            el('div', { className: 'frm-dims-header' },
                el('span', { className: 'frm-control-label' }, label),
                el('button', {
                    type: 'button',
                    className: `frm-link-btn ${isLinked ? 'is-linked' : ''}`,
                    onClick: () => setLinked(!isLinked),
                    title: isLinked ? 'Unlink sides' : 'Link all sides',
                }, isLinked ? '🔗' : '⛓️')
            ),
            el('div', { className: 'frm-dims-inputs' },
                sides.map(side =>
                    el('div', { key: side, className: 'frm-dim-cell' },
                        el('input', {
                            type: 'number',
                            value: val[side] !== undefined ? val[side] : 0,
                            onChange: (e) => update(side, Number(e.target.value)),
                            className: 'frm-dim-input',
                        }),
                        el('span', { className: 'frm-dim-label' }, side.charAt(0).toUpperCase()),
                    )
                )
            )
        );
    }

    function TypographyGroup({ value = {}, onChange }) {
        const update = (key, v) => onChange({ ...value, [key]: v });
        return el('div', { className: 'frm-typography-group' },
            SliderRow({ label: 'Font Size', value: value.fontSize || 15, min: 10, max: 72, unit: 'px', onChange: v => update('fontSize', v) }),
            el('div', { className: 'frm-control-row' },
                el('span', { className: 'frm-control-label' }, 'Font Weight'),
                el('select', { className: 'frm-select', value: value.fontWeight || '600', onChange: (e) => update('fontWeight', e.target.value) },
                    [['300','Light'],['400','Regular'],['500','Medium'],['600','SemiBold'],['700','Bold'],['800','ExtraBold']].map(([v,l]) => el('option', { key: v, value: v }, l))
                )
            ),
            SliderRow({ label: 'Line Height', value: value.lineHeight || 1.5, min: 1, max: 3, step: 0.1, unit: 'em', onChange: v => update('lineHeight', v) }),
            SliderRow({ label: 'Letter Spacing', value: value.letterSpacing || 0, min: -2, max: 10, step: 0.1, unit: 'px', onChange: v => update('letterSpacing', v) }),
            SegmentedRow({
                label: 'Transform',
                value: value.textTransform || 'none',
                options: [
                    { value: 'none',       icon: 'Aa',  label: 'None' },
                    { value: 'uppercase',  icon: 'AA',  label: 'Uppercase' },
                    { value: 'lowercase',  icon: 'aa',  label: 'Lowercase' },
                    { value: 'capitalize', icon: 'Aa+', label: 'Capitalize' },
                ],
                onChange: v => update('textTransform', v),
            }),
        );
    }

    function SettingsGroup({ title, defaultOpen = false, children }) {
        const [open, setOpen] = useState(defaultOpen);
        return el('div', { className: `frm-settings-group ${open ? 'is-open' : ''}` },
            el('button', { type: 'button', className: 'frm-group-toggle', onClick: () => setOpen(!open) },
                el('span', { className: 'frm-group-caret' }, open ? '▾' : '▸'),
                el('span', { className: 'frm-group-title' }, title),
            ),
            open && el('div', { className: 'frm-group-body' }, children),
        );
    }

    /* ============================================================
       DASHICON PICKER COMPONENT
    ============================================================ */

    // Popular dashicons grouped by category
    const DASHICON_GROUPS = [
        { label: 'Arrows', icons: ['arrow-up','arrow-down','arrow-left','arrow-right','arrow-up-alt','arrow-down-alt','arrow-left-alt','arrow-right-alt','arrow-up-alt2','arrow-down-alt2','arrow-left-alt2','arrow-right-alt2','sort','randomize','controls-play','controls-pause','controls-forward','controls-back','controls-skipforward','controls-skipback','controls-repeat','controls-volumeon','controls-volumeoff'] },
        { label: 'UI', icons: ['plus','plus-alt','plus-alt2','minus','dismiss','no','no-alt','yes','yes-alt','warning','info','info-outline','flag','star-filled','star-half','star-empty','heart','thumbs-up','thumbs-down','editor-expand','editor-contract','search','lock','unlock','share','share-alt','share-alt2','rss','email','email-alt','email-alt2','list-view','grid-view','menu','menu-alt','menu-alt2','menu-alt3','ellipsis','move','redo','undo','editor-ul','editor-ol','editor-indent','editor-outdent','editor-alignleft','editor-aligncenter','editor-alignright','editor-alignnone','editor-justify','lightbulb'] },
        { label: 'Layout', icons: ['layout','columns','table-col-before','table-col-after','table-col-delete','table-row-before','table-row-after','table-row-delete','cover-image','image-crop','image-flip-horizontal','image-flip-vertical','image-rotate','image-rotate-left','image-rotate-right','images-alt','images-alt2','format-gallery','format-aside','format-audio','format-chat','format-image','format-quote','format-status','format-video'] },
        { label: 'Content', icons: ['media-text','media-default','media-archive','media-audio','media-code','media-document','media-interactive','media-spreadsheet','media-video','pages','portfolio','post-trash','saved','paperclip','products','welcome-learn-more','welcome-write-blog','welcome-add-page','welcome-view-site','welcome-widgets-menus','welcome-comments'] },
        { label: 'Misc', icons: ['clipboard','cloud','cloud-saved','cloud-upload','cloud-download','download','upload','backup','database','desktop','tablet','smartphone','phone','performance','update','update-alt','trash','trash-alt','trash-undo','trash-undo-alt','external','admin-appearance','admin-collapse','admin-comments','admin-customizer','admin-dashboard','admin-generic','admin-home','admin-links','admin-media','admin-network','admin-page','admin-plugins','admin-settings','admin-site','admin-site-alt','admin-site-alt2','admin-site-alt3','admin-tools','admin-users'] },
    ];

    function DashiconPicker({ value, onChange }) {
        const [search, setSearch] = useState('');
        const [openGroup, setOpenGroup] = useState(0);

        const allIcons = DASHICON_GROUPS.flatMap(g => g.icons);
        const filtered = search.trim()
            ? allIcons.filter(ic => ic.includes(search.toLowerCase()))
            : null;

        return el('div', { className: 'frm-dashicon-picker' },
            el('input', {
                type: 'text',
                className: 'frm-dashicon-search',
                placeholder: '🔍 Search dashicons...',
                value: search,
                onChange: (e) => setSearch(e.target.value),
            }),
            // Current selected preview
            el('div', { className: 'frm-dashicon-current' },
                el('span', { className: 'frm-dashicon-current-label' }, 'Selected:'),
                el('span', { className: `dashicons dashicons-${value}`, style: { fontSize: 20, color: '#667eea', marginLeft: 8 } }),
                el('code', { className: 'frm-dashicon-slug' }, value),
            ),
            // Search results or grouped
            filtered
                ? el('div', { className: 'frm-dashicon-grid' },
                    filtered.length === 0
                        ? el('span', { className: 'frm-dashicon-empty' }, 'No results')
                        : filtered.map(icon =>
                            el('button', {
                                key: icon,
                                type: 'button',
                                title: icon,
                                className: `frm-dashicon-btn ${value === icon ? 'is-selected' : ''}`,
                                onClick: () => onChange(icon),
                            },
                                el('span', { className: `dashicons dashicons-${icon}` })
                            )
                        )
                )
                : DASHICON_GROUPS.map((group, gi) =>
                    el('div', { key: group.label, className: 'frm-dashicon-group' },
                        el('button', {
                            type: 'button',
                            className: 'frm-dashicon-group-toggle',
                            onClick: () => setOpenGroup(openGroup === gi ? -1 : gi),
                        },
                            el('span', null, openGroup === gi ? '▾ ' : '▸ '),
                            group.label,
                        ),
                        openGroup === gi && el('div', { className: 'frm-dashicon-grid' },
                            group.icons.map(icon =>
                                el('button', {
                                    key: icon,
                                    type: 'button',
                                    title: icon,
                                    className: `frm-dashicon-btn ${value === icon ? 'is-selected' : ''}`,
                                    onClick: () => onChange(icon),
                                },
                                    el('span', { className: `dashicons dashicons-${icon}` })
                                )
                            )
                        )
                    )
                )
        );
    }

    /* ============================================================
       ACCORDION BLOCK
    ============================================================ */
    registerBlockType('framify/accordion', {
        title: 'Framify Accordion',
        description: 'Customizable accordion widget with Elementor-style controls.',
        category: 'common',
        icon: {
            src: el('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none' },
                el('rect', { x: 2, y: 3, width: 20, height: 5, rx: 2, fill: '#667eea' }),
                el('rect', { x: 2, y: 10, width: 20, height: 5, rx: 2, fill: '#764ba2', opacity: 0.5 }),
                el('rect', { x: 2, y: 17, width: 20, height: 5, rx: 2, fill: '#764ba2', opacity: 0.3 })
            )
        },
        attributes: {
            items:              { type: 'array',   default: [{ title: 'Item 1', content: 'Your content here.', icon: '', open: true }, { title: 'Item 2', content: 'Your content here.', icon: '', open: false }, { title: 'Item 3', content: 'Your content here.', icon: '', open: false }] },
            allowMultiple:      { type: 'boolean', default: false },
            defaultOpenAll:     { type: 'boolean', default: false },
            headerBg:           { type: 'string',  default: '#f8f9fa' },
            headerBgActive:     { type: 'string',  default: '#667eea' },
            headerColor:        { type: 'string',  default: '#1a1a1a' },
            headerColorActive:  { type: 'string',  default: '#ffffff' },
            headerTag:          { type: 'string',  default: 'button' },
            headerTypography:   { type: 'object',  default: { fontSize: 15, fontWeight: '600', lineHeight: 1.5, letterSpacing: 0, textTransform: 'none' } },
            headerPadding:      { type: 'object',  default: { top: 16, right: 20, bottom: 16, left: 20 } },
            contentBg:          { type: 'string',  default: '#ffffff' },
            contentColor:       { type: 'string',  default: '#555555' },
            contentTypography:  { type: 'object',  default: { fontSize: 14, fontWeight: '400', lineHeight: 1.7, letterSpacing: 0, textTransform: 'none' } },
            contentPadding:     { type: 'object',  default: { top: 16, right: 20, bottom: 16, left: 20 } },
            borderColor:        { type: 'string',  default: '#e0e0e0' },
            borderWidth:        { type: 'number',  default: 1 },
            borderRadius:       { type: 'number',  default: 8 },
            iconType:           { type: 'string',  default: 'svg' },
            iconStyle:          { type: 'string',  default: 'plus' },
            iconDashicon:       { type: 'string',  default: 'arrow-down-alt2' },
            iconDashiconActive: { type: 'string',  default: 'arrow-up-alt2' },
            iconColor:          { type: 'string',  default: '#667eea' },
            iconColorActive:    { type: 'string',  default: '#ffffff' },
            iconSize:           { type: 'number',  default: 16 },
            iconPosition:       { type: 'string',  default: 'right' },
            accordionStyle:     { type: 'string',  default: 'default' },
            itemSpacing:        { type: 'number',  default: 0 },
            customClass:        { type: 'string',  default: '' },
            customId:           { type: 'string',  default: '' },
            motionEffect:       { type: 'string',  default: 'none' },
            cssTransitionMs:    { type: 'number',  default: 300 },
            marginBlock:        { type: 'object',  default: { top: 0, right: 0, bottom: 0, left: 0 } },
            paddingBlock:       { type: 'object',  default: { top: 0, right: 0, bottom: 0, left: 0 } },
            zIndex:             { type: 'number',  default: 0 },
            hideOnDesktop:      { type: 'boolean', default: false },
            hideOnTablet:       { type: 'boolean', default: false },
            hideOnMobile:       { type: 'boolean', default: false },
        },

        edit: function AccordionEdit({ attributes, setAttributes, clientId }) {
            const {
                items, allowMultiple, defaultOpenAll,
                headerBg, headerBgActive, headerColor, headerColorActive, headerTag, headerTypography, headerPadding,
                contentBg, contentColor, contentTypography, contentPadding,
                borderColor, borderWidth, borderRadius,
                iconType, iconStyle, iconDashicon, iconDashiconActive, iconColor, iconColorActive, iconSize, iconPosition,
                accordionStyle, itemSpacing,
                customClass, customId, motionEffect, cssTransitionMs,
                marginBlock, paddingBlock, zIndex,
                hideOnDesktop, hideOnTablet, hideOnMobile,
            } = attributes;

            const blockProps = useBlockProps({ className: 'framify-accordion-editor' });
            const [openIndex, setOpenIndex] = useState(0);
            const [activeTab, setActiveTab] = useState('content');
            const set = (key) => (val) => setAttributes({ [key]: val });

            const updateItem = (index, key, value) => {
                setAttributes({ items: items.map((item, i) => i === index ? { ...item, [key]: value } : item) });
            };
            const addItem = () => {
                setAttributes({ items: [...items, { title: `Item ${items.length + 1}`, content: 'Your content here.', icon: '', open: false }] });
                setOpenIndex(items.length);
            };
            const removeItem = (index) => {
                if (items.length <= 1) return;
                setAttributes({ items: items.filter((_, i) => i !== index) });
                setOpenIndex(Math.max(0, index - 1));
            };
            const moveItem = (index, dir) => {
                const arr = [...items];
                const t = index + dir;
                if (t < 0 || t >= arr.length) return;
                [arr[index], arr[t]] = [arr[t], arr[index]];
                setAttributes({ items: arr });
                setOpenIndex(t);
            };

            /* Toggle control helper */
            const ToggleRow = ({ label, attrKey }) => el('div', { className: 'frm-control-row frm-toggle-row' },
                el('span', { className: 'frm-control-label' }, label),
                el('div', { className: 'frm-toggle-wrap' },
                    el('input', {
                        type: 'checkbox',
                        id: `frm-${attrKey}-${clientId}`,
                        checked: attributes[attrKey],
                        onChange: (e) => setAttributes({ [attrKey]: e.target.checked }),
                        className: 'frm-checkbox',
                    }),
                    el('label', { htmlFor: `frm-${attrKey}-${clientId}`, className: 'frm-toggle-label' }),
                )
            );

            /* ---- Settings panel ---- */
            const Panel = el('div', { className: 'frm-settings-panel' },

                /* Tab Bar */
                el('div', { className: 'frm-settings-tabs' },
                    [
                        { id: 'content',  icon: '☰', label: 'Content'  },
                        { id: 'style',    icon: '🎨', label: 'Style'    },
                        { id: 'advanced', icon: '⚙',  label: 'Advanced' },
                    ].map(tab =>
                        el('button', {
                            key: tab.id,
                            type: 'button',
                            className: `frm-tab-btn ${activeTab === tab.id ? 'is-active' : ''}`,
                            onClick: () => setActiveTab(tab.id),
                        },
                            el('span', { className: 'frm-tab-icon' }, tab.icon),
                            el('span', null, tab.label)
                        )
                    )
                ),

                /* ===================== CONTENT TAB ===================== */
                activeTab === 'content' && el('div', { className: 'frm-tab-pane' },
                    SectionLabel('Accordion Items'),
                    items.map((item, index) =>
                        el(SettingsGroup, { key: index, title: item.title || `Item ${index + 1}`, defaultOpen: index === 0 },
                            el('div', { className: 'frm-field' },
                                el('label', { className: 'frm-label' }, 'Title'),
                                el('input', {
                                    type: 'text',
                                    className: 'frm-input',
                                    value: item.title,
                                    onChange: (e) => updateItem(index, 'title', e.target.value),
                                }),
                            ),
                            el('div', { className: 'frm-field' },
                                el('label', { className: 'frm-label' }, 'Content'),
                                el('textarea', {
                                    className: 'frm-textarea',
                                    rows: 4,
                                    value: item.content,
                                    onChange: (e) => updateItem(index, 'content', e.target.value),
                                }),
                            ),
                            el('div', { className: 'frm-field' },
                                el('label', { className: 'frm-label' }, 'Custom Icon (emoji)'),
                                el('input', {
                                    type: 'text',
                                    className: 'frm-input',
                                    value: item.icon || '',
                                    placeholder: '✦  or leave empty',
                                    onChange: (e) => updateItem(index, 'icon', e.target.value),
                                }),
                            ),
                            el('div', { className: 'frm-control-row frm-toggle-row' },
                                el('span', { className: 'frm-control-label' }, 'Open by default'),
                                el('div', { className: 'frm-toggle-wrap' },
                                    el('input', { type: 'checkbox', id: `itm-open-${clientId}-${index}`, checked: !!item.open, onChange: (e) => updateItem(index, 'open', e.target.checked), className: 'frm-checkbox' }),
                                    el('label', { htmlFor: `itm-open-${clientId}-${index}`, className: 'frm-toggle-label' }),
                                )
                            ),
                            el('div', { className: 'frm-item-actions' },
                                el('button', { type: 'button', className: 'frm-action-btn', disabled: index === 0, onClick: () => moveItem(index, -1) }, '↑ Up'),
                                el('button', { type: 'button', className: 'frm-action-btn', disabled: index === items.length - 1, onClick: () => moveItem(index, 1) }, '↓ Down'),
                                el('button', { type: 'button', className: 'frm-action-btn frm-action-btn--danger', disabled: items.length <= 1, onClick: () => removeItem(index) }, '✕ Remove'),
                            ),
                        )
                    ),
                    el('button', { type: 'button', className: 'frm-add-item-btn', onClick: addItem }, '+ Add Item'),
                    el('hr', { className: 'frm-divider' }),
                    SectionLabel('Behaviour'),
                    ToggleRow({ label: 'Allow Multiple Open', attrKey: 'allowMultiple' }),
                    ToggleRow({ label: 'Expand All by Default', attrKey: 'defaultOpenAll' }),
                ),

                /* ===================== STYLE TAB ===================== */
                activeTab === 'style' && el('div', { className: 'frm-tab-pane' },

                    el(SettingsGroup, { title: '📐 Layout', defaultOpen: true },
                        el('div', { className: 'frm-control-row' },
                            el('span', { className: 'frm-control-label' }, 'Style'),
                            el('select', { className: 'frm-select', value: accordionStyle, onChange: (e) => set('accordionStyle')(e.target.value) },
                                el('option', { value: 'default'  }, 'Default'),
                                el('option', { value: 'bordered' }, 'Bordered (separated)'),
                                el('option', { value: 'minimal'  }, 'Minimal (lines only)'),
                                el('option', { value: 'shadow'   }, 'Shadow Cards'),
                            )
                        ),
                        SliderRow({ label: 'Item Spacing', value: itemSpacing, min: 0, max: 40, onChange: set('itemSpacing') }),
                        SliderRow({ label: 'Border Radius', value: borderRadius, min: 0, max: 40, onChange: set('borderRadius') }),
                        SliderRow({ label: 'Border Width', value: borderWidth, min: 0, max: 8, onChange: set('borderWidth') }),
                        ColorRow({ label: 'Border Color', value: borderColor, onChange: set('borderColor') }),
                    ),

                    el(SettingsGroup, { title: '🔷 Header', defaultOpen: true },
                        SectionLabel('HTML Tag'),
                        el('div', { className: 'frm-control-row' },
                            el('span', { className: 'frm-control-label' }, 'Heading Tag'),
                            el('select', {
                                className: 'frm-select frm-segmented-select',
                                value: headerTag || 'button',
                                onChange: (e) => set('headerTag')(e.target.value),
                            },
                                ['button','h2','h3','h4','h5','p'].map(tag =>
                                    el('option', { key: tag, value: tag }, tag)
                                )
                            )
                        ),
                        el('hr', { className: 'frm-inner-divider' }),
                        SectionLabel('Colors'),
                        ColorRow({ label: 'Background',          value: headerBg,          onChange: set('headerBg') }),
                        ColorRow({ label: 'Background (Active)', value: headerBgActive,     onChange: set('headerBgActive') }),
                        ColorRow({ label: 'Text Color',          value: headerColor,        onChange: set('headerColor') }),
                        ColorRow({ label: 'Text Color (Active)', value: headerColorActive,  onChange: set('headerColorActive') }),
                        el('hr', { className: 'frm-inner-divider' }),
                        SectionLabel('Typography'),
                        el(TypographyGroup, { value: headerTypography, onChange: set('headerTypography') }),
                        el('hr', { className: 'frm-inner-divider' }),
                        SectionLabel('Padding'),
                        el(DimensionsRow, { label: 'Padding', value: headerPadding, onChange: set('headerPadding') }),
                    ),

                    el(SettingsGroup, { title: '📄 Content', defaultOpen: false },
                        SectionLabel('Colors'),
                        ColorRow({ label: 'Background', value: contentBg,    onChange: set('contentBg') }),
                        ColorRow({ label: 'Text Color', value: contentColor, onChange: set('contentColor') }),
                        el('hr', { className: 'frm-inner-divider' }),
                        SectionLabel('Typography'),
                        el(TypographyGroup, { value: contentTypography, onChange: set('contentTypography') }),
                        el('hr', { className: 'frm-inner-divider' }),
                        SectionLabel('Padding'),
                        el(DimensionsRow, { label: 'Padding', value: contentPadding, onChange: set('contentPadding') }),
                    ),

                    el(SettingsGroup, { title: '🔘 Toggle Icon', defaultOpen: false },

                        /* Icon type toggle: SVG built-in vs Dashicon */
                        SectionLabel('Icon Source'),
                        SegmentedRow({
                            label: 'Source',
                            value: iconType || 'svg',
                            options: [
                                { value: 'svg',      icon: 'SVG',      label: 'Built-in SVG'  },
                                { value: 'dashicon', icon: 'Dash',     label: 'Dashicon'       },
                                { value: 'none',     icon: 'None',     label: 'No Icon'        },
                            ],
                            onChange: set('iconType'),
                        }),

                        /* SVG style picker */
                        (iconType || 'svg') === 'svg' && el('div', null,
                            el('hr', { className: 'frm-inner-divider' }),
                            SectionLabel('SVG Style'),
                            SegmentedRow({
                                label: 'Shape',
                                value: iconStyle,
                                options: [
                                    { value: 'plus',    icon: '＋', label: 'Plus'    },
                                    { value: 'arrow',   icon: '▾',  label: 'Arrow'   },
                                    { value: 'chevron', icon: '›',  label: 'Chevron' },
                                ],
                                onChange: set('iconStyle'),
                            }),
                        ),

                        /* Dashicon picker */
                        (iconType || 'svg') === 'dashicon' && el('div', null,
                            el('hr', { className: 'frm-inner-divider' }),
                            SectionLabel('Closed State Icon'),
                            el(DashiconPicker, { value: iconDashicon || 'arrow-down-alt2', onChange: set('iconDashicon') }),
                            el('hr', { className: 'frm-inner-divider' }),
                            SectionLabel('Open State Icon'),
                            el(DashiconPicker, { value: iconDashiconActive || 'arrow-up-alt2', onChange: set('iconDashiconActive') }),
                        ),

                        el('hr', { className: 'frm-inner-divider' }),
                        SectionLabel('Icon Layout'),
                        SegmentedRow({
                            label: 'Position',
                            value: iconPosition,
                            options: [
                                { value: 'left',  icon: '◁●', label: 'Left'  },
                                { value: 'right', icon: '●▷', label: 'Right' },
                            ],
                            onChange: set('iconPosition'),
                        }),
                        ColorRow({ label: 'Icon Color',          value: iconColor,        onChange: set('iconColor') }),
                        ColorRow({ label: 'Icon Color (Active)', value: iconColorActive,  onChange: set('iconColorActive') }),
                        SliderRow({ label: 'Icon Size', value: iconSize, min: 8, max: 48, onChange: set('iconSize') }),
                    ),
                ),

                /* ===================== ADVANCED TAB ===================== */
                activeTab === 'advanced' && el('div', { className: 'frm-tab-pane' },

                    el(SettingsGroup, { title: '📦 Layout', defaultOpen: true },
                        el(DimensionsRow, { label: 'Margin',  value: marginBlock,  onChange: set('marginBlock') }),
                        el(DimensionsRow, { label: 'Padding', value: paddingBlock, onChange: set('paddingBlock') }),
                        SliderRow({ label: 'Z-Index', value: zIndex, min: 0, max: 999, unit: '', onChange: set('zIndex') }),
                    ),

                    el(SettingsGroup, { title: '✨ Motion Effects', defaultOpen: false },
                        el('div', { className: 'frm-control-row' },
                            el('span', { className: 'frm-control-label' }, 'Entrance Animation'),
                            el('select', { className: 'frm-select', value: motionEffect, onChange: (e) => set('motionEffect')(e.target.value) },
                                el('option', { value: 'none'      }, 'None'       ),
                                el('option', { value: 'fade'      }, 'Fade In'    ),
                                el('option', { value: 'slideUp'   }, 'Slide Up'   ),
                                el('option', { value: 'slideDown' }, 'Slide Down' ),
                                el('option', { value: 'zoomIn'    }, 'Zoom In'    ),
                            )
                        ),
                        SliderRow({ label: 'Transition Speed', value: cssTransitionMs, min: 100, max: 1000, step: 50, unit: 'ms', onChange: set('cssTransitionMs') }),
                    ),

                    el(SettingsGroup, { title: '👁 Responsive Visibility', defaultOpen: false },
                        ToggleRow({ label: '🖥 Hide on Desktop', attrKey: 'hideOnDesktop' }),
                        ToggleRow({ label: '📱 Hide on Tablet',  attrKey: 'hideOnTablet'  }),
                        ToggleRow({ label: '📲 Hide on Mobile',  attrKey: 'hideOnMobile'  }),
                    ),

                    el(SettingsGroup, { title: '🏷 Attributes', defaultOpen: false },
                        el('div', { className: 'frm-field' },
                            el('label', { className: 'frm-label' }, 'CSS ID'),
                            el('input', { type: 'text', className: 'frm-input', value: customId, placeholder: 'my-accordion', onChange: (e) => set('customId')(e.target.value) }),
                            el('span', { className: 'frm-help' }, 'Custom HTML ID for the wrapper.'),
                        ),
                        el('div', { className: 'frm-field' },
                            el('label', { className: 'frm-label' }, 'CSS Classes'),
                            el('input', { type: 'text', className: 'frm-input', value: customClass, placeholder: 'my-class other-class', onChange: (e) => set('customClass')(e.target.value) }),
                            el('span', { className: 'frm-help' }, 'Space-separated extra class names.'),
                        ),
                    ),
                ),
            ); // end Panel

            /* ---- Canvas live preview ---- */
            const renderIcon = (isActive) => {
                const color = isActive ? iconColorActive : iconColor;
                const type = iconType || 'svg';
                if (type === 'none') return null;
                if (type === 'dashicon') {
                    const slug = isActive ? (iconDashiconActive || 'arrow-up-alt2') : (iconDashicon || 'arrow-down-alt2');
                    return el('span', {
                        className: `dashicons dashicons-${slug}`,
                        style: { fontSize: iconSize, width: iconSize, height: iconSize, color, flexShrink: 0, lineHeight: 1, display: 'flex', alignItems: 'center' },
                    });
                }
                const rotate = isActive ? (iconStyle === 'plus' ? 'rotate(45deg)' : 'rotate(180deg)') : 'none';
                const paths = { plus: 'M8 3v10M3 8h10', arrow: 'M4 6l4 4 4-4', chevron: 'M3 5.5l5 5 5-5' };
                return el('svg', { width: iconSize, height: iconSize, viewBox: '0 0 16 16', fill: 'none', style: { transition: `transform ${cssTransitionMs}ms ease`, transform: rotate, flexShrink: 0 } },
                    el('path', { d: paths[iconStyle] || paths.plus, stroke: color, strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' })
                );
            };

            const wrapStyle = {
                border: accordionStyle !== 'minimal' ? `${borderWidth}px solid ${borderColor}` : 'none',
                borderRadius: accordionStyle !== 'bordered' ? `${borderRadius}px` : 0,
                overflow: accordionStyle === 'bordered' ? 'visible' : 'hidden',
                marginTop: `${(marginBlock||{}).top||0}px`, marginRight: `${(marginBlock||{}).right||0}px`,
                marginBottom: `${(marginBlock||{}).bottom||0}px`, marginLeft: `${(marginBlock||{}).left||0}px`,
                paddingTop: `${(paddingBlock||{}).top||0}px`, paddingRight: `${(paddingBlock||{}).right||0}px`,
                paddingBottom: `${(paddingBlock||{}).bottom||0}px`, paddingLeft: `${(paddingBlock||{}).left||0}px`,
            };

            return el(Fragment, null,
                el(InspectorControls, null, Panel),
                el('div', { ...blockProps },
                    el('div', { style: wrapStyle },
                        items.map((item, index) => {
                            const isOpen = openIndex === index;
                            const hp = headerPadding || { top: 16, right: 20, bottom: 16, left: 20 };
                            const cp = contentPadding || { top: 16, right: 20, bottom: 16, left: 20 };
                            const ht = headerTypography || {};
                            const ct = contentTypography || {};

                            const headerStyle = {
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexDirection: iconPosition === 'left' ? 'row-reverse' : 'row',
                                gap: 8,
                                padding: `${hp.top}px ${hp.right}px ${hp.bottom}px ${hp.left}px`,
                                background: isOpen ? headerBgActive : (accordionStyle === 'minimal' ? 'transparent' : headerBg),
                                color: isOpen ? headerColorActive : headerColor,
                                fontSize: `${ht.fontSize||15}px`,
                                fontWeight: ht.fontWeight || '600',
                                lineHeight: ht.lineHeight || 1.5,
                                letterSpacing: `${ht.letterSpacing||0}px`,
                                textTransform: ht.textTransform || 'none',
                                cursor: 'pointer',
                                border: 'none',
                                width: '100%',
                                textAlign: 'left',
                                borderBottom: `${borderWidth}px solid ${borderColor}`,
                            };

                            const contentStyle = {
                                background: contentBg,
                                color: contentColor,
                                fontSize: `${ct.fontSize||14}px`,
                                fontWeight: ct.fontWeight || '400',
                                lineHeight: ct.lineHeight || 1.7,
                                letterSpacing: `${ct.letterSpacing||0}px`,
                                textTransform: ct.textTransform || 'none',
                                padding: isOpen ? `${cp.top}px ${cp.right}px ${cp.bottom}px ${cp.left}px` : `0 ${cp.right}px`,
                                maxHeight: isOpen ? '1200px' : '0',
                                overflow: 'hidden',
                                transition: `max-height ${cssTransitionMs}ms ease, padding ${cssTransitionMs}ms ease`,
                            };

                            const itemStyle = accordionStyle === 'bordered' || accordionStyle === 'shadow' ? {
                                border: `${borderWidth}px solid ${borderColor}`,
                                borderRadius: `${borderRadius}px`,
                                overflow: 'hidden',
                                marginBottom: `${itemSpacing}px`,
                                boxShadow: accordionStyle === 'shadow' ? '0 2px 14px rgba(0,0,0,0.07)' : 'none',
                            } : {
                                marginBottom: `${itemSpacing}px`,
                                borderTop: index > 0 ? `${borderWidth}px solid ${borderColor}` : 'none',
                            };

                            // Button always used in canvas (heading tag is frontend-only)
                            return el('div', { key: index, style: itemStyle },
                                el('button', { type: 'button', style: headerStyle, onClick: () => setOpenIndex(isOpen ? -1 : index) },
                                    el('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                                        item.icon && el('span', null, item.icon),
                                        item.title || `Item ${index + 1}`,
                                    ),
                                    renderIcon(isOpen),
                                ),
                                el('div', { style: contentStyle }, item.content),
                            );
                        })
                    )
                )
            );
        },

        save: () => null,
    });

    /* ============================================================
       FRAMIFY SIDEBAR — Widget Panel
    ============================================================ */
    registerPlugin('framify-widget-panel', {
        render: function FramifySidebarPlugin() {
            const [search, setSearch] = useState('');
            const [notice, setNotice] = useState(null);

            const widgets = [
                {
                    id: 'accordion',
                    label: 'Accordion',
                    description: 'Collapsible content panels',
                    icon: el('svg', { width: 28, height: 28, viewBox: '0 0 28 28', fill: 'none' },
                        el('rect', { x: 2, y: 3, width: 24, height: 6, rx: 2, fill: '#667eea' }),
                        el('rect', { x: 2, y: 11, width: 24, height: 6, rx: 2, fill: '#667eea', opacity: 0.5 }),
                        el('rect', { x: 2, y: 19, width: 24, height: 6, rx: 2, fill: '#667eea', opacity: 0.25 })
                    ),
                    block: '<!-- wp:framify/accordion /-->',
                    category: 'Content',
                },
            ];

            const categories = [...new Set(widgets.map(w => w.category))];
            const filtered = widgets.filter(w =>
                w.label.toLowerCase().includes(search.toLowerCase()) ||
                w.description.toLowerCase().includes(search.toLowerCase())
            );

            const handleInsert = (widget) => {
                const { insertBlocks } = wp.data.dispatch('core/block-editor');
                const blocks = wp.blocks.parse(widget.block);
                insertBlocks(blocks);
                setNotice(`✓ ${widget.label} inserted!`);
                setTimeout(() => setNotice(null), 2500);
            };

            return el(Fragment, null,
                el(PluginSidebarMoreMenuItem, { target: 'framify-widget-panel' }, '✦ Framify Widgets'),
                el(PluginSidebar, {
                    name: 'framify-widget-panel',
                    title: '✦ Framify',
                    className: 'framify-sidebar',
                    icon: el('svg', { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none' },
                        el('rect', { x: 1, y: 2, width: 18, height: 4, rx: 1.5, fill: 'currentColor' }),
                        el('rect', { x: 1, y: 8, width: 18, height: 4, rx: 1.5, fill: 'currentColor', opacity: 0.6 }),
                        el('rect', { x: 1, y: 14, width: 18, height: 4, rx: 1.5, fill: 'currentColor', opacity: 0.3 })
                    ),
                },
                    el('div', { className: 'framify-sidebar__inner' },
                        el('div', { className: 'framify-sidebar__header' },
                            el('div', { className: 'framify-sidebar__logo' },
                                el('svg', { width: 22, height: 22, viewBox: '0 0 22 22', fill: 'none' },
                                    el('rect', { x: 1, y: 2, width: 20, height: 5, rx: 2, fill: '#fff' }),
                                    el('rect', { x: 1, y: 9, width: 20, height: 5, rx: 2, fill: '#fff', opacity: 0.65 }),
                                    el('rect', { x: 1, y: 16, width: 20, height: 5, rx: 2, fill: '#fff', opacity: 0.35 })
                                ),
                                el('span', null, 'Framify Widgets'),
                            ),
                            el('p', { className: 'framify-sidebar__subtitle' }, 'Click a widget to insert'),
                        ),
                        el('div', { className: 'framify-sidebar__search' },
                            el('input', { type: 'text', placeholder: '🔍 Search widgets...', value: search, onChange: (e) => setSearch(e.target.value), className: 'framify-sidebar__search-input' })
                        ),
                        notice && el('div', { className: 'framify-sidebar__notice' }, notice),
                        categories.map(cat =>
                            el('div', { key: cat, className: 'framify-sidebar__category' },
                                el('div', { className: 'framify-sidebar__cat-label' }, cat),
                                el('div', { className: 'framify-sidebar__grid' },
                                    filtered.filter(w => w.category === cat).map(widget =>
                                        el(Draggable, {
                                            key: widget.id,
                                            elementId: `framify-widget-${widget.id}`,
                                            transferData: { type: 'inserter', blocks: wp.blocks.parse(widget.block) },
                                        },
                                            ({ onDraggableStart, onDraggableEnd }) =>
                                                el('div', {
                                                    id: `framify-widget-${widget.id}`,
                                                    className: 'framify-widget-card',
                                                    draggable: true,
                                                    onDragStart: onDraggableStart,
                                                    onDragEnd: onDraggableEnd,
                                                    onClick: () => handleInsert(widget),
                                                },
                                                    el('div', { className: 'framify-widget-card__icon' }, widget.icon),
                                                    el('div', { className: 'framify-widget-card__info' },
                                                        el('span', { className: 'framify-widget-card__label' }, widget.label),
                                                        el('span', { className: 'framify-widget-card__desc' }, widget.description),
                                                    ),
                                                    el('div', { className: 'framify-widget-card__add' }, '+'),
                                                )
                                        )
                                    )
                                )
                            )
                        ),
                        filtered.length === 0 && el('div', { className: 'framify-sidebar__empty' },
                            el('span', null, '🔍'),
                            el('p', null, `No widgets found for "${search}"`)
                        ),
                        el('div', { className: 'framify-sidebar__footer' }, 'More widgets coming soon ✦'),
                    )
                )
            );
        }
    });

})();