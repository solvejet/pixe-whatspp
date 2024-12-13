// src/database/migrations/migrationHandler.ts
import { connectDB } from '@/config/database.js';
import { MigrationModel } from './Migration.js';
import { logger } from '@/utils/logger.js';

// Import the seeder functions
import { createRolesAndPermissions } from '../seeders/permissions.js';
import { createSuperAdmin } from '../seeders/superAdmin.js';

// Define migration type for type safety
interface Migration {
  name: string;
  up: () => Promise<void>;
}

export class MigrationHandler {
  private static instance: MigrationHandler;

  private constructor() {}

  public static getInstance(): MigrationHandler {
    if (!MigrationHandler.instance) {
      MigrationHandler.instance = new MigrationHandler();
    }
    return MigrationHandler.instance;
  }

  async migrate(): Promise<void> {
    try {
      await connectDB();
      logger.info('Starting migrations...');

      // Get all executed migrations
      const executedMigrations = await MigrationModel.find().sort({ createdAt: 1 });
      const executedMigrationNames = new Set(executedMigrations.map((m) => m.name));

      // Define migrations with imported functions
      const migrations: Migration[] = [
        {
          name: 'create_roles_and_permissions',
          up: createRolesAndPermissions,
        },
        {
          name: 'create_super_admin',
          up: createSuperAdmin,
        },
      ];

      // Execute pending migrations
      for (const migration of migrations) {
        if (!executedMigrationNames.has(migration.name)) {
          logger.info(`Executing migration: ${migration.name}`);
          await migration.up();
          await MigrationModel.create({ name: migration.name });
          logger.info(`Migration completed: ${migration.name}`);
        }
      }

      logger.info('All migrations completed successfully');
    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  }
}
