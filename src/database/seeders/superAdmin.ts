// src/database/seeders/superAdmin.ts
import { UserModel } from '@/models/user.model.js';
import bcrypt from 'bcryptjs';
import { logger } from '@/utils/logger.js';

export const createSuperAdmin = async (): Promise<void> => {
  try {
    const email = 'karansxa@gmail.com';
    logger.info(`Checking if super admin exists: ${email}`);

    const existingAdmin = await UserModel.findOne({ email });

    if (!existingAdmin) {
      const password = 'Admin@123';
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      logger.info('Creating super admin account...');
      await UserModel.create({
        email,
        password: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        isActive: true,
        roles: ['admin'],
        permissions: [], // Permissions will come from the admin role
      });
      logger.info('Super admin created successfully');
    } else {
      logger.info('Super admin already exists');
    }
  } catch (error) {
    logger.error('Error in createSuperAdmin:', error);
    throw error;
  }
};
