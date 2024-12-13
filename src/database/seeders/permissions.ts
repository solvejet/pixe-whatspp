// src/database/seeders/permissions.ts
import { PermissionModel } from '@/models/permission.model.js';
import { RoleModel } from '@/models/role.model.js';
import { logger } from '@/utils/logger.js';

// Define a basic permission type without mongoose Document properties
interface IPermissionCreate {
  name: string;
  description: string;
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'manage';
}

export const createRolesAndPermissions = async (): Promise<void> => {
  try {
    const permissions: IPermissionCreate[] = [
      {
        name: 'manage_users',
        description: 'Can manage all user operations',
        resource: 'users',
        action: 'manage',
      },
      {
        name: 'manage_roles',
        description: 'Can manage all role operations',
        resource: 'roles',
        action: 'manage',
      },
      {
        name: 'manage_permissions',
        description: 'Can manage all permission operations',
        resource: 'permissions',
        action: 'manage',
      },
      // Add more system permissions
      {
        name: 'read_users',
        description: 'Can view user information',
        resource: 'users',
        action: 'read',
      },
      {
        name: 'create_users',
        description: 'Can create new users',
        resource: 'users',
        action: 'create',
      },
      {
        name: 'update_users',
        description: 'Can update user information',
        resource: 'users',
        action: 'update',
      },
      {
        name: 'delete_users',
        description: 'Can delete users',
        resource: 'users',
        action: 'delete',
      },
    ];

    // Create permissions
    logger.info('Creating permissions...');
    await PermissionModel.insertMany(permissions);
    logger.info('Permissions created successfully');

    // Create admin role with all permissions
    logger.info('Creating admin role...');
    await RoleModel.create({
      name: 'admin',
      description: 'Super Administrator with full system access',
      permissions: permissions.map((p) => p.name),
    });
    logger.info('Admin role created successfully');
  } catch (error) {
    logger.error('Error in createRolesAndPermissions:', error);
    throw error;
  }
};
