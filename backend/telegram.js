const https = require('https');

async function sendTelegramAlert(location) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    return; // Telegram notifications not configured, skip silently
  }

  const { deviceId, latitude, longitude, accuracy, batteryPct, isCharging } = location;
  const timeStr = new Date(location.timestamp).toLocaleTimeString();
  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;

  const message = [
    `📍 *Family Safety Location Update*`,
    `*Device:* \`${deviceId}\``,
    `*Time:* ${timeStr}`,
    `*Coordinates:* ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${Math.round(accuracy)}m)`,
    `*Battery:* ${batteryPct}% ${isCharging ? '⚡ (Charging)' : ''}`,
    `🔗 [View on Google Maps](${mapsUrl})`
  ].join('\n');

  const postData = JSON.stringify({
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown',
    disable_web_page_preview: false
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${botToken}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', (err) => {
      console.warn('[Telegram] Could not send alert:', err.message);
      resolve(false);
    });
    req.write(postData);
    req.end();
  });
}

module.exports = { sendTelegramAlert };
