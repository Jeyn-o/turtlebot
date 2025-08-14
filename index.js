const apiKey = process.env.API_KEY;
const { Client, GatewayIntentBits } = require('discord.js');
const { CronJob } = require('cron');
const fetch = require('node-fetch'); // If on Node 18+, fetch is built-in

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Schedule the job for 20:00 UTC every day (no DST adjustments)
  const job = new CronJob(
    '0 20 * * *', // At 20:00 every day
    async () => {
      console.log('Running scheduled API call at 20:00 UTC (fixed time)');

      try {
        // Example API call (replace with your actual API URL and headers)
        const response = await fetch('https://api.torn.com/v2/faction/crimes?cat=planning&offset=0&sort=DESC', {
          headers: {
            'Authorization': `Bearer ${process.env.API_KEY}`
          }
        });
        const data = await response.json();
        console.log('API response:', data);

        // Example: send to a Discord channel
        // const channel = client.channels.cache.get('YOUR_CHANNEL_ID');
        // if (channel) channel.send(`API Data: ${JSON.stringify(data)}`);

      } catch (error) {
        console.error('Error during API call:', error);
      }
    },
    null,
    true,
    'UTC' // Timezone fixed to UTC, no DST
  );

  job.start();
});

client.login(process.env.TOKEN);



