// src/database/seeders/superAdmin.ts
import { UserModel } from '@/models/user.model.js';
import { logger } from '@/utils/logger.js';

export const createSuperAdmin = async (): Promise<void> => {
  try {
    const email = 'karansxa@gmail.com';
    logger.info(`Checking if super admin exists: ${email}`);

    let admin = await UserModel.findOne({ email });

    if (!admin) {
      logger.info('Creating super admin account...');
      admin = await UserModel.create({
        email,
        password: 'Admin@123',
        firstName: 'Super',
        lastName: 'Admin',
        isActive: true,
        roles: ['admin'],
        permissions: [],
      });
    }

    // Sync permissions
    await admin.syncPermissions();
    await admin.save();

    logger.info('Super admin permissions synchronized');
  } catch (error) {
    logger.error('Error in createSuperAdmin:', error);
    throw error;
  }
};
