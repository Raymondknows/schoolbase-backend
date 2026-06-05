import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

const app = express();
const PORT = process.env.API_PORT || 3006;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://10.135.12.55:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

// Health checks
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/health/db', (req: Request, res: Response) => {
  res.json({ status: 'ok', database: 'connected', note: 'Database connection not checked in test mode' });
});

// Auth verification endpoint
app.post('/api/admin/verify', (req: Request, res: Response) => {
  const token = req.cookies?.schoolbase_staff;
  
  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  // For testing: just return a mock session
  res.json({
    authenticated: true,
    session: {
      userId: 'test-user',
      schoolId: 'test-school',
      email: 'admin@schoolbase.test',
      name: 'Test Admin',
      role: 'SCHOOL_ADMIN',
    },
  });
});

app.post('/api/parent/verify', (req: Request, res: Response) => {
  const token = req.cookies?.schoolbase_parent;
  
  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    session: {
      guardianId: 'test-parent',
      schoolId: 'test-school',
      name: 'Test Parent',
      phone: '+234',
    },
  });
});

// Demo school endpoint
app.get('/api/school/demo/greenfield', (req: Request, res: Response) => {
  res.json({
    name: 'Greenfield School',
    city: 'Lagos',
    slug: 'greenfield',
    country: 'Nigeria',
    address: 'Lagos, Nigeria',
    email: 'info@greenfield.school',
    phone: '+234-800-000-0000',
    tagline: 'Welcome to Greenfield School - Excellence in Education',
    announcements: [
      {
        id: '1',
        title: 'Welcome to School',
        body: 'We are excited to welcome you to our school portal.',
        publishedAt: new Date(),
      },
    ],
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// Error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 SchoolBase Backend API running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
});
