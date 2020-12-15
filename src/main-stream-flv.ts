import {
  FlvStreamParser,
  FlvHeader,
  FlvPacket,
  FlvPacketAudio,
  FlvPacketVideo,
  FlvPacketMetadata,
} from 'node-flv';
import * as _ from 'lodash';

import { pipeMainFile } from './ffmpeg-pipe';
import { logger } from './logger';

const mainStreamReadable = pipeMainFile();

const mainStreamFlv = new FlvStreamParser();

export let mainStreamHeader: FlvHeader = null;

mainStreamFlv.on('flv-header', (flvHeader: FlvHeader) => {
  logger(['main stream flv-header', flvHeader], true);

  mainStreamHeader = flvHeader;
});

let firstAudioPacket: FlvPacket = null;
let firstVideoPacket: FlvPacket = null;
let firstMetaDataPacket: FlvPacket = null;

export const mainStreamPackets: FlvPacket[] = [];

mainStreamFlv.on('flv-packet', (flvPacket: FlvPacket) => {
  saveMainStreamPacket(flvPacket);
});

mainStreamFlv.on('flv-packet-audio', (flvPacket: FlvPacketAudio) => {
  if (!firstAudioPacket) {
    logger(['main stream audio', flvPacket.data], true);

    firstAudioPacket = flvPacket;
  }
});

mainStreamFlv.on('flv-packet-video', (flvPacket: FlvPacketVideo) => {
  if (!firstVideoPacket) {
    logger(['main stream video', flvPacket.data], true);

    firstVideoPacket = flvPacket;
  }
});

mainStreamFlv.on('flv-packet-metadata', (flvPacket: FlvPacketMetadata) => {
  if (!firstMetaDataPacket) {
    logger(['main stream metadata', flvPacket.data], true);

    firstMetaDataPacket = flvPacket;
  }
});

function saveMainStreamPacket(flvPacket: FlvPacket) {
  const lastPacket = _.last(mainStreamPackets);

  if (!lastPacket) {
    mainStreamPackets.push(flvPacket);

    return;
  }

  if (flvPacket.header.timestampLower < lastPacket.header.timestampLower) {
    // do not write packets that have timestamp lower than the timestamp of a previous packet
    logger(
      ['mainStreamPackets', 'skipping saving for', flvPacket.header.type],
      true,
    );

    return;
  }

  mainStreamPackets.push(flvPacket);
}

mainStreamReadable.pipe(mainStreamFlv);
