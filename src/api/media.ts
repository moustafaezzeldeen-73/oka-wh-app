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

export type UploadKind = 'image' | 'audio';

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

/**
 * Upload a local file and return its Shopify CDN URL.
 * Returns null only if Shopify never finished processing — the caller still
 * logs the activity, just without a link.
 */
export async function uploadToShopify(
  localUri: string,
  kind: UploadKind,
  opts: { orderName: string; label: string; fileSize?: number },
): Promise<string | null> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeOrder = opts.orderName.replace(/[^\w-]/g, '');
  const ext = kind === 'image' ? 'jpg' : 'm4a';
  const mimeType = kind === 'image' ? 'image/jpeg' : 'audio/m4a';
  const filename = `oka-${safeOrder}-${opts.label}-${stamp}.${ext}`;

  const target = await createStagedTarget(filename, mimeType, kind, opts.fileSize);
  await putBytes(target, localUri, filename, mimeType);
  const fileId = await createFile(target.resourceUrl, kind, `${opts.orderName} · ${opts.label}`);
  return waitForUrl(fileId);
}
