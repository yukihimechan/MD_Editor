/**
 * Mermaid Templates for Markdown Editor
 */
const MERMAID_TEMPLATES = {
    'ja': [
        {
            id: 'mermaid-flowchart',
            title: 'フローチャート',
            content: '```mermaid\nflowchart TD\n    A[開始] --> B{条件分岐}\n    B -->|Yes| C[処理1]\n    B -->|No| D[処理2]\n    C --> E[終了]\n    D --> E\n```\n'
        },
        {
            id: 'mermaid-sequence',
            title: 'シーケンス図',
            content: '```mermaid\nsequenceDiagram\n    participant A as ユーザー\n    participant B as システム\n    participant C as データベース\n    \n    A->>B: リクエスト送信\n    activate B\n    B->>C: データ取得\n    activate C\n    C-->>B: データ返却\n    deactivate C\n    B-->>A: レスポンス返却\n    deactivate B\n```\n'
        },
        {
            id: 'mermaid-class',
            title: 'クラス図',
            content: '```mermaid\nclassDiagram\n    class Animal {\n        +String name\n        +int age\n        +makeSound()\n    }\n    \n    class Dog {\n        +String breed\n        +bark()\n    }\n    \n    Animal <|-- Dog\n```\n'
        },
        {
            id: 'mermaid-state',
            title: '状態遷移図',
            content: '```mermaid\nstateDiagram-v2\n    [*] --> 待機中\n    待機中 --> 処理中: 開始\n    処理中 --> 完了: 成功\n    処理中 --> エラー: 失敗\n    エラー --> 待機中: リトライ\n    完了 --> [*]\n```\n'
        },
        {
            id: 'mermaid-er',
            title: 'ER図',
            content: '```mermaid\nerDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE-ITEM : contains\n    CUSTOMER {\n        string name\n        string email\n        int customer_id\n    }\n```\n'
        },
        {
            id: 'mermaid-gantt',
            title: 'ガントチャート',
            content: '```mermaid\ngantt\n    title プロジェクトスケジュール\n    dateFormat  YYYY-MM-DD\n    section 設計\n    要件定義           :a1, 2024-01-01, 7d\n    基本設計           :a2, after a1, 10d\n    section 開発\n    実装               :b1, after a2, 20d\n```\n'
        }
    ],
    'en': [
        {
            id: 'mermaid-flowchart',
            title: 'Flowchart',
            content: '```mermaid\nflowchart TD\n    A[Start] --> B{Condition}\n    B -->|Yes| C[Process 1]\n    B -->|No| D[Process 2]\n    C --> E[End]\n    D --> E\n```\n'
        },
        {
            id: 'mermaid-sequence',
            title: 'Sequence Diagram',
            content: '```mermaid\nsequenceDiagram\n    participant A as User\n    participant B as System\n    participant C as Database\n    \n    A->>B: Send Request\n    activate B\n    B->>C: Get Data\n    activate C\n    C-->>B: Return Data\n    deactivate C\n    B-->>A: Return Response\n    deactivate B\n```\n'
        },
        {
            id: 'mermaid-class',
            title: 'Class Diagram',
            content: '```mermaid\nclassDiagram\n    class Animal {\n        +String name\n        +int age\n        +makeSound()\n    }\n    \n    Animal <|-- Dog\n```\n'
        },
        {
            id: 'mermaid-state',
            title: 'State Diagram',
            content: '```mermaid\nstateDiagram-v2\n    [*] --> Idle\n    Idle --> Processing: Start\n    Processing --> Complete: Success\n    Processing --> Error: Failure\n    Error --> Idle: Retry\n    Complete --> [*]\n```\n'
        },
        {
            id: 'mermaid-er',
            title: 'ER Diagram',
            content: '```mermaid\nerDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE-ITEM : contains\n```\n'
        },
        {
            id: 'mermaid-gantt',
            title: 'Gantt Chart',
            content: '```mermaid\ngantt\n    title Project Schedule\n    dateFormat  YYYY-MM-DD\n    section Design\n    Requirements       :a1, 2024-01-01, 7d\n```\n'
        }
    ]
};
