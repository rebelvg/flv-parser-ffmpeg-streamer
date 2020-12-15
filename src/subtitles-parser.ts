import * as fs from 'fs';
import * as _ from 'lodash';
import * as Subtitles from 'subtitle';

import { config } from '../config';

const subtitlesFile = fs.readFileSync(config.subtitlesFile, {
  encoding: 'utf-8',
});

const subtitles = Subtitles.parse(subtitlesFile);

export function getSubtitle(timestamp: number): string {
  const videoStart = config.videoStart.split(':');

  timestamp +=
    timestamp +
    parseInt(videoStart[0]) * 60 * 60 * 1000 +
    parseInt(videoStart[1]) * 60 * 1000 +
    parseInt(videoStart[2]) * 1000;

  const subtitle = _.find(subtitles, (subtitle) => {
    return subtitle.start <= timestamp && subtitle.end >= timestamp;
  });

  if (!subtitle) {
    return null;
  }

  return subtitle.text;
}
