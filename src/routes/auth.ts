import { Router, Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const router = Router();
const prisma = new PrismaClient();

// ============================================
// HELPER: Get JWT secret
// ============================================
function secret() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET || 'your-secret-key'
  );
}

// ============================================
// POST /api/auth/platform-login
// Platform admin login ONLY
// ============================================
router.post('/platform-login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required.' 
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email).trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        passwordHash: true,
        schoolId: true,
      },
    });

    // User not found
    if (!user || !user.passwordHash) {
      return res.status(401).json({ 
        error: 'Invalid email or password.' 
      });
    }

    // Password invalid
    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      return res.status(401).json({ 
        error: 'Invalid email or password.' 
      });
    }

    // CRITICAL: PLATFORM_ADMIN only
    if (user.role !== 'PLATFORM_ADMIN') {
      console.warn(`[AUTH] Non-platform admin tried to login to platform: ${email} (${user.role})`);
      return res.status(403).json({ 
        error: 'Only platform admins can access this portal.' 
      });
    }

    // Create JWT token (no schoolId for platform admin)
    const token = await new SignJWT({
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      schoolId: null, // Platform admin has no school
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret());

    // Set httpOnly session cookie
    res.cookie('schoolbase_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.schoolbase.live' : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      token,
      role: user.role,
      userId: user.id,
      name: user.name,
      email: user.email,
      schoolId: null,
    });
  } catch (error) {
    console.error('[AUTH] Platform login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================
// POST /api/auth/school-login
// School admin, staff, parent login
// ============================================
router.post('/school-login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required.' 
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email).trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        passwordHash: true,
        schoolId: true,
      },
    });

    // User not found
    if (!user || !user.passwordHash) {
      return res.status(401).json({ 
        error: 'Invalid email or password.' 
      });
    }

    // Password invalid
    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      return res.status(401).json({ 
        error: 'Invalid email or password.' 
      });
    }

    // ALLOW: PLATFORM_ADMIN can login through this endpoint (they just have no schoolId)
    // REQUIRED: School users MUST have a schoolId
    if (user.role !== 'PLATFORM_ADMIN' && !user.schoolId) {
      console.error(`[AUTH] School user has no schoolId: ${email} (${user.role})`);
      return res.status(403).json({ 
        error: 'This account is not assigned to a school.' 
      });
    }

    // Create JWT token (with schoolId for school users, null for platform admin)
    const token = await new SignJWT({
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      schoolId: user.schoolId || null, // Platform admin has null schoolId
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret());

    // Set httpOnly session cookie
    res.cookie('schoolbase_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.schoolbase.live' : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      token,
      role: user.role,
      userId: user.id,
      name: user.name,
      email: user.email,
      schoolId: user.schoolId,
    });
  } catch (error) {
    console.error('[AUTH] School login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================
// POST /api/auth/verify
// Verify current session
// ============================================
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.schoolbase_session;
    
    if (!token) {
      return res.status(401).json({ 
        authenticated: false,
        error: 'No session found' 
      });
    }

    const { payload } = await jwtVerify(token, secret());
    
    res.json({
      authenticated: true,
      user: payload,
    });
  } catch (error) {
    console.error('[AUTH] Verify error:', error);
    res.status(401).json({ 
      authenticated: false,
      error: 'Invalid session' 
    });
  }
});

// ============================================
// POST /api/auth/logout
// Clear session and logout user
// ============================================
router.post('/logout', (req: Request, res: Response) => {
  try {
    // Get the incoming cookie for debugging
    const incomingCookie = req.cookies?.schoolbase_session;
    console.log('[AUTH] Logout request received');
    console.log('[AUTH] Incoming session cookie:', incomingCookie ? 'present' : 'missing');
    
    // Clear the session cookie with exact same options as when set
    res.clearCookie('schoolbase_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.schoolbase.live' : undefined,
    });

    console.log('[AUTH] Session cookie cleared successfully');
    
    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  } catch (error) {
    console.error('[AUTH] Logout error:', error);
    res.status(500).json({ 
      error: 'Failed to logout' 
    });
  }
});

export default router;
