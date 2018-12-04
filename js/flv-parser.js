const fs = require('fs');
const _ = require('lodash');
const bitwise = require('bitwise');

const { parseMetadata, parseAudio, parseVideo } = require('./modules/parse-data');

class FlvPacket {
  constructor(packetPos, fileBuffer) {
    const packetHeader = fileBuffer.slice(packetPos, packetPos + 15);

    this.packetHeader = packetHeader;
    this.prevPacketSize = packetHeader.readUInt32BE(0);
    this.packetType = packetHeader.readUInt8(4);
    this.payloadSize = packetHeader.readUIntBE(5, 3);
    this.timestampLower = packetHeader.readUIntBE(8, 3);
    this.timestampUpper = packetHeader.readUInt8(11);
    this.streamId = packetHeader.readUIntBE(12, 3);
    this.payload = fileBuffer.slice(packetPos + 15, packetPos + 15 + this.payloadSize);

    this.packetStart = packetPos;
    this.fullPacketSize = 15 + this.payloadSize;
    this.packetEnd = packetPos + this.fullPacketSize;
  }

  generateHeader() {
    let header = Buffer.alloc(15);

    header.writeUInt32BE(this.prevPacketSize);
    header.writeUInt8(this.packetType, 4);
    header.writeUIntBE(this.payloadSize, 5, 3);
    header.writeUIntBE(this.timestampLower, 8, 3);
    header.writeUInt8(this.timestampUpper, 11);
    header.writeUIntBE(this.streamId, 12, 3);

    return header;
  }
}

function parseFlv(fileName) {
  let flvFile = fs.readFileSync(fileName, {
    encoding: null
  });

  console.log(flvFile.toString('utf8', 0, 3));

  if (flvFile.toString('utf8', 0, 3) !== 'FLV') throw new Error('Not FLV.');

  let version = flvFile.readUInt8(3);
  let flags = flvFile.readUInt8(4);
  let headerSize = flvFile.readUInt32BE(5);

  console.log('version', version);
  console.log('flags', flags);
  console.log('header size', headerSize);

  let header = {
    signature: 'FLV',
    version: version,
    flags: flags,
    headerSize: headerSize
  };

  let firstPacket = new FlvPacket(headerSize, flvFile);

  console.log('packet type', firstPacket.packetType);

  let metadata = parseMetadata(firstPacket.payload);

  console.log('metaData', metadata);

  let contentPackets = [];

  let parseStartPos = firstPacket.packetEnd;

  let audioParsed = false;
  let videoParsed = false;

  while (true) {
    if (flvFile.length - parseStartPos === 4) break;

    let flvPacket = new FlvPacket(parseStartPos, flvFile);

    contentPackets.push(flvPacket);

    if (flvPacket.packetType === 8) {
      if (!audioParsed) {
        let audioData = parseAudio(flvPacket.payload);

        console.log('audioData', audioData);

        audioParsed = true;
      }
    }

    if (flvPacket.packetType === 9) {
      //console.log(flvPacket.timestampLower);

      if (!videoParsed) {
        let videoData = parseVideo(flvPacket.payload);

        console.log('videoData', videoData);

        videoParsed = true;
      }
    }

    if (flvPacket.packetType === 18) {
      let metadata = parseMetadata(flvPacket.payload);
    }

    parseStartPos = flvPacket.packetEnd;
  }

  console.log('n of packets', contentPackets.length);
  console.log(
    'content payload size',
    contentPackets.reduce(function(accumulator, currentValue) {
      return accumulator + currentValue.payloadSize;
    }, 0) /
      1024 /
      1024
  );

  return {
    header: header,
    firstPacket: firstPacket,
    contentPackets: contentPackets
  };
}

module.exports = parseFlv;
