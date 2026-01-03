const fs = require("fs");
const s = fs.readFileSync("index.js", "utf8");
const pairs = { "(": ")", "[": "]", "{": "}" };
const open = Object.keys(pairs);
const close = Object.values(pairs);
let stack = [];
let inS = false,
  inD = false,
  inBT = false,
  escape = false;
for (let i = 0; i < s.length; i++) {
  const c = s[i];
  if (escape) {
    escape = false;
    continue;
  }
  if (c === "\\") {
    escape = true;
    continue;
  }
  if (c === "'") {
    if (!inD && !inBT) inS = !inS;
    continue;
  }
  if (c === '"') {
    if (!inS && !inBT) inD = !inD;
    continue;
  }
  if (c === "`") {
    if (!inS && !inD) inBT = !inBT;
    continue;
  }
  if (inS || inD || inBT) continue;
  if (open.includes(c)) stack.push([c, i]);
  else if (close.includes(c)) {
    const last = stack.pop();
    if (!last || pairs[last[0]] !== c) {
      console.error("MISMATCH", c, "at", i);
      process.exit(2);
    }
  }
}
if (inS || inD || inBT) {
  console.error("Unterminated string or template");
  process.exit(3);
}
if (stack.length) {
  console.error("Unmatched opens:", stack[stack.length - 1]);
  process.exit(4);
}
console.log("balanced");
