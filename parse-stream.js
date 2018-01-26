const fs = require('fs');
const _ = require('lodash');
const Writable = require('stream').Writable;
const StreamParser = require('stream-parser');
const childProcess = require('child_process');
const ReadLine = require('readline');
const microseconds = require('microseconds');
const NanoTimer = require('nanotimer');

const {parseMetadata, parseAudio, parseVideo} = require('./modules/parse-data');
const ffmpegPipe = require('./ffmpeg-pipe');
const preparePaused = require('./prepare-paused');
const sendRtmp = require('./send-rtmp');

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

        this._bytes(packetHeader.payloadSize, function (packetPayloadBuffer, output) {
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
    console.log(header);

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

        console.log('flvStreamParser', metadata);

        firstMetaDataPacket = flvPacket;
    }

    if (!firstAudioPacket && flvPacket.header.packetType === 8) {
        let audioData = parseAudio(flvPacket.payload);

        console.log('flvStreamParser', audioData);

        firstAudioPacket = flvPacket;
    }

    if (!firstVideoPacket && flvPacket.header.packetType === 9) {
        let videoData = parseVideo(flvPacket.payload);

        console.log('flvStreamParser', videoData, flvPacket.header.payloadSize);

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

        console.log('flvStreamParser2', metadata);
    }

    if (flvPacket.header.timestampLower === 0 && flvPacket.header.packetType === 8) {
        let audioData = parseAudio(flvPacket.payload);

        console.log('flvStreamParser2', audioData);
    }

    if (flvPacket.header.timestampLower === 0 && flvPacket.header.packetType === 9) {
        let videoData = parseVideo(flvPacket.payload);

        console.log('flvStreamParser2', videoData, flvPacket.header.payloadSize);
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
            console.log('savedPackets2', 'skipping saving for', flvPacket.header.packetType);
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

    //console.log(isDrained);

    prevPacket = flvPacket;
}

let savedPackets = [];

function savePacket(flvPacket) {
    let lastPacket = _.last(savedPackets);

    if (lastPacket) {
        if (flvPacket.header.timestampLower >= lastPacket.header.timestampLower) {
            savedPackets.push(flvPacket);
        } else {
            console.log('savedPackets', 'skipping saving for', flvPacket.header.packetType);
        }
    } else {
        savedPackets.push(flvPacket);
    }

    //console.log('saved', flvPacket.header.timestampLower);
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
    console.log('stdin close');
});

ffmpegSendProcess.stdin.on('error', function (err) {
    console.log('stdin error', err);
});

ffmpegSendProcess.stdin.on('finish', function () {
    console.log('stdin finish');
});

ffmpegSendProcess.stdin.on('drain', function () {
    //console.log('stdin drain');
});

async function writeSequence() {
    console.log('writing...');

    let startTime = Date.now();

    ffmpegSendProcess.stdin.write(mainHeader.buildHeader());

    let drainingWaitingTime = 0;

    while (true) {
        let cursor = lastTimestamps[lastTimestampsIndex];

        let packet = _.first(cursor.savedPackets);

        if (!packet) {
            console.log('packet not found, skipping...');

            // console.log('writing went for', Date.now() - startTime);
            //
            // process.exit();

            await sleep(1000);

            continue;
        }

        let clonedPacket = _.cloneDeep(packet);

        clonedPacket.header.timestampLower = lastSwitchedTimestamp + packet.header.timestampLower - cursor.lastTimestamp;

        //console.log(Date.now() - startTime, lastSwitchedTimestamp, lastTimestamp, packet.header.timestampLower, clonedPacket.header.timestampLower, cursor.lastTimestamp);

        let writingStartTime = microseconds.now();

        writePacket(clonedPacket);

        let writingEndTime = microseconds.now();

        let drainingStartTime = microseconds.now();

        if (!isDrained) {
            //console.log('not drained, have to wait before writing...');

            await new Promise(resolve => {
                ffmpegSendProcess.stdin.once('drain', function () {
                    //console.log('stdin drain once');

                    resolve();
                });
            });
        }

        drainingWaitingTime += microseconds.now() - drainingStartTime;

        let nextPacket = cursor.savedPackets[1];

        let waitTime;

        if (nextPacket) {
            waitTime = nextPacket.header.timestampLower * 1000 - packet.header.timestampLower * 1000 - (writingEndTime - writingStartTime) - timestampDebt;

            if (packet.header.timestampLower > nextPacket.header.timestampLower) {
                console.log(cursor.savedPackets.length, nextPacket.header.timestampLower - packet.header.timestampLower);
                console.log(packet.header.packetType, nextPacket.header.packetType);
            }

            let threshold = clonedPacket.header.timestampLower - (Date.now() - startTime) + drainingWaitingTime / 1000;

            //console.log('threshold', threshold);

            if (waitTime > 0) {
                timestampDebt = 0;

                if (threshold > 0) {
                    await sleep(waitTime);
                } else {
                    await sleep(waitTime - 1000);
                }
            } else {
                timestampDebt = waitTime * -1;

                //console.log('debt', timestampDebt, nextPacket.header.timestampLower - packet.header.timestampLower, writingEndTime - writingStartTime);
            }
        }

        //console.log('writing packet...', Date.now() - startTime, packet.header.timestampLower, cursor.savedPackets.length);

        lastTimestamp = clonedPacket.header.timestampLower;
        lastPacketTimestamp = packet.header.timestampLower;

        cursor.savedPackets.shift();

        if (lastTimestampsIndex === 1 && cursor.savedPackets.length === 0) {
            cursor.savedPackets = _.cloneDeep(savedPackets2Copy);

            _.forEach(cursor.savedPackets, (flvPacket) => {
                flvPacket.header.timestampLower = packet.header.timestampLower + flvPacket.header.timestampLower;
            });

            console.log(new Date(), 'cloned packets.', packet.header.timestampLower, _.first(cursor.savedPackets).header.timestampLower);
        }

        if (lastTimestampsIndex === 0 && cursor.savedPackets.length === 0) {
            console.log('no main packets left.');
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

    if (line === 'w') {
        console.log('writing sequence...');

        writeSequence();
    }
});

let switchVideoRequestFlag = false;

function switchVideoRequest() {
    switchVideoRequestFlag = true;
}

function switchVideoRequested() {
    if (!switchVideoRequestFlag) return;

    console.log('switched videos.');

    streamingEncode = !streamingEncode;

    lastSwitchedTimestamp = lastTimestamp;

    lastTimestamps[lastTimestampsIndex].lastTimestamp = lastPacketTimestamp;

    lastTimestampsIndex = lastTimestampsIndex === 1 ? 0 : 1;

    switchVideoRequestFlag = false;
}

setTimeout(function () {
    writeSequence();

    //setInterval(switchVideo, 30000);
}, 5000);
