const apiKey = process.env.API_KEY;
const { Client, GatewayIntentBits } = require('discord.js');
const { CronJob } = require('cron');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function fetchApiData() {
  try {
    const response = await fetch('https://api.torn.com/v2/faction/crimes?cat=planning&offset=0&sort=DESC', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    const data = await response.json();
    console.log('API response:', data);
    return data;
  } catch (error) {
    console.error('Error during API call:', error);
    return null;
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  const job = new CronJob(
    '0 20 * * *',
    async () => {
      console.log('Running scheduled API call at 20:00 UTC (fixed time)');
      await fetchApiData();
      // You can also send a scheduled message here if you want
    },
    null,
    true,
    'UTC'
  );

  job.start();
});

// Listen for !manual command
client.on('messageCreate', async (message) => {
  if (message.author.bot) return; // Ignore bot messages
  if (message.content === '!manual') {
    console.log('Manual command received');
    const data = await fetchApiData();
    if (data) {
      // Reply in Discord channel with a summary or confirmation
      message.channel.send('Manual API call done! Check console for data.');
      
      // Or send some specific data from API, e.g.:
      // message.channel.send(`Faction crimes planning count: ${data.crimes.length}`);
    } else {
      message.channel.send('Failed to fetch data. See logs for details.');
    }
  }
});

client.login(process.env.TOKEN);

