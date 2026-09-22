// Vite can compile an unbound JSX component into a runtime ReferenceError.
// Catch that before installing the app (the slate-list Strike regression).
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const root = path.resolve(__dirname, '../src');
let failed = false;
let checked = 0;
function walk(dir) {
  for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, file.name);
    if (file.isDirectory()) { walk(full); continue; }
    if (!/\.[jt]sx?$/.test(file.name)) continue;
    const ast = parser.parse(fs.readFileSync(full, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    traverse(ast, {
      JSXOpeningElement(p) {
        let name = p.node.name;
        const member = name.type === 'JSXMemberExpression';
        while (name.type === 'JSXMemberExpression') name = name.object;
        if (name.type !== 'JSXIdentifier' || (!member && /^[a-z]/.test(name.name))) return;
        checked++;
        if (!p.scope.hasBinding(name.name)) {
          console.error(`${path.relative(root, full)}:${name.loc.start.line}: undefined JSX component ${name.name}`);
          failed = true;
        }
      },
    });
  }
}
walk(root);
if (failed) process.exitCode = 1;
else console.log(`Checked ${checked} JSX component references; all are bound.`);
