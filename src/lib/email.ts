// Sends email via Brevo's HTTPS API. Brevo lets you verify a single sender
// email address (no domain/DNS needed) and still deliver to any recipient
// on the free tier - unlike Resend, which requires a verified domain to
// send to anyone other than your own account email.
export async function sendAlertEmail(to: string, subject: string, body: string) {
  const { BREVO_API_KEY, SMTP_FROM } = process.env;

  if (!BREVO_API_KEY) {
    console.log(`\n[EMAIL - not sent, no BREVO_API_KEY configured]\nTo: ${to}\nSubject: ${subject}\n${body}\n`);
    return { sent: false, simulated: true };
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Notificket", email: SMTP_FROM },
      to: [{ email: to }],
      subject,
      textContent: body,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(`[email] Brevo send failed: HTTP ${res.status} ${errText}`);
    return { sent: false, simulated: false };
  }

  return { sent: true, simulated: false };
}