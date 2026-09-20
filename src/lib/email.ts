// Sends email over Resend's HTTPS API instead of raw SMTP, because Railway's
// free/Hobby plan blocks outbound SMTP ports (25/465/587) at the network
// level - connections to smtp.gmail.com just hang until nodemailer times out.
// An HTTPS API call is a normal web request, so it isn't affected.
//
// If RESEND_API_KEY isn't set, we just log the "email" to the console instead
// of failing - so the app works fully out of the box with zero setup.
export async function sendAlertEmail(to: string, subject: string, body: string) {
  const { RESEND_API_KEY, SMTP_FROM } = process.env;

  if (!RESEND_API_KEY) {
    console.log(`\n[EMAIL - not sent, no RESEND_API_KEY configured]\nTo: ${to}\nSubject: ${subject}\n${body}\n`);
    return { sent: false, simulated: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: SMTP_FROM || "onboarding@resend.dev",
      to,
      subject,
      text: body,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(`[email] Resend send failed: HTTP ${res.status} ${errText}`);
    return { sent: false, simulated: false };
  }

  return { sent: true, simulated: false };
}