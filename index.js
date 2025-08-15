const apiKey = process.env.API_KEY;
const { Client, GatewayIntentBits } = require('discord.js');
const { CronJob } = require('cron');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const port = process.env.PORT || 4000; //fake port?
let ocdata;
let memberdata;


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function fetchApiData(message = null) {
  try {
    const response1 = await fetch(`https://api.torn.com/v2/faction/crimes?cat=planning&offset=0&sort=DESC&key=${apiKey}`);
    const data1 = await response1.json();

    const response2 = await fetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${apiKey}`);
    const data2 = await response2.json();

    if (data1.error) {
      console.error('API error:', data1.error);
      if (message) {
        message.channel.send(`❌ API Error: ${data1.error}`);
      }
      return null;
    }
    if (data2.error) {
      console.error('API error:', data2.error);
      if (message) {
        message.channel.send(`❌ API Error: ${data2.error}`);
      }
      return null;
    }
    ocdata=data1;
    memberdata=data2;
    process1();
    return data1;

  } catch (error) {
    console.error('Error during API call:', error);
    if (message) {
      message.channel.send('❌ Failed to fetch data. Check logs.');
    }
    return null;
  }
}

function isEpochInPast(unixEpoch) {
  const currentEpoch = Math.floor(Date.now() / 1000); // current time in seconds
  return unixEpoch < currentEpoch;
}

function isEpochInNext24Hours(unixEpoch) {
  const currentEpoch = Math.floor(Date.now() / 1000); // current time in seconds
  const next24hEpoch = currentEpoch + 24 * 60 * 60;   // 24 hours from now in seconds

  return unixEpoch >= currentEpoch && unixEpoch <= next24hEpoch;
}

function getMemberName(id) {
  const member = memberdata.members.find(m => m.id === id);
  return member ? member.name : null; // or return "Not found"
}

async function process1(channel = null) {
  if (channel) {
    channel.send(`Scanning for delayed or undersupplied OCs...`);
  }

  ocdata.crimes.forEach(crime => {
    if (isEpochInPast(crime.ready_at) && crime.ready_at === null) {
      // delayed
      let slackers = [];
      crime.slots.forEach(member => {
        const name = getMemberName(member.user.id);
        const entry = memberdata.members.find(m => m.id === member.user.id);
        if (entry.status.description !== "Okay") {
          slackers.push(name);
        }
      });

      if (channel) {
        channel.send(`${crime.name} is being delayed by: ${slackers.join(', ')}`);
      }
    }

    if (isEpochInNext24Hours(crime.ready_at)) {
      // coming up
      let emptys = [];
      crime.slots.forEach(member => {
        if (
          member.item_requirement &&
          !member.item_requirement.is_available &&
          member.user
        ) {
          emptys.push(member.user.id);
        }
      });

      if (emptys.length !== 0 && channel) {
        const names = emptys.map(id => {
          const member = memberdata.members.find(m => m.id === id);
          return member ? member.name : null;
        });

        channel.send(`${crime.name} has users with missing items: ${names.join(', ')}`);
      }
    }
  });
}


client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  const job = new CronJob(
    '*/10 * * * *', // every 10 minutes
    async () => {
      console.log('Running scheduled API call...');
      const guild = client.guilds.cache.first(); // or use a specific ID
      const channel = guild.channels.cache.get(process.env.CHANNEL_ID); // set this in your .env
      if (!channel) {
        console.error('Target channel not found!');
        return;
      }

      await fetchApiData();     // fetches and sets ocdata & memberdata
      await process1(channel);  // pass the channel for messaging
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










