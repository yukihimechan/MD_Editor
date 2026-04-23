/**
 * Templates for Markdown Editor
 * This is loaded via <script> to allow usage in local file systems (avoid CORS).
 */
const MD_TEMPLATES = {
    'ja': [
        {
            id: 'meeting-minutes',
            title: '議事録',
            content: `
# 議事録

## 開催概要
- **日時**: 2026年06月15日 13:00 - 15:00
- **場所**: 
- **出席者**: 

## 議題

### 1. 〇〇について
 - 
 - 
### 2. ××について
 - 
 - 
## 決定事項
- 
- 
- 次回予定：2026/06/15 〇〇会議室にて実施

## TODO
- [ ] 担当者:〇〇 内容 (期限: 6月15日)
- [ ] 担当者:×× 内容 (期限: 6月15日)

## 備考
- 特になし。
\n`
        },
        {
            id: 'design-doc',
            title: '設計書',
            content: `
# 設計書: [タイトル]

## 1. 目的
[このドキュメントが解決しようとする課題や、達成したい目標について記述します]

## 2. 背景
[なぜこの設計が必要なのか、現状の課題や経緯について記述します]

## 3. システム概要
[全体的な構成や、主要なコンポーネントの役割について記述します]

### 3.1. 構成図

### 3.2. 構成内容

## 4. 画面

### 画面一覧

### 4.1. ログイン画面

## 5. 機能

### 機能一覧

### 5.1. 表示機能

## 6. 非機能

### 非機能一覧

### 6.1. バックアップ


以上

\n`
        }
    ],
    'en': [
        {
            id: 'meeting-minutes',
            title: 'Meeting Minutes',
            content: `
# Meeting Minutes

## Logistical Context
- **Date/Time**: Jun 15, 2026 13:00 - 15:00
- **Location**: 
- **Attendees**: 

## Agenda

### 1. Regarding 〇〇
 - 
 - 
### 2. Regarding ××
 - 
 - 
## Decisions Made
- 
- 
- Next Meeting: Jun 15, 2026 at 〇〇 Meeting Room

## Action Items
- [ ] Assignee:〇〇 Task (Due: Jun 15)
- [ ] Assignee:×× Task (Due: Jun 15)

## Notes
- None.
\n`
        },
        {
            id: 'design-doc',
            title: 'Design Document',
            content: `
# Design Document: [Title]

## 1. Objective
[Describe the problem this document aims to solve or the goals it intends to achieve]

## 2. Background
[Describe why this design is necessary, current challenges, and the context]

## 3. System Overview
[Describe the overall architecture and the roles of key components]

### 3.1. Architecture Diagram

### 3.2. Architecture Details

## 4. UI/Screens

### Screen List

### 4.1. Login Screen

## 5. Features

### Feature List

### 5.1. Display Feature

## 6. Non-Functional Requirements

### Requirement List

### 6.1. Backup


End of document

\n`
        }
    ]
};
