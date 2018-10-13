const io = require('socket.io-client');

const config = require('./config.json');

const socket = io(config.socketServer);

function publishSubtitles(timestamp, text) {
    socket.emit('subtitles', {
        timestamp,
        text
    });
}

module.exports = publishSubtitles;
