function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

export function createWelcomeEmail({ name, username, welcomeBonus, siteUrl }) {
    const safeName = escapeHtml(name || username || 'creator');
    const safeUsername = escapeHtml(username ? `@${username.replace(/^@/, '')}` : '');
    const safeSiteUrl = escapeHtml(siteUrl);
    const bonusText = welcomeBonus > 0
        ? `Your <strong>${welcomeBonus.toLocaleString()}-coin welcome bonus</strong> has been added to your available balance.`
        : 'Your EarnTok wallet is ready. Check your available balance for any welcome coins.';

    return {
        subject: `Welcome to EarnTok${welcomeBonus > 0 ? ` — ${welcomeBonus.toLocaleString()} coins are waiting` : ''}`,
        text: `Hi ${name || username || 'creator'},\n\nWelcome to EarnTok! Your account is ready. ${welcomeBonus > 0 ? `Your ${welcomeBonus.toLocaleString()}-coin welcome bonus has been added to your available balance.` : 'Your wallet is ready; there is no welcome bonus currently configured.'}\n\nWatch videos, find creators, and share what you love.\n\nOpen EarnTok: ${siteUrl}\n\nSee you in the feed,\nThe EarnTok team`,
        html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#161823">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f6f8;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border-radius:18px;overflow:hidden">
        <tr><td style="height:7px;background:linear-gradient(90deg,#25f4ee 0%,#25f4ee 48%,#fe2c55 52%,#fe2c55 100%)"></td></tr>
        <tr><td style="padding:30px 34px 14px">
          <p style="margin:0;color:#161823;font-size:22px;font-weight:800;letter-spacing:-.5px">EarnTok<span style="color:#fe2c55">.</span></p>
          <p style="margin:30px 0 8px;color:#161823;font-size:28px;line-height:1.2;font-weight:800">You’re in, ${safeName}!</p>
          ${safeUsername ? `<p style="margin:0;color:#777782;font-size:14px">${safeUsername}</p>` : ''}
          <p style="margin:22px 0 0;color:#454550;font-size:16px;line-height:1.65">Welcome to your new corner of EarnTok. Discover creators, watch the latest videos, and share the moments you love.</p>
        </td></tr>
        <tr><td style="padding:10px 34px 24px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7fbfc;border:1px solid #e5f4f5;border-radius:14px">
            <tr><td style="padding:20px 22px">
              <p style="margin:0 0 8px;color:#161823;font-size:15px;font-weight:700">Your welcome bonus</p>
              <p style="margin:0;color:#454550;font-size:14px;line-height:1.6">${bonusText}</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:0 34px 30px">
          <a href="${safeSiteUrl}" style="display:inline-block;padding:14px 26px;border-radius:10px;background:#fe2c55;color:#fff;text-decoration:none;font-size:15px;font-weight:700">Open EarnTok</a>
        </td></tr>
        <tr><td style="padding:20px 34px;background:#fafafa;border-top:1px solid #eee">
          <p style="margin:0;color:#777782;font-size:12px;line-height:1.6">You’re receiving this message because you created an EarnTok account. Keep your account safe and never share your password or verification codes.</p>
          <p style="margin:12px 0 0;color:#777782;font-size:12px">See you in the feed,<br><strong style="color:#454550">The EarnTok team</strong></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    };
}
