/**
 * Picking up the phone's own call recording after a call.
 *
 * An ordinary app can't record a phone call, but most Android phones sold in
 * Egypt record every call themselves (Samsung, Xiaomi, and Google's Phone app)
 * and save it as an audio file. After a call the app looks for that file,
 * renames the copy it uploads so it's traceable to the order, and sends it to
 * Gemini for a transcript.
 *
 * Free of network and native imports so the matching rules can be exercised
 * directly — see scripts/test-logic.ts.
 */

export type RecordingCandidate = {
  id: string;
  filename: string;
  /** Unix ms. */
  creationTime: number | null;
  /** Seconds. */
  duration: number | null;
};

/**
 * The last nine digits identify an Egyptian mobile number whether it's written
 * +2010…, 002010…, 010… or 10… — recorders use all of these in filenames.
 */
export function phoneKey(phone: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

/** How far before "Start call" a recording may begin (clock skew, quick taps). */
const EARLY_MS = 2 * 60_000;

/**
 * Choose the recording that belongs to this call.
 *
 * Candidates must have been created after the call started (with a little
 * slack) and not in the future. Among those, one whose filename carries the
 * number wins — recorders that name files after the contact still match on
 * timing alone. Ties go to the recording created closest to the tap on
 * "Start call".
 */
export function pickRecording(
  candidates: RecordingCandidate[],
  opts: { phone: string; startedAt: number; now: number },
): RecordingCandidate | null {
  const key = phoneKey(opts.phone);
  const eligible = candidates.filter((c) => {
    if (c.creationTime === null) return false;
    if (c.creationTime < opts.startedAt - EARLY_MS) return false;
    if (c.creationTime > opts.now + 60_000) return false;
    return c.duration === null || c.duration > 0;
  });
  if (eligible.length === 0) return null;

  const matchesNumber = (c: RecordingCandidate) =>
    key !== '' && c.filename.replace(/\D/g, '').includes(key);
  const distance = (c: RecordingCandidate) => Math.abs((c.creationTime as number) - opts.startedAt);

  return eligible.slice().sort((a, b) => {
    const byNumber = Number(matchesNumber(b)) - Number(matchesNumber(a));
    return byNumber !== 0 ? byNumber : distance(a) - distance(b);
  })[0];
}

export function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(filename.trim());
  return m ? m[1].toLowerCase() : '';
}

const MIME: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  amr: 'audio/amr',
  '3gp': 'audio/3gpp',
  '3gpp': 'audio/3gpp',
};

export function audioMimeType(filename: string, reported?: string | null): string {
  const byExt = MIME[extensionOf(filename)];
  if (byExt) return byExt;
  if (reported && reported.startsWith('audio/')) return reported;
  return 'audio/mp4';
}

/**
 * Formats Gemini accepts as inline audio. AMR and 3GP — used by some older
 * Samsung and Xiaomi recorders — are not among them; those recordings are
 * still uploaded, just not transcribed.
 */
const GEMINI_AUDIO = new Set([
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
]);

export function geminiCanTranscribe(mimeType: string): boolean {
  return GEMINI_AUDIO.has(mimeType);
}

/**
 * Inline requests to Gemini are capped at 20 MB and base64 adds a third, so
 * the raw audio has to stay under ~14 MB — roughly 15 minutes of a typical
 * phone recording.
 */
export const MAX_TRANSCRIBE_BYTES = 14 * 1024 * 1024;

/** Cairo wall-clock time as YYYYMMDD-HHmm, for filenames staff can read. */
export function cairoStamp(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}-${hour}${get('minute')}`;
}

/**
 * The name the recording is uploaded under, e.g.
 * `oka-2623721-7433950202-customer-20260923-1430.m4a`. The original file on the
 * phone is left untouched.
 */
export function recordingFilename(opts: {
  orderName: string;
  awb: string | null;
  target: 'customer' | 'courier';
  startedAt: number;
  originalName: string;
}): string {
  const order = opts.orderName.replace(/[^\w-]/g, '');
  const awb = (opts.awb ?? '').replace(/[^\w-]/g, '');
  const ext = extensionOf(opts.originalName) || 'm4a';
  return ['oka', order, awb || null, opts.target, cairoStamp(opts.startedAt)]
    .filter(Boolean)
    .join('-')
    .concat(`.${ext}`);
}
