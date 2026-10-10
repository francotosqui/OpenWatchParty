const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');
const { findUnlocalizedLiterals } = require('./localization-check');

const clientRoot = path.join(__dirname, '..');

it('detects short labels, multiline calls and local DOM wrappers', () => {
  const fixtures = [
    "createElement('button', 'join', 'Join');",
    "document.createTextNode('Online');",
    "button.setAttribute(\n 'title',\n 'Close panel'\n);",
    "button['placeholder'] = 'Search';",
    "button.textContent = `Join ${name}`;",
    "button.textContent = ready ? 'Online' : t('offline');",
    "const label = 'Join'; button.textContent = label;",
    "function label(el, text) { el.textContent = text; } label(button, 'Join');",
    "const label = text => document.createTextNode(text); const alias = label; alias('Online');",
    "function label(text) { return createElement('span', '', text); } label('Join');",
    "button.append('Join');"
  ];
  for (const source of fixtures) assert.equal(findUnlocalizedLiterals(source).length, 1, source);
});

it('allows translations and internal values without hiding ordinary labels', () => {
  const source = `
    button.textContent = t('join');
    button.setAttribute('title', OWP.i18n.t('closePanel'));
    document.createElement('button');
    button.setAttribute('class', 'Online');
    console.log('Join');
    button.textContent = user.name;
    button.textContent = 'OpenWatchParty';
  `;
  assert.deepEqual(findUnlocalizedLiterals(source), []);
  assert.equal(findUnlocalizedLiterals("button.textContent = 'groups';", 'ui/home.js').length, 1);
  assert.deepEqual(findUnlocalizedLiterals("icon.textContent = 'groups';", 'ui/home.js'), []);
  assert.equal(findUnlocalizedLiterals('button.textContent = `Close panel`;', 'ui/styles.js').length, 1);
  assert.equal(findUnlocalizedLiterals('button.textContent = ;').length, 1, 'parse failures must fail the guard');
});

const sourceFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const absolute = path.join(directory, entry.name);
  if (entry.name === 'node_modules' || entry.name === 'tests') return [];
  if (entry.isDirectory()) return sourceFiles(absolute);
  if (!entry.name.endsWith('.js') || absolute.endsWith(path.join('utils', 'i18n.js'))) return [];
  return [absolute];
});

it('keeps user-facing English literals in the localization catalog', () => {
  const violations = [];
  for (const file of sourceFiles(clientRoot)) {
    const relative = path.relative(clientRoot, file).replaceAll('\\', '/');
    violations.push(...findUnlocalizedLiterals(fs.readFileSync(file, 'utf8'), relative));
  }
  assert.deepEqual(violations, [], `Uncatalogued user-facing literals:\n${violations.join('\n')}`);
});

// Any string, template or not, that reads like an English sentence (three or
// more words starting with a capital) belongs in the catalog. Comments, logs
// and internal Error objects are not shown to users.
it('keeps English sentences out of the client code', () => {
  const literal = /(['"`])((?:\\.|(?!\1).)*?)\1/g;
  const sentence = /^[A-Z][a-z']*(?: [A-Za-z'.,:()\/-]+){2,}/;
  const violations = [];
  for (const file of sourceFiles(clientRoot)) {
    const relative = path.relative(clientRoot, file).replaceAll('\\', '/');
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (/^(\/\/|\*|\/\*)/.test(trimmed) || /console\.|utils\.log\(|new Error\(/.test(trimmed)) return;
      for (const match of trimmed.matchAll(literal)) {
        const text = match[2].replace(/\$\{[^}]*\}/g, '');
        if (sentence.test(text)) violations.push(`${relative}:${index + 1}: ${text}`);
      }
    });
  }
  assert.deepEqual(violations, [], `English sentences outside the catalog:\n${violations.join('\n')}`);
});
