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

const itemidlist = {
//Tools
568 :  "Jemmy",
1362:  "Net",
1203:  "Lockpicks",
1350:  "Police Badge",
1383:  "DSLR Camera",
1380:  "RF Detector",
643 :  "Construction Helmet",
1258:  "Binoculars",
981 :  "Wire Cutters",
159 :  "Bolt Cutters",
1284:  "Dental Mirror",
1080:  "Billfold",
1331:  "Hand Drill",
//Materials
1361:  "Dog Treats",
1381:  "ID Badge",
1379:  "ATM Key",
172 :  "Gasoline",
201 :  "PCP",
1429:  "Zip Ties",
73  :  "Stealth Virus",
856 :  "Spray Paint : Black",
576 :  "Chloroform",
222 :  "Flash Grenade",
190 :  "C4 Explosive",
1431:  "Core Drill",
1430:  "Shaped Charge",
103 :  "Firewalk Virus",
226 :  "Smoke Grenade",
1012 : "Irradiated Blood Bag",
1094 : "Syringe",
70   : "Polymorphic Virus"
};

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

    /*if (isEpochInNext24Hours(crime.ready_at)) {
      const missing = crime.slots
        .filter(m => m.item_requirement && !m.item_requirement.is_available)
        .map(m => `${getMemberName(m.user.id)}: Item ${m.item_requirement.id}`);
      if (missing.length)
        missingFields.push({
          name: `${crime.name} (${formatEpochDelta(crime.ready_at)})`,
          value: `Missing items: ${missing.join(', ')}`,
        });
    }*/
    if (isEpochInNext24Hours(crime.ready_at)) {
  const missing = crime.slots
    .filter(m => m.item_requirement && !m.item_requirement.is_available && m.user)
    .map(m => {
      const memberName = getMemberName(m.user.id);
      const itemName = itemidlist[m.item_requirement.id] || m.item_requirement.id;
      return `${memberName}: ${itemName}`;
    });

  if (missing.length) {
    missingFields.push({
      name: `${crime.name} (${formatEpochDelta(crime.ready_at)})`,
      value: `Missing items: ${missing.join(', ')}`,
    });
  }
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

 /*const buttonRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('ping_opt_in')
    .setLabel('🔔 Ping Me')
    .setStyle(ButtonStyle.Success),

  new ButtonBuilder()
    .setCustomId('ping_opt_out')
    .setLabel('🔕 Unsubscribe')
    .setStyle(ButtonStyle.Danger)
);*/


  // Send or update the status message in the channel
  if (!statusMessage || !statusMessage.editable) {
    statusMessage = await channel.send({
      embeds: [embed],
      components: []
    });
  } else {
    await statusMessage.edit({
      embeds: [embed],
      components:[]
    });
  }

  console.log(`📤 Embed updated at ${new Date().toISOString()}`);
} //WIP

// ------------ INTERACTION HANDLER --------------
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

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

//Daily summary
  //const dailyJob = new CronJob('0 1 * * *', dailyTask, null, true, 'UTC'); 
const dailyJob = new CronJob('0 1 * * *', () => dailyTask(channel), null, true, 'UTC');
// Cron format: 'minute hour day-of-month month day-of-week'
// Here: 0 8 * * * → 08:00 UTC daily


  
  job.start();
  console.log('🕒 Cron job started: Every 10 minutes');
});
  

const prefix = '!';
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  if (command === 'daily') {
  const guild = client.guilds.cache.first(); // or use a specific guild ID
  const channel = guild.channels.cache.get(process.env.CHANNEL_ID);
  if (!channel) return message.reply('❌ Channel not found');
  await dailyTask(channel);
  message.reply('Daily summary sent!');
  }



  
  if (command === 'a' || command === 'alias') {
    if (args.length === 0) {
      return message.reply('Missing IDs or names');
    }

    // --- Fetch JSON from GitHub ---
    let data;
    try {
      const response = await fetch('https://raw.githubusercontent.com/Jeyn-o/OC_Stalker/refs/heads/main/BC_names.JSON');
      data = await response.json();
    } catch (err) {
      console.error(err);
      return message.reply('Failed to load data file.');
    }

    // --- Build lookup maps ---
    const idToNames = {};
    const nameToId = new Map();

    for (const [id, names] of Object.entries(data)) {
      // Remove "Former Member"
      const cleanNames = names.filter(name => name.toLowerCase() !== 'former member');
      if (cleanNames.length === 0) continue;

      idToNames[id] = cleanNames;

      for (const name of cleanNames) {
        nameToId.set(name.toLowerCase(), id);
      }
    }

    // --- Process user inputs ---
    const results = [];

    for (const key of args) {
      const lowerKey = key.toLowerCase();

      // ✅ Exact ID match
      if (idToNames[lowerKey]) {
        const names = idToNames[lowerKey];
        results.push(`${lowerKey}: ${names.join(', ')}`);
        continue;
      }

      // ✅ Exact name match (case-insensitive)
      if (nameToId.has(lowerKey)) {
        const id = nameToId.get(lowerKey);
        const names = idToNames[id];
        results.push(`${id}: ${names.join(', ')}`);
        continue;
      }

      // ✅ Case-insensitive partial match
      const partialMatches = [];

      for (const [id, names] of Object.entries(idToNames)) {
        for (const name of names) {
          if (name.toLowerCase().includes(lowerKey)) {
            // Add this ID once (with all its aliases)
            if (!partialMatches.find(pm => pm.id === id)) {
              partialMatches.push({ id, names });
            }
            break;
          }
        }
      }

      // ✅ Format results
      if (partialMatches.length === 0) {
        results.push(`No match found for \`${key}\``);
      } else if (partialMatches.length === 1) {
        const { id, names } = partialMatches[0];
        results.push(`Closest match: ${id}: ${names.join(', ')}`);
      } else {
        const formatted = partialMatches
          .map(pm => `${pm.id}: ${pm.names.join(', ')}`)
          .join('\n');
        results.push(`Closest matches:\n${formatted}`);
      }
    }

    // --- Send formatted reply ---
    const replyText = results.join('\n\n');
    message.reply(replyText);
  }
});


// ------------DAily summary ----------
async function dailyTask(channel) {
  console.log('Running daily task at', new Date().toLocaleString());

  const targetPosition = 'baby';
  const targetDays = 3;

  try {
    const response = await fetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${process.env.API_KEY}`);
    const data = await response.json();

    if (data.error) {
      console.error('API returned an error:', data.error);
      return;
    }

    const members = data.members;

    const positionMatches = [];
    const notInOC = [];
    const inFederalJail = [];
    const offlineLong = [];

    members.forEach(member => {
      if (member.position.toLowerCase() === targetPosition.toLowerCase()) {
        positionMatches.push(member.name);
      }

      if (!member.is_in_oc) {
        notInOC.push(member.name);
      }

      if (member.status.state.toLowerCase() === 'federal') {
        inFederalJail.push(member.name);
      }

        // Check if last_action.relative mentions days
    const match = member.last_action.relative.match(/(\d+)\s*days?/i);
    if (match) {
      const daysAgo = parseInt(match[1], 10);
      if (daysAgo >= targetDays) {
        offlineLong.push(member.name);
      }
    }
    });

    const results = [];

    if (positionMatches.length) {
      results.push(`${targetPosition}s: ${positionMatches.length}\nNames: ${positionMatches.join(', ')}`);
    }

    if (notInOC.length) {
      results.push(`Not in OC: ${notInOC.length}\nNames: ${notInOC.join(', ')}`);
    }

    if (inFederalJail.length) {
      results.push(`Fedded: ${inFederalJail.length}\nNames: ${inFederalJail.join(', ')}`);
    }

    if (offlineLong.length) {
      results.push(`Offline for ${targetDays} or more: ${offlineLong.length}\nNames: ${offlineLong.join(', ')}`);
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dayLabel = yesterday.toLocaleDateString(); // e.g., "11/3/2025"

   if (results.length === 0) {
      await channel.send(`End of Day ${dayLabel} \n--- Daily Summary ---\nAll good`);
    } else {
      const summaryMessage = results.join('\n\n');
      await channel.send(`End of Day ${dayLabel} \n--- Daily Summary ---\n${summaryMessage}`);
    }

  } catch (err) {
    console.error('Error fetching API data:', err);
  }
}




// ------------ LOGIN --------------
client.login(process.env.TOKEN);





