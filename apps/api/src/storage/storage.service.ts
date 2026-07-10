import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';

/**
 * Storage port. The disk implementation below is the default; an S3
 * implementation can be swapped in without touching any caller.
 */
@Injectable()
export abstract class StorageService {
  abstract save(key: string, data: Buffer): Promise<void>;
  abstract createReadStream(key: string): Readable;
  abstract delete(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;
}

@Injectable()
export class DiskStorageService extends StorageService {
  private readonly root = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './uploads');

  private resolve(key: string): string {
    // Keys are server-generated uuids, but stay paranoid about traversal.
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root)) throw new Error('Invalid storage key');
    return full;
  }

  async save(key: string, data: Buffer): Promise<void> {
    await fs.promises.mkdir(this.root, { recursive: true });
    await fs.promises.writeFile(this.resolve(key), data);
  }

  createReadStream(key: string): Readable {
    return fs.createReadStream(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.promises.unlink(this.resolve(key)).catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    return fs.promises
      .access(this.resolve(key))
      .then(() => true)
      .catch(() => false);
  }
}
