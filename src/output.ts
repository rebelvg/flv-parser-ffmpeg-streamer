import { Writable } from 'stream';
import { FlvHeader, FlvPacket } from 'node-flv';

import { sendRtmp } from './send-rtmp';

import { config } from '../config';
import { publishFlvHeader, publishFlvPacket } from './socket-publisher';

let ffmpegSendProcess: Writable;

if (config.publishLink) {
  ffmpegSendProcess = sendRtmp();
}

export function outputFlvHeader(flvHeader: FlvHeader) {
  if (ffmpegSendProcess) {
    ffmpegSendProcess.write(flvHeader.buildHeader());
  }

  publishFlvHeader(flvHeader);
}

export function outputFlvPacket(flvPacket: FlvPacket) {
  if (ffmpegSendProcess) {
    ffmpegSendProcess.write(flvPacket.buildPacket());
  }

  publishFlvPacket(flvPacket);
}
