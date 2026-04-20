/**
 * Slash Command Data Source
 * エディタおよびプレビューのスラッシュコマンドで共通して使用するメニュー項目の定義
 */

function getSlashCommandItems(locale) {
    const t = typeof I18n !== 'undefined' ? I18n.translate : (k => k);

    // テンプレートの取得ヘルパー
    function getTemplates(source, templatesObj) {
        if (!templatesObj || !templatesObj[locale]) return [];
        return templatesObj[locale].map(tmpl => ({
            label: tmpl.title,
            action: 'insert-template',
            templateId: tmpl.id,
            source: source,
            type: 'template',
            // 検索・絞り込み用キーワード
            keywords: ['template', 'テンプレート', source, tmpl.title.toLowerCase()]
        }));
    }

    const mdTemplates = getTemplates('md', typeof MD_TEMPLATES !== 'undefined' ? MD_TEMPLATES : null);
    const svgTemplates = getTemplates('svg', typeof SVG_TEMPLATES !== 'undefined' ? SVG_TEMPLATES : null);
    const mermaidTemplates = getTemplates('mermaid', typeof MERMAID_TEMPLATES !== 'undefined' ? MERMAID_TEMPLATES : null);

    const items = [
        { label: t('contextMenuEditor.heading1') || '見出し1', action: 'insert', value: '# ', type: 'heading', keywords: ['h1', 'heading1', '見出し1', 'みだし1'] },
        { label: t('contextMenuEditor.heading2') || '見出し2', action: 'insert', value: '## ', type: 'heading', keywords: ['h2', 'heading2', '見出し2', 'みだし2'] },
        { label: t('contextMenuEditor.heading3') || '見出し3', action: 'insert', value: '### ', type: 'heading', keywords: ['h3', 'heading3', '見出し3', 'みだし3'] },
        { label: t('contextMenuEditor.heading4') || '見出し4', action: 'insert', value: '#### ', type: 'heading', keywords: ['h4', 'heading4', '見出し4', 'みだし4'] },
        { label: t('contextMenuEditor.heading5') || '見出し5', action: 'insert', value: '##### ', type: 'heading', keywords: ['h5', 'heading5', '見出し5', 'みだし5'] },
        { label: t('contextMenuEditor.heading6') || '見出し6', action: 'insert', value: '###### ', type: 'heading', keywords: ['h6', 'heading6', '見出し6', 'みだし6'] },
        
        { label: t('contextMenuEditor.bulletList') || '箇条書き', action: 'insert', value: '- ', type: 'list', keywords: ['list', 'ul', 'bullet', '箇条書き', 'かじょうがき', 'リスト'] },
        { label: t('contextMenuEditor.numberList') || '番号付きリスト', action: 'insert', value: '1. ', type: 'list', keywords: ['list', 'ol', 'number', '番号付き', 'ばんごうつき', 'リスト'] },
        { label: t('contextMenuEditor.taskUnchecked') || 'タスク (未完了)', action: 'insert', value: '- [ ] ', type: 'list', keywords: ['task', 'todo', 'タスク', 'チェックボックス'] },
        { label: t('contextMenuEditor.taskChecked') || 'タスク (完了)', action: 'insert', value: '- [x] ', type: 'list', keywords: ['task', 'done', 'タスク', 'チェックボックス'] },

        { label: t('contextMenuEditor.codeBlock') || 'コードブロック', action: 'insert', value: '```\n\n```', type: 'block', keywords: ['code', 'block', 'コードブロック'] },
        { label: t('contextMenuEditor.hr_') || '水平線', action: 'insert', value: '\n---\n', type: 'block', keywords: ['hr', 'line', 'divider', '水平線', 'すいへいせん', '区切り'] },
        
        { label: t('contextMenuEditor.table2Col') || 'テーブル (2列)', action: 'insert', value: '\n\n| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n', type: 'table', keywords: ['table', 'テーブル', '表', '2col'] },
        { label: t('contextMenuEditor.table3Col') || 'テーブル (3列)', action: 'insert', value: '\n\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |\n', type: 'table', keywords: ['table', 'テーブル', '表', '3col'] },

        { label: t('contextMenuEditor.fileLink') || 'ファイルリンク', action: 'insert', value: '[リンクテキスト](url)', type: 'inline', keywords: ['link', 'リンク', 'a', 'file'] },
        { label: t('contextMenuEditor.imageLink') || '画像リンク', action: 'insert', value: '![画像タイトル](image.png)', type: 'inline', keywords: ['image', '画像', 'がぞう', 'img'] },

        { label: t('contextMenuEditor.tocAll') || '目次 (全て)', action: 'insert-toc', level: 6, type: 'toc', keywords: ['toc', '目次', 'もくじ', 'all'] },
        { label: t('contextMenuEditor.tocLv2') || '目次 (Lv2まで)', action: 'insert-toc', level: 2, type: 'toc', keywords: ['toc', '目次', 'もくじ', 'lv2'] }
    ];

    return [...items, ...mdTemplates, ...svgTemplates, ...mermaidTemplates];
}

window.getSlashCommandItems = getSlashCommandItems;
