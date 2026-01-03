const fs = require("fs");
const s = fs.readFileSync("index.js", "utf8");
let line = 1;
let col = 0;
let inS = false,
  inD = false,
  inB = false,
  inLine = false,
  inBlock = false,
  esc = false;
const stack = [];
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  col++;
  if (ch === "\n") {
    line++;
    col = 0;
    inLine = false;
  }
  if (inLine) {
    if (ch === "\n") inLine = false;
    continue;
  }
  if (inBlock) {
    if (ch === "*" && s[i + 1] === "/") {
      inBlock = false;
      i++;
      col++;
    }
    continue;
  }
  if (esc) {
    esc = false;
    continue;
  }
  if (ch === "\\") {
    esc = true;
    continue;
  }
  if (!inS && !inD && !inB && ch === "/" && s[i + 1] === "/") {
    inLine = true;
    continue;
  }
  if (!inS && !inD && !inB && ch === "/" && s[i + 1] === "*") {
    inBlock = true;
    i++;
    continue;
  }
  if (!inD && !inB && ch === "'") {
    inS = !inS;
    continue;
  }
  if (!inS && !inB && ch === '"') {
    inD = !inD;
    continue;
  }
  if (!inS && !inD && ch === "`") {
    inB = !inB;
    continue;
  }
  if (inS || inD || inB) continue;
  if (ch === "(" || ch === "{" || ch === "[") stack.push({ ch, line, col });
  if (ch === ")" || ch === "}" || ch === "]") {
    const last = stack.pop();
    if (!last) {
      console.error("Unmatched closing", ch, "at", line, col);
      process.exit(1);
    }
    const match =
      (last.ch === "(" && ch === ")") ||
      (last.ch === "{" && ch === "}") ||
      (last.ch === "[" && ch === "]");
    if (!match) {
      console.error(
        "Mismatched",
        last.ch,
        "at",
        last.line,
        last.col,
        "with",
        ch,
        "at",
        line,
        col
      );
      process.exit(1);
    }
  }
}
if (inS || inD || inB || inBlock) {
  console.error(
    "Unclosed string/comment at EOF:",
    inS ? "single" : inD ? "double" : inB ? "backtick" : "block"
  );
  process.exit(2);
}
if (stack.length) {
  console.error("Unclosed opening at EOF:", stack[stack.length - 1]);
  process.exit(3);
}
console.log("All delimiters balanced");
