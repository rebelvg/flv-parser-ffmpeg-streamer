const childProcess = require('child_process');
const fs = require('fs');
const _ = require('lodash');

const config = require('./config.json');
const ffmpegPath = require('./config.json').ffmpegPath;

function pipe() {
    const ffmpegProcess = childProcess.spawn(ffmpegPath, [
        '-ss', config.videoStart,
        '-nostats',
        '-re',
        '-i', config.videoFile,
        '-isync',
        '-preset', config.preset,
        '-vcodec', 'libx264',
        '-vf', `crop=iw:ih-${config.cropHeight * 2}:0:${config.cropHeight}, scale=${config.scaleWidth}:-2`,
        '-b:v', config.videoBitrate,
        '-profile:v', 'high',
        '-acodec', 'aac',
        '-ac', '2',
        '-ar', '48000',
        '-b:a', '256k',
        '-f', 'flv',
        '-'
    ], {
        stdio: 'pipe'
    });

    //let fileReadStream = fs.createReadStream(fileReadPath);
    //fileReadStream.pipe(ffmpegProcess.stdin);

    let encodedVideo = fs.createWriteStream('encoded.flv');
    ffmpegProcess.stdout.pipe(encodedVideo);

    return ffmpegProcess;
}

module.exports = pipe;
