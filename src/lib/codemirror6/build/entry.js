import { EditorView, basicSetup, minimalSetup } from "codemirror"
import { EditorState, Compartment, StateEffect, StateField } from "@codemirror/state"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { html } from "@codemirror/lang-html"
import { languages } from "@codemirror/language-data"
import { oneDark } from "@codemirror/theme-one-dark"
import { keymap, Decoration, WidgetType, MatchDecorator, ViewPlugin } from "@codemirror/view"
import { defaultKeymap, history, historyKeymap, undo, redo, undoDepth, redoDepth } from "@codemirror/commands"
import { searchKeymap, search } from "@codemirror/search"
import { foldEffect, unfoldEffect, codeFolding, foldService, foldable, foldCode, unfoldCode, syntaxHighlighting, defaultHighlightStyle, HighlightStyle, LanguageDescription, foldedRanges, foldState } from "@codemirror/language"
import { tags } from "@lezer/highlight"
import { autocompletion, completionKeymap, startCompletion } from "@codemirror/autocomplete"

window.CM6 = {
    EditorView,
    EditorState,
    basicSetup,
    minimalSetup,
    markdown,
    markdownLanguage,
    html,
    languages,
    LanguageDescription,
    oneDark,
    Compartment,
    keymap,
    defaultKeymap,
    history,
    historyKeymap,
    searchKeymap,
    search,
    StateEffect,
    StateField,
    Decoration,
    WidgetType,
    MatchDecorator,
    ViewPlugin,
    foldEffect,
    unfoldEffect,
    codeFolding,
    foldService,
    foldable,
    foldCode,
    unfoldCode,
    foldedRanges,
    foldState,
    syntaxHighlighting,
    defaultHighlightStyle,
    HighlightStyle,
    tags,
    undo,
    redo,
    undoDepth,
    redoDepth,
    autocompletion,
    completionKeymap,
    startCompletion
};
