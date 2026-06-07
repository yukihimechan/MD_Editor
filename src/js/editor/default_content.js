/**
 * Default Editor Content
 * Separated to allow easy customization without touching main app logic.
 * This is loaded via <script> to avoid CORS issues on local file systems.
 */
const DEFAULT_CONTENT = `
## たまご焼き
\`\`\`mermaid
flowchart TD
    A[卵をボウルに割り入れる] --> B[調味料を加えて混ぜる]
    B --> C[卵焼き器を熱し油をひく]
    C --> D[卵液の適量を流し込む]
    D --> E[半熟になったら奥から手前へ巻く]
    E --> F{卵液は残っている？}
    F -- はい --> G[空いた部分に油をひき卵液を足す]
    G --> E
    F -- いいえ --> H[形を整える]
    H --> I([完成])
\`\`\`
`;
