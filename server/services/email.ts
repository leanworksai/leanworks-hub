import nodemailer from 'nodemailer';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Cache for email credentials to avoid repeated Secret Manager calls
let cachedEmailCredentials: { email: string; password: string } | null = null;
let emailCredentialsCacheTime: number = 0;
const EMAIL_CREDENTIALS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for nodemailer transporter
let cachedTransporter: nodemailer.Transporter | null = null;

// Get email credentials from Secret Manager
async function getEmailCredentials(
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
): Promise<{ email: string; password: string }> {
  // Return cached credentials if still valid
  if (cachedEmailCredentials && Date.now() - emailCredentialsCacheTime < EMAIL_CREDENTIALS_CACHE_TTL) {
    return cachedEmailCredentials;
  }

  try {
    // Fetch email address
    const emailSecretName = `projects/${projectId}/secrets/email-address/versions/latest`;
    const [emailVersion] = await secretManagerClient.accessSecretVersion({ name: emailSecretName });
    const email = emailVersion.payload?.data?.toString()?.trim() || '';

    // Fetch email password
    const passwordSecretName = `projects/${projectId}/secrets/email-password/versions/latest`;
    const [passwordVersion] = await secretManagerClient.accessSecretVersion({ name: passwordSecretName });
    const password = passwordVersion.payload?.data?.toString()?.trim() || '';

    if (!email || !password) {
      throw new Error('Email credentials are incomplete');
    }

    cachedEmailCredentials = { email, password };
    emailCredentialsCacheTime = Date.now();
    console.log('✅ Email credentials fetched from Secret Manager');
    return cachedEmailCredentials;
  } catch (error: any) {
    console.error('❌ Failed to fetch email credentials from Secret Manager:', error);
    throw new Error(`Failed to fetch email credentials: ${error.message}`);
  }
}

// Create or get nodemailer transporter
async function getTransporter(
  secretManagerClient: SecretManagerServiceClient,
  projectId: string
): Promise<nodemailer.Transporter> {
  // Return cached transporter if credentials are still valid
  if (cachedTransporter && cachedEmailCredentials && Date.now() - emailCredentialsCacheTime < EMAIL_CREDENTIALS_CACHE_TTL) {
    return cachedTransporter;
  }

  const credentials = await getEmailCredentials(secretManagerClient, projectId);

  // Microsoft 365 SMTP settings (for GoDaddy Microsoft 365 email)
  cachedTransporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // STARTTLS
    auth: {
      user: credentials.email,
      pass: credentials.password,
    },
    tls: {
      ciphers: 'SSLv3',
      rejectUnauthorized: false,
    },
  });

  // Verify connection
  try {
    await cachedTransporter.verify();
    console.log('✅ Email transporter connection verified');
  } catch (verifyError: any) {
    console.error('⚠️ Email transporter verification failed:', verifyError.message);
    // Don't throw - connection might still work for sending
  }

  return cachedTransporter;
}

// Email template for verification
function getVerificationEmailHtml(firstName: string, verificationLink: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - Leanworks</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #18181b;">
                🚀 Leanworks
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 20px 40px;">
              <h2 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 600; color: #18181b;">
                Verify your email address
              </h2>
              <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #52525b;">
                Hi ${firstName},
              </p>
              <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #52525b;">
                Thanks for signing up for Leanworks! Please verify your email address by clicking the button below.
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 16px 0; text-align: center;">
                    <a href="${verificationLink}" 
                       style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 24px 0 16px 0; font-size: 14px; line-height: 1.6; color: #71717a;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #3b82f6; word-break: break-all;">
                ${verificationLink}
              </p>
              
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.6; color: #71717a;">
                This link will expire in <strong>24 hours</strong>.
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #71717a;">
                If you didn't create an account with Leanworks, you can safely ignore this email.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #a1a1aa; text-align: center;">
                © ${new Date().getFullYear()} Leanworks. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

// Plain text version of the email
function getVerificationEmailText(firstName: string, verificationLink: string): string {
  return `
Verify your email address

Hi ${firstName},

Thanks for signing up for Leanworks! Please verify your email address by clicking the link below:

${verificationLink}

This link will expire in 24 hours.

If you didn't create an account with Leanworks, you can safely ignore this email.

© ${new Date().getFullYear()} Leanworks. All rights reserved.
`.trim();
}

// Auto-detect environment and get the appropriate frontend URL
function getFrontendUrl(): string {
  // Explicit override takes priority
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL;
  }
  
  // Only use localhost if explicitly in development mode
  // (NODE_ENV is exactly 'development')
  if (process.env.NODE_ENV === 'development') {
    // Vite dev server port (configured in vite.config.ts)
    return 'http://localhost:8080';
  }
  
  // Default to production URL (safer for GKE/production deployments)
  return 'https://leanworks.ai';
}

// Send verification email
export async function sendVerificationEmail(
  secretManagerClient: SecretManagerServiceClient,
  projectId: string,
  toEmail: string,
  firstName: string,
  verificationToken: string
): Promise<void> {
  const transporter = await getTransporter(secretManagerClient, projectId);
  const credentials = await getEmailCredentials(secretManagerClient, projectId);

  // Construct verification link with auto-detected URL
  const baseUrl = getFrontendUrl();
  const verificationLink = `${baseUrl}/verify-email?token=${verificationToken}`;
  
  console.log(`📧 Sending verification email with link: ${verificationLink.substring(0, 50)}...`);

  const mailOptions = {
    from: {
      name: 'Leanworks',
      address: credentials.email,
    },
    to: toEmail,
    subject: 'Verify your email address - Leanworks',
    text: getVerificationEmailText(firstName, verificationLink),
    html: getVerificationEmailHtml(firstName, verificationLink),
  };

  try {
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Verification email sent to ${toEmail}:`, result.messageId);
  } catch (error: any) {
    console.error(`❌ Failed to send verification email to ${toEmail}:`, error);
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
}

// Clear cached transporter (useful for testing or credential rotation)
export function clearEmailCache(): void {
  cachedTransporter = null;
  cachedEmailCredentials = null;
  emailCredentialsCacheTime = 0;
}

