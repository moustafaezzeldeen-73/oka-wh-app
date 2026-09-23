import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { AssetField, MediaType, Query, requestPermissionsAsync } from 'expo-media-library';
import { Platform } from 'react-native';

import { pickRecording, type RecordingCandidate } from '../api/callRecording';

export type RecordingFile = {
  uri: string;
  /** Name on the phone, e.g. "Call recording 01012345678_260923_1430.m4a". */
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  createdAt: number | null;
  source: 'phone' | 'picked';
};

/**
 * Reading other apps' recordings needs READ_MEDIA_AUDIO, which Expo Go can't
 * request on Android and iOS doesn't offer at all, so automatic pickup only
 * runs in a real Android build. Everywhere else the file picker is the path.
 */
export const canFindAutomatically =
  Platform.OS === 'android' &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

export type FindResult =
  | { status: 'found'; file: RecordingFile }
  | { status: 'none' }
  | { status: 'denied' }
  | { status: 'unavailable' };

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Look for the phone's own recording of a call that began at `startedAt`.
 * Recorders finish writing a few seconds after hang-up, so the search retries
 * briefly before concluding there is none.
 */
export async function findCallRecording(opts: {
  phone: string;
  startedAt: number;
  attempts?: number;
}): Promise<FindResult> {
  if (!canFindAutomatically) return { status: 'unavailable' };

  const perm = await requestPermissionsAsync(false, ['audio']);
  if (!perm.granted) return { status: 'denied' };

  const attempts = opts.attempts ?? 4;
  for (let i = 0; i < attempts; i++) {
    const assets = await new Query()
      .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
      .gte(AssetField.CREATION_TIME, opts.startedAt - 2 * 60_000)
      .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
      .limit(15)
      .exe();

    const candidates: (RecordingCandidate & { asset: (typeof assets)[number] })[] =
      await Promise.all(
        assets.map(async (asset) => ({
          asset,
          id: asset.id,
          filename: await asset.getFilename(),
          creationTime: await asset.getCreationTime(),
          duration: await asset.getDuration(),
        })),
      );

    const best = pickRecording(candidates, {
      phone: opts.phone,
      startedAt: opts.startedAt,
      now: Date.now(),
    });
    if (best) {
      const match = candidates.find((c) => c.id === best.id)!;
      const uri = await match.asset.getUri();
      return {
        status: 'found',
        file: {
          uri,
          name: best.filename,
          mimeType: null,
          sizeBytes: sizeOf(uri),
          durationSec: best.duration !== null ? Math.round(best.duration / 1000) : null,
          createdAt: best.creationTime,
          source: 'phone',
        },
      };
    }
    if (i < attempts - 1) await delay(2500);
  }
  return { status: 'none' };
}

/** System file picker, filtered to audio. Works in Expo Go and on iOS. */
export async function chooseRecordingFile(): Promise<RecordingFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return {
    uri: a.uri,
    name: a.name,
    mimeType: a.mimeType ?? null,
    sizeBytes: a.size ?? sizeOf(a.uri),
    durationSec: null,
    createdAt: null,
    source: 'picked',
  };
}

export async function readBase64(uri: string): Promise<string> {
  return new File(uri).base64();
}

function sizeOf(uri: string): number | null {
  try {
    return new File(uri).size ?? null;
  } catch {
    return null;
  }
}

/** Write text to a cache file and return its URI, for uploading. */
export function writeTempText(name: string, text: string): string {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  return file.uri;
}
