import * as fs from 'fs';
import * as childProcess from 'child_process';
import { Readable } from 'stream';
import * as _ from 'lodash';

import { config } from '../config';
import { logger } from './logger';

export function pipeMainFile(): Readable {
  let ffmpegParams: string[];

  if (config.copyVideo) {
    ffmpegParams = [
      '-ss',
      config.videoStart,
      //'-nostats',
      '-re',
      '-i',
      config.videoFilePath,
      '-isync',
      '-c:v',
      'copy',
      '-acodec',
      'aac',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-b:a',
      '256k',
      '-f',
      'flv',
      '-',
    ];
  } else {
    ffmpegParams = [
      '-ss',
      config.videoStart,
      //'-nostats',
      '-re',
      '-i',
      config.videoFilePath,
      //'-isync',
      '-preset',
      config.preset,
      '-vcodec',
      'libx264',
      '-vf',
      `crop=iw:ih-${config.cropHeight * 2}:0:${config.cropHeight}, scale=${
        config.scaleWidth
      }:-2`,
      '-tune',
      'grain',
      '-b:v',
      `${config.videoBitrate}k`,
      '-profile:v',
      'high',
      '-acodec',
      'aac',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-b:a',
      '256k',
      '-f',
      'flv',
      '-',
    ];
  }

  const ffmpegProcess = childProcess.spawn(config.ffmpegPath, ffmpegParams, {
    stdio: 'pipe',
  });

  //const fileReadStream = fs.createReadStream(fileReadPath);
  //fileReadStream.pipe(ffmpegProcess.stdin);

  const encodedVideo = fs.createWriteStream('encoded.flv');

  ffmpegProcess.stdout.pipe(encodedVideo);

  ffmpegProcess.stderr.setEncoding('utf8');

  ffmpegProcess.stderr.on('data', (data: string) => {
    logger(['ffmpeg-pipe', data]);
  });

  return ffmpegProcess.stdout;
}
