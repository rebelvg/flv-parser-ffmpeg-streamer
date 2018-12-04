import * as fs from 'fs';
import * as _ from 'lodash';
import * as childProcess from 'child_process';

import { config } from '../config';

import { Readable } from 'stream';

export function preparePaused(): Readable {
  let ffmpegProcessVideo: childProcess.ChildProcess;

  if (!config.copyVideo) {
    ffmpegProcessVideo = childProcess.spawn(
      config.ffmpegPath,
      [
        '-loop',
        '1',
        '-i',
        config.pausedImg,
        '-t',
        '10',
        '-r',
        `${config.framerate}`,
        '-vf',
        `scale=${config.scaleWidth}:-2`,
        '-preset',
        config.preset,
        '-c:v',
        'libx264',
        '-b:v',
        `${config.videoBitrate}k`,
        '-minrate',
        `${config.videoBitrate}k`,
        '-maxrate',
        `${config.videoBitrate}k`,
        '-bufsize',
        `${config.videoBitrate}k`,
        '-x264-params',
        'nal-hrd=cbr',
        '-profile:v',
        'high',
        '-pix_fmt',
        'yuv420p',
        '-f',
        'flv',
        '-'
      ],
      {
        stdio: 'pipe'
      }
    );
  } else {
    ffmpegProcessVideo = childProcess.spawn(
      config.ffmpegPath,
      ['-i', config.videoFile, '-t', '0.3', '-vcodec', 'copy', '-an', '-f', 'flv', '-'],
      {
        stdio: 'pipe'
      }
    );
  }

  const ffmpegProcessAudio = childProcess.spawn(
    config.ffmpegPath,
    [
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000',
      '-i',
      '-',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-b:a',
      '256k',
      '-shortest',
      '-f',
      'flv',
      '-'
    ],
    {
      stdio: 'pipe'
    }
  );

  // ffmpegProcessVideo.stderr.pipe(process.stdout);
  // ffmpegProcessAudio.stderr.pipe(process.stdout);

  ffmpegProcessVideo.stdout.pipe(ffmpegProcessAudio.stdin);

  const pausedVideo = fs.createWriteStream('paused.flv');

  ffmpegProcessAudio.stdout.pipe(pausedVideo);

  return ffmpegProcessAudio.stdout;
}
