// #################################
// Onload
// #################################
// Stuff necessary for everything else to run

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

// #################################
// Init
// #################################
// More stuff necessary for everything else

const fs = require('fs');

// API key
// Todo: Key cycler, fallback, error handling
const apiKey = process.env.API_KEY;

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

//Make 2 api calls, get ocdata and memberdata
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

// #################################
// Databanks
// #################################
// Storing stuff for accessing anytime

let statusMessage = null;
let ocdata = null; //JSON (todo: which one?)
let memberdata = null; //JSON same?
const STOCK_MEMORY_FILE = './stocks-memory.json';
const PING_FILE = './pinglist.json';
const GITHUB_API = 'https://api.github.com';
const STOCK_API_KEYS = [ //todo hide
  'XCTem1vDIUoiigYb', //Jeyno, limited
  'MBGUyhoLEuiT6BBa'  //Meeip, public
].filter(Boolean); // remove undefined
const USER_STOCKS_FILE = './user-stocks.json';

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

// #################################
// Settings
// #################################

// Revive checker
let lastCheckRevsTime = 0;
const CHECK_REVS_COOLDOWN = 60 * 1000; // 60 seconds

// Stock observer
const stockCheckIntervalInMinutes = 2;
const stockClearMemoryInDays = 14;

// #################################
// Helpers
// #################################

//get current UTC time as "YYYY/MM/DD HH:MM"
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

  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
  const lookup = {};
  for (const { type, value } of parts) {
    lookup[type] = value;
  }
  return `${lookup.year}/${lookup.month}/${lookup.day} ${lookup.hour}:${lookup.minute}`;
}

function getMemberName(id) {
  const member = memberdata?.members?.find(m => m.id === id);
  return member ? member.name : 'Unknown';
}

// Helpers for OC guardian
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

async function getLatestGitHubFileSha(filePath) {
  if (!filePath) {
    throw new Error('filePath is required');
  }

  const url = `${GITHUB_API}/repos/${process.env.SO_GITHUB_OWNER}/${process.env.SO_GITHUB_REPO}/contents/${filePath}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.SO_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub fetch failed for ${filePath}: ${res.status} ${text}`
    );
  }

  const data = await res.json();
  return data.sha;
}

// Handler for interactions in Discord Interaction System v2 (currently not used)
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

});

// #################################
// Function Pinglist
// #################################
// Handling of a dynamic list of users that wish to be pinged
// todo: ping for what again?
// todo maybe rewrite the thing to handle purposes

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


// #################################
// Function Verification handler
// #################################
// Parse string to verify user
// Returns {username, UID} as strings if rawName starts with "USERNAME [123]"
// Returns null if not verified (doesn't match)

function verifyUser(rawName) {
  const match = rawName.match(/^(.+?)\s*\[(\d+)]/);
  if (!match) {
    return null;
  }
  const username = match[1].trim();
  const UID = match[2].trim();
  return { username, UID };
}

// #################################
// Function Stock Observer
// #################################
// Setup of local memory and handling of user stocks
// todo replace github memory with something better

// Setup
let stockMemory = {
  stocks: {}, // stock_id -> history[]
  lastUpdated: 0
};
function loadStockMemory() {
  try {
    stockMemory = JSON.parse(fs.readFileSync(STOCK_MEMORY_FILE, 'utf8'));
    console.log('Stock memory loaded');
  } catch {
    console.log('No stock memory found, starting fresh');
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
    console.error('Failed to save stock memory:', err.message);
  }
}
async function loadUserStocksFromGitHub() {
  const url = `https://api.github.com/repos/${process.env.SO_GITHUB_OWNER}/${process.env.SO_GITHUB_REPO}/contents/${USER_STOCKS_FILE}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.SO_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json'
    }
  });

  if (!res.ok) throw new Error(`GitHub load failed: ${res.status}`);

  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');

  const userStocks = JSON.parse(content);
  userStocks._sha = data.sha; // keep SHA for updates
  return userStocks;
}
async function saveUserStocksToGitHub(userStocks) {
  const url = `https://api.github.com/repos/${process.env.SO_GITHUB_OWNER}/${process.env.SO_GITHUB_REPO}/contents/${USER_STOCKS_FILE}`;

  const body = {
    message: `Update user stocks (${new Date().toISOString()})`,
    content: Buffer.from(JSON.stringify(userStocks, null, 2)).toString('base64'),
    sha: userStocks._sha
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
  userStocks._sha = data.content.sha; // update SHA
}
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

  console.log('Stock memory loaded from GitHub');
}
async function saveStockMemoryToGitHub({ retry = false } = {}) {
  const filePath = process.env.SO_GITHUB_PATH;
  const url = `${GITHUB_API}/repos/${process.env.SO_GITHUB_OWNER}/${process.env.SO_GITHUB_REPO}/contents/${filePath}`;

  const latestSha = await getLatestGitHubFileSha(filePath);

  const body = {
    message: `Update stock memory (${new Date().toISOString()})`,
    content: Buffer.from(
      JSON.stringify(stockMemory, null, 2)
    ).toString('base64'),
    sha: latestSha
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

  if (res.status === 409 && !retry) {
    console.warn('SHA conflict detected, retrying...');
    return saveStockMemoryToGitHub({ retry: true });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub save failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  stockMemory._sha = data.content.sha;

  console.log('Stock memory saved to GitHub');
}
const STOCK_API_URL = 'https://api.torn.com/v2/torn?selections=stocks';
const STOCK_POLL_INTERVAL = stockCheckIntervalInMinutes * 60 * 1000;
const LONG_TERM_WINDOW = stockClearMemoryInDays * 24 * 60 * 60 * 1000;

// Core Function
async function pollStocks(channel) {
  console.log('Polling stock market...');

  let res;
  try {
    res = await fetch(`${STOCK_API_URL}&key=${getCurrentKey()}`);
  } catch (err) {
    console.error('Network error while polling stocks:', err.message);
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error('Failed to parse stock API response');
    return;
  }

  if (!data || data.error) {
    if (data?.error?.code) {
      handleApiError(data.error.code);
    } else {
      console.error('Invalid stock API response');
    }
    return;
  }

  const now = Date.now();
  const today = new Date(now).toDateString();
  const week = `${new Date(now).getUTCFullYear()}-${new Date(now).getUTCMonth()}`;

  // --- daily reset
  if (stockMemory._day !== today) {
    for (const stock of Object.values(stockMemory.stocks)) {
      stock.dayLow = Infinity;
      stock.dayHigh = -Infinity;
    }
    stockMemory._day = today;
  }

  // --- weekly reset
  if (stockMemory._week !== week) {
    for (const stock of Object.values(stockMemory.stocks)) {
      stock.weekLow = Infinity;
      stock.weekHigh = -Infinity;
    }
    stockMemory._week = week;
  }

  // --- alert arrays
  const buy = [];
  const sell = [];
  const hold = [];

  // --- CONFIG (safe defaults)
  const BUY_ZONE = 0.10;      // bottom 10% of daily range
  const SELL_ZONE = 0.10;     // top 10% of daily range
  const SELL_FEE_OFFSET = 0.001; // % fee placeholder (e.g. 0.03 = 3%)

  for (const stock of Object.values(data.stocks)) {
    const id = String(stock.stock_id);
    const price = Number(stock.current_price);

    if (!Number.isFinite(price)) continue;

    // --- initialize memory
    if (!stockMemory.stocks[id]) {
      stockMemory.stocks[id] = {
        recent: [],
        dayLow: price,
        dayHigh: price,
        weekLow: price,
        weekHigh: price,
        allTimeLow: price,
        allTimeHigh: price
      };
    }

    const mem = stockMemory.stocks[id];

    // --- recent prices (bounded)
    mem.recent.push(price);
    if (mem.recent.length > 720) mem.recent.shift();

    // --- rolling ranges
    mem.dayLow = Math.min(mem.dayLow, price);
    mem.dayHigh = Math.max(mem.dayHigh, price);

    mem.weekLow = Math.min(mem.weekLow, price);
    mem.weekHigh = Math.max(mem.weekHigh, price);

    mem.allTimeLow = Math.min(mem.allTimeLow, price);
    mem.allTimeHigh = Math.max(mem.allTimeHigh, price);

    // --- decision logic (range-based, not % from low)
    const dayRange = mem.dayHigh - mem.dayLow;

    // If the stock hasn't moved today, do nothing
    if (dayRange <= 0) {
      hold.push(`• ${stock.acronym} – flat`);
      continue;
    }

    const buyThreshold = mem.dayLow + dayRange * BUY_ZONE;
    const sellThreshold =
      mem.dayHigh - dayRange * SELL_ZONE + (price * SELL_FEE_OFFSET);

    // --- recent price analysis for stabilization
	const RECENT_WINDOW = 6; // last ~12 minutes (6*2min polls)
	const recentSlice = mem.recent.slice(-RECENT_WINDOW);

	// lowest recent price
	const recentLow = Math.min(...recentSlice);

	// simple average of recent prices
	const avgRecent =
      recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length;

	// --- BUY / SELL / HOLD logic with stabilization
	const isStabilizing = price >= recentLow; // price has stopped falling
	const hasBounce = price >= avgRecent;    // slight upward trend

	if (price <= buyThreshold && isStabilizing && hasBounce) {
	  buy.push(
		`• **${stock.acronym}** @ $${price.toFixed(2)} (low + stabilizing)`
	  );
	} else if (price >= sellThreshold) {
	  sell.push(
		`• **${stock.acronym}** @ $${price.toFixed(2)} (near daily high)`
	  );
	} else {
	  hold.push(`• ${stock.acronym} – stable`);
	}

  }

  stockMemory.lastUpdated = now;

  try {
    saveStockMemory();
  } catch (err) {
    console.error('Failed to save stock memory:', err.message);
  }

  // --- assemble single Discord message
  if (channel) {
    const sections = [];

    if (buy.length) sections.push(`**BUY**\n${buy.join('\n')}`);
    if (sell.length) sections.push(`**SELL**\n${sell.join('\n')}`);
    if (hold.length && false)
      sections.push(
        `**HOLD**\n${hold.join('\n')}\n_(HOLD items may be hidden later)_`
      );

    if (sections.length) {
	  const message =
		`**Stock Market Update**\n\n` +
		sections.join('\n\n') +
		`\n\nUpdated: ${new Date(now).toUTCString()}`;

	  try {
		await channel.send(message);

		// === USER SELL NOTIFICATIONS ===
		try {
		  let userStocks = await loadUserStocksFromGitHub();
		  await notifyUsersForSell(userStocks, data.stocks, channel, 0); // offset = 0 for now
		} catch (err) {
		  console.error('Failed to send user sell notifications:', err.message);
		}

	  } catch (err) {
		console.error('Failed to send Discord message:', err.message);
	  }
	}

  }

  console.log(
    `Stock poll complete (BUY: ${buy.length}, SELL: ${sell.length}, HOLD: ${hold.length})`
  );
}

// Notification for good time to sell
async function notifyUsersForSell(userStocks, currentStocks, channel, offset = 0) {
  // Map current stock prices for easy lookup
  const stockMap = {};
  for (const stock of Object.values(currentStocks)) {
    stockMap[stock.acronym] = Number(stock.current_price);
  }

  // Iterate over each user
  for (const username in userStocks) {
    const userStockList = userStocks[username];

    if (!userStockList || userStockList.length === 0) continue;

    for (const entry of userStockList) {
      const { stock, value: buyPrice } = entry;
      const currentPrice = stockMap[stock];
      if (currentPrice === undefined) continue; // stock not in API data

      // Apply offset logic (for market fee etc)
      const adjustedSellPrice = buyPrice + offset;

      if (currentPrice >= adjustedSellPrice) {
        try {
          const member = channel.guild.members.cache.find(
            m => `${m.displayName}`.includes(username)
          );
          if (!member) continue; // user not in guild

          await channel.send(
            `${member} **${stock}** bought at $${buyPrice.toFixed(
              2
            )} is now $${currentPrice.toFixed(2)}`
          );
        } catch (err) {
          console.error(`Failed to notify ${username} for stock ${stock}:`, err.message);
        }
      }
    }
  }
}

// Handler for !stock buy/sell/clear
async function handleStockAction(type, username, stock, value) {
  let data;

  // 🔹 Load from GitHub (REQUIRED so we get _sha)
  try {
    data = await loadUserStocksFromGitHub();
  } catch (err) {
    console.warn('⚠Failed to load user stocks from GitHub, starting fresh');
    data = {};
  }

  // Ensure user entry exists
  if (!data[username]) data[username] = [];

  switch (type) {
    case 'buy':
      if (!stock || typeof value !== 'number') {
        console.error('BUY action requires stock symbol and price.');
        return;
      }
      data[username].push({ stock, value });
      break;

    case 'sell':
      if (!stock) {
        console.error('SELL action requires stock symbol.');
        return;
      }
      data[username] = data[username].filter(s => s.stock !== stock);
      break;

    case 'clear':
      data[username] = [];
      break;

    default:
      console.error(`Unknown stock action type: ${type}`);
      return;
  }

  // 🔹 Save back to GitHub (now includes _sha)
  try {
    await saveUserStocksToGitHub(data);
    console.log(
      `Stock action saved: ${type} for ${username}${stock ? ` (${stock})` : ''}`
    );
  } catch (err) {
    console.error('Failed to save user stocks:', err.message);
  }
}



// #################################
// Function Daily Summary
// #################################

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

    if (notInOC.length) { //todo edit to "not in OC for 24h"
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

// #################################
// Function Revive Check
// #################################
// Get list of members with revive enabled
//todo avoid making MY api calls per run
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



// #################################
// Helper Function API Cycler
// #################################

let currentKeyIndex = 0;
function getCurrentKey() {
  return STOCK_API_KEYS[currentKeyIndex];
}

function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % STOCK_API_KEYS.length;
  console.warn(`Rotated stock API key (index ${currentKeyIndex})`);
}

function handleApiError(code) {
  console.error(`Stock API error code: ${code}`);

  // Key-related errors → rotate key
  if ([2, 5, 8, 10, 13, 14, 18].includes(code)) {
    rotateKey();
    return;
  }

  // Temporary errors → skip this cycle
  if ([12, 15, 17, 24].includes(code)) {
    console.warn('Temporary API error, skipping this cycle');
    return;
  }

  // Everything else → unexpected, log only
  console.error('Unexpected API error');
}





// #################################
// Function update main embed
// #################################
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

  console.log(`Embed updated at ${new Date().toISOString()}`);
} //WIP






// #################################
// Kickoff
// #################################
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  loadPingList();

  // Load stock memory on startup
  //loadStockMemory();
  try {
    await loadStockMemoryFromGitHub();
  } catch (err) {
    console.error('Failed to load GitHub memory, starting fresh');
    stockMemory = { stocks: {}, lastUpdated: 0, lastAlert: {} };
  }

  //Periodically save to github memory file
  setInterval(() => {
    saveStockMemoryToGitHub().catch(err =>
      console.error('GitHub save error:', err.message)
    );
  }, 10 * 60 * 1000); // every 10 minutes

  const guild = client.guilds.cache.first();
  const channel = guild.channels.cache.get(process.env.CHANNEL_ID);
  if (!channel) return console.error('Channel not found');

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
  console.log('Cron job started: Every 10 minutes');

  // 📊 Stock observer (runs alongside the bot)
  setInterval(() => pollStocks(channel), STOCK_POLL_INTERVAL);
  console.log(`Stock observer started: every ${STOCK_POLL_INTERVAL} minutes`);
});



// #################################
// Bot Interaction Handler (Command list)
// #################################

const prefix = '!';
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  //MANUAL DAILY SUMMARY
  if (command === 'daily') {
  const guild = client.guilds.cache.first(); // or use a specific guild ID
  const channel = guild.channels.cache.get(process.env.CHANNEL_ID);
  if (!channel) return message.reply('❌ Channel not found');
  await dailyTask(channel);
  message.reply('Daily summary sent!');
  }

  //REVIVE CHECK
  if (command === 'revives' || command === 'revive' || command === 'revs' || command === 'rev' || command === 'r') {
    const guild = client.guilds.cache.first();
    const channel = guild.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return message.reply('Channel not found');

    checkRevs(channel);
  }

  //STOCK OBSERVER
  if (command === 'stock') {
    if (args.length === 0) return message.reply('Usage: !stock buy/sell/clear <stock> [price]');

    const action = args.shift().toLowerCase(); // buy / sell / clear
    const rawUsername = `${message.member.displayName}`; // Or message.author.username if preferred

    // Verify username
    const verified = verifyUser(rawUsername);
    if (!verified) return message.reply('You are not verified. Your name must be in the format USERNAME [1234567]'); //todo hint to yata verification instead

    const username = `${verified.username} [${verified.UID}]`;

    switch (action) {
      case 'buy':
        if (args.length < 2) return message.reply('Usage: !stock buy <stock> <price>');
        const buyStock = args[0].toUpperCase();
        const buyPrice = parseFloat(args[1]);
        if (isNaN(buyPrice)) return message.reply('Price must be a number.');
        await handleStockAction('buy', username, buyStock, buyPrice);
        message.reply(`Recorded buy: ${buyStock} @ $${buyPrice.toFixed(2)}`);
        break;

      case 'sell':
        if (args.length < 1) return message.reply('Usage: !stock sell <stock>');
        const sellStock = args[0].toUpperCase();
        await handleStockAction('sell', username, sellStock);
        message.reply(`Recorded sell: ${sellStock}`);
        break;

      case 'clear':
        await handleStockAction('clear', username);
        message.reply('Cleared all your stocks.');
        break;

      default:
        message.reply('Unknown stock action. Use buy, sell, or clear.');
    }
  }

  //ALIAS LOOKUP
  if (command === 'a' || command === 'alias') {
    if (args.length === 0) {
      return message.reply('Missing IDs or names');
    }

    // --- Fetch JSON from GitHub ---
    let data;
    try {
      const response = await fetch('https://raw.githubusercontent.com/Jeyn-o/OC_Stalker/refs/heads/main/BC_names.JSON');
      data = await response.json(); //todo load on init then store and reference
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

