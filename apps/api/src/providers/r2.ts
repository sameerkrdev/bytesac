import { S3Client } from "@aws-sdk/client-s3";
import { env } from "../env";

/**
 * Private Cloudflare R2 bucket over its S3-compatible API. Checksums only when an operation requires one: the SDK default would hoist a
 * CRC32 of the empty body into presigned PUT URLs, which the browser's real upload can never match.
 */
export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
export const R2_BUCKET = env.R2_BUCKET;
