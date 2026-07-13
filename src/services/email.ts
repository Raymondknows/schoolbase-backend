import nodemailer from 'nodemailer';

export function buildTransportConfig() {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const explicitSecure = process.env.SMTP_SECURE;
  const secure = explicitSecure === undefined
    ? process.env.NODE_ENV === 'production'
    : explicitSecure.toLowerCase() === 'true';

  return {
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 5000,
    socketTimeout: 10000,
  };
}

const transporter = nodemailer.createTransport(buildTransportConfig() as any);

// ═══════════════════════════════════════════════════════════════════════════════
// BRAND COLORS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const BRAND = {
  primary: '#0A66C2',        // SchoolBase Blue
  primaryHover: '#004182',   // Darker Blue
  primaryLight: '#E8F4FC',   // Light Blue Background
  success: '#057642',        // Green
  warning: '#915907',        // Orange
  error: '#CC1016',          // Red
  text: '#191919',           // Dark Gray
  textMuted: '#666666',      // Medium Gray
  border: '#E0E0E0',         // Light Gray
  surface: '#FFFFFF',        // White
  background: '#F3F2EF',     // Off-White
};

const DEFAULT_EMAIL_LOGO = 'https://schoolbase.live/logo.png';

function buildAssetUrl(value?: string | null): string | null {
  if (!value) return null;

  if (/^https?:\/\//.test(value)) {
    return value;
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.BACKEND_URL || 'http://localhost:3006';
  const normalizedBase = baseUrl.replace(/\/$/, '');

  return new URL(value.startsWith('/') ? value : `/${value}`, normalizedBase).toString();
}

function getLogoExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'img';
}

async function fetchInlineLogo(value?: string | null) {
  const assetUrl = buildAssetUrl(value);
  if (!assetUrl) return null;

  try {
    const response = await fetch(assetUrl);
    if (!response.ok) return { src: assetUrl };

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    const cid = `school-logo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return {
      src: `cid:${cid}`,
      attachment: {
        filename: `school-logo.${getLogoExtension(contentType)}`,
        content: buffer,
        cid,
        contentType,
      },
    };
  } catch {
    return { src: assetUrl };
  }
}

const EMAIL_STYLES = `
  * { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: ${BRAND.text};
    line-height: 1.6;
    background-color: ${BRAND.background};
  }
  .email-container {
    max-width: 680px;
    margin: 20px auto;
    background-color: ${BRAND.surface};
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    overflow: hidden;
  }
  .header {
    background: linear-gradient(135deg, ${BRAND.primary} 0%, #084a9a 100%);
    color: ${BRAND.surface};
    padding: 24px 30px;
    text-align: center;
  }
  .header h1 {
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 4px 0;
  }
  .header-subtitle {
    font-size: 14px;
    opacity: 0.9;
    margin: 0;
  }
  .logo {
    width: 40px;
    height: 40px;
    margin: 0 auto 12px;
  }
  .content {
    padding: 40px 30px;
  }
  .content p {
    margin: 0 0 16px 0;
    font-size: 15px;
    color: ${BRAND.text};
  }
  .content h2 {
    font-size: 20px;
    font-weight: 700;
    color: ${BRAND.text};
    margin: 24px 0 16px 0;
  }
  .button {
    display: inline-block;
    background-color: ${BRAND.primary};
    color: ${BRAND.surface};
    padding: 12px 32px;
    text-decoration: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 14px;
    margin: 20px 0;
  }
  .button:hover {
    background-color: ${BRAND.primaryHover};
  }
  .button-container {
    text-align: center;
    margin: 30px 0;
  }
  .info-box {
    background-color: ${BRAND.primaryLight};
    border-left: 4px solid ${BRAND.primary};
    padding: 16px;
    margin: 20px 0;
    border-radius: 4px;
  }
  .info-box p {
    margin: 0 0 8px 0;
    font-size: 14px;
  }
  .info-box strong {
    font-weight: 600;
    color: ${BRAND.text};
  }
  .warning-box {
    background-color: #FFF3E0;
    border: 1px solid #FFE0B2;
    border-left: 4px solid ${BRAND.warning};
    padding: 16px;
    margin: 20px 0;
    border-radius: 4px;
  }
  .warning-box p {
    margin: 0;
    font-size: 13px;
    color: #92400e;
  }
  .otp-code {
    background-color: ${BRAND.surface};
    border: 2px solid ${BRAND.primary};
    color: ${BRAND.primary};
    font-family: 'Courier New', monospace;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: 4px;
    padding: 20px;
    text-align: center;
    border-radius: 8px;
    margin: 24px 0;
  }
  .status-badge {
    display: inline-block;
    padding: 8px 12px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 13px;
    margin-top: 8px;
  }
  .status-present {
    background-color: #E8F5E9;
    color: ${BRAND.success};
  }
  .status-absent {
    background-color: #FFEBEE;
    color: ${BRAND.error};
  }
  .status-late {
    background-color: #FFF3E0;
    color: ${BRAND.warning};
  }
  .amount-large {
    font-size: 24px;
    font-weight: 700;
    color: ${BRAND.primary};
    margin: 12px 0;
  }
  .list-item {
    margin: 12px 0;
    padding-left: 24px;
    position: relative;
    font-size: 14px;
  }
  .list-item:before {
    content: "✓";
    position: absolute;
    left: 0;
    color: ${BRAND.success};
    font-weight: 700;
  }
  .divider {
    border: none;
    border-top: 1px solid ${BRAND.border};
    margin: 24px 0;
  }
  .footer {
    background-color: ${BRAND.background};
    padding: 24px 30px;
    border-top: 1px solid ${BRAND.border};
    font-size: 12px;
    color: ${BRAND.textMuted};
  }
  .footer a {
    color: ${BRAND.primary};
    text-decoration: none;
  }
  .footer-text {
    margin: 8px 0;
    font-size: 11px;
    color: #999;
  }
`;

/**
 * Validate email address format
 * @param email Email address to validate
 * @returns true if valid, false otherwise
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim().toLowerCase());
}


// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 1: OTP VERIFICATION EMAIL
// ═══════════════════════════════════════════════════════════════════════════════

export async function sendSignupOtpEmail(email: string, otp: string, schoolName: string) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const textBody = `SchoolBase Email Verification Code\n\nHello,\n\nWelcome to SchoolBase! You're creating a school account for ${schoolName}.\n\nTo complete your registration, enter the verification code: ${otp}\n\nThis code expires in 10 minutes. Never share this code with anyone. SchoolBase staff will never ask for your verification code.\n\nIf you didn't request this code, ignore this email. Your email won't be registered unless verified.\n\nContact support at support@schoolbase.live if you need help.`;

    const message = await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: 'SchoolBase Email Verification Code',
      text: textBody,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <img src="https://schoolbase.live/logo.png" alt="SchoolBase Logo" class="logo" />
                <h1>SchoolBase</h1>
                <p class="header-subtitle">Verify Your Email Address</p>
              </div>
              <div class="content">
                <p>Hello,</p>
                <p>Welcome to SchoolBase! You're creating a school account for <strong>${schoolName}</strong>.</p>
                <p>To complete your registration, please enter this verification code:</p>
                
                <div style="text-align: center;">
                  <div class="otp-code">${otp}</div>
                </div>
                
                <p style="text-align: center; font-size: 13px; color: ${BRAND.textMuted};">
                  This code expires in 10 minutes
                </p>

                <p style="margin-top: 24px;">Enter this code on the verification screen to unlock your SchoolBase workspace. This code can only be used once.</p>

                <div class="warning-box">
                  <p><strong>🔒 Security Tip:</strong> Never share this code with anyone. SchoolBase staff will never ask for your verification code.</p>
                </div>

                <p style="margin-top: 24px;">If you didn't request this code, you can safely ignore this email. Your email won't be registered unless you verify it.</p>

                <p>Need help? <a href="https://schoolbase.live/help" style="color: ${BRAND.primary};">Contact Support</a></p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
                <p class="footer-text">Questions? <a href="mailto:support@schoolbase.live">support@schoolbase.live</a></p>
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

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 2: WELCOME EMAIL (ADMIN)
// ═══════════════════════════════════════════════════════════════════════════════

export async function sendWelcomeEmail(email: string, schoolName: string, adminName: string) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const textBody = `Welcome to SchoolBase!\n\nHello ${adminName},\n\nCongratulations! Your workspace for ${schoolName} is now active and ready to use. You now have 7 days of free access to explore all SchoolBase features.\n\nWhat you can do right now:\n- Add your school staff and teachers\n- Register students and their classes\n- Set up fee structures and payment terms\n- Configure your school settings and branding\n- Invite parents to the portal\n\nIf you need help, contact support@schoolbase.live or visit https://schoolbase.live/help.\n\nWarm regards,\nThe SchoolBase Team`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: `Welcome to SchoolBase! Your workspace is ready – Let's go live in 48 hours`,
      text: textBody,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <img src="https://schoolbase.live/logo.png" alt="SchoolBase Logo" class="logo" />
                <h1>Welcome to SchoolBase!</h1>
                <p class="header-subtitle">Your school's management just got simpler</p>
              </div>
              <div class="content">
                <p>Hello ${adminName},</p>
                <p>Congratulations! Your workspace for <strong>${schoolName}</strong> is now active and ready to use.</p>
                <p>You now have 7 days of free access to explore all SchoolBase features. Let's get your school set up for success!</p>

                <div class="info-box">
                  <p>We've designed SchoolBase to make school management simple. Whether you're managing fees, publishing results, or communicating with parents, everything is designed to save you time and reduce paperwork.</p>
                </div>

                <h2 style="margin-top: 32px;">What you can do right now:</h2>
                <div class="list-item">Add your school staff and teachers</div>
                <div class="list-item">Register students and their classes</div>
                <div class="list-item">Set up fee structures and payment terms</div>
                <div class="list-item">Configure your school settings and branding</div>
                <div class="list-item">Invite parents to the portal</div>

                <h2 style="margin-top: 32px;">Quick Setup Guide:</h2>
                <p><strong>1. Complete Your School Profile</strong><br>Add your school's logo, contact info, and bank details</p>
                <p><strong>2. Add Your Staff</strong><br>Teachers get their own accounts and temporary passwords</p>
                <p><strong>3. Register Students</strong><br>Import from CSV with admission numbers or add manually</p>
                <p><strong>4. Set Up Fees & Classes</strong><br>Define fee structures and organize students into classes</p>
                <p><strong>5. Invite Parents</strong><br>They login with WhatsApp number + child's admission number (no password needed!)</p>

                <div class="button-container">
                  <a href="https://schoolbase.live/admin/dashboard" class="button">Go to Your Dashboard</a>
                </div>

                <p>Our support team is here to help at every step. If you get stuck, just reply to this email or <a href="https://schoolbase.live/help" style="color: ${BRAND.primary};">visit our Help Center</a>.</p>

                <div class="info-box">
                  <p><strong>💡 Pro Tip:</strong> Check out our video tutorials in the Help section—they show you exactly how to set up fees, publish results, and more. Most admins are fully set up in under 30 minutes!</p>
                </div>

                <p style="margin-top: 32px;">Thank you for choosing SchoolBase. We're excited to partner with you in building a better school experience for your entire community.</p>

                <p>Warm regards,<br><strong>The SchoolBase Team 🙌</strong></p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
                <p class="footer-text"><a href="https://schoolbase.live/help">Help Center</a> | <a href="https://schoolbase.live/contact">Contact Support</a></p>
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

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 3: PASSWORD RESET EMAIL
// ═══════════════════════════════════════════════════════════════════════════════

export async function sendPasswordResetEmail(email: string, resetLink: string, userName: string) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const textBody = `Reset Your SchoolBase Password\n\nHello ${userName},\n\nWe received a request to reset the password for your SchoolBase account. Use the link below to create a new password:\n${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, ignore the email or contact support@schoolbase.live.\n\nNever share your password with anyone. SchoolBase staff will never ask for your password.`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: 'Reset Your SchoolBase Password',
      text: textBody,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <img src="https://schoolbase.live/logo.png" alt="SchoolBase Logo" class="logo" />
                <h1>Reset Your Password</h1>
                <p class="header-subtitle">SchoolBase Account Security</p>
              </div>
              <div class="content">
                <p>Hello ${userName},</p>
                <p>We received a request to reset the password for your SchoolBase account. If you made this request, click the button below to create a new password:</p>

                <div class="button-container">
                  <a href="${resetLink}" class="button">Reset Your Password</a>
                </div>

                <p style="font-size: 13px; color: ${BRAND.textMuted};">Or copy and paste this link in your browser:</p>
                <p style="background-color: ${BRAND.background}; padding: 12px; border-radius: 4px; word-break: break-all; font-size: 12px; color: ${BRAND.text}; margin: 12px 0;">
                  <a href="${resetLink}" style="color: ${BRAND.primary};">${resetLink}</a>
                </p>

                <div class="warning-box">
                  <p><strong>⏰ Important:</strong> This link expires in 1 hour. If you don't use it within an hour, you'll need to request a new password reset.</p>
                </div>

                <p><strong>Didn't request this?</strong> Your account may have been compromised. If you didn't request a password reset, please <a href="https://schoolbase.live/contact" style="color: ${BRAND.primary};">contact our support team</a> immediately or ignore this email. Your password won't change unless you complete the reset.</p>

                <h2 style="font-size: 14px; margin-top: 24px;">Security Tips:</h2>
                <div class="list-item">Never share your password with anyone</div>
                <div class="list-item">SchoolBase staff will never ask for your password</div>
                <div class="list-item">Always use a strong, unique password</div>

                <p style="margin-top: 32px;">Need help? <a href="https://schoolbase.live/help" style="color: ${BRAND.primary};">Visit our Help Center</a> or reply to this email.</p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
                <p class="footer-text">Security concern? <a href="mailto:support@schoolbase.live">Report it</a></p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    return true;
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 4: FEE REMINDER EMAIL (PARENTS)
// ═══════════════════════════════════════════════════════════════════════════════

export async function sendFeeReminderEmail(
  email: string,
  guardianName: string,
  pupilName: string,
  className: string,
  termName: string,
  currency: string,
  totalAmount: string,
  paidAmount: string,
  outstandingAmount: string,
  schoolName: string,
  schoolLogo?: string,
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const schoolLogoInline = await fetchInlineLogo(schoolLogo);
    const attachments = schoolLogoInline?.attachment ? [schoolLogoInline.attachment] : undefined;
    const textBody = `School Fee Payment Reminder - ${schoolName}\n\nDear ${guardianName},\n\nThis is a friendly reminder that there is an outstanding school fee balance for ${pupilName}.\n\nStudent: ${pupilName}\nClass: ${className}\nTerm: ${termName}\n\nOutstanding Balance: ${currency} ${outstandingAmount}\nTotal Fees: ${currency} ${totalAmount}\nAlready Paid: ${currency} ${paidAmount}\n\nPlease arrange payment as soon as possible to avoid disruptions. Contact the school office for payment options or visit https://schoolbase.live/parent/invoices to review the invoice.\n\nThank you,\n${schoolName} Finance Team`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: `School Fee Payment Reminder - ${schoolName}`,
      text: textBody,
      ...(attachments ? { attachments } : {}),
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                ${schoolLogoInline ? `<img src="${schoolLogoInline.src}" alt="${schoolName}" class="logo" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover;">` : `<img src="${DEFAULT_EMAIL_LOGO}" alt="SchoolBase Logo" class="logo" />`}
                <h1>${schoolName}</h1>
                <p class="header-subtitle">School Fee Payment Reminder</p>
              </div>
              <div class="content">
                <p>Dear ${guardianName},</p>
                <p>We hope this message finds you well. This is a friendly reminder that there is an outstanding school fee balance for <strong>${pupilName}</strong>.</p>

                <div class="info-box">
                  <p><strong>Student:</strong> ${pupilName}</p>
                  <p><strong>Class:</strong> ${className}</p>
                  <p><strong>Term:</strong> ${termName}</p>
                </div>

                <h2 style="margin-top: 32px; text-align: center;">Outstanding Balance</h2>
                <p style="text-align: center;"><strong style="font-size: 20px; color: ${BRAND.error};">${currency} ${outstandingAmount}</strong></p>
                <p style="text-align: center; font-size: 13px; color: ${BRAND.textMuted};">Total Fees: ${currency} ${totalAmount} | Already Paid: ${currency} ${paidAmount}</p>

                <p style="margin-top: 24px;">We kindly request that you arrange payment at your earliest convenience to ensure there are no disruptions to your child's education and access to school records.</p>

                <div class="info-box">
                  <p><strong>Payment Methods:</strong></p>
                  <p>Please contact the school office for available payment options and bank account details. We accept bank transfers, mobile money, and cheques.</p>
                </div>

                <div class="button-container">
                  <a href="https://schoolbase.live/parent/invoices" class="button">View Full Invoice Details</a>
                </div>

                <div class="warning-box">
                  <p><strong>✓ Already paid?</strong> If you've recently made this payment, please disregard this reminder. Your payment may still be processing. Thank you for your support!</p>
                </div>

                <p>If you have any questions, concerns, or need to discuss a payment plan, please don't hesitate to contact the school office directly. We're here to support you.</p>

                <p>Best regards,<br><strong>${schoolName} Finance Team</strong></p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
                <p class="footer-text">Questions? <a href="mailto:support@schoolbase.live">Contact ${schoolName}</a></p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('Fee reminder email sent to:', email);
    return true;
  } catch (error) {
    console.error('Failed to send fee reminder email:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 5: FEE PAYMENT RECEIPT EMAIL
// ═══════════════════════════════════════════════════════════════════════

export async function sendFeePaymentReceiptEmail(
  email: string,
  guardianName: string,
  pupilName: string,
  className: string,
  currency: string,
  amountPaid: string,
  totalPaid: string,
  balance: string,
  schoolName: string,
  schoolLogo?: string,
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const schoolLogoInline = await fetchInlineLogo(schoolLogo);
    const attachments = schoolLogoInline?.attachment ? [schoolLogoInline.attachment] : undefined;
    const textBody = `School Fee Payment Receipt - ${schoolName}\n\nHello ${guardianName},\n\nWe have received a payment of ${currency} ${amountPaid} for ${pupilName}.\n\nStudent: ${pupilName}\nClass: ${className}\nAmount Paid: ${currency} ${amountPaid}\nTotal Paid: ${currency} ${totalPaid}\nBalance: ${currency} ${balance}\n\nThank you for your prompt payment. If you have questions, please contact the school office.`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: `Payment Receipt - ${schoolName}`,
      text: textBody,
      ...(attachments ? { attachments } : {}),
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                ${schoolLogoInline ? `<img src="${schoolLogoInline.src}" alt="${schoolName}" class="logo" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover;">` : `<img src="${DEFAULT_EMAIL_LOGO}" alt="SchoolBase Logo" class="logo" />`}
                <h1>${schoolName}</h1>
                <p class="header-subtitle">Payment Receipt</p>
              </div>
              <div class="content">
                <p>Hello ${guardianName},</p>
                <p>Thank you! We have received your payment for <strong>${pupilName}</strong>.</p>
                <div class="info-box">
                  <p><strong>Student:</strong> ${pupilName}</p>
                  <p><strong>Class:</strong> ${className}</p>
                  <p><strong>Amount Paid:</strong> ${currency} ${amountPaid}</p>
                  <p><strong>Total Paid:</strong> ${currency} ${totalPaid}</p>
                  <p><strong>Balance:</strong> ${currency} ${balance}</p>
                </div>
                <p>If you have any questions about this payment, please contact the school office.</p>
                <div class="button-container">
                  <a href="https://schoolbase.live/parent/invoices" class="button">View Invoice Details</a>
                </div>
                <p>Best regards,<br><strong>${schoolName} Finance Team</strong></p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 ${schoolName}. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('Fee payment receipt email sent to:', email);
    return true;
  } catch (error) {
    console.error('Failed to send fee payment receipt email:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 5: TEACHER WELCOME EMAIL
// ═══════════════════════════════════════════════════════════════════════════════

export async function sendTeacherWelcomeEmail(
  email: string,
  teacherName: string,
  schoolName: string,
  temporaryPassword?: string,
  loginUrl: string = 'https://www.schoolbase.live/login',
  schoolLogo?: string,
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const schoolLogoInline = await fetchInlineLogo(schoolLogo);
    const attachments = schoolLogoInline?.attachment ? [schoolLogoInline.attachment] : undefined;
    const textBody = `Welcome to ${schoolName} on SchoolBase\n\nHello ${teacherName},\n\nWelcome to the ${schoolName} teacher portal on SchoolBase! Your account has been created and you're ready to get started.\n\nEmail: ${email}${temporaryPassword ? `\nTemporary Password: ${temporaryPassword}` : ''}\n\nPlease change your temporary password immediately after your first login. Login at ${loginUrl}.\n\nWhat you can do on SchoolBase:\n- View your class roster and student list\n- Record attendance quickly\n- Enter marks and auto-calculate grades\n- Publish results to parents\n- Write comments and observations\n- View class broadsheet\n\nNeed help? Visit https://schoolbase.live/teacher-guide or https://schoolbase.live/help.\n\nBest regards,\nThe SchoolBase Team`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: `Welcome to ${schoolName} on SchoolBase`,
      text: textBody,
      ...(attachments ? { attachments } : {}),
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                ${schoolLogoInline ? `<img src="${schoolLogoInline.src}" alt="${schoolName}" class="logo" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover;">` : `<img src="${DEFAULT_EMAIL_LOGO}" alt="SchoolBase Logo" class="logo" />`}
                <h1>${schoolName}</h1>
                <p class="header-subtitle">Welcome to your teacher portal</p>
              </div>
              <div class="content">
                <p>Hello ${teacherName},</p>
                <p>Welcome to the <strong>${schoolName}</strong> teacher portal on SchoolBase! Your account has been created by your school administration, and you're ready to get started.</p>
                <p>SchoolBase makes it easy to manage your classes, track student progress, and communicate with parents—all from one place.</p>

                <h2 style="font-size: 16px; margin-top: 24px;">Your Login Details:</h2>
                <div class="info-box">
                  <p><strong>Email:</strong> ${email}</p>
                  ${temporaryPassword ? `<p><strong>Temporary Password:</strong> ${temporaryPassword}</p>` : ''}
                </div>

                <div class="warning-box">
                  <p><strong>🔒 Important:</strong> Please change your temporary password immediately after your first login. Use a strong, unique password that only you know.</p>
                </div>

                <h2 style="font-size: 16px; margin-top: 24px;">What You Can Do on SchoolBase:</h2>
                <div class="list-item">View your class roster and student list with complete details</div>
                <div class="list-item">Record attendance in 30 seconds (mark entire class at once)</div>
                <div class="list-item">Enter marks and auto-calculate grades automatically</div>
                <div class="list-item">Publish results instantly to parents via WhatsApp</div>
                <div class="list-item">Write student comments and observations per student</div>
                <div class="list-item">View class broadsheet (all students' marks in one table)</div>
                <div class="list-item">Send school announcements to all parents in your class</div>
                <div class="list-item">Track student performance trends across terms</div>
                <div class="list-item">Access school announcements and resources</div>
                <div class="list-item">Manage your teacher profile and settings</div>

                <div class="button-container">
                  <a href="${loginUrl}" class="button">Log In to Your Portal</a>
                </div>

                <p><strong>Need Help?</strong> Check out our <a href="https://schoolbase.live/teacher-guide" style="color: ${BRAND.primary};">Teacher's Guide</a> and video tutorials. Most teachers are comfortable with the system within their first day!</p>

                <p>Our support team is here if you have any questions. Just reply to this email or <a href="https://schoolbase.live/help" style="color: ${BRAND.primary};">visit our Help Center</a>.</p>

                <p style="margin-top: 32px;">Welcome to the team! We're excited to help you focus on what matters most—your students' success.</p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
                <p class="footer-text">Support: <a href="mailto:support@schoolbase.live">support@schoolbase.live</a></p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('Teacher welcome email sent to:', email);
    return true;
  } catch (error) {
    console.error('Failed to send teacher welcome email:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 6: ATTENDANCE NOTIFICATION EMAIL
// ═══════════════════════════════════════════════════════════════════════════════

export async function sendAttendanceNotificationEmail(
  email: string,
  guardianName: string,
  pupilName: string,
  className: string,
  date: string,
  status: 'present' | 'absent' | 'late',
  schoolName: string,
  customMessage?: string,
  schoolLogo?: string,
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const statusColors: Record<string, { bg: string; text: string; label: string }> = {
      present: { bg: '#E8F5E9', text: BRAND.success, label: 'PRESENT ✓' },
      absent: { bg: '#FFEBEE', text: BRAND.error, label: 'ABSENT ✗' },
      late: { bg: '#FFF3E0', text: BRAND.warning, label: 'LATE ⏰' },
    };

    const statusColor = statusColors[status] || statusColors.present;

    const schoolLogoInline = await fetchInlineLogo(schoolLogo);
    const attachments = schoolLogoInline?.attachment ? [schoolLogoInline.attachment] : undefined;

    const textBody = `Attendance Update - ${pupilName}\n\nHello ${guardianName},\n\nHere's the latest attendance update for ${pupilName}:\nStatus: ${statusColor.label}\nClass: ${className}\nDate: ${date}\n\n${customMessage ? `Note from teacher: ${customMessage}\n\n` : ''}View the full attendance record at https://schoolbase.live/parent/attendance.\n\nBest regards,\n${schoolName} Administration`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: `Attendance Update - ${pupilName}`,
      text: textBody,
      ...(attachments ? { attachments } : {}),
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                ${schoolLogoInline ? `<img src="${schoolLogoInline.src}" alt="${schoolName}" class="logo" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover;">` : `<img src="${DEFAULT_EMAIL_LOGO}" alt="SchoolBase Logo" class="logo" />`}
                <h1>${schoolName}</h1>
                <p class="header-subtitle">Attendance Update</p>
              </div>
              <div class="content">
                <p>Hello ${guardianName},</p>
                <p>Here's the latest attendance update for <strong>${pupilName}</strong>:</p>

                <div style="text-align: center; margin: 24px 0;">
                  <div class="status-badge status-${status}" style="background-color: ${statusColor.bg}; color: ${statusColor.text}; padding: 12px 20px; font-size: 16px; font-weight: 700;">
                    ${statusColor.label}
                  </div>
                </div>

                <div class="info-box">
                  <p><strong>Student:</strong> ${pupilName}</p>
                  <p><strong>Class:</strong> ${className}</p>
                  <p><strong>Date:</strong> ${date}</p>
                </div>

                ${customMessage ? `<div style="background-color: ${BRAND.background}; padding: 16px; border-radius: 4px; margin: 20px 0;"><p><strong>Note from teacher:</strong></p><p>${customMessage}</p></div>` : ''}

                <p style="margin-top: 24px;">We keep you informed with daily attendance updates so you're always aware of your child's school presence. If you have any concerns or questions, please reach out to the school.</p>

                <div class="button-container">
                  <a href="https://schoolbase.live/parent/attendance" class="button">View Full Attendance Record</a>
                </div>

                <p>Best regards,<br><strong>${schoolName} Administration</strong></p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
                <p class="footer-text">Questions? Contact <a href="mailto:support@schoolbase.live">${schoolName}</a></p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('Attendance notification email sent to:', email);
    return true;
  } catch (error) {
    console.error('Failed to send attendance notification email:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE 7: STUDENT ADMISSION NOTIFICATION EMAIL
// ═══════════════════════════════════════════════════════════════════════

export async function sendAnnouncementEmail(
  email: string,
  guardianName: string,
  announcementTitle: string,
  announcementBody: string,
  schoolName: string,
  schoolLogo?: string,
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const schoolLogoInline = await fetchInlineLogo(schoolLogo);
    const attachments = schoolLogoInline?.attachment ? [schoolLogoInline.attachment] : undefined;

    const textBody = `${announcementTitle}\n\nHello ${guardianName},\n\n${announcementBody}\n\nVisit the parent portal for more information and updates.\n\nBest regards,\n${schoolName} Administration`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: announcementTitle,
      text: textBody,
      ...(attachments ? { attachments } : {}),
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                ${schoolLogoInline ? `<img src="${schoolLogoInline.src}" alt="${schoolName}" class="logo" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover;">` : `<img src="${DEFAULT_EMAIL_LOGO}" alt="SchoolBase Logo" class="logo" />`}
                <h1>${schoolName}</h1>
                <p class="header-subtitle">School Announcement</p>
              </div>
              <div class="content">
                <p>Hello ${guardianName},</p>
                <p><strong>${announcementTitle}</strong></p>
                <div class="info-box">
                  <p>${announcementBody}</p>
                </div>
                <div class="button-container">
                  <a href="https://schoolbase.live/parent/announcements" class="button">View Announcement</a>
                </div>
                <p>Best regards,<br><strong>${schoolName} Administration</strong></p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 ${schoolName}. All rights reserved.</p>
                <p class="footer-text"><a href="https://schoolbase.live">Visit SchoolBase</a></p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('Announcement email sent to:', email);
    return true;
  } catch (error) {
    console.error('Failed to send announcement email:', error);
    throw error;
  }
}

export async function sendAdmissionNotificationEmail(
  email: string,
  guardianName: string,
  pupilName: string,
  className: string,
  admissionNo: string,
  schoolName: string,
  schoolLogo?: string,
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const schoolLogoInline = await fetchInlineLogo(schoolLogo);
    const attachments = schoolLogoInline?.attachment ? [schoolLogoInline.attachment] : undefined;
    const textBody = `Student Registration\n${pupilName} has been registered for ${className} at ${schoolName}.\nAdmission Number: ${admissionNo}\n\nHello ${guardianName},\n\nYour child has been successfully registered. Visit the parent portal at https://schoolbase.live/parent/login for details.`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: `${pupilName} has been registered at ${schoolName}`,
      text: textBody,
      ...(attachments ? { attachments } : {}),
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                ${schoolLogoInline ? `<img src="${schoolLogoInline.src}" alt="${schoolName}" class="logo" style="width: 60px; height: 60px; border-radius: 50%; object-fit: cover;">` : ''}
                <h1>${schoolName}</h1>
                <p class="header-subtitle">Student Registration</p>
              </div>
              <div class="content">
                <p>Hello ${guardianName},</p>
                <p>We’re pleased to let you know that <strong>${pupilName}</strong> has been successfully registered for <strong>${className}</strong> at <strong>${schoolName}</strong>.</p>
                <div class="info-box">
                  <p><strong>Student Name:</strong> ${pupilName}</p>
                  <p><strong>Admission Number:</strong> ${admissionNo}</p>
                  <p><strong>Class:</strong> ${className}</p>
                </div>
                <p>If you have any questions or need assistance with your child’s school profile, please contact the school office or visit the parent portal.</p>
                <div class="button-container">
                  <a href="https://schoolbase.live/parent/login" class="button">Visit Parent Portal</a>
                </div>
                <p>Thank you for choosing SchoolBase to support your child’s education.</p>
                <p>Warm regards,<br><strong>The ${schoolName} Team</strong></p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
                <p class="footer-text"><a href="https://schoolbase.live/help">Help Center</a> | <a href="mailto:support@schoolbase.live">Contact Support</a></p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('Admission notification email sent to:', email);
    return true;
  } catch (error) {
    console.error('Failed to send admission notification email:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE 8: SETUP COMPLETION REMINDER EMAIL
// ═══════════════════════════════════════════════════════════════════════════════

export function buildSetupReminderTaskSections(
  completedItems: string[] = [],
  missingItems: string[] = [],
) {
  const completedHtml = completedItems.length > 0
    ? completedItems
        .map((item) => `<p style="margin: 8px 0; color: ${BRAND.text};"><strong>✓</strong> ${item}</p>`)
        .join('')
    : `<p style="margin: 8px 0; color: ${BRAND.textMuted};">No completed setup items were detected yet.</p>`;

  const missingHtml = missingItems.length > 0
    ? missingItems
        .map((item) => `<p style="margin: 8px 0; color: ${BRAND.text};"><strong>○</strong> ${item}</p>`)
        .join('')
    : `<p style="margin: 8px 0; color: ${BRAND.primary};">Everything looks complete so far.</p>`;

  return { completedHtml, missingHtml };
}

export async function sendSetupReminderEmail(
  email: string,
  adminName: string,
  schoolName: string,
  remainingTasks: string[] = [],
  completedItems: string[] = [],
  missingItems: string[] = [],
  completionPercentage?: number,
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const defaultTasks = [
      { task: 'Add your school staff', time: '2 min' },
      { task: 'Register students', time: '5-10 min' },
      { task: 'Set up fee structures', time: '3 min' },
      { task: 'Invite parents to the portal', time: '5 min' },
    ];

    let taskSectionHtml = '';
    const hasChecklistData = completedItems.length > 0 || missingItems.length > 0;

    if (hasChecklistData) {
      const { completedHtml, missingHtml } = buildSetupReminderTaskSections(completedItems, missingItems);
      taskSectionHtml = `
        <div style="display: grid; gap: 12px; margin: 16px 0;">
          <div style="background-color: ${BRAND.primaryLight}; padding: 14px 16px; border-radius: 6px; border: 1px solid ${BRAND.primary};">
            <h3 style="font-size: 14px; margin-bottom: 6px; color: ${BRAND.primary};">Completed setup</h3>
            ${completedHtml}
          </div>
          <div style="background-color: ${BRAND.surface}; padding: 14px 16px; border-radius: 6px; border: 1px solid ${BRAND.border};">
            <h3 style="font-size: 14px; margin-bottom: 6px; color: ${BRAND.primary};">Still missing</h3>
            ${missingHtml}
          </div>
        </div>
      `;
    } else {
      let tasksList = defaultTasks;
      if (remainingTasks.length > 0) {
        tasksList = remainingTasks.map((task, i) => ({
          task,
          time: defaultTasks[i]?.time || 'few min',
        }));
      }

      taskSectionHtml = `
        <div style="background-color: ${BRAND.primaryLight}; padding: 16px; border-radius: 4px; margin: 16px 0;">
          ${tasksList
            .map(
              (item) =>
                `<p style="margin: 8px 0;"><strong>☐</strong> ${item.task} <span style="font-size: 12px; color: ${BRAND.textMuted};">(${item.time})</span></p>`,
            )
            .join('')}
        </div>
      `;
    }

    const progressLabel = typeof completionPercentage === 'number'
      ? `<p style="margin-top: 12px;"><strong>Current progress:</strong> ${completionPercentage}% complete</p>`
      : '';

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: `Let's Complete Your SchoolBase Setup - ${schoolName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <img src="https://schoolbase.live/logo.png" alt="SchoolBase Logo" class="logo" />
                <h1>SchoolBase Setup Reminder</h1>
                <p class="header-subtitle">You're Close to Getting Everything Live</p>
              </div>
              <div class="content">
                <p>Hi ${adminName},</p>
                <p>We noticed you created your SchoolBase workspace but haven't fully set it up yet. We're here to help make it super quick and easy!</p>

                ${progressLabel}
                <h2 style="font-size: 16px; margin-top: 24px;">Setup status</h2>
                ${taskSectionHtml}

                <p style="margin-top: 24px;">Most schools go live in under 30 minutes. And once you're set up, your parents will immediately start paying fees, requesting updates, and getting results instantly from the portal.</p>

                <div class="button-container">
                  <a href="https://schoolbase.live/admin/setup" class="button">Continue Setup</a>
                </div>

                <h2 style="font-size: 16px; margin-top: 24px;">Need Help? We Have:</h2>
                <div class="list-item">Step-by-step setup guide</div>
                <div class="list-item">Video tutorials for each feature</div>
                <div class="list-item">Live chat support (9am-5pm)</div>
                <div class="list-item">Email support</div>

                <div class="warning-box" style="background-color: ${BRAND.primaryLight}; border-left-color: ${BRAND.primary};">
                  <p style="color: ${BRAND.primary};"><strong>Your 7-day free trial is counting down.</strong> Let's get you live!</p>
                </div>

                <p style="margin-top: 32px;">Warm regards,<br><strong>The SchoolBase Team</strong></p>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
                <p class="footer-text"><a href="https://schoolbase.live/help">Help Center</a> | <a href="mailto:support@schoolbase.live">Contact Support</a></p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('Setup reminder email sent to:', email);
    return true;
  } catch (error) {
    console.error('Failed to send setup reminder email:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLATFORM COMMUNICATION EMAIL
// ═══════════════════════════════════════════════════════════════════════════════

export async function sendPlatformCommunicationEmail(
  email: string,
  recipientName: string,
  schoolName: string,
  emailType: string,
  subject: string,
  body: string,
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    // Split body into paragraphs by double newlines
    const paragraphs = body.split('\n\n').filter(p => p.trim());
    const bodyHtml = paragraphs
      .map(p => `<p style="margin: 16px 0; line-height: 1.6;">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <div style="width: 70px; height: 70px; background-color: ${BRAND.surface}; border-radius: 50%; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;">
                  <img src="https://schoolbase.live/logo.png" alt="SchoolBase Logo" style="width: 50px; height: 50px; display: block; margin: auto;">
                </div>
                <h1 style="font-size: 24px; color: ${BRAND.surface};">SchoolBase</h1>
                <p class="header-subtitle">${subject}</p>
              </div>
              <div class="content">
                <p>Hello ${recipientName},</p>
                <p style="font-size: 14px; color: ${BRAND.textMuted};">For: <strong>${schoolName}</strong></p>
                ${bodyHtml}
                <div style="margin-top: 32px; border-top: 1px solid ${BRAND.border}; padding-top: 16px;">
                  <p>Best regards,<br><strong>The SchoolBase Team</strong></p>
                  <p style="font-size: 12px; color: ${BRAND.textMuted}; margin-top: 12px;"><a href="https://schoolbase.live" style="color: ${BRAND.primary}; text-decoration: none;">Visit SchoolBase</a></p>
                </div>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('Platform communication email sent to:', email);
    return true;
  } catch (error) {
    console.error('Failed to send platform communication email:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send subscription payment success email
 */
export async function sendSubscriptionPaymentSuccessEmail(
  email: string,
  schoolName: string,
  adminName: string,
  plan: string,
  amount: string,
  expiryDate: string
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const body = `Thank you for subscribing to SchoolBase! Your payment has been successfully processed and your subscription is now active.

Subscription Details
School: ${schoolName}
Plan: ${plan}
Amount Paid: ${amount}
Expires: ${expiryDate}

Your school now has full access to all SchoolBase features including Admissions, Student Records, Attendance, Fees, Payments, Results, Report Cards, Staff Management, and WhatsApp Communication.

Next Steps
1. Log into your SchoolBase dashboard to get started
2. Configure your school settings and branding
3. Add your staff and students
4. Set up fee schedules and publish results
5. Invite parents to the portal

Our support team is here to help. If you have any questions or need assistance, just reply to this email.`;

    const paragraphs = body.split('\n\n').filter(p => p.trim());
    const bodyHtml = paragraphs
      .map(p => `<p style="margin: 16px 0; line-height: 1.6;">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    const textBody = `${body}\n\nBest regards,\nThe SchoolBase Team`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: `Payment Confirmed – Your SchoolBase subscription is active`,
      text: textBody,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <div style="width: 70px; height: 70px; background-color: ${BRAND.surface}; border-radius: 50%; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;">
                  <img src="https://schoolbase.live/logo.png" alt="SchoolBase Logo" style="width: 50px; height: 50px; display: block; margin: auto;">
                </div>
                <h1 style="font-size: 24px; color: ${BRAND.surface};">SchoolBase</h1>
                <p class="header-subtitle">Payment Confirmed – Your subscription is active</p>
              </div>
              <div class="content">
                <p>Hello ${adminName},</p>
                <p style="font-size: 14px; color: ${BRAND.textMuted};">For: <strong>${schoolName}</strong></p>
                ${bodyHtml}
                <div style="margin-top: 32px; border-top: 1px solid ${BRAND.border}; padding-top: 16px;">
                  <p>Best regards,<br><strong>The SchoolBase Team</strong></p>
                  <p style="font-size: 12px; color: ${BRAND.textMuted}; margin-top: 12px;"><a href="https://schoolbase.live" style="color: ${BRAND.primary}; text-decoration: none;">Visit SchoolBase</a></p>
                </div>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log('Subscription payment success email sent to:', email);
    return true;
  } catch (error) {
    console.error('Failed to send subscription payment success email:', error);
    throw error;
  }
}

/**
 * Send subscription expiry warning email
 */
export async function sendSubscriptionExpiryWarningEmail(
  email: string,
  schoolName: string,
  adminName: string,
  daysRemaining: number,
  expiryDate: string,
  plan: string
) {
  try {
    if (!isValidEmail(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }

    const subject = daysRemaining === 1 
      ? `Urgent: Your SchoolBase subscription expires tomorrow`
      : `Reminder: Your SchoolBase subscription expires in ${daysRemaining} days`;

    const body = `This is a reminder that your SchoolBase ${plan} subscription for ${schoolName} will expire on ${expiryDate} (${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining).

To ensure uninterrupted access to all SchoolBase features, please renew your subscription immediately at https://schoolbase.live/admin/subscription

About Renewal
Renewing takes less than 2 minutes. Your access will continue immediately after payment. After renewal, your subscription will be extended for another month.

If you need assistance or have questions, our support team is available 24/7. Reply to this email or contact support@schoolbase.live`;

    const paragraphs = body.split('\n\n').filter(p => p.trim());
    const bodyHtml = paragraphs
      .map(p => `<p style="margin: 16px 0; line-height: 1.6;">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    const textBody = `${body}\n\nBest regards,\nThe SchoolBase Team`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@schoolbase.live',
      to: email,
      subject: subject,
      text: textBody,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>${EMAIL_STYLES}</style>
          </head>
          <body>
            <div class="email-container">
              <div class="header">
                <div style="width: 70px; height: 70px; background-color: ${BRAND.surface}; border-radius: 50%; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;">
                  <img src="https://schoolbase.live/logo.png" alt="SchoolBase Logo" style="width: 50px; height: 50px; display: block; margin: auto;">
                </div>
                <h1 style="font-size: 24px; color: ${BRAND.surface};">SchoolBase</h1>
                <p class="header-subtitle">${subject}</p>
              </div>
              <div class="content">
                <p>Hello ${adminName},</p>
                <p style="font-size: 14px; color: ${BRAND.textMuted};">For: <strong>${schoolName}</strong></p>
                ${bodyHtml}
                <div style="margin-top: 32px; border-top: 1px solid ${BRAND.border}; padding-top: 16px;">
                  <p>Best regards,<br><strong>The SchoolBase Team</strong></p>
                  <p style="font-size: 12px; color: ${BRAND.textMuted}; margin-top: 12px;"><a href="https://schoolbase.live" style="color: ${BRAND.primary}; text-decoration: none;">Visit SchoolBase</a></p>
                </div>
              </div>
              <div class="footer">
                <p class="footer-text">&copy; 2026 SchoolBase. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    console.log(`Subscription expiry warning email sent to ${email} (${daysRemaining} days remaining)`);
    return true;
  } catch (error) {
    console.error('Failed to send subscription expiry warning email:', error);
    throw error;
  }
}
