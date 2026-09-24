#!/usr/bin/env node
/**
 * `npm run start:codespace` — serve the app to Expo Go from a GitHub Codespace.
 *
 * Expo's `--tunnel` depends on ngrok, which can stall before any QR code is
 * printed. A Codespace already forwards ports over HTTPS, so instead this:
 *   1. starts Metro on port 8081 with every Expo URL pointing at the
 *      Codespace's forwarded address for that port,
 *   2. makes that port public, because Expo Go can't sign in to GitHub,
 *   3. checks the address answers from outside, then prints its QR code.
 *
 * Outside a Codespace, or with `npm run start:codespace -- --tunnel`, it runs
 * the ngrok tunnel instead.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const PORT = 8081;
const args = process.argv.slice(2);
const codespace = process.env.CODESPACE_NAME;
const useTunnel = args.includes('--tunnel') || !codespace;

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
const host = `${codespace}-${PORT}.${domain}`;
const publicUrl = `https://${host}`;
const expoGoUrl = `exps://${host}`;

// Without this, Metro tries to prepare React Native's desktop DevTools window,
// which needs GUI libraries a Codespace doesn't have (libatk-1.0.so.0).
const env = { ...process.env, EXPO_UNSTABLE_HEADLESS: '1' };
if (!useTunnel) {
  // Expo reads this from the shell, not from .env.
  env.EXPO_PACKAGER_PROXY_URL = publicUrl;
  // Expo's own QR would be exp://…:443, which Expo Go opens over plain HTTP.
  env.EXPO_NO_QR_CODE = '1';
}

const expoArgs = useTunnel
  ? ['expo', 'start', ...(args.includes('--tunnel') ? [] : ['--tunnel']), ...args]
  : ['expo', 'start', '--port', String(PORT), ...args];

/** Whether something already listens on the port inside the Codespace. */
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

// An app server left over from an earlier run (another terminal, or one that
// didn't shut down) keeps port 8081; the new one would then move to 8082 and
// GitHub's address would answer 502. Stop the old one first.
if (!useTunnel && (await portTaken(PORT))) {
  console.log(yellow(`Port ${PORT} is held by an older app server — stopping it first.`));
  try {
    execFileSync('pkill', ['-f', 'node .*expo start'], { stdio: 'ignore' });
  } catch {
    // Nothing matched, or pkill is missing; the check below says if it's still taken.
  }
  for (let i = 0; i < 20 && (await portTaken(PORT)); i++) await delay(500);
  if (await portTaken(PORT)) {
    console.log(
      yellow(
        `Port ${PORT} is still in use by another program. Close the other terminal running the app, ` +
          `or run: pkill -f "expo start"`,
      ),
    );
    process.exit(1);
  }
}

const child = spawn('npx', expoArgs, { stdio: 'inherit', env });
let exited = false;
child.on('exit', (code, signal) => {
  exited = true;
  process.exit(code ?? (signal ? 1 : 0));
});
// Ctrl+C reaches Expo directly; stay alive until it has shut down.
process.on('SIGINT', () => {});
for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));

if (!useTunnel) announceWhenReachable();

async function announceWhenReachable() {
  if (!(await metroRunning())) return;

  const made = await makePortPublic();
  let warned = false;
  // Up to 10 minutes, so there is time to change the port by hand.
  for (let i = 0; i < 200 && !exited; i++) {
    if (await reachable()) {
      printConnectInfo();
      void keepReachable();
      return;
    }
    if (!warned && i >= 3) {
      warned = true;
      console.log(
        [
          '',
          ...forwardingAdvice(),
          made.ok ? '' : yellow(`  (automatic change failed: ${made.output.trim().split('\n')[0]})`),
          '',
        ]
          .filter((l) => l !== '')
          .join('\n'),
      );
    }
    await delay(3000);
  }
  if (!exited) {
    console.log(yellow(`\n${publicUrl} never answered. Restart with: npm run start:codespace -- --tunnel\n`));
  }
}

/**
 * GitHub can drop the port back to private (it does when a Codespace
 * restarts), and Expo Go then gets a bare 404. Check every 30 s and put the
 * port back, so a working QR code stays working.
 */
async function keepReachable() {
  let down = false;
  while (!exited) {
    await delay(30_000);
    if (exited) return;
    if (await reachable()) {
      if (down) console.log(green(`\n${publicUrl} answers again — reload the app in Expo Go.\n`));
      down = false;
      continue;
    }
    if (!down) {
      down = true;
      console.log(
        ['', yellow(bold(`${publicUrl} stopped answering — Expo Go will show an error.`)), ...forwardingAdvice(), ''].join(
          '\n',
        ),
      );
    }
    await makePortPublic();
  }
}

async function metroRunning() {
  for (let i = 0; i < 180 && !exited; i++) {
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

/** HTTP status of the forwarded address (0 when it can't be reached at all). */
let lastStatus = 0;

/** True once the forwarded address serves Metro without a GitHub login. */
async function reachable() {
  try {
    const res = await fetch(`${publicUrl}/status`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    lastStatus = res.status;
    return res.status === 200 && (await res.text()).includes('packager-status:running');
  } catch {
    lastStatus = 0;
    return false;
  }
}

/** What to do about the forwarded address, from what GitHub answered. */
function forwardingAdvice() {
  if (lastStatus === 404) {
    return [
      yellow(bold(`GitHub isn't forwarding port ${PORT} (404), so Expo Go can't reach it.`)),
      `  Open the ${bold('PORTS')} tab next to the terminal. If ${bold(PORT)} isn't listed, click`,
      `  ${bold('Forward a Port')} (or ${bold('Add Port')}) and type ${bold(PORT)}. Then right-click it →`,
      `  ${bold('Port Visibility')} → ${bold('Public')}. The QR code appears here once it answers.`,
    ];
  }
  return [
    yellow(bold(`Port ${PORT} is not public yet (${lastStatus || 'no answer'}), so Expo Go can't reach it.`)),
    `  Open the ${bold('PORTS')} tab next to the terminal, right-click port ${bold(PORT)}`,
    `  → ${bold('Port Visibility')} → ${bold('Public')}. The QR code appears here once it is.`,
  ];
}

function printConnectInfo() {
  console.log('');
  printQr(expoGoUrl);
  console.log(
    [
      green(bold('Ready for Expo Go.')),
      `  Scan the QR code above with the iPhone Camera, or open this address on the phone:`,
      `  ${bold(expoGoUrl)}`,
      `  (Ignore any exp://…:443 address Expo prints — use this one, not Expo Go's recent list.)`,
      `  Phone check: ${publicUrl}/status in Safari should say packager-status:running`,
      '',
    ].join('\n'),
  );
}

function printQr(url) {
  try {
    const require = createRequire(import.meta.url);
    const fromExpo = createRequire(require.resolve('expo/package.json'));
    const cliDir = path.dirname(fromExpo.resolve('@expo/cli/package.json'));
    const { printQRCode } = require(path.join(cliDir, 'build/src/utils/qr.js'));
    printQRCode(url).print();
  } catch {
    // The address printed below works without the QR code.
  }
}
