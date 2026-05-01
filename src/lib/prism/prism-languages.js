/**
 * Prism.js Language Bundle
 * 
 * This file loads all necessary language components for syntax highlighting.
 * Languages are loaded in dependency order.
 * 
 * Supported Languages:
 * - JavaScript, TypeScript
 * - Python
 * - Java, C, C++, C#
 * - PHP, Ruby, Swift, VB, Pascal
 * - Go, Rust, MATLAB, Perl, Fortran
 * - HTML, CSS, Markdown
 * - JSON, YAML, XML
 * - Bash/Shell, SQL
 */

// Core language (JavaScript is included in prism.min.js)

// Markup-based languages (XML, HTML)
// Note: prism-markup.min.js provides 'markup', 'html', 'xml', 'svg' support

// Programming Languages
// (Languages are loaded in alphabetical order with dependencies considered)

// Load all language files
(function() {
    'use strict';
    
    // Define base path
    const basePath = 'lib/prism/';
    
    // Define languages in load order (considering dependencies)
    const languages = [
        'prism-markup.min.js',      // HTML, XML, SVG (dependency for many)
        'prism-css.min.js',         // CSS
        'prism-c.min.js',           // C
        'prism-cpp.min.js',         // C++ (depends on C)
        'prism-csharp.min.js',      // C#
        'prism-java.min.js',        // Java
        'prism-python.min.js',      // Python
        'prism-javascript.min.js',  // JavaScript (enhanced)
        'prism-typescript.min.js',  // TypeScript (depends on JavaScript)
        'prism-php.min.js',         // PHP
        'prism-ruby.min.js',        // Ruby
        'prism-swift.min.js',       // Swift
        'prism-go.min.js',          // Go
        'prism-rust.min.js',        // Rust
        'prism-bash.min.js',        // Bash/Shell
        'prism-sql.min.js',         // SQL
        'prism-json.min.js',        // JSON
        'prism-yaml.min.js',        // YAML
        'prism-markdown.min.js',    // Markdown
        'prism-matlab.min.js',      // MATLAB
        'prism-perl.min.js',        // Perl
        'prism-fortran.min.js',     // Fortran
        'prism-pascal.min.js',      // Pascal
        'prism-visual-basic.min.js' // Visual Basic
    ];
    
    // Create and append script tags
    languages.forEach(function(lang) {
        const script = document.createElement('script');
        script.src = basePath + lang;
        script.async = false; // Load in order
        document.head.appendChild(script);
    });
})();
