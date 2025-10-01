// index.js

console.log(`Bot starting. IS_PRIMARY: ${process.env.IS_PRIMARY}`);
if (process.env.IS_PRIMARY !== 'true') {
  console.log('🔁 Not primary instance, exiting...');
  process.exit(0);
}

const express = require('express');
const app = express();
const port = process.env.PORT || 4000;

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(port, () => {
  console.log(`Web server running on port ${port}`);
});

// ------------ PING LIST SETUP --------------
const fs = require('fs');
const PING_FILE = './pinglist.json';
let pingList = new Set();

function loadPingList() {
  try {
    const data = fs.readFileSync(PING_FILE, 'utf-8');
    pingList = new Set(JSON.parse(data));
  } catch {
    pingList = new Set();
  }
}

function savePingList() {
  fs.writeFileSync(PING_FILE, JSON.stringify([...pingList]), 'utf-8');
}

loadPingList(); // Load on startup

// ------------ DISCORD + CRON SETUP --------------
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const { CronJob } = require('cron');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const apiKey = process.env.API_KEY;
let statusMessage = null;
let ocdata = null;
let memberdata = null;

// ------------ UTILITIES --------------
function formatEpochDelta(unixEpoch) {
  const currentEpoch = Math.floor(Date.now() / 1000);
  let delta = unixEpoch - currentEpoch;
  const isFuture = delta > 0;
  delta = Math.abs(delta);

  const days = Math.floor(delta / 86400);
  const hours = Math.floor((delta % 86400) / 3600);
  const minutes = Math.floor((delta % 3600) / 60);

  let formatted;
  if (days > 0) formatted = `${days}d ${String(hours).padStart(2, '0')}h${String(minutes).padStart(2, '0')}m`;
  else if (hours > 0) formatted = `${String(hours).padStart(2, '0')}h${String(minutes).padStart(2, '0')}m`;
  else formatted = `${minutes}m`;

  return isFuture ? `${formatted} left` : `for ${formatted}`;
}

function isEpochInPast(epoch) {
  return epoch < Math.floor(Date.now() / 1000);
}
function isEpochInNext24Hours(epoch) {
  const now = Math.floor(Date.now() / 1000);
  return epoch >= now && epoch <= now + 86400;
}

function getMemberName(id) {
  const member = memberdata?.members?.find(m => m.id === id);
  return member ? member.name : 'Unknown';
}

// ------------ API FETCH --------------
async function fetchApiData() {
  try {
    const ocRes = await fetch(`https://api.torn.com/v2/faction/crimes?cat=planning&key=${apiKey}`);
    const memberRes = await fetch(`https://api.torn.com/v2/faction/members?key=${apiKey}&striptags=true`);

    const ocJson = await ocRes.json();
    const memberJson = await memberRes.json();

    if (ocJson.error || memberJson.error) throw new Error('API returned an error');

    ocdata = ocJson;
    memberdata = memberJson;
    return true;
  } catch (err) {
    console.error('❌ Error fetching API data:', err);
    return false;
  }
}

// ------------ EMBED UPDATE --------------
async function updateEmbed(channel) {
  const delayedFields = [];
  const missingFields = [];

  ocdata.crimes.forEach(crime => {
    if (isEpochInPast(crime.ready_at) && !crime.executed_at) {
      const slackers = crime.slots
        .filter(m => {
          const user = memberdata.members.find(u => u.id === m.user.id);
          return user?.status?.description !== 'Okay';
        })
        .map(m => getMemberName(m.user.id));

      delayedFields.push({
        name: crime.name,
        value: `Delayed ${formatEpochDelta(crime.ready_at)} by: ${slackers.join(', ') || 'Unknown'}`,
      });
    }

    if (isEpochInNext24Hours(crime.ready_at)) {
      const missing = crime.slots
        .filter(m => m.item_requirement && !m.item_requirement.is_available)
        .map(m => `${getMemberName(m.user.id)}: Item ${m.item_requirement.id}`);
      if (missing.length)
        missingFields.push({
          name: `${crime.name} (${formatEpochDelta(crime.ready_at)})`,
          value: `Missing items: ${missing.join(', ')}`,
        });
    }
  });

  const embed = {
    color: 0x0099ff,
    author: {
      name: 'Turtlebot',
      icon_url: 'https://avatars.torn.com/48X48_5e865e1c-2ab2-f5d7-2419133.jpg',
    },
    fields: [...delayedFields, ...missingFields],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Turtlebot Status Report',
    },
  };

 const buttonRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('ping_opt_in')
    .setLabel('🔔 Ping Me')
    .setStyle(ButtonStyle.Success),

  new ButtonBuilder()
    .setCustomId('ping_opt_out')
    .setLabel('🔕 Unsubscribe')
    .setStyle(ButtonStyle.Danger)
);


  // Send or update the status message in the channel
  if (!statusMessage || !statusMessage.editable) {
    statusMessage = await channel.send({
      embeds: [embed],
      components: [buttonRow]
    });
  } else {
    await statusMessage.edit({
      embeds: [embed],
      components: [buttonRow]
    });
  }

  console.log(`📤 Embed updated at ${new Date().toISOString()}`);

  // Send DMs to opted-in users
  for (const userId of pingList) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        content: '🔔 **Turtlebot Update**: There are new OC status changes.',
        embeds: [embed]
      });
      console.log(`📨 DM sent to ${user.tag}`);
    } catch (err) {
      console.warn(`⚠️ Could not DM user ${userId}: ${err.message}`);
    }
  }
}


// ------------ INTERACTION HANDLER --------------
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

  if (interaction.customId === 'ping_opt_in') {
    if (pingList.has(userId)) {
      await interaction.reply({
        content: '✅ You are already subscribed to pings.',
        ephemeral: true
      });
    } else {
      pingList.add(userId);
      savePingList();
      await interaction.reply({
        content: '🔔 You’ve been added to the ping list!',
        ephemeral: true
      });
    }
  }

  if (interaction.customId === 'ping_opt_out') {
    if (!pingList.has(userId)) {
      await interaction.reply({
        content: 'ℹ️ You are not currently subscribed.',
        ephemeral: true
      });
    } else {
      pingList.delete(userId);
      savePingList();
      await interaction.reply({
        content: '🔕 You’ve been removed from the ping list.',
        ephemeral: true
      });
    }
  }
});


// ------------ READY + CRON --------------
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.first();
  const channel = guild.channels.cache.get(process.env.CHANNEL_ID);
  if (!channel) return console.error('❌ Channel not found');

  const job = new CronJob('*/10 * * * *', async () => {
    if (await fetchApiData()) {
      await updateEmbed(channel);
    }
  });

  job.start();
  console.log('🕒 Cron job started: Every 10 minutes');
});

// ------------ LOGIN --------------
client.login(process.env.TOKEN);

