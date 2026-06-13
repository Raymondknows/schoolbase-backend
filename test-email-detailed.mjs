#!/usr/bin/env node

import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('🔍 Detailed Brevo SMTP Diagnostic\n');
console.log('=' .repeat(50));

console.log('\n📋 Configuration:');
console.log('  SMTP_HOST:', process.env.SMTP_HOST);
console.log('  SMTP_PORT:', process.env.SMTP_PORT);
console.log('  SMTP_USER:', process.env.SMTP_USER);
console.log('  SMTP_PASS (first 20 chars):', process.env.SMTP_PASS?.substring(0, 20) + '...');
console.log('  SMTP_FROM:', process.env.SMTP_FROM);
console.log('  NODE_ENV:', process.env.NODE_ENV);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.NODE_ENV === 'production' ? true : false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  logger: true,
  debug: true,
});

console.log('\n🔐 Testing SMTP Authentication...');
console.log('=' .repeat(50));

transporter.verify((error, success) => {
  if (error) {
    console.error('\n❌ SMTP Verification Failed!');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    
    if (error.code === 'EAUTH' || error.message.includes('535')) {
      console.error('\n⚠️  AUTHENTICATION ERROR!');
      console.error('The SMTP credentials are invalid or expired.');
      console.error('Please verify your Brevo SMTP credentials:');
      console.error('  - Check SMTP_USER is correct');
      console.error('  - Check SMTP_PASS is valid');
      console.error('  - Generate a new API key in Brevo if needed');
    }
    process.exit(1);
  }
  
  console.log('✅ SMTP Authentication Successful!\n');
  
  console.log('📧 Attempting to send detailed test email...');
  console.log('=' .repeat(50));
  
  const testEmail = {
    from: process.env.SMTP_FROM || 'noreply@schoolbase.live',
    to: 'demo@schoolbase.live',
    subject: 'SchoolBase - OTP Email Test',
    html: `
      <html>
        <body>
          <h2>Test OTP Email</h2>
          <p>OTP Code: <strong>654321</strong></p>
          <p>Sent at: ${new Date().toISOString()}</p>
          <p>This is a diagnostic test email from SchoolBase.</p>
        </body>
      </html>
    `,
  };
  
  transporter.sendMail(testEmail, (err, info) => {
    if (err) {
      console.error('\n❌ Email sending failed!');
      console.error('Error:', err.message);
      console.error('Code:', err.code);
      
      if (err.code === 'EAUTH' || err.message.includes('535')) {
        console.error('\n⚠️  AUTHENTICATION ERROR!');
        console.error('Invalid Brevo SMTP credentials.');
      }
      
      if (err.code === 'EDNS' || err.message.includes('getaddrinfo')) {
        console.error('\n⚠️  DNS/NETWORK ERROR!');
        console.error('Cannot connect to Brevo SMTP server.');
      }
      
      process.exit(1);
    }
    
    console.log('\n✅ Email accepted by Brevo SMTP!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    
    console.log('\n' + '=' .repeat(50));
    console.log('\n⚠️  NOTE: Email was accepted by SMTP server.');
    console.log('However, it may not have been delivered to inbox.');
    console.log('\nCommon reasons for delivery failure:');
    console.log('  1. Email address typo or invalid');
    console.log('  2. Brevo account not fully set up');
    console.log('  3. Sender domain not verified in Brevo');
    console.log('  4. Recipient email blocking the domain');
    console.log('  5. Email in spam folder');
    console.log('\nAction items:');
    console.log('  • Check SMTP user is valid (looks like: xxx@smtp-brevo.com)');
    console.log('  • Generate new API credentials in Brevo account');
    console.log('  • Verify sender domain in Brevo');
    console.log('  • Check demo@schoolbase.live inbox and spam folder');
    
    process.exit(0);
  });
});
