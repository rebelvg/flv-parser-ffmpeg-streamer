import * as io from 'socket.io-client';

import { config } from '../config';

const socket = io(config.socketServer);

export function publishSubtitles(timestamp, text) {
    socket.emit('subtitles', {
        timestamp,
        text
    });
}

export function publishFlv(flvPacket) {
    socket.emit('flv_packet', {
        flvPacket
    });
}
