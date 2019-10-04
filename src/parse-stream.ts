import * as _ from 'lodash';
import * as microseconds from 'microseconds';
import { FlvPacket, PacketTypeEnum } from 'node-flv';

import { config } from '../config';
import { logger } from './logger';
import { publishSubtitles } from './socket-publisher';
import { getSubtitle } from './subtitles-parser';
import { outputFlvHeader, writePacket } from './output';
import { sleep } from './helpers';
import { mainStreamPackets, mainStreamHeader } from './main-stream-flv';
import { pausedStreamPackets, pausedStreamPacketsCopy } from './paused-stream-flv';
import { attachReadline } from './readline';

let lastTimestamp: number = 0;
let timestampDebt: number = 0;
let lastTimestampsIndex: number = 0;

interface ICursor {
  lastTimestamp: number;
  savedPackets: FlvPacket[];
}

interface ILastTimestamps {
  [index: number]: ICursor;
}

const lastTimestamps: ILastTimestamps = {
  0: {
    lastTimestamp: 0,
    savedPackets: mainStreamPackets
  },
  1: {
    lastTimestamp: 0,
    savedPackets: pausedStreamPackets
  }
};

let lastSwitchedTimestamp: number = 0;
let lastPacketTimestamp: number = 0;

async function writeSequence() {
  logger(['writing...'], true);

  while (true) {
    if (mainStreamPackets.length > 4) {
      break;
    }

    logger(['waiting at least 5 packets'], true);

    await sleep(1000 * 1000);
  }

  await sleep(5 * 1000 * 1000);

  const startTime = Date.now();

  outputFlvHeader(mainStreamHeader);

  let drainingWaitingTime: number = 0;

  while (true) {
    const cursor = lastTimestamps[lastTimestampsIndex];

    const flvPacket = _.first(cursor.savedPackets);

    if (!flvPacket) {
      logger(['packet not found, skipping...'], true);

      await sleep(1000);

      continue;
    }

    const clonedPacket = _.cloneDeep(flvPacket);

    clonedPacket.flvPacketHeader.timestampLower =
      lastSwitchedTimestamp + flvPacket.flvPacketHeader.timestampLower - cursor.lastTimestamp;

    let writingStartTime = microseconds.now();

    writePacket(clonedPacket);

    if (lastTimestampsIndex === 0 && clonedPacket.flvPacketHeader.packetTypeEnum === PacketTypeEnum.VIDEO) {
      const timestamp = clonedPacket.flvPacketHeader.timestampLower;

      const text = getSubtitle(flvPacket.flvPacketHeader.timestampLower);

      publishSubtitles(timestamp, text);
    }

    const writingEndTime: number = microseconds.now();

    const drainingStartTime: number = microseconds.now();

    drainingWaitingTime += microseconds.now() - drainingStartTime;

    const nextPacket = cursor.savedPackets[1];

    let waitTime: number = 0;

    const threshold: number =
      clonedPacket.flvPacketHeader.timestampLower - (Date.now() - startTime) + drainingWaitingTime / 1000;

    if (nextPacket) {
      waitTime =
        nextPacket.flvPacketHeader.timestampLower * 1000 -
        flvPacket.flvPacketHeader.timestampLower * 1000 -
        (writingEndTime - writingStartTime) -
        timestampDebt;

      if (waitTime > 0) {
        timestampDebt = 0;

        if (threshold > 200) {
          await sleep(waitTime);
        } else {
          await sleep(waitTime - 1000);
        }
      } else {
        timestampDebt = waitTime * -1;
      }
    }

    logger([
      'writing packet...',
      {
        threshold,
        runningTime: Date.now() - startTime,
        drainingWaitingTime: drainingWaitingTime / 1000,
        lastTimestamp,
        currentTimestamp: flvPacket.flvPacketHeader.timestampLower,
        nextPacketTimestamp: _.get(nextPacket, ['header', 'timestampLower'], 'no-next-packet'),
        currentPacketsLeft: cursor.savedPackets.length,
        waitTime: waitTime / 1000,
        debt: timestampDebt / 1000,
        writeTime: (writingEndTime - writingStartTime) / 1000,
        lastSwitchedTimestamp,
        clonedPacketTimestamp: clonedPacket.flvPacketHeader.timestampLower,
        cursorLastTimestamp: cursor.lastTimestamp
      }
    ]);

    lastTimestamp = clonedPacket.flvPacketHeader.timestampLower;
    lastPacketTimestamp = flvPacket.flvPacketHeader.timestampLower;

    cursor.savedPackets.shift();

    if (lastTimestampsIndex === 1 && cursor.savedPackets.length === 0) {
      cursor.savedPackets = _.cloneDeep(pausedStreamPacketsCopy);

      _.forEach(cursor.savedPackets, flvPacket => {
        flvPacket.flvPacketHeader.timestampLower =
          flvPacket.flvPacketHeader.timestampLower +
          flvPacket.flvPacketHeader.timestampLower -
          Math.ceil(1000 / config.framerate);
      });

      logger([
        'cloned packets.',
        flvPacket.flvPacketHeader.timestampLower,
        _.first(cursor.savedPackets).flvPacketHeader.timestampLower
      ]);
    }

    if (lastTimestampsIndex === 0 && cursor.savedPackets.length === 0) {
      logger(['no main packets left.'], true);

      switchVideoRequest();
    }

    switchVideoRequested();
  }
}

let switchVideoRequestFlag: boolean = false;
let streamingEncode: boolean = true;

export function switchVideoRequest() {
  switchVideoRequestFlag = true;
}

function switchVideoRequested() {
  if (!switchVideoRequestFlag) return;

  logger(['switched videos.'], true);

  streamingEncode = !streamingEncode;

  lastSwitchedTimestamp = lastTimestamp - Math.ceil(1000 / config.framerate);

  lastTimestamps[lastTimestampsIndex].lastTimestamp = lastPacketTimestamp;

  lastTimestampsIndex = lastTimestampsIndex === 1 ? 0 : 1;

  switchVideoRequestFlag = false;
}

writeSequence();

attachReadline();
