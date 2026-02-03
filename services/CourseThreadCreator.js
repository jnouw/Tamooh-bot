/**
 * Course Thread Creator Service
 * Creates Forum Threads for courses with rating templates and discussion prompts.
 *
 * Migrated from discord-course-automator to use discord.js
 */

import fs from "fs";
import { parse } from "csv-parse/sync";
import { logger } from "../utils/logger.js";

// Discord Embed Colors
const COLORS = {
    GOLD: 0xF1C40F,      // Rating
    BLUE: 0x3498DB,      // Content difficulty
    ORANGE: 0xE67E22,    // Workload pressure
    PURPLE: 0x9B59B6,    // Assignments
    GREEN: 0x2ECC71,     // Recommendation
    GRAY: 0x95A5A6,      // Comments
};

// Generate thread structure with course-specific data
function getThreadStructure(code, name, college) {
    return [
        {
            // Message 1: Course Welcome Card
            embed: {
                title: `📚 ${code} - ${name}`,
                description: "شارك تجربتك لمساعدة الطلاب القادمين!",
                color: COLORS.BLUE,
                fields: [
                    { name: "🏛️ الكلية", value: college || "غير محدد", inline: true },
                ],
            },
            reactions: []
        },
        {
            // Message 2: Consolidated Quick Ratings
            embed: {
                title: "📊 قيّم المادة",
                color: COLORS.GOLD,
                fields: [
                    { name: "⭐ التقييم العام", value: "1️⃣ سيء  →  5️⃣ ممتاز", inline: false },
                    { name: "📚 الصعوبة", value: "🟢 سهل | 🟡 متوسط | 🔴 صعب", inline: true },
                    { name: "📝 حجم العمل", value: "🅰️ خفيف | 🅱️ متوسط | 🅾️ ثقيل", inline: true },
                    { name: "👍 تنصح فيها؟", value: "✅ نعم | ❌ لا", inline: false },
                ],
            },
            reactions: ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "🟢", "🟡", "🔴", "🅰️", "🅱️", "🅾️", "✅", "❌"]
        },
        {
            // Message 3: Discussion Prompts
            embed: {
                title: "💬 شاركنا تجربتك",
                description: "ساعد الطلاب القادمين بمشاركة:",
                color: COLORS.GREEN,
                fields: [
                    { name: "👨‍🏫 الدكتور", value: "مين يدرّس؟ أسلوبه؟ تصحيحه؟", inline: true },
                    { name: "📝 الاختبارات", value: "نوعها؟ توزيع الدرجات؟", inline: true },
                    { name: "📖 نصائح للنجاح", value: "طريقة المذاكرة؟ مصادر مفيدة؟", inline: true },
                    { name: "⚠️ تحذيرات", value: "أخطاء شائعة؟ أشياء تتجنبها؟", inline: true },
                ],
                footer: { text: "تجربتك تفرق مع غيرك!" },
            },
            reactions: []
        }
    ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CourseThreadCreator {
    constructor(client) {
        this.client = client;
        this.csvPath = "./data/courses.csv";
        this.completedFile = "./data/completed_courses.txt";
    }

    /**
     * Load completed courses from file
     */
    loadCompletedCourses() {
        const completed = new Set();
        if (fs.existsSync(this.completedFile)) {
            const content = fs.readFileSync(this.completedFile, "utf8");
            content.split("\n").forEach(line => {
                const trimmed = line.trim();
                if (trimmed) completed.add(trimmed);
            });
        }
        return completed;
    }

    /**
     * Mark a course as completed
     */
    markCompleted(code) {
        fs.appendFileSync(this.completedFile, code + "\n");
    }

    /**
     * Load courses from CSV
     */
    loadCourses() {
        if (!fs.existsSync(this.csvPath)) {
            throw new Error(`CSV file not found: ${this.csvPath}`);
        }
        const csvText = fs.readFileSync(this.csvPath, "utf8").replace(/^\uFEFF/, "");
        return parse(csvText, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
        });
    }

    /**
     * Get existing thread names from forum channel
     */
    async getExistingThreadCodes(forumChannel) {
        const codes = new Set();

        // Get active threads
        const activeThreads = await forumChannel.threads.fetchActive();
        for (const [, thread] of activeThreads.threads) {
            const parts = thread.name.split(" - ");
            if (parts.length >= 2) {
                codes.add(parts[0].trim());
            }
        }

        // Get archived threads
        const archivedThreads = await forumChannel.threads.fetchArchived({ limit: 100 });
        for (const [, thread] of archivedThreads.threads) {
            const parts = thread.name.split(" - ");
            if (parts.length >= 2) {
                codes.add(parts[0].trim());
            }
        }

        return codes;
    }

    /**
     * Create a single course thread
     */
    async createCourseThread(forumChannel, code, name, college, tagIds = []) {
        const threadTitle = `${code} - ${name}`;
        const threadStructure = getThreadStructure(code, name, college);

        // Create thread with first message
        const starterEmbed = threadStructure[0].embed;
        const thread = await forumChannel.threads.create({
            name: threadTitle.slice(0, 100),
            message: { embeds: [starterEmbed] },
            autoArchiveDuration: 10080, // 7 days
            appliedTags: tagIds,
        });

        // Get starter message for reactions
        const starterMessage = await thread.fetchStarterMessage();

        // Add reactions to starter if any
        for (const emoji of threadStructure[0].reactions) {
            await starterMessage.react(emoji);
            await sleep(400);
        }

        // Post subsequent messages
        for (let i = 1; i < threadStructure.length; i++) {
            const msgDef = threadStructure[i];
            const message = await thread.send({ embeds: [msgDef.embed] });
            await sleep(500);

            // Add reactions
            for (const emoji of msgDef.reactions) {
                await message.react(emoji);
                await sleep(400);
            }
        }

        return thread;
    }

    /**
     * Create all course threads from CSV
     * @param {string} forumChannelId - The forum channel ID
     * @param {Function} progressCallback - Optional callback for progress updates
     */
    async createAllCourseThreads(forumChannelId, progressCallback = null) {
        const forumChannel = await this.client.channels.fetch(forumChannelId);

        if (!forumChannel || forumChannel.type !== 15) { // 15 = GuildForum
            throw new Error("Invalid forum channel");
        }

        // Load data
        const courses = this.loadCourses();
        const completed = this.loadCompletedCourses();

        // Get existing threads from Discord
        const existingCodes = await this.getExistingThreadCodes(forumChannel);
        for (const code of existingCodes) {
            completed.add(code);
        }

        // Build tag map
        const tagMap = new Map();
        for (const tag of forumChannel.availableTags) {
            tagMap.set(tag.name.trim().toLowerCase(), tag.id);
        }

        const results = {
            total: courses.length,
            created: 0,
            skipped: 0,
            failed: 0,
            errors: []
        };

        const seen = new Set();

        for (const row of courses) {
            const code = String(row["Course Code"] || "").trim();
            const name = String(row["Course Name"] || "").trim();
            const college = String(row["College"] || "").trim();

            if (!code || !name) continue;
            if (seen.has(code)) continue;
            seen.add(code);

            if (completed.has(code)) {
                results.skipped++;
                continue;
            }

            // Find tag ID for college
            const tagIds = [];
            if (college) {
                const tagId = tagMap.get(college.toLowerCase());
                if (tagId) tagIds.push(tagId);
            }

            try {
                if (progressCallback) {
                    progressCallback(`Creating: ${code} - ${name}`);
                }

                await this.createCourseThread(forumChannel, code, name, college, tagIds);
                this.markCompleted(code);
                results.created++;

                logger.info('Course thread created', { code, name });

                // Rate limit protection
                await sleep(2000);

            } catch (error) {
                results.failed++;
                results.errors.push({ code, error: error.message });
                logger.error('Failed to create course thread', { code, error: error.message });
                await sleep(5000);
            }
        }

        return results;
    }

    /**
     * Create a single course thread by code (for manual creation)
     */
    async createSingleThread(forumChannelId, code, name, college) {
        const forumChannel = await this.client.channels.fetch(forumChannelId);

        if (!forumChannel || forumChannel.type !== 15) {
            throw new Error("Invalid forum channel");
        }

        // Build tag map
        const tagMap = new Map();
        for (const tag of forumChannel.availableTags) {
            tagMap.set(tag.name.trim().toLowerCase(), tag.id);
        }

        const tagIds = [];
        if (college) {
            const tagId = tagMap.get(college.toLowerCase());
            if (tagId) tagIds.push(tagId);
        }

        const thread = await this.createCourseThread(forumChannel, code, name, college, tagIds);
        this.markCompleted(code);

        return thread;
    }
}
