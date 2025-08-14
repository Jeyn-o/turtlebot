const apiKey = process.env.API_KEY;
const { Client, GatewayIntentBits } = require('discord.js');
const { CronJob } = require('cron');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const port = process.env.PORT || 4000; //fake port?


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function fetchApiData(message = null) {
  try {
    const response = await fetch(`https://api.torn.com/v2/faction/crimes?cat=planning&offset=0&sort=DESC&key=${apiKey}`);
    const data = await response.json();

    if (data.error) {
      console.error('API error:', data.error);
      if (message) {
        message.channel.send(`❌ API Error: ${data.error}`);
      }
      return null;
    }

    return data;

  } catch (error) {
    console.error('Error during API call:', error);
    if (message) {
      message.channel.send('❌ Failed to fetch data. Check logs.');
    }
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
  if (message.author.bot) return;
  if (message.content === '!manual') {
    console.log('Manual command received');
    const data = await fetchApiData(message);

    if (data) {
      message.channel.send('✅ Manual API call done!');
    }
  }
});


client.login(process.env.TOKEN);




