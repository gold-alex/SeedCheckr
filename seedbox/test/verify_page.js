#!/usr/bin/env node
// The page in a real browser (Chrome via puppeteer-core), phone sized, against docs/ served locally.
// Checks what a person sees, not just the verdict text site_live.js prints:
//   landing  - the sample board and the demo button render
//   error    - a payload that is not a SeedBox QR shows the error page
//   offline  - every network blocked: each cell turns "no answer", the legend and the verdict say so;
//              then the network comes back, Retry runs the failed ones again and the verdict recovers
//   phone    - the demo on a throttled mid-range phone (Slow 4G, CPU 4x slower): verdict within 60 s
//   demo     - the famous wallet, live: every cell resolves, legend counts add up to the board,
//              rows match cells, the verdict is "are in possession", no page errors, no sideways scroll
// usage: node verify_page.js [offline|demo|landing|error|phone ...]   (default: all but phone)
//        CHROME=/path/to/chrome node verify_page.js            (default: the macOS Chrome app)
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const pp = require('puppeteer-core');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEMO = fs.readFileSync(path.join(DOCS, 'app.js'), 'utf8').match(/DEMO_PAYLOAD = '([^']+)'/)[1];
const which = process.argv.slice(2).length ? process.argv.slice(2) : ['landing', 'error', 'offline', 'demo'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(DOCS, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!f.startsWith(DOCS) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}

// What the board, legend, rows and verdict say, read off the page.
const snapshot = () => ({
  cells: [...document.querySelectorAll('#board .cell')].map((c) => c.className.replace(/\bcell\b|\bpop\b/g, '').trim()),
  // entries sharing a class add up ("not checkable" and "skipped by you" are both l-skip cells)
  legend: [...document.querySelectorAll('#legend li')].reduce((o, li) => Object.assign(o, { [li.className]: (o[li.className] || 0) + Number(li.querySelector('b').textContent) }), {}),
  rows: document.querySelectorAll('#rows li, #rows-nothing li').length,
  failedRows: [...document.querySelectorAll('#rows li .amount.failed')].length,
  noAnswer: [...document.querySelectorAll('#rows li .amount.failed')].filter((a) => a.textContent === 'did not answer').length,
  verdict: document.querySelector('#verdict').hidden ? null : document.querySelector('#verdict-text').textContent,
  verdictClass: document.querySelector('#verdict').className,
  fine: document.querySelector('#verdict-fine').textContent,
  stageHeadHidden: document.querySelector('#stage-head').hidden,
  scrollWidth: document.documentElement.scrollWidth,
  retry: document.querySelector('#retry').hidden ? null : document.querySelector('#retry').textContent,
});

async function open(browser, hash, { offline = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const net = { offline };
  if (offline) {
    await page.setRequestInterception(true);
    page.on('request', (r) => (!net.offline || new URL(r.url()).hostname === '127.0.0.1' ? r.continue() : r.abort('internetdisconnected')));
  }
  await page.goto('http://127.0.0.1:' + server.address().port + '/' + (hash ? '#' + hash : ''));
  return { page, errors, net };
}

async function boardChecks(s, errors) {
  const n = s.cells.length;
  check('no page errors', errors.length === 0, errors.join(' | ') || undefined);
  check('no cell left waiting', !s.cells.includes('wait'), s.cells.filter((c) => c === 'wait').length + ' waiting');
  const sum = Object.values(s.legend).reduce((a, b) => a + b, 0);
  check('legend adds up to the board', sum === n, sum + ' vs ' + n + ' cells');
  for (const [cls, st] of [['l-hit', 'hit'], ['l-fail', 'fail'], ['l-part', 'part'], ['l-empty', 'empty'], ['l-skip', 'skip']]) {
    const cells = s.cells.filter((c) => c === st).length;
    if (cells || s.legend[cls]) check('legend ' + cls + ' matches ' + st + ' cells', (s.legend[cls] || 0) === cells, (s.legend[cls] || 0) + ' vs ' + cells);
  }
  check('one row per cell', s.rows === n, s.rows + ' rows');
  check('counter gave way to the verdict', s.stageHeadHidden);
  check('no sideways scroll at 390 px', s.scrollWidth <= 390, s.scrollWidth + ' px');
}

const RUNS = {
  async landing(browser) {
    const { page, errors } = await open(browser, '');
    await page.waitForSelector('#landing:not([hidden])');
    check('landing shows', true);
    check('sample board has 152 cells', (await page.$$('#landing-board .cell')).length === 152);
    check('demo button links to the demo payload', (await page.$eval('#demo-link', (a) => a.getAttribute('href'))) === '#' + DEMO);
    check('no page errors', errors.length === 0, errors.join(' | ') || undefined);
    await page.close();
  },
  async error(browser) {
    const { page, errors } = await open(browser, 'NOT-A-SEEDBOX-QR');
    await page.waitForSelector('#error:not([hidden])', { timeout: 5000 }).catch(() => {});
    check('error page shows for a bad payload', !(await page.$eval('#error', (e) => e.hidden)));
    check('error says why', (await page.$eval('#error-text', (e) => e.textContent)).length > 0);
    check('no board started', (await page.$$('#board .cell')).length === 0);
    check('no page errors', errors.length === 0, errors.join(' | ') || undefined);
    await page.close();
  },
  async offline(browser) {
    const { page, errors, net } = await open(browser, DEMO, { offline: true });
    await page.waitForFunction(() => !document.querySelector('#casefile').hidden, { timeout: 120000 });
    const s = await page.evaluate(snapshot);
    await boardChecks(s, errors);
    const fails = s.cells.filter((c) => c === 'fail').length;
    check('every cell shows no answer or not checkable', s.cells.every((c) => c === 'fail' || c === 'skip'), s.cells.filter((c) => c !== 'fail' && c !== 'skip').length + ' other');
    check('not-checkable networks look different from failures', s.cells.includes('skip'), s.legend['l-skip'] + ' not checkable');
    check('verdict says no network answered', s.verdict === 'No network answered.', s.verdict);
    check('verdict is neither yes nor no', !/\b(yes|no)\b/.test(s.verdictClass), s.verdictClass);
    check('every row says why it failed', s.failedRows === s.rows, s.failedRows + ' of ' + s.rows);
    check('retry offers exactly the failed networks', s.retry === 'Retry ' + fails + ' networks that did not answer', s.retry);

    // the connection comes back: Retry runs only the failed ones and the verdict recovers
    net.offline = false;
    await page.click('#retry');
    const during = await page.evaluate(() => ({ disabled: document.querySelector('#retry').disabled, waiting: document.querySelectorAll('#board .cell.wait').length }));
    check('retry disables itself and puts cells back to waiting', during.disabled && during.waiting > 0, during.waiting + ' waiting');
    await page.waitForFunction(() => !document.querySelector('#retry').disabled, { timeout: 120000 });
    const t = await page.evaluate(snapshot);
    await boardChecks(t, errors);
    check('after retry the verdict is "are in possession"', /are in possession/.test(t.verdict || ''), t.verdict);
    check('after retry the not-checkable ones are untouched', t.cells.filter((c) => c === 'skip').length === s.cells.filter((c) => c === 'skip').length);
    check('retry button only stays for what still failed', t.retry === null || /^Retry \d+ networks? that did not/.test(t.retry), t.retry || 'hidden');
    console.log('       after retry: ' + JSON.stringify(t.legend));
    await page.close();
  },
  // the demo wallet on a mid-range phone over mobile data: Chrome's "Slow 4G" (1.6 Mbps down,
  // 150 ms latency) and a CPU 4x slower than this machine's; reports how long the verdict takes
  async phone(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await page.goto('http://127.0.0.1:' + server.address().port + '/#' + DEMO);
    await page.waitForFunction(() => !document.querySelector('#casefile').hidden, { timeout: 180000 });
    const took = (Date.now() - t0) / 1000;
    const s = await page.evaluate(snapshot);
    await boardChecks(s, errors);
    check('verdict is "are in possession"', /are in possession/.test(s.verdict || ''), s.verdict);
    check('verdict within 60 s on a slow phone', took <= 60, took.toFixed(1) + ' s');
    console.log('       ' + took.toFixed(1) + ' s to the case file; ' + s.cells.length + ' networks: ' + JSON.stringify(s.legend));
    await page.close();
  },
  async demo(browser) {
    const { page, errors } = await open(browser, DEMO);
    await page.waitForFunction(() => !document.querySelector('#casefile').hidden, { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 300));
    const s = await page.evaluate(snapshot);
    await boardChecks(s, errors);
    check('verdict is "are in possession"', /are in possession/.test(s.verdict || ''), s.verdict);
    if (s.noAnswer) check('networks that did not answer are counted under the verdict', s.fine.includes(s.noAnswer + ' network'), s.fine);
    console.log('       ' + s.cells.length + ' networks: ' + JSON.stringify(s.legend));
    await page.close();
  },
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await pp.launch({ executablePath: CHROME, headless: true });
  try {
    for (const w of which) { console.log(w); await RUNS[w](browser); }
  } catch (e) {
    console.log('  FAIL ' + e.message); failures++;
  } finally {
    await browser.close(); server.close();
  }
  console.log(failures ? failures + ' FAILED' : 'PASS');
  process.exitCode = failures ? 1 : 0;
})();
