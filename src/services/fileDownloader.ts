import { PassThrough } from "node:stream";
import { ZipArchive } from "archiver";

export interface SlackFile {
  id: string;
  name: string;
  size?: number;
  url_private_download?: string;
}

interface DownloadedFile {
  archivePath: string;
  data: Buffer;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

export async function downloadFile(token: string, file: SlackFile): Promise<Buffer | null> {
  if (!file.url_private_download) return null;
  if (file.size && file.size > MAX_FILE_SIZE) return null;

  try {
    const response = await fetch(file.url_private_download, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE) return null;
    return buffer;
  } catch {
    return null;
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, "_").replace(/\.\./g, "_");
}

export function archivePath(file: SlackFile): string {
  return `files/${file.id}_${sanitizeFileName(file.name)}`;
}

export async function buildExportZip(
  transcript: string,
  transcriptFilename: string,
  files: DownloadedFile[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const passthrough = new PassThrough();
    const chunks: Buffer[] = [];

    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(chunks)));
    passthrough.on("error", reject);

    archive.pipe(passthrough);
    archive.append(transcript, { name: transcriptFilename });
    for (const file of files) {
      archive.append(file.data, { name: file.archivePath });
    }
    archive.finalize();
  });
}

interface CollectedFile {
  file: SlackFile;
  messageTs: string;
}

interface MessageWithFiles {
  ts?: string;
  files?: SlackFile[];
  replies?: MessageWithFiles[];
}

export function collectFiles(messages: MessageWithFiles[]): CollectedFile[] {
  const result: CollectedFile[] = [];
  for (const msg of messages) {
    if (msg.files) {
      for (const file of msg.files) {
        if (file.url_private_download) {
          result.push({ file, messageTs: msg.ts ?? "" });
        }
      }
    }
    if (msg.replies) {
      for (const reply of msg.replies) {
        if (reply.files) {
          for (const file of reply.files) {
            if (file.url_private_download) {
              result.push({ file, messageTs: reply.ts ?? "" });
            }
          }
        }
      }
    }
  }
  return result;
}

interface DownloadResult {
  files: DownloadedFile[];
  totalFiles: number;
  skippedFiles: number;
}

export async function downloadAll(
  token: string,
  collectedFiles: CollectedFile[],
): Promise<DownloadResult> {
  const downloaded: DownloadedFile[] = [];
  let totalSize = 0;
  let skipped = 0;

  for (const { file } of collectedFiles) {
    if (totalSize >= MAX_TOTAL_SIZE) {
      skipped++;
      continue;
    }

    const data = await downloadFile(token, file);
    if (data) {
      if (totalSize + data.length > MAX_TOTAL_SIZE) {
        skipped++;
        continue;
      }
      totalSize += data.length;
      downloaded.push({ archivePath: archivePath(file), data });
    } else {
      skipped++;
    }
  }

  return { files: downloaded, totalFiles: collectedFiles.length, skippedFiles: skipped };
}
