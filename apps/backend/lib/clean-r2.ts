import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

async function cleanR2Bucket() {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
        console.error("R2 environment variables not configured!");
        console.error("Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME");
        process.exit(1);
    }

    console.log(`📦 Bucket: ${R2_BUCKET_NAME}`);
    console.log(`🌐 Endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com\n`);

    const s3Client = new S3Client({
        region: "auto",
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY
        }
    });

    try {
        console.log("Listing all objects in bucket...\n");

        let continuationToken: string | undefined;
        let allObjects: { Key?: string; Size?: number }[] = [];

        do {
            const listCommand = new ListObjectsV2Command({
                Bucket: R2_BUCKET_NAME,
                ContinuationToken: continuationToken
            });

            const listResult = await s3Client.send(listCommand);
            const objects = listResult.Contents || [];
            allObjects = allObjects.concat(objects);
            continuationToken = listResult.NextContinuationToken;
        } while (continuationToken);

        if (allObjects.length === 0) {
            console.log("Bucket is already empty! Nothing to delete.");
            return;
        }

        console.log(`Found ${allObjects.length} objects:\n`);

        const projects = new Map<string, number>();
        let totalSize = 0;

        for (const obj of allObjects) {
            if (obj.Key) {
                const parts = obj.Key.split('/');
                if (parts.length >= 2) {
                    const projectKey = `${parts[0]}/${parts[1]}`;
                    projects.set(projectKey, (projects.get(projectKey) || 0) + 1);
                }
                totalSize += obj.Size || 0;
            }
        }

        for (const [project, count] of projects) {
            console.log(`  ${project}: ${count} files`);
        }

        console.log(`\nTotal: ${allObjects.length} objects (${formatBytes(totalSize)})\n`);

        console.log("Deleting all objects...\n");

        let totalDeleted = 0;
        const batchSize = 1000;

        for (let i = 0; i < allObjects.length; i += batchSize) {
            const batch = allObjects.slice(i, i + batchSize);
            const deleteCommand = new DeleteObjectsCommand({
                Bucket: R2_BUCKET_NAME,
                Delete: {
                    Objects: batch.map(obj => ({ Key: obj.Key }))
                }
            });

            await s3Client.send(deleteCommand);
            totalDeleted += batch.length;
            console.log(`  Deleted batch: ${totalDeleted}/${allObjects.length} objects`);
        }

        console.log(`Successfully deleted ${totalDeleted} objects from bucket "${R2_BUCKET_NAME}"`);

    } catch (error) {
        console.error("Error cleaning R2 bucket:", error);
        process.exit(1);
    }
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

cleanR2Bucket();
