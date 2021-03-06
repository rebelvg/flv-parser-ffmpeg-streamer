import * as io from 'socket.io-client';
import { FlvHeader, FlvPacket } from 'node-flv';

import { config } from '../config';

let socket;

if (config.socketServer) {
  socket = io(config.socketServer);
}

export function publishSubtitles(timestamp: number, text: string) {
  if (socket) {
    socket.emit('subtitles', {
      timestamp,
      text,
    });
  }
}

export function publishFlvHeader(flvHeader: FlvHeader) {
  if (socket) {
    socket.emit('flv_header', {
      flvHeader,
    });
  }
}

export function publishFlvPacket(flvPacket: FlvPacket) {
  if (socket) {
    socket.emit('flv_packet', {
      flvPacket,
    });
  }
}
