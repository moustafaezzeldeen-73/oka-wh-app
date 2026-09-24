/**
 * Turns a finished call into order-log entries: uploads the phone's recording
 * to Shopify Files under a traceable name, transcribes it with Gemini, uploads
 * the transcript as a text file, and describes all of it for the log.
 *
 * The upload and the transcription run in parallel, and neither failing stops
 * the call itself from being logged — a problem becomes a visible log line.
 */

import { makeEntry, type ActivityEntry, type CallOutcome } from './activity';
import {
  MAX_TRANSCRIBE_BYTES,
  audioMimeType,
  extensionOf,
  geminiCanTranscribe,
  recordingFilename,
} from './callRecording';
import { transcribeCall, transcriptionConfigured } from './gemini';
import type { Transcription } from './geminiTranscript';
import { uploadToShopify } from './media';
import type { Order } from './model';
import { readBase64, writeTempText, type RecordingFile } from '../device/callRecordings';

export type CallArgs = {
  target: 'customer' | 'courier';
  phone: string;
  contactName: string;
  /** Unix ms of the tap on "Start call". */
  startedAt: number;
  /** Seconds between "Start call" and "End call" in the app. */
  timerSec: number;
  outcome: CallOutcome;
  recording: RecordingFile | null;
};

export type Stage = 'uploading' | 'saving';

const OUTCOME_TEXT: Record<CallOutcome, string> = {
  answered: 'answered — confirmed',
  noanswer: 'no answer',
  wrongnumber: 'wrong number',
  refused: 'refused the order',
};

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function processCall(
  order: Order,
  args: CallArgs,
  onStage: (s: Stage) => void,
): Promise<ActivityEntry[]> {
  const problems: string[] = [];
  let recordingUrl: string | null = null;
  let transcriptUrl: string | null = null;
  let transcription: Transcription | null = null;
  let uploadedAs: string | null = null;

  const rec = args.recording;
  if (rec) {
    onStage('uploading');
    const mimeType = audioMimeType(rec.name, rec.mimeType);
    uploadedAs = recordingFilename({
      orderName: order.name,
      awb: order.awb,
      target: args.target,
      startedAt: args.startedAt,
      originalName: rec.name,
    });

    const upload = uploadToShopify(rec.uri, 'audio', {
      orderName: order.name,
      label: `call-${args.target}`,
      filename: uploadedAs,
      mimeType,
      fileSize: rec.sizeBytes ?? undefined,
    });

    const transcribe = (async (): Promise<Transcription | null> => {
      if (!transcriptionConfigured()) {
        problems.push('Not transcribed: GEMINI_API_KEY is not set');
        return null;
      }
      if (!geminiCanTranscribe(mimeType)) {
        problems.push(`Not transcribed: Gemini can't read .${extensionOf(rec.name) || 'unknown'} recordings`);
        return null;
      }
      if (rec.sizeBytes && rec.sizeBytes > MAX_TRANSCRIBE_BYTES) {
        problems.push('Not transcribed: recording is over 14 MB (about 15 minutes)');
        return null;
      }
      const audio = await readBase64(rec.uri);
      return transcribeCall(audio, mimeType, {
        orderName: order.name,
        target: args.target,
        contactName: args.contactName,
        products: order.items.map((i) => i.title),
      });
    })();

    const [up, tr] = await Promise.allSettled([upload, transcribe]);

    if (up.status === 'fulfilled') recordingUrl = up.value;
    else problems.push(`Recording upload failed: ${message(up.reason)}`);

    if (tr.status === 'fulfilled') transcription = tr.value;
    else problems.push(`Transcription failed: ${message(tr.reason)}`);

    if (transcription?.transcript) {
      const text = [
        `Order ${order.name}${order.awb ? ` · AWB ${order.awb}` : ''}`,
        `Call to ${args.target} ${args.contactName} ${args.phone}`,
        `Recorded ${new Date(rec.createdAt ?? args.startedAt).toISOString()}`,
        recordingUrl ? `Recording: ${recordingUrl}` : '',
        '',
        `Summary: ${transcription.summary}`,
        '',
        transcription.transcript,
        '',
      ]
        .filter((l, i, all) => l !== '' || all[i - 1] !== '')
        .join('\n');
      try {
        const name = uploadedAs.replace(/\.[^.]+$/, '') + '-transcript.txt';
        transcriptUrl = await uploadToShopify(writeTempText(name, text), 'text', {
          orderName: order.name,
          label: `transcript-${args.target}`,
          filename: name,
          mimeType: 'text/plain',
        });
      } catch (err) {
        problems.push(`Transcript upload failed: ${message(err)}`);
      }
    }
  }

  onStage('saving');
  const who = args.target === 'courier' ? 'courier' : 'customer';
  const summary = transcription?.summary ? ` — ${transcription.summary}` : '';
  const entries: ActivityEntry[] = [
    makeEntry('call', `Call to ${who} ${args.phone} — ${OUTCOME_TEXT[args.outcome]}${summary}`, {
      durationSec: rec?.durationSec ?? args.timerSec,
      outcome: args.outcome,
      mediaUrl: recordingUrl ?? undefined,
      meta: {
        awb: order.awb,
        target: args.target,
        recording: uploadedAs,
        recordingSource: rec?.source ?? null,
        transcriptUrl,
      },
    }),
  ];
  if (transcriptUrl) {
    entries.push(makeEntry('recording', 'Call transcript', { mediaUrl: transcriptUrl }));
  }
  if (!rec) {
    entries.push(makeEntry('note', 'No call recording attached'));
  }
  for (const p of problems) entries.push(makeEntry('note', p));
  return entries;
}
