import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PassThrough, type Readable } from 'stream';
import { StorageService } from './storage.service';

/**
 * S3 (or S3-compatible: MinIO, R2, Spaces) implementation of the storage port.
 * Selected by STORAGE_DRIVER=s3.
 *
 * Unlike the disk driver, objects survive redeploys and are visible to every
 * instance — which the Socket.IO layer already assumes, since it runs multiple
 * instances behind the Redis adapter.
 */
@Injectable()
export class S3StorageService extends StorageService {
  private readonly logger = new Logger('S3Storage');
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    super();
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
    this.bucket = bucket;
    this.client = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      ...(process.env.S3_ENDPOINT
        ? // Custom endpoints are almost always non-AWS providers, which need
          // path-style addressing rather than bucket-as-subdomain.
          { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
        : {}),
      ...(process.env.S3_ACCESS_KEY_ID
        ? {
            credentials: {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
            },
          }
        : {}),
    });
  }

  async save(key: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }),
    );
  }

  /**
   * The port is synchronous (it mirrors fs.createReadStream), but GetObject is
   * not. Hand back a PassThrough immediately and pipe the object into it once
   * the request resolves; a failure is surfaced as an 'error' on that stream,
   * which is what a consumer of a read stream already has to handle.
   */
  createReadStream(key: string): Readable {
    const out = new PassThrough();
    this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      .then((res) => {
        const body = res.Body as Readable | undefined;
        if (!body) {
          out.destroy(new Error(`Empty body for ${key}`));
          return;
        }
        body.on('error', (err) => out.destroy(err));
        body.pipe(out);
      })
      .catch((err) => {
        this.logger.warn(`GetObject failed for ${key}: ${String(err)}`);
        out.destroy(err instanceof Error ? err : new Error(String(err)));
      });
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
      .catch(() => undefined);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
