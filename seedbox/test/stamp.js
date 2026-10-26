#!/usr/bin/env node
// stamp.js - puts a content hash on every local script in docs/index.html (src="app.js?v=1a2b3c4d"),
// so a browser that cached the old files fetches the new ones together with the new page.
// GitHub Pages lets browsers keep a file for 10 minutes; without this a returning visitor can
// run a new app.js against an old tokens.js. Run after changing anything in docs/;
// verify_site.js fails when a stamp is stale.
'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const DOCS = path.join(__dirname, '..', '..', 'docs');
const stamp = (file) => createHash('sha256').update(fs.readFileSync(path.join(DOCS, file))).digest('hex').slice(0, 8);
const re = /<script src="([a-z0-9_.-]+\.js)(?:\?v=[0-9a-f]+)?"><\/script>/g;
module.exports = { stamp, re, DOCS };
if (require.main === module) {
  const f = path.join(DOCS, 'index.html');
  const html = fs.readFileSync(f, 'utf8').replace(re, (m, file) => '<script src="' + file + '?v=' + stamp(file) + '"></script>');
  fs.writeFileSync(f, html);
  console.log([...html.matchAll(re)].map((m) => m[0].match(/src="([^"]+)"/)[1]).join('\n'));
}
