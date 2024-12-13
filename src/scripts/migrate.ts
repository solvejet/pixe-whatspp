// src/scripts/migrate.ts
import { MigrationHandler } from '../database/migrations/migrationHandler.js';
import { logger } from '@/utils/logger.js';

const runMigrations = async (): Promise<void> => {
  try {
    logger.info('Starting migration process...');
    const migrationHandler = MigrationHandler.getInstance();
    await migrationHandler.migrate();
    logger.info('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
};

// Execute migrations
void runMigrations();
