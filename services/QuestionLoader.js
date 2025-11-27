import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Loads and manages quiz questions
 */
export class QuestionLoader {
  constructor() {
    this.questions = {
      mcq: this.loadJSON('../questions/mcq.json'),
      finderror: this.loadJSON('../questions/finderror.json'),
      output: this.loadJSON('../questions/output.json'),
      code: this.loadJSON('../questions/code.json')
    };
  }

  /**
   * Load JSON file
   */
  loadJSON(relativePath) {
    try {
      const fullPath = join(__dirname, relativePath);
      const data = fs.readFileSync(fullPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Failed to load ${relativePath}:`, error.message);
      return [];
    }
  }

  /**
   * Get questions based on mode and filters
   */
  getQuestions(mode, count, chapter = null) {
    let pool = this.questions[mode];

    if (!pool) {
      throw new Error(`Invalid quiz mode: ${mode}`);
    }

    // Filter by chapter for code mode
    if (mode === 'code' && chapter) {
      pool = pool.filter(
        q => q.chapter && q.chapter.toLowerCase() === chapter.toLowerCase()
      );

      if (pool.length === 0) {
        throw new Error(`No coding problems found for chapter: ${chapter}`);
      }
    }

    if (pool.length === 0) {
      throw new Error(`No questions available for mode: ${mode}`);
    }

    // Shuffle and pick
    return this.shuffle(pool).slice(0, Math.min(count, pool.length));
  }

  /**
   * Shuffle array using Fisher-Yates algorithm
   */
  shuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Get available chapters for code mode
   */
  getAvailableChapters() {
    const chapters = new Set();
    this.questions.code.forEach(q => {
      if (q.chapter) {
        chapters.add(q.chapter.toLowerCase());
      }
    });
    return Array.from(chapters);
  }

  /**
   * Reload questions from disk
   */
  reload() {
    this.questions = {
      mcq: this.loadJSON('../questions/mcq.json'),
      finderror: this.loadJSON('../questions/finderror.json'),
      output: this.loadJSON('../questions/output.json'),
      code: this.loadJSON('../questions/code.json')
    };
    console.log('✅ Questions reloaded');
  }
}