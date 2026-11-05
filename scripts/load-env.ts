/** Loads .env for command-line scripts. A missing file is fine (CI provides variables directly). */
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export {};
