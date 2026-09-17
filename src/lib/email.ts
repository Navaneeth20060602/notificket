import nodemailer from "nodemailer";

// If SMTP env vars aren't set, we just log the "email" to the console instead
// of failing - so the app works fully out of the box with zero setup.
// Fill in .env with real SMTP creds (e.g. from Resend, Gmail app password, etc.)
// once you're ready to send real emails.
export async function sendAlertEmail(to: string, subject: string, body: string) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log(`\n[EMAIL - not sent, no SMTP configured]\nTo: ${to}\nSubject: ${subject}\n${body}\n`);
    return { sent: false, simulated: true };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject,
    text: body,
  });

  return { sent: true, simulated: false };
}
