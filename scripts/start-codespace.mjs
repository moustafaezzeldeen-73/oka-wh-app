#!/usr/bin/env node
/**
 * `npm run start:codespace` — serve the app to Expo Go from a GitHub Codespace
 * and print a QR code that works.
 *
 * Two public tunnels, tried in turn until one answers:
 *   1. Expo's own tunnel (ngrok, `exp://….exp.direct`). Since February 2026
 *      Expo's shared ngrok account is rate-limited (expo/expo#43335), so it
 *      fails some days with "failed to start tunnel / session closed".
 *   2. Cloudflare's quick tunnel (`exps://….trycloudflare.com`): free, no
 *      account. cloudflared is downloaded once into node_modules/.cache.
 * Whichever worked is remembered in .expo/start-codespace.json and tried first
 * next time. `-- --ngrok` or `-- --cloudflare` picks the first one yourself.
 *
 * The QR code is printed only once the address answers from outside and the
 * iPhone and Android bundles are built, so the phone never waits on a first
 * build. Expo runs headless (no desktop DevTools window, which needs GUI
 * libraries a Codespace lacks), and in that mode Expo prints no QR code of its
 * own — this script prints it.
 *
 * `-- --github` tries GitHub's forwarded address first
 * (https://<codespace>-8081.app.github.dev, made public), then the tunnels.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const PORT = 8081;
const GITHUB_WAIT_MS = 45_000;
const TUNNEL_WAIT_MS = 90_000;
const CLOUDFLARE_WAIT_MS = 90_000;

const OWN_FLAGS = ['--tunnel', '--github', '--ngrok', '--cloudflare'];
const tryGithub = process.argv.includes('--github');
const passthrough = process.argv.slice(2).filter((a) => !OWN_FLAGS.includes(a));
const codespace = process.env.CODESPACE_NAME;

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
const publicUrl = `https://${codespace}-${PORT}.${domain}`;

const require = createRequire(import.meta.url);
const expoCli = require.resolve('expo/bin/cli');
const ROOT = path.dirname(require.resolve('../package.json'));
const STATE_FILE = path.join(ROOT, '.expo', 'start-codespace.json');
// Matches the Expo dev server however it was started (npx, npm script, this file).
const EXPO_PROCESS = 'node .*expo(/bin/cli)? start';

// ── Expo child process ───────────────────────────────────────────────────────

let child = null;
let exited = true;
let stopping = false;
/** Set once an address is live: from then on, Expo quitting ends this script. */
let attached = false;
/** Ctrl+C: stop everything, don't fall back to another tunnel. */
let userQuit = false;

function startExpo(extraEnv, extraArgs) {
  const env = { ...process.env, EXPO_UNSTABLE_HEADLESS: '1', ...extraEnv };
  // Spawned directly (not through npx) so stopping it stops Metro too.
  child = spawn(process.execPath, [expoCli, 'start', '--port', String(PORT), ...extraArgs, ...passthrough], {
    stdio: 'inherit',
    env,
  });
  exited = false;
  child.on('exit', (code, signal) => {
    exited = true;
    // Before an address is live, Expo quitting (e.g. its tunnel failed) means
    // "try the next way"; after that, or on Ctrl+C, it ends this script.
    if (userQuit || (attached && !stopping)) process.exit(code ?? (signal ? 1 : 0));
  });
}

async function stopExpo() {
  if (!child || exited) return;
  stopping = true;
  child.kill('SIGINT');
  for (let i = 0; i < 20 && !exited; i++) await delay(500);
  if (!exited) child.kill('SIGKILL');
  for (let i = 0; i < 10 && !exited; i++) await delay(300);
  stopping = false;
}

// Ctrl+C reaches Expo (and cloudflared) directly; stay alive until Expo has shut down.
process.on('SIGINT', () => {
  userQuit = true;
  if (exited) process.exit(130);
});
for (const sig of ['SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    userQuit = true;
    child?.kill(sig);
    if (exited) process.exit(1);
  });
}
process.on('exit', () => stopCloudflare());

// ── Port 8081 ────────────────────────────────────────────────────────────────

/** Whether something already listens on the port. */
function portTaken(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
  });
}

/**
 * An app server left over from an earlier run (another terminal, or one that
 * didn't shut down) holds port 8081; a new one would move to 8082 and the
 * address would answer 502. Stop the old one first.
 */
async function freePort() {
  if (!(await portTaken(PORT))) return;
  console.log(yellow(`Port ${PORT} is held by an older app server — stopping it first.`));
  try {
    execFileSync('pkill', ['-f', EXPO_PROCESS], { stdio: 'ignore' });
  } catch {
    // Nothing matched, or pkill is missing; the check below says if it's still taken.
  }
  for (let i = 0; i < 20 && (await portTaken(PORT)); i++) await delay(500);
  if (await portTaken(PORT)) {
    console.log(
      yellow(`Port ${PORT} is still in use by another program. Close the other terminal running the app and try again.`),
    );
    process.exit(1);
  }
}

async function metroRunning(limitMs = 180_000) {
  const end = Date.now() + limitMs;
  while (Date.now() < end && !exited) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/status`, { signal: AbortSignal.timeout(2000) });
      if ((await res.text()).includes('packager-status:running')) return true;
    } catch {
      // not listening yet
    }
    await delay(1000);
  }
  return false;
}

/** Status of `<base>/status` from outside (0 = no answer), and whether it's Metro. */
async function probe(base) {
  try {
    const res = await fetch(`${base}/status`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    return { status: res.status, ok: res.status === 200 && text.includes('packager-status:running') };
  } catch {
    return { status: 0, ok: false };
  }
}

/**
 * Build the iOS and Android bundles before showing the QR code. The first
 * build takes a minute or more in a Codespace, and GitHub's forwarding gives
 * up on slow answers with a 502 — so the phone must only ask once Metro has
 * the bundle ready. Uses the exact bundle URL Expo Go will request.
 */
async function warmBundles() {
  for (const platform of ['ios', 'android']) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`, {
        headers: { 'expo-platform': platform, accept: 'application/expo+json,application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      const bundle = new URL((await res.json()).launchAsset.url);
      const started = Date.now();
      console.log(`Building the ${platform === 'ios' ? 'iPhone' : 'Android'} bundle before showing the QR code…`);
      const b = await fetch(`http://127.0.0.1:${PORT}${bundle.pathname}${bundle.search}`, {
        signal: AbortSignal.timeout(600_000),
      });
      await b.arrayBuffer();
      console.log(
        b.ok
          ? green(`  ${platform === 'ios' ? 'iPhone' : 'Android'} bundle ready (${Math.round((Date.now() - started) / 1000)} s).`)
          : yellow(`  Metro answered ${b.status} building the bundle — see the error above.`),
      );
    } catch (err) {
      console.log(yellow(`  Couldn't build the bundle ahead (${err instanceof Error ? err.message : err}); the phone will wait for it instead.`));
    }
  }
}

// ── 1. GitHub's forwarded address ────────────────────────────────────────────

function makePortPublic() {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['codespace', 'ports', 'visibility', `${PORT}:public`, '-c', codespace],
      { timeout: 30_000 },
      (err, stdout, stderr) => resolve({ ok: !err, output: `${stderr || ''}${stdout || ''}` || String(err) }),
    );
  });
}

function githubAdvice(status) {
  if (status === 404) {
    return `GitHub isn't forwarding port ${PORT} (404). In the PORTS tab: Add Port → ${PORT}, then Port Visibility → Public.`;
  }
  if (status === 502) {
    return `GitHub's address can't reach the app server (502). In the PORTS tab: right-click ${PORT} → Stop Forwarding Port, then Add Port → ${PORT} → Public.`;
  }
  return `Port ${PORT} isn't public (${status || 'no answer'}). In the PORTS tab: right-click ${PORT} → Port Visibility → Public.`;
}

/** True when GitHub's address works (and stays watched); false to fall back. */
async function runGithub() {
  startExpo({ EXPO_PACKAGER_PROXY_URL: publicUrl, EXPO_NO_QR_CODE: '1' }, []);
  if (!(await metroRunning())) return false;
  await warmBundles();

  await makePortPublic();
  const end = Date.now() + GITHUB_WAIT_MS;
  let last = { status: 0, ok: false };
  let told = false;
  while (Date.now() < end && !exited) {
    last = await probe(publicUrl);
    if (last.ok) {
      attached = true;
      printReady(`exps://${codespace}-${PORT}.${domain}`, `${publicUrl}/status`);
      void keepGithubReachable();
      return true;
    }
    if (!told && Date.now() > end - GITHUB_WAIT_MS + 9000) {
      told = true;
      console.log(yellow(`\nWaiting for GitHub's address… ${githubAdvice(last.status)}`));
    }
    await delay(3000);
  }
  console.log(
    yellow(bold(`\nGitHub's address still isn't working (${last.status || 'no answer'}) — switching to a tunnel instead.\n`)),
  );
  return false;
}

/** GitHub can drop the port back to private later; put it back and say so. */
async function keepGithubReachable() {
  let down = false;
  while (!exited) {
    await delay(30_000);
    if (exited) return;
    const p = await probe(publicUrl);
    if (p.ok) {
      if (down) console.log(green(`\n${publicUrl} answers again — reload the app in Expo Go.\n`));
      down = false;
      continue;
    }
    if (!down) {
      down = true;
      console.log(
        yellow(
          `\n${bold(`${publicUrl} stopped answering`)} — Expo Go will show an error.\n  ${githubAdvice(p.status)}\n` +
            `  Or restart without --github to use a tunnel: npm run start:codespace\n`,
        ),
      );
    }
    await makePortPublic();
  }
}

// ── 2. Expo's tunnel (ngrok) ─────────────────────────────────────────────────

/**
 * The tunnel's public host, read from ngrok's own local API (port 4040, or the
 * next free one) — asking Expo's manifest instead makes it log a warning on
 * every try until the tunnel is up.
 */
async function tunnelHost() {
  for (let p = 4040; p <= 4045; p++) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/api/tunnels`, { signal: AbortSignal.timeout(1500) });
      const { tunnels = [] } = await res.json();
      const t = tunnels.find(
        (x) => String(x?.config?.addr ?? '').endsWith(`:${PORT}`) && /^https?:\/\//.test(x?.public_url ?? ''),
      );
      if (t) return new URL(t.public_url).host;
    } catch {
      // Not ngrok on this port, or not up yet.
    }
  }
  return null;
}

/** True once Expo's tunnel answers and the QR code is shown. */
async function runNgrok() {
  console.log(bold(`Starting the app server with Expo's tunnel (ngrok) — this can take up to a minute…`));
  startExpo({}, ['--tunnel']);
  if (!(await metroRunning())) return false;

  const end = Date.now() + TUNNEL_WAIT_MS;
  while (Date.now() < end && !exited) {
    const host = await tunnelHost();
    if (host && (await probe(`https://${host}`)).ok) {
      await warmBundles();
      if (exited) return false;
      attached = true;
      remember('ngrok');
      printReady(`exp://${host}`, `https://${host}/status`);
      return true;
    }
    await delay(3000);
  }
  return false;
}

const NGROK_DOWN =
  "Expo's tunnel is down. It runs on one ngrok account shared by every Expo user, which ngrok has been " +
  'rate-limiting since February 2026 (github.com/expo/expo/issues/43335) — nothing in this project can fix it.';

// ── 3. Cloudflare's quick tunnel ─────────────────────────────────────────────

let cf = null;
let cfExited = true;

function stopCloudflare() {
  if (cf && !cfExited) cf.kill('SIGTERM');
}

/** cloudflared from PATH, else downloaded once from Cloudflare's GitHub releases. */
async function cloudflaredBin() {
  try {
    execFileSync('cloudflared', ['--version'], { stdio: 'ignore' });
    return 'cloudflared';
  } catch {
    // Not installed; use (or fetch) our own copy.
  }
  const dir = path.join(ROOT, 'node_modules', '.cache', 'cloudflared');
  const bin = path.join(dir, 'cloudflared');
  if (existsSync(bin)) return bin;
  const arch = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' }[process.arch];
  if (process.platform !== 'linux' || !arch) {
    throw new Error(`no automatic download for ${process.platform}/${process.arch} — install cloudflared yourself`);
  }
  console.log("Downloading Cloudflare's tunnel program (one time, about 40 MB)…");
  const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`, {
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`cloudflared download failed: HTTP ${res.status}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${bin}.part`, Buffer.from(await res.arrayBuffer()));
  chmodSync(`${bin}.part`, 0o755);
  renameSync(`${bin}.part`, bin);
  return bin;
}

/** The trycloudflare.com address cloudflared prints once the quick tunnel exists. */
function quickTunnelHost(log) {
  return /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/.exec(log)?.[1] ?? null;
}

/** Start a quick tunnel to Metro's port; resolves with its host once connected. */
function startQuickTunnel(bin) {
  return new Promise((resolve, reject) => {
    let log = '';
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new Error('no address from Cloudflare within 60 s')), 60_000);
    cf = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cfExited = false;
    const onData = (d) => {
      log = (log + d.toString()).slice(-20_000);
      const host = quickTunnelHost(log);
      if (host && /Registered tunnel connection/.test(log)) done(resolve, host);
    };
    cf.stdout.on('data', onData);
    cf.stderr.on('data', onData);
    cf.on('error', (err) => done(reject, err));
    cf.on('exit', (code) => {
      cfExited = true;
      const reason = log.split('\n').reverse().find((l) => /ERR|failed|error/i.test(l))?.trim();
      if (!settled) done(reject, new Error(reason || `cloudflared exited (${code})`));
      else if (attached && !userQuit) {
        console.log(yellow(`\n${bold("Cloudflare's tunnel stopped")} — Expo Go will show an error. Press Ctrl+C and run npm run start:codespace again.\n`));
      }
    });
  });
}

/** True once Cloudflare's address answers and the QR code is shown. */
async function runCloudflare() {
  console.log(bold("Starting the app server behind Cloudflare's quick tunnel (free, no account)…"));
  let host;
  try {
    host = await startQuickTunnel(await cloudflaredBin());
  } catch (err) {
    console.log(yellow(`Cloudflare's tunnel didn't start: ${err instanceof Error ? err.message : err}`));
    stopCloudflare();
    return false;
  }
  const base = `https://${host}`;
  // Expo builds every URL in the manifest (bundle, assets, dev tools) on this address.
  startExpo({ EXPO_PACKAGER_PROXY_URL: base, EXPO_NO_QR_CODE: '1' }, []);
  if (!(await metroRunning())) return false;
  await warmBundles();

  // A brand-new trycloudflare.com name can take a few seconds to resolve.
  const end = Date.now() + CLOUDFLARE_WAIT_MS;
  let last = { status: 0, ok: false };
  while (Date.now() < end && !exited && !cfExited) {
    last = await probe(base);
    if (last.ok) {
      attached = true;
      remember('cloudflare');
      printReady(`exps://${host}`, `${base}/status`);
      return true;
    }
    await delay(3000);
  }
  console.log(yellow(`Cloudflare's address didn't answer (${last.status || 'no answer'}).`));
  return false;
}

// ── Which tunnel first ───────────────────────────────────────────────────────

function remembered() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')).tunnel ?? null;
  } catch {
    return null;
  }
}

function remember(tunnel) {
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ tunnel, at: new Date().toISOString() }, null, 2));
  } catch {
    // Only a speed-up for next time.
  }
}

function tunnelOrder() {
  if (process.argv.includes('--cloudflare')) return ['cloudflare', 'ngrok'];
  if (process.argv.includes('--ngrok')) return ['ngrok', 'cloudflare'];
  if (remembered() === 'cloudflare') {
    console.log(`Cloudflare's tunnel worked last time, so it goes first (${bold('npm run start:codespace -- --ngrok')} tries Expo's first).`);
    return ['cloudflare', 'ngrok'];
  }
  return ['ngrok', 'cloudflare'];
}

async function runTunnels() {
  const order = tunnelOrder();
  for (const [i, tunnel] of order.entries()) {
    if (userQuit) return;
    const ok = tunnel === 'ngrok' ? await runNgrok() : await runCloudflare();
    if (ok) return;
    if (userQuit) return;
    await stopExpo();
    stopCloudflare();
    await freePort();
    const next = order[i + 1];
    if (tunnel === 'ngrok') console.log(yellow(`\n${NGROK_DOWN}`));
    if (next) console.log(yellow(bold(`Switching to ${next === 'ngrok' ? "Expo's tunnel" : "Cloudflare's tunnel"}…\n`)));
  }
  console.log(
    yellow(
      `\n${bold('No tunnel came up.')} Check the Codespace has internet (open https://status.expo.dev and ` +
        'https://www.cloudflarestatus.com), then press Ctrl+C if needed and run npm run start:codespace again.\n',
    ),
  );
  process.exit(1);
}

// ── Output ───────────────────────────────────────────────────────────────────

function printReady(expoGoUrl, checkUrl) {
  console.log('');
  printQr(expoGoUrl);
  console.log(
    [
      green(bold('Ready for Expo Go.')),
      `  Scan the QR code above with the iPhone Camera, or open this address on the phone:`,
      `  ${bold(expoGoUrl)}`,
      `  Use this code, not Expo Go's "Recently opened" list — the address can change between runs.`,
      `  Phone check: ${checkUrl} in Safari should say packager-status:running`,
      '',
    ].join('\n'),
  );
}

function printQr(url) {
  try {
    const fromExpo = createRequire(require.resolve('expo/package.json'));
    const cliDir = path.dirname(fromExpo.resolve('@expo/cli/package.json'));
    const { printQRCode } = require(path.join(cliDir, 'build/src/utils/qr.js'));
    printQRCode(url).print();
  } catch {
    // The address printed below works without the QR code.
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

await freePort();
if (codespace && tryGithub) {
  // True means GitHub's address works and is being watched.
  if (!(await runGithub())) {
    await stopExpo();
    await freePort();
    await runTunnels();
  }
} else {
  await runTunnels();
}
