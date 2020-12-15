import * as _ from 'lodash';
import { FlvPacket, FlvPacketType } from 'node-flv';

import { config } from '../config';
import { logger } from './logger';
import { publishSubtitles } from './socket-publisher';
import { getSubtitle } from './subtitles-parser';
import { outputFlvHeader, writePacket } from './output';
import { sleep } from './helpers';
import { mainStreamPackets, mainStreamHeader } from './main-stream-flv';
import {
  pausedStreamPackets,
  pausedStreamPacketsCopy,
} from './paused-stream-flv';
import { attachReadline } from './readline';

let lastTimestamp = 0;
let lastTimestampsIndex = 0;

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
    savedPackets: mainStreamPackets,
  },
  1: {
    lastTimestamp: 0,
    savedPackets: pausedStreamPackets,
  },
};

let lastSwitchedTimestamp = 0;
let lastPacketTimestamp = 0;

async function writeSequence() {
  logger(['writing...'], true);

  while (true) {
    if (mainStreamPackets.length > 4) {
      break;
    }

    logger(['waiting for at least 5 packets'], true);

    await sleep(1000);
  }

  await sleep(5 * 1000);

  const startTime = Date.now();

  outputFlvHeader(mainStreamHeader);

  while (true) {
    const cursor = lastTimestamps[lastTimestampsIndex];

    const flvPacket = _.first(cursor.savedPackets);

    if (!flvPacket) {
      logger(['packet not found, skipping...'], true);

      await sleep(1);

      continue;
    }

    const {
      header: { timestampLower: cursorTimestampLower },
    } = flvPacket;

    const clonedPacket = _.cloneDeep(flvPacket);

    const latestStreamTimestampLower =
      lastSwitchedTimestamp + cursorTimestampLower - cursor.lastTimestamp;

    clonedPacket.header.timestampLower = latestStreamTimestampLower;

    writePacket(clonedPacket);

    if (
      lastTimestampsIndex === 0 &&
      clonedPacket.header.type === FlvPacketType.VIDEO
    ) {
      const timestamp = latestStreamTimestampLower;

      const text = getSubtitle(cursorTimestampLower);

      publishSubtitles(timestamp, text);
    }

    const nextPacket = cursor.savedPackets[1];

    let waitTime = 0;

    const threshold = latestStreamTimestampLower - (Date.now() - startTime);

    if (nextPacket) {
      waitTime = nextPacket.header.timestampLower - cursorTimestampLower;

      if (threshold > 200) {
        await sleep(waitTime);
      } else {
        await sleep(waitTime / 2);
      }
    }

    logger([
      'writing packet...',
      {
        threshold,
        runningTime: Date.now() - startTime,
        lastTimestamp,
        currentTimestamp: cursorTimestampLower,
        nextPacketTimestamp: _.get(
          nextPacket,
          ['header', 'timestampLower'],
          'no-next-packet',
        ),
        currentPacketsLeft: cursor.savedPackets.length,
        waitTime,
        lastSwitchedTimestamp,
        clonedPacketTimestamp: latestStreamTimestampLower,
        cursorLastTimestamp: cursor.lastTimestamp,
      },
    ]);

    lastTimestamp = latestStreamTimestampLower;
    lastPacketTimestamp = cursorTimestampLower;

    cursor.savedPackets.shift();

    if (lastTimestampsIndex === 1 && cursor.savedPackets.length === 0) {
      cursor.savedPackets = _.cloneDeep(pausedStreamPacketsCopy);

      _.forEach(cursor.savedPackets, (flvPacket) => {
        flvPacket.header.timestampLower +=
          cursorTimestampLower - Math.ceil(1000 / config.framerate);
      });

      logger([
        'cloned packets.',
        cursorTimestampLower,
        _.first(cursor.savedPackets).header.timestampLower,
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
