import fs from 'fs';
const src = 'public/src';

// 1. Check imports in chat.js
const chat = fs.readFileSync(src + '/chat.js', 'utf8');
console.log('CHAT.JS IMPORTS:');
const re = /import \{([^}]+)\} from '\.\/(\w+)'/g;
let m;
while ((m = re.exec(chat)) !== null) {
  const names = m[1].split(',').map(s => s.trim());
  console.log('  from ' + m[2] + ':', JSON.stringify(names));
}

// 2. Check exports from api.js
const api = fs.readFileSync(src + '/api.js', 'utf8');
const apiEx = new Set();
let m2;
while ((m2 = /export (?:async )?(?:function|const|let|var) (\w+)/g.exec(api)) !== null) apiEx.add(m2[1]);
console.log('API.JS EXPORTS:', JSON.stringify([...apiEx]));

// 3. Do full cross-check
console.log('\nFULL CROSS-CHECK:');
const files = fs.readdirSync(src).filter(f => f.endsWith('.js') && f !== 'check.mjs');

const ex = {};
const im = {};
for (const f of files) {
  const c = fs.readFileSync(src + '/' + f, 'utf8');
  const s = new Set();
  let m3;
  while ((m3 = /export (?:async )?(?:function|const|let|var) (\w+)/g.exec(c)) !== null) s.add(m3[1]);
  while ((m3 = /export \{([^}]+)\}/g.exec(c)) !== null) {
    m3[1].split(',').forEach(x => s.add(x.trim().split(/\s+as\s+/)[0].trim()));
  }
  ex[f] = s;
  im[f] = [];
  let m4;
  while ((m4 = /import \{([^}]+)\} from '\.\/(\w+)'/g.exec(c)) !== null) {
    m4[1].split(',').forEach(n => im[f].push({name: n.trim(), src: m4[2] + '.js'}));
  }
}

for (const [f, ims] of Object.entries(im)) {
  for (const i of ims) {
    if (!ex[i.src] || !ex[i.src].has(i.name)) {
      console.log('  STALE IMPORT in ' + f + ': ' + i.name + ' from ' + i.src);
    }
  }
}
console.log('DONE');
