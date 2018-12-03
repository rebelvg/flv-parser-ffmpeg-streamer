const io = require('socket.io-client');

const config = require('./config.json');

const socket = io(config.socketServer);

function publishSubtitles(timestamp, text) {
    socket.emit('subtitles', {
        timestamp,
        text
    });
}

function publishFlv(flvPacket) {
    socket.emit('flv_packet', {
        flvPacket
    });
}

module.exports.publishSubtitles = publishSubtitles;
module.exports.publishFlv = publishFlv;
