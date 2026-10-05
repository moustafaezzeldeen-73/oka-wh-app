/**
 * Uploads photos and call recordings to Shopify Files, so every attachment the
 * warehouse captures gets a permanent CDN URL that can be linked from the
 * order's log.
 *
 * Three steps, as Shopify requires:
 *   1. `stagedUploadsCreate` → a signed upload target
 *   2. multipart POST of the bytes to that target
 *   3. `fileCreate` → a Shopify File, then poll until it is READY
 */

import { ApiError } from './http';
import { assertNoUserErrors, shopifyGraphQL } from './shopify';

type StagedTarget = {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
};

export type UploadKind = 'image' | 'audio' | 'text';

async function createStagedTarget(
  filename: string,
  mimeType: string,
  kind: UploadKind,
  fileSize?: number,
): Promise<StagedTarget> {
  const data = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[];
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation StagedUpload($input: [StagedUploadInput!]!) {
       stagedUploadsCreate(input: $input) {
         stagedTargets { url resourceUrl parameters { name value } }
         userErrors { field message }
       }
     }`,
    {
      input: [
        {
          filename,
          mimeType,
          resource: kind === 'image' ? 'IMAGE' : 'FILE',
          httpMethod: 'POST',
          ...(fileSize ? { fileSize: String(fileSize) } : {}),
        },
      ],
    },
  );

  assertNoUserErrors(data.stagedUploadsCreate, 'stagedUploadsCreate');
  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new ApiError('shopify', 200, 'stagedUploadsCreate returned no target');
  return target;
}

async function putBytes(
  target: StagedTarget,
  localUri: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  const form = new FormData();
  // Shopify's signed parameters must precede the file part.
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', {
    uri: localUri,
    name: filename,
    type: mimeType,
  } as unknown as Blob);

  const res = await fetch(target.url, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError('shopify', res.status, `staged upload failed`, body.slice(0, 400));
  }
}

async function createFile(
  resourceUrl: string,
  kind: UploadKind,
  alt: string,
): Promise<string> {
  const data = await shopifyGraphQL<{
    fileCreate: {
      files: { id: string; fileStatus: string }[];
      userErrors: { field?: string[] | null; message: string }[];
    };
  }>(
    `mutation FileCreate($files: [FileCreateInput!]!) {
       fileCreate(files: $files) {
         files { id fileStatus }
         userErrors { field message }
       }
     }`,
    {
      files: [
        {
          originalSource: resourceUrl,
          contentType: kind === 'image' ? 'IMAGE' : 'FILE',
          alt,
        },
      ],
    },
  );

  assertNoUserErrors(data.fileCreate, 'fileCreate');
  const file = data.fileCreate.files[0];
  if (!file) throw new ApiError('shopify', 200, 'fileCreate returned no file');
  return file.id;
}

/** Shopify processes uploads asynchronously; wait for the public URL. */
async function waitForUrl(fileId: string, attempts = 12): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const data = await shopifyGraphQL<{
      node:
        | ({ id: string; fileStatus?: string } & {
            image?: { url: string } | null;
            url?: string | null;
            preview?: { image?: { url: string } | null } | null;
          })
        | null;
    }>(
      `query FileUrl($id: ID!) {
         node(id: $id) {
           id
           ... on MediaImage {
             fileStatus
             image { url }
           }
           ... on GenericFile {
             fileStatus
             url
           }
         }
       }`,
      { id: fileId },
    );

    const node = data.node;
    const url = node?.image?.url ?? node?.url ?? null;
    if (url) return url;
    if (node?.fileStatus === 'FAILED') return null;

    await new Promise((r) => setTimeout(r, 800 + i * 300));
  }
  return null;
}

/** Shopify's access-denied wording, turned into the fix. */
function explainUploadError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/access denied|ACCESS_DENIED|write_files|read_files/i.test(msg)) {
    return new Error(
      'Shopify refused the upload: the app needs the read_files and write_files permissions. ' +
        'Add them to the app version in the Shopify Dev Dashboard, release it, and approve the update on the store.',
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

/**
 * Upload a local file; returns the Shopify File id and, once Shopify has
 * processed it, its CDN URL (null if that takes longer than ~30 s — the file
 * is still saved, and the id resolves to a URL later).
 */
export async function uploadFile(
  localUri: string,
  kind: UploadKind,
  opts: {
    orderName: string;
    label: string;
    fileSize?: number;
    filename?: string;
    mimeType?: string;
  },
): Promise<{ fileId: string; url: string | null }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeOrder = opts.orderName.replace(/[^\w-]/g, '');
  const ext = kind === 'image' ? 'jpg' : kind === 'text' ? 'txt' : 'm4a';
  const mimeType =
    opts.mimeType ??
    (kind === 'image' ? 'image/jpeg' : kind === 'text' ? 'text/plain' : 'audio/mp4');
  const filename = opts.filename ?? `oka-${safeOrder}-${opts.label}-${stamp}.${ext}`;

  try {
    const target = await createStagedTarget(filename, mimeType, kind, opts.fileSize);
    await putBytes(target, localUri, filename, mimeType);
    const fileId = await createFile(target.resourceUrl, kind, `${opts.orderName} · ${opts.label}`);
    return { fileId, url: await waitForUrl(fileId) };
  } catch (err) {
    throw explainUploadError(err);
  }
}

/**
 * Upload a local file and return its Shopify CDN URL.
 * Returns null only if Shopify never finished processing — the caller still
 * logs the activity, just without a link.
 */
export async function uploadToShopify(
  localUri: string,
  kind: UploadKind,
  opts: {
    orderName: string;
    label: string;
    fileSize?: number;
    /** Upload under this name instead of a generated one. */
    filename?: string;
    mimeType?: string;
  },
): Promise<string | null> {
  return (await uploadFile(localUri, kind, opts)).url;
}
