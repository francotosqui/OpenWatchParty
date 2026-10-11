const { Linter } = require('eslint');

const displayProperties = new Set(['textContent', 'innerText', 'title', 'placeholder', 'ariaLabel', 'alt']);
const displayAttributes = new Set(['title', 'placeholder', 'aria-label', 'aria-description', 'aria-valuetext', 'alt', 'label']);
const nameOf = node => node?.type === 'Identifier' ? node.name : node?.value;
const callName = node => node.callee.type === 'MemberExpression' ? nameOf(node.callee.property) : nameOf(node.callee);

// Follow local bindings and helper parameters so short labels cannot hide
// behind a wrapper around a DOM sink. Translation calls remain opaque.
const findUnlocalizedLiterals = (source, filename = 'fixture.js') => new Linter().verify(source, [{
  plugins: { localization: { rules: { literals: {
    create(context) {
      const calls = [];
      const sinks = [];
      const variable = node => {
        for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
          if (scope.set.has(node.name)) return scope.set.get(node.name);
        }
        return null;
      };
      const resolveFunction = (node, seen = new Set()) => {
        if (!node || seen.has(node)) return null;
        seen.add(node);
        if (['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(node.type)) return node;
        if (node.type !== 'Identifier') return null;
        for (const def of variable(node)?.defs || []) {
          const result = resolveFunction(def.type === 'FunctionName' ? def.node : def.node.init, seen);
          if (result) return result;
        }
        return null;
      };
      return {
        AssignmentExpression(node) {
          if (node.left.type !== 'MemberExpression' || !displayProperties.has(nameOf(node.left.property))) return;
          // Stylesheets and Material icon glyph names are not UI labels.
          if (filename === 'ui/styles.js' && nameOf(node.left.object) === 'style' && nameOf(node.left.property) === 'textContent') return;
          if (filename === 'ui/home.js' && nameOf(node.left.object) === 'icon' && node.right.value === 'groups') return;
          if (filename === 'ui/guest-controls.js'
            && node.left.object.type === 'CallExpression'
            && callName(node.left.object) === 'querySelector'
            && node.left.object.arguments[0]?.value === '.owp-guest-lock-icon'
            && node.right.type === 'ConditionalExpression'
            && node.right.consequent.value === 'hourglass_empty'
            && node.right.alternate.value === 'lock') return;
          sinks.push(node.right);
        },
        CallExpression(node) {
          calls.push(node);
          const name = callName(node);
          if (['createTextNode', 'showToast', 'confirm', 'alert'].includes(name)) sinks.push(node.arguments[0]);
          if (name === 'createElement' && !(filename === 'ui/cards.js' && node.arguments[1]?.value === 'material-icons' && node.arguments[2]?.value === 'groups')) sinks.push(node.arguments[2]);
          if (name === 'setAttribute' && displayAttributes.has(node.arguments[0]?.value)) sinks.push(node.arguments[1]);
          if (['append', 'prepend', 'replaceChildren'].includes(name)) sinks.push(...node.arguments);
        },
        'Program:exit'() {
          const seen = new Set();
          const inspect = node => {
            if (!node || seen.has(node)) return;
            seen.add(node);
            if (node.type === 'Literal' && typeof node.value === 'string' && /[A-Za-z]/.test(node.value) && node.value !== 'OpenWatchParty') {
              context.report({ node, message: `Uncatalogued UI literal: ${node.value}` });
            } else if (node.type === 'TemplateLiteral') {
              for (const quasi of node.quasis) {
                if (/[A-Za-z]/.test(quasi.value.cooked || '') && quasi.value.cooked.trim() !== 'ms') context.report({ node: quasi, message: `Uncatalogued UI template: ${quasi.value.cooked}` });
              }
              node.expressions.forEach(inspect);
            } else if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
              inspect(node.left);
              inspect(node.right);
            } else if (node.type === 'ConditionalExpression') {
              inspect(node.consequent);
              inspect(node.alternate);
            } else if (node.type === 'Identifier') {
              for (const def of variable(node)?.defs || []) {
                if (def.type === 'Variable') inspect(def.node.init);
                if (def.type === 'Parameter') {
                  const index = def.node.params.indexOf(def.name);
                  for (const call of calls) {
                    if (resolveFunction(call.callee) === def.node) inspect(call.arguments[index]);
                  }
                }
              }
            }
          };
          sinks.forEach(inspect);
        }
      };
    }
  } } } },
  rules: { 'localization/literals': 'error' }
}]).map(message => `${filename}:${message.line}: ${message.message}`);

module.exports = { findUnlocalizedLiterals };
