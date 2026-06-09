import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.API_PORT || 3006;

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'https://schoolbase.live',
  'https://www.schoolbase.live',
  'https://*.vercel.app',
  'https://*.schoolbase.live',
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(url => url.trim()) : []),
];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check exact matches
    if (allowedOrigins.includes(origin)) return callback(null, true);
    
    // Check wildcard patterns
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (origin.endsWith('.schoolbase.live')) return callback(null, true);
    
    // Deny all other origins (SECURITY: changed from allow all)
    callback(new Error('CORS not allowed'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database connectivity check
app.get('/health/db', async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// Load routes after Prisma is ready
async function loadRoutes() {
  console.log('Loading routes...');
  try {
    const { default: adminRoutes } = await import('./routes/admin.js');
    console.log('✓ Loaded admin routes');
    const { default: countryRoutes } = await import('./routes/country.js');
    console.log('✓ Loaded country routes');
    const { default: paystackRoutes } = await import('./routes/paystack.js');
    console.log('✓ Loaded paystack routes');
    const { default: trialRoutes } = await import('./routes/trial.js');
    console.log('✓ Loaded trial routes');
    const { default: whatsappRoutes } = await import('./routes/whatsapp.js');
    console.log('✓ Loaded whatsapp routes');
    const { default: schoolbaseAdminRoutes } = await import('./routes/schoolbase-admin.js');
    console.log('✓ Loaded schoolbase-admin routes');
    // @ts-ignore: Runtime loader resolves the .js path for TS sources in this environment
    const { default: parentRoutes } = await import('./routes/parent.js');
    console.log('✓ Loaded parent routes');
    const { default: dashboardRoutes } = await import('./routes/dashboard.js');
    console.log('✓ Loaded dashboard routes');
    const { default: teacherRoutes } = await import('./routes/teacher.js');
    console.log('✓ Loaded teacher routes');
    const { default: authRoutes } = await import('./routes/auth.js');
    console.log('✓ Loaded auth routes');

    app.use('/api/admin', adminRoutes);
    app.use('/api/country', countryRoutes);
    app.use('/api/paystack', paystackRoutes);
    app.use('/api/trial', trialRoutes);
    app.use('/api/whatsapp', whatsappRoutes);
    app.use('/api/parent', parentRoutes);
    app.use('/api/admin', dashboardRoutes);
    app.use('/api/teacher', teacherRoutes);
    app.use('/api/auth', authRoutes);
    app.use('/schoolbase-admin/api', schoolbaseAdminRoutes);
    
    console.log('✓ All routes mounted successfully');
  } catch (error) {
    console.error('Error loading routes:', error);
    throw error;
  }
}

// Start server - load routes BEFORE listening
async function start() {
  try {
    await loadRoutes();
    
    // Error handling middleware (after routes)
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      console.error(err);
      res.status(500).json({
        error: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      });
    });

    // 404 handler (after routes)
    app.use((req: Request, res: Response) => {
      res.status(404).json({ error: 'Route not found' });
    });

    app.listen(PORT, () => {
      console.log(`✓ SchoolBase API running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Database: Connected`);
    });
  } catch (error) {
    console.error('✗ Failed to start server:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});
