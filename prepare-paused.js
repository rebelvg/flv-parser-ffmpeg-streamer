const childProcess = require('child_process');
const fs = require('fs');
const _ = require('lodash');

const config = require('./config.json');
const ffmpegPath = require('./config.json').ffmpegPath;

function preparePaused() {
    let ffmpegProcessVideo;

    if (!config.copyVideo) {
        ffmpegProcessVideo = childProcess.spawn(ffmpegPath, [
            '-loop', '1',
            '-i', config.pausedImg,
            '-t', '10',
            '-r', config.framerate,
            '-vf', `scale=${config.scaleWidth}:-2`,
            '-preset', config.preset,
            '-c:v', 'libx264',
            '-b:v', config.videoBitrate,
            '-minrate', config.videoBitrate,
            '-maxrate', config.videoBitrate,
            '-bufsize', config.videoBitrate,
            '-x264-params', 'nal-hrd=cbr',
            '-profile:v', 'high',
            '-pix_fmt', 'yuv420p',
            '-f', 'flv',
            '-'
        ], {
            stdio: 'pipe'
        });
    } else {
        ffmpegProcessVideo = childProcess.spawn(ffmpegPath, [
            '-i', config.videoFile,
            '-t', '0.3',
            '-vcodec', 'copy',
            '-an',
            '-f', 'flv',
            '-',
        ], {
            stdio: 'pipe'
        });
    }

    const ffmpegProcessAudio = childProcess.spawn(ffmpegPath, [
        '-f', 'lavfi',
        '-i', 'anullsrc=r=48000',
        '-i', '-',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-ar', '48000',
        '-b:a', '256k',
        '-shortest',
        '-f', 'flv',
        '-'
    ], {
        stdio: 'pipe'
    });

    // ffmpegProcessVideo.stderr.pipe(process.stdout);
    // ffmpegProcessAudio.stderr.pipe(process.stdout);

    ffmpegProcessVideo.stdout.pipe(ffmpegProcessAudio.stdin);

    let pausedVideo = fs.createWriteStream('paused.flv');
    ffmpegProcessAudio.stdout.pipe(pausedVideo);

    return ffmpegProcessAudio.stdout;
}

module.exports = preparePaused;
