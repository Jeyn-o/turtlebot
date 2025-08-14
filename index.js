
console.log(`Token length: ${process.env.TOKEN.length}`);
console.log(`Token (first 5 chars): ${process.env.TOKEN.slice(0,5)}`);

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', message => {
  if (message.content === '!ping') {
    message.channel.send('Pong!');
  }
});

client.login(process.env.TOKEN);

