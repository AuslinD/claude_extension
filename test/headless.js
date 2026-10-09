// Shared by the headless-Chrome tests: loads a test page with virtual time, waits for the page to
// write its snapshots as JSON into <pre id="results">, and returns them parsed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));

// Chrome dumps the DOM once the virtual-time budget is spent but may not exit while timers
// are still scheduled, so read stdout until </html> and then kill it.
function runPage(file, budgetMs) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-chrome-'));
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile, '--allow-file-access-from-files',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), // GitHub Actions runners
    '--virtual-time-budget=' + budgetMs, '--dump-dom',
    pathToFileURL(path.join(__dirname, file)).href,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.on('exit', () => {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch (e) { /* temp dir */ }
  });
  const cleanup = () => child.kill('SIGKILL');
  return new Promise((resolve, reject) => {
    let html = '';
    const timer = setTimeout(() => { cleanup(); reject(new Error('headless Chrome timed out')); }, 90000);
    child.stdout.on('data', (d) => {
      html += d;
      if (!html.includes('</html>')) return;
      clearTimeout(timer);
      cleanup();
      const m = /<pre id="results">([\s\S]*?)<\/pre>/.exec(html);
      if (!m) return reject(new Error('fixture produced no results block'));
      const text = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      resolve(JSON.parse(text));
    });
    child.on('error', (e) => { clearTimeout(timer); cleanup(); reject(e); });
  });
}


module.exports = { CHROME, runPage };
