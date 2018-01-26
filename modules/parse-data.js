const fs = require('fs');
const _ = require('lodash');
const bitwise = require('bitwise');

const TYPES = {
    audio: {
        soundFormat: {
            2: 'mp3',
            10: 'aac'
        },
        soundRate: {
            3: 44.1
        },
        soundSize: {
            1: 16
        },
        soundType: {
            0: 1,
            1: 2
        }
    },
    video: {
        frameType: {
            1: 'key-frame',
            2: 'inter-frame'
        },
        codecId: {
            4: 'on2 vp6',
            7: 'avc'
        }
    }
};

function parseMetadata(payload) {
    if (payload.readUInt8(0) !== 2) throw new Error('Unknown metadata format.');

    let stringLength = payload.readUIntBE(1, 2);

    let parseOffset = 3;

    let metadataName = payload.toString('utf8', parseOffset, parseOffset + stringLength);

    parseOffset += stringLength;

    if (payload.readUInt8(parseOffset) !== 8) throw new Error('Unknown metadata type.');

    parseOffset++;

    let metadataLength = payload.readUInt32BE(parseOffset);

    parseOffset += 5;

    let params = {};

    while (true) {
        if (parseOffset >= payload.length - 2) break;

        let paramNameLength = payload.readUInt8(parseOffset);

        parseOffset++;

        let paramName = payload.toString('utf8', parseOffset, parseOffset + paramNameLength);

        parseOffset += paramNameLength;

        let valueType = payload.readUInt8(parseOffset);

        parseOffset++;

        switch (valueType) {
            case 0: {
                params[paramName] = payload.readDoubleBE(parseOffset);

                parseOffset += 8;

                break;
            }
            case 1: {
                params[paramName] = Boolean(payload.readUIntBE(parseOffset, 1));

                parseOffset += 1;

                break;
            }
            case 2: {
                let valueLength = payload.readInt16BE(parseOffset);

                parseOffset += 2;

                params[paramName] = payload.toString('utf8', parseOffset, parseOffset + valueLength);

                parseOffset += valueLength;

                break;
            }
            default: {
                throw new Error(`Unknown metadata value type. ${valueType}`);
            }
        }

        parseOffset++;
    }

    return params;
}

function parseAudio(payload) {
    let soundFormatBit = bitwise.readUInt(payload, 0, 4);
    let soundRateBit = bitwise.readUInt(payload, 4, 2);
    let soundSizeBit = bitwise.readUInt(payload, 6, 1);
    let soundTypeBit = bitwise.readUInt(payload, 7, 1);

    let soundFormat = _.get(TYPES, ['audio', 'soundFormat', soundFormatBit]);
    let soundRate = _.get(TYPES, ['audio', 'soundRate', soundRateBit]);
    let soundSize = _.get(TYPES, ['audio', 'soundSize', soundSizeBit]);
    let soundType = _.get(TYPES, ['audio', 'soundType', soundTypeBit]);

    if (!soundFormat) throw new Error('Unknown sound format. ' + soundFormatBit);
    if (!soundRate) throw new Error('Unknown sound rate. ' + soundRateBit);
    if (!soundSize) throw new Error('Unknown sound size. ' + soundSizeBit);
    if (!soundType) throw new Error('Unknown sound type. ' + soundTypeBit);

    return {
        soundFormat: soundFormat,
        soundRate: soundRate,
        soundSize: soundSize,
        channels: soundType
    };
}

function parseVideo(payload) {
    let frameTypeBit = bitwise.readUInt(payload, 0, 4);
    let codecIdBit = bitwise.readUInt(payload, 4, 4);

    let frameType = _.get(TYPES, ['video', 'frameType', frameTypeBit]);
    let codecId = _.get(TYPES, ['video', 'codecId', codecIdBit]);

    if (!frameType) throw new Error('Unknown frame type. ' + frameTypeBit);
    if (!codecId) throw new Error('Unknown codec id. ' + codecIdBit);

    return {
        frameType: frameType,
        codecId: codecId
    };
}

exports.parseMetadata = parseMetadata;
exports.parseAudio = parseAudio;
exports.parseVideo = parseVideo;
