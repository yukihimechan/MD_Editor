/**
 * front_matter_parser.js
 * Parses YAML Front Matter at the beginning of the Markdown document.
 */

if (typeof AppState === 'undefined') {
    window.AppState = {};
}

function markdownItFrontMatterPlugin(md) {
    // block ruler to parse front matter
    md.block.ruler.before('table', 'front_matter', function (state, startLine, endLine, silent) {
        // Front Matter must be at the very first line
        if (startLine !== 0) return false;

        let start = state.bMarks[startLine] + state.tShift[startLine];
        let max = state.eMarks[startLine];

        // Check for '---'
        if (state.src.charCodeAt(start) !== 0x2D || /* - */
            state.src.charCodeAt(start + 1) !== 0x2D ||
            state.src.charCodeAt(start + 2) !== 0x2D) {
            return false;
        }

        let nextLine = startLine + 1;
        let endLineNum = -1;

        while (nextLine < endLine) {
            start = state.bMarks[nextLine] + state.tShift[nextLine];
            max = state.eMarks[nextLine];

            // Check for closing '---'
            if (state.src.charCodeAt(start) === 0x2D &&
                state.src.charCodeAt(start + 1) === 0x2D &&
                state.src.charCodeAt(start + 2) === 0x2D) {
                // Must be exactly '---' or trailing spaces
                let idx = start + 3;
                let valid = true;
                while (idx < max) {
                    const char = state.src.charCodeAt(idx);
                    if (char !== 0x20 /* space */ && char !== 0x09 /* tab */) {
                        valid = false;
                        break;
                    }
                    idx++;
                }
                if (valid) {
                    endLineNum = nextLine;
                    break;
                }
            }
            nextLine++;
        }

        if (endLineNum < 0) return false;

        if (silent) return true;

        // Consume the lines
        state.line = endLineNum + 1;

        // Create token
        let token = state.push('front_matter', '', 0);
        const yamlStr = state.getLines(startLine + 1, endLineNum, 0, false);
        token.content = yamlStr;
        token.map = [startLine, state.line];

        return true;
    });

    md.renderer.rules.front_matter = function (tokens, idx) {
        const token = tokens[idx];
        const yamlStr = token.content;

        try {
            if (typeof jsyaml !== 'undefined') {
                AppState.frontMatter = jsyaml.load(yamlStr) || {};
                console.log('[FrontMatter] Parsed successfully:', AppState.frontMatter);
            } else {
                console.warn('[FrontMatter] js-yaml is not loaded');
                AppState.frontMatter = {};
            }
        } catch (e) {
            console.warn('[FrontMatter] Parse Error:', e);
            AppState.frontMatter = {};
        }

        // Return a hidden div with data-line so source line mapping is preserved
        const startLine = token.map[0];
        const endLine = token.map[1] - 1;
        // Output invisible elements for every line so that scroll sync isn't broken
        let htmlStr = '';
        for (let i = startLine; i <= endLine; i++) {
            htmlStr += `<div class="front-matter-hidden" style="display: none;" data-line="${i}"></div>\n`;
        }
        return htmlStr;
    };
}

window.markdownItFrontMatterPlugin = markdownItFrontMatterPlugin;
