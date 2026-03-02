/**
 * Integration Test Script
 * Publishes mock webhook payloads directly to the local Redis queue
 * to test the refactored declarative flow without needing real Instagram hits.
 */

import { Queue } from "bullmq";
import { InstagramWebhookPayload } from "./lib/instagram/webhook/webhook-handler";
import * as dotenv from "dotenv";

dotenv.config();

const REDIS_CONNECTION = {
  host: process.env.UPSTASH_REDIS_HOST,
  port: 6379,
  username: process.env.UPSTASH_REDIS_USERNAME,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {},
};

const webhookQueue = new Queue("webhook-processing", {
  connection: REDIS_CONNECTION,
});

async function publishMockEvent() {
  const mockCommentPayload: InstagramWebhookPayload = {
    object: "instagram",
    entry: [
      {
        id: "mock_account_123", // The instagramUserId you want to test against
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: "comments",
            value: {
              id: `mock_comment_${Date.now()}`,
              text: "test trigger comment",
              from: {
                id: "mock_sender_456",
                username: "mock_user",
              },
              media: {
                id: "mock_post_789",
              },
              timestamp: Math.floor(Date.now() / 1000),
            },
          },
        ],
      },
    ],
  };

  try {
    console.log("Publishing mock comment event to queue...");
    await webhookQueue.add("webhook-event", mockCommentPayload, {
      removeOnComplete: true,
      removeOnFail: false, // Keep it for inspection
    });
    console.log("Mock event published successfully.");
  } catch (error) {
    console.error("Failed to publish mock event:", error);
  } finally {
    process.exit(0);
  }
}

publishMockEvent();
