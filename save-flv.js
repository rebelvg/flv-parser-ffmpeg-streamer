const fs = require('fs');
const _ = require('lodash');

const flvParser = require('./flv-parser');

let parsedFlv = flvParser('video.flv');

let writeBuffer = [];

let header = Buffer.alloc(parsedFlv.header.headerSize);

header.write(parsedFlv.header.signature);
header.writeUInt8(parsedFlv.header.version, 3);
header.writeUInt8(parsedFlv.header.flags, 4);
header.writeUInt32BE(parsedFlv.header.headerSize, 5);

writeBuffer.push(header);

writeBuffer.push(parsedFlv.firstPacket.generateHeader());
writeBuffer.push(parsedFlv.firstPacket.payload);

let packetsToBuffer = [];

let firstVideoPacket = null;
let firstAudioPacket = null;

_.forEach(parsedFlv.contentPackets, (flvPacket) => {
    if (!firstVideoPacket && flvPacket.packetType === 9) {
        packetsToBuffer.push(flvPacket);

        return firstVideoPacket = flvPacket;
    }

    if (!firstAudioPacket && flvPacket.packetType === 8) {
        packetsToBuffer.push(flvPacket);

        return firstAudioPacket = flvPacket;
    }

    if (firstVideoPacket && firstAudioPacket) return false;
});

function writePacketSequence(where, what) {
    let startTimestamp = _.last(where).timestampLower;

    let timestampOffset = _.first(what).timestampLower - startTimestamp;

    let firstPacket = null;

    what = _.cloneDeep(what);

    _.forEach(what, (flvPacket) => {
        if (!firstPacket) {
            firstPacket = flvPacket;

            console.log('first packet content type', flvPacket.packetType);

            firstPacket.timestampLower = startTimestamp;
        } else {
            flvPacket.timestampLower = flvPacket.timestampLower - timestampOffset;
        }

        where.push(flvPacket);
    });
}

let writePackets = _.slice(parsedFlv.contentPackets, 2, 3000);

writePacketSequence(packetsToBuffer, writePackets);

let lastPacket = parsedFlv.firstPacket;

_.forEach(packetsToBuffer, (flvPacket, i) => {
    flvPacket.prevPacketSize = 11 + lastPacket.payloadSize;

    writeBuffer.push(flvPacket.generateHeader());
    writeBuffer.push(flvPacket.payload);

    lastPacket = flvPacket;
});

let lastBuffer = Buffer.alloc(4);
lastBuffer.writeUInt32BE(11 + lastPacket.payloadSize);

writeBuffer.push(lastBuffer);

fs.writeFileSync('parsed-flv.flv', Buffer.concat(writeBuffer));
