import { Writable } from 'stream';
import { FlvHeader, FlvPacket } from 'node-flv';

import { config } from '../config';
import { sendRtmp } from './send-rtmp';
import { publishFlvHeader, publishFlvPacket } from './socket-publisher';

let ffmpegSendProcess: Writable;

if (config.publishLink) {
  ffmpegSendProcess = sendRtmp();
}

export function outputFlvHeader(flvHeader: FlvHeader) {
  if (ffmpegSendProcess) {
    ffmpegSendProcess.write(flvHeader.build());
  }

  publishFlvHeader(flvHeader);
}

export function outputFlvPacket(flvPacket: FlvPacket) {
  if (ffmpegSendProcess) {
    ffmpegSendProcess.write(flvPacket.build());
  }

  publishFlvPacket(flvPacket);
}

export function writePacket(flvPacket: FlvPacket) {
  outputFlvPacket(flvPacket);
}
