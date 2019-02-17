import { FlvPacket, FlvHeader } from './flv';
import { sendRtmp } from './send-rtmp';

import { config } from '../config';
import { Writable } from 'stream';
import { publishFlv } from './socket-publisher';

let ffmpegSendProcess: Writable;

if (config.publishLink) {
  ffmpegSendProcess = sendRtmp();
}

export function outputFlvHeader(flvHeader: FlvHeader) {
  if (ffmpegSendProcess) {
    ffmpegSendProcess.write(flvHeader.buildHeader());
  }

  if (config.socketServer) {
    publishFlv(flvHeader.buildHeader());
  }
}

export function outputFlvPacket(flvPacket: FlvPacket) {
  if (ffmpegSendProcess) {
    ffmpegSendProcess.write(flvPacket.buildPacket());
  }

  if (config.socketServer) {
    publishFlv(flvPacket.buildPacket());
  }
}
