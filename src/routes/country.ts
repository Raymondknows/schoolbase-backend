import { Router, Request, Response } from 'express';

const router = Router();

// GET /api/country/config - Get country configuration
router.get('/config', async (req: Request, res: Response) => {
  try {
    // Mock countries for now - in production, load from file
    const countries = {
      NG: { name: 'Nigeria', currency: 'NGN' },
      GH: { name: 'Ghana', currency: 'GHS' },
      KE: { name: 'Kenya', currency: 'KES' },
      ZA: { name: 'South Africa', currency: 'ZAR' },
      UG: { name: 'Uganda', currency: 'UGX' }
    };
    
    res.json(countries);
  } catch (error) {
    console.error('Error reading countries config:', error);
    res.status(500).json({ error: 'Failed to load country config' });
  }
});

// GET /api/country/select - Get selected country (deprecated, returns default)
router.get('/select', async (req: Request, res: Response) => {
  try {
    res.json({ country: 'NG', currency: 'NGN' });
  } catch (error) {
    console.error('Error in country select:', error);
    res.status(500).json({ error: 'Failed to select country' });
  }
});

export default router;
