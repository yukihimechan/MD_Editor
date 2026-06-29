/**
 * HTMLエクスポート機能
 */

function exportHTMLFile() {
    if (!DOM.preview) return;

    // 現在のプレビューのHTMLを取得
    const previewClone = DOM.preview.cloneNode(true);

    // 編集用UIボタンをHTMLに強制追加するロジックを削除

    // [Bug Fix] input, select, textarea の入力値をクローン側(HTML属性)に反映させる
    const originalInputs = DOM.preview.querySelectorAll('input, select, textarea');
    const clonedInputs = previewClone.querySelectorAll('input, select, textarea');
    originalInputs.forEach((input, index) => {
        if (clonedInputs[index]) {
            if (input.type === 'checkbox' || input.type === 'radio') {
                if (input.checked) clonedInputs[index].setAttribute('checked', 'checked');
                else clonedInputs[index].removeAttribute('checked');
            } else if (input.tagName === 'SELECT') {
                // [FIX] ドロップダウン(select)の選択状態をoption属性として反映
                const options = input.querySelectorAll('option');
                const clonedOptions = clonedInputs[index].querySelectorAll('option');
                options.forEach((opt, optIdx) => {
                    if (clonedOptions[optIdx]) {
                        if (opt.selected) clonedOptions[optIdx].setAttribute('selected', 'selected');
                        else clonedOptions[optIdx].removeAttribute('selected');
                    }
                });
            } else {
                clonedInputs[index].setAttribute('value', input.value || '');
                if (input.tagName === 'TEXTAREA') {
                    clonedInputs[index].textContent = input.value || '';
                }
            }
        }
    });

    // 余分なUI要素や編集用の枠を完全に削除
    previewClone.querySelectorAll('.code-controls, .svg_select_handle, .svg_select_shape, .svg-canvas-proxy, .svg-editor-action-btn, #svg-editor-done-btn, #svg-editor-expand-btn, #table-editor-done-btn, .btn-unwrap-svg, .btn-save-svg, .btn-wrap-svg, .btn-save-mermaid, .btn-expand-mermaid, .copy-btn, .code-edit-btn, .language-label, .drag-handle, .dummy-height-block, .table-row-resizer, .table-col-resizer, .column-resize-handle, .row-resize-handle').forEach(el => el.remove());
    
    // 編集中のクラス名（緑の点線枠など）を削除
    previewClone.querySelectorAll('.svg-editing, .table-editing').forEach(el => {
        el.classList.remove('svg-editing', 'table-editing');
    });

    // 内部用のカスタム要素を削除
    previewClone.querySelectorAll('connector-data').forEach(el => el.remove());

    // [FIX] アニメーションの再生状態をクリーンアップ（エディタでステップ再生した後の残留状態を除去）
    previewClone.querySelectorAll('.anim-step-active').forEach(el => {
        el.classList.remove('anim-step-active');
    });
    previewClone.querySelectorAll('[data-anim-current-index]').forEach(el => {
        el.removeAttribute('data-anim-current-index');
    });
    previewClone.querySelectorAll('[data-current-step-index]').forEach(el => {
        el.removeAttribute('data-current-step-index');
    });

    const contentHtml = previewClone.innerHTML;

    // アニメーション制御用のCSSを取得
    let svgGlobalOverridesCss = '';
    const overridesTag = document.getElementById('svg-global-overrides');
    if (overridesTag) {
        svgGlobalOverridesCss = overridesTag.textContent;
    }

    // ステップ再生用スクリプト
    const stepAnimationScript = '<script>\n' + `
document.addEventListener('keydown', function(e) {
    if (e.code === 'Space') {
        var svgs = document.querySelectorAll('svg[data-anim-sequence-mode="step"]');
        var played = false;
        for (var s = 0; s < svgs.length; s++) {
            var svg = svgs[s];
            var seqStr = svg.getAttribute('data-anim-sequence');
            if (!seqStr) continue;
            var seq = [];
            try { seq = JSON.parse(seqStr); } catch (err) { continue; }
            
            var currentIndex = parseInt(svg.getAttribute('data-anim-current-index') || '0', 10);
            
            if (currentIndex < seq.length) {
                e.preventDefault();
                var entry = seq[currentIndex];
                // 新フォーマット({id, step})と旧フォーマット(文字列)の両方に対応
                var targetId = typeof entry === 'object' ? entry.id : entry;
                var targetStep = typeof entry === 'object' ? (entry.step || 1) : 1;
                var targetNode = svg.querySelector('[id="' + targetId + '"]');
                if (targetNode) {
                    var curr = targetNode;
                    while (curr && curr.tagName && curr.tagName.toLowerCase() !== 'svg') {
                        var classes = curr.getAttribute('class') || '';
                        if (classes.indexOf('anim-wrapper-') >= 0 && classes.indexOf('anim-wrapper-motion') < 0) {
                            var wrapperStep = parseInt(curr.getAttribute('data-anim-step') || '1', 10);
                            if (wrapperStep === targetStep) {
                                curr.classList.remove('anim-step-active');
                                var animName = curr.getAttribute('data-anim-name');
                                var dur = curr.getAttribute('data-anim-dur') || '1';
                                var easing = curr.getAttribute('data-anim-easing') || 'ease-in-out';
                                var repeat = curr.getAttribute('data-anim-repeat') || '1';
                                curr.style.animation = 'none';
                                void curr.getBoundingClientRect();
                                curr.style.animation = animName + ' ' + dur + 's ' + easing + ' 0s ' + repeat + ' normal both';
                                curr.classList.add('anim-step-active');
                            }
                        }
                        curr = curr.parentNode;
                    }
                }
                svg.setAttribute('data-anim-current-index', (currentIndex + 1).toString());
                played = true;
                
                // 要素が見える位置にスクロール
                var rect = svg.getBoundingClientRect();
                if (rect.top < 0 || rect.bottom > window.innerHeight) {
                    svg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                break;
            }
        }
    }
});
` + '</' + 'script>\n';

    // 完全なHTMLファイルとしてのガワを作成
    const htmlTemplate = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exported Document</title>
    <!-- エディタ標準のスタイルシート -->
    <style>
        ${svgGlobalOverridesCss}
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #333;
            background-color: #fff;
        }
        
        .md-preview {
            max-width: 820px;
            margin: 0 auto;
            line-height: var(--line-height, 1.6);
            font-size: var(--font-size, 16px);
        }

        /* ----- 基本的なMarkdownスタイル ----- */
        .md-preview h1, .md-preview h2, .md-preview h3, .md-preview h4, .md-preview h5, .md-preview h6 {
            color: #24292e;
            font-weight: 600;
            line-height: 1.25;
            margin-top: 24px;
            margin-bottom: 16px;
        }
        .md-preview h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
        .md-preview h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
        .md-preview h3 { font-size: 1.25em; }
        .md-preview p { margin-top: 0; margin-bottom: 16px; }
        .md-preview blockquote {
            padding: 0 1em;
            color: #6a737d;
            border-left: .25em solid #dfe2e5;
            margin: 0 0 16px 0;
        }
        .md-preview ul, .md-preview ol { padding-left: 2em; margin-top: 0; margin-bottom: 16px; }
        .md-preview table {
            border-spacing: 0;
            border-collapse: collapse;
            margin-bottom: 16px;
            width: 100%;
        }
        .md-preview table th, .md-preview table td {
            padding: 6px 13px;
            border: 1px solid #dfe2e5;
        }
        .md-preview table tr:nth-child(2n) { background-color: #f6f8fa; }
        
        /* インラインコードとコードブロック */
        .md-preview code {
            padding: .2em .4em;
            margin: 0;
            font-size: 85%;
            background-color: rgba(27,31,35,.05);
            border-radius: 3px;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
        }
        .md-preview pre {
            word-wrap: normal;
            background-color: #f6f8fa;
            border-radius: 3px;
            padding: 16px;
            overflow: auto;
            font-size: 85%;
            line-height: 1.45;
        }
        .md-preview pre code {
            background-color: transparent;
            padding: 0;
            font-size: 100%;
        }

        /* ----- SVGエディタ固有のスタイル ----- */
        .svg-view-wrapper {
            position: relative;
            display: inline-block;
            margin: 10px 0;
            box-sizing: border-box;
        }
        
        /* 編集中の緑点線枠 */
        .svg-editing {
            outline: 2px dashed #4CAF50 !important;
            background-color: rgba(76, 175, 80, 0.05);
        }
        
        /* キャンバスプロキシ（グリッド等）の表示維持 */
        .svg-canvas-proxy {
            pointer-events: none;
        }

        /* 折り畳みの▼マーカーを非表示 */
        details > summary {
            list-style: none;
        }
        details > summary::-webkit-details-marker {
            display: none;
        }
        
        /* ハンドル等のCSS（選択された枠線など） */
        .svg_select_handle {
            stroke-width: 1px;
            stroke: #fff;
            fill: #007bff;
            vector-effect: non-scaling-stroke;
        }
        rect.svg_select_handle {
            width: 8px;
            height: 8px;
        }
        circle.svg_select_handle {
            r: 5px;
        }
        .svg_select_handle_rot circle {
            fill: #007bff;
            stroke: #fff;
            stroke-width: 1px;
        }
        .svg_select_handle_rot line {
            stroke: #007bff;
            stroke-width: 1px;
        }
        
        /* 選択枠のアウトライン (これが無いとデフォルトで黒塗りになる) */
        .svg_select_shape {
            stroke: none;
            fill: none;
            pointer-events: none;
        }

        /* 完了・拡大画面ボタンのスタイル */
        .inline-done-btn {
            background-color: #28a745;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 4px 12px;
            font-size: 12px;
            cursor: pointer;
            z-index: 101;
            display: block;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        .inline-done-btn:hover {
            background-color: #218838;
        }
        
        /* コードブロックおよびSVGのアクションボタン群のスタイル（コピー、編集等） */
        .code-block-wrapper, .svg-view-wrapper {
            position: relative;
        }
        .copy-btn, .code-edit-btn, .language-label {
            position: absolute;
            top: 6px;
            padding: 4px 8px;
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 11px;
            color: #555;
            cursor: pointer;
            z-index: 5;
            display: inline-block;
        }
        .copy-btn {
            right: 6px;
        }
        .code-edit-btn {
            right: 60px;
        }
        .language-label {
            right: 120px;
            pointer-events: none;
            border-color: transparent;
        }
        .copy-btn:hover, .code-edit-btn:hover {
            background: #f0f0f0;
            color: #333;
        }
    </style>
</head>
<body>
    <div id="preview" class="md-preview playing-sequence">
        ${contentHtml}
    </div>
    ${stepAnimationScript}
</body>
</html>`;

    // Blobを作成してダウンロードリンクを発火
    const blob = new Blob([htmlTemplate], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;

    // ダウンロードファイル名の生成 (yyyyMMdd_HHmmss.html)
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const filename = `export_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.html`;

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);

    if (typeof showToast === 'function') {
        showToast(`HTMLファイル("${filename}")をエクスポートしました`);
    }
}
