import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests share one real Postgres test DB and reset it via
    // full-table truncation in beforeEach; running test files in parallel
    // races that truncation across files (spurious FK violations). Force
    // serial file execution so the full suite is deterministic.
    fileParallelism: false,
  },
});
