const fs = require('fs');
const _ = require('lodash');
const Writable = require('stream').Writable;
const StreamParser = require('stream-parser');
const childProcess = require('child_process');
const ReadLine = require('readline');
const microseconds = require('microseconds');
const NanoTimer = require('nanotimer');
const os = require('os');

const config = require('./config.json');
const {parseMetadata, parseAudio, parseVideo, createSubtitlesMetadata} = require('./modules/parse-data');
const ffmpegPipe = require('./ffmpeg-pipe');
const preparePaused = require('./prepare-paused');
const sendRtmp = require('./send-rtmp');
const logger = require('./logger');

//const flvStream = fs.createReadStream('video.flv');

class FlvHeader {
    constructor(header) {
        let signature = header.toString('utf8', 0, 3);
        let version = header.readUInt8(3);
        let flags = header.readUInt8(4);
        let headerSize = header.readUInt32BE(5);

        if (signature !== 'FLV') throw new Error('Not FLV.');

        this.signature = signature;
        this.version = version;
        this.flags = flags;
        this.headerSize = headerSize;
    }

    buildHeader() {
        let header = Buffer.alloc(this.headerSize);

        header.write(this.signature);
        header.writeUInt8(this.version, 3);
        header.writeUInt8(this.flags, 4);
        header.writeUInt32BE(this.headerSize, 5);

        return header;
    }
}

class FlvPacketHeader {
    constructor(packetHeader) {
        this.packetHeader = packetHeader;
        this.prevPacketSize = packetHeader.readUInt32BE(0);
        this.packetType = packetHeader.readUInt8(4);
        this.payloadSize = packetHeader.readUIntBE(5, 3);
        this.timestampLower = packetHeader.readUIntBE(8, 3);
        this.timestampUpper = packetHeader.readUInt8(11);
        this.streamId = packetHeader.readUIntBE(12, 3);
    }

    buildPacketHeader() {
        let packetHeader = Buffer.alloc(15);

        packetHeader.writeUInt32BE(this.prevPacketSize);
        packetHeader.writeUInt8(this.packetType, 4);
        packetHeader.writeUIntBE(this.payloadSize, 5, 3);
        packetHeader.writeUIntBE(this.timestampLower, 8, 3);
        packetHeader.writeUInt8(this.timestampUpper, 11);
        packetHeader.writeUIntBE(this.streamId, 12, 3);

        return packetHeader;
    }
}

class FlvPacket {
    constructor(packetHeader, payload) {
        this.header = packetHeader;
        this.payload = payload;
        this.fullPacketSize = 15 + packetHeader.payloadSize;
    }

    getType() {
        switch (this.header.packetType) {
            case 8: {
                return 'audio';
            }
            case 9: {
                return 'video';
            }
            case 18: {
                return 'metadata';
            }
            case 99: {
                return 'subtitles';
            }
            default: {
                return 'unknown';
            }
        }
    }
}

class FlvStreamParser extends Writable {
    constructor() {
        super();

        this._bytes(9, this.onHeader);
    }

    onHeader(headerBuffer, output) {
        let header = new FlvHeader(headerBuffer);

        this.emit('header', header);

        if (header.headerSize !== 9) {
            this._skipBytes(header.headerSize - 9, () => {
                this._bytes(15, this.onPacketHeader);
            });
        } else {
            this._bytes(15, this.onPacketHeader);
        }

        output();
    }

    onPacketHeader(packetHeaderBuffer, output) {
        const packetHeader = new FlvPacketHeader(packetHeaderBuffer);

        this._bytes(packetHeader.payloadSize, (packetPayloadBuffer, output) => {
            this.emit('packet', new FlvPacket(packetHeader, packetPayloadBuffer));

            this._bytes(15, this.onPacketHeader);

            output();
        });

        output();
    }
}

StreamParser(FlvStreamParser.prototype);

//const streamedFlv = fs.createWriteStream('streamed-flv.flv');

const ffmpegProcess = ffmpegPipe();

const flvStream = ffmpegProcess.stdout;
const flvStream2 = preparePaused();

//const flvStream = fs.createReadStream('video.flv');

const flvStreamParser = new FlvStreamParser();
const flvStreamParser2 = new FlvStreamParser();

flvStream.pipe(flvStreamParser);
flvStream2.pipe(flvStreamParser2);

let mainHeader = null;

flvStreamParser.on('header', function (header) {
    logger([header], true);

    mainHeader = header;
});

let firstPacket = null;
let firstMetaDataPacket = null;
let firstAudioPacket = null;
let firstVideoPacket = null;

flvStreamParser.on('packet', function (flvPacket) {
    savePacket(flvPacket);

    if (!firstMetaDataPacket && flvPacket.header.packetType === 18) {
        let metadata = parseMetadata(flvPacket.payload);

        logger(['flvStreamParser', metadata], true);

        firstMetaDataPacket = flvPacket;
    }

    if (!firstAudioPacket && flvPacket.header.packetType === 8) {
        let audioData = parseAudio(flvPacket.payload);

        logger(['flvStreamParser', audioData], true);

        firstAudioPacket = flvPacket;
    }

    if (!firstVideoPacket && flvPacket.header.packetType === 9) {
        let videoData = parseVideo(flvPacket.payload);

        logger(['flvStreamParser', videoData], true);

        firstVideoPacket = flvPacket;
    }
});

let savedPackets2 = [];
let savedPackets2Copy = [];

let flvStreamParserPacketCount = 0;

flvStreamParser2.on('packet', function (flvPacket) {
    flvStreamParserPacketCount++;

    if (flvPacket.header.timestampLower === 0 && flvPacket.header.packetType === 18) {
        let metadata = parseMetadata(flvPacket.payload);

        logger(['flvStreamParser2', metadata], true);
    }

    if (flvPacket.header.timestampLower === 0 && flvPacket.header.packetType === 8) {
        let audioData = parseAudio(flvPacket.payload);

        logger(['flvStreamParser2', audioData], true);
    }

    if (flvPacket.header.timestampLower === 0 && flvPacket.header.packetType === 9) {
        let videoData = parseVideo(flvPacket.payload);

        logger(['flvStreamParser2', videoData], true);
    }

    if ([1, 2, 3].includes(flvStreamParserPacketCount)) return;

    //console.log(flvStreamParserPacketCount, flvPacket.header.packetType, flvPacket.header.timestampLower, flvPacket.header.payloadSize);
    //if (flvPacket.header.packetType === 9) console.log(flvStreamParserPacketCount, parseVideo(flvPacket.payload));

    //if (flvPacket.header.packetType === 18 && flvPacket.header.timestampLower === 0) return;

    let lastPacket = _.last(savedPackets2);

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

let prevPacket = null;

let isDrained = true;

function writePacket(flvPacket) {
    if (!prevPacket) {
        flvPacket.header.prevPacketSize = 0;
    } else {
        flvPacket.header.prevPacketSize = 11 + prevPacket.header.payloadSize;
    }

    isDrained = ffmpegSendProcess.stdin.write(Buffer.concat([flvPacket.header.buildPacketHeader(), flvPacket.payload]));

    prevPacket = flvPacket;
}

let savedPackets = [];

function savePacket(flvPacket) {
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

let nanoTimer = new NanoTimer();

function sleep(mcs) {
    return new Promise(resolve => {
        //nanoTimer.setTimeout(resolve, [], `${mcs}u`);
        setTimeout(resolve, mcs / 1000);
    });
}

let lastTimestamp = 0;

let timestampDebt = 0;

let lastTimestampsIndex = 0;

let lastTimestamps = {
    0: {
        lastTimestamp: 0,
        savedPackets: savedPackets
    },
    1: {
        lastTimestamp: 0,
        savedPackets: savedPackets2
    }
};

let lastSwitchedTimestamp = 0;
let lastPacketTimestamp = 0;

let ffmpegSendProcess = sendRtmp();

ffmpegSendProcess.stdin.on('close', function () {
    logger(['stdin close'], true);
});

ffmpegSendProcess.stdin.on('error', function (err) {
    logger(['stdin error', err], true);
});

ffmpegSendProcess.stdin.on('finish', function () {
    logger(['stdin finish'], true);
});

ffmpegSendProcess.stdin.on('drain', function () {
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

    let startTime = Date.now();

    ffmpegSendProcess.stdin.write(mainHeader.buildHeader());

    let drainingWaitingTime = 0;

    while (true) {
        let cursor = lastTimestamps[lastTimestampsIndex];

        let packet = _.first(cursor.savedPackets);

        if (!packet) {
            logger(['packet not found, skipping...'], true);

            // console.log('writing went for', Date.now() - startTime);
            //
            // process.exit();

            await sleep(1000);

            continue;
        }

        let clonedPacket = _.cloneDeep(packet);

        clonedPacket.header.timestampLower = lastSwitchedTimestamp + packet.header.timestampLower - cursor.lastTimestamp;

        let writingStartTime = microseconds.now();

        writePacket(clonedPacket);

        if (clonedPacket.getType() === 'video') {
            const subtitlePacket = _.cloneDeep(clonedPacket);

            const subtitles = createSubtitlesMetadata('test subtitles');

            subtitlePacket.header.prevPacketSize = clonedPacket.header.payloadSize;
            subtitlePacket.header.packetType = 18;
            subtitlePacket.header.payloadSize = subtitles.length;
            subtitlePacket.payload = subtitles;

            writePacket(subtitlePacket);
        }

        let writingEndTime = microseconds.now();

        let drainingStartTime = microseconds.now();

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

        let nextPacket = cursor.savedPackets[1];

        let waitTime = 0;

        let threshold = clonedPacket.header.timestampLower - (Date.now() - startTime) + drainingWaitingTime / 1000;

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

let streamingEncode = true;

readLine.on('line', function (line) {
    if (line === 's') {
        switchVideoRequest();
    }
});

let switchVideoRequestFlag = false;

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
