import { Request, Response, NextFunction } from 'express';

/**
 * Backend RBAC Middleware
 * 
 * Checks user role and enforces permissions
 */

export enum UserRole {
  ADMIN = 'admin',
  TEACHER = 'teacher',
  PARENT = 'parent',
  STUDENT = 'student',
  VIEWER = 'viewer',
}

export interface RolePermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPublish: boolean;
  canEnterScores: boolean;
  canCalculateGrades: boolean;
  canCalculatePositions: boolean;
  canLockResults: boolean;
  canViewAudit: boolean;
  canExport: boolean;
  canViewAllResults: boolean;
  canViewOwnResults: boolean;
  canConfigureComponents: boolean;
}

const rolePermissions: Record<UserRole, RolePermissions> = {
  [UserRole.ADMIN]: {
    canCreate: true,
    canEdit: true,
    canDelete: false,
    canPublish: true,
    canEnterScores: true,
    canCalculateGrades: true,
    canCalculatePositions: true,
    canLockResults: true,
    canViewAudit: true,
    canExport: true,
    canViewAllResults: true,
    canViewOwnResults: true,
    canConfigureComponents: true,
  },
  [UserRole.TEACHER]: {
    canCreate: false,
    canEdit: true,
    canDelete: false,
    canPublish: false,
    canEnterScores: true,
    canCalculateGrades: false,
    canCalculatePositions: false,
    canLockResults: false,
    canViewAudit: false,
    canExport: true,
    canViewAllResults: true,
    canViewOwnResults: true,
    canConfigureComponents: false,
  },
  [UserRole.PARENT]: {
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canPublish: false,
    canEnterScores: false,
    canCalculateGrades: false,
    canCalculatePositions: false,
    canLockResults: false,
    canViewAudit: false,
    canExport: true,
    canViewAllResults: false,
    canViewOwnResults: true,
    canConfigureComponents: false,
  },
  [UserRole.STUDENT]: {
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canPublish: false,
    canEnterScores: false,
    canCalculateGrades: false,
    canCalculatePositions: false,
    canLockResults: false,
    canViewAudit: false,
    canExport: false,
    canViewAllResults: false,
    canViewOwnResults: true,
    canConfigureComponents: false,
  },
  [UserRole.VIEWER]: {
    canCreate: false,
    canEdit: false,
    canDelete: false,
    canPublish: false,
    canEnterScores: false,
    canCalculateGrades: false,
    canCalculatePositions: false,
    canLockResults: false,
    canViewAudit: false,
    canExport: false,
    canViewAllResults: true,
    canViewOwnResults: true,
    canConfigureComponents: false,
  },
};

/**
 * Middleware to check user role
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).user?.role || UserRole.VIEWER;

    if (!allowedRoles.includes(userRole as UserRole)) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        errorCode: 'PERMISSION_DENIED',
        message: `This action requires one of these roles: ${allowedRoles.join(', ')}`,
        details: { requiredRoles: allowedRoles, userRole },
      });
    }

    next();
  };
}

/**
 * Middleware to check specific permission
 */
export function requirePermission(permission: keyof RolePermissions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).user?.role || UserRole.VIEWER;
    const permissions = rolePermissions[userRole as UserRole] || rolePermissions[UserRole.VIEWER];

    if (!permissions[permission]) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        errorCode: 'PERMISSION_DENIED',
        message: `You don't have permission to: ${permission}`,
        details: { permission, userRole },
      });
    }

    next();
  };
}

/**
 * Get permissions for a role
 */
export function getPermissions(role: UserRole): RolePermissions {
  return rolePermissions[role] || rolePermissions[UserRole.VIEWER];
}

/**
 * Check if role has permission
 */
export function hasPermission(
  role: UserRole,
  permission: keyof RolePermissions
): boolean {
  const perms = getPermissions(role);
  return perms[permission] === true;
}

/**
 * Augment Express Request with role checking methods
 */
declare global {
  namespace Express {
    interface Request {
      userRole?: UserRole;
      checkPermission?: (permission: keyof RolePermissions) => boolean;
      requirePermission?: (permission: keyof RolePermissions) => void;
    }
  }
}

/**
 * Middleware to add permission checking utilities to request
 */
export function addRBACToRequest(req: Request, res: Response, next: NextFunction) {
  const userRole = (req as any).user?.role || UserRole.VIEWER;
  
  req.userRole = userRole;
  
  req.checkPermission = (permission: keyof RolePermissions) => {
    return hasPermission(userRole as UserRole, permission);
  };
  
  req.requirePermission = (permission: keyof RolePermissions) => {
    if (!hasPermission(userRole as UserRole, permission)) {
      throw new Error(`Permission denied: ${permission}`);
    }
  };

  next();
}
