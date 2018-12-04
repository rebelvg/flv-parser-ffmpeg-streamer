import { FlvHeader, FlvPacketHeader, FlvPacket, PacketTypeEnum } from './flv';
import { FlvStreamParser } from './flv-stream';

import * as fs from 'fs';
import * as _ from 'lodash';
import * as ReadLine from 'readline';
import * as microseconds from 'microseconds';

import { config } from '../config';
import { pipeMainFile } from './ffmpeg-pipe';
import { preparePaused } from './prepare-paused';
import { sendRtmp } from './send-rtmp';
import { logger } from './logger';
import { publishFlv, publishSubtitles } from './socket-publisher';
import { getSubtitle } from './subtitles-parser';

//const flvStream = fs.createReadStream('video.flv');

//const streamedFlv = fs.createWriteStream('streamed-flv.flv');

const mainStreamReadable = pipeMainFile();
const pausedStreamReadable = preparePaused();

//const flvStream = fs.createReadStream('video.flv');

const mainStreamFlv = new FlvStreamParser();
const pausedStreamFlv = new FlvStreamParser();

mainStreamReadable.pipe(mainStreamFlv);
pausedStreamReadable.pipe(pausedStreamFlv);

let mainStreamHeader: FlvHeader = null;

mainStreamFlv.on('flv-header', (header: FlvHeader) => {
  logger(['flv-header', header], true);

  mainStreamHeader = header;
});

let firstMetaDataPacket: FlvPacket = null;
let firstAudioPacket: FlvPacket = null;
let firstVideoPacket: FlvPacket = null;

mainStreamFlv.on('flv-packet', (flvPacket: FlvPacket) => {
  saveMainStreamPacket(flvPacket);

  if (!firstMetaDataPacket && flvPacket.packetType === PacketTypeEnum.METADATA) {
    logger(['flvStreamParser', flvPacket.metaData], true);

    firstMetaDataPacket = flvPacket;
  }

  if (!firstAudioPacket && flvPacket.packetType === PacketTypeEnum.AUDIO) {
    logger(['flvStreamParser', flvPacket.audioMetaData], true);

    firstAudioPacket = flvPacket;
  }

  if (!firstVideoPacket && flvPacket.packetType === PacketTypeEnum.VIDEO) {
    logger(['flvStreamParser', flvPacket.videoMetaData], true);

    firstVideoPacket = flvPacket;
  }
});

const pausedStreamPackets: FlvPacket[] = [];
const pausedStreamPacketsCopy: FlvPacket[] = [];

let flvStreamParserPacketCount: number = 0;

pausedStreamFlv.on('flv-packet', (flvPacket: FlvPacket) => {
  flvStreamParserPacketCount++;

  if (flvPacket.header.timestampLower === 0 && flvPacket.packetType === PacketTypeEnum.METADATA) {
    logger(['flvStreamParser2', flvPacket.metaData], true);
  }

  if (flvPacket.header.timestampLower === 0 && flvPacket.packetType === PacketTypeEnum.AUDIO) {
    logger(['flvStreamParser2', flvPacket.audioMetaData], true);
  }

  if (flvPacket.header.timestampLower === 0 && flvPacket.packetType === PacketTypeEnum.VIDEO) {
    logger(['flvStreamParser2', flvPacket.videoMetaData], true);
  }

  if (flvStreamParserPacketCount < 4) {
    return;
  }

  //console.log(flvStreamParserPacketCount, flvPacket.header.packetType, flvPacket.header.timestampLower, flvPacket.header.payloadSize);
  //if (flvPacket.header.packetType === 9) console.log(flvStreamParserPacketCount, parseVideo(flvPacket.payload));

  //if (flvPacket.header.packetType === 18 && flvPacket.header.timestampLower === 0) return;

  const lastPacket = _.last(pausedStreamPackets);

  if (lastPacket) {
    if (flvPacket.header.timestampLower >= lastPacket.header.timestampLower) {
      pausedStreamPackets.push(flvPacket);
      pausedStreamPacketsCopy.push(flvPacket);
    } else {
      logger(['savedPackets2', 'skipping saving for', flvPacket.header.packetType], true);
    }
  } else {
    pausedStreamPackets.push(flvPacket);
    pausedStreamPacketsCopy.push(flvPacket);
  }
});

let prevPacket: FlvPacket = null;

let isDrained: boolean = true;

function writePacket(flvPacket: FlvPacket) {
  if (!prevPacket) {
    flvPacket.header.prevPacketSize = 0;
  } else {
    flvPacket.header.prevPacketSize = 11 + prevPacket.header.payloadSize;
  }

  isDrained = ffmpegSendProcess.write(flvPacket.buildPacket());

  prevPacket = flvPacket;
}

const mainStreamPackets: FlvPacket[] = [];

function saveMainStreamPacket(flvPacket: FlvPacket) {
  const lastPacket = _.last(mainStreamPackets);

  if (lastPacket) {
    if (flvPacket.header.timestampLower >= lastPacket.header.timestampLower) {
      mainStreamPackets.push(flvPacket);
    } else {
      logger(['savedPackets', 'skipping saving for', flvPacket.header.packetType], true);
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

const ffmpegSendProcess = sendRtmp();

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

  const buffer = mainStreamHeader.buildHeader();

  ffmpegSendProcess.write(buffer);

  let drainingWaitingTime: number = 0;

  while (true) {
    const cursor = lastTimestamps[lastTimestampsIndex];

    const packet = _.first(cursor.savedPackets);

    if (!packet) {
      logger(['packet not found, skipping...'], true);

      // console.log('writing went for', Date.now() - startTime);
      //
      // process.exit();

      await sleep(1000);

      continue;
    }

    const clonedPacket = _.cloneDeep(packet);

    clonedPacket.header.timestampLower = lastSwitchedTimestamp + packet.header.timestampLower - cursor.lastTimestamp;

    let writingStartTime = microseconds.now();

    writePacket(clonedPacket);

    if (lastTimestampsIndex === 0 && clonedPacket.header.packetType === 9) {
      const timestamp = clonedPacket.header.timestampLower;

      const text = getSubtitle(packet.header.timestampLower);

      publishSubtitles(timestamp, text);
    }

    // if (clonedPacket.getType() === 'video') {
    //     const subtitlePacket = _.cloneDeep(clonedPacket);
    //
    //     const subtitles = createSubtitlesMetadata('test subtitles');
    //
    //     subtitlePacket.header.prevPacketSize = clonedPacket.header.payloadSize;
    //     subtitlePacket.header.packetType = 18;
    //     subtitlePacket.header.payloadSize = subtitles.length;
    //     subtitlePacket.payload = subtitles;
    //
    //     writePacket(subtitlePacket);
    // }

    const writingEndTime: number = microseconds.now();

    const drainingStartTime: number = microseconds.now();

    if (!isDrained) {
      //console.log('not drained, have to wait before writing...');
      // await new Promise(resolve => {
      //     ffmpegSendProcess.stdin.once('drain', () => {
      //         //console.log('stdin drain once');
      //
      //         resolve();
      //     });
      // });
    }

    drainingWaitingTime += microseconds.now() - drainingStartTime;

    const nextPacket = cursor.savedPackets[1];

    let waitTime: number = 0;

    const threshold: number =
      clonedPacket.header.timestampLower - (Date.now() - startTime) + drainingWaitingTime / 1000;

    if (nextPacket) {
      waitTime =
        nextPacket.header.timestampLower * 1000 -
        packet.header.timestampLower * 1000 -
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
        currentTimestamp: packet.header.timestampLower,
        nextPacketTimestamp: _.get(nextPacket, ['header', 'timestampLower'], 'no-next-packet'),
        currentPacketsLeft: cursor.savedPackets.length,
        waitTime: waitTime / 1000,
        debt: timestampDebt / 1000,
        writeTime: (writingEndTime - writingStartTime) / 1000,
        lastSwitchedTimestamp,
        clonedPacketTimestamp: clonedPacket.header.timestampLower,
        cursorLastTimestamp: cursor.lastTimestamp,
        isDrained
      }
    ]);

    lastTimestamp = clonedPacket.header.timestampLower;
    lastPacketTimestamp = packet.header.timestampLower;

    cursor.savedPackets.shift();

    if (lastTimestampsIndex === 1 && cursor.savedPackets.length === 0) {
      cursor.savedPackets = _.cloneDeep(pausedStreamPacketsCopy);

      _.forEach(cursor.savedPackets, flvPacket => {
        flvPacket.header.timestampLower =
          packet.header.timestampLower + flvPacket.header.timestampLower - Math.ceil(1000 / config.framerate);
      });

      logger(['cloned packets.', packet.header.timestampLower, _.first(cursor.savedPackets).header.timestampLower]);
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
