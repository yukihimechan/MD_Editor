/**
 * SVG Templates for Markdown Editor
 */
const SVG_TEMPLATES = {
    'ja': [
        {
            id: 'svg-system-arch',
            title: '新規作成',
            content: '```svg\n<svg width="820" height="350" viewBox="0 0 820 350" xmlns="http://www.w3.org/2000/svg">\n  </svg>\n```\n'
        },
        {
            id: 'svg-system-arch',
            title: 'システム構成図',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="10" y="10" width="800" height="430" fill="#f9f9f9" stroke="#ccc" stroke-width="2" rx="10"/>\n  <text x="410" y="40" font-family="Arial" font-size="20" text-anchor="middle" font-weight="bold">システム構成図</text>\n  <!-- クライアント -->\n  <rect x="50" y="150" width="120" height="60" fill="#e1f5fe" stroke="#01579b" rx="5"/>\n  <text x="110" y="185" font-family="Arial" font-size="14" text-anchor="middle">クライアント</text>\n  <!-- サーバー -->\n  <rect x="350" y="150" width="120" height="60" fill="#fff3e0" stroke="#ff6f00" rx="5"/>\n  <text x="410" y="185" font-family="Arial" font-size="14" text-anchor="middle">Webサーバー</text>\n  <!-- データベース -->\n  <rect x="650" y="150" width="120" height="60" fill="#e8f5e9" stroke="#1b5e20" rx="5"/>\n  <text x="710" y="185" font-family="Arial" font-size="14" text-anchor="middle">データベース</text>\n  <!-- 矢印 -->\n  <line x1="170" y1="180" x2="350" y2="180" stroke="#333" stroke-width="2" marker-end="url(#arrow)"/>\n  <line x1="470" y1="180" x2="650" y2="180" stroke="#333" stroke-width="2" marker-end="url(#arrow)"/>\n  <defs>\n    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">\n      <path d="M0,0 L10,5 L0,10 Z" fill="#333" />\n    </marker>\n  </defs>\n</svg>\n```\n'
        },
        {
            id: 'svg-server-arch',
            title: 'サーバ構成図',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="10" y="10" width="800" height="430" fill="#f0f4f8" stroke="#334e68" stroke-width="2" rx="10"/>\n  <text x="410" y="40" font-family="Arial" font-size="20" text-anchor="middle" font-weight="bold">サーバ構成図</text>\n  <rect x="310" y="100" width="200" height="250" fill="white" stroke="#334e68" rx="5" stroke-dasharray="5,5"/>\n  <text x="410" y="125" font-family="Arial" font-size="14" text-anchor="middle" font-weight="bold">VPC / Private Net</text>\n  <rect x="340" y="150" width="140" height="50" fill="#e3f2fd" stroke="#2196f3" rx="3"/>\n  <text x="410" y="180" font-family="Arial" font-size="12" text-anchor="middle">App Server</text>\n  <rect x="340" y="250" width="140" height="50" fill="#e8f5e9" stroke="#4caf50" rx="3"/>\n  <text x="410" y="280" font-family="Arial" font-size="12" text-anchor="middle">DB Server</text>\n</svg>\n```\n'
        },
        {
            id: 'svg-screen-input',
            title: '入力画面',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="50" y="20" width="720" height="400" fill="white" stroke="#333" stroke-width="2" rx="5"/>\n  <rect x="50" y="20" width="720" height="30" fill="#eee" stroke="#333"/>\n  <circle cx="70" cy="35" r="5" fill="#ff5f56"/>\n  <circle cx="85" cy="35" r="5" fill="#ffbd2e"/>\n  <circle cx="100" cy="35" r="5" fill="#27c93f"/>\n  <text x="410" y="80" font-family="Arial" font-size="24" text-anchor="middle">新規登録 (入力)</text>\n  <text x="200" y="150" font-family="Arial" font-size="16">名前:</text>\n  <rect x="300" y="130" width="300" height="30" fill="none" stroke="#ccc"/>\n  <text x="200" y="200" font-family="Arial" font-size="16">メール:</text>\n  <rect x="300" y="180" width="300" height="30" fill="none" stroke="#ccc"/>\n  <rect x="350" y="300" width="120" height="40" fill="#4a90e2" stroke="#357abd" rx="5"/>\n  <text x="410" y="325" font-family="Arial" font-size="16" text-anchor="middle" fill="white">確認画面へ</text>\n</svg>\n```\n'
        },
        {
            id: 'svg-screen-confirm',
            title: '確認画面',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="50" y="20" width="720" height="400" fill="white" stroke="#333" stroke-width="2" rx="5"/>\n  <rect x="50" y="20" width="720" height="30" fill="#eee" stroke="#333"/>\n  <text x="410" y="80" font-family="Arial" font-size="24" text-anchor="middle">登録内容確認</text>\n  <text x="200" y="150" font-family="Arial" font-size="16">名前: 山田 太郎</text>\n  <text x="200" y="200" font-family="Arial" font-size="16">メール: yamada@example.com</text>\n  <rect x="250" y="300" width="120" height="40" fill="#ccc" stroke="#999" rx="5"/>\n  <text x="310" y="325" font-family="Arial" font-size="16" text-anchor="middle">戻る</text>\n  <rect x="450" y="300" width="120" height="40" fill="#4a90e2" stroke="#357abd" rx="5"/>\n  <text x="510" y="325" font-family="Arial" font-size="16" text-anchor="middle" fill="white">登録する</text>\n</svg>\n```\n'
        },
        {
            id: 'svg-screen-complete',
            title: '完了画面',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="50" y="20" width="720" height="400" fill="white" stroke="#333" stroke-width="2" rx="5"/>\n  <rect x="50" y="20" width="720" height="30" fill="#eee" stroke="#333"/>\n  <circle cx="410" cy="180" r="50" fill="#e8f5e9" stroke="#4caf50" stroke-width="5"/>\n  <path d="M385,180 L405,200 L435,165" fill="none" stroke="#4caf50" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>\n  <text x="410" y="280" font-family="Arial" font-size="24" text-anchor="middle">登録が完了しました</text>\n  <rect x="350" y="330" width="120" height="40" fill="#4a90e2" stroke="#357abd" rx="5"/>\n  <text x="410" y="355" font-family="Arial" font-size="16" text-anchor="middle" fill="white">トップへ戻る</text>\n</svg>\n```\n'
        }
    ],
    'en': [
        {
            id: 'svg-system-arch',
            title: 'System Architecture',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="10" y="10" width="800" height="430" fill="#f9f9f9" stroke="#ccc" stroke-width="2" rx="10"/>\n  <text x="410" y="40" font-family="Arial" font-size="20" text-anchor="middle" font-weight="bold">System Architecture</text>\n  <!-- Client -->\n  <rect x="50" y="150" width="120" height="60" fill="#e1f5fe" stroke="#01579b" rx="5"/>\n  <text x="110" y="185" font-family="Arial" font-size="14" text-anchor="middle">Client</text>\n  <!-- Server -->\n  <rect x="350" y="150" width="120" height="60" fill="#fff3e0" stroke="#ff6f00" rx="5"/>\n  <text x="410" y="185" font-family="Arial" font-size="14" text-anchor="middle">Web Server</text>\n  <!-- Database -->\n  <rect x="650" y="150" width="120" height="60" fill="#e8f5e9" stroke="#1b5e20" rx="5"/>\n  <text x="710" y="185" font-family="Arial" font-size="14" text-anchor="middle">Database</text>\n  <!-- Arrows -->\n  <line x1="170" y1="180" x2="350" y2="180" stroke="#333" stroke-width="2" marker-end="url(#arrow)"/>\n  <line x1="470" y1="180" x2="650" y2="180" stroke="#333" stroke-width="2" marker-end="url(#arrow)"/>\n  <defs>\n    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">\n      <path d="M0,0 L10,5 L0,10 Z" fill="#333" />\n    </marker>\n  </defs>\n</svg>\n```\n'
        },
        {
            id: 'svg-server-arch',
            title: 'Server Diagram',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="10" y="10" width="800" height="430" fill="#f0f4f8" stroke="#334e68" stroke-width="2" rx="10"/>\n  <text x="410" y="40" font-family="Arial" font-size="20" text-anchor="middle" font-weight="bold">Server Diagram</text>\n  <rect x="310" y="100" width="200" height="250" fill="white" stroke="#334e68" rx="5" stroke-dasharray="5,5"/>\n  <text x="410" y="125" font-family="Arial" font-size="14" text-anchor="middle" font-weight="bold">VPC / Private Net</text>\n</svg>\n```\n'
        },
        {
            id: 'svg-screen-input',
            title: 'Input Screen',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="50" y="20" width="720" height="400" fill="white" stroke="#333" stroke-width="2" rx="5"/>\n  <text x="410" y="80" font-family="Arial" font-size="24" text-anchor="middle">Registration (Input)</text>\n  <text x="200" y="150" font-family="Arial" font-size="16">Name:</text>\n  <rect x="300" y="130" width="300" height="30" fill="none" stroke="#ccc"/>\n  <rect x="350" y="300" width="120" height="40" fill="#4a90e2" stroke="#357abd" rx="5"/>\n  <text x="410" y="325" font-family="Arial" font-size="16" text-anchor="middle" fill="white">Next</text>\n</svg>\n```\n'
        },
        {
            id: 'svg-screen-confirm',
            title: 'Confirm Screen',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="50" y="20" width="720" height="400" fill="white" stroke="#333" stroke-width="2" rx="5"/>\n  <text x="410" y="80" font-family="Arial" font-size="24" text-anchor="middle">Confirm Details</text>\n  <rect x="450" y="300" width="120" height="40" fill="#4a90e2" stroke="#357abd" rx="5"/>\n  <text x="510" y="325" font-family="Arial" font-size="16" text-anchor="middle" fill="white">Submit</text>\n</svg>\n```\n'
        },
        {
            id: 'svg-screen-complete',
            title: 'Complete Screen',
            content: '```svg\n<svg width="820" height="450" viewBox="0 0 820 450" xmlns="http://www.w3.org/2000/svg">\n  <rect x="50" y="20" width="720" height="400" fill="white" stroke="#333" stroke-width="2" rx="5"/>\n  <text x="410" y="280" font-family="Arial" font-size="24" text-anchor="middle">Registration Complete</text>\n</svg>\n```\n'
        }
    ]
};
