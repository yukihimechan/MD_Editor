/**
 * Templates for Markdown Editor
 * This is loaded via <script> to allow usage in local file systems (avoid CORS).
 */
const MD_TEMPLATES = {
    'meeting-minutes': `# 議事録\n\n## 開催概要\n- **日時**: 202X年XX月XX日 XX:00 - XX:00\n- **場所**: \n- **出席者**: \n\n## 議題\n1. \n2. \n\n## 決定事項\n- \n\n## ネクストアクション\n- [ ] 担当者: 内容 (期限: XX/XX)\n\n## 備考\n- \n`,

    'design-doc': `# 設計書: [タイトル]\n\n## 1. 目的\n[このドキュメントが解決しようとする課題や、達成したい目標について記述します]\n\n## 2. 背景\n[なぜこの設計が必要なのか、現状の課題や経緯について記述します]\n\n## 3. システム概要\n[全体的な構成や、主要なコンポーネントの役割について記述します]\n\n## 4. 詳細設計\n### 4.1. データ構造\n\n### 4.2. アルゴリズム / 処理フロー\n\n## 5. 検証項目\n- [ ] \n\n## 6. 懸念点 / 今後の課題\n- \n`
};
