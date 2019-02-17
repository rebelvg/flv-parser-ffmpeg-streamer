import * as io from 'socket.io-client';

import { config } from '../config';

let socket;

if (config.socketServer) {
  socket = io(config.socketServer);
}

export function publishSubtitles(timestamp: number, text: string) {
  if (socket) {
    socket.emit('subtitles', {
      timestamp,
      text
    });
  }
}

export function publishFlv(flvPacket: Buffer) {
  if (socket) {
    socket.emit('flv_packet', {
      flvPacket
    });
  }
}
