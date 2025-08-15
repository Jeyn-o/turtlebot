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
  console.log('📡 fetchApiData() called');

  try {
    const response1 = await fetch(`https://api.torn.com/v2/faction/crimes?cat=planning&offset=0&sort=DESC&key=${apiKey}&comment=autoturtle`);
    const data1 = await response1.json();

    const response2 = await fetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${apiKey}&comment=autoturtle`);
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
  if (!channel) return;

  const scanMsg = await channel.send(`🔍 Scanning for delayed or undersupplied OCs...`);

  let issuesFound = false;

  ocdata.crimes.forEach(crime => {
    // 1. Delayed crime
    if (isEpochInPast(crime.ready_at) && crime.ready_at === null) {
      issuesFound = true;

      let slackers = [];
      crime.slots.forEach(member => {
        const name = getMemberName(member.user.id);
        const entry = memberdata.members.find(m => m.id === member.user.id);
        if (entry.status.description !== "Okay") {
          slackers.push(name);
        }
      });

      channel.send(`⏳ **${crime.name}** is being delayed by: ${slackers.join(', ')}`);
    }

    // 2. Missing item requirement
    if (isEpochInNext24Hours(crime.ready_at)) {
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

      if (emptys.length !== 0) {
        issuesFound = true;

        const names = emptys.map(id => {
          const member = memberdata.members.find(m => m.id === id);
          return member ? member.name : null;
        });

        channel.send(`📦 **${crime.name}** has users with missing items: ${names.join(', ')}`);
      }
    }
  });

  // Final message handling
  if (!issuesFound) {
    await scanMsg.edit('✅ All OCs look good!');
  } else {
    await scanMsg.delete(); // Remove the "Scanning..." message if alerts were sent
  }
}



client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  let jobRunning = false;

const job = new CronJob(
  '*/10 * * * *',
  async () => {
    if (jobRunning) return;  // skip if still running
    jobRunning = true;

    try {
      console.log('Running scheduled API call...');
      const guild = client.guilds.cache.first();
      const channel = guild.channels.cache.get(process.env.CHANNEL_ID);
      if (!channel) {
        console.error('Target channel not found!');
        return;
      }

      await fetchApiData();
      await process1(channel);
    } finally {
      jobRunning = false;
    }
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
    const data = await fetchApiData();
    await process1(message.channel); // ✅ explicitly call with correct channel

    if (data) {
      message.channel.send('✅ Manual API call done!');
    }

  }
});


client.login(process.env.TOKEN);













