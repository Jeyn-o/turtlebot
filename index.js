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
70   : "Polymorphic Virus",
71   : "Tunneling Virus"
};


// Global variable to track last time checkRevs ran
let lastCheckRevsTime = 0;
const CHECK_REVS_COOLDOWN = 60 * 1000; // 60 seconds

function formatDateTime(timezone = 'UTC') {
  const now = new Date();

  // Options for date and time parts
  const options = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  };

  // Format parts individually
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);

  const lookup = {};
  for (const { type, value } of parts) {
    lookup[type] = value;
  }

  return `${lookup.year}/${lookup.month}/${lookup.day} ${lookup.hour}:${lookup.minute}`;
}

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

// ------------ STOCK OBSERVER SETUP --------------
const STOCK_MEMORY_FILE = './stocks-memory.json';

let stockMemory = {
  stocks: {}, // stock_id -> history[]
  lastUpdated: 0
};

function loadStockMemory() {
  try {
    stockMemory = JSON.parse(fs.readFileSync(STOCK_MEMORY_FILE, 'utf8'));
    console.log('📈 Stock memory loaded');
  } catch {
    console.log('📈 No stock memory found, starting fresh');
  }
}

function saveStockMemory() {
  try {
    fs.writeFileSync(
      STOCK_MEMORY_FILE,
      JSON.stringify(stockMemory, null, 2),
      'utf8'
    );
  } catch (err) {
    console.error('❌ Failed to save stock memory:', err.message);
  }
}


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

// ------------ GITHUB MEMORY --------------

const GITHUB_API = 'https://api.github.com';

async function loadStockMemoryFromGitHub() {
  const url = `${GITHUB_API}/repos/${process.env.SO_GITHUB_OWNER}/${process.env.SO_GITHUB_REPO}/contents/${process.env.SO_GITHUB_PATH}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.SO_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json'
    }
  });

  if (!res.ok) {
    throw new Error(`GitHub load failed: ${res.status}`);
  }

  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');

  stockMemory = JSON.parse(content);
  stockMemory._sha = data.sha; // needed for updates

  console.log('📦 Stock memory loaded from GitHub');
}

// Save

async function saveStockMemoryToGitHub() {
  const url = `${GITHUB_API}/repos/${process.env.SO_GITHUB_OWNER}/${process.env.SO_GITHUB_REPO}/contents/${process.env.SO_GITHUB_PATH}`;

  const body = {
    message: `Update stock memory (${new Date().toISOString()})`,
    content: Buffer.from(JSON.stringify(stockMemory, null, 2)).toString('base64'),
    sha: stockMemory._sha
  };

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.SO_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub save failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  stockMemory._sha = data.content.sha;

  console.log('💾 Stock memory saved to GitHub');
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

// -------------- API STOCKS --------------
// Key cycling

// ------------ STOCK API KEY MANAGEMENT --------------

const STOCK_API_KEYS = [
  'XCTem1vDIUoiigYb', //Jeyno, limited
  'MBGUyhoLEuiT6BBa'  //Meeip, public
].filter(Boolean); // remove undefined

let currentKeyIndex = 0;

function getCurrentKey() {
  return STOCK_API_KEYS[currentKeyIndex];
}

function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % STOCK_API_KEYS.length;
  console.warn(`🔁 Rotated stock API key (index ${currentKeyIndex})`);
}

function handleApiError(code) {
  console.error(`⚠️ Stock API error code: ${code}`);

  // Key-related errors → rotate key
  if ([2, 5, 8, 10, 13, 14, 18].includes(code)) {
    rotateKey();
    return;
  }

  // Temporary errors → skip this cycle
  if ([12, 15, 17, 24].includes(code)) {
    console.warn('⏭ Temporary API error, skipping this cycle');
    return;
  }

  // Everything else → unexpected, log only
  console.error('❌ Unexpected API error');
}


// Stock fetching

const STOCK_API_URL = 'https://api.torn.com/v2/torn?selections=stocks';

const STOCK_POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes
const LONG_TERM_WINDOW = 14 * 24 * 60 * 60 * 1000; // 14 days

async function pollStocks(channel) {
  console.log('📊 Polling stock market...');

  let res;
  try {
    res = await fetch(`${STOCK_API_URL}&key=${getCurrentKey()}`);
  } catch (err) {
    console.error('❌ Network error while polling stocks');
    return;
  }

  const data = await res.json();

  if (data.error) {
    handleApiError(data.error.code);
    return;
  }

  const now = Date.now();
  let alertMessages = [];

  for (const stock of Object.values(data.stocks)) {
    const id = stock.stock_id;
    const price = stock.current_price;

    if (!stockMemory.stocks[id]) {
      stockMemory.stocks[id] = [];
    }

    // Store price history
    stockMemory.stocks[id].push({
      //time: now, //reduce bloat
      price
    });

    // Trim old history
    stockMemory.stocks[id] = stockMemory.stocks[id].filter(
      p => now - p.time <= LONG_TERM_WINDOW
    );

    const prices = stockMemory.stocks[id].map(p => p.price);
    if (prices.length < 10) continue; // not enough data yet

    const min = Math.min(...prices);
    const max = Math.max(...prices);

    const nearLow = price <= min * 1.02;
    const nearHigh = price >= max * 0.98;

    if (nearLow) {
      alertMessages.push(`🟢 **BUY** ${stock.name} (${stock.acronym}) @ $${price.toFixed(2)} (near 14d low)`);
    } else if (nearHigh) {
      alertMessages.push(`🔴 **SELL** ${stock.name} (${stock.acronym}) @ $${price.toFixed(2)} (near 14d high)`);
    }
  }

  stockMemory.lastUpdated = now;
  saveStockMemory();

  if (alertMessages.length && channel) {
    for (const msg of alertMessages) {
      await channel.send(msg);
    }
  }

  console.log(`📈 Stock poll complete (${alertMessages.length} alerts)`);
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

  // Load stock memory on startup
  //loadStockMemory();
  try {
    await loadStockMemoryFromGitHub();
  } catch (err) {
    console.error('❌ Failed to load GitHub memory, starting fresh');
    stockMemory = { stocks: {}, lastUpdated: 0, lastAlert: {} };
  }

  //Periodically save to github memory file
  setInterval(() => {
    saveStockMemoryToGitHub().catch(err =>
      console.error('❌ GitHub save error:', err.message)
    );
  }, 10 * 60 * 1000); // every 10 minutes



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
  const dailyJob = new CronJob(
    '0 1 * * *',
    () => dailyTask(channel),
    null,
    true,
    'UTC'
  );
// Cron format: 'minute hour day-of-month month day-of-week'
// Here: 0 8 * * * → 08:00 UTC daily

  job.start();
  console.log('🕒 Cron job started: Every 10 minutes');

  // 📊 Stock observer (runs alongside the bot)
  setInterval(() => pollStocks(channel), STOCK_POLL_INTERVAL);
  console.log('📈 Stock observer started: every 2 minutes');
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


  if (command === 'revives' || command === 'revive' || command === 'revs' || command === 'rev' || command === 'r') {
    const guild = client.guilds.cache.first();
    const channel = guild.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return message.reply('Channel not found');

    checkRevs(channel);
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
/*
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
}*/
const { EmbedBuilder } = require('discord.js');

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

      const match = member.last_action.relative.match(/(\d+)\s*days?/i);
      if (match) {
        const daysAgo = parseInt(match[1], 10);
        if (daysAgo >= targetDays) {
          offlineLong.push(member.name);
        }
      }
    });

    const fields = [];

    if (positionMatches.length) {
      fields.push({
        name: `${targetPosition}'s: ${positionMatches.length}`,
        value: `[Send Newsletter](https://www.torn.com/factions.php?step=your&type=1#/tab=controls&option=newsletter) - ${positionMatches.join(', ')}`,
        inline: false
      });
    }

    if (notInOC.length) {
      fields.push({
        name: `Not in OCs: ${notInOC.length}`,
        value: `[Send Newsletter](https://www.torn.com/factions.php?step=your&type=1#/tab=controls&option=newsletter&target=notInOC) - ${notInOC.join(', ')}`,
        inline: false
      });
    }

    if (inFederalJail.length) {
      fields.push({
        name: `Fedded: ${inFederalJail.length}`,
        value: `[View Members](https://www.torn.com/factions.php?step=your&type=1#/tab=controls&option=members) - ${inFederalJail.join(', ')}`,
        inline: false
      });
    }

    if (offlineLong.length) {
      fields.push({
        name: `Offline for ${targetDays} or more: ${offlineLong.length}`,
        value: `[View Members](https://www.torn.com/factions.php?step=your&type=1#/tab=controls&option=members) - ${offlineLong.join(', ')}`,
        inline: false
      });
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dayLabel = yesterday.toLocaleDateString(); // e.g., "11/3/2025"

    const embed = new EmbedBuilder()
      .setTitle(`Daily Summary - End of Day ${dayLabel}`)
      .setColor(0x0099ff)
      .setTimestamp()
      .setFooter({ text: 'Turtlebot Status Report' })
      .addFields(fields.length ? fields : [{ name: 'All good', value: 'No issues today!' }]);

    await channel.send({ embeds: [embed] });

  } catch (err) {
    console.error('Error fetching API data:', err);
  }
}





async function checkRevs(channel) {
  console.log('Checking Revive Settings...');
    const now = Date.now();

    // Check cooldown
    if (now - lastCheckRevsTime < CHECK_REVS_COOLDOWN) {
        const remaining = Math.ceil((CHECK_REVS_COOLDOWN - (now - lastCheckRevsTime)) / 1000);
        channel.send(`Revive API is on cooldown. Try again in ${remaining}s.`);
        return;
    }
    // Update last run time
    lastCheckRevsTime = now;

  
  try {
    const response = await fetch(`https://api.torn.com/v2/faction/members?striptags=true&key=${apiKey}&comment=revCheck`);
    const data = await response.json();

    if (data.error) {
      console.error('API returned an error:', data.error);
      return;
    }
    
    const members = data.members;

    const greens = [];
    const yellows = [];


    members.forEach(member => {

      if (member.revive_setting === "Everyone") {
        greens.push(member.name);
      }
      if (member.revive_setting === "Friends & faction") {
        yellows.push(member.name);
      }
      

    });

    greens.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    yellows.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    
    const fields = [];


if (greens.length) {
  fields.push({
    name: `Revives enabled`,
    value: greens
      .map(name => `${name}`)
      .join('\n'),
    inline: false
  });
}

if (yellows.length) {
  fields.push({
    name: `Revives for Friends & faction`,
    value: yellows
      .map(name => `${name}`)
      .join('\n'),
    inline: false
  });
}
if (!greens.length && !yellows.length) {
      fields.push({
    name: `All revives disabled`,
    value: `:)`,
    inline: false
  });
}

const timestamp = formatDateTime();


    const embed = new EmbedBuilder()
      .setTitle(`Revive check ${timestamp}`)
      .setColor(0x0099ff)
      .setTimestamp()
      .setFooter({ text: 'Revive Status Report' })
      .addFields(fields.length ? fields : []);

    await channel.send({ embeds: [embed] });

  } catch (err) {
    console.error('Error fetching API data:', err);
  }
}






// ------------ LOGIN --------------
client.login(process.env.TOKEN);




















