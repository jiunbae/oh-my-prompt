import { env } from "@/env";
import { logger } from "@/lib/logger";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  success: boolean;
  provider: string;
  /**
   * True only when the message was actually handed off to a real delivery
   * provider. The console fallback logs but does NOT deliver, so it reports
   * `delivered: false` to avoid misleading callers (e.g. alert channel
   * recording) into thinking an email was sent.
   */
  delivered: boolean;
  messageId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Console fallback — never writes private message bodies to production logs
// ---------------------------------------------------------------------------
async function sendViaConsole(options: SendEmailOptions): Promise<EmailResult> {
  logger.warn(
    "[EMAIL NOT DELIVERED] No email provider configured. Set EMAIL_PROVIDER to enable delivery."
  );
  if (env.NODE_ENV !== "production") {
    logger.debug(
      { to: options.to, subject: options.subject, text: options.text },
      "Undelivered development email"
    );
  }
  // Not actually delivered: mark success:false + delivered:false so callers
  // (digest, alert channel recording) do not record a phantom "email sent".
  return {
    success: false,
    provider: "console",
    delivered: false,
    error: "No email provider configured; email was not delivered",
  };
}

// ---------------------------------------------------------------------------
// SMTP via nodemailer
// ---------------------------------------------------------------------------
async function sendViaSmtp(options: SendEmailOptions): Promise<EmailResult> {
  try {
    // nodemailer is an optional dependency — guard against it being absent.
    const nodemailerModule = await import("nodemailer").catch(() => null);
    const nodemailer = nodemailerModule?.default ?? nodemailerModule;
    if (!nodemailer || typeof nodemailer.createTransport !== "function") {
      throw new Error(
        "EMAIL_PROVIDER=smtp requires the 'nodemailer' package, which is not installed. Run `npm install nodemailer` (and `@types/nodemailer`) or choose a different EMAIL_PROVIDER (resend/sendgrid).",
      );
    }
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          }
        : undefined,
    });

    const info = await transporter.sendMail({
      from: env.EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    return { success: true, provider: "smtp", delivered: true, messageId: info.messageId };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown SMTP error";
    logger.error({ err: error, to: options.to }, "SMTP send failed");
    return { success: false, provider: "smtp", delivered: false, error: errMsg };
  }
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------
async function sendViaResend(options: SendEmailOptions): Promise<EmailResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errMsg = data?.message || `Resend HTTP ${response.status}`;
      logger.error({ status: response.status, to: options.to }, "Resend send failed");
      return { success: false, provider: "resend", delivered: false, error: errMsg };
    }

    return {
      success: true,
      provider: "resend",
      delivered: true,
      messageId: data.id,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown Resend error";
    logger.error({ err: error, to: options.to }, "Resend send failed");
    return { success: false, provider: "resend", delivered: false, error: errMsg };
  }
}

// ---------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------
async function sendViaSendGrid(options: SendEmailOptions): Promise<EmailResult> {
  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: env.EMAIL_FROM },
        subject: options.subject,
        content: [
          { type: "text/plain", value: options.text },
          { type: "text/html", value: options.html },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      logger.error({ status: response.status, to: options.to }, "SendGrid send failed");
      return { success: false, provider: "sendgrid", delivered: false, error: text };
    }

    return { success: true, provider: "sendgrid", delivered: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown SendGrid error";
    logger.error({ err: error, to: options.to }, "SendGrid send failed");
    return { success: false, provider: "sendgrid", delivered: false, error: errMsg };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send an email via the configured provider.
 *
 * Providers (in priority order):
 * 1. SMTP (nodemailer) — requires SMTP_HOST
 * 2. Resend — requires RESEND_API_KEY
 * 3. SendGrid — requires SENDGRID_API_KEY
 * 4. Console fallback — logs the email if no provider is configured
 */
export async function sendEmail(options: SendEmailOptions): Promise<EmailResult> {
  const provider = env.EMAIL_PROVIDER;

  switch (provider) {
    case "smtp":
      if (!env.SMTP_HOST) {
        logger.warn("EMAIL_PROVIDER=smtp but SMTP_HOST is not set. Falling back to console.");
        return sendViaConsole(options);
      }
      return sendViaSmtp(options);
    case "resend":
      if (!env.RESEND_API_KEY) {
        logger.warn("EMAIL_PROVIDER=resend but RESEND_API_KEY is not set. Falling back to console.");
        return sendViaConsole(options);
      }
      return sendViaResend(options);
    case "sendgrid":
      if (!env.SENDGRID_API_KEY) {
        logger.warn("EMAIL_PROVIDER=sendgrid but SENDGRID_API_KEY is not set. Falling back to console.");
        return sendViaConsole(options);
      }
      return sendViaSendGrid(options);
    default:
      return sendViaConsole(options);
  }
}
