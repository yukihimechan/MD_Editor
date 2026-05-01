/**
 * MermaidClassInteraction - クラス図におけるインタラクション
 */

window.MermaidClassInteraction = {
    
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
                        if (window.activeMermaidClassToolbar) {
                            window.activeMermaidClassToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
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
                        if (window.activeMermaidClassToolbar) {
                            window.activeMermaidClassToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
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
                        if (window.activeMermaidClassToolbar) {
                            window.activeMermaidClassToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
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
                if (diagramContainer.classList.contains('mermaid-class-edit-mode')) {
                    setTimeout(() => this._enhanceRelationHitboxes(diagramContainer), 150);
                }
            });
            observer.observe(diagramContainer, { attributes: true, attributeFilter: ['class'], subtree: false });
            diagramContainer._classHitboxObserver = observer;
        }
        if (diagramContainer.classList.contains('mermaid-class-edit-mode')) {
            setTimeout(() => this._enhanceRelationHitboxes(diagramContainer), 150);
        }

        // ツールバーでの関係・多重度変更を受け取る
        if (window.activeMermaidClassToolbar) {
            window.activeMermaidClassToolbar.onRelationStateChange = (state) => {
                this._applyRelationChange(diagramContainer, state);
            };
            window.activeMermaidClassToolbar.onRelationSwap = () => {
                this._applyRelationSwap(diagramContainer);
            };
        }

        // 編集モード時のみ有効なスタイルを注入
        if (!document.getElementById('mermaid-class-styles')) {
            const style = document.createElement('style');
            style.id = 'mermaid-class-styles';
            style.textContent = `
                .mermaid-class-edit-mode .classGroup,
                .mermaid-class-edit-mode .node {
                    cursor: pointer !important;
                }
                .mermaid-class-edit-mode .mermaid-class-selected rect:not(.mermaid-class-hitbox-title):not(.mermaid-class-hitbox-members) {
                    stroke: #7c3aed !important;
                    stroke-width: 3px !important;
                    stroke-dasharray: 4,2 !important;
                }
                .mermaid-class-hitbox-title,
                .mermaid-class-hitbox-attributes,
                .mermaid-class-hitbox-methods {
                    display: none;
                }
                .mermaid-class-edit-mode .mermaid-class-hitbox-title,
                .mermaid-class-edit-mode .mermaid-class-hitbox-attributes,
                .mermaid-class-edit-mode .mermaid-class-hitbox-methods {
                    display: block;
                    fill: transparent !important;
                    stroke: transparent !important;
                    pointer-events: all;
                    transition: fill 0.2s;
                }
                .mermaid-class-edit-mode .mermaid-class-hitbox-title:hover {
                    fill: rgba(124, 58, 237, 0.15) !important;
                }
                .mermaid-class-edit-mode .mermaid-class-hitbox-attributes:hover {
                    fill: rgba(34, 197, 94, 0.15) !important;
                }
                .mermaid-class-edit-mode .mermaid-class-hitbox-methods:hover {
                    fill: rgba(239, 68, 68, 0.15) !important;
                }
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

    _onClick(e, diagramContainer) {
        if (!diagramContainer.classList.contains('mermaid-class-edit-mode')) return;

        const classGroup = e.target.closest('.classGroup, .node');
        const edgeHitbox = e.target.closest('.mermaid-class-arrow-hitbox, .edgePath path, path.relation');
        const selectedNodes = diagramContainer._selectedNodes;
        const selectedRelations = diagramContainer._selectedRelations;
        
        const isMultiSelect = e.ctrlKey || e.metaKey || e.shiftKey;

        if (edgeHitbox && !classGroup) {
            e.stopPropagation();
            let targetPath = edgeHitbox;
            if (edgeHitbox.classList.contains('mermaid-class-arrow-hitbox')) {
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

        if (classGroup) {
            e.stopPropagation();
            const mId = this._getMermaidClassId(classGroup);
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
        if (!diagramContainer.classList.contains('mermaid-class-edit-mode')) return;
        
        const classGroup = e.target.closest('.classGroup, .node');
        if (classGroup) {
            e.stopPropagation();
            
            // ヒットボックス優先で判定
            let editTarget = 'title'; // 'title', 'attributes', 'methods'
            if (e.target.classList.contains('mermaid-class-hitbox-attributes')) {
                editTarget = 'attributes';
            } else if (e.target.classList.contains('mermaid-class-hitbox-methods')) {
                editTarget = 'methods';
            } else if (e.target.classList.contains('mermaid-class-hitbox-title')) {
                editTarget = 'title';
            } else {
                // ヒットボックスがない場合のフォールバック
                const y = e.target.y?.baseVal?.value || e.clientY;
                const bBox = classGroup.getBBox();
                if (y < bBox.y + 30) editTarget = 'title';
                else if (y < bBox.y + bBox.height * 0.6) editTarget = 'attributes';
                else editTarget = 'methods';
            }
                            
            this._editClassInline(classGroup, diagramContainer, editTarget, e);
        }
    },

    _onContextMenu(e, diagramContainer) {
        if (!diagramContainer.classList.contains('mermaid-class-edit-mode')) return;
        
        const classGroup = e.target.closest('.classGroup, .node');
        const edgeHitbox = e.target.closest('.mermaid-class-arrow-hitbox, .edgePath path, path.relation');
        const selectedNodes = diagramContainer._selectedNodes || new Set();
        const selectedRelations = diagramContainer._selectedRelations || new Set();
        
        if (classGroup) {
            e.preventDefault();
            e.stopPropagation();
            
            const mId = this._getMermaidClassId(classGroup);
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
            if (edgeHitbox.classList.contains('mermaid-class-arrow-hitbox')) {
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
        
        const nodes = diagramContainer.querySelectorAll('.classGroup, .node');
        nodes.forEach(node => {
            const mId = this._getMermaidClassId(node);
            if (mId && selectedNodes.has(mId)) {
                node.classList.add('mermaid-class-selected');
                const rect = node.getBoundingClientRect();
                this._drawHandles(overlay, { el: node, id: mId, rect }, diagramContainer);
            }
        });

        const edges = diagramContainer.querySelectorAll('.edgePath path:not(.mermaid-class-arrow-hitbox), path.relation:not(.mermaid-class-arrow-hitbox)');
        const wRect = diagramContainer.getBoundingClientRect();

        edges.forEach(edge => {
            const mId = edge.id || (edge.parentNode && edge.parentNode.id);
            if (mId && selectedRelations.has(mId)) {
                const rect = edge.getBoundingClientRect();
                
                const selBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                const x = rect.left - wRect.left;
                const y = rect.top - wRect.top;
                
                selBox.setAttribute('x', x - 4);
                selBox.setAttribute('y', y - 4);
                selBox.setAttribute('width', rect.width + 8);
                selBox.setAttribute('height', rect.height + 8);
                selBox.setAttribute('fill', 'rgba(59, 130, 246, 0.1)'); // 薄い青色
                selBox.setAttribute('stroke', '#3b82f6'); // 青色の点線
                selBox.setAttribute('stroke-width', '2');
                selBox.setAttribute('stroke-dasharray', '4,4');
                selBox.classList.add('mermaid-class-selection-overlay');
                
                overlay.appendChild(selBox);
            }
        });

        // 単一の矢印が選択されている場合、ツールバーに反映させる
        if (selectedRelations.size === 1 && window.activeMermaidClassToolbar) {
            const mId = Array.from(selectedRelations)[0];
            console.log('[_updateSelectionUI] 選択された矢印のID:', mId);
            const rel = this._getRelationFromText(diagramContainer, mId);
            console.log('[_updateSelectionUI] 取得した矢印のデータ:', rel);
            if (rel) {
                // 循環参照ループを防ぐためイベントハンドラを一時無効化するか、値が違う場合のみセット
                console.log('[_updateSelectionUI] ツールバーにセットします:', rel.arrow, rel.leftMulti, rel.rightMulti);
                window.activeMermaidClassToolbar.setRelationState(rel.arrow, rel.leftMulti, rel.rightMulti);
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
        const selected = diagramContainer.querySelectorAll('.mermaid-class-selected, .mermaid-class-arrow-selected');
        selected.forEach(el => {
            el.classList.remove('mermaid-class-selected');
            el.classList.remove('mermaid-class-arrow-selected');
        });
        const overlay = diagramContainer.querySelector('.mermaid-class-overlay-svg');
        if (overlay) {
            Array.from(overlay.children).forEach(c => {
                if (c.tagName.toLowerCase() !== 'defs') overlay.removeChild(c);
            });
        }
    },

    _getMermaidClassId(el) {
        // classDiagram-ClassName-数字 の形式
        const id = el.id || '';
        const m = id.match(/^classId-(.+?)-\d+$/) || id.match(/^classDiagram-(.+?)-\d+$/);
        if (m) return m[1];
        
        // もし id がない場合、内部の text 要素などから取得を試みる
        const titleEl = el.querySelector('.classTitle, .title');
        if (titleEl) return titleEl.textContent.trim();
        
        return null;
    },

    _ensureOverlay(wrapper) {
        let overlay = wrapper.querySelector('.mermaid-class-overlay-svg');
        if (!overlay) {
            overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            overlay.classList.add('mermaid-class-overlay-svg');
            overlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100;';
            overlay.innerHTML = `
                <defs>
                  <marker id="mi-class-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
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
            tri.classList.add('mermaid-class-connect-handle');
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
        line.setAttribute('marker-end', 'url(#mi-class-arrow)');
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
        const nodeEls = svgEl.querySelectorAll('g.classGroup, g.node');
        nodeEls.forEach(g => {
            const mId = this._getMermaidClassId(g);
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
        let relation = '-->'; // default
        if (window.activeMermaidClassToolbar) {
            relation = window.activeMermaidClassToolbar.getSelectedRelationType();
        }

        const arrowLine = `    ${fromId} ${relation} ${toId}`;
        lines.splice(endIdx, 0, arrowLine);

        const savedCodeIndex = wrapper.closest('.code-block-wrapper')?.dataset?.codeIndex;
        const savedDataLine  = wrapper.getAttribute('data-line') || wrapper.closest('.code-block-wrapper')?.getAttribute('data-line');

        setEditorText(lines.join('\n'));

        setTimeout(() => {
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                if (window.activeMermaidClassToolbar) {
                    window.activeMermaidClassToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
                }
            }, 100);
        }, 50);

        if (typeof showToast === 'function') showToast(`${fromId} と ${toId} を接続しました`, 'success');
    },

    _editClassInline(classGroup, wrapper, editTarget, e) {
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;

        const mId = this._getMermaidClassId(classGroup);
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

        // クラス定義ブロックを抽出
        let classBlockStart = -1;
        let classBlockEnd = -1;
        let members = [];
        let annotation = '';
        
        // 1. "class X {" ブロックを探す
        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            if (new RegExp(`^\\s*class\\s+${mId}\\s*\\{`).test(line)) {
                classBlockStart = i;
                // annotation と members を収集
                for (let j = i + 1; j < endIdx; j++) {
                    const innerLine = lines[j];
                    if (/^\s*\}/.test(innerLine)) {
                        classBlockEnd = j;
                        break;
                    }
                    const trimmed = innerLine.trim();
                    if (trimmed.startsWith('<<') && trimmed.endsWith('>>')) {
                        annotation = trimmed.replace(/^<</, '').replace(/>>$/, '');
                    } else if (trimmed !== '') {
                        members.push(trimmed);
                    }
                }
                break;
            }
        }

        // ブロックがない場合、"class X" や "X : member" などの単一行定義を探す
        if (classBlockStart === -1) {
            for (let i = startIdx + 1; i < endIdx; i++) {
                const line = lines[i];
                if (new RegExp(`^\\s*class\\s+${mId}\\b(?!\\s*\\{)`).test(line)) {
                    // "class X" または "class X { ..." (インライン？通常ないが)
                    // 何もしない、単にクラスが存在するだけ
                }
                // アノテーション "<<stereo>> X" 
                if (new RegExp(`^\\s*<<.+>>\\s+${mId}\\b`).test(line)) {
                    const match = line.match(/^\s*<<(.+)>>/);
                    if (match) annotation = match[1];
                }
                // メンバー "X : type name"
                if (new RegExp(`^\\s*${mId}\\s*:\\s*(.+)`).test(line)) {
                    const match = line.match(new RegExp(`^\\s*${mId}\\s*:\\s*(.+)`));
                    if (match) members.push(match[1].trim());
                }
            }
        }

        const rect = classGroup.getBoundingClientRect();
        
        // メンバーをプロパティとメソッドに分離
        const attributes = [];
        const methods = [];
        members.forEach(m => {
            if (m.includes('(') || m.includes(')')) methods.push(m);
            else attributes.push(m);
        });

        if (editTarget === 'title') {
            // タイトルとステレオタイプの編集
            this._showTitleEditor(wrapper, rect, mId, annotation, startIdx, endIdx, lines, classBlockStart, classBlockEnd, members);
        } else if (editTarget === 'attributes') {
            // プロパティ(属性)の編集
            this._showMemberEditor(wrapper, classGroup, mId, attributes, methods, 'attributes', startIdx, endIdx, lines, classBlockStart, classBlockEnd, annotation);
        } else if (editTarget === 'methods') {
            // メソッドの編集
            this._showMemberEditor(wrapper, classGroup, mId, methods, attributes, 'methods', startIdx, endIdx, lines, classBlockStart, classBlockEnd, annotation);
        }
    },

    _showTitleEditor(wrapper, rect, mId, annotation, startIdx, endIdx, lines, classBlockStart, classBlockEnd, members) {
        const container = document.createElement('div');
        container.style.cssText = `
            position: absolute;
            background: white;
            border: 1px solid #7c3aed;
            padding: 8px;
            border-radius: 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;
        
        // ステレオタイプ入力
        const inputAnno = document.createElement('input');
        inputAnno.type = 'text';
        inputAnno.value = annotation;
        inputAnno.placeholder = 'interface, abstract, etc...';
        inputAnno.style.cssText = 'width: 150px; font-size: 12px; padding: 2px 4px; border: 1px solid #ccc; font-family: monospace;';
        
        // クラス名入力
        const inputName = document.createElement('input');
        inputName.type = 'text';
        inputName.value = mId;
        inputName.style.cssText = 'width: 150px; font-size: 14px; font-weight: bold; padding: 2px 4px; border: 1px solid #ccc; font-family: monospace;';
        
        const annoWrapper = document.createElement('div');
        annoWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px;';
        
        const leftBracket = document.createElement('span');
        leftBracket.textContent = '<<';
        leftBracket.style.fontFamily = 'monospace';
        
        const rightBracket = document.createElement('span');
        rightBracket.textContent = '>>';
        rightBracket.style.fontFamily = 'monospace';

        annoWrapper.appendChild(leftBracket);
        annoWrapper.appendChild(inputAnno);
        annoWrapper.appendChild(rightBracket);
        
        container.appendChild(annoWrapper);
        container.appendChild(inputName);

        const wRect = wrapper.getBoundingClientRect();
        container.style.top = (rect.top - wRect.top) + 'px';
        container.style.left = (rect.left - wRect.left) + 'px';

        wrapper.appendChild(container);
        inputName.focus();
        inputName.select();

        let isClosed = false;
        const cleanup = () => {
            if (isClosed) return;
            isClosed = true;
            document.removeEventListener('mousedown', clickOutside);
            container.remove();
        };

        const save = () => {
            if (isClosed) return;
            const newName = inputName.value.trim();
            const newAnno = inputAnno.value.trim();
            if (newName) {
                this._applyClassRenameAndAnno(wrapper, mId, newName, newAnno, lines, startIdx, endIdx, classBlockStart, classBlockEnd, members);
            }
            cleanup();
        };

        inputName.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cleanup(); });
        inputAnno.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cleanup(); });
        
        // 外部クリックで保存
        const clickOutside = (e) => {
            if (!container.contains(e.target)) {
                save();
            }
        };
        setTimeout(() => document.addEventListener('mousedown', clickOutside), 10);
    },

    _showMemberEditor(wrapper, classGroup, mId, editingMembers, otherMembers, editTarget, startIdx, endIdx, lines, classBlockStart, classBlockEnd, annotation) {
        const textarea = document.createElement('textarea');
        textarea.value = editingMembers.join('\n');
        textarea.placeholder = editTarget === 'attributes' 
            ? '属性を1行ずつ入力\n例:\n+String name\n+int age' 
            : 'メソッドを1行ずつ入力\n例:\n+getName() String\n+makeSound()';
            
        textarea.style.cssText = `
            position: absolute;
            background: #ffe;
            border: 2px solid ${editTarget === 'attributes' ? '#22c55e' : '#ef4444'};
            padding: 4px;
            font-size: 13px;
            font-family: monospace;
            z-index: 1000;
            resize: both;
            outline: none;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        
        const wRect = wrapper.getBoundingClientRect();
        const cgRect = classGroup.getBoundingClientRect();
        
        // svg座標での表示位置を特定
        const linesSvg = Array.from(classGroup.querySelectorAll('line')).sort((a,b) => parseFloat(a.getAttribute('y1')) - parseFloat(b.getAttribute('y1')));
        let topOffset = 30;
        let boxHeight = 80;
        
        if (editTarget === 'attributes') {
            topOffset = linesSvg.length > 0 ? parseFloat(linesSvg[0].getAttribute('y1')) - classGroup.getBBox().y : cgRect.height * 0.3;
            boxHeight = linesSvg.length > 1 ? parseFloat(linesSvg[1].getAttribute('y1')) - parseFloat(linesSvg[0].getAttribute('y1')) : 60;
        } else {
            topOffset = linesSvg.length > 1 ? parseFloat(linesSvg[1].getAttribute('y1')) - classGroup.getBBox().y : cgRect.height * 0.6;
            boxHeight = 60;
        }
        
        textarea.style.top = (cgRect.top - wRect.top + topOffset) + 'px';
        textarea.style.left = (cgRect.left - wRect.left) + 'px';
        textarea.style.width = Math.max(200, cgRect.width) + 'px';
        textarea.style.height = Math.max(60, boxHeight) + 'px';

        wrapper.appendChild(textarea);
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length); // 末尾にカーソル

        let isClosed = false;
        const cleanup = () => {
            if (isClosed) return;
            isClosed = true;
            document.removeEventListener('mousedown', clickOutside);
            textarea.remove();
        };

        const save = () => {
            if (isClosed) return;
            const newValues = textarea.value.split('\n').map(s => s.trim()).filter(s => s);
            
            // 属性とメソッドを結合して全体のmembersを再構築
            const mergedMembers = editTarget === 'attributes' 
                ? [...newValues, ...otherMembers] 
                : [...otherMembers, ...newValues];
                
            this._applyMembers(wrapper, mId, mergedMembers, annotation, lines, startIdx, endIdx, classBlockStart, classBlockEnd);
            cleanup();
        };

        // Ctrl+Enterで保存、Escapeでキャンセル
        textarea.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
            } else if (e.key === 'Escape') {
                cleanup();
            }
        });

        // 外部クリックで保存
        const clickOutside = (e) => {
            if (e.target !== textarea) {
                save();
            }
        };
        setTimeout(() => document.addEventListener('mousedown', clickOutside), 10);
    },

    _applyClassRenameAndAnno(wrapper, oldId, newId, newAnno, lines, startIdx, endIdx, classBlockStart, classBlockEnd, members) {
        // ID変更がある場合、関係定義のIDも置換する
        if (oldId !== newId) {
            for (let i = startIdx + 1; i < endIdx; i++) {
                // \b を使って単語境界で置換
                const re = new RegExp(`\\b${oldId}\\b`, 'g');
                lines[i] = lines[i].replace(re, newId);
            }
        }

        // アノテーションとメンバーを更新
        this._applyMembers(wrapper, newId, members, newAnno, lines, startIdx, endIdx, classBlockStart, classBlockEnd);
    },

    _applyMembers(wrapper, mId, members, annotation, lines, startIdx, endIdx, classBlockStart, classBlockEnd) {
        const newLines = [];
        let insideBlock = false;
        let insertIndex = -1;
        
        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            
            // ブロック内
            if (i === classBlockStart) {
                insideBlock = true;
                if (insertIndex === -1) insertIndex = newLines.length;
                continue;
            }
            if (insideBlock) {
                if (i === classBlockEnd) insideBlock = false;
                continue;
            }

            // 単一行定義をスキップ
            if (new RegExp(`^\\s*class\\s+${mId}\\b(?!\\s*\\{)`).test(line)) {
                if (insertIndex === -1) insertIndex = newLines.length;
                continue;
            }
            if (new RegExp(`^\\s*<<.+>>\\s+${mId}\\b`).test(line)) {
                if (insertIndex === -1) insertIndex = newLines.length;
                continue;
            }
            if (new RegExp(`^\\s*${mId}\\s*:\\s*`).test(line)) {
                if (insertIndex === -1) insertIndex = newLines.length;
                continue;
            }
            
            newLines.push(line);
        }

        // 新しいブロックを作成して挿入
        const block = [];
        block.push(`    class ${mId} {`);
        if (annotation) block.push(`        <<${annotation}>>`);
        members.forEach(m => block.push(`        ${m}`));
        block.push(`    }`);

        // クラス定義が元々存在しなかった場合（関係による暗黙定義など）は、classDiagramの次の行に挿入
        if (insertIndex === -1) {
            let classDiagramIdx = 0;
            for (let i = 0; i < newLines.length; i++) {
                if (/^classDiagram\b/i.test(newLines[i].trim())) {
                    classDiagramIdx = i + 1;
                    break;
                }
            }
            insertIndex = classDiagramIdx;
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
                    if (window.activeMermaidClassToolbar) {
                        window.activeMermaidClassToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
                    }
                }, 100);
            }, 50);
        }
    },

    _enhanceRelationHitboxes(wrapper) {
        // SVGが更新された後、既存のヒットボックスを削除
        const existing = wrapper.querySelectorAll('.mermaid-class-arrow-hitbox');
        existing.forEach(el => el.remove());

        // classDiagramの矢印（.edgePath path または path.relation など）
        let edgePaths = Array.from(wrapper.querySelectorAll('.edgePath path:not(.mermaid-class-arrow-hitbox), path.relation:not(.mermaid-class-arrow-hitbox)'));
        
        // Dagre-D3のクラス図エッジなどでは marker-end を持つパスも対象にする
        const markerPaths = Array.from(wrapper.querySelectorAll('path[marker-end]:not(.mermaid-class-arrow-hitbox), path[marker-start]:not(.mermaid-class-arrow-hitbox)'));
        markerPaths.forEach(p => {
            if (!edgePaths.includes(p)) edgePaths.push(p);
        });

        edgePaths.forEach(path => {
            const isHitbox = path.classList.contains('mermaid-class-arrow-hitbox');
            if (isHitbox) return;

            const clone = path.cloneNode(true);
            clone.classList.add('mermaid-class-arrow-hitbox');
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
        const existingNodeHitboxes = wrapper.querySelectorAll('.mermaid-class-hitbox-title, .mermaid-class-hitbox-attributes, .mermaid-class-hitbox-methods');
        existingNodeHitboxes.forEach(el => el.remove());

        const classNodes = wrapper.querySelectorAll('.classGroup, .node');
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
                titleRect.setAttribute('class', 'mermaid-class-hitbox-title');
                
                // Attributes hitbox
                const attrRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                attrRect.setAttribute('x', bBox.x);
                attrRect.setAttribute('y', titleEndY);
                attrRect.setAttribute('width', bBox.width);
                attrRect.setAttribute('height', Math.max(0, attrEndY - titleEndY));
                attrRect.setAttribute('class', 'mermaid-class-hitbox-attributes');

                // Methods hitbox
                const methRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                methRect.setAttribute('x', bBox.x);
                methRect.setAttribute('y', attrEndY);
                methRect.setAttribute('width', bBox.width);
                methRect.setAttribute('height', Math.max(0, bBox.y + bBox.height - attrEndY));
                methRect.setAttribute('class', 'mermaid-class-hitbox-methods');

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
                if (window.activeMermaidClassToolbar) {
                    window.activeMermaidClassToolbar._restoreEditMode(savedCodeIndex, savedDataLine);
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
        }
        console.log('[_getRelationFromText] パース対象:', mId, 'Index検索:', edgeIndexToFind);

        const arrowSplitRegex = /^\s*([a-zA-Z0-9_]+)(?:\s+"([^"]+)")?\s*(<\|--|--\|>|<-->|-->|<--|o--|--o|\*--|--\*|--|\.\.>|<\.\.|\.\.\|>|<\|\.\.|\.\.)(?:\s+"([^"]+)")?\s+([a-zA-Z0-9_]+)/;
        let currentEdgeIndex = 0;

        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = lines[i];
            const match = line.match(arrowSplitRegex);
            if (match) {
                const [, mFrom, mLeftMulti, mArrow, mRightMulti, mTo] = match;
                
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
                        leftMulti: mLeftMulti || '',
                        rightMulti: mRightMulti || '',
                        arrow: mArrow
                    };
                }
                currentEdgeIndex++;
            }
        }
        return null;
    },

    _applyRelationChange(diagramContainer, state) {
        console.log('[_applyRelationChange] 呼ばれました state:', state, 'container:', diagramContainer);
        if (!diagramContainer.classList.contains('mermaid-class-edit-mode')) {
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
        
        console.log('[_applyRelationChange] 比較: rel=(', rel.leftMulti, rel.arrow, rel.rightMulti, ') state=(', stateLeft, state.type, stateRight, ')');
        if (rel.arrow === state.type && rel.leftMulti === stateLeft && rel.rightMulti === stateRight) {
            console.log('[_applyRelationChange] 変更なしのためスキップ');
            return;
        }

        const lines = getEditorText().split('\n');
        
        let newLine = `    ${rel.from}`;
        if (state.leftMulti) newLine += ` ${state.leftMulti}`;
        newLine += ` ${state.type}`;
        if (state.rightMulti) newLine += ` ${state.rightMulti}`;
        newLine += ` ${rel.to}`;

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
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                if (window.activeMermaidClassToolbar) {
                    window.activeMermaidClassToolbar._restoreEditMode(savedCodeIndex, savedDataLine, savedEdgeId);
                }
            }, 100);
        }, 50);
    },

    _applyRelationSwap(diagramContainer) {
        if (!diagramContainer.classList.contains('mermaid-class-edit-mode')) return;
        if (!diagramContainer._selectedRelations || diagramContainer._selectedRelations.size !== 1) return;
        if (typeof getEditorText !== 'function' || typeof setEditorText !== 'function') return;
        
        const mId = Array.from(diagramContainer._selectedRelations)[0];
        const rel = this._getRelationFromText(diagramContainer, mId);
        if (!rel) return;

        const lines = getEditorText().split('\n');
        
        // 矢印の方向(rel.arrow)は変えずに、始点と終点、多重度を入れ替える
        let newLine = `    ${rel.to}`;
        if (rel.rightMulti) newLine += ` "${rel.rightMulti}"`;
        newLine += ` ${rel.arrow}`;
        if (rel.leftMulti) newLine += ` "${rel.leftMulti}"`;
        newLine += ` ${rel.from}`;

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
            if (typeof window.render === 'function') window.render();
            setTimeout(() => {
                if (window.activeMermaidClassToolbar) {
                    window.activeMermaidClassToolbar._restoreEditMode(savedCodeIndex, savedDataLine, savedEdgeId);
                }
            }, 100);
        }, 50);
    }
};
