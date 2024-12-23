// src/database/seeders/permissions.ts
import { PermissionModel } from '@/models/permission.model.js';
import { RoleModel } from '@/models/role.model.js';
import { logger } from '@/utils/logger.js';

// Define permission types for better type safety
type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'manage' | 'list' | 'statistics';
type PermissionResource =
  | 'users'
  | 'roles'
  | 'permissions'
  | 'customers'
  | 'customer-groups'
  | 'audit-logs'
  | 'system'
  | 'settings';

interface IPermissionCreate {
  name: string;
  description: string;
  resource: PermissionResource;
  action: PermissionAction;
}

export const createRolesAndPermissions = async (): Promise<void> => {
  try {
    // Define all system permissions
    const permissions: IPermissionCreate[] = [
      // User Management Permissions
      {
        name: 'users:create',
        description: 'Create new users',
        resource: 'users',
        action: 'create',
      },
      {
        name: 'users:read',
        description: 'View user information',
        resource: 'users',
        action: 'read',
      },
      {
        name: 'users:update',
        description: 'Update user information',
        resource: 'users',
        action: 'update',
      },
      {
        name: 'users:delete',
        description: 'Delete users',
        resource: 'users',
        action: 'delete',
      },
      {
        name: 'users:manage',
        description: 'Full access to user management',
        resource: 'users',
        action: 'manage',
      },

      // Role Management Permissions
      {
        name: 'roles:create',
        description: 'Create new roles',
        resource: 'roles',
        action: 'create',
      },
      {
        name: 'roles:read',
        description: 'View role information',
        resource: 'roles',
        action: 'read',
      },
      {
        name: 'roles:update',
        description: 'Update role information',
        resource: 'roles',
        action: 'update',
      },
      {
        name: 'roles:delete',
        description: 'Delete roles',
        resource: 'roles',
        action: 'delete',
      },
      {
        name: 'roles:manage',
        description: 'Full access to role management',
        resource: 'roles',
        action: 'manage',
      },

      // Permission Management Permissions
      {
        name: 'permissions:read',
        description: 'View permissions',
        resource: 'permissions',
        action: 'read',
      },
      {
        name: 'permissions:manage',
        description: 'Manage all permissions',
        resource: 'permissions',
        action: 'manage',
      },

      // Customer Management Permissions
      {
        name: 'customers:create',
        description: 'Create new customers',
        resource: 'customers',
        action: 'create',
      },
      {
        name: 'customers:read',
        description: 'View customer information',
        resource: 'customers',
        action: 'read',
      },
      {
        name: 'customers:update',
        description: 'Update customer information',
        resource: 'customers',
        action: 'update',
      },
      {
        name: 'customers:delete',
        description: 'Delete customers',
        resource: 'customers',
        action: 'delete',
      },
      {
        name: 'customers:list',
        description: 'List all customers',
        resource: 'customers',
        action: 'list',
      },
      {
        name: 'customers:statistics',
        description: 'View customer statistics',
        resource: 'customers',
        action: 'statistics',
      },
      {
        name: 'customers:batch-update',
        description: 'Perform batch updates on customers',
        resource: 'customers',
        action: 'manage',
      },
      {
        name: 'customers:manage',
        description: 'Full access to customer management',
        resource: 'customers',
        action: 'manage',
      },

      // Customer Group Permissions
      {
        name: 'customer-groups:create',
        description: 'Create customer groups',
        resource: 'customer-groups',
        action: 'create',
      },
      {
        name: 'customer-groups:read',
        description: 'View customer group information',
        resource: 'customer-groups',
        action: 'read',
      },
      {
        name: 'customer-groups:update',
        description: 'Update customer group information',
        resource: 'customer-groups',
        action: 'update',
      },
      {
        name: 'customer-groups:delete',
        description: 'Delete customer groups',
        resource: 'customer-groups',
        action: 'delete',
      },
      {
        name: 'customer-groups:list',
        description: 'List all customer groups',
        resource: 'customer-groups',
        action: 'list',
      },
      {
        name: 'customer-groups:manage-members',
        description: 'Add or remove customers from groups',
        resource: 'customer-groups',
        action: 'manage',
      },
      {
        name: 'customer-groups:manage',
        description: 'Full access to customer group management',
        resource: 'customer-groups',
        action: 'manage',
      },

      // Audit Log Permissions
      {
        name: 'audit-logs:read',
        description: 'View audit logs',
        resource: 'audit-logs',
        action: 'read',
      },
      {
        name: 'audit-logs:list',
        description: 'List audit logs',
        resource: 'audit-logs',
        action: 'list',
      },
      {
        name: 'audit-logs:manage',
        description: 'Manage audit logs',
        resource: 'audit-logs',
        action: 'manage',
      },

      // System Management Permissions
      {
        name: 'system:read',
        description: 'View system information',
        resource: 'system',
        action: 'read',
      },
      {
        name: 'system:manage',
        description: 'Manage system settings',
        resource: 'system',
        action: 'manage',
      },

      // Settings Management Permissions
      {
        name: 'settings:read',
        description: 'View application settings',
        resource: 'settings',
        action: 'read',
      },
      {
        name: 'settings:update',
        description: 'Update application settings',
        resource: 'settings',
        action: 'update',
      },
      {
        name: 'settings:manage',
        description: 'Full access to settings management',
        resource: 'settings',
        action: 'manage',
      },
    ];

    // Create permissions with upsert
    logger.info('Creating permissions...');
    const permissionOperations = permissions.map((permission) => ({
      updateOne: {
        filter: { name: permission.name },
        update: { $set: permission },
        upsert: true,
      },
    }));

    await PermissionModel.bulkWrite(permissionOperations);
    logger.info(`Upserted ${permissions.length} permissions successfully`);

    // Get all permission names
    const allPermissions = await PermissionModel.find().select('name').lean();
    const permissionNames = allPermissions.map((p) => p.name);

    // Define roles with their permissions
    const roles = [
      {
        name: 'admin',
        description: 'Super Administrator with full system access',
        permissions: permissionNames, // Admin gets all permissions
      },
      {
        name: 'staff',
        description: 'Staff member with customer management access',
        permissions: [
          // Customer Management
          'customers:create',
          'customers:read',
          'customers:update',
          'customers:list',
          'customers:statistics',

          // Customer Groups
          'customer-groups:read',
          'customer-groups:list',
          'customer-groups:manage-members',

          // Basic System Access
          'users:read',
          'audit-logs:read',
          'audit-logs:list',
          'system:read',
          'settings:read',
        ],
      },
      {
        name: 'user',
        description: 'Regular user with basic access',
        permissions: [
          'customers:read',
          'customers:list',
          'customer-groups:read',
          'customer-groups:list',
          'settings:read',
        ],
      },
    ];

    // Create roles with upsert
    logger.info('Creating roles...');
    const roleOperations = roles.map((role) => ({
      updateOne: {
        filter: { name: role.name },
        update: { $set: role },
        upsert: true,
      },
    }));

    await RoleModel.bulkWrite(roleOperations);
    logger.info(`Upserted ${roles.length} roles successfully`);
  } catch (error) {
    logger.error('Error in createRolesAndPermissions:', error);
    throw error;
  }
};
