const text1 = "A[開始] --> B{条件分岐}";
const text2 = "B -->|Yes| C[処理1]";
const text3 = "B -->|No| D[処理2]";
const text4 = "C --> E[終了]";
const text5 = "D --> E";
const text6 = "A -.-> B";
const text7 = "A ==> B";

const arrowSplitRegex = /\s*(?:-->|-\.->|==>|---|--|-\.-)(?:\|[^|]+\|)?\s*/;

console.log(text1.split(arrowSplitRegex));
console.log(text2.split(arrowSplitRegex));
console.log(text3.split(arrowSplitRegex));
console.log(text4.split(arrowSplitRegex));
console.log(text5.split(arrowSplitRegex));
console.log(text6.split(arrowSplitRegex));
console.log(text7.split(arrowSplitRegex));
