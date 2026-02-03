/**
 * Standalone script to create course forum threads
 *
 * Usage:
 *   FORUM_CHANNEL_ID=123456789 node run-course-threads.js
 *
 * Or set FORUM_CHANNEL_ID in your .env file
 */

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { CourseThreadCreator } from "./services/CourseThreadCreator.js";

const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID;

if (!FORUM_CHANNEL_ID) {
    console.error("❌ Set FORUM_CHANNEL_ID environment variable");
    process.exit(1);
}

if (!process.env.DISCORD_TOKEN) {
    console.error("❌ Set DISCORD_TOKEN environment variable");
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`📂 Forum Channel: ${FORUM_CHANNEL_ID}\n`);

    const creator = new CourseThreadCreator(client);

    try {
        const results = await creator.createAllCourseThreads(
            FORUM_CHANNEL_ID,
            (msg) => console.log(`🚀 ${msg}`)
        );

        console.log("\n========== Results ==========");
        console.log(`Total courses: ${results.total}`);
        console.log(`Created: ${results.created}`);
        console.log(`Skipped: ${results.skipped}`);
        console.log(`Failed: ${results.failed}`);

        if (results.errors.length > 0) {
            console.log("\nErrors:");
            for (const err of results.errors) {
                console.log(`  - ${err.code}: ${err.error}`);
            }
        }

        console.log("\n✅ Done!");

    } catch (error) {
        console.error("❌ Error:", error.message);
    }

    client.destroy();
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
