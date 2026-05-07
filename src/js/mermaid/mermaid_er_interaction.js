/**
 * MermaidErInteraction - クラス図におけるインタラクション
 */

window.MermaidErInteraction = {
    
    initDiagram(diagramContainer, originalCode) {
        if (!diagramContainer) return;
        
        const svg = diagramContainer.querySelector('svg');
        if (!svg) return;

        // 選択されたクラスIDや矢印IDを保持（すでに存在する場合は引き継ぐ）
        const selectedNodes = diagramContainer._selectedNodes || new Set();
        let _clipboard = null;

        // コンテキストメニューやショートカットから呼び出せるAPIを登録
        diagramContainer._mermaidAPI = {
            deleteSelection: () => {
                if (selectedNodes.size === 0) return;
                
                if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;
                let dataLine = parseInt(diagramContainer.getAttribute('data-line'), 10);
                if (!dataLine || isNaN(dataLine)) {
                    const cbw = diagramContainer.closest('.code-block-wrapper');
                    if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
                }
                if (!dataLine || isNaN(dataLine)) return;

                const lines = getEditorText().split('\n');
                const startIdx = dataLine - 1;
                const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
                let endIdx = -1;
                for (let i = startIdx + 1; i < lines.length; i++) {
                    if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
                }
                if (endIdx === -1) return;

                const newLines = [];
                let insideDeletedBlock = false;
                
                for (let i = startIdx + 1; i < endIdx; i++) {
                    const line = lines[i];
                    
                    // 削除対象のブロック内か？
                    let isBlockStart = false;
                    for (const mId of selectedNodes) {
                        if (new RegExp(`^\\s*class\\s+${mId}\\s*\\{`).test(line)) {
                            insideDeletedBlock = true;
                            isBlockStart = true;
                            break;
                        }
                    }
                    if (isBlockStart) continue;

                    if (insideDeletedBlock) {
                        if (/^\s*\}/.test(line)) {
                            insideDeletedBlock = false;
                        }
                        continue; // ブロック内はスキップ
                    }

                    // 単一行定義や接続をチェック
                    let shouldDeleteLine = false;
                    for (const mId of selectedNodes) {
                        // 単一クラス定義やステレオタイプ定義
                        if (new RegExp(`^\\s*class\\s+${mId}\\b(?!\\s*\\{)`).test(line) ||
                            new RegExp(`^\\s*<<.+>>\\s+${mId}\\b`).test(line) ||
                            new RegExp(`^\\s*${mId}\\s*:\\s*`).test(line)) {
                            shouldDeleteLine = true;
                            break;
                        }
                        // 接続関係 (A --> B) の場合、AかBが含まれていたらその行ごと削除
                        // 雑な判定だが、単語としてmIdが含まれていて、かつ関係記号が含まれていれば削除する
                        if (new RegExp(`\\b${mId}\\b`).test(line) && line.match(/--|<\||\*|o|\.\./)) {
                            shouldDeleteLine = true;
                            break;
                        }
                    }

                    if (!shouldDeleteLine) {
                        newLines.push(line);
                    }
                }

                lines.splice(startIdx + 1, endIdx - startIdx - 1, ...newLines);
                
                const savedCodeIndex = diagramContainer.closest('.code-block-wrapper')?.dataset?.codeIndex;
                const savedDataLine  = diagramContainer.getAttribute('data-line') || diagramContainer.closest('.code-block-wrapper')?.getAttribute('data-line');

                setEditorText(lines.join('\n'));

                selectedNodes.clear();
                
                setTimeout(() => {
                    if (typeof window.render === 'function') window.render();
                    setTimeout(() => {
                        if (window.activeMermaidErToolbar) {
                            window.activeMermaidErToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
                        }
                    }, 100);
                }, 50);
                if (typeof showToast === 'function') showToast('削除しました', 'success');
            },
            
            copySelection: () => {
                if (selectedNodes.size === 0) return;
                
                if (typeof getEditorText !== 'function') return;
                let dataLine = parseInt(diagramContainer.getAttribute('data-line'), 10);
                if (!dataLine || isNaN(dataLine)) {
                    const cbw = diagramContainer.closest('.code-block-wrapper');
                    if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
                }
                if (!dataLine || isNaN(dataLine)) return;

                const lines = getEditorText().split('\n');
                const startIdx = dataLine - 1;
                const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
                let endIdx = -1;
                for (let i = startIdx + 1; i < lines.length; i++) {
                    if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
                }
                if (endIdx === -1) return;

                const copiedClasses = [];
                for (const mId of selectedNodes) {
                    let classBlock = [];
                    let insideBlock = false;
                    for (let i = startIdx + 1; i < endIdx; i++) {
                        const line = lines[i];
                        if (new RegExp(`^\\s*class\\s+${mId}\\s*\\{`).test(line)) {
                            insideBlock = true;
                            classBlock.push(line);
                            continue;
                        }
                        if (insideBlock) {
                            classBlock.push(line);
                            if (/^\s*\}/.test(line)) {
                                insideBlock = false;
                            }
                            continue;
                        }
                        if (new RegExp(`^\\s*class\\s+${mId}\\b(?!\\s*\\{)`).test(line) ||
                            new RegExp(`^\\s*<<.+>>\\s+${mId}\\b`).test(line) ||
                            new RegExp(`^\\s*${mId}\\s*:\\s*`).test(line)) {
                            classBlock.push(line);
                        }
                    }
                    if (classBlock.length > 0) {
                        copiedClasses.push({ id: mId, lines: classBlock });
                    }
                }
                
                diagramContainer._clipboard = copiedClasses;
                if (typeof showToast === 'function') showToast(`コピーしました (${copiedClasses.length}件)`, 'success');
            },
            
            pasteSelection: () => {
                if (!diagramContainer._clipboard || diagramContainer._clipboard.length === 0) return;
                
                if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;
                let dataLine = parseInt(diagramContainer.getAttribute('data-line'), 10);
                if (!dataLine || isNaN(dataLine)) {
                    const cbw = diagramContainer.closest('.code-block-wrapper');
                    if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
                }
                if (!dataLine || isNaN(dataLine)) return;

                const lines = getEditorText().split('\n');
                const startIdx = dataLine - 1;
                const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
                let endIdx = -1;
                for (let i = startIdx + 1; i < lines.length; i++) {
                    if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
                }
                if (endIdx === -1) return;

                // 既存のIDを収集
                const existingIds = new Set();
                for (let i = startIdx + 1; i < endIdx; i++) {
                    const match = lines[i].match(/^\s*class\s+([A-Za-z0-9_]+)/);
                    if (match) existingIds.add(match[1]);
                }

                const pastedLines = [];
                const newSelectedIds = new Set();

                diagramContainer._clipboard.forEach(cls => {
                    let newId = `${cls.id}_copy`;
                    let counter = 1;
                    while (existingIds.has(newId)) {
                        newId = `${cls.id}_copy${counter}`;
                        counter++;
                    }
                    existingIds.add(newId);
                    newSelectedIds.add(newId);

                    cls.lines.forEach(line => {
                        // ID部分を置換
                        const newLine = line.replace(new RegExp(`\\b${cls.id}\\b`, 'g'), newId);
                        pastedLines.push(newLine);
                    });
                });

                lines.splice(endIdx, 0, ...pastedLines);
                
                const savedCodeIndex = diagramContainer.closest('.code-block-wrapper')?.dataset?.codeIndex;
                const savedDataLine  = diagramContainer.getAttribute('data-line') || diagramContainer.closest('.code-block-wrapper')?.getAttribute('data-line');

                setEditorText(lines.join('\n'));

                selectedNodes.clear();
                newSelectedIds.forEach(id => selectedNodes.add(id));
                
                setTimeout(() => {
                    setTimeout(() => {
                        if (window.activeMermaidErToolbar) {
                            window.activeMermaidErToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
                        }
                    }, 100);
                }, 50);
            },
            
            toggleDirection: () => {
                if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;
                let dataLine = parseInt(diagramContainer.getAttribute('data-line'), 10);
                if (!dataLine || isNaN(dataLine)) {
                    const cbw = diagramContainer.closest('.code-block-wrapper');
                    if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
                }
                if (!dataLine || isNaN(dataLine)) return;

                const lines = getEditorText().split('\n');
                const startIdx = dataLine - 1;
                const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
                let endIdx = -1;
                for (let i = startIdx + 1; i < lines.length; i++) {
                    if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
                }
                if (endIdx === -1) return;

                const cycleDir = ['TB', 'LR', 'BT', 'RL'];
                const getNextDir = (curr) => {
                    const idx = cycleDir.indexOf(curr);
                    return idx !== -1 ? cycleDir[(idx + 1) % cycleDir.length] : 'LR';
                };

                let directionLineIdx = -1;
                let currentDirection = null;

                for (let i = startIdx + 1; i < endIdx; i++) {
                    const line = lines[i];
                    const dirMatch = line.match(/^\s*direction\s+(TB|TD|LR|RL|BT)\s*$/);
                    if (dirMatch) {
                        directionLineIdx = i;
                        currentDirection = dirMatch[1];
                        if (currentDirection === 'TD') currentDirection = 'TB';
                        break;
                    }
                }

                if (directionLineIdx !== -1) {
                    const newDir = getNextDir(currentDirection);
                    lines[directionLineIdx] = lines[directionLineIdx].replace(currentDirection, newDir);
                } else {
                    // classDiagram行の直後に direction LR を追加
                    let insertIdx = startIdx + 1;
                    for (let i = startIdx + 1; i < endIdx; i++) {
                        if (/^\s*classDiagram\b/.test(lines[i])) {
                            insertIdx = i + 1;
                            break;
                        }
                    }
                    lines.splice(insertIdx, 0, '    direction LR');
                }

                const savedCodeIndex = diagramContainer.closest('.code-block-wrapper')?.dataset?.codeIndex;
                const savedDataLine  = diagramContainer.getAttribute('data-line') || diagramContainer.closest('.code-block-wrapper')?.getAttribute('data-line');

                setEditorText(lines.join('\n'));

                setTimeout(() => {
                    if (typeof window.render === 'function') window.render();
                    setTimeout(() => {
                        if (window.activeMermaidErToolbar) {
                            window.activeMermaidErToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
                        }
                    }, 100);
                }, 50);
                if (typeof showToast === 'function') showToast(`縦横(TB/LR/BT/RL)を切り替えました`, 'success');
            }
        };

        // イベントハンドラ等で selectedNodes を参照できるよう、インスタンス等に退避するか
        // クロージャで包むのが良いが、今回は `this` コンテキストを介してアクセスできるようにする。
        diagramContainer._selectedNodes = diagramContainer._selectedNodes || selectedNodes;
        diagramContainer._selectedRelations = diagramContainer._selectedRelations || new Set();

        // 編集モード時にヒットボックスを追加するMutationObserverを設定
        if (!diagramContainer._classHitboxObserver) {
            const observer = new MutationObserver(() => {
                if (diagramContainer.classList.contains('mermaid-er-edit-mode')) {
                    setTimeout(() => this._enhanceRelationHitboxes(diagramContainer), 150);
                }
            });
            observer.observe(diagramContainer, { attributes: true, attributeFilter: ['class'], subtree: false });
            diagramContainer._classHitboxObserver = observer;
        }
        if (diagramContainer.classList.contains('mermaid-er-edit-mode')) {
            setTimeout(() => this._enhanceRelationHitboxes(diagramContainer), 150);
        }

        // ツールバーでの関係・多重度変更を受け取る
        if (window.activeMermaidErToolbar) {
            window.activeMermaidErToolbar.onRelationStateChange = (state) => {
                this._applyRelationChange(diagramContainer, state);
            };
            window.activeMermaidErToolbar.onRelationSwap = () => {
                this._applyRelationSwap(diagramContainer);
            };
        }

        // 編集モード時のみ有効なスタイルを注入
        if (!document.getElementById('mermaid-er-styles')) {
            const style = document.createElement('style');
            style.id = 'mermaid-er-styles';
            style.textContent = `
                .mermaid-er-edit-mode .node,
                .mermaid-er-edit-mode .node {
                    cursor: pointer !important;
                }
                .mermaid-er-edit-mode .mermaid-er-selected rect:not(.mermaid-er-hitbox-title):not(.mermaid-er-hitbox-members) {
                    stroke: #7c3aed !important;
                    stroke-width: 3px !important;
                    stroke-dasharray: 4,2 !important;
                }
                .mermaid-er-edit-mode path.mermaid-er-arrow-selected {
                    stroke: #3b82f6 !important;
                    stroke-dasharray: 4,2 !important;
                    filter: drop-shadow(0 0 4px rgba(59, 130, 246, 1));
                }
                .mermaid-er-hitbox-title,
                .mermaid-er-hitbox-attributes,
                .mermaid-er-hitbox-methods {
                    display: none;
                }
                .mermaid-er-edit-mode .mermaid-er-hitbox-title,
                .mermaid-er-edit-mode .mermaid-er-hitbox-attributes,
                .mermaid-er-edit-mode .mermaid-er-hitbox-methods {
                    display: block;
                    fill: transparent !important;
                    stroke: transparent !important;
                    pointer-events: all;
                    transition: fill 0.2s;
                }
                .mermaid-er-edit-mode .mermaid-er-hitbox-title:hover {
                    fill: rgba(124, 58, 237, 0.15) !important;
                }
                .mermaid-er-edit-mode .mermaid-er-hitbox-attributes:hover {
                    fill: rgba(34, 197, 94, 0.15) !important;
                }
                .mermaid-er-edit-mode .mermaid-er-hitbox-methods:hover {
                    fill: rgba(239, 68, 68, 0.15) !important;
                }
                /* ↓ここから追加↓ */
                .mermaid-er-edit-mode .er.relationshipLabel,
                .mermaid-er-edit-mode .er.relationshipLabelBox,
                .mermaid-er-edit-mode text[class*="relationshipLabel"],
                .mermaid-er-edit-mode text.edgeLabel {
                    cursor: pointer !important;
                    pointer-events: all !important;
                }
                .mermaid-er-edit-mode .er.relationshipLabel:hover,
                .mermaid-er-edit-mode text[class*="relationshipLabel"]:hover,
                .mermaid-er-edit-mode text.edgeLabel:hover {
                    fill: #3b82f6 !important;
                }
                /* ↑ここまで追加↑ */
            `;
            document.head.appendChild(style);
        }

        // キーボードショートカットで削除可能にするAPIの登録
        diagramContainer._mermaidAPI.deleteSelection = () => {
            this._deleteSelection(diagramContainer);
        };

        // クリックイベントの委譲
        svg.addEventListener('click', (e) => this._onClick(e, diagramContainer));
        svg.addEventListener('dblclick', (e) => this._onDoubleClick(e, diagramContainer));
        svg.addEventListener('contextmenu', (e) => this._onContextMenu(e, diagramContainer));
    },

    _getClosestEdge(clientX, clientY, wrapper) {
        let closestEdge = null;
        let minDist = Infinity;
        
        const edges = wrapper.querySelectorAll('.er.relationshipLine:not(.mermaid-er-arrow-hitbox), .edgePath path:not(.mermaid-er-arrow-hitbox), path.relation:not(.mermaid-er-arrow-hitbox)');
        const svg = wrapper.querySelector('svg');
        
        edges.forEach(edge => {
            let point;
            try {
                point = edge.getPointAtLength(edge.getTotalLength() / 2);
            } catch (err) {
                const bbox = edge.getBBox();
                point = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
            }
            
            let screenX, screenY;
            const ctm = edge.getScreenCTM();
            if (ctm && svg.createSVGPoint) {
                const pt = svg.createSVGPoint();
                pt.x = point.x;
                pt.y = point.y;
                const transformed = pt.matrixTransform(ctm);
                screenX = transformed.x;
                screenY = transformed.y;
            } else {
                const rect = edge.getBoundingClientRect();
                screenX = rect.left + rect.width / 2;
                screenY = rect.top + rect.height / 2;
            }
            
            const dist = Math.hypot(clientX - screenX, clientY - screenY);
            if (dist < minDist) {
                minDist = dist;
                closestEdge = edge;
            }
        });
        
        return closestEdge;
    },

    _onClick(e, diagramContainer) {
        console.log('[_onClick] Target:', e.target, 'ER Edit Mode:', diagramContainer.classList.contains('mermaid-er-edit-mode'));
        if (!diagramContainer.classList.contains('mermaid-er-edit-mode')) return;

        const node = e.target.closest('[id^="entity-"]');
        let edgeHitbox = e.target.closest('.mermaid-er-arrow-hitbox, .edgePath path, path.relation, .er.relationshipLine');
        const labelNode = e.target.closest('.er.relationshipLabel, .er.relationshipLabelBox, text[class*="relationshipLabel"], text.edgeLabel, .edgeLabel');
        
        if (!node && !edgeHitbox && labelNode) {
            const closestEdge = this._getClosestEdge(e.clientX, e.clientY, diagramContainer);
            if (closestEdge) edgeHitbox = closestEdge;
        }
        console.log('[_onClick] Found node:', node, 'Found edgeHitbox:', edgeHitbox);
        const selectedNodes = diagramContainer._selectedNodes;
        const selectedRelations = diagramContainer._selectedRelations;
        
        const isMultiSelect = e.ctrlKey || e.metaKey || e.shiftKey;

        if (edgeHitbox && !node) {
            e.stopPropagation();
            let targetPath = edgeHitbox;
            if (edgeHitbox.classList.contains('mermaid-er-arrow-hitbox')) {
                targetPath = edgeHitbox.previousSibling;
            }
            const mId = targetPath.id || (targetPath.parentNode && targetPath.parentNode.id);
            if (!mId) return;

            if (isMultiSelect) {
                if (selectedRelations.has(mId)) selectedRelations.delete(mId);
                else selectedRelations.add(mId);
            } else {
                selectedNodes.clear();
                selectedRelations.clear();
                selectedRelations.add(mId);
            }
            this._updateSelectionUI(diagramContainer);
            return;
        }

        if (node) {
            e.stopPropagation();
            const mId = this._getMermaidEntityId(node);
            if (!mId) return;
            
            if (isMultiSelect) {
                if (selectedNodes.has(mId)) selectedNodes.delete(mId);
                else selectedNodes.add(mId);
            } else {
                selectedNodes.clear();
                selectedRelations.clear();
                selectedNodes.add(mId);
            }
            this._updateSelectionUI(diagramContainer);
        } else {
            selectedNodes.clear();
            selectedRelations.clear();
            this._updateSelectionUI(diagramContainer);
        }
    },

    _onDoubleClick(e, diagramContainer) {
        console.log('[_onDoubleClick] Target:', e.target, 'ER Edit Mode:', diagramContainer.classList.contains('mermaid-er-edit-mode'));
        if (!diagramContainer.classList.contains('mermaid-er-edit-mode')) return;
        
        const node = e.target.closest('[id^="entity-"]');
        let edgeHitbox = e.target.closest('.mermaid-er-arrow-hitbox, .edgePath path, path.relation, .er.relationshipLine');
        const labelNode = e.target.closest('.er.relationshipLabel, .er.relationshipLabelBox, text[class*="relationshipLabel"], text.edgeLabel, .edgeLabel');
        
        if (!node && !edgeHitbox && labelNode) {
            const closestEdge = this._getClosestEdge(e.clientX, e.clientY, diagramContainer);
            if (closestEdge) edgeHitbox = closestEdge;
        }

        console.log('[_onDoubleClick] Found node:', node, 'edgeHitbox:', edgeHitbox, 'labelNode:', labelNode);
        if (node) {
            e.stopPropagation();
            // どこをクリックしても統合エディタを起動する
            this._editEntityInline(node, diagramContainer, e);
        } else if (edgeHitbox) {
            e.stopPropagation();
            let targetPath = edgeHitbox;
            if (edgeHitbox.classList.contains('mermaid-er-arrow-hitbox')) {
                targetPath = edgeHitbox.previousSibling;
            }
            const mId = targetPath.id || (targetPath.parentNode && targetPath.parentNode.id);
            if (!mId) return;

            this._editRelationInline(mId, targetPath, diagramContainer, e, labelNode);
        }
    },

    _onContextMenu(e, diagramContainer) {
        console.log('[_onContextMenu] Target:', e.target);
        if (!diagramContainer.classList.contains('mermaid-er-edit-mode')) return;
        
        const node = e.target.closest('[id^="entity-"]');
        let edgeHitbox = e.target.closest('.mermaid-er-arrow-hitbox, .edgePath path, path.relation, .er.relationshipLine');
        const labelNode = e.target.closest('.er.relationshipLabel, .er.relationshipLabelBox, text[class*="relationshipLabel"], text.edgeLabel, .edgeLabel');
        
        if (!node && !edgeHitbox && labelNode) {
            const closestEdge = this._getClosestEdge(e.clientX, e.clientY, diagramContainer);
            if (closestEdge) edgeHitbox = closestEdge;
        }

        const selectedNodes = diagramContainer._selectedNodes || new Set();
        const selectedRelations = diagramContainer._selectedRelations || new Set();
        
        if (node) {
            e.preventDefault();
            e.stopPropagation();
            
            const mId = this._getMermaidEntityId(node);
            if (mId && !selectedNodes.has(mId)) {
                selectedNodes.clear();
                selectedRelations.clear();
                selectedNodes.add(mId);
                this._updateSelectionUI(diagramContainer);
            }
            this._showContextMenu(e.clientX, e.clientY, diagramContainer);
        } else if (edgeHitbox) {
            e.preventDefault();
            e.stopPropagation();

            let targetPath = edgeHitbox;
            if (edgeHitbox.classList.contains('mermaid-er-arrow-hitbox')) {
                targetPath = edgeHitbox.previousSibling;
            }
            const mId = targetPath.id || (targetPath.parentNode && targetPath.parentNode.id);
            if (mId && !selectedRelations.has(mId)) {
                selectedNodes.clear();
                selectedRelations.clear();
                selectedRelations.add(mId);
                this._updateSelectionUI(diagramContainer);
            }
            this._showContextMenu(e.clientX, e.clientY, diagramContainer);
        } else if (selectedNodes.size > 0 || selectedRelations.size > 0) {
            e.preventDefault();
            this._showContextMenu(e.clientX, e.clientY, diagramContainer);
        }
    },

    _updateSelectionUI(diagramContainer) {
        this._clearSelection(diagramContainer);
        const selectedNodes = diagramContainer._selectedNodes || new Set();
        const selectedRelations = diagramContainer._selectedRelations || new Set();
        
        const overlay = this._ensureOverlay(diagramContainer);
        
        const nodes = diagramContainer.querySelectorAll('[id^="entity-"]');
        nodes.forEach(node => {
            const mId = this._getMermaidEntityId(node);
            if (mId && selectedNodes.has(mId)) {
                node.classList.add('mermaid-er-selected');
                const rect = node.getBoundingClientRect();
                this._drawHandles(overlay, { el: node, id: mId, rect }, diagramContainer);
            }
        });

        const edges = diagramContainer.querySelectorAll('.edgePath path:not(.mermaid-er-arrow-hitbox), path.relation:not(.mermaid-er-arrow-hitbox), .er.relationshipLine:not(.mermaid-er-arrow-hitbox)');
        const wRect = diagramContainer.getBoundingClientRect();

        edges.forEach(edge => {
            const mId = edge.id || (edge.parentNode && edge.parentNode.id);
            if (mId && selectedRelations.has(mId)) {
                edge.classList.add('mermaid-er-arrow-selected');
            }
        });

        // 単一の矢印が選択されている場合、ツールバーに反映させる
        if (selectedRelations.size === 1 && window.activeMermaidErToolbar) {
            const mId = Array.from(selectedRelations)[0];
            console.log('[_updateSelectionUI] 選択された矢印のID:', mId);
            const rel = this._getRelationFromText(diagramContainer, mId);
            console.log('[_updateSelectionUI] 取得した矢印のデータ:', rel);
            if (rel) {
                // 循環参照ループを防ぐためイベントハンドラを一時無効化するか、値が違う場合のみセット
                console.log('[_updateSelectionUI] ツールバーにセットします', rel.lineType, rel.leftMulti, rel.rightMulti);
                window.activeMermaidErToolbar.setRelationState(rel.leftMulti, rel.lineType, rel.rightMulti);
            }
        }
    },

    _showContextMenu(x, y, wrapper) {
        const existingMenu = document.getElementById('mermaid-context-menu');
        if (existingMenu) existingMenu.remove();

        if (!window._mermaidGlobalEventsBoundClass) {
            window._mermaidGlobalEventsBoundClass = true;
            document.addEventListener('click', e => {
                const menu = document.getElementById('mermaid-context-menu');
                if (menu && !e.target.closest('#mermaid-context-menu')) {
                    menu.remove();
                }
            });
        }

        const menu = document.createElement('div');
        menu.id = 'mermaid-context-menu';
        menu.className = 'context-menu visible';
        menu.style.position = 'fixed';
        menu.style.zIndex = '10000';
        
        const hasNodeSelected = wrapper._selectedNodes && wrapper._selectedNodes.size > 0;
        const hasRelationSelected = wrapper._selectedRelations && wrapper._selectedRelations.size > 0;
        const isSelected = hasNodeSelected || hasRelationSelected;
        
        const items = [];
        
        if (hasNodeSelected) {
            items.push({ label: 'コピー', shortcut: 'Ctrl+C', action: 'copy' });
        }
        
        if (wrapper._clipboard && wrapper._clipboard.length > 0) {
            items.push({ label: '貼り付け', shortcut: 'Ctrl+V', action: 'paste' });
        }
        
        if (items.length > 0) {
            items.push({ type: 'separator' });
        }
        
        if (isSelected) {
            items.push({ label: '削除', shortcut: 'Delete', action: 'delete' });
        }

        if (items.length === 0) return;

        items.forEach(item => {
            if (item.type === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'context-menu-separator';
                menu.appendChild(sep);
                return;
            }

            const el = document.createElement('div');
            el.className = 'context-menu-item';
            
            const labelSpan = document.createElement('span');
            labelSpan.textContent = item.label;
            el.appendChild(labelSpan);

            if (item.shortcut) {
                const shortcutSpan = document.createElement('span');
                shortcutSpan.className = 'shortcut';
                shortcutSpan.style.marginLeft = 'auto';
                shortcutSpan.style.paddingLeft = '16px';
                shortcutSpan.style.color = '#999';
                shortcutSpan.style.fontSize = '11px';
                shortcutSpan.textContent = item.shortcut;
                el.appendChild(shortcutSpan);
            }

            el.onclick = (e) => {
                e.stopPropagation();
                menu.remove();
                
                if (item.action === 'copy' && wrapper._mermaidAPI.copySelection) {
                    wrapper._mermaidAPI.copySelection();
                } else if (item.action === 'paste' && wrapper._mermaidAPI.pasteSelection) {
                    wrapper._mermaidAPI.pasteSelection();
                } else if (item.action === 'delete' && wrapper._mermaidAPI.deleteSelection) {
                    wrapper._mermaidAPI.deleteSelection();
                }
            };
            menu.appendChild(el);
        });

        document.body.appendChild(menu);

        const padding = 10;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const menuRect = menu.getBoundingClientRect();
        
        let finalX = x;
        let finalY = y;
        
        if (finalX + menuRect.width > viewportW - padding) {
            finalX = viewportW - menuRect.width - padding;
        }
        if (finalY + menuRect.height > viewportH - padding) {
            finalY = viewportH - menuRect.height - padding;
        }

        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
    },

    _clearSelection(diagramContainer) {
        const selected = diagramContainer.querySelectorAll('.mermaid-er-selected, .mermaid-er-arrow-selected');
        selected.forEach(el => {
            el.classList.remove('mermaid-er-selected');
            el.classList.remove('mermaid-er-arrow-selected');
        });
        const overlay = diagramContainer.querySelector('.mermaid-er-overlay-svg');
        if (overlay) {
            Array.from(overlay.children).forEach(c => {
                if (c.tagName.toLowerCase() !== 'defs') overlay.removeChild(c);
            });
        }
    },

    _getMermaidEntityId(el) {
        const id = el.id || '';
        const m = id.match(/^entity-(.+?)(?:-[0-9a-fA-F\-]{36})?$/) || id.match(/^entityId-(.+?)(?:-[0-9a-fA-F\-]{36})?$/);
        if (m) return m[1];
        
        const titleEl = el.querySelector('.classTitle, .title, text');
        if (titleEl) return titleEl.textContent.trim();
        
        return null;
    },

    _ensureOverlay(wrapper) {
        let overlay = wrapper.querySelector('.mermaid-er-overlay-svg');
        if (!overlay) {
            overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            overlay.classList.add('mermaid-er-overlay-svg');
            overlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100;';
            overlay.innerHTML = `
                <defs>
                  <marker id="mi-er-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L8,3 z" fill="#7c3aed"/>
                  </marker>
                </defs>`;
            wrapper.appendChild(overlay);
        }
        return overlay;
    },

    _drawHandles(overlay, nodeInfo, wrapper) {
        const wRect  = wrapper.getBoundingClientRect();
        const nRect  = nodeInfo.rect;

        const top    = nRect.top    - wRect.top;
        const left   = nRect.left   - wRect.left;
        const right  = nRect.right  - wRect.left;
        const bottom = nRect.bottom - wRect.top;
        const cx     = left + nRect.width  / 2;
        const cy     = top  + nRect.height / 2;

        const S = 10;
        const O = 6;
        const tipDist = S * 1.6;
        
        const handles = [
            { dir: 'top',    hx: cx, hy: top - O - tipDist / 2, pts: `${cx},${top - O - tipDist} ${cx - S},${top - O} ${cx + S},${top - O}` },
            { dir: 'bottom', hx: cx, hy: bottom + O + tipDist / 2, pts: `${cx},${bottom + O + tipDist} ${cx - S},${bottom + O} ${cx + S},${bottom + O}` },
            { dir: 'left',   hx: left - O - tipDist / 2, hy: cy, pts: `${left - O - tipDist},${cy} ${left - O},${cy - S} ${left - O},${cy + S}` },
            { dir: 'right',  hx: right + O + tipDist / 2, hy: cy, pts: `${right + O + tipDist},${cy} ${right + O},${cy - S} ${right + O},${cy + S}` },
        ];

        handles.forEach(h => {
            const tri = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            tri.setAttribute('points', h.pts);
            tri.setAttribute('fill', '#7c3aed');
            tri.setAttribute('opacity', '0.75');
            tri.classList.add('mermaid-er-connect-handle');
            tri.style.pointerEvents = 'auto';
            tri.style.cursor = 'crosshair';
            tri.dataset.dir      = h.dir;
            tri.dataset.nodeId   = nodeInfo.id;
            tri.dataset.startCx  = h.hx;
            tri.dataset.startCy  = h.hy;
            
            tri.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                this._startDrag(e, wrapper, overlay, nodeInfo, h);
            });
            
            overlay.appendChild(tri);
        });
    },

    _startDrag(e, wrapper, overlay, sourceNode, handle) {
        if (this._dragState) return;

        const startX = e.clientX;
        const startY = e.clientY;
        const wRect = wrapper.getBoundingClientRect();

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', handle.hx);
        line.setAttribute('y1', handle.hy);
        line.setAttribute('x2', handle.hx);
        line.setAttribute('y2', handle.hy);
        line.setAttribute('stroke', '#7c3aed');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '6,3');
        line.setAttribute('marker-end', 'url(#mi-er-arrow)');
        overlay.appendChild(line);

        const nodes = this._collectNodes(wrapper.querySelector('svg'));

        this._dragState = {
            wrapper, overlay, line, sourceNode, handle,
            wRect, startX, startY, nodes
        };

        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);

        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);
    },

    _onMouseMove(e) {
        if (!this._dragState) return;
        const { wrapper, line, handle, wRect, nodes, sourceNode } = this._dragState;
        
        let mx = e.clientX - wRect.left;
        let my = e.clientY - wRect.top;

        // Snap
        let target = null;
        let minDist = 36;
        for (const n of nodes) {
            if (n.id === sourceNode.id) continue;
            const nLeft = n.rect.left - wRect.left;
            const nTop  = n.rect.top  - wRect.top;
            const nRight = nLeft + n.rect.width;
            const nBottom = nTop + n.rect.height;
            
            if (mx >= nLeft && mx <= nRight && my >= nTop && my <= nBottom) {
                target = n;
                break;
            }
            const dx = Math.max(nLeft - mx, 0, mx - nRight);
            const dy = Math.max(nTop - my, 0, my - nBottom);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) {
                minDist = d;
                target = n;
            }
        }

        if (target) {
            mx = target.rect.left - wRect.left + target.rect.width / 2;
            my = target.rect.top - wRect.top + target.rect.height / 2;
            this._dragState.snapTarget = target;
        } else {
            this._dragState.snapTarget = null;
        }

        line.setAttribute('x2', mx);
        line.setAttribute('y2', my);
    },

    _onMouseUp(e) {
        if (!this._dragState) return;
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);

        const { wrapper, overlay, line, sourceNode, snapTarget } = this._dragState;
        this._dragState = null;
        
        overlay.removeChild(line);

        if (snapTarget && snapTarget.id !== sourceNode.id) {
            this._connectNodes(wrapper, sourceNode.id, snapTarget.id);
        }
        
        this._clearSelection(wrapper);
    },

    _collectNodes(svgEl) {
        const nodes = [];
        const nodeEls = svgEl.querySelectorAll('g[id^="entity-"]');
        nodeEls.forEach(g => {
            const mId = this._getMermaidEntityId(g);
            if (!mId) return;
            const rect = g.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            nodes.push({ el: g, id: mId, rect });
        });
        return nodes;
    },

    _connectNodes(wrapper, fromId, toId) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        let dataLine = parseInt(wrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = wrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const lines = getEditorText().split('\n');
        const startIdx = dataLine - 1;
        const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) return;

        // ツールバーから現在選択されている関係タイプを取得
        let relation = '||--o{'; // default
        if (window.activeMermaidErToolbar && typeof window.activeMermaidErToolbar.getLineType === 'function') {
            relation = `${window.activeMermaidErToolbar.getLeftMultiplicity()}${window.activeMermaidErToolbar.getLineType()}${window.activeMermaidErToolbar.getRightMultiplicity()}`;
        }

        const arrowLine = `    ${fromId} ${relation} ${toId} : ""`;
        lines.splice(endIdx, 0, arrowLine);

        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = wrapper.getAttribute('data-line') || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                if (window.activeMermaidErToolbar) {
                    window.activeMermaidErToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
                }
            }, 100);
        }, 50);

        if (typeof showToast === 'function') showToast(`${fromId} と ${toId} を接続しました`, 'success');
    },

    _editRelationInline(mId, targetPath, wrapper, e, labelNode = null) {
        const rel = this._getRelationFromText(wrapper, mId);
        if (!rel) return;

        let initialLabel = rel.label && rel.label.trim() !== '""' ? rel.label : '';
        if (initialLabel.startsWith('"') && initialLabel.endsWith('"')) {
            initialLabel = initialLabel.substring(1, initialLabel.length - 1);
        }

        const container = document.createElement('div');
        container.style.cssText = `
            position: absolute;
            background: white;
            border: 1px solid #3b82f6;
            padding: 4px;
            border-radius: 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 1000;
            display: flex;
        `;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = initialLabel;
        input.style.cssText = 'width: 150px; font-size: 12px; padding: 2px 4px; border: none; outline: none; font-family: monospace;';
        
        container.appendChild(input);

        // Position the editor
        const wRect = wrapper.getBoundingClientRect();
        let rect;
        
        if (labelNode) {
            rect = labelNode.getBoundingClientRect();
        } else {
            let point;
            try {
                point = targetPath.getPointAtLength(targetPath.getTotalLength() / 2);
            } catch (err) {
                const bbox = targetPath.getBBox();
                point = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
            }
            
            const svg = wrapper.querySelector('svg');
            const ctm = targetPath.getScreenCTM();
            if (ctm && svg.createSVGPoint) {
                const pt = svg.createSVGPoint();
                pt.x = point.x;
                pt.y = point.y;
                const transformed = pt.matrixTransform(ctm);
                rect = { left: transformed.x - 75, top: transformed.y - 15, width: 150, height: 30 };
            } else {
                rect = { left: e.clientX - 75, top: e.clientY - 15, width: 150, height: 30 };
            }
        }
        
        container.style.top = (rect.top - wRect.top) + 'px';
        container.style.left = (rect.left - wRect.left) + 'px';
        
        wrapper.appendChild(container);
        input.focus();
        input.select();
        
        const saveAndClose = () => {
            if (!container.parentNode) return;
            container.remove();
            
            let newLabel = input.value.trim();
            if (newLabel === '') {
                newLabel = '""';
            } else if (!newLabel.startsWith('"') || !newLabel.endsWith('"')) {
                newLabel = `"${newLabel.replace(/"/g, '')}"`;
            }

            const lines = getEditorText().split('\n');
            const stateLeft = rel.leftMulti;
            const stateRight = rel.rightMulti;

            let newLine = `    ${rel.from} ${stateLeft}${rel.lineType}${stateRight} ${rel.to} : ${newLabel}`;
            lines[rel.lineIndex] = newLine;

            const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
            const savedDataLine  = wrapper.getAttribute('data-line') || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');
            const savedEdgeId    = mId;

            setEditorText(lines.join('\n'));

            setTimeout(() => {
                if (typeof window.render === 'function') {
                    Promise.resolve(window.render()).then(() => {
                        setTimeout(() => {
                            if (window.activeMermaidErToolbar) {
                                window.activeMermaidErToolbar._restoreEditMode(savedCodeIndex, savedDataLine, savedEdgeId);
                            }
                        }, 50);
                    });
                }
            }, 50);
        };
        
        input.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                saveAndClose();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                container.remove();
            }
        });
        
        // input.addEventListener('blur', () => {
        //     saveAndClose();
        // });
        // NOTE: blur listener can sometimes fire too early during rendering. 
        // We will just use click-outside or enter to save.
        
        // Add a click outside listener to the document
        setTimeout(() => {
            const outsideClickListener = (ev) => {
                if (!container.contains(ev.target)) {
                    saveAndClose();
                    document.removeEventListener('mousedown', outsideClickListener);
                }
            };
            document.addEventListener('mousedown', outsideClickListener);
        }, 10);
    },

    _editEntityInline(node, wrapper, e) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        const mId = this._getMermaidEntityId(node);
        if (!mId) return;

        let dataLine = parseInt(wrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = wrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const lines = getEditorText().split('\n');
        const startIdx = dataLine - 1;
        const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) return;

        // エンティティのブロックを抽出
        let entityBlockStart = -1;
        let entityBlockEnd = -1;
        let members = [];
        
        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            // ER図の「EntityName {」を探す
            if (new RegExp(`^\\s*${mId}\\s*\\{`).test(line)) {
                entityBlockStart = i;
                for (let j = i + 1; j < endIdx; j++) {
                    const innerLine = lines[j];
                    if (/^\s*\}/.test(innerLine)) {
                        entityBlockEnd = j;
                        break;
                    }
                    const trimmed = innerLine.trim();
                    if (trimmed !== '') {
                        members.push(trimmed);
                    }
                }
                break;
            }
        }

        // 統合エディタを表示
        this._showEntityEditor(wrapper, node, mId, members, startIdx, endIdx, lines, entityBlockStart, entityBlockEnd);
    },

    _parseMember(line) {
        let type = '', name = '', keys = '', comment = '';
        
        // コメント（ダブルクォートで囲まれた部分）を抽出
        const commentMatch = line.match(/"([^"]*)"/);
        if (commentMatch) {
            comment = commentMatch[1];
            line = line.replace(commentMatch[0], '').trim();
        }
        
        // スペース区切りで 型、名称、キー に分割
        const parts = line.split(/\s+/).filter(Boolean);
        if (parts.length > 0) type = parts[0];
        if (parts.length > 1) name = parts[1];
        if (parts.length > 2) keys = parts.slice(2).join(' ');
        
        return { type, name, keys, comment };
    },

    _showEntityEditor(wrapper, node, mId, members, startIdx, endIdx, lines, entityBlockStart, entityBlockEnd) {
        const container = document.createElement('div');
        container.style.cssText = `
            position: absolute;
            background: #fff;
            border: 1px solid #3b82f6;
            border-radius: 6px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
            z-index: 1000;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 500px;
            font-family: sans-serif;
        `;

        // ヘッダー部（エンティティ名）
        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = 'display: flex; gap: 8px; align-items: center; cursor: move; padding-bottom: 4px; border-bottom: 1px dashed #ccc; margin-bottom: 4px;';
        headerDiv.title = 'ドラッグして移動';

        let isDragging = false;
        let dragStartX = 0, dragStartY = 0;
        let startLeft = 0, startTop = 0;

        const onDragMove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            container.style.left = (startLeft + dx) + 'px';
            container.style.top = (startTop + dy) + 'px';
        };

        const onDragEnd = () => {
            isDragging = false;
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragEnd);
        };

        headerDiv.addEventListener('mousedown', (e) => {
            if (e.target.tagName.toLowerCase() === 'input') return; // inputのドラッグは無視
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            startLeft = parseFloat(container.style.left) || 0;
            startTop = parseFloat(container.style.top) || 0;
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragEnd);
            e.preventDefault();
        });

        const nameLabel = document.createElement('div');
        nameLabel.textContent = 'エンティティ名:';
        nameLabel.style.cssText = 'font-size: 12px; font-weight: bold; color: #555; white-space: nowrap;';
        
        const nameInput = document.createElement('input');
        nameInput.placeholder = 'エンティティ名';
        nameInput.value = mId;
        nameInput.style.cssText = 'flex: 1; padding: 6px; font-size: 14px; font-weight: bold; border: 1px solid #ccc; border-radius: 4px; outline: none; font-family: monospace; box-sizing: border-box;';
        nameInput.addEventListener('focus', () => nameInput.style.borderColor = '#3b82f6');
        nameInput.addEventListener('blur', () => nameInput.style.borderColor = '#ccc');

        headerDiv.appendChild(nameLabel);
        headerDiv.appendChild(nameInput);
        container.appendChild(headerDiv);

        // カラム見出しラベル
        const labelsDiv = document.createElement('div');
        labelsDiv.style.cssText = 'display: flex; gap: 4px; padding: 0 4px; font-size: 11px; color: #666; font-weight: bold; margin-top: 4px;';
        const lType = document.createElement('div'); lType.textContent = '型'; lType.style.flex = '2';
        const lName = document.createElement('div'); lName.textContent = '名称'; lName.style.flex = '3';
        const lKey  = document.createElement('div'); lKey.textContent = 'キー (PK/FK)'; lKey.style.flex = '1.5';
        const lCom  = document.createElement('div'); lCom.textContent = 'コメント'; lCom.style.flex = '3';
        const lDel  = document.createElement('div'); lDel.style.width = '24px';
        const lDrag = document.createElement('div'); lDrag.style.width = '16px';
        labelsDiv.append(lType, lName, lKey, lCom, lDel, lDrag);
        container.appendChild(labelsDiv);

        // カラム一覧テーブル
        const tableDiv = document.createElement('div');
        tableDiv.style.cssText = 'max-height: 250px; overflow-y: auto; overflow-x: hidden; border: 1px solid #eee; border-radius: 4px; padding: 4px; display: flex; flex-direction: column; gap: 4px;';

        const parsedMembers = members.map(m => this._parseMember(m));

        const rowsContainer = document.createElement('div');
        rowsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
        
        let draggedRow = null;

        const createRow = (member) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: 4px; align-items: center; padding: 2px 0; border-radius: 2px; transition: box-shadow 0.2s;';

            const createInput = (flex, placeholder, val) => {
                const inp = document.createElement('input');
                inp.placeholder = placeholder;
                inp.value = val;
                inp.style.cssText = `flex: ${flex}; padding: 4px; font-size: 12px; min-width: 0; border: 1px solid #ddd; border-radius: 3px; outline: none; font-family: monospace; box-sizing: border-box;`;
                inp.addEventListener('focus', () => inp.style.borderColor = '#3b82f6');
                inp.addEventListener('blur', () => inp.style.borderColor = '#ddd');
                return inp;
            };

            const tInput = createInput('2', 'int, string...', member.type || '');
            const nInput = createInput('3', 'id, name...', member.name || '');
            const kInput = createInput('1.5', 'PK, FK...', member.keys || '');
            const cInput = createInput('3', 'コメント', member.comment || '');
            cInput.style.fontFamily = 'sans-serif';

            const delBtn = document.createElement('button');
            delBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; min-width: 14px; min-height: 14px; flex-shrink: 0; display: block;">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            `;
            delBtn.title = '削除';
            delBtn.style.cssText = 'width: 24px; height: 24px; background: transparent; border: none; color: #ef4444; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; border-radius: 3px;';
            delBtn.onclick = () => row.remove();
            delBtn.onmouseenter = () => delBtn.style.background = '#fee2e2';
            delBtn.onmouseleave = () => delBtn.style.background = 'transparent';

            const dragHandle = document.createElement('div');
            dragHandle.innerHTML = `
                <svg viewBox="0 0 16 16" fill="currentColor" stroke="none" style="width: 14px; height: 14px; display: block; color: #9ca3af; pointer-events: none;">
                    <circle cx="7" cy="6" r="0.6"></circle>
                    <circle cx="9" cy="6" r="0.6"></circle>
                    <circle cx="7" cy="8" r="0.6"></circle>
                    <circle cx="9" cy="8" r="0.6"></circle>
                    <circle cx="7" cy="10" r="0.6"></circle>
                    <circle cx="9" cy="10" r="0.6"></circle>
                </svg>
            `;
            dragHandle.style.cssText = 'cursor: grab; display: flex; align-items: center; justify-content: center; width: 14px; height: 24px; flex-shrink: 0;';
            dragHandle.title = 'ドラッグして並び替え';
            
            dragHandle.addEventListener('mousedown', () => row.draggable = true);
            dragHandle.addEventListener('mouseup', () => row.draggable = false);
            dragHandle.addEventListener('mouseleave', () => row.draggable = false);
            
            row.addEventListener('dragstart', (e) => {
                draggedRow = row;
                row.style.opacity = '0.5';
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', ''); // Firefox requires data to allow drag
                }
            });
            row.addEventListener('dragend', () => {
                row.style.opacity = '1';
                row.draggable = false;
                draggedRow = null;
            });
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                if (!draggedRow || draggedRow === row) return;
                const rect = row.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height / 2) {
                    row.style.boxShadow = 'inset 0 2px 0 #3b82f6';
                } else {
                    row.style.boxShadow = 'inset 0 -2px 0 #3b82f6';
                }
            });
            row.addEventListener('dragleave', () => {
                row.style.boxShadow = 'none';
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.style.boxShadow = 'none';
                if (!draggedRow || draggedRow === row) return;
                const rect = row.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height / 2) {
                    rowsContainer.insertBefore(draggedRow, row);
                } else {
                    rowsContainer.insertBefore(draggedRow, row.nextSibling);
                }
            });

            row.append(tInput, nInput, kInput, cInput, delBtn, dragHandle);

            row.getMember = () => {
                const t = tInput.value.trim();
                const n = nInput.value.trim();
                const k = kInput.value.trim();
                const c = cInput.value.trim();
                
                if (!t && !n) return null; // 型と名称が両方空の場合は無視

                let line = '';
                if (t) line += t;
                if (n) line += (line ? ' ' : '') + n;
                if (k) line += (line ? ' ' : '') + k;
                if (c) line += (line ? ' ' : '') + ` "${c}"`;
                return line;
            };

            // 矢印キーやEnterキーでExcelのようにセルを移動できるようにする
            const inputs = [tInput, nInput, kInput, cInput];
            inputs.forEach((inp, idx) => {
                inp.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (idx < inputs.length - 1) {
                            inputs[idx + 1].focus();
                        } else {
                            const nextRow = row.nextElementSibling;
                            if (nextRow && nextRow.tagName.toLowerCase() === 'div') {
                                nextRow.querySelector('input').focus();
                            } else {
                                const newRow = createRow({ type:'', name:'', keys:'', comment:'' });
                                rowsContainer.appendChild(newRow);
                                newRow.querySelector('input').focus();
                                tableDiv.scrollTop = tableDiv.scrollHeight;
                            }
                        }
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prevRow = row.previousElementSibling;
                        if (prevRow && prevRow.tagName.toLowerCase() === 'div') {
                            prevRow.querySelectorAll('input')[idx].focus();
                        }
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const nextRow = row.nextElementSibling;
                        if (nextRow && nextRow.tagName.toLowerCase() === 'div') {
                            nextRow.querySelectorAll('input')[idx].focus();
                        }
                    }
                });
            });

            return row;
        };

        if (parsedMembers.length === 0) {
            rowsContainer.appendChild(createRow({ type:'', name:'', keys:'', comment:'' }));
        } else {
            parsedMembers.forEach(m => rowsContainer.appendChild(createRow(m)));
        }
        tableDiv.appendChild(rowsContainer);
        
        const addRowBtn = document.createElement('button');
        addRowBtn.textContent = '+ カラムを追加';
        addRowBtn.style.cssText = 'width: 100%; padding: 6px; background: #eff6ff; border: 1px dashed #3b82f6; color: #3b82f6; cursor: pointer; border-radius: 4px; margin-top: 2px; font-size: 12px; transition: background 0.2s; font-weight: bold;';
        addRowBtn.onmouseenter = () => addRowBtn.style.background = '#dbeafe';
        addRowBtn.onmouseleave = () => addRowBtn.style.background = '#eff6ff';
        addRowBtn.onclick = () => {
            const newRow = createRow({ type:'', name:'', keys:'', comment:'' });
            rowsContainer.appendChild(newRow);
            newRow.querySelector('input').focus();
            tableDiv.scrollTop = tableDiv.scrollHeight;
        };
        tableDiv.appendChild(addRowBtn);

        container.appendChild(tableDiv);

        // アクションボタン
        const actionDiv = document.createElement('div');
        actionDiv.style.cssText = 'display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 4px;';
        
        const hintDiv = document.createElement('div');
        hintDiv.innerHTML = '<b>Ctrl+Enter</b> で保存 / <b>Esc</b> でキャンセル';
        hintDiv.style.cssText = 'font-size: 11px; color: #6b7280; margin-right: auto;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'キャンセル';
        cancelBtn.style.cssText = 'padding: 6px 16px; cursor: pointer; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; color: #374151;';
        
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.style.cssText = 'padding: 6px 16px; cursor: pointer; background: #3b82f6; color: white; border: none; border-radius: 4px; font-size: 13px; font-weight: bold;';

        actionDiv.append(hintDiv, cancelBtn, saveBtn);
        container.appendChild(actionDiv);

        // 位置調整と表示
        const wRect = wrapper.getBoundingClientRect();
        const rect = node.getBoundingClientRect();
        
        let top = rect.top - wRect.top;
        let left = rect.left - wRect.left;
        
        if (left + 500 > wRect.width) left = wRect.width - 500 - 10;
        if (left < 10) left = 10;
        if (top + 300 > wRect.height) {
            top = top - 300;
            if (top < 10) top = 10;
        }

        container.style.top = top + 'px';
        container.style.left = left + 'px';

        wrapper.appendChild(container);
        nameInput.focus();
        nameInput.select();

        let isClosed = false;
        const cleanup = () => {
            if (isClosed) return;
            isClosed = true;
            container.remove();
            document.removeEventListener('mousedown', outsideClickListener);
            document.removeEventListener('keydown', keydownListener);
        };

        const save = () => {
            if (isClosed) return;
            const newName = nameInput.value.trim();
            if (!newName) {
                nameInput.style.borderColor = 'red';
                nameInput.focus();
                return; 
            }

            const newMembers = [];
            Array.from(rowsContainer.children).forEach(row => {
                const mem = row.getMember();
                if (mem) newMembers.push(mem);
            });

            this._applyEntityUpdate(wrapper, mId, newName, lines, startIdx, endIdx, entityBlockStart, entityBlockEnd, newMembers);
            cleanup();
        };

        cancelBtn.onclick = cleanup;
        saveBtn.onclick = save;

        const keydownListener = (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
            }
        };
        document.addEventListener('keydown', keydownListener);

        const outsideClickListener = (e) => {
            if (!container.contains(e.target)) {
                save();
            }
        };
        setTimeout(() => document.addEventListener('mousedown', outsideClickListener), 50);
    },

    _applyEntityUpdate(wrapper, oldId, newId, lines, startIdx, endIdx, entityBlockStart, entityBlockEnd, members) {
        // IDが変更された場合、関係定義のIDも置換する
        if (oldId !== newId) {
            for (let i = startIdx + 1; i < endIdx; i++) {
                const re = new RegExp(`\\b${oldId}\\b`, 'g');
                lines[i] = lines[i].replace(re, newId);
            }
        }

        const newLines = [];
        let insideBlock = false;
        let insertIndex = -1;
        
        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            
            if (i === entityBlockStart) {
                insideBlock = true;
                if (insertIndex === -1) insertIndex = newLines.length;
                continue;
            }
            if (insideBlock) {
                if (i === entityBlockEnd) insideBlock = false;
                continue;
            }
            
            // 単一行の古い定義等のゴミを削除
            if (new RegExp(`^\\s*${oldId}\\b\\s*$`).test(line)) {
                if (insertIndex === -1) insertIndex = newLines.length;
                continue;
            }
            
            newLines.push(line);
        }

        // 新しいブロックを作成
        const block = [];
        block.push(`    ${newId} {`);
        members.forEach(m => block.push(`        ${m}`));
        block.push(`    }`);

        if (insertIndex === -1) {
            let erDiagramIdx = 0;
            for (let i = 0; i < newLines.length; i++) {
                if (/^(?:erDiagram|classDiagram)\b/i.test(newLines[i].trim())) {
                    erDiagramIdx = i + 1;
                    break;
                }
            }
            insertIndex = erDiagramIdx;
        }

        newLines.splice(insertIndex, 0, ...block);
        lines.splice(startIdx + 1, endIdx - startIdx - 1, ...newLines);
        
        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = wrapper.getAttribute('data-line') || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        if (typeof setEditorText === 'function') {
            setEditorText(lines.join('\n'));
            setTimeout(() => {
                if (typeof window.render === 'function') window.render();
                setTimeout(() => {
                    if (window.activeMermaidErToolbar) {
                        window.activeMermaidErToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
                    }
                }, 100);
            }, 50);
        }
    },
    _enhanceRelationHitboxes(wrapper) {
        // SVGが更新された後、既存のヒットボックスを削除
        const existing = wrapper.querySelectorAll('.mermaid-er-arrow-hitbox');
        existing.forEach(el => el.remove());

        // classDiagramの矢印（.edgePath path または path.relation など）
        let edgePaths = Array.from(wrapper.querySelectorAll('.edgePath path:not(.mermaid-er-arrow-hitbox), path.relation:not(.mermaid-er-arrow-hitbox), .er.relationshipLine:not(.mermaid-er-arrow-hitbox)'));
        
        // Dagre-D3のクラス図エッジなどでは marker-end を持つパスも対象にする
        const markerPaths = Array.from(wrapper.querySelectorAll('path[marker-end]:not(.mermaid-er-arrow-hitbox), path[marker-start]:not(.mermaid-er-arrow-hitbox)'));
        markerPaths.forEach(p => {
            if (!edgePaths.includes(p)) edgePaths.push(p);
        });

        edgePaths.forEach((path, index) => {
            if (!path.id) {
                path.id = `er-edge-${index}`;
            }
            const isHitbox = path.classList.contains('mermaid-er-arrow-hitbox');
            if (isHitbox) return;

            const clone = path.cloneNode(true);
            clone.removeAttribute('id');
            clone.classList.add('mermaid-er-arrow-hitbox');
            clone.classList.remove('relation');
            clone.removeAttribute('marker-end');
            clone.removeAttribute('marker-start');
            
            // ヒットボックスのスタイル設定
            clone.style.stroke = 'transparent';
            clone.style.strokeWidth = '15px';
            clone.style.fill = 'none';
            clone.style.pointerEvents = 'stroke';
            clone.style.cursor = 'pointer';

            // 元のパスの直後に挿入
            path.parentNode.insertBefore(clone, path.nextSibling);
        });

        // 2. クラスノードのヒットボックス（タイトル／属性／メソッドの3分割）
        const existingNodeHitboxes = wrapper.querySelectorAll('.mermaid-er-hitbox-title, .mermaid-er-hitbox-attributes, .mermaid-er-hitbox-methods');
        existingNodeHitboxes.forEach(el => el.remove());

        const classNodes = wrapper.querySelectorAll('.node, .node');
        classNodes.forEach(node => {
            try {
                const bBox = node.getBBox();
                if (bBox.width === 0 || bBox.height === 0) return;

                // 横線を探す
                const lines = Array.from(node.querySelectorAll('line'));
                lines.sort((a, b) => parseFloat(a.getAttribute('y1')) - parseFloat(b.getAttribute('y1')));

                let titleEndY = bBox.y + Math.min(30, bBox.height * 0.3);
                let attrEndY = bBox.y + Math.min(60, bBox.height * 0.6);
                
                if (lines.length >= 2) {
                    titleEndY = parseFloat(lines[0].getAttribute('y1'));
                    attrEndY = parseFloat(lines[1].getAttribute('y1'));
                } else if (lines.length === 1) {
                    titleEndY = parseFloat(lines[0].getAttribute('y1'));
                    attrEndY = titleEndY + (bBox.y + bBox.height - titleEndY) / 2;
                } else {
                    titleEndY = bBox.y + bBox.height * 0.33;
                    attrEndY = bBox.y + bBox.height * 0.66;
                }

                // Title hitbox
                const titleRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                titleRect.setAttribute('x', bBox.x);
                titleRect.setAttribute('y', bBox.y);
                titleRect.setAttribute('width', bBox.width);
                titleRect.setAttribute('height', Math.max(0, titleEndY - bBox.y));
                titleRect.setAttribute('class', 'mermaid-er-hitbox-title');
                
                // Attributes hitbox
                const attrRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                attrRect.setAttribute('x', bBox.x);
                attrRect.setAttribute('y', titleEndY);
                attrRect.setAttribute('width', bBox.width);
                attrRect.setAttribute('height', Math.max(0, attrEndY - titleEndY));
                attrRect.setAttribute('class', 'mermaid-er-hitbox-attributes');

                // Methods hitbox
                const methRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                methRect.setAttribute('x', bBox.x);
                methRect.setAttribute('y', attrEndY);
                methRect.setAttribute('width', bBox.width);
                methRect.setAttribute('height', Math.max(0, bBox.y + bBox.height - attrEndY));
                methRect.setAttribute('class', 'mermaid-er-hitbox-methods');

                node.appendChild(titleRect);
                node.appendChild(attrRect);
                node.appendChild(methRect);
            } catch (e) {
                // getBBox() errors on hidden SVGs
            }
        });
    },

    _deleteSelection(wrapper) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;
        
        const selectedNodes = wrapper._selectedNodes;
        const selectedRelations = wrapper._selectedRelations;
        
        if (selectedNodes.size === 0 && selectedRelations.size === 0) return;

        let dataLine = parseInt(wrapper.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = wrapper.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return;

        const lines = getEditorText().split('\n');
        const startIdx = dataLine - 1;
        const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) return;

        const arrowSplitRegex = /\s*(?:<\|--|--\|>|<-->|-->|<--|o--|--o|\*--|--\*|--|\.\.>|<\.\.|\.\.\|>|<\|\.\.|\.\.)\s*/;

        // エッジの削除対象となる行を抽出
        const edgeLinesToRemove = new Set();
        selectedRelations.forEach(edgeId => {
            const rel = this._getRelationFromText(wrapper, edgeId);
            if (rel) {
                edgeLinesToRemove.add(rel.lineIndex);
            }
        });

        const newLines = [];
        let insideBlockFor = null;

        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (insideBlockFor) {
                if (trimmed.startsWith('}')) {
                    insideBlockFor = null;
                }
                continue; // ブロック内なので削除
            }

            // エッジとして直接選択された行は削除
            if (edgeLinesToRemove.has(i)) {
                continue;
            }

            let shouldDelete = false;

            // ノード削除チェック
            for (const mId of selectedNodes) {
                if (new RegExp(`^\\s*class\\s+${mId}\\b\\s*\\{`).test(line)) {
                    insideBlockFor = mId;
                    shouldDelete = true;
                    break;
                }
                if (new RegExp(`^\\s*class\\s+${mId}\\b(?!\\s*\\{)`).test(line) ||
                    new RegExp(`^\\s*<<.+>>\\s+${mId}\\b`).test(line) ||
                    new RegExp(`^\\s*${mId}\\s*:`).test(line)) {
                    shouldDelete = true;
                    break;
                }
                
                // ノードが含まれる矢印行も削除
                if (new RegExp(`\\b${mId}\\b`).test(line) && arrowSplitRegex.test(line)) {
                    shouldDelete = true;
                    break;
                }
            }

            if (!shouldDelete) {
                newLines.push(line);
            }
        }

        lines.splice(startIdx + 1, endIdx - startIdx - 1, ...newLines);
        
        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = wrapper.getAttribute('data-line') || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(lines.join('\n'));

        selectedNodes.clear();
        selectedRelations.clear();

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                if (window.activeMermaidErToolbar) {
                    window.activeMermaidErToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
                }
            }, 100);
        }, 50);

        if (typeof showToast === 'function') showToast('削除しました', 'success');
    },

    _getRelationFromText(diagramContainer, mId) {
        if (typeof getEditorText !== 'function') return null;
        let dataLine = parseInt(diagramContainer.getAttribute('data-line'), 10);
        if (!dataLine || isNaN(dataLine)) {
            const cbw = diagramContainer.closest('.code-block-wrapper');
            if (cbw) dataLine = parseInt(cbw.getAttribute('data-line'), 10);
        }
        if (!dataLine || isNaN(dataLine)) return null;

        const lines = getEditorText().split('\n');
        const startIdx = dataLine - 1;
        const fenceChar = (lines[startIdx] || '').trim().startsWith('~~~') ? '~~~' : '```';
        let endIdx = -1;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === fenceChar) { endIdx = i; break; }
        }
        if (endIdx === -1) return null;

        let edgeIndexToFind = -1;
        if (/^id\d+$/.test(mId)) {
            edgeIndexToFind = parseInt(mId.substring(2), 10) - 1; // "id1" -> 0, "id2" -> 1
        } else if (/^er-edge-(\d+)$/.test(mId)) {
            edgeIndexToFind = parseInt(mId.match(/^er-edge-(\d+)$/)[1], 10);
        } else {
            const m = mId.match(/-(\d+)$/);
            if (m) edgeIndexToFind = parseInt(m[1], 10);
        }
        console.log('[_getRelationFromText] パース対象:', mId, 'Index検索:', edgeIndexToFind);

        const arrowSplitRegex = /^\s*([a-zA-Z0-9_-]+)\s*(".*?"|[\w|{}]*)\s*(--|\.\.)\s*(".*?"|[\w|{}]*)\s*([a-zA-Z0-9_-]+)(?:\s*:\s*(.*))?/;
        let currentEdgeIndex = 0;

        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            const match = line.match(arrowSplitRegex);
            if (match) {
                const [, mFrom, mLeftMulti, mLineType, mRightMulti, mTo, mLabel] = match;
                
                let isMatch = false;
                if (edgeIndexToFind !== -1) {
                    isMatch = (currentEdgeIndex === edgeIndexToFind);
                } else {
                    const parts = mId.replace(/^classId-/, '').replace(/^classDiagram-/, '').replace(/-\d+$/, '').split('-');
                    if (parts.length >= 2) {
                        const from = parts[0];
                        const to = parts[parts.length - 1];
                        isMatch = ((mFrom === from && mTo === to) || (mFrom === to && mTo === from));
                    }
                }

                if (isMatch) {
                    console.log('[_getRelationFromText] パース一致:', match[0]);
                    return {
                        lineIndex: i,
                        lineText: line,
                        from: mFrom,
                        to: mTo,
                        leftMulti: mLeftMulti.replace(/"/g, ''),
                        lineType: mLineType,
                        rightMulti: mRightMulti.replace(/"/g, ''),
                        label: mLabel ? mLabel.trim() : '""'
                    };
                }
                currentEdgeIndex++;
            }
        }
        return null;
    },

    _applyRelationChange(diagramContainer, state) {
        console.log('[_applyRelationChange] 呼ばれました state:', state, 'container:', diagramContainer);
        if (!diagramContainer.classList.contains('mermaid-er-edit-mode')) {
            console.log('[_applyRelationChange] エラー: edit-mode ではありません');
            return;
        }
        if (!diagramContainer._selectedRelations) {
            console.log('[_applyRelationChange] エラー: _selectedRelations が undefined です');
            return;
        }
        if (diagramContainer._selectedRelations.size !== 1) {
            console.log('[_applyRelationChange] エラー: 選択されたエッジ数が 1 ではありません。現在のサイズ:', diagramContainer._selectedRelations.size);
            return;
        }
        
        const mId = Array.from(diagramContainer._selectedRelations)[0];
        console.log('[_applyRelationChange] 対象ID:', mId);
        const rel = this._getRelationFromText(diagramContainer, mId);
        if (!rel) return;

        // 値が変わっていなければ何もしない
        const stateLeft = state.leftMulti ? state.leftMulti.replace(/"/g, '') : '';
        const stateRight = state.rightMulti ? state.rightMulti.replace(/"/g, '') : '';
        
        console.log('[_applyRelationChange] 比較: rel=(', rel.leftMulti, rel.lineType, rel.rightMulti, ') state=(', stateLeft, state.lineType, stateRight, ')');
        if (rel.lineType === state.lineType && rel.leftMulti === stateLeft && rel.rightMulti === stateRight) {
            console.log('[_applyRelationChange] 変更なしのためスキップ');
            return;
        }

        const lines = getEditorText().split('\n');
        
        const label = rel.label && rel.label.trim() !== '' ? rel.label : '""';
        let newLine = `    ${rel.from} ${stateLeft}${state.lineType}${stateRight} ${rel.to} : ${label}`;

        lines[rel.lineIndex] = newLine;

        const savedCodeIndex = diagramContainer.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = diagramContainer.getAttribute('data-line') || diagramContainer.closest('.code-block-wrapper')?.getAttribute('data-line');
        const savedEdgeId    = mId;

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') {
                Promise.resolve(window.render()).then(() => {
                    setTimeout(() => {
                        if (window.activeMermaidErToolbar) {
                            window.activeMermaidErToolbar._restoreEditMode(savedCodeIndex, savedDataLine, savedEdgeId);
                        }
                    }, 50);
                });
            }
        }, 50);
    },

    _applyRelationSwap(diagramContainer) {
        if (!diagramContainer.classList.contains('mermaid-er-edit-mode')) return;
        if (!diagramContainer._selectedRelations || diagramContainer._selectedRelations.size !== 1) return;
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;
        
        const mId = Array.from(diagramContainer._selectedRelations)[0];
        const rel = this._getRelationFromText(diagramContainer, mId);
        if (!rel) return;

        const lines = getEditorText().split('\n');
        
        // 矢印の方向(rel.lineType)は変えずに、始点と終点、多重度を入れ替える
        let newLine = `    ${rel.to} ${rel.rightMulti}${rel.lineType}${rel.leftMulti} ${rel.from}`;

        const colonIdx = rel.lineText.indexOf(':');
        if (colonIdx !== -1) {
            newLine += ` : ${rel.lineText.substring(colonIdx + 1).trim()}`;
        }

        lines[rel.lineIndex] = newLine;

        const savedCodeIndex = diagramContainer.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = diagramContainer.getAttribute('data-line') || diagramContainer.closest('.code-block-wrapper')?.getAttribute('data-line');
        const savedEdgeId    = mId;

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') {
                Promise.resolve(window.render()).then(() => {
                    setTimeout(() => {
                        if (window.activeMermaidErToolbar) {
                            window.activeMermaidErToolbar._restoreEditMode(savedCodeIndex, savedDataLine, savedEdgeId);
                        }
                    }, 50);
                });
            }
        }, 50);
    }
};
