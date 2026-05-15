declare module "archiver" {
  import type { Transform } from "node:stream";

  interface ArchiverOptions {
    zlib?: { level: number };
  }

  interface EntryData {
    name: string;
  }

  class Archiver extends Transform {
    append(source: Buffer | string, data: EntryData): this;
    finalize(): Promise<void>;
  }

  class ZipArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }

  export { Archiver, ZipArchive };
}
