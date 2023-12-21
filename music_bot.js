const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const YouTube = require('youtube-sr').default;
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
    ],
});

const queues = new Map();

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith('!')) return;
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('You need to be in a voice channel to use this command.');

    if (message.content.startsWith('!play')) {
        await handlePlayCommand(message, voiceChannel);
    } else if (message.content.startsWith('!stop')) {
        stopMusic(message.guild.id, message);
    } else if (message.content.startsWith('!skip')) {
        skipSong(message.guild.id, message);
    } else if (message.content.startsWith('!queue')) {
        showQueue(message.guild.id, message);
    }
});

async function handlePlayCommand(message, voiceChannel) {
  const args = message.content.split(' ').slice(1).join(' ');
  let songInfo;

  try {
      if (!ytdl.validateURL(args)) {
          const searchResults = await YouTube.search(args, { limit: 1 });
          if (searchResults.length === 0) {
              return message.reply('No videos found matching your query.');
          }
          const videoResult = searchResults[0];
          songInfo = {
              url: `https://www.youtube.com/watch?v=${videoResult.id}`,
              title: videoResult.title,
              thumbnail: videoResult.thumbnail.url,
              duration: formatDuration(videoResult.duration), // Предполагается, что duration уже в правильном формате
          };
      } else {
          const videoDetails = await ytdl.getInfo(args);
          songInfo = {
              url: args,
              title: videoDetails.videoDetails.title,
              thumbnail: videoDetails.videoDetails.thumbnails[videoDetails.videoDetails.thumbnails.length - 1].url,
              duration: formatDuration(videoDetails.videoDetails.lengthSeconds),
          };
      }

      // Отправка информации о песне
      sendSongEmbed(message, songInfo);

      // Продолжение обработки очереди и воспроизведения...
      const stream = ytdl(songInfo.url, { filter: 'audioonly' });
      const resource = createAudioResource(stream);
      let player;
      
      if (!queues.has(message.guild.id)) {
          player = createAudioPlayer();
          const connection = joinVoiceChannel({
              channelId: voiceChannel.id,
              guildId: message.guild.id,
              adapterCreator: message.guild.voiceAdapterCreator,
          });
          connection.subscribe(player);
          queues.set(message.guild.id, { player, connection, songs: [songInfo], voiceChannel });
          play(message.guild.id);
      } else {
          const serverQueue = queues.get(message.guild.id);
          serverQueue.songs.push(songInfo);
          sendSongEmbed(message, songInfo);
      }
    } catch (error) {
      console.error(error);
      message.reply('There was an error processing your request.');
    }
}

function sendSongEmbed(message, song) {
  const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(song.title)
      .setURL(song.url)
      .setDescription(`Duration: ${song.duration}`)
      .setTimestamp();

  // Убедитесь, что song.thumbnail существует и является строкой
  if (song.thumbnail && typeof song.thumbnail === 'string') {
      embed.setThumbnail(song.thumbnail);
  }

  message.channel.send({ embeds: [embed] });
}

function play(guildId) {
    const serverQueue = queues.get(guildId);
    if (!serverQueue || serverQueue.songs.length === 0) {
        serverQueue.voiceChannel.leave();
        queues.delete(guildId);
        return;
    }
    const song = serverQueue.songs[0];
    const stream = ytdl(song.url, { filter: 'audioonly' });
    const resource = createAudioResource(stream);
    serverQueue.player.play(resource);
    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
        serverQueue.songs.shift();
        play(guildId);
    });
    serverQueue.player.on('error', error => console.error(error));
    serverQueue.voiceChannel.send(`Now playing: ${song.title}`);
}

function stopMusic(guildId, message) {
    const serverQueue = queues.get(guildId);
    if (!serverQueue) return message.reply('There is no music currently playing.');
    serverQueue.songs = [];
    serverQueue.player.stop();
    serverQueue.voiceChannel.leave();
    queues.delete(guildId);
    message.reply('Music playback stopped and queue cleared.');
}

function skipSong(guildId, message) {
    const serverQueue = queues.get(guildId);
    if (!serverQueue) return message.reply('There is no music currently playing.');
    serverQueue.songs.shift();
    play(guildId);
}

function showQueue(guildId, message) {
    const serverQueue = queues.get(guildId);
    if (!serverQueue || serverQueue.songs.length === 0) {
        return message.reply('The queue is currently empty.');
    }

    const queueEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Current Music Queue')
        .setDescription(serverQueue.songs.map((song, index) => `${index + 1}. ${song.title}`).join('\n'))
        .setTimestamp();

    message.channel.send({ embeds: [queueEmbed] });
}

function formatDuration(durationSeconds) {
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const seconds = durationSeconds % 60;
    return [hours, minutes, seconds].map(val => val < 10 ? `0${val}` : val).join(':');
}

client.login(config.token);
