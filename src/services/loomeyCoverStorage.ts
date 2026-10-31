import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function config() {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  const region = process.env.AWS_DEFAULT_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("Loomey cover storage is not configured");
  }
  return { bucket, client: new S3Client({
    endpoint, region, forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  }) };
}

export async function uploadLoomeyCover(key: string, bytes: Buffer, mimeType: string) {
  const { bucket, client } = config();
  await client.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: bytes, ContentType: mimeType,
    CacheControl: "private, max-age=86400",
  }));
}

export async function signedLoomeyCoverURL(key: string) {
  const { bucket, client } = config();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
}

export async function deleteLoomeyCover(key: string) {
  const { bucket, client } = config();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
