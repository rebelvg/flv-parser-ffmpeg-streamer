import { FlvHeader, FlvPacketHeader, FlvPacket } from "./flv/flv";
import { FlvStreamParser } from "./flv-stream";

import * as fs from 'fs';
import * as _ from 'lodash';
import * as ReadLine from 'readline';
import * as microseconds from 'microseconds';

const config = require('./config.json');
const {parseMetadata, parseAudio, parseVideo, createSubtitlesMetadata} = require('./modules/parse-data');
const ffmpegPipe = require('./ffmpeg-pipe');
const preparePaused = require('./prepare-paused');
const sendRtmp = require('./send-rtmp');
const logger = require('./logger');
const {publishFlv, publishSubtitles} = require('./socket-publisher');
const getSubtitle = require('./subtitles-parser');

//const flvStream = fs.createReadStream('video.flv');

//const streamedFlv = fs.createWriteStream('streamed-flv.flv');

const ffmpegProcess = ffmpegPipe();

const flvStream = ffmpegProcess.stdout;
const flvStream2 = preparePaused();

//const flvStream = fs.createReadStream('video.flv');

const flvStreamParser = new FlvStreamParser();
const flvStreamParser2 = new FlvStreamParser();

flvStream.pipe(flvStreamParser);
flvStream2.pipe(flvStreamParser2);

let mainHeader: FlvHeader = null;

flvStreamParser.on('flv-header', (header: FlvHeader) => {
    logger([header], true);

    mainHeader = header;
});

let firstMetaDataPacket: FlvPacket = null;
let firstAudioPacket: FlvPacket = null;
let firstVideoPacket: FlvPacket = null;

flvStreamParser.on('flv-packet', (flvPacket: FlvPacket) => {
    savePacket(flvPacket);

    if (!firstMetaDataPacket && flvPacket.header.packetType === 18) {
        const metadata = parseMetadata(flvPacket.payload);

        logger(['flvStreamParser', metadata], true);

        firstMetaDataPacket = flvPacket;
    }

    if (!firstAudioPacket && flvPacket.header.packetType === 8) {
        const audioData = parseAudio(flvPacket.payload);

        logger(['flvStreamParser', audioData], true);

        firstAudioPacket = flvPacket;
    }

    if (!firstVideoPacket && flvPacket.header.packetType === 9) {
        const videoData = parseVideo(flvPacket.payload);

        logger(['flvStreamParser', videoData], true);

        firstVideoPacket = flvPacket;
    }
});

const savedPackets2: FlvPacket[] = [];
const savedPackets2Copy: FlvPacket[] = [];

let flvStreamParserPacketCount: number = 0;

flvStreamParser2.on('flv-packet', (flvPacket: FlvPacket) => {
    flvStreamParserPacketCount++;

    if (flvPacket.header.timestampLower === 0 && flvPacket.header.packetType === 18) {
        const metadata = parseMetadata(flvPacket.payload);

        logger(['flvStreamParser2', metadata], true);
    }

    if (flvPacket.header.timestampLower === 0 && flvPacket.header.packetType === 8) {
        const audioData = parseAudio(flvPacket.payload);

        logger(['flvStreamParser2', audioData], true);
    }

    if (flvPacket.header.timestampLower === 0 && flvPacket.header.packetType === 9) {
        const videoData = parseVideo(flvPacket.payload);

        logger(['flvStreamParser2', videoData], true);
    }

    if ([1, 2, 3].includes(flvStreamParserPacketCount)) return;

    //console.log(flvStreamParserPacketCount, flvPacket.header.packetType, flvPacket.header.timestampLower, flvPacket.header.payloadSize);
    //if (flvPacket.header.packetType === 9) console.log(flvStreamParserPacketCount, parseVideo(flvPacket.payload));

    //if (flvPacket.header.packetType === 18 && flvPacket.header.timestampLower === 0) return;

    const lastPacket = _.last(savedPackets2);

    if (lastPacket) {
        if (flvPacket.header.timestampLower >= lastPacket.header.timestampLower) {
            savedPackets2.push(flvPacket);
            savedPackets2Copy.push(flvPacket);
        } else {
            logger(['savedPackets2', 'skipping saving for', flvPacket.header.packetType], true);
        }
    } else {
        savedPackets2.push(flvPacket);
        savedPackets2Copy.push(flvPacket);
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

    const buffer = Buffer.concat([flvPacket.header.buildPacketHeader(), flvPacket.payload]);

    isDrained = ffmpegSendProcess.stdin.write(buffer);

    prevPacket = flvPacket;
}

const savedPackets: FlvPacket[] = [];

function savePacket(flvPacket: FlvPacket) {
    let lastPacket = _.last(savedPackets);

    if (lastPacket) {
        if (flvPacket.header.timestampLower >= lastPacket.header.timestampLower) {
            savedPackets.push(flvPacket);
        } else {
            logger(['savedPackets', 'skipping saving for', flvPacket.header.packetType], true);
        }
    } else {
        savedPackets.push(flvPacket);
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
    lastTimestamp: number,
    savedPackets: FlvPacket[]
}

interface ILastTimestamps {
    [index: number]: ICursor
}

let lastTimestamps: ILastTimestamps = {
    0: {
        lastTimestamp: 0,
        savedPackets
    },
    1: {
        lastTimestamp: 0,
        savedPackets
    }
};

let lastSwitchedTimestamp: number = 0;
let lastPacketTimestamp: number = 0;

let ffmpegSendProcess = sendRtmp();

ffmpegSendProcess.stdin.on('close', () => {
    logger(['stdin close'], true);
});

ffmpegSendProcess.stdin.on('error', (err: Error) => {
    logger(['stdin error', err], true);

    process.exit(1);
});

ffmpegSendProcess.stdin.on('finish', () => {
    logger(['stdin finish'], true);
});

ffmpegSendProcess.stdin.on('drain', () => {
    //console.log('stdin drain');
});

async function writeSequence() {
    logger(['writing...'], true);

    while (true) {
        if (savedPackets.length > 4) {
            break;
        }

        logger(['waiting at least 5 packets'], true);

        await sleep(1000 * 1000);
    }

    await sleep(5 * 1000 * 1000);

    const startTime = Date.now();

    const buffer = mainHeader.buildHeader();

    ffmpegSendProcess.stdin.write(buffer);

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
            //     ffmpegSendProcess.stdin.once('drain', function () {
            //         //console.log('stdin drain once');
            //
            //         resolve();
            //     });
            // });
        }

        drainingWaitingTime += microseconds.now() - drainingStartTime;

        const nextPacket = cursor.savedPackets[1];

        let waitTime: number = 0;

        const threshold: number = clonedPacket.header.timestampLower - (Date.now() - startTime) + drainingWaitingTime / 1000;

        if (nextPacket) {
            waitTime = nextPacket.header.timestampLower * 1000 - packet.header.timestampLower * 1000 - (writingEndTime - writingStartTime) - timestampDebt;

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

        logger(['writing packet...', {
            threshold: threshold,
            runningTime: Date.now() - startTime,
            drainingWaitingTime: drainingWaitingTime / 1000,
            currentTimestamp: packet.header.timestampLower,
            nextPacketTimestamp: _.get(nextPacket, ['header', 'timestampLower'], 'no-next-packet'),
            currentPacketsLeft: cursor.savedPackets.length,
            waitTime: waitTime / 1000,
            debt: timestampDebt / 1000,
            writeTime: (writingEndTime - writingStartTime) / 1000,
            lastSwitchedTimestamp: lastSwitchedTimestamp,
            lastTimestamp: lastTimestamp,
            clonedPacketTimestamp: clonedPacket.header.timestampLower,
            cursorLastTimestamp: cursor.lastTimestamp,
            clonedPacketPayloadSize: clonedPacket.header.payloadSize,
            isDrained: isDrained
        }]);

        lastTimestamp = clonedPacket.header.timestampLower;
        lastPacketTimestamp = packet.header.timestampLower;

        cursor.savedPackets.shift();

        if (lastTimestampsIndex === 1 && cursor.savedPackets.length === 0) {
            cursor.savedPackets = _.cloneDeep(savedPackets2Copy);

            _.forEach(cursor.savedPackets, (flvPacket) => {
                flvPacket.header.timestampLower = packet.header.timestampLower + flvPacket.header.timestampLower - Math.ceil(1000 / _.toNumber(config.framerate));
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

readLine.on('line', (line) => {
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

    lastSwitchedTimestamp = lastTimestamp - Math.ceil(1000 / _.toNumber(config.framerate));

    lastTimestamps[lastTimestampsIndex].lastTimestamp = lastPacketTimestamp;

    lastTimestampsIndex = lastTimestampsIndex === 1 ? 0 : 1;

    switchVideoRequestFlag = false;
}

writeSequence();
