import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendSignupOtpEmail(email: string, otp: string, schoolName: string) {
  try {
    const message = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: 'SchoolBase Account Verification',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
              .container { max-width: 500px; margin: 0 auto; padding: 20px; }
              .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 30px 20px; text-align: center; border-radius: 0 0 8px 8px; }
              .otp-code { background: white; font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 20px; margin: 20px 0; border: 2px solid #2563eb; border-radius: 8px; font-family: monospace; }
              .footer { margin-top: 20px; font-size: 12px; color: #666; }
              a { color: #2563eb; text-decoration: none; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">SchoolBase</h1>
              </div>
              <div class="content">
                <h2>Verify Your Email Address</h2>
                <p>Welcome to SchoolBase! You're creating a school account for <strong>${schoolName}</strong>.</p>
                <p>To complete your signup, enter this verification code:</p>
                <div class="otp-code">${otp}</div>
                <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
                <p style="color: #999; font-size: 12px; margin-top: 30px;">If you didn't request this code, you can safely ignore this email.</p>
              </div>
              <div class="footer">
                <p>&copy; 2026 SchoolBase. All rights reserved.</p>
                <p><a href="https://schoolbase.live">schoolbase.live</a></p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('OTP email sent to:', email, 'Message ID:', message.messageId);
    return true;
  } catch (error) {
    console.error('Failed to send OTP email:', error);
    throw error;
  }
}

export async function sendWelcomeEmail(email: string, schoolName: string, adminName: string) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: 'Welcome to SchoolBase!',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
              .container { max-width: 500px; margin: 0 auto; padding: 20px; }
              .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 30px 20px; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .footer { margin-top: 20px; font-size: 12px; color: #666; }
              a { color: #2563eb; text-decoration: none; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">Welcome to SchoolBase!</h1>
              </div>
              <div class="content">
                <p>Hello ${adminName},</p>
                <p>Your school <strong>${schoolName}</strong> has been registered successfully on SchoolBase!</p>
                <p>Your account is now active and ready to use. You have 30 days of free trial access to explore all features.</p>
                <center>
                  <a href="https://www.schoolbase.live/login" class="button">Go to Dashboard</a>
                </center>
                <p style="color: #666; font-size: 14px; margin-top: 30px;">
                  <strong>Quick start:</strong>
                </p>
                <ul style="color: #666; font-size: 14px;">
                  <li>Add your school's staff members</li>
                  <li>Register your students</li>
                  <li>Set up fee structures</li>
                  <li>Configure school settings</li>
                </ul>
                <p style="color: #999; font-size: 12px; margin-top: 30px;">Need help? Visit our <a href="https://schoolbase.live/help">Help Center</a> or email us at support@schoolbase.live</p>
              </div>
              <div class="footer">
                <p>&copy; 2026 SchoolBase. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    return true;
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    throw error;
  }
}
