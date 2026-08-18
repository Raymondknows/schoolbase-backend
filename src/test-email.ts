#!/usr/bin/env tsx
/**
 * Test Email Script
 * Sends sample subscription emails for testing purposes
 * 
 * Usage:
 *   npx tsx src/test-email.ts --type payment --email test@example.com
 *   npx tsx src/test-email.ts --type expiry --email test@example.com --days 7
 *   npx tsx src/test-email.ts --type payment (uses default email from .env)
 */

import * as dotenv from 'dotenv';
import { sendSubscriptionPaymentSuccessEmail, sendSubscriptionExpiryWarningEmail } from './services/email.js';

dotenv.config();

interface Args {
  type: 'payment' | 'expiry';
  email?: string;
  days?: number;
}

function parseArgs(): Args {
  const args: Args = { type: 'payment' };
  
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    const nextArg = process.argv[i + 1];
    
    if (arg === '--type' && nextArg) {
      args.type = nextArg as 'payment' | 'expiry';
      i++;
    } else if (arg === '--email' && nextArg) {
      args.email = nextArg;
      i++;
    } else if (arg === '--days' && nextArg) {
      args.days = parseInt(nextArg);
      i++;
    }
  }
  
  return args;
}

async function main() {
  const args = parseArgs();
  const email = args.email || 'clickbasetechnologiesltd@gmail.com';
  
  console.log(`\n📧 SchoolBase Email Test\n`);
  console.log(`Email Type: ${args.type}`);
  console.log(`Recipient: ${email}`);
  
  try {
    if (args.type === 'payment') {
      console.log(`\nSending payment success email...`);
      await sendSubscriptionPaymentSuccessEmail(
        email,
        'Demo School',
        'Admin User',
        'GROWTH',
        '₦45,000',
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        })
      );
      console.log(`✅ Payment success email sent to ${email}\n`);
    } else if (args.type === 'expiry') {
      const daysRemaining = args.days || 7;
      console.log(`Days Remaining: ${daysRemaining}`);
      console.log(`\nSending expiry warning email...`);
      await sendSubscriptionExpiryWarningEmail(
        email,
        'Demo School',
        'Admin User',
        daysRemaining,
        new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        }),
        'GROWTH'
      );
      console.log(`✅ Expiry warning email sent to ${email}\n`);
    }
  } catch (error) {
    console.error(`❌ Error sending email:`, error);
    process.exit(1);
  }
}

main();
