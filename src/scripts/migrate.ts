// src/scripts/migrate.ts
import { MigrationHandler } from '../database/migrations/migrationHandler.js';
import { logger } from '@/utils/logger.js';
import mongoose from 'mongoose';
import { connectDB } from '@/config/database.js';

const clearCollectionsAndIndexes = async (): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }

    if (!mongoose.connection.db) {
      throw new Error('Database connection not established');
    }

    const collections = await mongoose.connection.db.collections();

    for (const collection of collections) {
      try {
        // Drop all indexes except _id
        await collection.dropIndexes();
        logger.info(`Dropped indexes for collection: ${collection.collectionName}`);

        // Then drop the collection
        await collection.drop();
        logger.info(`Dropped collection: ${collection.collectionName}`);
      } catch (error) {
        // Skip error if collection doesn't exist or if it's a background operation
        if (
          error instanceof Error &&
          !error.message.includes('ns not found') &&
          !error.message.includes('background operation is currently running')
        ) {
          logger.error(`Error dropping collection ${collection.collectionName}:`, error);
        }
      }
    }
    logger.info('All collections and indexes cleared');
  } catch (error) {
    logger.error('Error clearing collections and indexes:', error);
    throw error;
  }
};

const runMigrations = async (): Promise<void> => {
  try {
    logger.info('Starting migration process...');
    const migrationHandler = MigrationHandler.getInstance();

    if (process.argv.includes('--fresh')) {
      logger.info('Clearing all collections and indexes...');
      await clearCollectionsAndIndexes();
    }

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
