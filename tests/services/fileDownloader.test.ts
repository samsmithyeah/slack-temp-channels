import { describe, expect, it, vi } from "vitest";
import {
  archivePath,
  buildExportZip,
  collectFiles,
  downloadAll,
  downloadFile,
  type SlackFile,
} from "../../src/services/fileDownloader";

const mockHeaders = { get: () => null };

function makeFile(overrides: Partial<SlackFile> = {}): SlackFile {
  return {
    id: "F001",
    name: "image.png",
    url_private_download: "https://files.slack.com/files-pri/T123/image.png",
    size: 1024,
    ...overrides,
  };
}

describe("downloadFile", () => {
  it("downloads a file with the bot token", async () => {
    const data = Buffer.from("file contents");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: mockHeaders,
        arrayBuffer: () =>
          Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
      }),
    );

    const result = await downloadFile("xoxb-token", makeFile());

    expect(result).toEqual(data);
    expect(fetch).toHaveBeenCalledWith("https://files.slack.com/files-pri/T123/image.png", {
      headers: { Authorization: "Bearer xoxb-token" },
    });

    vi.unstubAllGlobals();
  });

  it("returns null when url_private_download is missing", async () => {
    const result = await downloadFile("xoxb-token", makeFile({ url_private_download: undefined }));
    expect(result).toBeNull();
  });

  it("returns null when file size exceeds limit", async () => {
    const result = await downloadFile("xoxb-token", makeFile({ size: 25 * 1024 * 1024 }));
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await downloadFile("xoxb-token", makeFile());
    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const result = await downloadFile("xoxb-token", makeFile());
    expect(result).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe("archivePath", () => {
  it("prefixes with files/ and includes file id and name", () => {
    expect(archivePath(makeFile({ id: "F123", name: "screenshot.png" }))).toBe(
      "files/F123_screenshot.png",
    );
  });

  it("sanitizes path separators and traversal in filenames", () => {
    expect(archivePath(makeFile({ id: "F1", name: "../../etc/passwd" }))).toBe(
      "files/F1_____etc_passwd",
    );
    expect(archivePath(makeFile({ id: "F2", name: "sub/dir\\file.png" }))).toBe(
      "files/F2_sub_dir_file.png",
    );
  });
});

describe("collectFiles", () => {
  it("collects files from top-level messages", () => {
    const messages = [
      { ts: "1", files: [makeFile({ id: "F1" })] },
      { ts: "2" },
      { ts: "3", files: [makeFile({ id: "F2" }), makeFile({ id: "F3" })] },
    ];

    const result = collectFiles(messages);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.file.id)).toEqual(["F1", "F2", "F3"]);
  });

  it("collects files from replies", () => {
    const messages = [
      {
        ts: "1",
        replies: [{ ts: "1.1", files: [makeFile({ id: "F_REPLY" })] }],
      },
    ];

    const result = collectFiles(messages);

    expect(result).toHaveLength(1);
    expect(result[0].file.id).toBe("F_REPLY");
  });

  it("skips files without url_private_download", () => {
    const messages = [
      {
        ts: "1",
        files: [makeFile({ id: "F1", url_private_download: undefined })],
      },
    ];

    const result = collectFiles(messages);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for messages without files", () => {
    const messages = [{ ts: "1" }, { ts: "2" }];
    expect(collectFiles(messages)).toEqual([]);
  });
});

describe("buildExportZip", () => {
  it("creates a zip buffer containing the transcript", async () => {
    const zip = await buildExportZip("hello world", "transcript.txt", []);

    expect(zip).toBeInstanceOf(Buffer);
    expect(zip.length).toBeGreaterThan(0);
    // ZIP files start with PK (0x50, 0x4b)
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });

  it("creates a zip buffer containing transcript and files", async () => {
    const files = [{ archivePath: "files/F1_image.png", data: Buffer.from("fake png") }];

    const zip = await buildExportZip("transcript", "transcript.txt", files);

    expect(zip).toBeInstanceOf(Buffer);
    expect(zip.length).toBeGreaterThan(0);
  });
});

describe("downloadAll", () => {
  it("downloads files sequentially and returns results", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        const data = Buffer.from(`data for ${url}`);
        return Promise.resolve({
          ok: true,
          headers: mockHeaders,
          arrayBuffer: () =>
            Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)),
        });
      }),
    );

    const collected = [
      {
        file: makeFile({ id: "F1", name: "a.png", url_private_download: "https://example.com/a" }),
        messageTs: "1",
      },
      {
        file: makeFile({ id: "F2", name: "b.png", url_private_download: "https://example.com/b" }),
        messageTs: "2",
      },
    ];

    const result = await downloadAll("xoxb-token", collected);

    expect(result.files).toHaveLength(2);
    expect(result.files[0].archivePath).toBe("files/F1_a.png");
    expect(result.files[1].archivePath).toBe("files/F2_b.png");
    expect(result.totalFiles).toBe(2);
    expect(result.skippedFiles).toBe(0);
    expect(calls).toEqual(["https://example.com/a", "https://example.com/b"]);

    vi.unstubAllGlobals();
  });

  it("skips failed downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({
          ok: true,
          headers: mockHeaders,
          arrayBuffer: () => Promise.resolve(Buffer.from("ok").buffer),
        }),
    );

    const collected = [
      {
        file: makeFile({ id: "F1", url_private_download: "https://example.com/a" }),
        messageTs: "1",
      },
      {
        file: makeFile({ id: "F2", url_private_download: "https://example.com/b" }),
        messageTs: "2",
      },
    ];

    const result = await downloadAll("xoxb-token", collected);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].archivePath).toContain("F2");
    expect(result.totalFiles).toBe(2);
    expect(result.skippedFiles).toBe(1);

    vi.unstubAllGlobals();
  });
});
