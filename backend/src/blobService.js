import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { nanoid } from 'nanoid';

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER || 'documents';
const DEFAULT_SAS_MINUTES = 15;
const MIME_BY_EXTENSION = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
};

if (!connectionString) {
  throw new Error('Missing AZURE_STORAGE_CONNECTION_STRING environment variable');
}

export const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
export const containerClient = blobServiceClient.getContainerClient(containerName);

export async function ensureContainer() {
  await containerClient.createIfNotExists();
}

export function sanitizeFileName(name) {
  return String(name || 'file')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
}

function getFileExtension(fileName) {
  const normalized = String(fileName || '').trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');

  if (lastDot <= 0 || lastDot === normalized.length - 1) {
    return '';
  }

  return normalized.slice(lastDot);
}

function bufferStartsWith(buffer, signature) {
  if (!Buffer.isBuffer(buffer) || buffer.length < signature.length) {
    return false;
  }

  return signature.every((byte, index) => buffer[index] === byte);
}

function detectContentTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  if (bufferStartsWith(buffer, [0x25, 0x50, 0x44, 0x46])) {
    return 'application/pdf';
  }

  if (bufferStartsWith(buffer, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) {
    return 'image/png';
  }

  if (bufferStartsWith(buffer, [0xFF, 0xD8, 0xFF])) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 6
    && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a'
      || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'image/gif';
  }

  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }

  if (bufferStartsWith(buffer, [0x42, 0x4D])) {
    return 'image/bmp';
  }

  if (bufferStartsWith(buffer, [0x00, 0x00, 0x01, 0x00])) {
    return 'image/x-icon';
  }

  const textSample = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trimStart();
  if (textSample.startsWith('<svg') || textSample.includes('<svg')) {
    return 'image/svg+xml';
  }

  if (textSample.startsWith('{') || textSample.startsWith('[')) {
    try {
      JSON.parse(textSample);
      return 'application/json';
    } catch {
      // Not JSON after all.
    }
  }

  return null;
}

function hasRenderableMimeType(contentType) {
  const value = String(contentType || '').trim().toLowerCase();

  if (!value || value === 'application/octet-stream' || value === 'binary/octet-stream') {
    return false;
  }

  const [type, subtype] = value.split('/');
  return Boolean(type && subtype && subtype !== 'octet-stream');
}

export function normalizeContentType(contentType, fileName, buffer) {
  const provided = String(contentType || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();
  const extension = getFileExtension(fileName);
  const fromExtension = MIME_BY_EXTENSION[extension] || null;
  const fromBuffer = detectContentTypeFromBuffer(buffer);

  if (hasRenderableMimeType(provided)) {
    if (provided === 'application/image') {
      return fromBuffer || fromExtension || 'application/octet-stream';
    }

    return provided;
  }

  return fromBuffer || fromExtension || provided || 'application/octet-stream';
}

function getTimestamp(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function getSharedKeyCredential() {
  const accountName = connectionString.match(/AccountName=([^;]+)/)?.[1];
  const accountKey = connectionString.match(/AccountKey=([^;]+)/)?.[1];

  if (!accountName || !accountKey) {
    throw new Error('Connection string must include AccountName and AccountKey for SAS generation');
  }

  return new StorageSharedKeyCredential(accountName, accountKey);
}

function buildAttachmentDisposition(fileName) {
  const safeName = sanitizeFileName(fileName || 'download');
  return `attachment; filename="${safeName}"`;
}

function uploadPathForFile(fileName) {
  const safeName = sanitizeFileName(fileName);
  return `${new Date().toISOString().slice(0, 10)}/${nanoid()}-${safeName}`;
}

async function uploadBlobData(blobName, buffer, { contentType, metadata }) {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' },
    metadata,
  });

  return blockBlobClient;
}

function buildFileRecord(blob) {
  const originalName = blob.metadata?.originalName || blob.name.split('/').pop();
  const contentType = normalizeContentType(blob.properties.contentType || 'application/octet-stream', originalName);
  const url = createReadSasUrl(blob.name, DEFAULT_SAS_MINUTES, { contentType });
  const downloadUrl = createDownloadSasUrl(blob.name, originalName, DEFAULT_SAS_MINUTES, contentType);

  return {
    name: blob.name,
    originalName,
    contentType,
    size: blob.properties.contentLength,
    lastModified: blob.properties.lastModified,
    url,
    downloadUrl,
  };
}

export async function uploadFile(file) {
  const blobName = uploadPathForFile(file.originalname);
  const contentType = normalizeContentType(file.mimetype, file.originalname, file.buffer);
  await uploadBlobData(blobName, file.buffer, {
    contentType,
    metadata: {
      originalName: sanitizeFileName(file.originalname),
      uploadedAt: new Date().toISOString(),
      source: 'legacy',
    },
  });

  return {
    name: blobName,
    originalName: file.originalname,
    contentType,
    size: file.size,
    url: createReadSasUrl(blobName, DEFAULT_SAS_MINUTES, { contentType }),
    downloadUrl: createDownloadSasUrl(blobName, file.originalname, DEFAULT_SAS_MINUTES, contentType),
  };
}

export async function listFiles() {
  const files = [];

  for await (const blob of containerClient.listBlobsFlat({ includeMetadata: true })) {
    if (blob.name.startsWith('projects/')) {
      continue;
    }

    files.push(buildFileRecord(blob));
  }

  return files.sort((a, b) => getTimestamp(b.lastModified) - getTimestamp(a.lastModified));
}

export async function deleteFile(blobName) {
  const client = containerClient.getBlobClient(blobName);
  await client.deleteIfExists();
}

export function createReadSasUrl(blobName, minutes = DEFAULT_SAS_MINUTES, { contentDisposition = 'inline', contentType } = {}) {
  const credential = getSharedKeyCredential();
  const validMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_SAS_MINUTES;
  const now = new Date();
  // Backdate the start time a little to avoid SAS failures caused by clock skew.
  const startsOn = new Date(now.valueOf() - 5 * 60 * 1000);
  const expiresOn = new Date(now.valueOf() + validMinutes * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
      contentDisposition,
      contentType,
    },
    credential,
  ).toString();

  return `${containerClient.getBlobClient(blobName).url}?${sas}`;
}

export function createDownloadSasUrl(blobName, fileName, minutes = DEFAULT_SAS_MINUTES, contentType) {
  return createReadSasUrl(blobName, minutes, {
    contentDisposition: buildAttachmentDisposition(fileName),
    contentType,
  });
}
