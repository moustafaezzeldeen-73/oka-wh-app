#!/usr/bin/env node
/**
 * `npm run build:apk` — build OKA Warehouse as an installable Android app
 * (oka-warehouse.apk) for phones that can't run Expo Go, such as the
 * warehouse's Huawei nova plus (MLA-L11, Android 7.0). Copy the APK onto the
 * phone over USB and tap it to install.
 *
 * Run it in the Codespace (it needs Google's Android download servers).
 * - First run sets up the Android SDK in ~/android-sdk (about 4 GB, 10–15 min).
 * - The build takes 15–40 min on a 2-core Codespace the first time, a few
 *   minutes after that.
 * - The app needs Android 7.0 (API 24) or newer — React Native's minimum.
 *
 * The keys in .env are built into the APK, just as they are served to Expo Go:
 * only give the file to OKA staff.
 *
 *   npm run build:apk              # build (or rebuild) oka-warehouse.apk
 *   npm run build:apk -- --clean   # regenerate the Android project first
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './live-common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'oka-warehouse.apk');
const CLEAN = process.argv.includes('--clean');
// Both ARM flavours: some 64-bit phones of that era run a 32-bit Android.
const ABIS = 'armeabi-v7a,arm64-v8a';
const REPO = 'https://dl.google.com/android/repository';

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const step = (n, s) => console.log(`\n${bold(`[${n}/6] ${s}`)}`);

function fail(msg) {
  console.error(`\n${red(bold('Build stopped:'))} ${msg}\n`);
  process.exit(1);
}

/** Run a command with output shown; resolves on exit 0. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: opts.input ? ['pipe', 'inherit', 'inherit'] : 'inherit', ...opts });
    if (opts.input) {
      p.stdin.on('error', () => undefined);
      p.stdin.end(opts.input);
    }
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}

const has = (cmd) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

function aptInstall(pkgs) {
  console.log(`Installing ${pkgs.join(', ')}…`);
  execFileSync('sudo', ['apt-get', 'update', '-qq'], { stdio: 'inherit' });
  execFileSync('sudo', ['apt-get', 'install', '-y', '-qq', ...pkgs], { stdio: 'inherit' });
}

/** The versions React Native itself builds against, so upgrades stay in step. */
function rnVersions() {
  const toml = readFileSync(path.join(ROOT, 'node_modules/react-native/gradle/libs.versions.toml'), 'utf8');
  const v = (k, d) => new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, 'm').exec(toml)?.[1] ?? d;
  return {
    minSdk: v('minSdk', '24'),
    compileSdk: v('compileSdk', '36'),
    buildTools: v('buildTools', '36.0.0'),
    ndk: v('ndkVersion', '27.1.12297006'),
  };
}

// ── 1. Checks ────────────────────────────────────────────────────────────────
step(1, 'Checking the Codespace');
const loaded = loadEnv();
if (!loaded) fail('no .env file. The app needs its Shopify and courier keys: copy .env.example to .env and fill it in.');
if (loaded.cutAtHash.length) {
  fail(`these .env values contain an unquoted # and would be cut short: ${loaded.cutAtHash.join(', ')}. Put them in quotes.`);
}
if (!existsSync(path.join(ROOT, 'node_modules/react-native'))) fail('dependencies missing — run npm install first.');

const freeGb = (() => {
  try {
    const out = execFileSync('df', ['-Pk', os.homedir()], { encoding: 'utf8' }).trim().split('\n').pop().split(/\s+/);
    return Number(out[3]) / 1024 / 1024;
  } catch {
    return null;
  }
})();
if (freeGb !== null && freeGb < 8) {
  fail(`only ${freeGb.toFixed(1)} GB free; the Android tools and build need about 10 GB. Delete large files or use a bigger Codespace.`);
}

/** A JDK's major version (`java -version` prints `version "17.0.20"` on stderr), or 0. */
function javaMajor(bin = 'java') {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return Number(/version "(\d+)/.exec(`${r.stderr ?? ''}${r.stdout ?? ''}`)?.[1] ?? 0);
}

/**
 * React Native's Gradle plugin compiles with a Java 17 toolchain, whatever
 * Java runs Gradle; without a JDK 17 Gradle tries to download one mid-build.
 */
function findJdk17() {
  const homes = [process.env.JAVA_HOME].filter(Boolean);
  for (const dir of ['/usr/lib/jvm', '/usr/local/sdkman/candidates/java', path.join(os.homedir(), '.sdkman/candidates/java'), '/opt/java']) {
    try {
      for (const d of readdirSync(dir)) homes.push(path.join(dir, d));
    } catch {
      // Not on this machine.
    }
  }
  return homes.find((h) => existsSync(path.join(h, 'bin', 'java')) && javaMajor(path.join(h, 'bin', 'java')) === 17) ?? null;
}
let JDK17 = findJdk17();
if (!JDK17) {
  aptInstall(['openjdk-17-jdk-headless']);
  JDK17 = findJdk17();
  if (!JDK17) fail('Java 17 is needed for the Android build and could not be installed (sudo apt-get install openjdk-17-jdk-headless).');
}
const v = rnVersions();
console.log(`  Java 17 (${JDK17}) · Android SDK ${v.compileSdk} · build-tools ${v.buildTools} · NDK ${v.ndk} · runs on Android 7.0+ (API ${v.minSdk})`);

// ── 2. Android SDK ───────────────────────────────────────────────────────────
step(2, 'Android SDK');
const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'android-sdk');
const sdkmanager = path.join(SDK, 'cmdline-tools', 'latest', 'bin', 'sdkmanager');

if (!existsSync(sdkmanager)) {
  if (!has('unzip')) aptInstall(['unzip']);
  // The current command-line tools archive, from Google's own package index.
  let zip = 'commandlinetools-linux-13114758_latest.zip';
  try {
    const xml = await (await fetch(`${REPO}/repository2-3.xml`)).text();
    const builds = [...xml.matchAll(/commandlinetools-linux-(\d+)_latest\.zip/g)].map((m) => Number(m[1]));
    if (builds.length) zip = `commandlinetools-linux-${Math.max(...builds)}_latest.zip`;
  } catch {
    // Keep the known-good archive name.
  }
  console.log(`  Downloading Android command-line tools (${zip})…`);
  let body;
  try {
    const res = await fetch(`${REPO}/${zip}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    fail(`couldn't download the Android tools from dl.google.com (${e.cause?.code ?? e.message}). Check the Codespace's internet and run it again.`);
  }
  const tmp = path.join(os.tmpdir(), `oka-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  writeFileSync(path.join(tmp, 'tools.zip'), body);
  execFileSync('unzip', ['-q', path.join(tmp, 'tools.zip'), '-d', tmp]);
  mkdirSync(path.join(SDK, 'cmdline-tools'), { recursive: true });
  rmSync(path.join(SDK, 'cmdline-tools', 'latest'), { recursive: true, force: true });
  renameSync(path.join(tmp, 'cmdline-tools'), path.join(SDK, 'cmdline-tools', 'latest'));
  rmSync(tmp, { recursive: true, force: true });
}

const sdkEnv = {
  ...process.env,
  JAVA_HOME: JDK17,
  ANDROID_HOME: SDK,
  ANDROID_SDK_ROOT: SDK,
  PATH: `${path.join(JDK17, 'bin')}:${path.join(SDK, 'platform-tools')}:${process.env.PATH}`,
};
const packages = [
  'platform-tools',
  `platforms;android-${v.compileSdk}`,
  `build-tools;${v.buildTools}`,
  `ndk;${v.ndk}`,
  'cmake;3.22.1',
];
const missing = packages.filter((p) => !existsSync(path.join(SDK, ...p.split(';'))));
if (missing.length) {
  console.log('  Accepting the Android SDK licences…');
  await run(sdkmanager, ['--licenses'], { env: sdkEnv, input: 'y\n'.repeat(30) }).catch(() => undefined);
  console.log(`  Installing ${missing.join(', ')} (the NDK is the big one)…`);
  try {
    await run(sdkmanager, ['--install', ...missing], { env: sdkEnv, input: 'y\n'.repeat(30) });
  } catch (e) {
    fail(`the Android SDK packages didn't install (${e.message}). Run npm run build:apk again — downloads resume.`);
  }
} else {
  console.log(`  Already set up in ${SDK}.`);
}

// ── 3. Native Android project ────────────────────────────────────────────────
step(3, 'Generating the Android project from app.config.js');
const pkgPath = path.join(ROOT, 'package.json');
const pkgBefore = readFileSync(pkgPath, 'utf8');
// The keys reach app.config.js (and so the APK) through the environment.
const buildEnv = { ...sdkEnv, ...loaded.env, CI: '1' };
try {
  await run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', ...(CLEAN ? ['--clean'] : [])], {
    cwd: ROOT,
    env: buildEnv,
  });
} catch (e) {
  fail(`expo prebuild failed (${e.message}) — see the error above.`);
} finally {
  // Prebuild points `npm run android` at a local emulator build; keep ours.
  if (readFileSync(pkgPath, 'utf8') !== pkgBefore) writeFileSync(pkgPath, pkgBefore);
}
writeFileSync(path.join(ROOT, 'android', 'local.properties'), `sdk.dir=${SDK}\n`);

// ── 4. Build ─────────────────────────────────────────────────────────────────
step(4, `Building the APK (${ABIS}) — the first build takes a while`);
const started = Date.now();
try {
  await run(
    './gradlew',
    [
      'assembleRelease',
      `-PreactNativeArchitectures=${ABIS}`,
      '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8',
      '--console=plain',
    ],
    { cwd: path.join(ROOT, 'android'), env: buildEnv },
  );
} catch (e) {
  fail(
    `the Gradle build failed (${e.message}). Scroll up to the first "FAILURE" or "error:" line and send it over.` +
      ' If it says the daemon disappeared or ran out of memory, close other programs or use a bigger Codespace and run it again.',
  );
}

// ── 5. Output ────────────────────────────────────────────────────────────────
step(5, 'Collecting the APK');
const built = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(built)) fail(`the build finished but ${path.relative(ROOT, built)} is missing.`);
copyFileSync(built, OUT);
const mb = (statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(green(`  ${path.relative(ROOT, OUT)} — ${mb} MB, built in ${Math.round((Date.now() - started) / 60000)} min.`));

// ── 6. How to install ────────────────────────────────────────────────────────
step(6, 'Installing it on the phone over USB');
console.log(
  [
    `  1. In the Codespace's file list (left), right-click ${bold('oka-warehouse.apk')} → ${bold('Download')}.`,
    '  2. Plug the phone into the computer with USB. On the phone, pull down the notification',
    `     and choose ${bold('Transfer files')} (also called File transfer / MTP).`,
    "  3. On the computer, open the phone's storage and copy oka-warehouse.apk into its Download folder.",
    `  4. On the phone, open ${bold('Files')} → Download → tap oka-warehouse.apk → ${bold('Install')}.`,
    `     If it says installation is blocked, tap Settings, turn on ${bold('Unknown sources')}, go back and tap the file again.`,
    '  5. Open OKA Warehouse. Allow the camera when it asks (for scanning).',
    '',
    '  To update later: run npm run build:apk again and install the new file over the old one.',
    '',
  ].join('\n'),
);
