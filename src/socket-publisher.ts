import * as io from 'socket.io-client';

import { config } from '../config';
import { FlvPacket } from './flv';

const socket = io(config.socketServer);

export function publishSubtitles(timestamp: number, text: string) {
  socket.emit('subtitles', {
    timestamp,
    text
  });
}

export function publishFlv(flvPacket: FlvPacket) {
  socket.emit('flv_packet', {
    flvPacket
  });
}
