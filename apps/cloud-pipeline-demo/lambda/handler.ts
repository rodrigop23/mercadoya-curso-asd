import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { S3Event } from 'aws-lambda';

const bucketName = process.env.PIPELINE_BUCKET;
const inputPrefix = process.env.INPUT_PREFIX ?? 'inbox/';
const outputPrefix = process.env.OUTPUT_PREFIX ?? 'outbox/';
const maxObjectSizeBytes = 5 * 1024 * 1024;
const s3 = new S3Client({});

type LogFields = Record<string, unknown>;

function log(step: 'Validate' | 'Transform' | 'Persist', fields: LogFields): void {
  console.log(JSON.stringify({ step, ...fields }));
}

function decodeObjectKey(encodedKey: string): string {
  return decodeURIComponent(encodedKey.replace(/\+/g, ' '));
}

export async function handler(event: S3Event): Promise<void> {
  if (!bucketName) {
    throw new Error('La variable PIPELINE_BUCKET no está configurada.');
  }

  for (const record of event.Records) {
    const sourceKey = decodeObjectKey(record.s3.object.key);

    if (!sourceKey.startsWith(inputPrefix)) {
      log('Validate', { result: 'rejected', reason: 'outside-inbox-prefix', sourceKey });
      continue;
    }

    const metadata = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: sourceKey }));
    const contentType = metadata.ContentType ?? '';
    const contentLength = metadata.ContentLength;
    const contentTypeIsImage =
      contentType.split(';')[0]?.trim().toLowerCase().startsWith('image/') ?? false;
    const sizeIsValid =
      typeof contentLength === 'number' && contentLength > 0 && contentLength <= maxObjectSizeBytes;

    if (!contentTypeIsImage || !sizeIsValid) {
      log('Validate', {
        result: 'rejected',
        sourceKey,
        contentType: contentType || null,
        sizeBytes: contentLength ?? null,
        maxSizeBytes: maxObjectSizeBytes,
      });
      continue;
    }

    log('Validate', {
      result: 'accepted',
      sourceKey,
      contentType,
      sizeBytes: contentLength,
    });

    const source = await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: sourceKey,
        IfMatch: metadata.ETag,
      }),
    );

    if (!source.Body) {
      throw new Error(`S3 no devolvió el contenido de ${sourceKey}.`);
    }

    const body = await source.Body.transformToByteArray();
    const outputKey = `${outputPrefix}${sourceKey.slice(inputPrefix.length)}`;
    const processedAt = new Date().toISOString();

    log('Transform', {
      operation: 'copy-and-stamp-metadata',
      sourceKey,
      outputKey,
      sizeBytes: body.byteLength,
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: outputKey,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: contentType,
        Metadata: {
          'processed-at': processedAt,
          'source-key': encodeURIComponent(sourceKey),
        },
      }),
    );

    log('Persist', {
      sourceKey,
      outputKey,
      bucketName,
      sizeBytes: body.byteLength,
    });
  }
}
