import { Router, Request, Response } from 'express';
import { COUNTRY_DETAILS } from '../services/currency.js';

const router = Router();

// GET /api/country/config - Get country configuration
router.get('/config', async (req: Request, res: Response) => {
  try {
    // Mock countries for now - in production, load from file
    const countries = Object.fromEntries(
      Object.entries(COUNTRY_DETAILS).map(([code, details]) => [code, { name: details.name, currency: details.currency }])
    );
    
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
