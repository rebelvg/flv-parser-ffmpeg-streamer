import {
  FlvStreamParser,
  FlvPacket,
  FlvPacketAudio,
  FlvPacketVideo,
  FlvPacketMetadata,
} from 'node-flv';
import * as _ from 'lodash';

import { preparePaused } from './prepare-paused';
import { logger } from './logger';

const pausedStreamReadable = preparePaused();

const pausedStreamFlv = new FlvStreamParser();

export const pausedStreamPackets: FlvPacket[] = [];
export const pausedStreamPacketsCopy: FlvPacket[] = [];

let flvStreamParserPacketCount: number = 0;

pausedStreamFlv.on('flv-packet', (flvPacket: FlvPacket) => {
  flvStreamParserPacketCount++;

  if (flvStreamParserPacketCount < 4) {
    return;
  }

  const lastPacket = _.last(pausedStreamPackets);

  if (!lastPacket) {
    pausedStreamPackets.push(flvPacket);
    pausedStreamPacketsCopy.push(flvPacket);

    return;
  }

  if (flvPacket.header.timestampLower < lastPacket.header.timestampLower) {
    // do not write packets that have timestamp lower than the timestamp of a previous packet
    logger(
      ['pausedStreamPackets', 'skipping saving for', flvPacket.header.type],
      true,
    );

    return;
  }

  pausedStreamPackets.push(flvPacket);
  pausedStreamPacketsCopy.push(flvPacket);
});

pausedStreamFlv.on('flv-packet-audio', (flvPacket: FlvPacketAudio) => {
  if (flvPacket.header.timestampLower === 0) {
    logger(['pausedStreamFlv audio', flvPacket.data], true);
  }
});

pausedStreamFlv.on('flv-packet-video', (flvPacket: FlvPacketVideo) => {
  if (flvPacket.header.timestampLower === 0) {
    logger(['pausedStreamFlv video', flvPacket.data], true);
  }

  // console.log(flvStreamParserPacketCount, flvPacket.videoData);
});

pausedStreamFlv.on('flv-packet-metadata', (flvPacket: FlvPacketMetadata) => {
  if (flvPacket.header.timestampLower === 0) {
    logger(['pausedStreamFlv metadata', flvPacket.data], true);
  }
});

pausedStreamReadable.pipe(pausedStreamFlv);
