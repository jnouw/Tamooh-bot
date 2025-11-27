import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Check if Java is available
 */
export async function checkJavaAvailable() {
  try {
    return await new Promise((resolve) => {
      const proc = spawn('java', ['-version'], { stdio: 'ignore' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 3000);
    });
  } catch {
    return false;
  }
}

/**
 * Grade Java code that uses main() method (beginner-friendly)
 * Students write code that reads from Scanner and prints output
 */
export async function gradeJava({ code, tests, timeoutMs = 3000 }) {
  // Validate inputs
  if (!code || typeof code !== 'string') {
    return { ok: false, error: 'Invalid code provided' };
  }

  if (code.length > CONFIG.MAX_CODE_LENGTH) {
    return { ok: false, error: 'Code exceeds maximum length' };
  }

  // Check for null bytes and control characters
  if (code.includes('\0') || /[\x00-\x08\x0B-\x0C\x0E-\x1F]/.test(code)) {
    return { ok: false, error: 'Code contains invalid characters' };
  }

  // Enhanced security checks
  const dangerousPatterns = [
    { pattern: /Runtime\.getRuntime\(\)/i, msg: 'Runtime access' },
    { pattern: /ProcessBuilder/i, msg: 'Process creation' },
    { pattern: /System\.exit/i, msg: 'System exit' },
    { pattern: /java\.io\.File/i, msg: 'File access' },
    { pattern: /java\.nio\.file/i, msg: 'File system access' },
    { pattern: /java\.net/i, msg: 'Network access' },
    { pattern: /Socket/i, msg: 'Socket operations' },
    { pattern: /ServerSocket/i, msg: 'Server socket' },
    { pattern: /Thread(?!Local)/i, msg: 'Thread operations' },
    { pattern: /ClassLoader/i, msg: 'Class loading' },
    { pattern: /SecurityManager/i, msg: 'Security manipulation' },
    { pattern: /System\.setProperty/i, msg: 'System property modification' },
    { pattern: /System\.setSecurityManager/i, msg: 'Security manager modification' },
    { pattern: /\breflect\b/i, msg: 'Reflection' },
    { pattern: /\.getClass\(\)\.getClassLoader/i, msg: 'ClassLoader access' },
    { pattern: /native\s+\w/i, msg: 'Native methods' },
    { pattern: /@\s*(Native|CallerSensitive)/i, msg: 'Sensitive annotations' },
    { pattern: /sun\./i, msg: 'Internal Sun packages' },
    { pattern: /com\.sun\./i, msg: 'Internal Sun packages' },
    { pattern: /jdk\.internal/i, msg: 'Internal JDK packages' },
    { pattern: /Unsafe/i, msg: 'Unsafe operations' },
    { pattern: /MethodHandle/i, msg: 'Method handles' },
    { pattern: /VarHandle/i, msg: 'Variable handles' },
    { pattern: /java\.lang\.instrument/i, msg: 'Instrumentation' },
    { pattern: /javax\.script/i, msg: 'Script execution' }
  ];

  for (const { pattern, msg } of dangerousPatterns) {
    if (pattern.test(code)) {
      logger.warn('Blocked dangerous code pattern', { pattern: msg });
      return { ok: false, error: `Code contains disallowed operations: ${msg}` };
    }
  }

  // Check for excessive loops (basic heuristic)
  const loopMatches = code.match(/\b(while|for)\s*\(/g);
  if (loopMatches && loopMatches.length > CONFIG.MAX_LOOPS) {
    return { ok: false, error: 'Too many loops in code' };
  }

  let workDir;
  try {
    workDir = mkdtempSync(join(tmpdir(), 'quiz-java-'));
    const javaFilePath = join(workDir, 'Main.java');

    // Write user code
    writeFileSync(javaFilePath, code, 'utf8');

    // Compile
    const compileResult = await compileJava(workDir, 'Main.java');
    if (!compileResult.ok) {
      return { ok: false, error: 'Compilation error: ' + compileResult.error };
    }

    // Run tests
    const results = [];
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      const result = await runJavaWithInput(workDir, test.input, test.output, timeoutMs);
      results.push({
        i,
        pass: result.pass,
        ms: result.ms,
        err: result.err
      });
    }

    const passed = results.filter(r => r.pass).length;
    return {
      ok: true,
      passed,
      total: tests.length,
      results
    };

  } catch (error) {
    logger.error('Grading error', { error: error.message, stack: error.stack });
    return { ok: false, error: 'Internal grading error' };
  } finally {
    if (workDir) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temp directory', { error: cleanupError.message });
      }
    }
  }
}

/**
 * Compile Java file
 */
function compileJava(workDir, fileName) {
  return new Promise((resolve) => {
    const javac = spawn('javac', ['-encoding', 'UTF-8', fileName], {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000 // 10 second compile timeout
    });

    let stderr = '';
    javac.stderr.on('data', data => { 
      stderr += data.toString();
      // Prevent stderr from getting too large
      if (stderr.length > 5000) {
        javac.kill('SIGKILL');
      }
    });

    javac.on('close', (code) => {
      if (code !== 0) {
        // Clean up error message
        const cleanError = stderr
          .split('\n')
          .filter(line => !line.includes('warning'))
          .slice(0, 5)
          .join('\n')
          .substring(0, 500); // Limit error length
        resolve({ ok: false, error: cleanError || 'Compilation failed' });
      } else {
        resolve({ ok: true });
      }
    });

    javac.on('error', (err) => {
      if (err.code === 'ENOENT') {
        resolve({ ok: false, error: 'Java compiler not found. Please ensure Java is installed.' });
      } else {
        resolve({ ok: false, error: 'Compilation process failed' });
      }
    });
  });
}

/**
 * Run Java program with input and check output
 */
function runJavaWithInput(workDir, input, expectedOutput, timeoutMs) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const java = spawn('java', [
      '-Xmx128m',           // Max heap size
      '-Xss512k',           // Stack size limit
      '-XX:+UseSerialGC',   // Simple GC for faster startup
      '-Djava.security.manager=allow', // Modern Java security
      'Main'
    ], {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const killTimer = setTimeout(() => {
      killed = true;
      java.kill('SIGKILL');
    }, timeoutMs);

    // Send input to program
    try {
      if (input) {
        java.stdin.write(input + '\n', 'utf8');
      }
      java.stdin.end();
    } catch (error) {
      clearTimeout(killTimer);
      resolve({ pass: false, ms: Date.now() - startTime, err: 'Failed to write input' });
      return;
    }

    java.stdout.on('data', data => {
      stdout += data.toString();
      // Prevent output from getting too large
      if (stdout.length > CONFIG.MAX_OUTPUT_LENGTH) {
        killed = true;
        java.kill('SIGKILL');
      }
    });

    java.stderr.on('data', data => {
      stderr += data.toString();
      // Prevent stderr from getting too large
      if (stderr.length > 2000) {
        killed = true;
        java.kill('SIGKILL');
      }
    });

    java.on('close', (code) => {
      clearTimeout(killTimer);
      const elapsed = Date.now() - startTime;

      if (killed) {
        const reason = stdout.length > CONFIG.MAX_OUTPUT_LENGTH 
          ? 'Output too large' 
          : 'Timeout';
        resolve({ pass: false, ms: elapsed, err: reason });
        return;
      }

      if (code !== 0) {
        const errorMsg = stderr
          .split('\n')
          .filter(line => line.trim() && !line.includes('at java.') && !line.includes('at jdk.'))
          .slice(0, 2)
          .join(' ')
          .substring(0, 200) || 'Runtime error';
        resolve({ pass: false, ms: elapsed, err: errorMsg });
        return;
      }

      // Compare output (trim whitespace)
      const actualOutput = stdout.trim();
      const expected = String(expectedOutput).trim();
      
      if (actualOutput === expected) {
        resolve({ pass: true, ms: elapsed });
      } else {
        // Truncate outputs for error message
        const actualTruncated = actualOutput.substring(0, 100);
        const expectedTruncated = expected.substring(0, 100);
        const suffix = actualOutput.length > 100 || expected.length > 100 ? '...' : '';
        
        resolve({ 
          pass: false, 
          ms: elapsed, 
          err: `Expected: "${expectedTruncated}${suffix}", Got: "${actualTruncated}${suffix}"` 
        });
      }
    });

    java.on('error', (err) => {
      clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        resolve({ pass: false, ms: 0, err: 'Java runtime not found' });
      } else {
        resolve({ pass: false, ms: 0, err: 'Failed to run Java' });
      }
    });
  });
}