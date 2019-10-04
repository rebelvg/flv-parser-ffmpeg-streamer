import * as ReadLine from 'readline';
import * as _ from 'lodash';
import * as microseconds from 'microseconds';
import { FlvStreamParser, FlvHeader, FlvPacket, PacketTypeEnum } from 'node-flv';

import { config } from '../config';
import { pipeMainFile } from './ffmpeg-pipe';
import { preparePaused } from './prepare-paused';
import { logger } from './logger';
import { publishSubtitles } from './socket-publisher';
import { getSubtitle } from './subtitles-parser';
import { outputFlvPacket, outputFlvHeader } from './output';

const mainStreamReadable = pipeMainFile();
const pausedStreamReadable = preparePaused();

const mainStreamFlv = new FlvStreamParser();
const pausedStreamFlv = new FlvStreamParser();

mainStreamReadable.pipe(mainStreamFlv);
pausedStreamReadable.pipe(pausedStreamFlv);

let mainStreamHeader: FlvHeader = null;

mainStreamFlv.on('flv-header', (flvHeader: FlvHeader) => {
  logger(['flv-header', flvHeader], true);

  mainStreamHeader = flvHeader;
});

let firstMetaDataPacket: FlvPacket = null;
let firstAudioPacket: FlvPacket = null;
let firstVideoPacket: FlvPacket = null;

mainStreamFlv.on('flv-packet', (flvPacket: FlvPacket) => {
  saveMainStreamPacket(flvPacket);

  if (!firstAudioPacket && flvPacket.flvPacketHeader.packetTypeEnum === PacketTypeEnum.AUDIO) {
    logger(['flvStreamParser', flvPacket], true);

    firstAudioPacket = flvPacket;
  }

  if (!firstVideoPacket && flvPacket.flvPacketHeader.packetTypeEnum === PacketTypeEnum.VIDEO) {
    logger(['flvStreamParser', flvPacket], true);

    firstVideoPacket = flvPacket;
  }

  if (!firstMetaDataPacket && flvPacket.flvPacketHeader.packetTypeEnum === PacketTypeEnum.METADATA) {
    logger(['flvStreamParser', flvPacket], true);

    firstMetaDataPacket = flvPacket;
  }
});

const pausedStreamPackets: FlvPacket[] = [];
const pausedStreamPacketsCopy: FlvPacket[] = [];

let flvStreamParserPacketCount: number = 0;

pausedStreamFlv.on('flv-packet', (flvPacket: FlvPacket) => {
  flvStreamParserPacketCount++;

  if (
    flvPacket.flvPacketHeader.timestampLower === 0 &&
    flvPacket.flvPacketHeader.packetTypeEnum === PacketTypeEnum.AUDIO
  ) {
    logger(['flvStreamParser2', flvPacket], true);
  }

  if (
    flvPacket.flvPacketHeader.timestampLower === 0 &&
    flvPacket.flvPacketHeader.packetTypeEnum === PacketTypeEnum.VIDEO
  ) {
    logger(['flvStreamParser2', flvPacket], true);
  }

  if (
    flvPacket.flvPacketHeader.timestampLower === 0 &&
    flvPacket.flvPacketHeader.packetTypeEnum === PacketTypeEnum.METADATA
  ) {
    logger(['flvStreamParser2', flvPacket], true);
  }

  if (flvStreamParserPacketCount < 4) {
    return;
  }

  //console.log(flvStreamParserPacketCount, flvPacket.header.packetType, flvPacket.header.timestampLower, flvPacket.header.payloadSize);

  //if (flvPacket.header.packetType === 9) console.log(flvStreamParserPacketCount, parseVideo(flvPacket.payload));

  //if (flvPacket.header.packetType === 18 && flvPacket.header.timestampLower === 0) return;

  const lastPacket = _.last(pausedStreamPackets);

  if (lastPacket) {
    if (flvPacket.flvPacketHeader.timestampLower >= lastPacket.flvPacketHeader.timestampLower) {
      pausedStreamPackets.push(flvPacket);
      pausedStreamPacketsCopy.push(flvPacket);
    } else {
      logger(['savedPackets2', 'skipping saving for', flvPacket.flvPacketHeader.packetType], true);
    }
  } else {
    pausedStreamPackets.push(flvPacket);
    pausedStreamPacketsCopy.push(flvPacket);
  }
});

let prevPacket: FlvPacket = null;

function writePacket(flvPacket: FlvPacket) {
  if (!prevPacket) {
    flvPacket.flvPacketHeader.prevPacketSize = 0;
  } else {
    flvPacket.flvPacketHeader.prevPacketSize = 11 + prevPacket.flvPacketHeader.payloadSize;
  }

  outputFlvPacket(flvPacket);

  prevPacket = flvPacket;
}

const mainStreamPackets: FlvPacket[] = [];

function saveMainStreamPacket(flvPacket: FlvPacket) {
  const lastPacket = _.last(mainStreamPackets);

  if (lastPacket) {
    if (flvPacket.flvPacketHeader.timestampLower >= lastPacket.flvPacketHeader.timestampLower) {
      mainStreamPackets.push(flvPacket);
    } else {
      logger(['savedPackets', 'skipping saving for', flvPacket.flvPacketHeader.packetType], true);
    }
  } else {
    mainStreamPackets.push(flvPacket);
  }
}

function sleep(mcs: number) {
  return new Promise(resolve => {
    setTimeout(resolve, mcs / 1000);
  });
}

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

    const packet = _.first(cursor.savedPackets);

    if (!packet) {
      logger(['packet not found, skipping...'], true);

      await sleep(1000);

      continue;
    }

    const clonedPacket = _.cloneDeep(packet);

    clonedPacket.flvPacketHeader.timestampLower =
      lastSwitchedTimestamp + packet.flvPacketHeader.timestampLower - cursor.lastTimestamp;

    let writingStartTime = microseconds.now();

    writePacket(clonedPacket);

    if (lastTimestampsIndex === 0 && clonedPacket.flvPacketHeader.packetTypeEnum === PacketTypeEnum.VIDEO) {
      const timestamp = clonedPacket.flvPacketHeader.timestampLower;

      const text = getSubtitle(packet.flvPacketHeader.timestampLower);

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
        packet.flvPacketHeader.timestampLower * 1000 -
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
        currentTimestamp: packet.flvPacketHeader.timestampLower,
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
    lastPacketTimestamp = packet.flvPacketHeader.timestampLower;

    cursor.savedPackets.shift();

    if (lastTimestampsIndex === 1 && cursor.savedPackets.length === 0) {
      cursor.savedPackets = _.cloneDeep(pausedStreamPacketsCopy);

      _.forEach(cursor.savedPackets, flvPacket => {
        flvPacket.flvPacketHeader.timestampLower =
          packet.flvPacketHeader.timestampLower +
          flvPacket.flvPacketHeader.timestampLower -
          Math.ceil(1000 / config.framerate);
      });

      logger([
        'cloned packets.',
        packet.flvPacketHeader.timestampLower,
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

const readLine = ReadLine.createInterface({
  input: process.stdin,
  output: process.stdout
});

let streamingEncode: boolean = true;

readLine.on('line', line => {
  if (line === 's') {
    switchVideoRequest();
  }
});

let switchVideoRequestFlag: boolean = false;

function switchVideoRequest() {
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
