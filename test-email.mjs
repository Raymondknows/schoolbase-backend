#!/usr/bin/env node

import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('Testing Brevo SMTP Configuration...\n');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.NODE_ENV === 'production' ? true : false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

console.log('SMTP Configuration:');
console.log('  Host:', process.env.SMTP_HOST);
console.log('  Port:', process.env.SMTP_PORT);
console.log('  User:', process.env.SMTP_USER?.slice(0, 10) + '...');
console.log('  Secure:', process.env.NODE_ENV === 'production' ? true : false);
console.log('  From:', process.env.SMTP_FROM);
console.log('\nVerifying SMTP connection...');

transporter.verify((error, success) => {
  if (error) {
    console.error('\n❌ SMTP Connection Failed:');
    console.error(error);
    process.exit(1);
  } else {
    console.log('✅ SMTP Server is ready to take messages');
    
    // Test sending an email
    console.log('\nSending test OTP email to demo@schoolbase.live...');
    
    transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@schoolbase.live',
      to: 'demo@schoolbase.live',
      subject: 'SchoolBase Account Verification - Test',
      html: `
        <h2>Verify Your Email Address</h2>
        <p>Test OTP: <strong>123456</strong></p>
        <p>This is a test email from the local SchoolBase development server.</p>
      `,
    }, (err, info) => {
      if (err) {
        console.error('\n❌ Email sending failed:');
        console.error(err);
        process.exit(1);
      } else {
        console.log('\n✅ Test email sent successfully!');
        console.log('Message ID:', info.messageId);
        console.log('\nThe OTP email endpoint should now work correctly.');
        process.exit(0);
      }
    });
  }
});
