import dotenv from "dotenv";

// Load worker-local secrets for this one-off test run.
dotenv.config({ path: ".env.local" });

import { ResendAdapter } from "./src/adapters/ResendAdapter.ts";

async function runTest() {
  console.log("Forcing Resend Batch Execution...");
  const emailClient = new ResendAdapter();
  
  // Mocking the database payload
  const mockPayload = [
    { 
      to: "rametiongson@gmail.com", // Put your actual email here
      reviewCount: 15, 
      userName: "Rame" 
    }
  ];

  try {
    await emailClient.sendBatchReminders(mockPayload);
    console.log("Test execution finished. Check Resend Dashboard.");
  } catch (error) {
    console.error("Test Failed:", error);
  }
}

runTest();