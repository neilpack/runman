// Shared AWS SDK v3 clients. Create clients once and reuse them (important on Lambda).
// Credentials come from the default provider chain: env vars, AWS_PROFILE, or the Lambda role.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';

const region = config.aws.region;

export const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

export const s3 = new S3Client({ region });
